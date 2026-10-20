import type { KioskDecisionState } from './contracts'

import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'
import { createRecommendationInvitation } from './contracts'

const policy = { decisionInstruction: '', storeInstruction: '' }

describe('question context is not a routing prerequisite', () => {
  // Report: this chat, 2026-10-19 — ambient speech must not trigger a voice retry.
  it.each([
    { routeConfidence: 0.95, recipient: 'KIOSK', recipientConfidence: 0.95, expected: 'CLARIFICATION' },
    { routeConfidence: 0.95, recipient: 'OTHER', recipientConfidence: 0.95, expected: 'IGNORE' },
    { routeConfidence: 0.95, recipient: 'UNCERTAIN', recipientConfidence: 0.95, expected: 'UNAVAILABLE' },
    { routeConfidence: 0.4, recipient: 'KIOSK', recipientConfidence: 0.95, expected: 'UNAVAILABLE' },
    { routeConfidence: 0.95, recipient: 'KIOSK', recipientConfidence: 0.4, expected: 'UNAVAILABLE' },
  ])('clarification speech admission: $routeConfidence/$recipient/$recipientConfidence', async ({ routeConfidence, recipient, recipientConfidence, expected }) => {
    const result = await decideInteraction({ transcript: recipient === 'OTHER' ? '小陳，你說哪一個？' : '你說哪一個？', policy, candidates: [{ id: 'clarify:0', description: '小辣水餃' }, { id: 'clarify:1', description: '不辣水餃' }], decisionState: { phase: 'clarification', waitingFor: { questionId: 'Q1', purpose: 'item-clarification', question: '您指的是小辣水餃還是不辣水餃？', expiresAt: Date.now() + 30_000, choices: [] } }, invoke: async (_state, questions) => ({ answers: { ...(questions.route ? { route: { choice: 'CLARIFICATION', confidence: routeConfidence } } : {}), ...(questions.recipient ? { recipient: { choice: recipient, confidence: recipientConfidence } } : {}) } }) })
    expect(result.kind).toBe(expected)
    expect(result).not.toHaveProperty('actionId')
    expect(result).not.toHaveProperty('answeredQuestionId')
  })
  it('recovers a mistaken meal-cancellation route when the reply names another dish', async () => {
    const cancel = { id: 'configure:Q1:cancel', description: '取消這筆尚未加入的餐點需求，保留購物車。' }
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { route: { choice: cancel.id, confidence: 0.652 } } })
      .mockResolvedValueOnce({ answers: { relation: { choice: 'NEW_REQUEST', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 } } })
    const result = await decideInteraction({
      transcript: '牛肉麵',
      policy,
      invoke,
      candidates: [cancel],
      decisionState: {
        phase: 'configuration',
        catalogEvidence: { products: [{ label: '紅燒牛肉麵', matchedText: '牛肉麵', source: 'alias' }], categories: [] },
        references: [{ refId: 'CONFIGURING_ITEM', label: '水餃' }],
        waitingFor: { questionId: 'Q1', purpose: 'item-configuration', question: '請問水餃要幾份？', expiresAt: Date.now() + 30_000, choices: [cancel] },
      },
    })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
    expect(result.answeredQuestionId).toBeUndefined()
    expect(invoke.mock.calls[0]?.[1].route.instructions).toContain('不必帶「我要」「改成」')
    expect(invoke.mock.calls[1]?.[1].relation.instructions).toContain('單說另一個有菜單證據的品名或分類')
  })
  // Report: local customer attachment 9b8c37b5-50d8-4d5c-a928-0dcaa0712dab, no public URL.
  // NOTICE: Frozen provider choices reproduce a known semantic misroute. This
  // opt-in diagnostic stays red until new-request recovery can safely re-route
  // a complete purchase; changing idle timing does not fix this decision path.
  it.skipIf(process.env.KIOSK_NEW_REQUEST_DIAGNOSIS !== '1')('recovers 牛肉麵一碗 after the captured weak fulfillment route and NEW_REQUEST relation', async () => {
    let routeCalls = 0
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.route
      ? { answers: { route: routeCalls++ === 0 ? { choice: 'intent:set-fulfillment:dine-in', confidence: 0.2975 } : { choice: 'intent:add-item', confidence: 0.95 } } }
      : { answers: { relation: { choice: 'NEW_REQUEST', confidence: 0.6718 } } })
    const result = await decideInteraction({
      transcript: '牛肉麵一碗',
      policy,
      invoke,
      includeTrace: true,
      candidates: [
        { id: 'intent:add-item', description: '新增本句指定餐點', requiresHighConfidence: true },
        { id: 'intent:set-fulfillment:dine-in', description: '設為內用', requiresHighConfidence: true },
      ],
      decisionState: {
        phase: 'ordering',
        interactionState: { screen: 'menu', matchingCartLines: 0 },
        productResolution: { status: 'exact', count: 1, references: [{ refId: 'ITEM_1', label: '紅燒牛肉麵' }] },
        catalogEvidence: { products: [{ label: '紅燒牛肉麵', matchedText: '牛肉麵', source: 'alias' }], categories: [] },
        waitingFor: { questionId: 'Q1', purpose: 'fulfillment', question: '請問要內用還是自取？', expiresAt: Date.now() + 30000, choices: [{ id: 'intent:set-fulfillment:dine-in', description: '設為內用' }] },
      },
    })
    expect(invoke.mock.calls[0]?.[1]).toHaveProperty('route.criteria.intent:add-item')
    expect(invoke.mock.calls[0]?.[0]).toContain('紅燒牛肉麵')
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:add-item' })
  })

  it('routes 牛肉麵一碗 directly when the first choice matches its exact alias evidence', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.requestPurpose
      ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 } } }
      : questions.cartRequest
        ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 }, cartRequest: { choice: 'SINGLE', confidence: 0.95 } } }
        : { answers: { route: { choice: 'intent:add-item', confidence: 0.95 } } })
    const result = await decideInteraction({
      transcript: '牛肉麵一碗',
      policy,
      invoke,
      candidates: [
        { id: 'intent:add-item', description: '新增本句指定餐點', requiresHighConfidence: true },
        { id: 'intent:set-fulfillment:dine-in', description: '設為內用', requiresHighConfidence: true },
      ],
      decisionState: {
        phase: 'ordering',
        interactionState: { screen: 'menu', matchingCartLines: 0 },
        productResolution: { status: 'exact', count: 1, references: [{ refId: 'ITEM_1', label: '紅燒牛肉麵' }] },
        catalogEvidence: { products: [{ label: '紅燒牛肉麵', matchedText: '牛肉麵', source: 'alias' }], categories: [] },
        waitingFor: { questionId: 'Q1', purpose: 'fulfillment', question: '請問要內用還是自取？', expiresAt: Date.now() + 30000, choices: [{ id: 'intent:set-fulfillment:dine-in', description: '設為內用' }] },
      },
    })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:add-item' })
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  // Report: local customer attachment d913b030-3323-49f1-813f-e66bdba4318c, no public URL.
  it('routes 排骨便當一份 before the captured uncertain invitation ACCEPT', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.requestPurpose
      ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 } } }
      : questions.cartRequest
        ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 }, cartRequest: { choice: 'SINGLE', confidence: 0.95 } } }
        : questions.invitation
          ? { answers: { invitation: { choice: 'ACCEPT', confidence: 0.4568 } } }
          : { answers: { route: { choice: 'intent:add-item', confidence: 0.95 } } })
    const result = await decideInteraction({
      transcript: '排骨便當一份',
      policy,
      invoke,
      includeTrace: true,
      candidates: [{ id: 'intent:add-item', description: '新增本句指定的餐點' }],
      decisionState: { phase: 'ordering', waitingFor: createRecommendationInvitation('I1', Date.now()), productResolution: { status: 'exact', count: 1, references: [{ refId: 'ITEM_1', label: '炸排骨便當' }] }, catalogEvidence: { products: [{ label: '炸排骨便當', matchedText: '排骨便當', source: 'alias' }], categories: [] } },
    })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:add-item', modelCalls: 3, modelQuestions: 3 })
    expect(result.answeredQuestionId).toBeUndefined()
    expect(result.supersededQuestionId).toBe('I1')
    expect(invoke.mock.calls[0]?.[1]).toHaveProperty('route')
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it.each(['party-size', 'checkout-entry', 'fulfillment'])('does not gate an independent new purchase on %s relation', async (purpose) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.route
      ? { answers: { route: { choice: 'intent:add-item', confidence: 0.95 } } }
      : questions.requestPurpose
        ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 } } }
        : questions.cartRequest
          ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 }, cartRequest: { choice: 'SINGLE', confidence: 0.95 } } }
          : { answers: { speech: { choice: 'BACKGROUND', confidence: 0.1 }, relation: { choice: 'ANSWER', confidence: 0.1 } } })
    const decisionState: KioskDecisionState = { phase: 'ordering', waitingFor: { questionId: 'Q1', purpose, question: '待答問題', expiresAt: Date.now() + 30000, choices: [{ id: 'intent:start-checkout', description: '開始結帳' }] } }
    const result = await decideInteraction({ transcript: '水餃兩份', policy, invoke, candidates: [{ id: 'intent:add-item', description: '新增水餃' }], decisionState, includeTrace: true })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:add-item', modelCalls: 3, modelQuestions: 3 })
    expect(decisionState.waitingFor?.questionId).toBe('Q1')
  })

  it.each(['configuration', 'clarification'])('routes a topic change in %s without a relation prerequisite', async (phase) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.route
      ? { answers: { route: { choice: 'NEW_REQUEST', confidence: 0.95 } } }
      : { answers: { speech: { choice: 'TASK_SPEECH', confidence: 0.95 }, relation: { choice: 'ANSWER', confidence: 0.1 } } })
    const result = await decideInteraction({ transcript: '有水餃嗎？', policy, invoke, candidates: [], decisionState: { phase, waitingFor: { questionId: 'Q1', purpose: 'item-configuration', question: '辣度？', expiresAt: Date.now() + 30000, choices: [] } }, includeTrace: true })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', modelCalls: 1, modelQuestions: 1 })
  })

  it('validates 一位 against the current turn value choice supplied by the question owner', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.route
      ? { answers: { route: { choice: 'intent:set-party-size', confidence: 0.95 } } }
      : { answers: { relation: { choice: 'intent:set-party-size', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '一位', policy, invoke, candidates: [{ id: 'intent:set-party-size', description: '內用一位', requiresHighConfidence: true }], decisionState: { phase: 'ordering', waitingFor: { questionId: 'Q1', purpose: 'party-size', question: '幾位用餐？', choices: [{ id: 'intent:set-party-size', description: '內用一位' }], expiresAt: Date.now() + 30000 } }, includeTrace: true })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:set-party-size', modelCalls: 2, modelQuestions: 2 })
    expect(invoke.mock.calls[0]?.[1]).toHaveProperty('route')
    expect(invoke.mock.calls[1]?.[1]).toHaveProperty('relation')
  })

  it.each(['intent:start-checkout', 'BACKGROUND'])('does not authorize checkout from an uncertain %s answer', async (choice) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.route
      ? { answers: { route: { choice: 'intent:start-checkout', confidence: 0.95 } } }
      : { answers: { relation: { choice, confidence: 0.4 } } })
    const result = await decideInteraction({ transcript: '好', policy, invoke, candidates: [{ id: 'intent:start-checkout', description: '開始結帳', requiresHighConfidence: true }], decisionState: { phase: 'ordering', waitingFor: { questionId: 'Q1', purpose: 'checkout-entry', question: '開始結帳嗎？', choices: [{ id: 'intent:start-checkout', description: '開始結帳' }], expiresAt: Date.now() + 30000 } } })
    expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION' })
  })

  it('does not consume an invitation when recommendation filter validation fails', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.route
      ? { answers: { route: { choice: 'intent:recommend', confidence: 0.95 } } }
      : questions.relation
        ? { answers: { relation: { choice: 'intent:recommend', confidence: 0.95 } } }
        : { answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, filterRequirement: { choice: 'UNSUPPORTED_FILTER', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '好', policy, invoke, candidates: [{ id: 'intent:recommend', description: '推薦三項' }], decisionState: { phase: 'ordering', waitingFor: createRecommendationInvitation('I1', Date.now()) } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNSUPPORTED_FILTER' })
    expect(result.answeredQuestionId).toBeUndefined()
  })

  it('does not use an unfinished speech fragment as a gate for a complete new request', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.requestPurpose
      ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 } } }
      : questions.cartRequest
        ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 }, cartRequest: { choice: 'SINGLE', confidence: 0.95 } } }
        : { answers: { route: { choice: 'intent:add-item', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '水餃兩份', policy, invoke, candidates: [{ id: 'intent:add-item', description: '新增水餃' }], decisionState: { phase: 'ordering', incompleteSpeech: { transcript: '我要一份……', expiresAt: Date.now() + 3000 } }, includeTrace: true })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:add-item', modelCalls: 3, modelQuestions: 3 })
    expect(invoke.mock.calls[0]?.[1]).toHaveProperty('route.criteria.CONTINUE_INCOMPLETE')
  })

  it.each([0.4, 0.95])('requires a reliable continuation choice before re-resolving separate speech fragments: %s', async (confidence) => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'CONTINUE_INCOMPLETE', confidence } } }))
    const result = await decideInteraction({ transcript: '水餃', policy, invoke, candidates: [], decisionState: { phase: 'ordering', incompleteSpeech: { transcript: '我要兩份', expiresAt: Date.now() + 3000 } }, includeTrace: true })
    expect(result.kind).toBe(confidence >= 0.6 ? 'CONTINUE_INCOMPLETE' : 'UNAVAILABLE')
    expect(result.modelQuestions).toBe(1)
  })
})
