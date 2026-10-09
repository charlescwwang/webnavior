import { describe, expect, it } from 'vitest'

import { currentRecommendationSignal, parseRecommendationSignals } from './recommendation'

describe('pOS recommendation evidence', () => {
  const signal = { strategy: 'POPULAR', rank: 1, source: 'pos', asOf: '2026-10-01T00:00:00Z', expiresAt: '2026-10-02T00:00:00Z' }
  it('accepts finite ranked evidence but rejects invented strategies, ranks and overlapping strategy entries', () => {
    expect(parseRecommendationSignals([signal])).toEqual([signal])
    expect(parseRecommendationSignals(undefined)).toEqual([])
    for (const invalid of [[{ ...signal, strategy: 'ANYTHING' }], [{ ...signal, rank: 0 }], [{ ...signal, rank: Number.NaN }], [{ ...signal, expiresAt: signal.asOf }], [signal, signal]])
      expect(() => parseRecommendationSignals(invalid)).toThrow('Invalid POS recommendation signal')
  })
  it('does not offer evidence outside its actual validity window', () => {
    const signals = parseRecommendationSignals([signal])
    expect(currentRecommendationSignal(signals, 'POPULAR', Date.parse('2026-09-30T23:59:59Z'))).toBeUndefined()
    expect(currentRecommendationSignal(signals, 'POPULAR', Date.parse('2026-10-01T00:00:00Z'))).toEqual(signal)
    expect(currentRecommendationSignal(signals, 'POPULAR', Date.parse('2026-10-02T00:00:00Z'))).toBeUndefined()
  })
})
