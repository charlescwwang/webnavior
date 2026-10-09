import type { DecisionConversation } from '../../../server/src/services/domain/kiosk-interaction-decision/context'
import type { SystemOneQuestion } from '../../../server/src/services/domain/kiosk-system-one'
import type { MenuItem } from '../domain/order-machine'
import type { CoverageFinding } from './effectCoveragePoc'
import type { RequirementProfile } from './requirementPoc'

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { createOrderMachine } from '../domain/order-machine'
import { authorize, compileOperationPlan, createQuestion, deriveDecisionContext } from '../kiosk-intents'
import { inspectEffect } from './effectCoveragePoc'
import { compareEffect, extractRequirements } from './requirementPoc'

interface Turn {
  id: string
  setup: 'empty' | 'cart' | 'pickup' | 'party' | 'presentation'
  transcript: string
  knownRegression?: boolean
  expected: RequirementProfile
  hypotheses: Array<{ candidateId: string, supported: boolean, review: string, resolution?: string }>
}
const source = new URL('../../../../test_prompt/turnClassifierPoc/requirementScenarios.json', import.meta.url)
const frozen: { threshold: number, turns: Turn[] } = JSON.parse(readFileSync(source, 'utf8'))
const sha256 = createHash('sha256').update(readFileSync(source)).digest('hex')
const endpoint = process.env.REQUIREMENT_JEV_URL
const output = new URL('../../../../test_prompt/turnClassifierPoc/results/requirementReplay.json', import.meta.url)
const observations: Array<Record<string, unknown>> = []
if (process.env.REQUIREMENT_WRITE_REPORT && (!endpoint || existsSync(output)))
  throw new Error('Refusing provider calls for an unavailable or already recorded run')

// Newly authored synthetic menu only; no customer log, POS connection, recipes
// or payment execution. Baseline and blind extraction share the exact fixture.
const menu: MenuItem[] = [
  { id: 'noodle', name: '紅燒牛肉麵', aliases: ['牛肉麵'], category: '麵', price: 112 },
  { id: 'bento', name: '炸排骨便當', aliases: ['排骨便當'], category: '便當', price: 92 },
  { id: 'chicken', name: '椒麻雞便當', category: '便當', price: 97 },
  { id: 'dumplings', name: '水餃', category: '點心', price: 62 },
  { id: 'tea', name: '紅茶', category: '飲料', price: 22 },
].map(item => ({ ...item, description: '人工測試，未提供配方或營養', imageUrl: '', recommendationTags: [], optionGroups: [] }))

function prepare(turn: Turn) {
  const machine = createOrderMachine({ menu })
  const messages: DecisionConversation['messages'] = []
  if (['cart', 'pickup', 'party'].includes(turn.setup)) {
    for (const itemId of ['dumplings', 'tea']) {
      machine.selectMenuItem(itemId)
      machine.addToCart()
      messages.push({ role: 'user', content: `${menu.find(item => item.id === itemId)!.name}一份` }, { role: 'assistant', content: '已加入餐點一份。' })
    }
  }
  if (turn.setup === 'pickup' || turn.setup === 'party')
    machine.setFulfillmentMode(turn.setup === 'pickup' ? 'takeout' : 'dine-in')
  const presentationItemIds = turn.setup === 'presentation' ? ['bento', 'tea', 'dumplings'] : undefined
  if (presentationItemIds)
    messages.push({ role: 'assistant', content: '這三項依序是炸排骨便當、紅茶、水餃。' })
  const domainInput = () => ({ menu, cart: machine.getCart(), selectedItem: machine.getSelection(), recentAddedLineId: machine.getLastAddedLineId(), revisions: { ...machine.getRevisions(), checkout: 0, seating: 0 }, seating: { revision: 0, ready: false, choices: [] }, presentationItemIds })
  // Supplied question text is an interpretation cue, not a presentation receipt
  // or authorization. The production lifecycle is not exercised by this fixture.
  const question = createQuestion(deriveDecisionContext(domainInput()), 'synthetic-question', Date.now())
  if (question)
    messages.push({ role: 'assistant', content: question.question })
  const context = () => deriveDecisionContext({ ...domainInput(), waitingFor: question, transcript: turn.transcript })
  return { machine, context, conversation: { messages }, questionText: question?.question }
}

function answer(profile: RequirementProfile, confidence = 0.9) {
  return vi.fn(async (_state: string, _questions: Record<string, SystemOneQuestion>) => ({ answers: Object.fromEntries(Object.entries(profile).map(([key, choice]) => [key, { type: 'choice', choice, confidence }])) }))
}

describe('candidate-blind requirement contract (offline, not model accuracy)', () => {
  it.each(frozen.turns)('$id builds a real fixture and compares only application effects', async (turn) => {
    const fixture = prepare(turn)
    const invoke = answer(turn.expected)
    const before = fixture.machine.getCart()
    const finding = await extractRequirements({ utterance: turn.transcript, conversation: fixture.conversation, questionText: fixture.questionText, threshold: frozen.threshold, invoke })
    expect(finding.kind).toBe('PARSED')
    expect(finding.profile).toEqual(turn.expected)
    expect(invoke).toHaveBeenCalledOnce()
    for (const hypothesis of turn.hypotheses) {
      const result = compareEffect({ finding, candidateId: hypothesis.candidateId, context: fixture.context() })
      const shouldCheck = hypothesis.supported && turn.expected.reference === 'EXPLICIT'
      expect(result.kind).toBe(shouldCheck ? 'CHECKED_HYPOTHESIS' : 'REFER')
      if (hypothesis.resolution && shouldCheck)
        expect(result.resolution?.kind).toBe(hypothesis.resolution)
    }
    expect(fixture.machine.getCart()).toEqual(before)
  })
  it('sends no menu, hypotheses, gold, classifier, plan or target IDs', async () => {
    const turn = frozen.turns[0]
    const fixture = prepare(turn)
    const invoke = answer(turn.expected)
    const finding = await extractRequirements({ utterance: turn.transcript, conversation: fixture.conversation, questionText: fixture.questionText, threshold: frozen.threshold, invoke })
    const input = JSON.parse(invoke.mock.calls[0][0])
    expect(Object.keys(input)).toEqual(['utterance', 'recentDialogue', 'currentQuestionText'])
    expect(input.utterance).toBe(turn.transcript)
    expect(finding.state).not.toContain('intent:')
    expect(finding.state).not.toContain('expected')
    expect(Object.keys(finding.questions)).toEqual(['first', 'second', 'count', 'information', 'reference'])
    expect(Object.values(finding.questions).every(question => Object.keys(question.criteria!).length < 27)).toBe(true)
  })
  it('uses the same one blind result for mutually exclusive hypotheses', async () => {
    const turn = frozen.turns[0]
    const fixture = prepare(turn)
    const invoke = answer(turn.expected)
    const finding = await extractRequirements({ utterance: turn.transcript, conversation: fixture.conversation, threshold: frozen.threshold, invoke })
    expect(compareEffect({ finding, candidateId: 'intent:search-menu', context: fixture.context() }).kind).toBe('CHECKED_HYPOTHESIS')
    expect(compareEffect({ finding, candidateId: 'intent:add-item', context: fixture.context() }).reason).toBe('WRONG_EFFECT')
    expect(invoke).toHaveBeenCalledOnce()
  })
  it.each([
    { count: 'ONE', second: 'CHECKOUT' },
    { count: 'TWO', second: 'NONE' },
    { count: 'NONE', first: 'ADD' },
    { count: 'UNFINISHED', first: 'ADD' },
  ] as const)('rejects internally inconsistent dimensions $count', async (patch) => {
    const turn = frozen.turns[2]
    const finding = await extractRequirements({ utterance: turn.transcript, conversation: { messages: [] }, threshold: 0.6, invoke: answer({ ...turn.expected, ...patch }) })
    expect(finding.kind).toBe('REFER')
    expect(finding.reason).toBe('INCONSISTENT')
  })
  it.each([0.59, 2, Number.NaN])('does not promote invalid or insufficient confidence %s', async (confidence) => {
    const turn = frozen.turns[0]
    const finding = await extractRequirements({ utterance: turn.transcript, conversation: { messages: [] }, threshold: 0.6, invoke: answer(turn.expected, confidence) })
    expect(finding.kind).toBe('REFER')
    expect(finding.reason).toBe(confidence === 0.59 ? 'LOW_CONFIDENCE' : 'INVALID_ANSWER')
  })
  it('rejects missing dimensions and does not fill them from a candidate', async () => {
    const finding = await extractRequirements({ utterance: '水餃一份', conversation: { messages: [] }, threshold: 0.6, invoke: vi.fn(async () => ({ answers: { first: { type: 'choice', choice: 'ADD', confidence: 1 } } })) })
    expect(finding.reason).toBe('INVALID_ANSWER')
  })
  it('ignores invented provider target and quantity, and performs no action', async () => {
    const turn = frozen.turns[2]
    const fixture = prepare(turn)
    const invoke = vi.fn(async (state: string, questions: Record<string, SystemOneQuestion>) => {
      const payload = await answer(turn.expected)(state, questions)
      return { ...payload, targetRef: 'item:imaginary', quantity: 1000 }
    })
    const finding = await extractRequirements({ utterance: turn.transcript, conversation: fixture.conversation, threshold: 0.6, invoke })
    const result = compareEffect({ finding, candidateId: 'intent:add-item', context: fixture.context() })
    if (result.resolution?.kind !== 'PLAN')
      throw new Error('Expected the real domain plan')
    expect(result.resolution.plan.slots.itemId).toBe('bento')
    expect(result.resolution.plan.slots.quantity).toBe(2)
    expect(fixture.machine.getCart().itemCount).toBe(0)
  })
  it('requires current domain authorization even after an effect comparison', async () => {
    const turn = frozen.turns[3]
    const fixture = prepare(turn)
    const profile: RequirementProfile = { first: 'CHECKOUT', second: 'NONE', count: 'ONE', information: 'NONE', reference: 'EXPLICIT' }
    const finding = await extractRequirements({ utterance: '請結帳吧', conversation: fixture.conversation, threshold: 0.6, invoke: answer(profile) })
    const result = compareEffect({ finding, candidateId: 'intent:start-checkout', context: fixture.context() })
    if (result.resolution?.kind !== 'PLAN')
      throw new Error('Expected a real checkout plan')
    fixture.machine.setCartLineQuantity(fixture.machine.getCart().lines[0].id, 4)
    expect(authorize(compileOperationPlan(result.resolution.plan), fixture.context())).toMatchObject({ kind: 'BLOCKED', reason: 'STALE_PLAN' })
  })
  it('cannot infer payment consent through an unmapped effect', async () => {
    const fixture = prepare(frozen.turns[3])
    const finding = await extractRequirements({ utterance: '我要刷卡', conversation: fixture.conversation, threshold: 0.6, invoke: answer({ first: 'CHECKOUT', second: 'NONE', count: 'ONE', information: 'NONE', reference: 'EXPLICIT' }) })
    const context = deriveDecisionContext({ ...fixture.context(), checkout: { stage: 'payment', invoiceMethod: 'donation' }, transcript: '我要刷卡' })
    expect(compareEffect({ finding, candidateId: 'intent:select-payment:card', context }).kind).toBe('REFER')
    expect(fixture.machine.getCart().paymentId).toBeUndefined()
  })
  it('refers provider failures rather than defaulting to an effect', async () => {
    const finding = await extractRequirements({ utterance: '水餃一份', conversation: { messages: [] }, threshold: 0.6, invoke: vi.fn(async () => {
      throw new Error('Synthetic outage')
    }) })
    expect(finding.reason).toBe('PROVIDER_FAILURE')
  })
})

describe.skipIf(!endpoint)('live blind extraction versus unchanged candidate-review baseline', () => {
  let failures = 0
  it.each(frozen.turns)('$id measures one blind parse and each matched baseline hypothesis', async (turn) => {
    if (failures >= 3)
      throw new Error('Stopped at provider failure limit')
    const fixture = prepare(turn)
    const context = fixture.context()
    const before = fixture.machine.getCart()
    const calls: Array<{ phase: string, durationMs: number, status: 'ok' | 'failed', model?: string }> = []
    const invoke = (phase: string) => async (state: string, questions: Record<string, SystemOneQuestion>) => {
      if (failures >= 3)
        throw new Error('Stopped at provider failure limit')
      const started = performance.now()
      try {
        const response = await fetch(new URL('v1/systemone', `${endpoint!.replace(/\/+$/, '')}/`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'airi-requirement-poc/1' },
          body: JSON.stringify({ state, questions }),
          signal: AbortSignal.timeout(60_000),
        })
        if (!response.ok) {
          if ([401, 403, 429].includes(response.status))
            failures = 3
          throw new Error(`Jev HTTP ${response.status}`)
        }
        const payload = await response.json() as { model?: string, answers?: Record<string, unknown> }
        calls.push({ phase, durationMs: performance.now() - started, status: 'ok', model: payload.model })
        failures = 0
        return payload
      }
      catch (error) {
        calls.push({ phase, durationMs: performance.now() - started, status: 'failed' })
        failures++
        throw error
      }
    }
    // Parse once BEFORE exposing any candidate to the provider, then reuse this
    // same immutable finding for all hypotheses. Baseline is a separate call;
    // it never feeds back into extraction or picks its profile.
    const started = performance.now()
    const finding = await extractRequirements({ utterance: turn.transcript, conversation: fixture.conversation, questionText: fixture.questionText, threshold: frozen.threshold, invoke: invoke('blind') })
    const blindDurationMs = performance.now() - started
    const hypotheses: Array<Turn['hypotheses'][number] & { comparison: ReturnType<typeof compareEffect>, baseline: CoverageFinding }> = []
    for (const hypothesis of turn.hypotheses) {
      const comparison = compareEffect({ finding, candidateId: hypothesis.candidateId, context })
      const baseline = await inspectEffect({ candidateId: hypothesis.candidateId, context, conversation: fixture.conversation, threshold: frozen.threshold, invoke: invoke(`baseline:${hypothesis.candidateId}`) })
      hypotheses.push({ ...hypothesis, comparison, baseline })
    }
    observations.push({ id: turn.id, finding, blindDurationMs, hypotheses, calls, changedCart: JSON.stringify(before) !== JSON.stringify(fixture.machine.getCart()) })
    console.info(JSON.stringify({ id: turn.id, kind: finding.kind, reason: finding.reason, profile: finding.profile, confidence: finding.confidence, blindDurationMs, calls: calls.length }))
    expect(fixture.machine.getCart()).toEqual(before)
  }, 180_000)
})

afterAll(() => {
  if (!process.env.REQUIREMENT_WRITE_REPORT)
    return
  if (!endpoint || existsSync(output))
    throw new Error('Preserve the original recorded run; provider and fresh output required')
  writeFileSync(output, `${JSON.stringify({ scenario_sha256: sha256, threshold: frozen.threshold, endpoint, design: 'candidate-blind bounded requirements; matched unchanged reviewer; zero execution', observations }, null, 2)}\n`)
})
