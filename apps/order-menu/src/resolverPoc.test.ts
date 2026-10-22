import type { KioskActionCandidate, KioskDecisionState, KioskInteractionDecision } from '../../server/src/services/domain/kiosk-interaction-decision'
import type { SystemOneQuestion } from '../../server/src/services/domain/kiosk-system-one'
import type { CheckoutSnapshot } from './domain/checkout-flow'
import type { CartSnapshot, MenuItem } from './domain/order-machine'
import type { SeatingContext } from './domain/seating'
import type { OperationPlan, Resolution } from './kiosk-intents'

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { errorMessageFrom } from '@moeru/std'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '../../server/src/services/domain/kiosk-interaction-decision'
import { beginCheckout, chooseInvoiceMethod, confirmTaxId, requestTaxId, setTaxIdDraft, skipMembership } from './domain/checkout-flow'
import { createMenuToolRuntime } from './webmcp'

type Setup = 'empty' | 'single' | 'fulfillment' | 'pickup' | 'party' | 'partyIdle' | 'selected' | 'recommendations' | 'duplicates'
type TurnClass = 'DIRECT_ACTION' | 'QUERY' | 'REFERENCE' | 'MODIFICATION' | 'CANCEL_OR_REVERT' | 'CHAT' | 'NOISE' | 'UNCERTAIN'
interface Scenario {
  id: string
  transcript: string
  class: TurnClass
  setup: Setup
  expected: string
  resolution?: string
  itemId?: string
  quantity?: number
  partySize?: number
  preserveQuestion?: boolean
}
interface Prediction { class: TurnClass, confidence: number, latency_ms: number }
type Snapshot = KioskDecisionState & { candidates: KioskActionCandidate[] }
interface Receipt {
  customerMessage?: string
  needsAssistant?: boolean
  pendingConfiguration?: unknown
  pendingCustomerChoice?: { questionId: string, question: string }
  pendingConfirmation?: { confirmationId: string }
  decisionTrace?: { resolveIntent?: Resolution, operationPlan?: OperationPlan | null, authorize?: { kind: string } | null }
}

const source = new URL('../../../test_prompt/turnClassifierPoc/resolverScenarios.json', import.meta.url)
const sha256 = createHash('sha256').update(readFileSync(source)).digest('hex')
const scenarios: Scenario[] = JSON.parse(readFileSync(source, 'utf8')).scenarios
const predictionFile = new URL('../../../test_prompt/turnClassifierPoc/results/resolverPredictions.json', import.meta.url)
const predictions: { scenario_sha256: string, modes: Record<string, { records: Array<{ id: string, prediction: Prediction }> }> } | undefined
  = existsSync(predictionFile) ? JSON.parse(readFileSync(predictionFile, 'utf8')) : undefined
const endpoint = process.env.RESOLVER_JEV_URL
const output = new URL('../../../test_prompt/turnClassifierPoc/results/resolverReplay.json', import.meta.url)
const observations: Array<Record<string, unknown>> = []

// Prices, recipes and IDs are artificial. No POS/payment gateway is attached.
// Options stay empty, matching the user's current scope rather than deleting
// the existing SET_OPTION decision path.
const menu: MenuItem[] = [
  { id: 'noodle', name: '紅燒牛肉麵', aliases: ['牛肉麵'], category: '麵', price: 101 },
  { id: 'bento', name: '炸排骨便當', aliases: ['排骨便當'], category: '便當', price: 91 },
  { id: 'chicken', name: '椒麻雞便當', category: '便當', price: 96 },
  { id: 'dumplings', name: '水餃', category: '點心', price: 61 },
  { id: 'tea', name: '紅茶', category: '飲料', price: 21 },
].map(item => ({ ...item, description: '人工合成餐點，成分未知', imageUrl: '', recommendationTags: [], optionGroups: [] }))

async function prepare(setup: Setup, transcript: string) {
  let checkout: CheckoutSnapshot | undefined
  let revision = 0
  let seating: SeatingContext = { revision: 0, ready: false, choices: [] }
  let paymentAttempts = 0
  const update = (next: CheckoutSnapshot) => {
    checkout = next
    revision++
    return next
  }
  const runtime = createMenuToolRuntime({
    menu,
    onAction: () => {},
    onCartChange: () => {},
    onMenuSelection: () => {},
    onMenuRequested: () => {},
    onReviewRequested: () => {},
    seating: {
      context: () => seating,
      refresh: async () => {},
      release: async () => {},
      reset: async () => {},
      reserve: async () => { throw new Error('Replay cannot reserve external tables') },
      setPartySize: async (partySize) => { seating = { ...seating, partySize, revision: seating.revision + 1 } },
    },
    checkout: {
      snapshot: () => checkout,
      revision: () => revision,
      paymentStatus: () => undefined,
      assertCanRestart: () => {},
      restart: () => {
        checkout = undefined
        revision++
      },
      start: () => update(beginCheckout()),
      skipMembership: () => update(skipMembership(checkout!)),
      chooseInvoice: method => update(chooseInvoiceMethod(checkout!, method)),
      requestTaxId: () => update(requestTaxId(checkout!)),
      setTaxId: taxId => update(setTaxIdDraft(checkout!, taxId)),
      confirmTaxId: () => update(confirmTaxId(checkout!)),
      cancel: () => {
        checkout = undefined
        revision++
      },
      selectPayment: async () => {
        paymentAttempts++
        throw new Error('Replay cannot initiate payment')
      },
    },
  })
  const messages: Array<{ role: 'user' | 'assistant', content: string }> = []
  const present = async (receipt: Receipt) => {
    if (!receipt.customerMessage)
      return
    await runtime.invoke('kiosk_dialogue_presented', { content: receipt.customerMessage, questionId: receipt.pendingCustomerChoice?.questionId })
    messages.push({ role: 'assistant', content: receipt.customerMessage })
  }
  if (['single', 'fulfillment', 'pickup', 'party', 'partyIdle', 'duplicates'].includes(setup)) {
    const ids = setup === 'single' ? ['tea'] : setup === 'duplicates' ? ['dumplings', 'dumplings'] : ['bento', 'dumplings']
    for (const itemId of ids) {
      messages.push({ role: 'user', content: `${menu.find(item => item.id === itemId)!.name}一份` })
      await present(await runtime.invoke('order_add_item', { itemId }) as Receipt)
    }
    if (['pickup', 'party', 'partyIdle'].includes(setup)) {
      const mode = setup === 'pickup' ? 'takeout' : 'dine-in'
      messages.push({ role: 'user', content: mode === 'takeout' ? '自取' : '內用' })
      await present(await runtime.invoke('order_set_fulfillment', { mode }) as Receipt)
    }
    if (setup === 'partyIdle') {
      messages.push({ role: 'user', content: '水餃還有嗎' })
      await present(await runtime.invoke('menu_get', { query: '水餃' }) as Receipt)
      vi.setSystemTime(Date.now() + 55_000)
    }
  }
  if (setup === 'selected')
    await runtime.invoke('menu_select_item', { itemId: 'tea' })
  if (setup === 'recommendations') {
    await runtime.invoke('menu_get', {})
    await present(await runtime.invoke('menu_show_recommendations', { itemIds: ['bento', 'dumplings', 'tea'] }) as Receipt)
  }
  const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript }) as Snapshot
  const cart = async () => (await runtime.invoke('cart_get', { display: false }) as { cart: CartSnapshot }).cart
  return { runtime, snapshot, messages, cart, paymentAttempts: () => paymentAttempts }
}

/** Experimental eligibility, NOT a domain intent classifier or a production rule. */
function readOnlyCandidate(prediction: Prediction, threshold: number, snapshot: Snapshot) {
  if (!Number.isFinite(prediction.confidence) || prediction.confidence < threshold || prediction.class !== 'QUERY' || snapshot.phase !== 'ordering')
    return undefined
  // Food-condition meaning still belongs to the existing finite semantic checks.
  // A lexical ingredient in a product name is not an INCLUDE authorization.
  if (snapshot.ingredientReferences?.length || snapshot.dietaryReferences?.length || snapshot.unavailableConditionReferences?.length)
    return undefined
  const grounded = snapshot.productResolution?.status === 'exact' || Boolean(snapshot.catalogEvidence?.categories.length)
  if (!grounded)
    return undefined
  const possible = snapshot.candidates.filter(candidate => ['intent:search-menu', 'intent:recommend', 'intent:recommend-more', 'intent:show-recommendations'].includes(candidate.id))
  return possible.length === 1 && possible[0].id === 'intent:search-menu' ? possible[0].id : undefined
}

async function execute(fixture: Awaited<ReturnType<typeof prepare>>, decision: KioskInteractionDecision) {
  const before = await fixture.cart()
  let receipt: Receipt | undefined
  let error: string | undefined
  const started = performance.now()
  if (decision.kind === 'FAST_ACTION') {
    try {
      receipt = await fixture.runtime.invoke('kiosk_fast_path_execute', {
        candidateId: decision.actionId,
        ...(decision.priceChoiceId ? { priceChoiceId: decision.priceChoiceId } : {}),
        ...(decision.searchInterpretation ? { searchInterpretation: decision.searchInterpretation } : {}),
        ...(decision.ingredientFilters ? { ingredientFilters: decision.ingredientFilters } : {}),
      }) as Receipt
    }
    catch (cause) { error = errorMessageFrom(cause) ?? 'Replay execution failed' }
  }
  const executionMs = performance.now() - started
  const after = await fixture.cart()
  const afterState = await fixture.runtime.invoke('kiosk_interaction_state') as KioskDecisionState
  expect(fixture.paymentAttempts()).toBe(0)
  return { before, after, phaseBefore: fixture.snapshot.phase, phaseAfter: afterState.phase, questionBefore: fixture.snapshot.waitingFor?.purpose, questionAfter: afterState.waitingFor?.purpose, receipt, error, executionMs }
}

function assess(scenario: Scenario, decision: KioskInteractionDecision, execution: Awaited<ReturnType<typeof execute>>) {
  const actual = decision.kind === 'FAST_ACTION' ? decision.actionId : decision.kind
  const resolution = execution.receipt?.decisionTrace?.resolveIntent
  let correct = actual === scenario.expected && !execution.error
  if (scenario.resolution)
    correct &&= resolution?.kind === scenario.resolution
  const plan = resolution && 'plan' in resolution ? resolution.plan : undefined
  if (scenario.itemId)
    correct &&= plan?.slots.itemId === scenario.itemId
  if (scenario.quantity)
    correct &&= plan?.slots.quantity === scenario.quantity
  if (scenario.partySize)
    correct &&= plan?.slots.partySize === scenario.partySize
  if (scenario.preserveQuestion)
    correct &&= execution.questionBefore === execution.questionAfter
  const changedCart = JSON.stringify(execution.before) !== JSON.stringify(execution.after)
  const changedPhase = execution.phaseBefore !== execution.phaseAfter
  const unsafe = (changedCart || changedPhase) && (!correct || scenario.class === 'UNCERTAIN')
  // A wrong draft/clarification is visible error even without a cart mutation.
  // Uncertainty is safe abstention, not success at resolving the customer's need.
  const wrongPreparation = !correct && Boolean(execution.receipt?.pendingConfiguration || resolution?.kind === 'CLARIFICATION' || execution.receipt?.pendingConfirmation)
  return { actual, correct, unsafe, wrongPreparation, changedCart, changedPhase, abstained: decision.kind === 'UNAVAILABLE' || decision.kind === 'NEEDS_ASSISTANT' || Boolean(execution.receipt?.needsAssistant || execution.error) }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('isolated resolver challenge contracts', () => {
  it('has a frozen complete prediction set when inference artifacts are provided', () => {
    expect(scenarios).toHaveLength(40)
    expect(new Set(scenarios.map(row => row.id)).size).toBe(40)
    if (predictions) {
      expect(predictions.scenario_sha256).toBe(sha256)
      for (const mode of ['frozen', 'setfit']) {
        expect(predictions.modes[mode].records.map(row => row.id)).toEqual(scenarios.map(row => row.id))
        for (const { prediction } of predictions.modes[mode].records) {
          expect(Number.isFinite(prediction.confidence)).toBe(true)
          expect(prediction.confidence).toBeGreaterThanOrEqual(0)
          expect(prediction.confidence).toBeLessThanOrEqual(1)
        }
      }
    }
  })
  it.each(scenarios)('$id records candidate availability without substituting the expected answer', async (scenario) => {
    const fixture = await prepare(scenario.setup, scenario.transcript)
    const ids = fixture.snapshot.candidates.map(candidate => candidate.id)
    expect(new Set(ids).size).toBe(ids.length)
    observations.push({ stage: 'fixture', id: scenario.id, candidates: ids, expectedCandidateAvailable: scenario.expected.startsWith('intent:') ? ids.includes(scenario.expected) : null })
    if (scenario.setup === 'partyIdle')
      expect(fixture.snapshot.waitingFor?.purpose).toBe('party-size')
    expect(fixture.paymentAttempts()).toBe(0)
  })
  it.each(['DIRECT_ACTION', 'REFERENCE', 'MODIFICATION', 'CANCEL_OR_REVERT', 'CHAT', 'NOISE', 'UNCERTAIN'] as const)('does not turn %s into operation authority even at confidence 1', async (type) => {
    const fixture = await prepare('pickup', '水餃')
    expect(readOnlyCandidate({ class: type, confidence: 1, latency_ms: 0 }, 0.7, fixture.snapshot)).toBeUndefined()
  })
  it('keeps missing-slot configuration distinct from execution, without inventing a quantity', async () => {
    const fixture = await prepare('empty', '我要水餃')
    const result = await execute(fixture, { kind: 'FAST_ACTION', actionId: 'intent:add-item' })
    expect(result.receipt?.decisionTrace?.resolveIntent?.kind).toBe('CONFIGURATION')
    expect(result.after.itemCount).toBe(0)
  })
  it('rejects a query-to-add proposal without a validated price interpretation', async () => {
    const fixture = await prepare('empty', '水餃一份多少錢呢')
    const result = await execute(fixture, { kind: 'FAST_ACTION', actionId: 'intent:add-item' })
    expect(result.error).toContain('Price evidence requires an issued, resolved price choice')
    expect(result.after).toEqual(result.before)
  })
  it('shows that a legal single plan can silently consume part of a compound demand', async () => {
    const fixture = await prepare('pickup', '水餃來兩份，再幫我結帳')
    const result = await execute(fixture, { kind: 'FAST_ACTION', actionId: 'intent:add-item' })
    expect(result.receipt?.decisionTrace?.authorize?.kind).toBe('EXECUTE')
    expect(result.after.itemCount).toBe(result.before.itemCount + 2)
    expect(result.phaseAfter).toBe('ordering')
  })
  it('offers the named ingredient search without a duplicate shown-item reference from adding a meal', async () => {
    const fixture = await prepare('fulfillment', '水餃裡面會加花生嗎')
    const candidateId = readOnlyCandidate({ class: 'QUERY', confidence: 1, latency_ms: 0 }, 0.7, fixture.snapshot)
    // Adding no longer replaces browsing with the added dish. The named
    // product has one reference rather than a second synthetic shown item.
    expect(candidateId).toBe('intent:search-menu')
    expect(await fixture.cart()).toMatchObject({ itemCount: 2 })
  })
  it('detects that repeat additions do not establish a multi-line ambiguity fixture', async () => {
    const fixture = await prepare('duplicates', '水餃那一份取消掉')
    const cart = await fixture.cart()
    expect(cart.lines).toHaveLength(1)
    expect(cart.lines[0].quantity).toBe(2)
  })
  it('retains the question through query and idle, and resolves a real person slot', async () => {
    const fixture = await prepare('partyIdle', '一位')
    const result = await execute(fixture, { kind: 'FAST_ACTION', actionId: 'intent:set-party-size' })
    const resolution = result.receipt?.decisionTrace?.resolveIntent
    expect(resolution?.kind).toBe('PLAN')
    expect(resolution && 'plan' in resolution ? resolution.plan.slots.partySize : undefined).toBe(1)
    expect(result.after.itemCount).toBe(result.before.itemCount)
  })
  it('exposes the existing unparsed 一個人 form despite retaining the party question', async () => {
    const fixture = await prepare('partyIdle', '總共一個人而已')
    expect(fixture.snapshot.waitingFor?.purpose).toBe('party-size')
    expect(fixture.snapshot.candidates.map(candidate => candidate.id)).not.toContain('intent:set-party-size')
  })
  it('rejects an issued plan after a cart revision changes without losing the unmet question', async () => {
    const fixture = await prepare('pickup', '開始結帳')
    await fixture.runtime.invoke('order_add_item', { itemId: 'tea' })
    const result = await execute(fixture, { kind: 'FAST_ACTION', actionId: 'intent:start-checkout' })
    expect(result.error).toContain('STALE_PLAN')
    expect(result.phaseAfter).toBe('ordering')
    expect(result.questionAfter).toBe('checkout-entry')
  })
  it('reaches the payment boundary for an explicit method without completing a payment', async () => {
    const fixture = await prepare('pickup', '開始結帳')
    await fixture.runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:start-checkout' })
    await fixture.runtime.invoke('checkout_skip_membership', { confirmedByUser: true })
    await fixture.runtime.invoke('checkout_choose_invoice', { method: 'donation' })
    await fixture.runtime.invoke('kiosk_fast_path_context', { transcript: '信用卡' })
    await expect(fixture.runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:select-payment:card' })).rejects.toThrow('Replay cannot initiate payment')
    expect(fixture.paymentAttempts()).toBe(1)
    expect((await fixture.cart()).paymentId).toBeUndefined()
  })
})

describe.skipIf(!predictions)('real frozen encoder routing probes (no Jev required)', () => {
  it.each(scenarios)('$id records eligibility and executes only a read-only singleton', async (scenario) => {
    for (const mode of ['frozen', 'setfit']) {
      const prediction = predictions!.modes[mode].records.find(row => row.id === scenario.id)!.prediction
      for (const threshold of [0.7, 0.8, 0.9, 0.95]) {
        const fixture = await prepare(scenario.setup, scenario.transcript)
        const candidateId = readOnlyCandidate(prediction, threshold, fixture.snapshot)
        if (!candidateId) {
          observations.push({ stage: 'local', mode, threshold, id: scenario.id, prediction, referral: ['REFERENCE', 'MODIFICATION', 'CANCEL_OR_REVERT'].includes(prediction.class) && prediction.confidence >= threshold ? 'contextual_semantics' : 'jev', accepted: false })
          continue
        }
        const decision: KioskInteractionDecision = { kind: 'FAST_ACTION', actionId: candidateId }
        const execution = await execute(fixture, decision)
        observations.push({ stage: 'local', mode, threshold, id: scenario.id, prediction, accepted: true, assessment: assess(scenario, decision, execution), execution })
        expect(execution.after).toEqual(execution.before)
        expect(execution.phaseAfter).toBe(execution.phaseBefore)
      }
    }
  })
})

describe.skipIf(!endpoint)('opt-in actual finite Jev plus real resolver replay', () => {
  let consecutiveFailures = 0
  it.each(scenarios)('$id records semantic and operation outcomes without hiding abstention', async (scenario) => {
    if (consecutiveFailures >= 3)
      throw new Error('Stopped after three provider failures; preserve partial evidence')
    const fixture = await prepare(scenario.setup, scenario.transcript)
    const started = performance.now()
    const calls: Array<{ durationMs: number, questions: string[], model?: string }> = []
    const invoke = async (state: string, questions: Record<string, SystemOneQuestion>) => {
      const callStarted = performance.now()
      const response = await fetch(new URL('v1/systemone', `${endpoint!.replace(/\/+$/, '')}/`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'airi-resolver-poc/1' },
        body: JSON.stringify({ state, questions }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) {
        if ([401, 403, 429].includes(response.status))
          consecutiveFailures = 3
        throw new Error(`Jev HTTP ${response.status}`)
      }
      const payload = await response.json() as { answers?: Record<string, unknown>, model?: string }
      calls.push({ durationMs: performance.now() - callStarted, questions: Object.keys(questions), model: payload.model })
      return payload
    }
    const decision = await decideInteraction({ candidates: fixture.snapshot.candidates, decisionState: fixture.snapshot, conversation: { messages: fixture.messages }, transcript: scenario.transcript, includeTrace: true, invoke, policy: { decisionInstruction: '', storeInstruction: '' } })
    const semanticMs = performance.now() - started
    consecutiveFailures = decision.reason === 'PROVIDER_FAILURE' ? consecutiveFailures + 1 : 0
    const execution = await execute(fixture, decision)
    observations.push({ stage: 'jev', id: scenario.id, decision, semanticMs, calls, assessment: assess(scenario, decision, execution), execution })
  })
})

afterAll(() => {
  if (!process.env.RESOLVER_WRITE_REPORT)
    return
  if (existsSync(output))
    throw new Error('Replay output exists; never silently replace benchmark evidence')
  // These are new synthetic inputs/receipts only. Existing traces and attachments
  // are neither read nor exported. Provider failures remain recorded, not retried.
  writeFileSync(output, `${JSON.stringify({ scenario_sha256: sha256, endpoint: endpoint ?? null, policy: 'unchanged production default finite decision; experimental local read-only singleton eligibility', observations }, null, 2)}\n`)
})
