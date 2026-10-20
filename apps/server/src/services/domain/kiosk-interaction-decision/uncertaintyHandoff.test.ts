import type { SystemOneQuestion } from '../kiosk-system-one'

import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'

const policy = { decisionInstruction: '', storeInstruction: '' }

describe('semantic uncertainty handoff', () => {
  // Report: this chat, 2026-10-20 — low confidence relinquishes Fast Path, not the customer request.
  it.each(['ordering', 'checkout_invoice', 'pending_confirmation'] as const)('hands a weak ordinary route to Main in %s without executing or answering a question', async (phase) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.route
      ? { answers: { route: { choice: 'intent:return-menu', confidence: 0.4 } } }
      : { answers: { recipient: { choice: 'KIOSK', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '先回菜單看看', candidates: [{ id: 'intent:return-menu', description: '返回菜單', requiresHighConfidence: true }], decisionState: { phase }, policy, invoke, includeTrace: true })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
    expect(result).not.toHaveProperty('actionId')
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(result).toHaveProperty('trace.rawAnswer.choice', 'intent:return-menu')
    expect(result).toHaveProperty('trace.exchanges', expect.arrayContaining([expect.objectContaining({ questions: expect.objectContaining({ recipient: expect.any(Object) }) })]))
  })

  it.each([
    { recipient: 'OTHER', confidence: 0.95, expected: 'IGNORE' },
    { recipient: 'KIOSK', confidence: 0.4, expected: 'UNAVAILABLE' },
    { recipient: 'UNCERTAIN', confidence: 0.95, expected: 'UNAVAILABLE' },
  ])('keeps recipient admission independent of weak intent: $recipient/$confidence', async ({ recipient, confidence, expected }) => {
    const invoke = async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.route
      ? { answers: { route: { choice: 'intent:return-menu', confidence: 0.4 } } }
      : { answers: { recipient: { choice: recipient, confidence } } }
    const result = await decideInteraction({ transcript: '小王，回去看看', candidates: [{ id: 'intent:return-menu', description: '返回菜單', requiresHighConfidence: true }], decisionState: { phase: 'ordering' }, policy, invoke })
    expect(result.kind).toBe(expected)
    expect(result).not.toHaveProperty('actionId')
  })

  it('does not interpret a low-confidence IGNORE as a confirmed background turn', async () => {
    const result = await decideInteraction({ transcript: '先等等，讓我看看', candidates: [], decisionState: { phase: 'ordering' }, policy, invoke: async (_state, questions) => questions.route
      ? { answers: { route: { choice: 'IGNORE', confidence: 0.4 } } }
      : { answers: { recipient: { choice: 'KIOSK', confidence: 0.95 } } } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
  })

  it('does not execute a low-confidence action just because its candidate has no high-confidence flag', async () => {
    const result = await decideInteraction({ transcript: '我看看剛剛點的', candidates: [{ id: 'intent:view-cart', description: '查看購物車', requiresHighConfidence: false }], decisionState: { phase: 'ordering' }, policy, invoke: async (_state, questions) => questions.route
      ? { answers: { route: { choice: 'intent:view-cart', confidence: 0.55 } } }
      : { answers: { recipient: { choice: 'KIOSK', confidence: 0.95 } } } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
    expect(result).not.toHaveProperty('actionId')
  })

  it('revokes a weak action even when its recipient cannot be qualified', async () => {
    const result = await decideInteraction({ transcript: '我看看剛剛點的', candidates: [{ id: 'intent:view-cart', description: '查看購物車', requiresHighConfidence: false }], decisionState: { phase: 'ordering' }, policy, invoke: async (_state, questions) => questions.route
      ? { answers: { route: { choice: 'intent:view-cart', confidence: 0.55 } } }
      : { answers: { recipient: { choice: 'KIOSK', confidence: 0.4 } } } })
    expect(result.kind).toBe('UNAVAILABLE')
    expect(result).not.toHaveProperty('actionId')
  })

  it.each([Number.NaN, -0.1, 1.1])('does not turn invalid provider confidence into semantic handoff: %s', async (confidence) => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'intent:return-menu', confidence } } }))
    const result = await decideInteraction({ transcript: '回菜單', candidates: [{ id: 'intent:return-menu', description: '返回菜單', requiresHighConfidence: true }], decisionState: { phase: 'ordering' }, policy, invoke })
    expect(result.kind).not.toBe('NEEDS_ASSISTANT')
  })

  it('does not exceed the utterance budget to invent recipient admission', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'intent:return-menu', confidence: 0.4 } } }))
    const result = await decideInteraction({ transcript: '回去看看', candidates: [{ id: 'intent:return-menu', description: '返回菜單', requiresHighConfidence: true }], decisionState: { phase: 'ordering' }, policy, invoke, maxQuestions: 1, includeTrace: true })
    expect(result.kind).toBe('UNAVAILABLE')
    expect(invoke).toHaveBeenCalledOnce()
    expect(result).toHaveProperty('modelQuestions', 1)
    expect(result).toHaveProperty('trace.exchanges', expect.arrayContaining([expect.objectContaining({ index: 1, status: 'answered' })]))
  })
})
