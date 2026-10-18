import type { SystemOneQuestion } from '../kiosk-system-one'

import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'

const policy = { decisionInstruction: '', storeInstruction: '' }
const candidates = [{ id: 'intent:search-menu', description: '查詢餐點、分類及條件，不新增訂單。', requiresHighConfidence: false }]

function provider(routeConfidence: number, speech = 'QUERY', scope = 'REQUEST') {
  return vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
    if (questions.route)
      return { answers: { route: { choice: 'INCOMPLETE', confidence: routeConfidence } } }
    if (questions.service)
      return { answers: { service: { choice: scope, confidence: 0.95 } } }
    if (questions.speech)
      return { answers: { speech: { choice: speech, confidence: 0.95 } } }
    return { answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, filterRequirement: { choice: 'COVERED', confidence: 0.95 }, filterPresence: { choice: 'NO_FILTER', confidence: 0.95 } } }
  })
}

describe('category browsing and unfinished speech', () => {
  // Report: /Users/charleswang/.codex/attachments/10a4a496-486a-4837-a525-0f8c418b50c5/貼上的文字.txt
  it.each([
    { transcript: '小點心之類的', category: '點心', confidence: 0.3233 },
    { transcript: '湯類呢', category: '湯類', confidence: 0.85 },
    { transcript: '麵的有嗎', category: '麵食', confidence: 0.4 },
    { transcript: '套餐這類的', category: '套餐', confidence: 0.8 },
  ])('recovers $transcript through the existing read route without answering the older question', async ({ transcript, category, confidence }) => {
    const invoke = provider(confidence)
    const result = await decideInteraction({ transcript, candidates, policy, invoke, includeTrace: true, conversation: { messages: [{ role: 'user', content: '還有賣其他的嗎' }, { role: 'assistant', content: '先介紹這幾樣餐點。' }] }, decisionState: { phase: 'ordering', catalogEvidence: { products: [], categories: [{ label: category, matchedText: category, itemCount: 1 }] }, waitingFor: { questionId: 'fulfillment-fixture', purpose: 'fulfillment', question: '請問要內用還是自取？', expiresAt: Date.now() + 30000, choices: [{ id: 'intent:set-fulfillment:dine-in', description: '設為內用。' }] } } })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:search-menu', confidence: 0.95 })
    expect(result.answeredQuestionId).toBeUndefined()
    expect(result.supersededQuestionId).toBeUndefined()
    expect(result).toHaveProperty('trace.rawAnswer', { choice: 'INCOMPLETE', confidence })
    expect(invoke.mock.calls.find(([, questions]) => questions.speech)?.[0]).not.toContain('請問要內用還是自取')
  })

  it.each(['BACKGROUND', 'UNCERTAIN'])('does not turn a category mention into a read when the recipient is $scope', async (scope) => {
    const invoke = provider(0.3, 'QUERY', scope)
    const result = await decideInteraction({ transcript: '小陳，你說小點心之類的嗎', candidates, policy, invoke, decisionState: { phase: 'ordering', catalogEvidence: { products: [], categories: [{ label: '點心', matchedText: '點心', itemCount: 1 }] } } })
    expect(result.kind).toBe(scope === 'BACKGROUND' ? 'IGNORE' : 'UNAVAILABLE')
    expect(invoke.mock.calls.some(([, questions]) => questions.speech)).toBe(false)
  })

  it('rechecks low-confidence unfinished speech before waiting for the next fragment', async () => {
    const result = await decideInteraction({ transcript: '我要一份……', candidates, policy, invoke: provider(0.3, 'INCOMPLETE'), decisionState: { phase: 'ordering' }, includeTrace: true })
    expect(result).toMatchObject({ kind: 'INCOMPLETE', confidence: 0.95, modelCalls: 3 })
  })

  it('hands an admitted complete request to the assistant without granting an action', async () => {
    const result = await decideInteraction({ transcript: '剛剛那道沒有點到', candidates, policy, invoke: provider(0.3, 'REQUEST'), decisionState: { phase: 'ordering' } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', confidence: 0.95 })
    expect(result).not.toHaveProperty('actionId')
  })

  it('retains normal filter validation after recovering a category query', async () => {
    const base = provider(0.3)
    const result = await decideInteraction({ transcript: '點心類，但要保證沒有過敏風險', candidates, policy, decisionState: { phase: 'ordering', catalogEvidence: { products: [], categories: [{ label: '點心', matchedText: '點心', itemCount: 1 }] } }, invoke: (state, questions) => questions.filterRequirement ? Promise.resolve({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, filterRequirement: { choice: 'UNSUPPORTED_FILTER', confidence: 0.95 } } }) : base(state, questions) })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNSUPPORTED_FILTER' })
    expect(result).not.toHaveProperty('actionId')
  })
})
