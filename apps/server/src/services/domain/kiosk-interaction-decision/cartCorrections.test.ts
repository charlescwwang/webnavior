import type { SystemOneQuestion } from '../kiosk-system-one'
import type { KioskDecisionState } from './contracts'

import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'
import { createDecisionStages } from './stages'

const policy = { decisionInstruction: '', storeInstruction: '' }
const candidates = [
  { id: 'intent:add-item', description: '新增指定的餐點。', requiresHighConfidence: true },
  { id: 'intent:remove-item', description: '移除購物車中的特定一筆餐點。', requiresHighConfidence: true },
  { id: 'intent:set-quantity', description: '修改既有餐點數量。', requiresHighConfidence: true },
]
const state: KioskDecisionState = {
  phase: 'ordering',
  paymentState: 'idle',
  catalogEvidence: { products: [{ label: '紅燒牛肉麵', matchedText: '牛肉麵', source: 'alias' }, { label: '水餃', matchedText: '水餃', source: 'name' }], categories: [] },
  productResolution: { status: 'exact', count: 2, references: [{ label: '紅燒牛肉麵', refId: 'ITEM_1' }, { label: '水餃', refId: 'ITEM_2' }] },
  references: [{ label: '紅燒牛肉麵', refId: 'ITEM_1' }, { label: '水餃', refId: 'ITEM_2' }, { label: '購物車第1筆水餃（最近加入）', refId: 'CART_LINE_1' }],
  interactionState: { screen: 'menu', lastAddedItemName: '水餃', matchingCartLines: 1 },
}

describe('whole-request coverage for cart changes', () => {
  // Report: attachment 44310a20-ae6f-4e32-84e9-3b36bf0c5298, this chat, 2026-10-20.
  it.each([
    { route: 0.4, purpose: 0.8458, coverage: 0.3983 },
    { route: 0.7289, purpose: 0.4, coverage: 0.3983 },
    { route: 0.7289, purpose: 0.8458, coverage: Number.NaN },
    { route: 0.7289, purpose: 0.8458, coverage: -0.1 },
    { route: 0.7289, purpose: 0.8458, coverage: 1.1 },
  ])('does not promote unqualified compound-operation evidence: $route/$purpose/$coverage', async ({ route, purpose, coverage }) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
      if (questions.route)
        return { answers: { route: { choice: 'intent:add-item', confidence: route } } }
      if (questions.requestPurpose)
        return { answers: { requestPurpose: { choice: 'OPERATION', confidence: purpose } } }
      return { answers: { cartRequest: { choice: 'SINGLE', confidence: coverage } } }
    })
    const result = await decideInteraction({ transcript: '水餃改一份好了 然後我要再一碗牛肉麵', candidates, decisionState: state, policy, invoke })
    expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION' })
    expect(result).not.toHaveProperty('actionId')
    expect(invoke).toHaveBeenCalledTimes(Number.isFinite(coverage) && coverage >= 0 && coverage <= 1 ? 4 : 3)
  })

  it.each([
    { service: 'REQUEST', serviceConfidence: 0.95, kind: 'NEEDS_ASSISTANT' },
    { service: 'BACKGROUND', serviceConfidence: 0.95, kind: 'IGNORE' },
    { service: 'REQUEST', serviceConfidence: 0.4, kind: 'UNAVAILABLE' },
    { service: 'UNCERTAIN', serviceConfidence: 0.95, kind: 'UNAVAILABLE' },
  ])('preserves the reported quantity change plus addition without executing half: $service/$serviceConfidence', async ({ service, serviceConfidence, kind }) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
      if (questions.route)
        return { answers: { route: { choice: 'intent:add-item', confidence: 0.7289 } } }
      if (questions.requestPurpose)
        return { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.8458 } } }
      if (questions.cartRequest)
        return { answers: { cartRequest: { choice: 'SINGLE', confidence: 0.3983 } } }
      return { answers: { service: { choice: service, confidence: serviceConfidence } } }
    })
    const result = await decideInteraction({ transcript: '水餃改一份好了 然後我要再一碗牛肉麵', candidates, decisionState: { ...state, waitingFor: { questionId: 'F1', purpose: 'fulfillment', question: '請問要內用還是自取？', expiresAt: Date.now() + 30_000, choices: [] } }, policy, invoke, includeTrace: true })
    expect(result.kind).toBe(kind)
    if (kind === 'NEEDS_ASSISTANT')
      expect(result).toHaveProperty('reason', 'UNCERTAIN_OPERATION')
    expect(result).not.toHaveProperty('actionId')
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(result).not.toHaveProperty('supersededQuestionId')
    expect(invoke).toHaveBeenCalledTimes(4)
  })

  it.each([
    { choice: 'OTHER', confidence: 0.95, kind: 'IGNORE' },
    { choice: 'KIOSK', confidence: 0.95, kind: 'UNAVAILABLE' },
    { choice: 'OTHER', confidence: 0.4, kind: 'UNAVAILABLE' },
  ])('uses weak-handoff scope only to silence companion speech: $choice/$confidence', async ({ choice, confidence, kind }) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.requestPurpose
      ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 } } }
      : questions.route
        ? { answers: { route: { choice: 'MULTI_ACTION', confidence: 0.3 } } }
        : { answers: { recipient: { choice, confidence } } })
    const result = await decideInteraction({ transcript: '小王，水餃不要，改牛肉麵', decisionState: state, candidates, policy, invoke, includeTrace: true })
    expect(result.kind).toBe(kind)
    expect(result).toMatchObject({ trace: { rawAnswer: { choice: 'MULTI_ACTION', confidence: 0.3 } } })
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(result).not.toHaveProperty('supersededQuestionId')
  })

  // Report: /Users/charleswang/.codex/attachments/8a3a6bcd-71a2-47f5-8239-04f472ef8377/貼上的文字.txt
  it.each([0.3114, 0.95])('hands off the complete replacement despite a partial ADD route at confidence %s', async (confidence) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.requestPurpose
      ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 } } }
      : questions.route
        ? { answers: { route: { choice: 'intent:add-item', confidence } } }
        : questions.service
          ? { answers: { service: { choice: 'REQUEST', confidence: 0.95 } } }
          : { answers: { cartRequest: { choice: 'HANDOFF', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '水餃不要，改牛肉麵', decisionState: state, candidates, policy, invoke, includeTrace: true })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', trace: { rawAnswer: { choice: 'intent:add-item', confidence } } })
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(invoke).toHaveBeenCalledTimes(4)
  })

  it.each([
    { speech: '再加一份牛肉麵', action: 'intent:add-item' },
    { speech: '水餃不要了', action: 'intent:remove-item' },
    { speech: '水餃改兩份', action: 'intent:set-quantity' },
  ])('retains a verified single cart action for $speech without answering fulfillment', async ({ speech, action }) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.requestPurpose
      ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 } } }
      : questions.route
        ? { answers: { route: { choice: action, confidence: 0.95 } } }
        : questions.service
          ? { answers: { service: { choice: 'REQUEST', confidence: 0.95 } } }
          : { answers: { cartRequest: { choice: 'SINGLE', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: speech, decisionState: { ...state, waitingFor: { questionId: 'F1', purpose: 'fulfillment', question: '內用還是自取？', expiresAt: Date.now() + 30_000, choices: [] } }, candidates, policy, invoke })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: action })
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it('does not promote a weak action even when the service request is verified', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.requestPurpose
      ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 } } }
      : questions.route
        ? { answers: { route: { choice: 'intent:add-item', confidence: 0.3114 } } }
        : questions.service
          ? { answers: { service: { choice: 'REQUEST', confidence: 0.95 } } }
          : { answers: { cartRequest: { choice: 'SINGLE', confidence: 0.95 } } })
    expect(await decideInteraction({ transcript: '再加牛肉麵', decisionState: state, candidates, policy, invoke })).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
  })

  it.each([
    { choice: 'BACKGROUND', confidence: 0.95, kind: 'IGNORE' },
    { choice: 'HANDOFF', confidence: 0.4, kind: 'UNAVAILABLE' },
    { choice: 'HANDOFF', confidence: Number.NaN, kind: 'UNAVAILABLE' },
    { choice: 'READ_ONLY', confidence: 0.4, kind: 'UNAVAILABLE' },
    { choice: 'UNCERTAIN', confidence: 0.95, kind: 'UNAVAILABLE' },
    { choice: 'invented', confidence: 0.95, kind: 'UNAVAILABLE' },
  ])('does not grant action or handoff for $choice at $confidence', async ({ choice, confidence, kind }) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.requestPurpose
      ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 } } }
      : questions.route
        ? { answers: { route: { choice: 'intent:add-item', confidence: 0.95 } } }
        : { answers: { cartRequest: { choice, confidence } } })
    const result = await decideInteraction({ transcript: '小王，水餃不要，改牛肉麵', decisionState: state, candidates, policy, invoke })
    expect(result.kind).toBe(kind)
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(result).not.toHaveProperty('supersededQuestionId')
  })

  it.each([
    { choice: 'BACKGROUND', confidence: 0.95, kind: 'IGNORE' },
    { choice: 'REQUEST', confidence: 0.4, kind: 'UNAVAILABLE' },
    { choice: 'UNCERTAIN', confidence: 0.95, kind: 'UNAVAILABLE' },
  ])('requires an independently verified recipient before promoting a weak route: $choice', async ({ choice, confidence, kind }) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
      if (questions.route)
        return { answers: { route: { choice: 'intent:add-item', confidence: 0.3114 } } }
      if (questions.requestPurpose)
        return { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 } } }
      if (questions.cartRequest)
        return { answers: { cartRequest: { choice: 'HANDOFF', confidence: 0.95 } } }
      return { answers: { service: { choice, confidence } } }
    })
    const result = await decideInteraction({ transcript: '小王，水餃不要，改牛肉麵', decisionState: state, candidates, policy, invoke })
    expect(result.kind).toBe(kind)
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(result).not.toHaveProperty('supersededQuestionId')
  })

  // Report: this chat, 2026-10-19, session hIHA3DAvjhrG8x0RjggBa, entries 76/78.
  it('recovers the reported weak replacement without executing ADD or answering fulfillment', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
      if (questions.route)
        return { answers: { route: { choice: 'intent:add-item', confidence: 0.5474 } } }
      if (questions.requestPurpose)
        return { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.5638 } } }
      if (questions.cartRequest)
        return { answers: { cartRequest: { choice: 'HANDOFF', confidence: 0.5137 } } }
      if (questions.recipient)
        return { answers: { recipient: { choice: 'KIOSK', confidence: 0.95 } } }
      return { answers: { replacement: { choice: 'REPLACE', confidence: 0.95 } } }
    })
    const result = await decideInteraction({ transcript: '牛肉麵幫我改水餃', decisionState: { ...state, references: [...state.references!.filter(reference => !reference.refId.startsWith('CART_LINE_')), { label: '購物車第1筆紅燒牛肉麵（最近加入）', refId: 'CART_LINE_1' }], waitingFor: { questionId: 'F1', purpose: 'fulfillment', question: '請問要內用還是自取？', expiresAt: Date.now() + 30_000, choices: [] } }, candidates, policy, invoke, includeTrace: true })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
    expect(result).not.toHaveProperty('actionId')
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(result).not.toHaveProperty('supersededQuestionId')
    expect(invoke).toHaveBeenCalledTimes(5)
  })

  it.each([
    { recipient: 'OTHER', recipientConfidence: 0.95, replacement: 'REPLACE', replacementConfidence: 0.95, kind: 'IGNORE' },
    { recipient: 'KIOSK', recipientConfidence: 0.4, replacement: 'REPLACE', replacementConfidence: 0.95, kind: 'UNAVAILABLE' },
    { recipient: 'UNCERTAIN', recipientConfidence: 0.95, replacement: 'REPLACE', replacementConfidence: 0.95, kind: 'UNAVAILABLE' },
    { recipient: 'KIOSK', recipientConfidence: 0.95, replacement: 'OTHER', replacementConfidence: 0.95, kind: 'NEEDS_ASSISTANT' },
    { recipient: 'KIOSK', recipientConfidence: 0.95, replacement: 'UNCERTAIN', replacementConfidence: 0.95, kind: 'UNAVAILABLE' },
    { recipient: 'KIOSK', recipientConfidence: 0.95, replacement: 'REPLACE', replacementConfidence: 0.59, kind: 'NEEDS_ASSISTANT' },
    { recipient: 'KIOSK', recipientConfidence: 0.95, replacement: 'REPLACE', replacementConfidence: Number.NaN, kind: 'UNAVAILABLE' },
    { recipient: 'KIOSK', recipientConfidence: 0.95, replacement: 'invented', replacementConfidence: 0.95, kind: 'UNAVAILABLE' },
  ])('keeps weak replacement recovery bounded: $recipient/$recipientConfidence/$replacement/$replacementConfidence', async ({ recipient, recipientConfidence, replacement, replacementConfidence, kind }) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
      if (questions.route)
        return { answers: { route: { choice: 'intent:add-item', confidence: 0.5474 } } }
      if (questions.requestPurpose)
        return { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.5638 } } }
      if (questions.cartRequest)
        return { answers: { cartRequest: { choice: 'HANDOFF', confidence: 0.5137 } } }
      if (questions.recipient)
        return { answers: { recipient: { choice: recipient, confidence: recipientConfidence } } }
      return { answers: { replacement: { choice: replacement, confidence: replacementConfidence } } }
    })
    const result = await decideInteraction({ transcript: '牛肉麵幫我改水餃', decisionState: state, candidates, policy, invoke })
    expect(result.kind).toBe(kind)
    expect(result).not.toHaveProperty('actionId')
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(result).not.toHaveProperty('supersededQuestionId')
  })

  it('recovers a weak compound replacement before inquiry-only recovery can drop its mutation scope', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
      if (questions.route)
        return { answers: { route: { choice: 'MULTI_ACTION', confidence: 0.2147 } } }
      if (questions.recipient)
        return { answers: { recipient: { choice: 'KIOSK', confidence: 0.9997 } } }
      if (questions.replacement)
        return { answers: { replacement: { choice: 'REPLACE', confidence: 0.95 } } }
      return { answers: { menuInquiry: { choice: 'QUERY', confidence: 0.95 } } }
    })
    const result = await decideInteraction({ transcript: '水餃不要，改牛肉麵', decisionState: state, candidates: [...candidates, { id: 'intent:search-menu', description: '查詢餐點。' }], policy, invoke })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
    expect(result).not.toHaveProperty('actionId')
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(result).not.toHaveProperty('supersededQuestionId')
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(invoke.mock.calls.some(([, questions]) => questions.menuInquiry)).toBe(false)
  })

  it('suspends a partial route until whole-request coverage is resumed and verified', async () => {
    const stages = createDecisionStages()
    const owner = { deviceId: 'cart-coverage', visitorSessionId: 'synthetic-visitor' }
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.requestPurpose
      ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 } } }
      : questions.route
        ? { answers: { route: { choice: 'intent:add-item', confidence: 0.3114 } } }
        : questions.service
          ? { answers: { service: { choice: 'REQUEST', confidence: 0.95 } } }
          : { answers: { cartRequest: { choice: 'HANDOFF', confidence: 0.95 } } })
    let result = await stages.start(owner, checkpoint => decideInteraction({ transcript: '水餃不要，改牛肉麵', decisionState: state, candidates, policy, invoke: checkpoint(invoke), includeTrace: true }))
    expect(result).toMatchObject({ kind: 'DECISION_PROGRESS', question: 'route', choice: 'intent:add-item' })
    expect(invoke).toHaveBeenCalledTimes(1)
    if (result.kind !== 'DECISION_PROGRESS')
      throw new Error('Expected a suspended route')
    result = await stages.next(owner, result.continuationId)
    expect(result).toMatchObject({ kind: 'DECISION_PROGRESS', question: 'requestPurpose', choice: 'OPERATION' })
    if (result.kind !== 'DECISION_PROGRESS')
      throw new Error('Expected suspended request purpose')
    result = await stages.next(owner, result.continuationId)
    expect(result).toMatchObject({ kind: 'DECISION_PROGRESS', question: 'cartRequest', choice: 'HANDOFF' })
    if (result.kind !== 'DECISION_PROGRESS')
      throw new Error('Expected suspended coverage')
    result = await stages.next(owner, result.continuationId)
    expect(result).toMatchObject({ kind: 'DECISION_PROGRESS', question: 'service', choice: 'REQUEST' })
    if (result.kind !== 'DECISION_PROGRESS')
      throw new Error('Expected suspended recipient check')
    result = await stages.next(owner, result.continuationId)
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', modelCalls: 4, modelQuestions: 4 })
    expect(result).not.toHaveProperty('answeredQuestionId')
  })

  // Report: /Users/charleswang/.codex/attachments/aa9a2bda-c7af-41ca-a0d3-c4cb1bc04309/貼上的文字.txt
  it('checks first-item purchase authority without replacing the correctly recognized order', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.requestPurpose
      ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 } } }
      : questions.route
        ? { answers: { route: { choice: 'intent:add-item', confidence: 0.9676 } } }
        : { answers: { cartRequest: { choice: 'SINGLE', confidence: 0.95 } } })
    expect(await decideInteraction({ transcript: '水餃一份', decisionState: { ...state, catalogEvidence: { products: [{ label: '水餃', matchedText: '水餃', source: 'name' }], categories: [] }, productResolution: { status: 'exact', count: 1, references: [{ label: '水餃', refId: 'ITEM_1' }] }, references: [{ label: '水餃', refId: 'ITEM_1' }], interactionState: { screen: 'menu', matchingCartLines: 0 } }, candidates, policy, invoke })).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:add-item' })
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it.each([
    { coverage: 'SINGLE', routeConfidence: 0.95, kind: 'FAST_ACTION', reason: undefined },
    { coverage: 'SINGLE', routeConfidence: 0.3, kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' },
    { coverage: 'HANDOFF', kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' },
    { coverage: 'BACKGROUND', kind: 'IGNORE', reason: undefined },
    { coverage: 'READ_ONLY', kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE' },
  ])('requires independent route and coverage authority after uncertain purpose: $coverage/$routeConfidence', async ({ coverage, routeConfidence, kind, reason }) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
      if (questions.route)
        return { answers: { route: { choice: 'intent:add-item', confidence: routeConfidence ?? 0.95 } } }
      if (questions.requestPurpose)
        return { answers: { requestPurpose: { choice: 'INQUIRY', confidence: 0.3 } } }
      if (questions.cartRequest)
        return { answers: { cartRequest: { choice: coverage, confidence: 0.95 } } }
      return { answers: { service: { choice: 'REQUEST', confidence: 0.95 } } }
    })
    const result = await decideInteraction({ transcript: coverage === 'SINGLE' ? '再加牛肉麵一份' : '水餃換牛肉麵一份', decisionState: state, candidates, policy, invoke })
    expect(result.kind).toBe(kind)
    expect(result.reason).toBe(reason)
    if (kind === 'FAST_ACTION')
      expect(result).toMatchObject({ actionId: 'intent:add-item' })
    else
      expect(result).not.toHaveProperty('actionId')
    expect(result).not.toHaveProperty('answeredQuestionId')
  })

  it.each([true, false])('recovers a pure query from a proposed purchase, with existing cart %s', async (hasCart) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
      if (questions.route)
        return { answers: { route: { choice: 'intent:add-item', confidence: 0.95 } } }
      if (questions.requestPurpose)
        return { answers: { requestPurpose: { choice: 'INQUIRY', confidence: 0.95 } } }
      if (questions.cartRequest)
        return { answers: { cartRequest: { choice: 'READ_ONLY', confidence: 0.95 } } }
      if (questions.service)
        return { answers: { service: { choice: 'REQUEST', confidence: 0.95 } } }
      return { answers: { filterRequirement: { choice: 'COVERED', confidence: 0.95 }, filterPresence: { choice: 'NO_FILTER', confidence: 0.95 } } }
    })
    const result = await decideInteraction({ transcript: '有哪種水餃？', decisionState: { ...state, references: hasCart ? state.references : [] }, candidates: [...candidates, { id: 'intent:search-menu', description: '查詢餐點。' }], policy, invoke, includeTrace: true })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:search-menu', trace: { rawAnswer: { choice: 'intent:add-item' } } })
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(invoke).toHaveBeenCalledTimes(5)
  })

  it('keeps recovered queries behind normal filter validation', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
      if (questions.route)
        return { answers: { route: { choice: 'intent:add-item', confidence: 0.95 } } }
      if (questions.requestPurpose)
        return { answers: { requestPurpose: { choice: 'INQUIRY', confidence: 0.95 } } }
      if (questions.cartRequest)
        return { answers: { cartRequest: { choice: 'READ_ONLY', confidence: 0.95 } } }
      if (questions.service)
        return { answers: { service: { choice: 'REQUEST', confidence: 0.95 } } }
      return { answers: { filterRequirement: { choice: 'UNSUPPORTED_FILTER', confidence: 0.95 }, filterPresence: { choice: 'REQUIRED', confidence: 0.95 } } }
    })
    expect(await decideInteraction({ transcript: '水餃有保證不會過敏的嗎？', decisionState: state, candidates: [...candidates, { id: 'intent:search-menu', description: '查詢餐點。' }], policy, invoke })).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNSUPPORTED_FILTER' })
  })

  it.each([
    { choice: 'KIOSK', confidence: 0.95, kind: 'FAST_ACTION' },
    { choice: 'OTHER', confidence: 0.95, kind: 'IGNORE' },
    { choice: 'UNCERTAIN', confidence: 0.95, kind: 'UNAVAILABLE' },
    { choice: 'KIOSK', confidence: 0.4, kind: 'UNAVAILABLE' },
    { choice: 'KIOSK', confidence: Number.NaN, kind: 'UNAVAILABLE' },
  ])('checks read recipient independently of a confident route: $choice/$confidence', async ({ choice, confidence, kind }) => {
    const waitingFor = { questionId: 'F1', purpose: 'fulfillment', question: '內用還是自取？', expiresAt: Date.now() + 30_000, choices: [] }
    const invoke = vi.fn(async (input: string, questions: Record<string, SystemOneQuestion>) => {
      if (questions.route)
        return { answers: { route: { choice: 'intent:search-menu', confidence: 0.95 } } }
      // The clerk's proposal, cart and prior dialogue must not imply that the
      // customer is addressing this kiosk. Only their literal speech is scoped.
      if (questions.recipient)
        expect(JSON.parse(input)).toEqual({ customerUtterance: '小王，我問你有哪種牛肉麵？' })
      return { answers: { recipient: { choice, confidence }, filterRequirement: { choice: 'COVERED', confidence: 0.95 }, filterPresence: { choice: 'NO_FILTER', confidence: 0.95 } } }
    })
    const result = await decideInteraction({ transcript: '小王，我問你有哪種牛肉麵？', decisionState: { ...state, waitingFor }, candidates: [{ id: 'intent:search-menu', description: '查詢餐點。' }], conversation: { messages: [{ role: 'assistant', content: '請選擇餐點。' }] }, policy, invoke })
    expect(result.kind).toBe(kind)
    expect(result).not.toHaveProperty('answeredQuestionId')
  })
})
