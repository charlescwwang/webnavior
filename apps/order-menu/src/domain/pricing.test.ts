import { describe, expect, it } from 'vitest'

import { filterPrices, intersectPrices, priceConditions, priceEvidence } from './pricing'

describe('single-dish price contract', () => {
  // Report: this chat, session tVUWid2B_4UvHrFMVl-x2, 2026-10-19.
  it.each([
    ['那在一百二到一百四之間的有嗎？', 120, 140],
    ['一百二十到一百四十', 120, 140],
    ['兩百五到三百八元', 250, 380],
    ['一千二到一千五', 1200, 1500],
    ['一千二百三到一千二百五', 1230, 1250],
    ['一百零二到一百零四', 102, 104],
    ['一千零二到一千零五', 1002, 1005],
    ['千二到千五', 1200, 1500],
    ['一萬二到一萬五', 12000, 15000],
    ['一萬零二到一萬零五', 10002, 10005],
    ['十二萬到十二萬三', 120000, 123000],
    ['两百五到两百八', 250, 280],
    ['一万二到一万五', 12000, 15000],
  ])('offers Taiwanese shorthand ranges while preserving explicit zero places: %s', (text, minPrice, maxPrice) => {
    const evidence = priceEvidence(String(text))
    expect(evidence?.amounts.map(amount => amount.amount)).toEqual([minPrice, maxPrice])
    expect(evidence?.choices.find(choice => choice.id === 'RANGE')?.conditions).toEqual({ minPrice, maxPrice })
  })
  // Report: Nov1 real-provider C05-A2 replay, retained in conversationFindings.
  it('keeps a clause comma separate from a numeric separator', () => {
    expect(priceEvidence('不要含牛肉，一百五十元以下的')?.choices.find(choice => choice.id === 'UPPER_INCLUSIVE')?.conditions).toEqual({ maxPrice: 150 })
    expect(priceEvidence('不要含牛肉，100到150元')?.choices.find(choice => choice.id === 'RANGE')?.conditions).toEqual({ minPrice: 100, maxPrice: 150 })
  })
  it.each(['一百二以下', '一百二元以下', '百二以下'])('offers shorthand bounds without assigning the comparison: %s', (text) => {
    expect(priceEvidence(text)?.choices.find(choice => choice.id === 'UPPER_INCLUSIVE')?.conditions).toEqual({ maxPrice: 120 })
    expect(priceEvidence(text)?.choices.find(choice => choice.id === 'LOWER_INCLUSIVE')?.conditions).toEqual({ minPrice: 120 })
  })
  it.each(['一百二到一百四份', '千二到千四人'])('does not turn shorthand quantities into prices: %s', (text) => {
    expect(priceEvidence(text)).toBeUndefined()
  })
  it.each(['一兩百元', '兩三百元', '一百多元', '十二塊五', '十二塊五有嗎', '十二塊五毛', '一百元半', '1百2元'])('keeps approximate, fractional or unsupported mixed speech non-executable: %s', (text) => {
    expect(priceEvidence(text)?.choices.some(choice => choice.kind === 'condition')).toBe(false)
  })
  it('keeps an explicit serving count separate from a shorthand currency amount', () => {
    expect(priceEvidence('一百二元兩份')?.amounts.map(amount => amount.amount)).toEqual([120])
    expect(priceEvidence('一百二元兩份')?.choices.find(choice => choice.id === 'EXACT')?.conditions).toEqual({ minPrice: 120, maxPrice: 120 })
  })
  it.each(['一位', '改兩份', '我想吃麵，一碗', '排骨便當來一份', '1到3份', '2~4人', '10:00~13:00', '至少3份', '最多4位', '不到10分鐘'])('does not interpret quantities as money: %s', (text) => {
    expect(priceEvidence(text)).toBeUndefined()
  })
  it.each([['100元以下', 100], ['一百元以下', 100], ['一百零二元以下', 102], ['１００元以下', 100], ['零元以下', 0]])('offers literal bounds, not inferred polarity: %s', (text, amount) => {
    expect(priceEvidence(String(text))?.choices.find(choice => choice.id === 'UPPER_INCLUSIVE')?.conditions).toEqual({ maxPrice: amount })
    expect(priceEvidence(String(text))?.choices.find(choice => choice.id === 'LOWER_EXCLUSIVE')?.conditions).toEqual({ minPrice: amount, minPriceExclusive: true })
  })
  it.each(['有價格130以下的嗎？', '有130以下的嗎？', '價格１３０以下', '一百三十以內有嗎', '不到130的餐點', '價格至少130', '有130以上的嗎？', '價格130', '預算130', '不超過130', '不低於130', '超過130', '高於130', '少於130', '剛好130', '價格≤130', '價位>=130', '130起'])('offers the stated amount without requiring a currency unit: %s', (text) => {
    const evidence = priceEvidence(text)
    expect(evidence?.amounts.map(amount => amount.amount)).toEqual([130])
    expect(evidence?.choices.find(choice => choice.id === 'UPPER_INCLUSIVE')?.conditions).toEqual({ maxPrice: 130 })
    expect(evidence?.choices.find(choice => choice.id === 'LOWER_INCLUSIVE')?.conditions).toEqual({ minPrice: 130 })
  })
  it('offers shared-unit ranges and optional price order', () => {
    expect(priceEvidence('推薦80到120元的便當，便宜的先')?.choices.find(choice => choice.id === 'RANGE_ASC')?.conditions).toEqual({ minPrice: 80, maxPrice: 120, priceOrder: 'ASC' })
  })
  it.each(['有100~130之間的嗎？', '有１００～１３０之間的嗎？', '100到130之間的餐點有哪些', '一百到一百三十之間', '100-130元的餐點', '價格100~130之間的嗎？'])('offers a bounded interpretation for a range: %s', (text) => {
    expect(priceEvidence(text)?.choices.find(choice => choice.id === 'RANGE')?.conditions).toEqual({ minPrice: 100, maxPrice: 130 })
  })
  it('offers complete inclusive and exclusive ranges without making the polarity decision', () => {
    const evidence = priceEvidence('100以上不到130的餐點')
    expect(evidence?.choices.find(choice => choice.id === 'RANGE')?.conditions).toEqual({ minPrice: 100, maxPrice: 130 })
    expect(evidence?.choices.find(choice => choice.id === 'RANGE_MAX_EXCLUSIVE')?.conditions).toEqual({ minPrice: 100, maxPrice: 130, maxPriceExclusive: true })
    expect(evidence?.choices.find(choice => choice.id === 'RANGE_EXCLUSIVE')?.conditions).toEqual({ minPrice: 100, minPriceExclusive: true, maxPrice: 130, maxPriceExclusive: true })
    expect(priceEvidence('130到130')?.choices.some(choice => choice.conditions?.minPriceExclusive || choice.conditions?.maxPriceExclusive)).toBe(false)
  })
  it.each(['100元左右', '兩份共200元', '比剛剛更便宜', '一百二三元以下', '99.5元以下', 'NT$99.5以下', '-100元以下', '1,000元以下', '80到120元或200元', '-100~130之間', '99.5~130之間', '130左右', '兩份共260以下', '-130以下', '99.5以下'])('never supplies an executable choice for unsupported literals/budgets: %s', (text) => {
    expect(priceEvidence(text)?.choices.some(choice => choice.kind === 'condition')).toBe(false)
  })
  it('intersects bounds without allowing the Agent to widen verified conditions', () => {
    expect(intersectPrices({ maxPrice: 100, maxPriceExclusive: true, priceOrder: 'ASC' }, { minPrice: 80, maxPrice: 120 })).toEqual({ minPrice: 80, maxPrice: 100, maxPriceExclusive: true, priceOrder: 'ASC' })
    expect(filterPrices([{ price: 80 }, { price: 100 }, { price: 99 }], { maxPrice: 100, maxPriceExclusive: true, priceOrder: 'ASC' })).toEqual([{ price: 80 }, { price: 99 }])
    expect(() => priceConditions({ maxPriceExclusive: true })).toThrow('price')
    expect(() => priceConditions({ minPrice: 120, maxPrice: 100 })).toThrow('price')
  })
  it.each(['130以下高到低', '最貴的餐點', '兩份加起來不超過260'])('keeps unsupported ordering or whole-order budgets non-executable: %s', (text) => {
    expect(priceEvidence(text)?.choices.some(choice => choice.kind === 'condition')).toBe(false)
  })
})
