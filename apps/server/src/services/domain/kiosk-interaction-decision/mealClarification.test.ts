import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'

const policy = { decisionInstruction: '', storeInstruction: '' }

describe('admitted service clarification', () => {
  it.each([
    { scope: 'REQUEST', confidence: 0.95, purpose: 'UNCERTAIN', expected: 'NEEDS_CLARIFICATION', calls: 2 },
    { scope: 'BACKGROUND', confidence: 0.95, purpose: 'CONFIRM', expected: 'IGNORE', calls: 1 },
    { scope: 'REQUEST', confidence: 0.3, purpose: 'CONFIRM', expected: 'UNAVAILABLE', calls: 1 },
  ])('separates $scope at $confidence from uncertainty about the intended operation', async ({ scope, confidence, purpose, expected, calls }) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.service
      ? { answers: { service: { choice: scope, confidence } } }
      : { answers: { purpose: { choice: purpose, confidence: 0.9 } } })
    const result = await decideInteraction({ transcript: '酸辣魚便當', candidates: [], decisionState: { phase: 'configuration', clarificationOffer: { id: 'offer1', label: '泰式酸辣魚便當' } }, policy, invoke })
    expect(result.kind).toBe(expected)
    expect(invoke).toHaveBeenCalledTimes(calls)
    if (result.kind === 'UNAVAILABLE')
      expect(result.reason).toBe('UNCERTAIN_RECIPIENT')
  })
  it.each([
    { choice: 'CLARIFY_REQUEST', confidence: 0.95, expected: 'NEEDS_CLARIFICATION' },
    { choice: 'CLARIFY_REQUEST', confidence: 0.3, expected: 'UNAVAILABLE' },
    { choice: 'IGNORE', confidence: 0.95, expected: 'IGNORE' },
  ])('keeps $choice at $confidence separate from unrelated or unreliable speech', async ({ choice, confidence, expected }) => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice, confidence } } }))
    expect(await decideInteraction({ transcript: '牛肉麵', candidates: [], decisionState: { phase: 'ordering', clarificationOffer: { id: 'offer1', label: '紅燒牛肉麵' } }, policy, invoke })).toMatchObject({ kind: expected })
    expect(invoke).toHaveBeenCalledTimes(confidence < 0.6 ? 2 : 1)
  })

  it('does not accept clarification without an application-issued offer', async () => {
    expect(await decideInteraction({ transcript: '什麼', candidates: [], decisionState: { phase: 'ordering' }, policy, invoke: async () => ({ answers: { route: { choice: 'CLARIFY_REQUEST', confidence: 0.95 } } }) })).toMatchObject({ kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE' })
  })

  it.each([{ answer: 'YES', suffix: 'yes' }, { answer: 'NO', suffix: 'no' }])('binds $answer to the live meal question in one model call', async ({ answer, suffix }) => {
    const choices = [{ id: 'confirm-meal:Q1:yes', description: '是' }, { id: 'confirm-meal:Q1:no', description: '不是' }]
    const invoke = vi.fn(async () => ({ answers: { route: { choice: answer, confidence: 0.95 } } }))
    expect(await decideInteraction({ transcript: suffix === 'yes' ? '對' : '不是', candidates: choices, decisionState: { phase: 'meal_confirmation', waitingFor: { questionId: 'Q1', purpose: 'confirm-meal', question: '您是要點紅燒牛肉麵嗎？', expiresAt: Date.now() + 30_000, choices } }, policy, invoke })).toMatchObject({ kind: 'FAST_ACTION', actionId: `confirm-meal:Q1:${suffix}`, answeredQuestionId: 'Q1' })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it.each([
    { recipient: 'REQUEST', confidence: 0.95, expected: 'FAST_ACTION' },
    { recipient: 'BACKGROUND', confidence: 0.95, expected: 'IGNORE' },
    { recipient: 'UNCERTAIN', confidence: 0.95, expected: 'UNAVAILABLE' },
    { recipient: 'REQUEST', confidence: 0.3, expected: 'UNAVAILABLE' },
  ])('verifies the $recipient recipient before resolving a pending meal query', async ({ recipient, confidence, expected }) => {
    const choices = [{ id: 'confirm-meal:Q1:yes', description: '是' }, { id: 'confirm-meal:Q1:no', description: '不是' }]
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.service
      ? { answers: { service: { choice: recipient, confidence } } }
      : { answers: { route: { choice: 'READ', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '我想問還有沒有', candidates: [...choices, { id: 'inquire-meal:Q1', description: '查詢目前餐點是否可點。', requiresHighConfidence: true }], decisionState: { phase: 'meal_confirmation', waitingFor: { questionId: 'Q1', purpose: 'confirm-meal', question: '您是要點紅燒牛肉麵嗎？', expiresAt: Date.now() + 30_000, choices } }, policy, invoke })
    expect(result.kind).toBe(expected)
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(JSON.parse(invoke.mock.calls[1]![0])).toEqual({ customerUtterance: '我想問還有沒有' })
    if (result.kind === 'FAST_ACTION')
      expect(result.actionId).toBe('inquire-meal:Q1')
  })
})
