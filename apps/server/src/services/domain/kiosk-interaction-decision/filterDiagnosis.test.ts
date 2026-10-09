import { describe, expect, it } from 'vitest'

import { decideInteraction } from '.'

function replay(confidence: number) {
  return decideInteraction({
    transcript: '有水餃嗎',
    policy: { decisionInstruction: '', storeInstruction: '' },
    includeTrace: true,
    candidates: [{ id: 'intent:search-menu', description: '查詢餐點', requiresHighConfidence: false }],
    decisionState: {
      phase: 'ordering',
      productResolution: { status: 'exact', count: 1, references: [{ refId: 'ITEM_1', label: '水餃' }] },
    },
    invoke: async (_state: string, questions: Record<string, unknown>) => questions.route
      ? { answers: { route: { choice: 'intent:search-menu', confidence: 0.9657 } } }
      : { answers: {
          filterRequirement: { choice: 'COVERED', confidence: 0.9523 },
          filterPresence: { choice: 'NO_FILTER', probabilities: { REQUIRED: 0.254, NO_FILTER: 0.746 }, confidence },
        } },
  })
}

describe('recorded plain dish query filter diagnosis', () => {
  // Report: local customer attachment 73501877-3461-473f-a91b-5e08a42549ad, no public URL.
  // NOTICE: Frozen provider choices isolate the false handoff, not live model
  // accuracy. This expected-safe probe remains opt-in red; no policy fix is made.
  it.skipIf(process.env.KIOSK_FILTER_DIAGNOSIS !== '1')('keeps the captured exact dish query on the finite search path', async () => {
    expect(await replay(0.4919)).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:search-menu' })
  })

  it.each([0.4919, 0.4999, 0.5])('isolates the filter confidence cutoff at %s while keeping its choice and probabilities fixed', async (confidence) => {
    const result = await replay(confidence)
    expect(result).toHaveProperty('trace.rawAnswer', expect.objectContaining({ choice: 'intent:search-menu', confidence: 0.9657 }))
    expect(result).toMatchObject({ trace: { filterPresence: { choice: 'NO_FILTER', probabilities: { NO_FILTER: 0.746 }, confidence } } })
    expect(result.modelQuestions).toBe(3)
    if (confidence < 0.5)
      expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER' })
    else
      expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:search-menu' })
  })
})
