import type { SystemOneQuestion } from '../kiosk-system-one'

import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'

const policy = { decisionInstruction: '', storeInstruction: '' }

describe('open menu preferences belong to the main Agent', () => {
  // Report: this chat, 2026-10-19 — variable phrasing must not require more Jev candidates.
  it.each(['還有什麼？我不要便當', '不想吃麵，要素食', '不要飯', '素食優先，麵先不用', '不是不要便當，是不要炸的'])('hands off the whole utterance without extracting ingredient slots: %s', async (transcript) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
      if (questions.route)
        return { answers: { route: { choice: 'intent:search-menu', confidence: 0.95 } } }
      if (questions.recipient)
        return { answers: { recipient: { choice: 'KIOSK', confidence: 0.95 } } }
      expect(Object.keys(questions)).toEqual(['filterRequirement'])
      return { answers: { filterRequirement: { choice: 'OPEN_REQUEST', confidence: 0.95 } } }
    })
    const result = await decideInteraction({ transcript, policy, invoke, includeTrace: true, candidates: [{ id: 'intent:search-menu', description: '查詢菜單' }], decisionState: { phase: 'ordering', ingredientReferences: [{ id: 'rice', label: '米飯' }], catalogEvidence: { products: [], categories: [{ label: '便當', matchedText: '便當', itemCount: 5 }] } } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' })
    expect(result).not.toHaveProperty('ingredientFilters')
    expect(result).not.toHaveProperty('actionId')
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(invoke.mock.calls[2]![0]).toContain(transcript)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.1])('does not admit an unqualified open-request answer at %s', async (confidence) => {
    const invoke = async () => ({ answers: { route: { choice: 'intent:search-menu', confidence: 0.95 }, recipient: { choice: 'KIOSK', confidence: 0.95 }, filterRequirement: { choice: 'OPEN_REQUEST', confidence } } })
    const result = await decideInteraction({ transcript: '不要這類，找其他的', policy, invoke, candidates: [{ id: 'intent:search-menu', description: '查詢菜單' }], decisionState: { phase: 'ordering' } })
    expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION' })
    expect(result).not.toHaveProperty('actionId')
  })

  it.each([{ confidence: 0.95, kind: 'NEEDS_ASSISTANT' }, { confidence: 0.4, kind: 'UNAVAILABLE' }])('requires a reliable read route before handing off uncertain scope: $confidence', async ({ confidence, kind }) => {
    const invoke = async () => ({ answers: { route: { choice: 'intent:search-menu', confidence }, recipient: { choice: 'KIOSK', confidence: 0.95 }, filterRequirement: { choice: 'OPEN_REQUEST', confidence: 0.4 } } })
    const result = await decideInteraction({ transcript: '不要這類，還有其他的嗎', policy, invoke, candidates: [{ id: 'intent:search-menu', description: '查詢菜單' }], decisionState: { phase: 'ordering' } })
    expect(result.kind).toBe(kind)
    expect(result).not.toHaveProperty('actionId')
    if (kind === 'NEEDS_ASSISTANT')
      expect(result.reason).toBe('UNCERTAIN_FILTER')
  })
})
