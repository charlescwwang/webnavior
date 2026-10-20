import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'
import { createRecommendationInvitation } from './contracts'

const policy = { decisionInstruction: '', storeInstruction: '' }

describe('finite answers to the current question', () => {
  // Report: local attachment eda15e0f-3084-41f3-91e4-d711b23d04e1; no public URL.
  it('validates captured 好啊 at route confidence 0.5289 before accepting an invitation', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, route: { choice: 'intent:recommend', confidence: 0.5289 } } })
      .mockResolvedValueOnce({ answers: { relation: { choice: 'intent:recommend', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { filterRequirement: { choice: 'COVERED', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { filterPresence: { choice: 'NO_FILTER', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '好啊', policy, invoke, includeTrace: true, candidates: [{ id: 'intent:recommend', description: '推薦三項，不新增訂購', requiresHighConfidence: false }], decisionState: { phase: 'ordering', waitingFor: createRecommendationInvitation('I1', Date.now()) } })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:recommend', answeredQuestionId: 'I1', confidence: 0.95, modelCalls: 4, modelQuestions: 4 })
    expect(invoke.mock.calls[1]?.[1]).toHaveProperty('relation.criteria.intent:recommend')
    expect(invoke.mock.calls[1]?.[1]).not.toHaveProperty('relation.criteria.ANSWER')
  })

  it.each([
    { transcript: '不用', route: 'intent:recommend', reply: 'DECLINE_INVITATION', kind: 'IGNORE', calls: 2 },
    { transcript: '好啊', route: 'DECLINE_INVITATION', reply: 'intent:recommend', kind: 'FAST_ACTION', calls: 4 },
  ])('corrects the initial invitation hypothesis for $transcript', async ({ transcript, route, reply, kind, calls }) => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { route: { choice: route, confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { relation: { choice: reply, confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { filterRequirement: { choice: 'COVERED', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { filterPresence: { choice: 'NO_FILTER', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript, policy, invoke, includeTrace: true, candidates: [{ id: 'intent:recommend', description: '推薦三項' }], decisionState: { phase: 'ordering', waitingFor: createRecommendationInvitation('I1', Date.now()) } })
    expect(result.kind).toBe(kind)
    expect(result.answeredQuestionId).toBe('I1')
    expect(result.supersededQuestionId).toBeUndefined()
    expect(result.modelCalls).toBe(calls)
    if (result.kind === 'FAST_ACTION')
      expect(result.actionId).toBe('intent:recommend')
  })

  it.each([
    { purpose: 'party-size', phase: 'ordering', transcript: '一位', id: 'intent:set-party-size', question: '幾位用餐？', description: '設定內用人數為一位' },
    { purpose: 'fulfillment', phase: 'ordering', transcript: '內用', id: 'intent:set-fulfillment:dine-in', question: '內用還是自取？', description: '設定內用' },
    { purpose: 'checkout-entry', phase: 'ordering', transcript: '好', id: 'intent:start-checkout', question: '開始結帳嗎？', description: '同意開始結帳，尚不付款' },
    { purpose: 'tax-id', phase: 'checkout_tax_id', transcript: '統編12345678', id: 'intent:set-tax-id', question: '請提供统編', description: '帶入本句已驗證的八位統編' },
    { purpose: 'payment-method', phase: 'checkout_payment_select', transcript: '信用卡', id: 'intent:select-payment:card', question: '信用卡還是行動支付？', description: '選信用卡，仍須付款確認' },
    { purpose: 'item-configuration', phase: 'configuration', transcript: '微辣', id: 'configure:Q1:spice:light', question: '辣度要哪一種？', description: '這筆牛肉麵選微辣' },
    { purpose: 'item-clarification', phase: 'clarification', transcript: '牛肉麵', id: 'clarify:Q1:0', question: '牛肉麵還是水餃？', description: '選問題列出的牛肉麵' },
  ])('uses concrete current choices for $purpose, even with a weak route hypothesis', async ({ purpose, phase, transcript, id, question, description }) => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { route: { choice: id, confidence: 0.4 } } })
      .mockResolvedValueOnce({ answers: { relation: { choice: id, confidence: 0.95 } } })
    const result = await decideInteraction({ transcript, policy, invoke, includeTrace: true, candidates: [{ id, description, requiresHighConfidence: true }], decisionState: { phase, waitingFor: { questionId: 'Q1', purpose, question, choices: [{ id, description }], expiresAt: Date.now() + 30000 } } })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: id, confidence: 0.95, modelCalls: 2, modelQuestions: 2 })
    expect(result.answeredQuestionId).toBeUndefined()
    expect(invoke.mock.calls[1]?.[1]).toHaveProperty(`relation.criteria.${id}`)
    expect(invoke.mock.calls[1]?.[1]).not.toHaveProperty('relation.criteria.ANSWER')
  })

  it('corrects a mistaken checkout consent to deferral without starting checkout', async () => {
    const choices = [{ id: 'intent:start-checkout', description: '同意進入結帳，尚不付款' }, { id: 'intent:defer-question', description: '拒絕或暫緩結帳，保留訂單' }]
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { route: { choice: 'intent:start-checkout', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { relation: { choice: 'intent:defer-question', confidence: 0.95 } } })
    expect(await decideInteraction({ transcript: '先不要', policy, invoke, candidates: choices, decisionState: { phase: 'ordering', waitingFor: { questionId: 'Q1', purpose: 'checkout-entry', question: '開始結帳嗎？', choices, expiresAt: Date.now() + 30000 } } })).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:defer-question' })
  })

  it.each([
    { choice: 'intent:recommend', confidence: 0.4 },
    { choice: 'DECLINE_INVITATION', confidence: 0.4 },
    { choice: 'UNCERTAIN', confidence: 0.95 },
    { choice: 'BACKGROUND', confidence: 0.4 },
    { choice: 'intent:recommend', confidence: undefined },
  ])('retains an unresolved invitation for $choice / $confidence without Agent fallback', async (reply) => {
    const waitingFor = createRecommendationInvitation('I1', Date.now())
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, route: { choice: 'intent:recommend', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { relation: reply } })
    const result = await decideInteraction({ transcript: '嗯', policy, invoke, includeTrace: true, candidates: [{ id: 'intent:recommend', description: '推薦三項' }], decisionState: { phase: 'ordering', waitingFor } })
    expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', modelCalls: 2 })
    expect(result.answeredQuestionId).toBeUndefined()
    expect(result.supersededQuestionId).toBeUndefined()
    expect(waitingFor.questionId).toBe('I1')
  })

  it('does not accept an unrelated legal action as an answer to the current question', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, route: { choice: 'intent:recommend', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { relation: { choice: 'intent:add-item', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '好', policy, invoke, candidates: [{ id: 'intent:recommend', description: '推薦三項' }, { id: 'intent:add-item', description: '新增餐點' }], decisionState: { phase: 'ordering', waitingFor: createRecommendationInvitation('I1', Date.now()) } })
    expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE' })
    expect(result.answeredQuestionId).toBeUndefined()
    expect(invoke.mock.calls[1]?.[1]).not.toHaveProperty('relation.criteria.intent:add-item')
  })

  it('does not authorize checkout from a generic ANSWER that omits consent or refusal', async () => {
    const choices = [{ id: 'intent:start-checkout', description: '同意進入結帳' }, { id: 'intent:defer-question', description: '拒絕或暫緩結帳' }]
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { route: { choice: 'intent:start-checkout', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { relation: { choice: 'ANSWER', confidence: 0.95 } } })
    expect(await decideInteraction({ transcript: '先不要', policy, invoke, candidates: choices, decisionState: { phase: 'ordering', waitingFor: { questionId: 'Q1', purpose: 'checkout-entry', question: '開始結帳嗎？', choices, expiresAt: Date.now() + 30000 } } })).toMatchObject({ kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE' })
  })

  it('does not promote a question choice absent from the current action set into execution', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { route: { choice: 'DECLINE_INVITATION', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { relation: { choice: 'intent:recommend', confidence: 0.95 } } })
    expect(await decideInteraction({ transcript: '好啊', policy, invoke, candidates: [], decisionState: { phase: 'ordering', waitingFor: createRecommendationInvitation('I1', Date.now()) } })).toMatchObject({ kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE' })
    expect(invoke.mock.calls[1]?.[1]).not.toHaveProperty('relation.criteria.intent:recommend')
  })

  it('distinguishes refusal plus a new demand from consuming a refusal answer', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { route: { choice: 'DECLINE_INVITATION', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { relation: { choice: 'NEW_REQUEST', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '不用，水餃多少錢？', policy, invoke, candidates: [{ id: 'intent:recommend', description: '推薦三項' }], decisionState: { phase: 'ordering', waitingFor: createRecommendationInvitation('I1', Date.now()) } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', supersededQuestionId: 'I1' })
    expect(result.answeredQuestionId).toBeUndefined()
  })

  it('does not turn a companion answer into accepting the invitation', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, route: { choice: 'intent:recommend', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { relation: { choice: 'BACKGROUND', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '小明，好啊', policy, invoke, candidates: [{ id: 'intent:recommend', description: '推薦三項' }], decisionState: { phase: 'ordering', waitingFor: createRecommendationInvitation('I1', Date.now()) } })
    expect(result.kind).toBe('IGNORE')
    expect(result.answeredQuestionId).toBeUndefined()
    expect(result.supersededQuestionId).toBeUndefined()
  })

  it('allows an explicit new recommendation without reusing an expired question', async () => {
    const waitingFor = createRecommendationInvitation('OLD', Date.now() - 60000)
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, route: { choice: 'intent:recommend', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { filterRequirement: { choice: 'COVERED', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { filterPresence: { choice: 'NO_FILTER', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '推薦三樣餐點', policy, invoke, includeTrace: true, candidates: [{ id: 'intent:recommend', description: '推薦三項' }], decisionState: { phase: 'ordering', waitingFor } })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:recommend', modelCalls: 4 })
    expect(result.answeredQuestionId).toBeUndefined()
    expect(invoke.mock.calls[0]?.[0]).toContain('正在等待回答的問題：null')
  })
})
