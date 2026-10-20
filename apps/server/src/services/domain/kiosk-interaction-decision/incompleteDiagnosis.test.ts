import type { SystemOneQuestion } from '../kiosk-system-one'

import { describe, expect, it } from 'vitest'

import { decideInteraction } from '.'

// Preserve the recorded first choice while supplying the new bounded recovery
// exchanges. These are application regressions, not live model measurements.
function replay(choice: string, confidence: number, speech = 'REQUEST') {
  return async (_state: string, questions: Record<string, SystemOneQuestion>) => {
    if (questions.route)
      return { answers: { route: { choice, confidence } } }
    if (questions.cartRequest)
      return { answers: { cartRequest: { choice: 'UNCERTAIN', confidence: 0.95 } } }
    if (questions.requestPurpose)
      return { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 } } }
    if (questions.service)
      return { answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, filterRequirement: { choice: 'COVERED', confidence: 0.95 }, filterPresence: { choice: 'NO_FILTER', confidence: 0.95 } } }
    if (questions.speech)
      return { answers: { speech: { choice: speech, confidence: 0.95 } } }
    return { answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, filterRequirement: { choice: 'COVERED', confidence: 0.95 }, filterPresence: { choice: 'NO_FILTER', confidence: 0.95 } } }
  }
}

describe('recorded missing-item complaint recovery', () => {
  // Report: /Users/charleswang/.codex/attachments/600f4a56-89c4-42d3-9eb0-497bd187de1f/貼上的文字.txt
  // NOTICE: Replay the recorded choice locally to test application admission,
  // not live model accuracy. No customer trace is sent to a provider.
  it('recovers a weak unfinished choice without history, a pending question or action candidates', async () => {
    const result = await decideInteraction({
      transcript: '牛肉麵沒點到',
      candidates: [],
      policy: { decisionInstruction: '', storeInstruction: '' },
      includeTrace: true,
      invoke: replay('INCOMPLETE', 0.3286),
    })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', confidence: 0.95, modelCalls: 3, modelQuestions: 3 })
    expect(result).toHaveProperty('trace.rawAnswer', expect.objectContaining({ choice: 'INCOMPLETE', confidence: 0.3286 }))
  })

  // Report: /Users/charleswang/.codex/attachments/a6f483f0-f574-4275-81ae-eded7ecf0f71/貼上的文字.txt
  it.each([
    { choice: 'intent:add-item', confidence: 0.2836, kind: 'NEEDS_ASSISTANT' },
    { choice: 'intent:add-item', confidence: 0.95, kind: 'FAST_ACTION' },
    { choice: 'NEEDS_ASSISTANT', confidence: 0.2836, kind: 'NEEDS_ASSISTANT' },
    { choice: 'NEEDS_ASSISTANT', confidence: 0.95, kind: 'NEEDS_ASSISTANT' },
    { choice: 'INCOMPLETE', confidence: 0.2836, kind: 'NEEDS_ASSISTANT' },
  ])('compares admission for the same complaint through $choice at confidence $confidence', async ({ choice, confidence, kind }) => {
    const result = await decideInteraction({
      transcript: '你沒有點到我的牛肉麵',
      candidates: [{ id: 'intent:add-item', description: '新增指定餐點', requiresHighConfidence: true }],
      policy: { decisionInstruction: '', storeInstruction: '' },
      includeTrace: true,
      invoke: replay(choice, confidence),
    })
    expect(result.kind).toBe(kind)
    expect(result.modelCalls).toBe(choice === 'INCOMPLETE' ? 3 : confidence < 0.6 ? 2 : 1)
    expect(result.modelQuestions).toBe(choice === 'INCOMPLETE' ? 3 : confidence < 0.6 ? 2 : 1)
    expect(result.answeredQuestionId).toBeUndefined()
    expect(result.supersededQuestionId).toBeUndefined()
    if (result.kind === 'FAST_ACTION')
      expect(result.actionId).toBe('intent:add-item')
  })

  it.each([
    { transcript: '牛肉麵沒點到', choice: 'INCOMPLETE', confidence: 0.3286, kind: 'NEEDS_ASSISTANT' },
    { transcript: '你沒有點到我的牛肉麵', choice: 'intent:add-item', confidence: 0.2836, kind: 'NEEDS_ASSISTANT' },
  ])('retains dialogue and the pending fulfillment question while reproducing $transcript', async ({ transcript, choice, confidence, kind }) => {
    const waitingFor = {
      questionId: 'Q1',
      purpose: 'fulfillment',
      question: '請問要內用還是自取？',
      expiresAt: Date.now() + 30000,
      choices: [{ id: 'intent:set-fulfillment:dine-in', description: '設為內用' }],
    }
    const result = await decideInteraction({
      transcript,
      candidates: [{ id: 'intent:add-item', description: '新增指定餐點', requiresHighConfidence: true }, { id: 'intent:set-fulfillment:dine-in', description: '設為內用', requiresHighConfidence: true }],
      conversation: { messages: [{ role: 'user', content: '牛肉麵一碗，排骨便當一份' }, { role: 'assistant', content: '已加入排骨便當。請問要內用還是自取？' }] },
      decisionState: { phase: 'ordering', interactionState: { screen: 'menu', matchingCartLines: 0 }, waitingFor },
      policy: { decisionInstruction: '', storeInstruction: '' },
      includeTrace: true,
      invoke: replay(choice, confidence),
    })
    expect(result.kind).toBe(kind)
    expect(result).toHaveProperty('trace.decisionState', expect.stringContaining('牛肉麵一碗，排骨便當一份'))
    expect(result).toHaveProperty('trace.decisionState', expect.stringContaining('請問要內用還是自取？'))
    expect(result.modelCalls).toBe(choice === 'INCOMPLETE' ? 3 : 4)
    expect(result.answeredQuestionId).toBeUndefined()
    expect(result.supersededQuestionId).toBeUndefined()
  })
})

describe('recorded complete category request recovery', () => {
  // Report: /Users/charleswang/.codex/attachments/10a4a496-486a-4837-a525-0f8c418b50c5/貼上的文字.txt
  // Recorded-choice replay tests application admission, not live model accuracy.
  it.each([
    { choice: 'INCOMPLETE', confidence: 0.3233, kind: 'FAST_ACTION' },
    { choice: 'intent:search-menu', confidence: 0.95, kind: 'FAST_ACTION' },
  ])('replays the snack-category follow-up with $choice without answering fulfillment', async ({ choice, confidence, kind }) => {
    const result = await decideInteraction({
      transcript: '小點心之類的',
      candidates: [{ id: 'intent:search-menu', description: '查詢餐點或分類，不新增訂單。', requiresHighConfidence: false }, { id: 'intent:set-fulfillment:dine-in', description: '這筆訂單設為內用。', requiresHighConfidence: true }],
      conversation: { messages: [{ role: 'user', content: '還有賣其他的嗎' }, { role: 'assistant', content: '推薦三樣便當、麵類餐點。' }] },
      decisionState: {
        phase: 'ordering',
        catalogEvidence: { products: [], categories: [{ label: '點心', matchedText: '點心', itemCount: 1 }] },
        productResolution: { status: 'none', count: 0, references: [] },
        references: [{ refId: 'CATEGORY_1', label: '點心分類' }],
        waitingFor: { questionId: 'fulfillment-fixture', purpose: 'fulfillment', question: '請問要內用還是自取？', expiresAt: Date.now() + 30000, choices: [{ id: 'intent:set-fulfillment:dine-in', description: '這筆訂單設為內用。' }] },
      },
      policy: { decisionInstruction: '', storeInstruction: '' },
      includeTrace: true,
      invoke: replay(choice, confidence, 'QUERY'),
    })
    expect(result.kind).toBe(kind)
    expect(result.answeredQuestionId).toBeUndefined()
    expect(result.supersededQuestionId).toBeUndefined()
    if (result.kind === 'FAST_ACTION')
      expect(result.actionId).toBe('intent:search-menu')
  })

  // Report: /Users/charleswang/.codex/attachments/98897f0e-91a9-42da-bf21-3c2975d8d2d9/貼上的文字.txt
  // NOTICE: These fixed-choice controls retain category evidence but omit prior
  // dialogue. They isolate admission, not the cause of the live model's choice.
  it.each([
    { choice: 'INCOMPLETE', kind: 'FAST_ACTION' },
    { choice: 'intent:search-menu', kind: 'FAST_ACTION' },
  ])('compares the complete category request with provider choice $choice', async ({ choice, kind }) => {
    const result = await decideInteraction({
      transcript: '想吃麵',
      candidates: [{ id: 'intent:search-menu', description: '只說想吃某分類而未指定數量，是瀏覽分類，即使分類只有一道菜也不等於訂購。', requiresHighConfidence: false }],
      decisionState: {
        phase: 'ordering',
        catalogEvidence: { products: [], categories: [{ label: '麵食', matchedText: '麵', itemCount: 1 }] },
        productResolution: { status: 'none', count: 0, references: [] },
        references: [{ refId: 'CATEGORY_1', label: '麵食分類' }, { refId: 'ITEM_1', label: '紅燒牛肉麵' }],
      },
      policy: { decisionInstruction: '', storeInstruction: '' },
      includeTrace: true,
      invoke: replay(choice, 0.7969, 'QUERY'),
    })
    expect(result.kind).toBe(kind)
    expect(result).toHaveProperty('trace.decisionState', expect.stringContaining('"matchedText":"麵"'))
    expect(result).toHaveProperty('trace.candidateIntents', expect.arrayContaining([expect.objectContaining({ id: 'intent:search-menu' })]))
    if (result.kind === 'FAST_ACTION')
      expect(result.actionId).toBe('intent:search-menu')
  })
})
