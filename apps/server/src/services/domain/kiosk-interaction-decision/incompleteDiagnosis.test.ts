import { describe, expect, it } from 'vitest'

import { decideInteraction } from '.'

describe('complete missing-item complaint accepted as unfinished speech diagnosis', () => {
  // Report: /Users/charleswang/.codex/attachments/600f4a56-89c4-42d3-9eb0-497bd187de1f/貼上的文字.txt
  // NOTICE: Replay the recorded choice locally to test application admission,
  // not live model accuracy. No customer trace is sent to a provider.
  it('reproduces the silent-wait result without history, a pending question or action candidates', async () => {
    const result = await decideInteraction({
      transcript: '牛肉麵沒點到',
      candidates: [],
      policy: { decisionInstruction: '', storeInstruction: '' },
      includeTrace: true,
      invoke: async () => ({ answers: { route: { choice: 'INCOMPLETE', confidence: 0.3286 } } }),
    })
    expect(result).toMatchObject({ kind: 'INCOMPLETE', confidence: 0.3286, modelCalls: 1, modelQuestions: 1 })
    expect(result).toHaveProperty('trace.rawAnswer', expect.objectContaining({ choice: 'INCOMPLETE', confidence: 0.3286 }))
  })

  // NOTICE: Opt-in expected-safe probe stays red until the admission policy is
  // repaired; passing diagnostic controls below do not mean this bug is fixed.
  it.skipIf(process.env.KIOSK_INCOMPLETE_DIAGNOSIS !== '1')('does not confidently declare the complete service complaint unfinished from an uncertain provider choice', async () => {
    const result = await decideInteraction({
      transcript: '牛肉麵沒點到',
      candidates: [],
      policy: { decisionInstruction: '', storeInstruction: '' },
      invoke: async () => ({ answers: { route: { choice: 'INCOMPLETE', confidence: 0.3286 } } }),
    })
    expect(result.kind).not.toBe('INCOMPLETE')
  })

  // Report: /Users/charleswang/.codex/attachments/a6f483f0-f574-4275-81ae-eded7ecf0f71/貼上的文字.txt
  it.each([
    { choice: 'intent:add-item', confidence: 0.2836, kind: 'UNAVAILABLE' },
    { choice: 'intent:add-item', confidence: 0.95, kind: 'FAST_ACTION' },
    { choice: 'NEEDS_ASSISTANT', confidence: 0.2836, kind: 'UNAVAILABLE' },
    { choice: 'NEEDS_ASSISTANT', confidence: 0.95, kind: 'NEEDS_ASSISTANT' },
    { choice: 'INCOMPLETE', confidence: 0.2836, kind: 'INCOMPLETE' },
  ])('compares admission for the same complaint through $choice at confidence $confidence', async ({ choice, confidence, kind }) => {
    const result = await decideInteraction({
      transcript: '你沒有點到我的牛肉麵',
      candidates: [{ id: 'intent:add-item', description: '新增指定餐點', requiresHighConfidence: true }],
      policy: { decisionInstruction: '', storeInstruction: '' },
      includeTrace: true,
      invoke: async () => ({ answers: { route: { choice, confidence } } }),
    })
    expect(result.kind).toBe(kind)
    expect(result.modelCalls).toBe(1)
    expect(result.modelQuestions).toBe(1)
    expect(result.answeredQuestionId).toBeUndefined()
    expect(result.supersededQuestionId).toBeUndefined()
    if (result.kind === 'FAST_ACTION')
      expect(result.actionId).toBe('intent:add-item')
  })

  it.each([
    { transcript: '牛肉麵沒點到', choice: 'INCOMPLETE', confidence: 0.3286, kind: 'INCOMPLETE' },
    { transcript: '你沒有點到我的牛肉麵', choice: 'intent:add-item', confidence: 0.2836, kind: 'UNAVAILABLE' },
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
      invoke: async () => ({ answers: { route: { choice, confidence } } }),
    })
    expect(result.kind).toBe(kind)
    expect(result).toHaveProperty('trace.decisionState', expect.stringContaining('牛肉麵一碗，排骨便當一份'))
    expect(result).toHaveProperty('trace.decisionState', expect.stringContaining('請問要內用還是自取？'))
    expect(result.modelCalls).toBe(1)
    expect(result.answeredQuestionId).toBeUndefined()
    expect(result.supersededQuestionId).toBeUndefined()
  })
})

describe('complete category request accepted as confidently unfinished speech diagnosis', () => {
  // Report: /Users/charleswang/.codex/attachments/98897f0e-91a9-42da-bf21-3c2975d8d2d9/貼上的文字.txt
  // NOTICE: These fixed-choice controls retain category evidence but omit prior
  // dialogue. They isolate admission, not the cause of the live model's choice.
  it.each([
    { choice: 'INCOMPLETE', kind: 'INCOMPLETE' },
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
      invoke: async (_state, questions) => questions.route
        ? { answers: { route: { choice, confidence: 0.7969 } } }
        : { answers: { filterRequirement: { choice: 'COVERED', confidence: 0.95 }, filterPresence: { choice: 'NO_FILTER', confidence: 0.95 } } },
    })
    expect(result.kind).toBe(kind)
    expect(result).toHaveProperty('trace.decisionState', expect.stringContaining('"matchedText":"麵"'))
    expect(result).toHaveProperty('trace.candidateIntents', expect.arrayContaining([expect.objectContaining({ id: 'intent:search-menu' })]))
    if (result.kind === 'FAST_ACTION')
      expect(result.actionId).toBe('intent:search-menu')
  })

  it.skipIf(process.env.KIOSK_INCOMPLETE_DIAGNOSIS !== '1')('does not treat the complete category request as unfinished just because provider confidence is high', async () => {
    const result = await decideInteraction({
      transcript: '想吃麵',
      candidates: [{ id: 'intent:search-menu', description: '瀏覽餐點分類', requiresHighConfidence: false }],
      policy: { decisionInstruction: '', storeInstruction: '' },
      invoke: async () => ({ answers: { route: { choice: 'INCOMPLETE', confidence: 0.7969 } } }),
    })
    expect(result.kind).not.toBe('INCOMPLETE')
  })
})
