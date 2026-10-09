import type { KioskActionCandidate, KioskDecisionState } from '../../src/services/domain/kiosk-interaction-decision'
import type { HonoEnv } from '../../src/types/hono'
import type { Fixture } from './assistantFixture'

import { createHash } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs'

import { errorMessageFrom } from '@moeru/std'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import { mockDB } from '../../src/libs/mock-db'
import { createKioskRoutes } from '../../src/routes/kiosk'
import { createKioskService } from '../../src/services/domain/kiosk'
import { decideInteraction } from '../../src/services/domain/kiosk-interaction-decision'
import { applyProposal, cases, envelope, menu, prepare } from './assistantFixture'
import { openProvider } from './assistantProvider'
import { parseProposal, responseFormat } from './generativeRequirements'

import * as schema from '../../src/schemas'

const directory = new URL('../../../../test_prompt/turnClassifierPoc/', import.meta.url)
const prompt = `${readFileSync(new URL('generativeRequirementsPrompt.txt', directory), 'utf8')}\n輸出 JSON schema：${JSON.stringify(responseFormat.json_schema.schema)}`
const modes = ['jev-front', 'proposal', 'tool-agent']

function selectModes(value: string | undefined) {
  const selected = value === undefined ? modes : value.split(',')
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(mode => !modes.includes(mode)))
    throw new Error('Explicit modes must be unique comparison modes')
  return selected
}

async function stateOf(fixture: Fixture) {
  const cart = await fixture.cart()
  const items: Record<string, number> = {}
  for (const line of cart.lines)
    items[line.itemId] = (items[line.itemId] ?? 0) + line.quantity
  return { items, cart, state: await fixture.state(), party: fixture.seating().partySize, paymentAttempts: fixture.paymentAttempts() }
}

describe('synthetic assistant comparison contracts', () => {
  it('selects independent frozen arms without admitting unknown or duplicate modes', () => {
    expect(selectModes(undefined)).toEqual(['jev-front', 'proposal', 'tool-agent'])
    expect(selectModes('jev-front')).toEqual(['jev-front'])
    expect(selectModes('proposal,tool-agent')).toEqual(['proposal', 'tool-agent'])
    expect(() => selectModes('')).toThrow('Explicit modes')
    expect(() => selectModes('proposal,proposal')).toThrow('Explicit modes')
    expect(() => selectModes('other')).toThrow('Explicit modes')
  })
  it('freezes16 distinct turns and forbids payment in all setups', async () => {
    expect(cases).toHaveLength(16)
    expect(new Set(cases.map(row => row.id)).size).toBe(16)
    for (const row of cases) {
      const fixture = await prepare(row)
      expect(fixture.paymentAttempts()).toBe(0)
    }
  })
  it('binds two explicit demands and applies the real domain guards', async () => {
    const fixture = await prepare(cases[8])
    const proposal = { requirements: ['牛肉麵', '排骨便當'].map((targetRaw, index) => ({ source: index ? '還要一個排骨便當' : '牛肉麵一碗', effect: 'ADD' as const, targetRaw, replacementRaw: null, quantity: 1, conditions: [], queryTopics: [], contextRequired: false, value: null })), unresolved: [], summaryCount: null }
    const result = await applyProposal(fixture, proposal)
    expect(result.blocked).toEqual([])
    expect((await stateOf(fixture)).items).toEqual({ noodle: 1, bento: 1 })
  })
  it('blocks all writes before applying a proposal with unsupported customization', async () => {
    const fixture = await prepare(cases[9])
    const atom = { source: '一碗牛肉麵小辣', effect: 'ADD' as const, targetRaw: '牛肉麵', replacementRaw: null, quantity: 1, conditions: ['小辣'], queryTopics: [], contextRequired: false, value: null }
    const result = await applyProposal(fixture, { requirements: [atom, { ...atom, source: '一個排骨便當', targetRaw: '排骨便當', conditions: [] }], unresolved: [], summaryCount: null })
    expect(result.executed).toBe(false)
    expect((await stateOf(fixture)).items).toEqual({})
  })
  it('prebinds both sides of replacement and does not invent a nonexistent replacement', async () => {
    const fixture = await prepare(cases[10])
    const result = await applyProposal(fixture, { requirements: [{ source: cases[10].text, effect: 'REPLACE', targetRaw: '排骨便當', replacementRaw: '炒鱔魚意麵', quantity: 1, conditions: [], queryTopics: [], contextRequired: false, value: null }], unresolved: [], summaryCount: null })
    expect(result.blocked.length).toBeGreaterThan(0)
    expect((await stateOf(fixture)).items).toEqual({ bento: 1 })
  })
  it('does not let contextual execution bypass unresolved whole-demand evidence', async () => {
    const fixture = await prepare(cases[1])
    const result = await applyProposal(fixture, { requirements: [{ source: cases[1].text, effect: 'ADD', targetRaw: '麵', replacementRaw: null, quantity: 1, conditions: [], queryTopics: [], contextRequired: false, value: null }], unresolved: ['我想吃麵'], summaryCount: null })
    expect(result.executed).toBe(false)
    expect((await stateOf(fixture)).items).toEqual({})
  })
  it('retains a real presented party question across an informational aside', async () => {
    const fixture = await prepare(cases[5])
    expect((await fixture.state()).waitingFor?.purpose).toBe('party-size')
    expect(fixture.history.at(-1)?.content).toBe('好的，已保留內用設定。')
  })
  it('records a real cart mutation before a later provider failure without replaying it', async () => {
    const recorded: unknown[] = []
    const fixture = await prepare(cases[3], receipt => recorded.push(receipt))
    const db = await mockDB(schema)
    const app = new Hono<HonoEnv>().onError((_error, c) => c.json({ error: 'PROVIDER_FAILURE' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), runtimeModelPolicy: { modelFor: async () => 'offline-failure' }, llmGateway: { complete: async () => {
      throw new Error('Artificial connection failure after tool execution')
    } } }))
    const registration = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"registrationCode":"483920"}' })
    const headers = { 'Content-Type': 'application/json', 'Cookie': registration.headers.get('Set-Cookie')!.split(';')[0]! }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: '{"serviceId":"development-ordering-service"}' })
    const { session } = await started.json() as { session: { id: string } }
    await fixture.call('menu_get', { query: '排骨便當', display: false })
    const result = await fixture.call('order_add_item', { itemId: 'bento', quantity: 1 })
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ toolResults: [{ name: 'order_add_item', toolCallId: 'added-bento', content: JSON.stringify(result) }] }) })
    expect(response.status).toBe(500)
    expect(recorded).toHaveLength(2)
    expect(recorded[1]).toMatchObject({ name: 'order_add_item', result: { cart: { itemCount: 1 } } })
    expect((await stateOf(fixture)).items).toEqual({ bento: 1 })
    expect(fixture.receipts.filter(receipt => receipt.name === 'order_add_item')).toHaveLength(1)
  })
  it('uses the real route prompt builder and round-trips actual tool results in a scratch session', async () => {
    const db = await mockDB(schema)
    const fixture = await prepare(cases[2])
    const requests: Record<string, unknown>[] = []
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), runtimeModelPolicy: { modelFor: async () => 'test-only' }, llmGateway: { complete: async ({ body }) => {
      requests.push(body)
      return Response.json({ choices: [{ message: requests.length === 1 ? { tool_calls: [{ id: 'read-menu', type: 'function', function: { name: 'menu_get', arguments: '{"query":"牛肉麵"}' } }] } : { content: '有紅燒牛肉麵。' } }] })
    } } }))
    const registration = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"registrationCode":"483920"}' })
    expect(registration.status).toBe(201)
    const headers = { 'Content-Type': 'application/json', 'Cookie': registration.headers.get('Set-Cookie')!.split(';')[0]! }
    const sessionResponse = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: '{"serviceId":"development-ordering-service"}' })
    const { session } = await sessionResponse.json() as { session: { id: string } }
    const tools = fixture.runtime.toolDefinitions.filter(definition => !definition.name.startsWith('kiosk_')).map(definition => ({ type: 'function', function: { name: definition.name, description: definition.description, parameters: definition.inputSchema } }))
    const first = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: cases[2].text, tools, decisionState: await fixture.state() }) })
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ toolCalls: [{ id: 'read-menu' }] })
    const receipt = await fixture.call('menu_get', { query: '牛肉麵' })
    const second = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ tools, decisionState: await fixture.state(), toolResults: [{ name: 'menu_get', toolCallId: 'read-menu', content: JSON.stringify(receipt) }] }) })
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ answer: '有紅燒牛肉麵。', toolCalls: [] })
    const messages = requests[1]!.messages as Array<{ role: string, content?: string, tool_call_id?: string }>
    expect(messages[0]!.content).toContain('顧客回覆與操作問題分界')
    expect(messages.some(message => message.role === 'tool' && message.tool_call_id === 'read-menu')).toBe(true)
    expect((await stateOf(fixture)).items).toEqual({})
  })
})

describe.skipIf(process.env.ASSISTANT_COMPARISON_LIVE !== '1')('live actual prompt and isolated tool-loop comparison', () => {
  it('records bounded Jev, advisory Gemma binding and actual Main Agent prompt construction separately', async () => {
    const label = process.env.ASSISTANT_COMPARISON_RUN ?? ''
    if (!/^[a-z0-9-]{1,40}$/.test(label))
      throw new Error('Unique lowercase ASSISTANT_COMPARISON_RUN required')
    const path = new URL(`results/assistant-${label}.jsonl`, directory)
    const summaryPath = new URL(`results/assistant-${label}Summary.json`, directory)
    if ([path, summaryPath].some(file => existsSync(file)))
      throw new Error('Never replace a recorded run')
    const ids = process.env.ASSISTANT_COMPARISON_CASE_IDS?.split(',')
    const startId = process.env.ASSISTANT_COMPARISON_START_ID
    if (ids && startId)
      throw new Error('Choose either explicit case IDs or a suffix, not both')
    if (ids && (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !cases.some(row => row.id === id))))
      throw new Error('Explicit IDs must be unique frozen case IDs')
    if (startId && !cases.some(row => row.id === startId))
      throw new Error('Subset start ID must exist in the frozen cases')
    // Ordering only: gold, utterance, model prompts and operation policy stay
    // frozen. Prioritize unmeasured hard turns before another transport failure.
    const selectedCases = ids ? ids.map(id => cases.find(row => row.id === id)!) : startId ? cases.slice(cases.findIndex(row => row.id === startId)) : cases
    const selectedModes = selectModes(process.env.ASSISTANT_COMPARISON_MODES)
    const userRetry = process.env.ASSISTANT_COMPARISON_USER_RETRY === '1'
    const file = openSync(path, 'wx')
    const record = (row: Record<string, unknown>) => appendFileSync(file, `${JSON.stringify(row)}\n`)
    const rows: Array<Record<string, unknown>> = []
    let provider: Awaited<ReturnType<typeof openProvider>> | undefined
    let currentTag = ''
    let stoppedReason: string | undefined
    let inFlight: { fixture: Fixture, before: Awaited<ReturnType<typeof stateOf>>, startedAt: number } | undefined
    record({ type: 'metadata', startedAt: new Date().toISOString(), userRetry, cases, menu, datasetSha256: createHash('sha256').update(JSON.stringify(cases)).digest('hex'), proposalPromptSha256: createHash('sha256').update(prompt).digest('hex'), sourceHashes: Object.fromEntries(['assistantFixture.ts', 'assistantComparison.test.ts', '../../src/routes/kiosk/index.ts', '../../../order-menu/src/webmcp.ts', '../../src/services/domain/kiosk-interaction-decision/prompt.ts'].map(name => [name, createHash('sha256').update(readFileSync(new URL(name, import.meta.url))).digest('hex')])), scope: 'Synthetic cases only; real code-default Jev front path, experimental literal binder, actual Main Agent prompt builder using scratch development profile; no production profile writes/real sessions/UI/POS; gold stays local; max4 agent model rounds; no automatic retries/tuning.' })
    try {
      // A human-requested rerun starts fresh synthetic runtimes below; it never
      // resumes a possibly mutated session or replaces the original evidence.
      record({ type: 'subset', selectedIds: selectedCases.map(row => row.id), selectedModes, source: userRetry ? 'Explicit user-authorized service retry in fresh synthetic runtimes; original failures and scores retained' : 'Explicit selection of previously unmeasured case/arm pairs, not a retry/rescore' })
      // The arms have independent runtimes. A Jev-only slice must not require
      // Google credentials or let its transport failure prevent measurement.
      if (selectedModes.some(mode => mode !== 'jev-front'))
        provider = await openProvider(record)
      const db = await mockDB(schema)
      const app = new Hono<HonoEnv>().onError((error, c) => {
        record({ type: 'scratch-route-error', tag: currentTag, message: errorMessageFrom(error), cause: error.cause instanceof Error ? error.cause.message : undefined })
        return c.json({ error: 'SCRATCH_ROUTE_ERROR' }, 500)
      }).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, kioskService: createKioskService(db), secureCookies: false, runtimeModelPolicy: { modelFor: async () => 'test-only-gemma' }, llmGateway: { complete: async ({ body }) => await provider!.complete(body, currentTag) } }))
      const registered = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
      expect(registered.status).toBe(201)
      const headers = { 'Content-Type': 'application/json', 'Cookie': registered.headers.get('Set-Cookie')!.split(';')[0]! }
      for (const testCase of selectedCases) {
        // Rotate mode order to reduce systematic first/last-provider timing bias.
        const rotation = Number(testCase.id.slice(1)) % 3
        for (const mode of [...modes.slice(rotation), ...modes.slice(0, rotation)].filter(mode => selectedModes.includes(mode))) {
          currentTag = `${testCase.id}/${mode}`
          console.info(JSON.stringify({ start: currentTag }))
          const fixture = await prepare(testCase, receipt => record({ type: 'tool-execution', tag: currentTag, ...receipt }))
          const before = await stateOf(fixture)
          const start = performance.now()
          inFlight = { fixture, before, startedAt: start }
          let disposition: unknown
          let rounds = 0
          let finalAnswer: string | undefined
          let protocolComplete = true
          if (mode === 'jev-front') {
            let transportFailure: string | undefined
            const snapshot = await fixture.runtime.invoke('kiosk_fast_path_context', { transcript: testCase.text }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
            const decision = await decideInteraction({ includeTrace: true, transcript: testCase.text, candidates: snapshot.candidates, decisionState: snapshot, conversation: { messages: fixture.history }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke: async (state, questions) => {
              const started = performance.now()
              const response = await fetch('https://openjev.aikcitri.qzz.io/v1/systemone', { method: 'POST', signal: AbortSignal.timeout(60_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, questions }) })
              if (!response.ok) {
                await response.body?.cancel()
                transportFailure = `Jev HTTP${response.status}`
                throw new Error(transportFailure)
              }
              const data = await response.json()
              rounds++
              record({ type: 'jev', tag: currentTag, state, questions, data, latency_ms: performance.now() - started })
              return data
            } })
            if (transportFailure)
              throw new Error(transportFailure)
            disposition = decision
            if (decision.kind === 'FAST_ACTION') {
              const input = { candidateId: decision.actionId, ...(decision.searchInterpretation ? { searchInterpretation: decision.searchInterpretation } : {}), ...(decision.ingredientFilters ? { ingredientFilters: decision.ingredientFilters } : {}), ...(decision.priceChoiceId ? { priceChoiceId: decision.priceChoiceId } : {}) }
              const result = await fixture.runtime.invoke('kiosk_fast_path_execute', input)
              fixture.receipts.push({ name: 'kiosk_fast_path_execute', input, result })
              record({ type: 'tool-execution', tag: currentTag, name: 'kiosk_fast_path_execute', input, result })
              if (envelope(result).continuation)
                protocolComplete = false
            }
          }
          else if (mode === 'proposal') {
            const current = await fixture.state()
            const response = await provider!.complete({ response_format: { type: 'json_object' }, messages: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify({ utterance: testCase.text, dialogue: fixture.history, currentQuestion: current.waitingFor?.question ?? null }) }] }, currentTag)
            const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
            const raw = data.choices?.[0]?.message?.content ?? ''
            const parsed = parseProposal(raw, testCase.text)
            rounds = 1
            disposition = parsed.valid ? { parsed, binding: await applyProposal(fixture, parsed.proposal) } : parsed
          }
          else {
            const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
            const startedData = await started.json() as { session: { id: string } }
            const sessionId = startedData.session.id
            for (const message of fixture.history) {
              const saved = await app.request(`/api/kiosk/visitor-sessions/${sessionId}/entries`, { method: 'POST', headers, body: JSON.stringify({ kind: message.role === 'user' ? 'user_text' : 'assistant_text', content: message.content }) })
              expect(saved.status).toBe(201)
            }
            let toolResults: Array<{ name: string, toolCallId: string, content: string }> = []
            const outputs: unknown[] = []
            for (let turn = 0; turn < 4; turn++) {
              const definitions = fixture.runtime.toolDefinitions.filter(definition => !definition.name.startsWith('kiosk_'))
              const tools = definitions.map(definition => ({ type: 'function', function: { name: definition.name, description: definition.description, parameters: definition.inputSchema } }))
              const response = await app.request(`/api/kiosk/visitor-sessions/${sessionId}/messages`, { method: 'POST', headers, body: JSON.stringify({ ...(turn ? { toolResults } : { content: testCase.text }), decisionState: await fixture.state(), tools }) })
              if (!response.ok)
                throw new Error(`Scratch Main Agent route HTTP${response.status}`)
              const output = envelope(await response.json())
              outputs.push(output)
              rounds++
              finalAnswer = typeof output.answer === 'string' ? output.answer : undefined
              const calls = output.toolCalls as Array<{ id: string, function: { name: string, arguments: string } }>
              if (!calls.length)
                break
              protocolComplete = turn < 3
              toolResults = []
              // Serial actual tool execution; later calls see previous mutations.
              for (const call of calls) {
                const definition = definitions.find(definition => definition.name === call.function.name)
                let result: unknown
                if (!definition) {
                  result = { error: 'Tool not offered; no execution' }
                }
                else {
                  try {
                    result = await fixture.call(definition.name, envelope(JSON.parse(call.function.arguments)))
                  }
                  catch { result = { error: 'Invalid tool arguments' } }
                }
                toolResults.push({ name: call.function.name, toolCallId: call.id, content: JSON.stringify(result) })
              }
            }
            disposition = { outputs, protocolComplete }
          }
          const after = await stateOf(fixture)
          expect(after.paymentAttempts).toBe(0)
          const sameCart = JSON.stringify(Object.entries(after.items).sort()) === JSON.stringify(Object.entries(testCase.cart).sort())
          const rawDisposition = envelope(disposition)
          const parsed = envelope(rawDisposition.parsed)
          const requirements = envelope(parsed.proposal).requirements as Array<{ effect: string }> | undefined
          const expectedIgnore = testCase.family === 'unfinished' ? 'INCOMPLETE' : 'IGNORE'
          const expectedEffect = testCase.family === 'unfinished' ? 'UNFINISHED' : 'CHAT'
          const isIgnored = rawDisposition.kind === expectedIgnore || (mode === 'proposal' && parsed.valid === true && requirements?.every(atom => atom.effect === expectedEffect) === true) || (mode === 'tool-agent' && fixture.receipts.length === 0 && !finalAnswer)
          const presentedReads = fixture.receipts.filter(receipt => ['menu_get', 'menu_recommend', 'kiosk_fast_path_execute', 'kiosk_fast_path_continue'].includes(receipt.name) && receipt.input.display !== false && (envelope(receipt.result).items || envelope(receipt.result).customerMessage))
          const repeatedRecommendation = 'nextBatch' in testCase && presentedReads.some(receipt => (envelope(receipt.result).items as Array<{ id: string }> | undefined)?.some(item => fixture.firstBatch.includes(item.id)))
          const localHandoff = rawDisposition.kind === 'NEEDS_ASSISTANT' || fixture.receipts.some(receipt => envelope(receipt.result).needsAssistant === true)
          const errors = fixture.receipts.filter(receipt => envelope(receipt.result).error)
          const outcomeMatches = sameCart && (!('party' in testCase) || after.party === testCase.party) && (!('mode' in testCase) || after.cart.fulfillmentMode === testCase.mode) && (!('read' in testCase) || presentedReads.length > 0) && (!('ignored' in testCase) || isIgnored) && !repeatedRecommendation
          const row = { type: 'observation', id: testCase.id, family: testCase.family, text: testCase.text, mode, before, after, disposition, receipts: fixture.receipts, finalAnswer, rounds, wall_ms: performance.now() - start, assessment: { outcomeMatches, localHandoff, protocolComplete, toolErrors: errors.length, safetyOnly: 'safeOnly' in testCase, completed: outcomeMatches && !localHandoff && protocolComplete && errors.length === 0 && !('safeOnly' in testCase), cartChanged: JSON.stringify(before.items) !== JSON.stringify(after.items), repeatedRecommendation } }
          rows.push(row)
          record(row)
          inFlight = undefined
          console.info(JSON.stringify({ done: currentTag, ...row.assessment, wall_ms: Math.round(row.wall_ms) }))
        }
      }
    }
    catch (error) {
      stoppedReason = errorMessageFrom(error) ?? 'Stopped'
      if (inFlight)
        record({ type: 'failed-turn', tag: currentTag, before: inFlight.before, after: await stateOf(inFlight.fixture), receipts: inFlight.fixture.receipts, wall_ms: performance.now() - inFlight.startedAt, reason: stoppedReason, completed: false })
      record({ type: 'stopped', tag: currentTag, reason: stoppedReason })
    }
    finally {
      provider?.close()
      writeFileSync(summaryPath, `${JSON.stringify({ rows, stoppedReason, userRetry, selectedIds: selectedCases.map(row => row.id), selectedModes, complete: !stoppedReason && rows.length === selectedCases.length * selectedModes.length, measured: rows.length }, null, 2)}\n`, { flag: 'wx' })
      closeSync(file)
    }
    expect(stoppedReason).toBeUndefined()
    expect(rows).toHaveLength(selectedCases.length * selectedModes.length)
  }, 3_600_000)
})
