/** Strategies exist only when the POS supplies current ranking evidence. */
export type RecommendationStrategy = 'POPULAR' | 'NEW_ARRIVAL' | 'CHEF_SPECIAL'

/** Rank is ascending within one POS strategy/window, never inferred from catalog order. */
export interface RecommendationSignal {
  strategy: RecommendationStrategy
  rank: number
  source: 'pos' | 'merchant'
  asOf: string
  expiresAt: string
}

/** Validates optional POS ranking evidence before publishing it to browser/model consumers. */
export function parseRecommendationSignals(value: unknown): RecommendationSignal[] {
  if (value === undefined)
    return []
  if (!Array.isArray(value) || value.length > 3)
    throw new Error('Invalid POS recommendation signals.')
  const strategies = new Set<string>()
  return value.map((raw): RecommendationSignal => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Invalid POS recommendation signal.')
    const signal = raw as Record<string, unknown>
    const { strategy, rank, source, asOf, expiresAt } = signal
    if ((strategy !== 'POPULAR' && strategy !== 'NEW_ARRIVAL' && strategy !== 'CHEF_SPECIAL')
      || typeof rank !== 'number' || !Number.isSafeInteger(rank) || rank < 1
      || (source !== 'pos' && source !== 'merchant')
      || typeof asOf !== 'string' || !Number.isFinite(Date.parse(asOf))
      || typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))
      || Date.parse(expiresAt) <= Date.parse(asOf) || strategies.has(strategy)) {
      throw new Error('Invalid POS recommendation signal.')
    }
    strategies.add(strategy)
    return { strategy, rank, source, asOf, expiresAt }
  })
}

/** A future/expired signal grants no recommendation capability. */
export function currentRecommendationSignal(signals: readonly RecommendationSignal[] | undefined, strategy: RecommendationStrategy, now: number) {
  return signals?.find(signal => signal.strategy === strategy && Date.parse(signal.asOf) <= now && now < Date.parse(signal.expiresAt))
}
