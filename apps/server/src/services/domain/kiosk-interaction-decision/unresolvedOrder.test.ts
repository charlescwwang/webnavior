import { expect, it, vi } from 'vitest'

import { decideInteraction } from '.'

// Report: attachment b0b98800, 2026-10-21; no eel item matched, only the 麵食 category did.
it('hands a category-only order to Main despite the recorded high-confidence ADD/SINGLE choices', async () => {
  const transcript = '鱔魚意麵3份，不要蔥花，一份大辣兩份小辣'
  const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.route
    ? { answers: { route: { choice: 'intent:add-item', confidence: 0.8762 } } }
    : questions.requestPurpose ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.8404 } } } : { answers: { cartRequest: { choice: 'SINGLE', confidence: 0.99 } } })
  const result = await decideInteraction({ transcript, includeTrace: true, candidates: [{ id: 'intent:add-item', description: '新增顧客要求的餐點。', requiresHighConfidence: true }], decisionState: { phase: 'ordering', productResolution: { status: 'none', count: 0, references: [] }, catalogEvidence: { products: [], categories: [{ label: '麵食', matchedText: '麵', itemCount: 1 }] }, references: [{ label: '麵食分類', refId: 'CATEGORY_1' }, { label: '紅燒牛肉麵', refId: 'ITEM_1' }] }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke })
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', trace: { transcript }, modelCalls: 3 })
  expect(result).not.toHaveProperty('actionId')
})
