import type { MenuFact, Scenario } from './generativeRequirements'
import type { Reservation } from './requestBudget'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs'

import Redis from 'ioredis'

import { createConfigKVService } from '../../src/services/adapters/config-kv'
import { createEnvelopeCrypto } from '../../src/utils/envelope-crypto'
import { assess, createInput, inspectFeasibility, parseProposal, responseFormat } from './generativeRequirements'
import { admissionDelay, experimentLimits } from './requestBudget'

const directory = new URL('../../../../test_prompt/turnClassifierPoc/', import.meta.url)
const source = readFileSync(new URL('generativeRequirementsScenarios.json', directory), 'utf8')
const instruction = readFileSync(new URL('generativeRequirementsPrompt.txt', directory), 'utf8')
// The complex response_format json_schema was rejected before inference.
// This separately named run uses JSON-object transport plus the same explicit
// contract in the prompt. Runtime validation remains strict; there is no live
// retry/fallback or relaxed acceptance of invalid responses.
const prompt = `${instruction}\n輸出 JSON schema：${JSON.stringify(responseFormat.json_schema.schema)}`
const outputFormat = { type: 'json_object' } as const
const frozen: { turns: Scenario[] } = JSON.parse(source)
// Reorder only: preserve all gold, prompts and cases while measuring previously
// unmeasured compound/context turns before the simple prefix. IDs preserve pairing.
const priorityIds = ['g13', 'g12', 'g16', 'g17', 'g14', 'g15', 'g20', 'g18', 'g21', 'g24', 'g29', 'g30', 'g31', 'g32', 'g35', 'g40']
const orderedTurns = [...priorityIds.map(id => frozen.turns.find(turn => turn.id === id)!), ...frozen.turns.filter(turn => !priorityIds.includes(turn.id))]
const requestedModel = process.env.GENERATIVE_REQUIREMENTS_MODEL
if (requestedModel !== 'models/gemma-4-26b-a4b-it')
  throw new Error('This paced experiment requires explicit models/gemma-4-26b-a4b-it selection; its quotas are not assumed for other models')
const catalogSource = readFileSync(new URL('../../../../周氏蝦捲菜單_v2.json', import.meta.url), 'utf8')
const catalog: {
  categories: Array<{ id: string, name: string }>
  items: Array<Omit<MenuFact, 'category'> & { categoryId: string }>
} = JSON.parse(catalogSource)
const menu = catalog.items.map(item => ({ ...item, category: catalog.categories.find(category => category.id === item.categoryId)!.name }))
const runLabel = process.env.GENERATIVE_REQUIREMENTS_RUN ?? ''
if (runLabel && !/^[a-z0-9-]{1,40}$/.test(runLabel))
  throw new Error('Run labels must be short lowercase alphanumeric names')
const stem = `generativeRequirements${runLabel ? `-${runLabel}` : ''}`
const replayPath = new URL(`results/${stem}Replay.jsonl`, directory)
const summaryPath = new URL(`results/${stem}Summary.json`, directory)
const reportPath = new URL(`${stem}Report.md`, directory)

// Live mode requires explicit opt-in. No customer DB/transcripts are queried,
// no profile is applied, and no production router/tools/session is invoked.
if (process.env.GENERATIVE_REQUIREMENTS_LIVE !== '1')
  throw new Error('Set GENERATIVE_REQUIREMENTS_LIVE=1 to send the frozen synthetic cases')
if ([replayPath, summaryPath, reportPath].some(path => existsSync(path)))
  throw new Error('Refusing to replace the first recorded run; use separate artifact paths for another experiment')
if (!process.env.REDIS_URL || !process.env.LLM_ROUTER_MASTER_KEY)
  throw new Error('Run with the Server environment; credentials are never printed or saved')

const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 4000, retryStrategy: () => null })
redis.on('error', () => {})
let key: Buffer | undefined
let replay: number | undefined
const observations: Array<{
  id: string
  group: string
  latency_ms: number
  status: 'OK' | 'HTTP_ERROR' | 'NETWORK_OR_TIMEOUT'
  httpStatus?: number
  providerModel?: string
  finishReason?: string
  content?: string
  usage?: unknown
  countedInputTokens?: number
  reservedInputTokens?: number
  quotaWait_ms?: number
  countLatency_ms?: number
  assessment?: ReturnType<typeof assess>
  feasibility?: ReturnType<typeof inspectFeasibility>
}> = []
let stopped = false

async function run() {
  try {
    await redis.connect()
    const config = createConfigKVService(redis)
    const runtime = await config.getOptional('WEBNAVIOR_AI_RUNTIME_CONFIG')
    const router = await config.getOptional('LLM_ROUTER_CONFIG')
    const upstreams = runtime?.chatModel ? router?.llm.models[runtime.chatModel]?.upstreams : undefined
    // Do not silently select a different model/provider or emulate router fallback.
    if (!upstreams || upstreams.length !== 1)
      throw new Error('Experiment requires one explicitly configured chat upstream')
    const upstream = upstreams[0]!
    const endpoint = new URL(`${upstream.baseURL.replace(/\/$/, '')}/chat/completions`)
    if (endpoint.hostname !== 'generativelanguage.googleapis.com' || upstream.keys.length !== 1)
      throw new Error('Configured chat upstream is not the approved single-key Google endpoint')
    const model = requestedModel
    const crypto = createEnvelopeCrypto({
      masterKey: Buffer.from(process.env.LLM_ROUTER_MASTER_KEY, 'base64'),
      ...(process.env.LLM_ROUTER_MASTER_KEY_PREVIOUS ? { previousMasterKey: Buffer.from(process.env.LLM_ROUTER_MASTER_KEY_PREVIOUS, 'base64') } : {}),
    })
    key = crypto.decryptKey(upstream.keys[0]!.ciphertext, { modelName: runtime!.chatModel!, keyEntryId: upstream.keys[0]!.id })
    const authorization = (upstream.headerTemplate ?? 'Bearer {KEY}').replace('{KEY}', key.toString('utf8'))
    const metadata = {
      model,
      configuredProductionModel: upstream.overrideModel,
      endpoint: endpoint.toString(),
      runtimeAlias: runtime!.chatModel,
      datasetSha256: createHash('sha256').update(source).digest('hex'),
      promptSha256: createHash('sha256').update(prompt).digest('hex'),
      baseInstructionSha256: createHash('sha256').update(instruction).digest('hex'),
      systemInstructions: prompt,
      catalogSha256: createHash('sha256').update(catalogSource).digest('hex'),
      responseSchemaSha256: createHash('sha256').update(JSON.stringify(responseFormat)).digest('hex'),
      startedAt: new Date().toISOString(),
      count: frozen.turns.length,
      order: orderedTurns.map(turn => turn.id),
      quota: { user: { rpm: 30, tpm: 16_000, rpd: 14_400 }, effective: experimentLimits, sharedProjectUsage: 'unknown; stop on429', tokenCountSafetyMargin: 128 },
      requestSettings: { stream: false, temperature: 0, max_tokens: 2048, timeoutMs: 60_000, response_format: outputFormat },
      thinking: 'provider default, unchanged; residency/cold start unknown',
      tools: 'none',
      goldSent: false,
      menuSent: false,
      productionWrites: false,
    }
    replay = openSync(replayPath, 'wx')
    appendFileSync(replay, `${JSON.stringify({ type: 'metadata', ...metadata })}\n`)
    console.info(JSON.stringify({ model: metadata.model, cases: metadata.count, tools: 'none' }))
    const reservations: Reservation[] = []
    // Budget both countTokens and generation dispatches for RPM. Tokenizer
    // preflight mirrors the two text messages;128 tokens cover wire conversion
    // overhead. Actual provider usage is checked against that reservation.
    const admit = async (inputTokens: number) => {
      let waited = 0
      let delay = admissionDelay(reservations, inputTokens, Date.now())
      if (delay)
        console.info(JSON.stringify({ quotaWait_ms: delay }))
      while (delay) {
        const chunk = Math.min(delay, 15_000)
        await new Promise<void>(resolve => setTimeout(resolve, chunk))
        waited += chunk
        delay = admissionDelay(reservations, inputTokens, Date.now())
      }
      reservations.push({ at: Date.now(), inputTokens })
      return waited
    }
    let consecutiveFailures = 0
    for (const scenario of orderedTurns) {
      let quotaWait = await admit(0)
      const countStart = performance.now()
      const countResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/${model}:countTokens`, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key.toString('utf8') },
        body: JSON.stringify({ generateContentRequest: {
          model,
          systemInstruction: { parts: [{ text: prompt }] },
          contents: [{ role: 'user', parts: [{ text: JSON.stringify(createInput(scenario)) }] }],
        } }),
      })
      const countLatency = performance.now() - countStart
      if (!countResponse.ok) {
        await countResponse.body?.cancel()
        appendFileSync(replay, `${JSON.stringify({ type: 'preflight-failure', id: scenario.id, httpStatus: countResponse.status })}\n`)
        console.info(JSON.stringify({ id: scenario.id, countStatus: countResponse.status, stopped: true }))
        stopped = true
        break
      }
      const countData = await countResponse.json() as { totalTokens?: number }
      if (!Number.isInteger(countData.totalTokens) || (countData.totalTokens ?? 0) <= 0)
        throw new Error('Provider returned no reliable input token count')
      const countedInputTokens = countData.totalTokens!
      const reservedInputTokens = countedInputTokens + 128
      quotaWait += await admit(reservedInputTokens)
      const start = performance.now()
      let observation: typeof observations[number]
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          signal: AbortSignal.timeout(60_000),
          headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
          body: JSON.stringify({
            model,
            stream: false,
            temperature: 0,
            max_tokens: 2048,
            response_format: outputFormat,
            messages: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(createInput(scenario)) }],
          }),
        })
        if (!response.ok) {
          // Error bodies can echo request/credential details. Save only status;
          // do not retry with relaxed output constraints or a different prompt.
          await response.body?.cancel()
          observation = { id: scenario.id, group: scenario.group, latency_ms: performance.now() - start, status: 'HTTP_ERROR', httpStatus: response.status }
        }
        else {
          const data = await response.json() as { model?: string, usage?: { prompt_tokens?: number }, choices?: Array<{ finish_reason?: string, message?: { content?: string } }> }
          const content = data.choices?.[0]?.message?.content ?? ''
          const parsed = parseProposal(content, scenario.utterance)
          observation = {
            id: scenario.id,
            group: scenario.group,
            latency_ms: performance.now() - start,
            status: 'OK',
            providerModel: data.model,
            finishReason: data.choices?.[0]?.finish_reason,
            content,
            usage: data.usage,
            assessment: assess(scenario, content),
            ...(parsed.valid ? { feasibility: inspectFeasibility(parsed.proposal, menu) } : {}),
          }
          if ((data.usage?.prompt_tokens ?? 0) > reservedInputTokens) {
            stopped = true
            console.info('Input token reservation underestimated; stop rather than continue beyond the budget.')
          }
        }
      }
      catch {
        observation = { id: scenario.id, group: scenario.group, latency_ms: performance.now() - start, status: 'NETWORK_OR_TIMEOUT' }
      }
      observation = { ...observation, countedInputTokens, reservedInputTokens, quotaWait_ms: quotaWait, countLatency_ms: countLatency }
      observations.push(observation)
      appendFileSync(replay, `${JSON.stringify({ type: 'observation', input: createInput(scenario), ...observation })}\n`)
      console.info(JSON.stringify({ id: scenario.id, status: observation.status, exact: observation.assessment?.exact, differences: observation.assessment?.differences, latency_ms: Math.round(observation.latency_ms) }))
      consecutiveFailures = observation.status === 'OK' ? 0 : consecutiveFailures + 1
      if (stopped || consecutiveFailures >= 3 || (observation.httpStatus && [400, 401, 403, 404, 429].includes(observation.httpStatus))) {
        stopped = true
        break
      }
    }
    const complete = !stopped && observations.length === frozen.turns.length
    const successful = observations.filter(item => item.status === 'OK')
    const exact = successful.filter(item => item.assessment?.exact).length
    const valid = successful.filter(item => item.assessment?.valid).length
    const matched = successful.reduce((total, item) => total + item.assessment!.matched, 0)
    // Provider failures count as missing coverage across the entire frozen set,
    // rather than disappearing from the recall/whole-turn denominator.
    const expected = frozen.turns.reduce((total, item) => total + item.expected.length, 0)
    const actual = successful.reduce((total, item) => total + item.assessment!.actualCount, 0)
    const times = successful.map(item => item.latency_ms).sort((a, b) => a - b)
    const groups = Object.fromEntries([...new Set(frozen.turns.map(item => item.group))].map(group => [group, {
      total: frozen.turns.filter(item => item.group === group).length,
      measured: observations.filter(item => item.group === group).length,
      exact: observations.filter(item => item.group === group && item.assessment?.exact).length,
    }]))
    const summary = {
      metadata,
      complete,
      stopped,
      attempted: observations.length,
      successful: successful.length,
      apiDispatches: reservations.length,
      reservedInputTokens: reservations.reduce((sum, item) => sum + item.inputTokens, 0),
      totalQuotaWait_ms: observations.reduce((sum, item) => sum + (item.quotaWait_ms ?? 0), 0),
      schemaAndLiteralValid: valid,
      exactTurns: exact,
      totalTurns: frozen.turns.length,
      requirementMatched: matched,
      requirementExpected: expected,
      requirementProduced: actual,
      precision: actual ? matched / actual : 0,
      recall: matched / expected,
      latency_ms: {
        mean: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
        p50: times.length ? times[Math.ceil(times.length * 0.5) - 1] : null,
        p95: times.length ? times[Math.ceil(times.length * 0.95) - 1] : null,
        firstRequest: observations[0]?.latency_ms ?? null,
      },
      groups,
      failures: observations.filter(item => !item.assessment?.exact).map(item => ({ id: item.id, status: item.status, differences: item.assessment?.differences })),
      limitations: [
        'New extraction prompt and schema, not the existing Main Agent prompt/tool loop.',
        'Forty synthetic challenge turns, not traffic accuracy or production safety.',
        'Single sample per turn, no stability test, no same-model judge or retuning.',
        'Literal evidence/schema validity is not semantic correctness; authored gold measures fields.',
        'No domain-plan execution, ASR, session lifecycle, tool receipts, checkout/payment or UI tested.',
        'No comparable Jev run on this schema; prior finite-question results are a different experiment.',
        'Remote HTTP latency only. Memory, actual cold start and end-to-end latency not measured.',
      ],
    }
    appendFileSync(replay, `${JSON.stringify({ type: 'completion', complete, stopped, attempted: observations.length })}\n`)
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' })
    const report = [
      '# Generative requirements extraction — independent Google model experiment',
      '',
      `Model: \`${metadata.model}\`; returned models: ${[...new Set(successful.map(item => item.providerModel))].join(', ')}.`,
      '',
      `Complete: ${complete}. Attempted ${observations.length}/${frozen.turns.length}; successful HTTP responses ${successful.length}.`,
      `Schema + literal evidence valid ${valid}/${frozen.turns.length}; whole-turn semantic-field exact ${exact}/${frozen.turns.length}.`,
      `Requirement multiset precision ${summary.precision.toFixed(4)}, recall ${summary.recall.toFixed(4)} (${matched} matched / ${expected} gold / ${actual} produced).`,
      '',
      `HTTP mean ${summary.latency_ms.mean?.toFixed(1) ?? 'N/A'}ms, P50 ${summary.latency_ms.p50?.toFixed(1) ?? 'N/A'}ms, P95 ${summary.latency_ms.p95?.toFixed(1) ?? 'N/A'}ms.`,
      `First call ${summary.latency_ms.firstRequest?.toFixed(1) ?? 'N/A'}ms is not a proven cold start.`,
      '',
      '## Frozen subgroup results',
      '',
      '| Group | Exact / total |',
      '| --- | --- |',
      ...Object.entries(groups).map(([group, counts]) => `| ${group} | ${counts.exact}/${counts.total} |`),
      '',
      '## Failures to inspect',
      '',
      ...summary.failures.map(item => `- ${item.id}: ${item.status}; ${item.differences?.join(', ') ?? 'no usable proposal'}`),
      '',
      '## Limits and artifacts',
      '',
      ...summary.limitations.map(item => `- ${item}`),
      '',
      'Inputs/prompt/schema hashes and request settings are recorded before inference. No gold/menu facts sent. No production settings changed, no tool definitions, no action authorization. No retries or prompt adaptation within the frozen run.',
      '',
      `[Frozen scenarios](./generativeRequirementsScenarios.json), [prompt](./generativeRequirementsPrompt.txt), [raw evidence](./results/${stem}Replay.jsonl), [summary](./results/${stem}Summary.json).`,
      '',
      'Transport: JSON-object mode with an explicit schema in system instructions and strict application validation. Earlier complex schema requests were HTTP400 (not semantic failures); no schema-constrained output guarantee is claimed for this run. [Google OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai).',
      '',
    ].join('\n')
    writeFileSync(reportPath, report, { flag: 'wx' })
    console.info(JSON.stringify({ complete, exactTurns: exact, totalTurns: frozen.turns.length, summary: summaryPath.pathname }))
  }
  finally {
    key?.fill(0)
    if (replay !== undefined)
      closeSync(replay)
    redis.disconnect()
  }
}

run().catch(() => {
  // Network/crypto errors can contain confidential connection details. The
  // recorded status and completed rows are sufficient for a safe handoff.
  console.error('Benchmark stopped before completion; inspect preserved artifacts and Server configuration.')
  process.exitCode = 1
})
