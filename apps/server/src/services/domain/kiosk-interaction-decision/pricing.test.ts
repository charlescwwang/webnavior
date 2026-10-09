import type { SystemOneQuestion } from '../kiosk-system-one'
import type { PriceEvidence } from './priceContracts'

import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'

// The decision boundary receives browser-issued interpretations, not a parser
// or raw catalog. Parser and execution coverage live in the Menu app tests.
const evidence: PriceEvidence = { amounts: [{ text: '100元', amount: 100 }], choices: [
  { id: 'UPPER_INCLUSIVE', kind: 'condition', conditions: { maxPrice: 100 }, description: '單份不超過100' },
  { id: 'UPPER_EXCLUSIVE', kind: 'condition', conditions: { maxPrice: 100, maxPriceExclusive: true }, description: '單份低於100' },
  { id: 'INFORMATION', kind: 'information', description: '只詢價' },
  { id: 'NONE', kind: 'none', description: '金額僅為背景' },
  { id: 'UNSUPPORTED', kind: 'unsupported', description: '不支援的價格條件' },
] }

describe('finite price decision', () => {
  it.each(['UPPER_INCLUSIVE', 'UPPER_EXCLUSIVE', 'INFORMATION', 'NONE'])('returns only the issued interpretation: %s', async (choice) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.route
      ? { answers: { route: { choice: 'intent:search-menu', confidence: 0.96 } } }
      : { answers: { price: { choice, confidence: 0.96 }, filterRequirement: { choice: 'COVERED', confidence: 0.96 }, filterPresence: { choice: 'NO_FILTER', confidence: 0.96 } } })
    const result = await decideInteraction({ transcript: '100元以下有什麼便當', decisionState: { phase: 'ordering', priceEvidence: evidence }, candidates: [{ id: 'intent:search-menu', description: '查詢餐點' }], policy: { decisionInstruction: '自訂提示', storeInstruction: '' }, invoke })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', priceChoiceId: choice })
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[1]?.[1].price?.criteria).toHaveProperty('UPPER_INCLUSIVE')
  })
  it.each([{ choice: 'UPPER_INCLUSIVE', confidence: 0.4 }, { choice: 'invented', confidence: 0.99 }, { choice: 'UNSUPPORTED', confidence: 0.99 }])('does not execute uncertain or unoffered conditions: $choice/$confidence', async (price) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.route ? { answers: { route: { choice: 'intent:search-menu', confidence: 0.96 } } } : { answers: { price } })
    expect(await decideInteraction({ transcript: '100元以下', decisionState: { phase: 'ordering', priceEvidence: evidence }, candidates: [{ id: 'intent:search-menu', description: '查詢' }], policy: { decisionInstruction: '', storeInstruction: '' }, invoke })).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
  })
  it('does not ignore a price requirement on a mutation route', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'intent:add-item', confidence: 0.96 } } }))
    expect(await decideInteraction({ transcript: '我要100元以下的水餃兩份', decisionState: { phase: 'ordering', priceEvidence: evidence }, candidates: [{ id: 'intent:add-item', description: '新增' }], policy: { decisionInstruction: '', storeInstruction: '' }, invoke })).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
    expect(invoke).toHaveBeenCalledOnce()
  })
  it('permits an already-classified order only when the currency mention is independently NONE', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.route
      ? { answers: { route: { choice: 'intent:add-item', confidence: 0.96 } } }
      : { answers: { price: { choice: 'NONE', confidence: 0.96 } } })
    expect(await decideInteraction({ transcript: '100元便當來一份', decisionState: { phase: 'ordering', priceEvidence: evidence }, candidates: [{ id: 'intent:add-item', description: '新增品名為100元便當的餐點' }, { id: 'intent:search-menu', description: '查詢' }], policy: { decisionInstruction: '', storeInstruction: '' }, invoke })).toMatchObject({ kind: 'FAST_ACTION', priceChoiceId: 'NONE', actionId: 'intent:add-item' })
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})
