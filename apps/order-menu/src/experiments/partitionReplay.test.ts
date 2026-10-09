import type { KioskActionCandidate, KioskDecisionState, KioskInteractionDecision } from '../../../server/src/services/domain/kiosk-interaction-decision'
import type { SystemOneQuestion } from '../../../server/src/services/domain/kiosk-system-one'
import type { CheckoutSnapshot } from '../domain/checkout-flow'
import type { CartSnapshot, MenuItem } from '../domain/order-machine'
import type { SeatingContext } from '../domain/seating'
import type { Resolution } from '../kiosk-intents'
import type { Scenario } from './partitionScenarios'

import { createHash } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs'

import { errorMessageFrom } from '@moeru/std'
import { describe, expect, it } from 'vitest'

import { decideInteraction } from '../../../server/src/services/domain/kiosk-interaction-decision'
import { beginCheckout } from '../domain/checkout-flow'
import { createMenuToolRuntime } from '../webmcp'
import { decidePartitioned, partitions } from './partitionDecision'
import { scenarios } from './partitionScenarios'

const policy = { decisionInstruction: '', storeInstruction: '' }
const menu: MenuItem[] = [
  { id: 'noodle', name: '紅燒牛肉麵', aliases: ['牛肉麵'], category: '麵食', price: 101 },
  { id: 'bento', name: '炸排骨便當', aliases: ['排骨便當'], category: '便當', price: 91 },
  { id: 'chicken', name: '椒麻雞便當', category: '便當', price: 96 },
  { id: 'dumplings', name: '水餃', category: '點心', price: 61 },
  { id: 'tea', name: '紅茶', category: '飲料', price: 21 },
].map(item => ({ ...item, description: '人工合成，成分未知', imageUrl: '', recommendationTags: [], optionGroups: [] }))

// The provider never sees gold. These read guards inspect actual untyped tool
// envelopes; owned cart/resolution contracts are imported, not recreated.
function envelope(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function prepare(scenario: Scenario) {
  let seating: SeatingContext = { revision: 0, ready: false, choices: [] }
  let checkout: CheckoutSnapshot | undefined
  let checkoutRevision = 0
  let paymentAttempts = 0
  const messages: Array<{ role: 'user' | 'assistant', content: string }> = []
  const runtime = createMenuToolRuntime({
    menu,
    onAction: () => {},
    onCartChange: () => {},
    onMenuSelection: () => {},
    seating: {
      context: () => seating,
      refresh: async () => {},
      release: async () => {},
      reset: async () => {},
      reserve: async () => { throw new Error('Experiment cannot reserve tables') },
      setPartySize: async (partySize) => { seating = { ...seating, partySize, revision: seating.revision + 1 } },
    },
    checkout: {
      snapshot: () => checkout,
      revision: () => checkoutRevision,
      paymentStatus: () => undefined,
      assertCanRestart: () => {},
      restart: () => {
        checkout = undefined
        checkoutRevision++
      },
      start: () => {
        checkout = beginCheckout()
        checkoutRevision++
        return checkout
      },
      skipMembership: () => { throw new Error('Experiment stops before membership') },
      chooseInvoice: () => { throw new Error('Experiment cannot select invoices') },
      requestTaxId: () => { throw new Error('Experiment cannot handle tax IDs') },
      setTaxId: () => { throw new Error('Experiment cannot handle tax IDs') },
      confirmTaxId: () => { throw new Error('Experiment cannot handle tax IDs') },
      cancel: () => {
        checkout = undefined
        checkoutRevision++
      },
      selectPayment: async () => {
        paymentAttempts++
        throw new Error('Experiment cannot initiate payment')
      },
    },
  })
  const present = async (raw: unknown) => {
    const receipt = envelope(raw)
    if (typeof receipt.customerMessage !== 'string')
      return
    const question = envelope(receipt.pendingCustomerChoice)
    await runtime.invoke('kiosk_dialogue_presented', { content: receipt.customerMessage, ...(typeof question.questionId === 'string' ? { questionId: question.questionId } : {}) })
    messages.push({ role: 'assistant', content: receipt.customerMessage })
  }
  if (['cart', 'party', 'pickup'].includes(scenario.setup)) {
    messages.push({ role: 'user', content: '先訂排骨便當一份' })
    await present(await runtime.invoke('order_add_item', { itemId: 'bento' }))
    if (scenario.setup === 'party' || scenario.setup === 'pickup') {
      const mode = scenario.setup === 'party' ? 'dine-in' : 'takeout'
      messages.push({ role: 'user', content: mode === 'dine-in' ? '店內吃' : '帶走' })
      await present(await runtime.invoke('order_set_fulfillment', { mode }))
    }
  }
  if (scenario.setup === 'information') {
    messages.push({ role: 'user', content: '看看你們的紅茶' })
    await present(await runtime.invoke('menu_get', { query: '紅茶' }))
  }
  // Repair fixtures include the original synthetic demand and actual receipt;
  // missing intent state is not patched with gold or invented operation success.
  if (scenario.family === 'repair')
    messages.unshift({ role: 'user', content: '原本要牛肉麵一碗、水餃一份、排骨便當兩份' })
  const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript: scenario.text }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
  const cart = async () => (await runtime.invoke('cart_get', { display: false }) as { cart: CartSnapshot }).cart
  return { runtime, snapshot, messages, cart, seating: () => seating, paymentAttempts: () => paymentAttempts }
}

async function execute(fixture: Awaited<ReturnType<typeof prepare>>, decision: KioskInteractionDecision) {
  const before = await fixture.cart()
  const partyBefore = fixture.seating().partySize
  let receipt: Record<string, unknown> | undefined
  let executionError: string | undefined
  if (decision.kind === 'FAST_ACTION') {
    try {
      receipt = envelope(await fixture.runtime.invoke('kiosk_fast_path_execute', {
        candidateId: decision.actionId,
        ...(decision.searchInterpretation ? { searchInterpretation: decision.searchInterpretation } : {}),
        ...(decision.ingredientFilters ? { ingredientFilters: decision.ingredientFilters } : {}),
      }))
    }
    catch (cause) { executionError = errorMessageFrom(cause) ?? 'Execution failed' }
  }
  const after = await fixture.cart()
  const stateAfter = await fixture.runtime.invoke('kiosk_interaction_state') as KioskDecisionState
  const resolution = envelope(receipt?.decisionTrace).resolveIntent as Resolution | undefined
  const plan = resolution && 'plan' in resolution ? resolution.plan : undefined
  expect(fixture.paymentAttempts()).toBe(0)
  return { before, after, partyBefore, partyAfter: fixture.seating().partySize, phaseBefore: fixture.snapshot.phase, phaseAfter: stateAfter.phase, receipt, plan, executionError }
}

function assess(scenario: Scenario, decision: KioskInteractionDecision, outcome: Awaited<ReturnType<typeof execute>>) {
  const actual = decision.kind === 'FAST_ACTION' ? decision.actionId : decision.kind
  const routeMatch = actual === scenario.expected
  let contractMatch = routeMatch && !outcome.executionError
  if (scenario.itemId)
    contractMatch &&= outcome.plan?.slots.itemId === scenario.itemId
  if (scenario.quantity)
    contractMatch &&= outcome.plan?.slots.quantity === scenario.quantity && outcome.after.itemCount === outcome.before.itemCount + scenario.quantity
  if (scenario.partySize)
    contractMatch &&= outcome.partyAfter === scenario.partySize
  if (scenario.expected === 'intent:start-checkout')
    contractMatch &&= outcome.phaseAfter !== 'ordering'
  if (scenario.expected === 'intent:set-fulfillment:dine-in' || scenario.expected === 'intent:set-fulfillment:takeout')
    contractMatch &&= outcome.after.fulfillmentMode === (scenario.expected.endsWith('dine-in') ? 'dine-in' : 'takeout')
  const changed = JSON.stringify(outcome.before) !== JSON.stringify(outcome.after) || outcome.partyBefore !== outcome.partyAfter || outcome.phaseBefore !== outcome.phaseAfter
  const assistance = decision.kind === 'NEEDS_ASSISTANT' || outcome.receipt?.needsAssistant === true
  const silentDrop = decision.kind === 'INCOMPLETE' && scenario.expected !== 'INCOMPLETE'
  const denied = decision.kind === 'UNAVAILABLE'
  const partialRisk = Boolean(scenario.needsAll && decision.kind === 'FAST_ACTION')
  return {
    actual,
    routeMatch,
    contractMatch,
    wrongMutation: changed && !contractMatch,
    wrongPreparation: !contractMatch && Boolean(outcome.receipt?.pendingConfiguration || outcome.receipt?.pendingCustomerChoice || outcome.receipt?.pendingConfirmation),
    partialRisk,
    silentDrop,
    denied,
    assistance,
    backgroundAdmission: scenario.expected === 'IGNORE' && !['IGNORE', 'UNAVAILABLE'].includes(decision.kind),
    // Handoff is correct routing for unsupported/compound demands, NOT a
    // completed order. Main Agent/tool-loop completion is not measured here.
    completedLocally: contractMatch && !assistance && !['INCOMPLETE', 'UNAVAILABLE'].includes(decision.kind),
  }
}

describe('isolated production pipeline and partition contracts', () => {
  it('freezes unique artificial cases without customer trace imports', () => {
    expect(scenarios).toHaveLength(44)
    expect(new Set(scenarios.map(scenario => scenario.id)).size).toBe(44)
    expect(new Set(scenarios.map(scenario => scenario.family)).size).toBe(11)
  })
  it('uses the real resolver/compiler/guard to add the exact quantity to an isolated cart', async () => {
    const scenario = scenarios.find(row => row.id === 'p10')!
    const fixture = await prepare(scenario)
    const decision = await decideInteraction({ transcript: scenario.text, candidates: fixture.snapshot.candidates, decisionState: fixture.snapshot, policy, invoke: async () => ({ answers: { route: { choice: 'intent:add-item', confidence: 0.95 } } }) })
    const result = await execute(fixture, decision)
    expect(result.plan?.slots.itemId).toBe('noodle')
    expect(result.plan?.slots.quantity).toBe(2)
    expect(assess(scenario, decision, result).contractMatch).toBe(true)
  })
  it('retains the existing unsupported one-person slot instead of hiding it with a gold candidate', async () => {
    const fixture = await prepare(scenarios.find(row => row.id === 'p24')!)
    expect(fixture.snapshot.waitingFor?.purpose).toBe('party-size')
    expect(fixture.snapshot.candidates.some(candidate => candidate.id === 'intent:set-party-size')).toBe(false)
  })
  it('does not execute a partial cart change for a compound referral', async () => {
    const scenario = scenarios.find(row => row.id === 'p31')!
    const fixture = await prepare(scenario)
    const result = await decidePartitioned({ transcript: scenario.text, candidates: fixture.snapshot.candidates, decisionState: fixture.snapshot, policy, invoke: async () => ({ answers: { partition: { choice: 'ASSISTANCE', confidence: 0.95 } } }) })
    const outcome = await execute(fixture, result.decision)
    expect(result.decision.kind).toBe('NEEDS_ASSISTANT')
    expect(outcome.after).toEqual(outcome.before)
    expect(assess(scenario, result.decision, outcome).completedLocally).toBe(false)
  })
  it('does not recover high-confidence unfinished category speech just from a lexical match', async () => {
    const fixture = await prepare(scenarios[0]!)
    const result = await decidePartitioned({ transcript: scenarios[0]!.text, candidates: fixture.snapshot.candidates, decisionState: fixture.snapshot, policy, invoke: async () => ({ answers: { partition: { choice: 'UNFINISHED', confidence: 0.9 } } }) })
    expect(result.decision.kind).toBe('INCOMPLETE')
    expect(result.emissions[0].confidence).toBe(0.9)
  })
  it('refuses invented leaf choices and weak groups rather than bypassing domain authorization', async () => {
    for (const confidence of [0.3, 0.95]) {
      const fixture = await prepare(scenarios[0]!)
      const result = await decidePartitioned({ transcript: scenarios[0]!.text, candidates: fixture.snapshot.candidates, decisionState: fixture.snapshot, policy, invoke: async (_state, questions) => questions.partition ? { answers: { partition: { choice: 'READ', confidence } } } : { answers: { effect: { choice: 'invented-action', confidence: 0.95 } } } })
      expect(result.decision.kind).toBe('UNAVAILABLE')
      const outcome = await execute(fixture, result.decision)
      expect(outcome.after).toEqual(outcome.before)
    }
  })
})

const endpoint = process.env.PARTITION_JEV_URL
const runLabel = process.env.PARTITION_RUN
const directory = new URL('../../../../test_prompt/turnClassifierPoc/', import.meta.url)
const rows: Array<Record<string, unknown>> = []
let transportFailures = 0
let stopped = false
let totalRequests = 0

describe.skipIf(!endpoint)('live frozen partition versus current production decision replay', () => {
  it('records all paired results without choosing a threshold or retuning after failures', async () => {
    if (!runLabel || !/^[a-z0-9-]{1,40}$/.test(runLabel))
      throw new Error('An explicit unique PARTITION_RUN label is required')
    const url = new URL('v1/systemone', `${endpoint!.replace(/\/+$/, '')}/`)
    if (url.origin !== 'https://openjev.aikcitri.qzz.io')
      throw new Error('Only the previously approved synthetic Jev endpoint is allowed')
    const path = new URL(`results/partition-${runLabel}.jsonl`, directory)
    const summaryPath = new URL(`results/partition-${runLabel}Summary.json`, directory)
    if ([path, summaryPath].some(file => existsSync(file)))
      throw new Error('Refusing to overwrite an earlier run')
    const file = openSync(path, 'wx')
    const datasetHash = createHash('sha256').update(JSON.stringify(scenarios)).digest('hex')
    const baselineHash = createHash('sha256').update(readFileSync(new URL('../../../server/src/services/domain/kiosk-interaction-decision/index.ts', import.meta.url))).update(readFileSync(new URL('../../../server/src/services/domain/kiosk-interaction-decision/prompt.ts', import.meta.url))).digest('hex')
    appendFileSync(file, `${JSON.stringify({ type: 'metadata', startedAt: new Date().toISOString(), endpoint: url.toString(), datasetHash, baselineHash, partitionHash: createHash('sha256').update(readFileSync(new URL('./partitionDecision.ts', import.meta.url))).digest('hex'), partitions, threshold: 0.6, cases: scenarios.length, menu, policy: 'code defaults, NOT saved merchant overrides', scope: 'real current decision + isolated real Menu resolver/compiler/guard; no Main Agent/ASR/UI/POS', goldSent: false, requestCap: 400, retries: 0 })}\n`)
    try {
      for (const scenario of scenarios) {
        // Alternate A/B order so the variant is not always measured later.
        const modes = Number(scenario.id.slice(1)) % 2 ? ['baseline', 'partitioned'] : ['partitioned', 'baseline']
        for (const mode of modes) {
          if (stopped)
            break
          const fixture = await prepare(scenario)
          const exchanges: Array<Record<string, unknown>> = []
          const invoke = async (state: string, questions: Record<string, SystemOneQuestion>) => {
            if (stopped || totalRequests >= 400) {
              stopped = true
              throw new Error('Experiment stopped')
            }
            totalRequests++
            const start = performance.now()
            try {
              const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, questions }), signal: AbortSignal.timeout(30_000) })
              if (!response.ok) {
                await response.body?.cancel()
                if ([400, 401, 403, 404, 429].includes(response.status))
                  stopped = true
                throw new Error(`Provider HTTP ${response.status}`)
              }
              const payload = await response.json() as { answers?: Record<string, unknown> }
              transportFailures = 0
              exchanges.push({ state, questions, payload, latency_ms: performance.now() - start })
              return payload
            }
            catch (cause) {
              transportFailures++
              if (transportFailures >= 3)
                stopped = true
              exchanges.push({ state, questions, failure: errorMessageFrom(cause) ?? 'Provider failure', latency_ms: performance.now() - start })
              throw cause
            }
          }
          const input = { transcript: scenario.text, candidates: fixture.snapshot.candidates, decisionState: fixture.snapshot, conversation: { messages: fixture.messages }, policy, invoke, includeTrace: true }
          const start = performance.now()
          const variant = mode === 'partitioned' ? await decidePartitioned(input) : undefined
          const decision = variant?.decision ?? await decideInteraction(input)
          const decisionMs = performance.now() - start
          const outcome = await execute(fixture, decision)
          const status = exchanges.some(exchange => exchange.failure) ? 'TRANSPORT_FAILURE' : 'MEASURED'
          const assessment = assess(scenario, decision, outcome)
          const row = { id: scenario.id, family: scenario.family, mode, status, text: scenario.text, expected: scenario.expected, decision, emissions: variant?.emissions, outcome, assessment, latency_ms: decisionMs, httpCalls: exchanges.length, modelQuestions: exchanges.reduce((sum, exchange) => sum + Object.keys(exchange.questions as object).length, 0), exchanges }
          rows.push(row)
          appendFileSync(file, `${JSON.stringify(row)}\n`)
          console.info(JSON.stringify({ id: row.id, mode, actual: assessment.actual, contractMatch: assessment.contractMatch, latency_ms: Math.round(decisionMs), httpCalls: row.httpCalls, status }))
        }
        if (stopped)
          break
      }
    }
    finally {
      closeSync(file)
      writeFileSync(summaryPath, JSON.stringify({ complete: rows.length === scenarios.length * 2 && !stopped, rows: rows.length, cases: scenarios.length, totalRequests, stopped, results: rows.map(({ exchanges: _exchanges, ...row }) => row) }, null, 2), { flag: 'wx' })
    }
    expect(rows.length).toBeGreaterThan(0)
  }, 1_800_000)
})
