export const kioskSpeechGuardLabels = ['ORDER_INTENT', 'AGENT_RESPONSE', 'KIOSK_COMMAND', 'BACKGROUND_CONVERSATION', 'AMBIGUOUS'] as const
export type KioskSpeechGuardLabel = typeof kioskSpeechGuardLabels[number]

export interface KioskSpeechPrototype {
  embedding: readonly number[]
  label: KioskSpeechGuardLabel
  requiresContext: boolean
}

export interface KioskSpeechEvaluationRow {
  embedding: readonly number[]
  expectedLabel: KioskSpeechGuardLabel
  hasMatchingDialogueContext: boolean
}

/**
 * Classifies a candidate against separately embedded examples. Labels never
 * enter the embedding request: they are only used after nearest-neighbour
 * search to aggregate an explainable, context-constrained result.
 */
export function classifySpeechCandidate(input: {
  candidateEmbedding: readonly number[]
  hasMatchingDialogueContext: boolean
  prototypes: readonly KioskSpeechPrototype[]
  topK?: number
}) {
  const topK = input.topK ?? 3
  const scores = new Map<KioskSpeechGuardLabel, number[]>()
  for (const prototype of input.prototypes) {
    if (prototype.requiresContext && !input.hasMatchingDialogueContext)
      continue
    const score = cosineSimilarity(input.candidateEmbedding, prototype.embedding)
    if (score === undefined)
      continue
    const labelScores = scores.get(prototype.label) ?? []
    labelScores.push(score)
    scores.set(prototype.label, labelScores)
  }

  const ranked = kioskSpeechGuardLabels
    .map((label) => {
      const scoresForLabel = scores.get(label) ?? []
      const strongest = scoresForLabel.sort((left, right) => right - left).slice(0, topK)
      return { label, score: strongest.length === 0 ? undefined : strongest.reduce((sum, value) => sum + value, 0) / strongest.length }
    })
    .filter((entry): entry is { label: KioskSpeechGuardLabel, score: number } => entry.score !== undefined)
    .sort((left, right) => right.score - left.score)

  const best = ranked[0]
  return {
    label: best?.label ?? 'AMBIGUOUS',
    score: best?.score,
  }
}

/** Summarizes a fixed benchmark without retaining its utterance text. */
export function evaluateSpeechGuard(input: {
  prototypes: readonly KioskSpeechPrototype[]
  rows: readonly KioskSpeechEvaluationRow[]
}) {
  const byExpectedLabel = new Map<KioskSpeechGuardLabel, { correct: number, total: number }>()
  let correct = 0
  for (const row of input.rows) {
    const predicted = classifySpeechCandidate({
      candidateEmbedding: row.embedding,
      hasMatchingDialogueContext: row.hasMatchingDialogueContext,
      prototypes: input.prototypes,
    }).label
    const summary = byExpectedLabel.get(row.expectedLabel) ?? { correct: 0, total: 0 }
    summary.total++
    if (predicted === row.expectedLabel) {
      correct++
      summary.correct++
    }
    byExpectedLabel.set(row.expectedLabel, summary)
  }
  return {
    accuracy: input.rows.length === 0 ? undefined : correct / input.rows.length,
    byExpectedLabel: kioskSpeechGuardLabels.map(label => ({
      correct: byExpectedLabel.get(label)?.correct ?? 0,
      label,
      total: byExpectedLabel.get(label)?.total ?? 0,
    })),
    total: input.rows.length,
  }
}

function cosineSimilarity(left: readonly number[], right: readonly number[]) {
  if (left.length === 0 || left.length !== right.length)
    return undefined
  let dotProduct = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index++) {
    const leftValue = left[index]
    const rightValue = right[index]
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue))
      return undefined
    dotProduct += leftValue * rightValue
    leftMagnitude += leftValue ** 2
    rightMagnitude += rightValue ** 2
  }
  return leftMagnitude === 0 || rightMagnitude === 0
    ? undefined
    : dotProduct / Math.sqrt(leftMagnitude * rightMagnitude)
}
