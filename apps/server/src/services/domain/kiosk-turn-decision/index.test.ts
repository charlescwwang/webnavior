import { describe, expect, it } from 'vitest'

import { calculateCosineSimilarity, decideKioskTurn, evaluateKioskTurn } from '.'

describe('decideKioskTurn', () => {
  it('keeps a new customer request when no work is active', () => {
    expect(decideKioskTurn({ activeWork: false, text: '我要一碗擔仔麵' })).toBe('continue')
  })

  it('ignores weak or duplicate background speech during an order', () => {
    expect(decideKioskTurn({ activeWork: true, asrConfidence: 0.4, text: '嗯' })).toBe('ignore')
    expect(decideKioskTurn({ activeWork: true, semanticSimilarity: 0.92, text: '好的' })).toBe('ignore')
  })

  it('interrupts active work for a distinct substantive customer change', () => {
    expect(decideKioskTurn({ activeWork: true, semanticSimilarity: 0.21, text: '不要蝦捲，改成擔仔麵' })).toBe('interrupt')
  })

  it('does not let unrelated conversation interrupt without an ordering change', () => {
    expect(decideKioskTurn({ activeWork: true, semanticSimilarity: 0.12, text: '今天天氣真好' })).toBe('ignore')
    expect(decideKioskTurn({ activeWork: true, text: '幫我換成乾麵' })).toBe('interrupt')
    expect(decideKioskTurn({ activeWork: true, semanticSimilarity: 0.95, text: '不要蝦捲' })).toBe('interrupt')
  })

  it('does not let a passing or missing candidate pre-empt the active customer', () => {
    expect(decideKioskTurn({ activeWork: true, presenceState: 'PASSING', text: '不要蝦捲，改成擔仔麵' })).toBe('ignore')
    expect(decideKioskTurn({ activeWork: true, presenceState: 'EMPTY', text: '幫我加一份小菜' })).toBe('ignore')
    expect(decideKioskTurn({ activeWork: true, presenceState: 'ENGAGED', text: '幫我加一份小菜' })).toBe('interrupt')
  })

  it('calculates similarity only for valid same-sized vectors', () => {
    expect(calculateCosineSimilarity([1, 0], [0, 1])).toBe(0)
    expect(calculateCosineSimilarity([1, 1], [1, 1])).toBe(1)
    expect(calculateCosineSimilarity([1], [1, 1])).toBeUndefined()
    expect(calculateCosineSimilarity([0], [0])).toBeUndefined()
  })

  it('exposes a content-free reason for aggregate field observation', () => {
    expect(evaluateKioskTurn({ activeWork: true, presenceState: 'PASSING', text: '幫我加一份小菜' })).toEqual({ decision: 'ignore', reason: 'missing-or-passing' })
  })
})
