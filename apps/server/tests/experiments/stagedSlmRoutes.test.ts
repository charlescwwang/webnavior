import type { KioskDecisionState } from '../../src/services/domain/kiosk-interaction-decision'
import type { DecisionConversation } from '../../src/services/domain/kiosk-interaction-decision/context'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

import { eq } from 'drizzle-orm'
import { array, literal, object, parse, record, string } from 'valibot'
import { expect, it } from 'vitest'

import { createDrizzle } from '../../src/libs/db'
import { mockDB } from '../../src/libs/mock-db'
import { decideInteraction } from '../../src/services/domain/kiosk-interaction-decision'
import { createKioskSystemOneService } from '../../src/services/domain/kiosk-system-one'
import { createEnvelopeCrypto } from '../../src/utils/envelope-crypto'

import * as schema from '../../src/schemas'

const archiveSchema = object({ id: string(), text: string(), expected: string(), family: string(), decision: object({ trace: object({ exchanges: array(object({ state: string(), questions: record(string(), object({ type: literal('choice'), instructions: string(), criteria: record(string(), string()) })) })) }) }) })
const resolverSchema = object({
  questions: record(string(), object({ type: literal('choice'), instructions: string(), criteria: record(string(), string()) })),
  cases: array(object({ caseId: string(), text: string(), state: string(), accepted: array(string()), group: string(), question: string() })),
})

function replayContext(state: string) {
  const lines = state.split('\n')
  function value<T>(prefix: string): T | undefined {
    const line = lines.find(line => line.startsWith(prefix))
    return line ? JSON.parse(line.slice(prefix.length)) as T : undefined
  }
  const phase = lines.find(line => line.startsWith('目前 phase：'))?.slice('目前 phase：'.length) ?? 'ordering'
  const waitingFor = value<KioskDecisionState['waitingFor']>('正在等待回答的問題：')
  const decisionState: KioskDecisionState = {
    phase,
    waitingFor: waitingFor ? { ...waitingFor, expiresAt: Date.now() + 60_000 } : undefined,
    interactionState: value('互動焦點：'),
    references: value('真實 domain references：'),
    productResolution: value('本句商品名稱證據（possible 不是已確認 target）：'),
    catalogEvidence: value('本句菜單匹配來源（name 是品名、alias 是店家別名、fragment 只是可能片段；分類項數不等於顧客指定品名）：'),
    fulfillmentModes: value('POS 提供的用餐方式：'),
    activeRequest: value('進行中需求：'),
  }
  // An empty archived {} is not an active request. Opaque original ticket IDs
  // are retained, but expiry is refreshed to replay the recorded live question.
  if (decisionState.activeRequest && !decisionState.activeRequest.stage)
    decisionState.activeRequest = undefined
  const conversation: DecisionConversation = { messages: value('近期角色標記對話：') ?? [] }
  return { decisionState, conversation }
}

it.skipIf(process.env.KIOSK_STAGED_SLM_ROUTES !== '1')('replays every archived route case through the production SLM adapter and staged decision tree', async () => {
  const source = process.env.KIOSK_STAGED_ROUTE_SOURCE ?? 'partition'
  const engine = process.env.KIOSK_STAGED_ENGINE ?? 'slm'
  if (!['slm', 'jev'].includes(engine))
    throw new Error('Unknown decision engine')
  if (!['partition', 'resolver'].includes(source))
    throw new Error('Unknown archived route source')
  const raw = readFileSync(source === 'partition' ? new URL('../../../../test_prompt/turnClassifierPoc/results/partition-frozen44.jsonl', import.meta.url) : '/tmp/webnavior-full-coverage-manifest.json', 'utf8')
  const resolver = source === 'resolver' ? parse(resolverSchema, JSON.parse(raw)) : undefined
  const cases = resolver
    ? resolver.cases.filter(row => row.group === 'resolver').map(row => ({ id: row.caseId, text: row.text, expected: row.accepted[0]!, family: 'resolver', decision: { trace: { exchanges: [{ state: row.state, questions: { route: resolver.questions[row.question]! } }] } } }))
    : raw.trim().split('\n').map(line => JSON.parse(line)).filter(row => row.mode === 'baseline').map(row => parse(archiveSchema, row))
  expect(cases).toHaveLength(source === 'partition' ? 44 : 40)
  const baseURL = process.env.KIOSK_SLM_URL ?? 'http://127.0.0.1:12434/engines/v1'
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname))
    throw new Error('This replay is limited to a local model endpoint')
  let modelId = process.env.KIOSK_SLM_MODEL ?? 'huggingface.co/unsloth/qwen3.5-4b-gguf:latest'
  const policyHash = createHash('sha256').update(['../../src/services/domain/kiosk-interaction-decision/routing.ts', '../../src/services/domain/kiosk-interaction-decision/prompt.ts', '../../src/services/domain/kiosk-system-one/slm.ts', '../../src/services/domain/kiosk-system-one/index.ts'].map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n')).digest('hex')
  let requests = 0
  const db = await mockDB(schema)
  const live = engine === 'jev' ? createDrizzle({ DATABASE_URL: process.env.DATABASE_URL!, DB_POOL_MAX: 1, DB_POOL_CONNECTION_TIMEOUT_MS: 5000 }) : undefined
  let active: schema.KioskSystemOneProfile | undefined
  if (live) {
    try {
      active = await live.db.query.kioskSystemOneProfiles.findFirst({ where: eq(schema.kioskSystemOneProfiles.isActive, true) })
      if (!active || active.implementation === 'slm')
        throw new Error('No configured active Jev profile to test')
      modelId = active.modelId
      // Read the deployed profile only, then use an isolated copy. No active
      // selection, policy, readiness or encrypted credentials are written back.
      await db.insert(schema.kioskSystemOneProfiles).values({ ...active, verifiedAt: new Date() })
    }
    finally {
      await live.pool.end()
    }
  }
  const provider = createKioskSystemOneService({ db, envelopeCrypto: createEnvelopeCrypto({ masterKey: engine === 'jev' ? Buffer.from(process.env.LLM_ROUTER_MASTER_KEY!, 'base64') : Buffer.alloc(32, 8) }), traceObserver: { record: trace => process.stdout.write(`[staged-provider] ${JSON.stringify(trace)}\n`) }, fetchImpl: async (url, init) => {
    requests++
    return fetch(url, init)
  } })
  const profile = active ?? await provider.save({ implementation: 'slm', baseURL, modelId, name: 'Isolated route replay', timeoutMs: 35_000 })
  const manifest = cases.map((test) => {
    const root = test.decision.trace.exchanges.find(exchange => exchange.questions.route)!
    const candidates = Object.entries(root.questions.route!.criteria).filter(([id]) => id.startsWith('intent:')).map(([id, description]) => ({ id, description }))
    const accepted = test.family === 'compound' ? ['MULTI_ACTION', 'NEEDS_ASSISTANT'] : [test.expected]
    const applicationGap = accepted.every(id => id.startsWith('intent:') && !candidates.some(candidate => candidate.id === id))
    return { id: test.id, text: test.text, accepted, applicationGap, candidates, ...replayContext(root.state) }
  })
  process.stdout.write(`[staged-routes-frozen] ${JSON.stringify({ sourceHash: createHash('sha256').update(raw).digest('hex'), manifest, modelId, scope: `All ${cases.length} ${source} route records; refreshed question deadlines, no original browser/ASR replay, no Main or order execution. Original route gold preserved.` })}\n`)
  await provider.readiness(profile.id)
  await provider.activate(profile.id)
  const started = Date.now()
  const rows = []
  for (const test of manifest) {
    const waitingFor = test.decisionState.waitingFor
    const decisionState = { ...test.decisionState, waitingFor: waitingFor ? { ...waitingFor, expiresAt: Date.now() + 60_000 } : undefined }
    const decision = await decideInteraction({ ...test, decisionState, transcript: test.text, policy: { decisionInstruction: '', storeInstruction: '' }, routing: 'staged', invoke: provider.decide, includeTrace: true })
    const observed = decision.kind === 'FAST_ACTION' ? decision.actionId : decision.kind
    const correct = test.accepted.some(expected => expected === observed || (expected === 'MULTI_ACTION' && observed === 'NEEDS_ASSISTANT'))
    const row = { id: test.id, accepted: test.accepted, observed, status: test.applicationGap ? 'APPLICATION_GAP' : correct ? 'MATCH' : 'MISMATCH', questions: decision.modelQuestions }
    rows.push(row)
    process.stdout.write(`[staged-routes-raw] ${JSON.stringify({ ...row, decision })}\n`)
  }
  const summary = { engine, source, cases: cases.length, actualRequests: requests, elapsedMs: Date.now() - started, modelId, policyHash, sourceHash: createHash('sha256').update(raw).digest('hex'), scope: 'Staged routing labels only; no Main, browser action, ASR or field acceptance.', fieldAcceptance: false, rows }
  writeFileSync(process.env.KIOSK_STAGED_ROUTES_SUMMARY ?? '/tmp/webnavior-staged-slm-routes-summary.json', `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  process.stdout.write(`[staged-routes-summary] ${JSON.stringify(summary)}\n`)
  expect(rows).toHaveLength(cases.length)
  // Semantic mismatches deliberately fail this live suite after every case has
  // run. Never select only failed examples, edit gold, or hide the application gap.
  expect(rows.filter(row => row.status === 'MISMATCH')).toEqual([])
}, 15 * 60_000)
