import { describe, expect, it } from 'vitest'

import { filterPrices, intersectPrices, priceConditions, priceEvidence } from './pricing'

describe('single-dish price contract', () => {
  it.each(['一位', '改兩份', '我想吃麵，一碗', '排骨便當來一份'])('does not interpret quantities as money: %s', (text) => {
    expect(priceEvidence(text)).toBeUndefined()
  })
  it.each([['100元以下', 100], ['一百元以下', 100], ['一百零二元以下', 102], ['１００元以下', 100]])('offers literal bounds, not inferred polarity: %s', (text, amount) => {
    expect(priceEvidence(String(text))?.choices.find(choice => choice.id === 'UPPER_INCLUSIVE')?.conditions).toEqual({ maxPrice: amount })
    expect(priceEvidence(String(text))?.choices.find(choice => choice.id === 'LOWER_EXCLUSIVE')?.conditions).toEqual({ minPrice: amount, minPriceExclusive: true })
  })
  it('offers shared-unit ranges and optional price order', () => {
    expect(priceEvidence('推薦80到120元的便當，便宜的先')?.choices.find(choice => choice.id === 'RANGE_ASC')?.conditions).toEqual({ minPrice: 80, maxPrice: 120, priceOrder: 'ASC' })
  })
  it.each(['100元左右', '兩份共200元', '比剛剛更便宜', '一百二元以下', '99.5元以下', 'NT$99.5以下', '-100元以下', '1,000元以下', '80到120元或200元'])('never supplies an executable choice for unsupported literals/budgets: %s', (text) => {
    expect(priceEvidence(text)?.choices.some(choice => choice.kind === 'condition')).toBe(false)
  })
  it('intersects bounds without allowing the Agent to widen verified conditions', () => {
    expect(intersectPrices({ maxPrice: 100, maxPriceExclusive: true, priceOrder: 'ASC' }, { minPrice: 80, maxPrice: 120 })).toEqual({ minPrice: 80, maxPrice: 100, maxPriceExclusive: true, priceOrder: 'ASC' })
    expect(filterPrices([{ price: 80 }, { price: 100 }, { price: 99 }], { maxPrice: 100, maxPriceExclusive: true, priceOrder: 'ASC' })).toEqual([{ price: 80 }, { price: 99 }])
    expect(() => priceConditions({ maxPriceExclusive: true })).toThrow('price')
    expect(() => priceConditions({ minPrice: 120, maxPrice: 100 })).toThrow('price')
  })
})
