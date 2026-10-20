import type { SystemOneQuestion } from '../kiosk-system-one'

import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'

describe('optional phone entry routing', () => {
  it.each([Number.NaN, -0.1, 1.1])('rejects malformed phone confidence rather than admitting an uncertain request: %s', async (confidence) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.service
      ? { answers: { service: { choice: 'REQUEST', confidence: 0.8808 } } }
      : { answers: { phone: { choice: 'SKIP', confidence } } })
    const result = await decideInteraction({ transcript: '水餃一份 啊 我不要了', candidates: [], decisionState: { phase: 'customer_entry' }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke })
    expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION' })
    expect(result).not.toHaveProperty('actionId')
  })

  // Report: this chat, 2026-10-20 — recorded phone-page REQUEST0.8808 / ORDER0.3861.
  it.each(['ORDER', 'SKIP', 'ENTER', 'ASK', 'MENU'])('hands uncertain %s meaning to Main without choosing phone entry or placing an order', async (choice) => {
    const transcript = '水餃一份 啊 我不要了'
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.service
      ? { answers: { service: { choice: 'REQUEST', confidence: 0.8808 } } }
      : { answers: { phone: { choice, confidence: 0.3861 } } })
    const result = await decideInteraction({ transcript, candidates: [{ id: 'intent:skip-customer-entry', description: '略過電話', requiresHighConfidence: true }], decisionState: { phase: 'customer_entry' }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke, includeTrace: true })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
    expect(result).not.toHaveProperty('actionId')
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(result).toHaveProperty('trace.transcript', transcript)
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it.each([
    { choice: 'RANGE', confidence: 0.95, reason: 'MENU_QUERY', expectedChoice: 'RANGE' },
    { choice: 'UNSUPPORTED', confidence: 0.95, reason: 'UNSUPPORTED_PRICE', expectedChoice: 'UNSUPPORTED' },
    { choice: 'RANGE', confidence: 0.3, reason: 'UNCERTAIN_FILTER', expectedChoice: undefined },
    { choice: 'not-issued', confidence: 0.95, reason: 'UNCERTAIN_FILTER', expectedChoice: undefined },
  ])('qualifies the phone-stage price query before Agent handoff: $choice/$confidence', async ({ choice, confidence, reason, expectedChoice }) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.service
      ? { answers: { service: { choice: 'REQUEST', confidence: 0.95 } } }
      : questions.phone
        ? { answers: { phone: { choice: 'MENU', confidence: 0.95 } } }
        : { answers: { price: { choice, confidence } } })
    const result = await decideInteraction({ transcript: '有100~130之間的嗎？', candidates: [{ id: 'intent:skip-customer-entry', description: '略過電話' }], decisionState: { phase: 'customer_entry', priceEvidence: { amounts: [{ text: '100', amount: 100 }, { text: '130', amount: 130 }], choices: [{ id: 'RANGE', kind: 'condition', conditions: { minPrice: 100, maxPrice: 130 }, description: '單份100至130' }, { id: 'UNSUPPORTED', kind: 'unsupported', description: '不支援的價格需求' }] } }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason })
    if (expectedChoice)
      expect(result).toMatchObject({ priceChoiceId: expectedChoice })
    else
      expect(result).not.toHaveProperty('priceChoiceId')
    expect(result).not.toHaveProperty('actionId')
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it('answers a direct greeting without skipping or answering the phone question', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.service
      ? { answers: { service: { choice: 'HELLO_ONLY', confidence: 0.95 } } }
      : { answers: { phone: { choice: 'SKIP', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '你好', candidates: [{ id: 'intent:skip-customer-entry', description: '略過電話' }], decisionState: { phase: 'customer_entry', waitingFor: { questionId: 'phone-question', purpose: 'customer-entry', question: '填寫電話或略過？', expiresAt: Date.now() + 60_000, choices: [{ id: 'intent:skip-customer-entry', description: '略過電話' }] } }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke })
    expect(result).toMatchObject({ kind: 'GREET' })
    expect(result).not.toHaveProperty('actionId')
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it.each([
    { scope: 'BACKGROUND', confidence: 0.95, phone: 'SKIP', expected: 'IGNORE', calls: 1 },
    { scope: 'HELLO_ONLY', confidence: 0.3, phone: 'SKIP', expected: 'UNAVAILABLE', calls: 1 },
    { scope: 'REQUEST', confidence: 0.3, phone: 'SKIP', expected: 'UNAVAILABLE', calls: 1 },
    { scope: 'UNCERTAIN', confidence: 0.95, phone: 'SKIP', expected: 'UNAVAILABLE', calls: 1 },
    { scope: 'REQUEST', confidence: 0.95, phone: 'ENTER', expected: 'NEEDS_ASSISTANT', calls: 2 },
    { scope: 'REQUEST', confidence: 0.95, phone: 'ASK', expected: 'NEEDS_ASSISTANT', calls: 2 },
    { scope: 'REQUEST', confidence: 0.95, phone: 'MENU', expected: 'NEEDS_ASSISTANT', calls: 2 },
    { scope: 'REQUEST', confidence: 0.95, phone: 'ORDER', expected: 'CUSTOMER_ENTRY_REQUIRED', calls: 2 },
    { scope: 'HELLO_ONLY', confidence: 0.95, phone: 'SKIP', expected: 'GREET', calls: 1 },
  ])('keeps $scope and $phone separate from skip authorization', async ({ scope, confidence, phone, expected, calls }) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.service
      ? { answers: { service: { choice: scope, confidence } } }
      : { answers: { phone: { choice: phone, confidence: 0.95 } } })
    expect(await decideInteraction({ transcript: '人工語句', candidates: [{ id: 'intent:skip-customer-entry', description: '略過電話' }], decisionState: { phase: 'customer_entry' }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke })).toMatchObject({ kind: expected })
    expect(invoke).toHaveBeenCalledTimes(calls)
  })

  it.each(['推薦一下', '我要水餃一份', '還有其他推薦嗎'])('requires the optional phone choice before %s without issuing an order', async (transcript) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.service ? { answers: { service: { choice: 'REQUEST', confidence: 0.95 } } } : { answers: { phone: { choice: 'ORDER', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript, candidates: [{ id: 'intent:skip-customer-entry', description: '略過電話' }], decisionState: { phase: 'customer_entry' }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke })
    expect(result).toMatchObject({ kind: 'CUSTOMER_ENTRY_REQUIRED' })
    expect(result).not.toHaveProperty('actionId')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('uses the current phone choice rather than the full ordering classifier for short skip answers', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.service
      ? { answers: { service: { choice: 'REQUEST', confidence: 0.95 } } }
      : { answers: { phone: { choice: 'SKIP', confidence: 0.95 } } })
    expect(await decideInteraction({ transcript: '略過', candidates: [{ id: 'intent:skip-customer-entry', description: '略過自願電話登記', requiresHighConfidence: true }], decisionState: { phase: 'customer_entry' }, policy: { decisionInstruction: '複雜點餐設定', storeInstruction: '' }, invoke })).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:skip-customer-entry' })
    const [state, questions] = invoke.mock.calls[1]!
    expect(state).toContain('略過')
    expect(questions.phone.criteria).not.toHaveProperty('INCOMPLETE')
    expect(questions.phone.instructions).not.toContain('ADD_ITEM')
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})
