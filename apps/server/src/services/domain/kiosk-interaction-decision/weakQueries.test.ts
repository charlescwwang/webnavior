import type { SystemOneQuestion } from '../kiosk-system-one'
import type { KioskDecisionState } from './contracts'

import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'

const policy = { decisionInstruction: '', storeInstruction: '' }
const candidates = [{ id: 'intent:search-menu', description: '查詢餐點是否存在，不新增訂單。', requiresHighConfidence: false }]
const state: KioskDecisionState = {
  phase: 'ordering',
  catalogEvidence: { products: [], categories: [{ label: '便當', matchedText: '便當', itemCount: 5 }] },
  productResolution: { status: 'none', count: 0, references: [] },
  ingredientReferences: [{ id: 'fish', label: '魚' }],
  interactionState: { screen: 'menu', lastAddedItemName: '炸排骨便當', matchingCartLines: 0 },
  waitingFor: { questionId: 'fulfillment-fixture', purpose: 'fulfillment', question: '請問要內用還是自取？', expiresAt: Date.now() + 30000, choices: [{ id: 'intent:set-fulfillment:dine-in', description: '設為內用。' }] },
}

describe('weak menu-query route recovery', () => {
  it('does not broaden an unmatched named dish into its category or general recommendations', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.route
      ? { answers: { route: { choice: 'intent:search-menu', confidence: 0.6027 } } }
      : questions.recipient
        ? { answers: { recipient: { choice: 'KIOSK', confidence: 0.95 } } }
        : { answers: { 'filterRequirement': { choice: 'COVERED', confidence: 0.95 }, 'filterPresence': { choice: 'UNRESOLVED_SUBJECT', confidence: 0.95 }, 'ingredient:fish': { choice: 'NONE', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '有雞腿飯嗎？', decisionState: state, candidates, policy, invoke })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' })
    expect(result).not.toHaveProperty('actionId')
    expect(result).not.toHaveProperty('answeredQuestionId')
  })

  it.each([
    { speech: '有雞腿飯嗎？', choice: 'QUERY', confidence: 0.95, kind: 'NEEDS_ASSISTANT' },
    { speech: '咖哩飯有哪些？', choice: 'QUERY', confidence: 0.95, kind: 'NEEDS_ASSISTANT' },
    { speech: '我要魚排便當一份', choice: 'OTHER', confidence: 0.95, kind: 'NEEDS_ASSISTANT' },
    { speech: '有魚排便當就幫我加一份', choice: 'OTHER', confidence: 0.95, kind: 'NEEDS_ASSISTANT' },
    { speech: '外面下雨嗎？', choice: 'OTHER', confidence: 0.95, kind: 'IGNORE' },
    { speech: '有沒有……', choice: 'UNCERTAIN', confidence: 0.95, kind: 'NEEDS_ASSISTANT' },
    { speech: '有魚排便當？', choice: 'QUERY', confidence: 0.59, kind: 'NEEDS_ASSISTANT' },
    { speech: '有魚排便當？', choice: 'QUERY', confidence: Number.NaN, kind: 'UNAVAILABLE' },
    { speech: '有魚排便當？', choice: 'QUERY', confidence: 1.1, kind: 'UNAVAILABLE' },
    { speech: '有魚排便當？', choice: 'INVENTED', confidence: 0.95, kind: 'UNAVAILABLE' },
  ])('hands unresolved meaning to Main after recipient admission for $speech/$choice/$confidence', async ({ speech, choice, confidence, kind }) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.route
      ? { answers: { route: { choice: 'NEEDS_ASSISTANT', confidence: 0.3454 } } }
      : questions.recipient
        ? { answers: { recipient: { choice: 'KIOSK', confidence: 0.9987 } } }
        : { answers: { serviceRequest: { choice: speech === '外面下雨嗎？' ? 'BACKGROUND' : 'REQUEST', confidence: 0.95 }, menuInquiry: { choice, confidence } } })
    const result = await decideInteraction({ transcript: speech, decisionState: state, candidates, policy, invoke })
    expect(result.kind).toBe(kind)
    expect(result).not.toHaveProperty('actionId')
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(result).not.toHaveProperty('supersededQuestionId')
  })

  it.each([{ choice: 'OTHER', confidence: 0.95, kind: 'IGNORE' }, { choice: 'KIOSK', confidence: 0.4, kind: 'UNAVAILABLE' }, { choice: 'UNCERTAIN', confidence: 0.95, kind: 'UNAVAILABLE' }])('does not recover unqualified speech: $choice/$confidence', async ({ choice, confidence, kind }) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.route
      ? { answers: { route: { choice: 'NEEDS_ASSISTANT', confidence: 0.3454 } } }
      : { answers: { recipient: { choice, confidence } } })
    const result = await decideInteraction({ transcript: '小王，有魚排便當？', decisionState: state, candidates, policy, invoke })
    expect(result.kind).toBe(kind)
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  // Report: /Users/charleswang/.codex/attachments/a4c50e1a-e9e2-46a9-87a2-62994e871936/貼上的文字.txt
  it('admits an independently verified menu inquiry without inventing a matched product or answering fulfillment', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
      if (questions.route)
        return { answers: { route: { choice: 'NEEDS_ASSISTANT', confidence: 0.3454 } } }
      if (questions.recipient)
        return { answers: { recipient: { choice: 'KIOSK', confidence: 0.9987 } } }
      return { answers: { menuInquiry: { choice: 'QUERY', confidence: 0.95 } } }
    })
    const result = await decideInteraction({ transcript: '有魚排便當？', decisionState: state, candidates, policy, invoke, includeTrace: true })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', confidence: 0.95 })
    expect(result).not.toHaveProperty('actionId')
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(result).not.toHaveProperty('supersededQuestionId')
    expect(result).toHaveProperty('trace.rawAnswer', { choice: 'NEEDS_ASSISTANT', confidence: 0.3454 })
    expect(invoke).toHaveBeenCalledTimes(3)
  })
})
