import { describe, expect, it } from 'vitest'

import { classifySpeechCandidate } from '.'

describe('classifySpeechCandidate', () => {
  const prototypes = [
    { embedding: [1, 0], label: 'ORDER_INTENT' as const, requiresContext: false },
    { embedding: [0, 1], label: 'AGENT_RESPONSE' as const, requiresContext: true },
    { embedding: [-1, 0], label: 'AMBIGUOUS' as const, requiresContext: false },
  ]

  it('does not let a context-dependent short response classify without matching dialogue context', () => {
    expect(classifySpeechCandidate({ candidateEmbedding: [0, 1], hasMatchingDialogueContext: false, prototypes })).toMatchObject({ label: 'ORDER_INTENT' })
    expect(classifySpeechCandidate({ candidateEmbedding: [0, 1], hasMatchingDialogueContext: true, prototypes })).toMatchObject({ label: 'AGENT_RESPONSE' })
  })

  it('uses per-label top-k aggregation instead of a single label centroid', () => {
    expect(classifySpeechCandidate({
      candidateEmbedding: [1, 0],
      hasMatchingDialogueContext: false,
      prototypes: [
        { embedding: [1, 0], label: 'ORDER_INTENT', requiresContext: false },
        { embedding: [0.8, 0.2], label: 'ORDER_INTENT', requiresContext: false },
        { embedding: [0, 1], label: 'BACKGROUND_CONVERSATION', requiresContext: false },
      ],
      topK: 2,
    })).toMatchObject({ label: 'ORDER_INTENT' })
  })
})
