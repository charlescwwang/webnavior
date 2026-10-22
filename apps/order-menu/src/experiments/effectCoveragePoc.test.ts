import type { DecisionConversation } from '../../../server/src/services/domain/kiosk-interaction-decision/context'
import type { SystemOneQuestion } from '../../../server/src/services/domain/kiosk-system-one'
import type { MenuItem } from '../domain/order-machine'

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { createOrderMachine } from '../domain/order-machine'
import { authorize, compileOperationPlan, createQuestion, deriveDecisionContext } from '../kiosk-intents'
import { coverageChoices, inspectEffect } from './effectCoveragePoc'

interface Scenario {
  id: string
  transcript: string
  setup: 'empty' | 'cart' | 'pickup' | 'party' | 'presentation'
  candidateId: string
  expected: string
  resolution?: string
}
const source = new URL('../../../../test_prompt/turnClassifierPoc/effectCoverageScenarios.json', import.meta.url)
const frozen: { threshold: number, scenarios: Scenario[] } = JSON.parse(readFileSync(source, 'utf8'))
const sha256 = createHash('sha256').update(readFileSync(source)).digest('hex')
const endpoint = process.env.COVERAGE_JEV_URL
const output = new URL('../../../../test_prompt/turnClassifierPoc/results/effectCoverageReplay.json', import.meta.url)
const observations: Array<Record<string, unknown>> = []

// All facts are newly authored synthetic data. No recipes, optional defaults,
// vendor catalog, gateway, order submission, or payment operation is attached.
const menu: MenuItem[] = [
  { id: 'noodle', name: '紅燒牛肉麵', aliases: ['牛肉麵'], category: '麵', price: 112 },
  { id: 'bento', name: '炸排骨便當', aliases: ['排骨便當'], category: '便當', price: 92 },
  { id: 'chicken', name: '椒麻雞便當', category: '便當', price: 97 },
  { id: 'dumplings', name: '水餃', category: '點心', price: 62 },
  { id: 'tea', name: '紅茶', category: '飲料', price: 22 },
].map(item => ({ ...item, description: '合成測試品項，成分與營養未提供', imageUrl: '', recommendationTags: [], optionGroups: [] }))

function prepare(scenario: Scenario) {
  const machine = createOrderMachine({ menu })
  const messages: DecisionConversation['messages'] = []
  if (['cart', 'pickup', 'party'].includes(scenario.setup)) {
    for (const itemId of ['dumplings', 'tea']) {
      machine.selectMenuItem(itemId)
      machine.addToCart()
      messages.push({ role: 'user', content: `${menu.find(item => item.id === itemId)!.name}一份` }, { role: 'assistant', content: '已加入指定餐點一份。' })
    }
  }
  if (scenario.setup === 'pickup' || scenario.setup === 'party')
    machine.setFulfillmentMode(scenario.setup === 'pickup' ? 'takeout' : 'dine-in')
  const presentationItemIds = scenario.setup === 'presentation' ? ['bento', 'tea', 'dumplings'] : undefined
  if (presentationItemIds)
    messages.push({ role: 'assistant', content: '依序展示：炸排骨便當、紅茶、水餃。' })
  const domainInput = () => ({ menu, cart: machine.getCart(), selectedItem: machine.getSelection(), recentAddedLineId: machine.getLastAddedLineId(), revisions: { ...machine.getRevisions(), checkout: 0, seating: 0 }, seating: { revision: 0, ready: false, choices: [] }, presentationItemIds })
  // This is a supplied presented-question fixture, not a test of UI receipt
  // presentation or idle retention. Those lifecycle paths have separate tests.
  const question = createQuestion(deriveDecisionContext(domainInput()), 'synthetic-question', Date.now())
  if (question)
    messages.push({ role: 'assistant', content: question.question })
  const context = () => deriveDecisionContext({ ...domainInput(), waitingFor: question, transcript: scenario.transcript })
  return { machine, context, conversation: { messages } }
}

const fixtureScenario: Scenario = { id: 'unit', setup: 'empty', transcript: '水餃一份賣多少呢', candidateId: 'intent:add-item', expected: 'WRONG_EFFECT' }
const answer = (choice: string, confidence = 0.9) => vi.fn(async (_state: string, _questions: Record<string, SystemOneQuestion>) => ({ answers: { coverage: { type: 'choice', choice, confidence } } }))

describe('independent effect and whole-request contract', () => {
  it('freezes the finite vocabulary and all 32 probe hypotheses', () => {
    expect(frozen.scenarios).toHaveLength(32)
    expect(new Set(frozen.scenarios.map(scenario => scenario.id)).size).toBe(32)
    expect(frozen.threshold).toBe(0.6)
    expect(Object.keys(coverageChoices)).toEqual(['COVERED', 'WRONG_EFFECT', 'MULTIPLE_REQUESTS', 'UNSUPPORTED_REQUEST', 'UNRESOLVED_REFERENCE', 'UNCERTAIN'])
  })
  it.each(frozen.scenarios)('$id establishes the expected domain fixture before provider inference', async (scenario) => {
    const fixture = prepare(scenario)
    const invoke = answer(scenario.expected)
    const before = fixture.machine.getCart()
    const result = await inspectEffect({ candidateId: scenario.candidateId, context: fixture.context(), conversation: fixture.conversation, threshold: frozen.threshold, invoke })
    // NOTICE: c09's frozen semantic gold remains MULTIPLE_REQUESTS. The Oct22
    // domain guard now refers its separately named dishes before model inference;
    // this updates only the current-runtime fixture, not the frozen experiment.
    if (scenario.id === 'c09') {
      expect(result.reason).toBe('DOMAIN_UNRESOLVED')
      expect(result.resolution?.kind).toBe('NEEDS_ASSISTANT')
      expect(invoke).not.toHaveBeenCalled()
      expect(fixture.machine.getCart()).toEqual(before)
      return
    }
    expect(result.reason).toBe(scenario.expected)
    if (scenario.expected === 'MISSING_EFFECT' || scenario.expected === 'DOMAIN_UNRESOLVED')
      expect(invoke).not.toHaveBeenCalled()
    else
      expect(invoke).toHaveBeenCalledOnce()
    if (scenario.resolution)
      expect(result.resolution?.kind).toBe(scenario.resolution)
    expect(fixture.machine.getCart()).toEqual(before)
  })
  it('sends the full sentence and positive facts, not the gold expectation or classifier', async () => {
    const fixture = prepare(fixtureScenario)
    const invoke = answer('WRONG_EFFECT')
    await inspectEffect({ candidateId: fixtureScenario.candidateId, context: fixture.context(), conversation: fixture.conversation, threshold: 0.6, invoke })
    const [state, questions] = invoke.mock.calls[0]
    expect(state).toContain(fixtureScenario.transcript)
    expect(state).toContain('"effect":"ADD_ITEM"')
    expect(state).toContain('"composition":null')
    expect(state).not.toContain('"expected"')
    expect(state).not.toContain('"class"')
    expect(Object.keys(questions)).toEqual(['coverage'])
  })
  it.each(['WRONG_EFFECT', 'MULTIPLE_REQUESTS', 'UNSUPPORTED_REQUEST', 'UNRESOLVED_REFERENCE', 'UNCERTAIN'])('does not promote a %s answer even at confidence 1', async (choice) => {
    const fixture = prepare(fixtureScenario)
    const result = await inspectEffect({ candidateId: fixtureScenario.candidateId, context: fixture.context(), conversation: fixture.conversation, threshold: 0.6, invoke: answer(choice, 1) })
    expect(result.kind).toBe('REFER')
    expect(result.reason).toBe(choice)
  })
  it.each([{ choice: 'cart_add_item', confidence: 1 }, { choice: 'COVERED', confidence: 2 }, { choice: 'COVERED', confidence: Number.NaN }])('rejects an invalid provider envelope $choice / $confidence', async (response) => {
    const fixture = prepare(fixtureScenario)
    const result = await inspectEffect({ candidateId: fixtureScenario.candidateId, context: fixture.context(), conversation: fixture.conversation, threshold: 0.6, invoke: answer(response.choice, response.confidence) })
    expect(result.kind).toBe('REFER')
    expect(result.reason).toBe('INVALID_ANSWER')
  })
  it('keeps low confidence separate from a semantic rejection', async () => {
    const fixture = prepare(fixtureScenario)
    const result = await inspectEffect({ candidateId: fixtureScenario.candidateId, context: fixture.context(), conversation: fixture.conversation, threshold: 0.6, invoke: answer('COVERED', 0.59) })
    expect(result.kind).toBe('REFER')
    expect(result.reason).toBe('LOW_CONFIDENCE')
  })
  it('does not execute or manufacture fallback parameters on provider failure', async () => {
    const fixture = prepare(fixtureScenario)
    const invoke = vi.fn(async () => {
      throw new Error('Artificial provider outage')
    })
    const result = await inspectEffect({ candidateId: fixtureScenario.candidateId, context: fixture.context(), conversation: fixture.conversation, threshold: 0.6, invoke })
    expect(result.kind).toBe('REFER')
    expect(result.reason).toBe('PROVIDER_FAILURE')
    expect(fixture.machine.getCart().itemCount).toBe(0)
  })
  it('does not accept provider-supplied target or quantity as a domain fact', async () => {
    const fixture = prepare({ ...fixtureScenario, transcript: '排骨便當給我來三份喔' })
    const invoke = vi.fn(async () => ({ answers: { coverage: { type: 'choice', choice: 'COVERED', confidence: 0.99, targetRef: 'item:imaginary', quantity: 500 } } }))
    const result = await inspectEffect({ candidateId: fixtureScenario.candidateId, context: fixture.context(), conversation: fixture.conversation, threshold: 0.6, invoke })
    expect(result.kind).toBe('CHECKED_HYPOTHESIS')
    expect(result.resolution?.kind).toBe('PLAN')
    if (result.resolution?.kind !== 'PLAN')
      throw new Error('Expected a real domain plan')
    expect(result.resolution.plan.slots.itemId).toBe('bento')
    expect(result.resolution.plan.slots.quantity).toBe(3)
    expect(fixture.machine.getCart().itemCount).toBe(0)
  })
  it('a checked hypothesis cannot bypass fresh revisions after the review awaited', async () => {
    const fixture = prepare({ ...fixtureScenario, setup: 'pickup', transcript: '幫我結帳喔', candidateId: 'intent:start-checkout' })
    const result = await inspectEffect({ candidateId: 'intent:start-checkout', context: fixture.context(), conversation: fixture.conversation, threshold: 0.6, invoke: vi.fn(async () => {
      fixture.machine.setCartLineQuantity(fixture.machine.getCart().lines[0].id, 3)
      return { answers: { coverage: { type: 'choice', choice: 'COVERED', confidence: 0.99 } } }
    }) })
    expect(result.kind).toBe('CHECKED_HYPOTHESIS')
    if (result.resolution?.kind !== 'PLAN')
      throw new Error('Expected a domain plan')
    expect(authorize(compileOperationPlan(result.resolution.plan), fixture.context())).toMatchObject({ kind: 'BLOCKED', reason: 'STALE_PLAN' })
  })
  it('a checked payment-method hypothesis authorizes method selection without completing payment', async () => {
    const fixture = prepare({ ...fixtureScenario, setup: 'pickup' })
    const context = deriveDecisionContext({ ...fixture.context(), checkout: { stage: 'payment', invoiceMethod: 'donation' }, transcript: '我要刷卡喔' })
    const result = await inspectEffect({ candidateId: 'intent:select-payment:card', context, conversation: fixture.conversation, threshold: 0.6, invoke: answer('COVERED', 1) })
    expect(result.kind).toBe('CHECKED_HYPOTHESIS')
    expect(result.authorization?.kind).toBe('EXECUTE')
    expect(fixture.machine.getCart().paymentId).toBeUndefined()
  })
})

describe.skipIf(!endpoint)('actual 4B coverage-probe benchmark (never an execution path)', () => {
  let failures = 0
  it.each(frozen.scenarios)('$id measures the frozen coverage hypothesis', async (scenario) => {
    if (failures >= 3)
      throw new Error('Stopped after provider failure limit')
    const fixture = prepare(scenario)
    const context = fixture.context()
    const before = fixture.machine.getCart()
    const calls: Array<{ durationMs: number, model?: string }> = []
    const invoke = async (state: string, questions: Record<string, SystemOneQuestion>) => {
      const started = performance.now()
      const response = await fetch(new URL('v1/systemone', `${endpoint!.replace(/\/+$/, '')}/`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'airi-effect-coverage-poc/1' },
        body: JSON.stringify({ state, questions }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) {
        if ([401, 403, 429].includes(response.status))
          failures = 3
        throw new Error(`Jev HTTP ${response.status}`)
      }
      const payload = await response.json() as { model?: string, answers?: Record<string, unknown> }
      calls.push({ durationMs: performance.now() - started, model: payload.model })
      return payload
    }
    const started = performance.now()
    const result = await inspectEffect({ candidateId: scenario.candidateId, context, conversation: fixture.conversation, threshold: frozen.threshold, invoke })
    const durationMs = performance.now() - started
    if (result.reason === 'PROVIDER_FAILURE')
      failures++
    else if (calls.length)
      failures = 0
    // Deliberately injected good/bad effects measure review sensitivity, not
    // upstream intent accuracy. No oracle answer is sent or used to select it.
    observations.push({ id: scenario.id, candidateId: scenario.candidateId, expected: scenario.expected, result, durationMs, calls, changedCart: JSON.stringify(before) !== JSON.stringify(fixture.machine.getCart()) })
    expect(fixture.machine.getCart()).toEqual(before)
  }, 40_000)
})

afterAll(() => {
  if (!process.env.COVERAGE_WRITE_REPORT)
    return
  if (!endpoint || existsSync(output))
    throw new Error('A new recorded run requires a provider and a fresh output path')
  writeFileSync(output, `${JSON.stringify({ scenario_sha256: sha256, threshold: frozen.threshold, endpoint, design: 'deliberately injected effect hypotheses, advisory coverage check, zero execution', observations }, null, 2)}\n`)
})
