import { describe, expect, it } from 'vitest'

import { inspectCatalogPrices } from './catalogDiagnostics'

const source = (description: string, price = 80) => ({ items: [{ id: 'dumpling', name: '水餃', price, description }] })

// Report: this chat, 2026-11-07, planned merchant price consistency checks.
describe('catalog price maintenance diagnostics', () => {
  it('ignores only matching standalone base prices and preserves quantities', () => {
    expect(inspectCatalogPrices(source('一份80元，售價：NT$80，每份10顆')).warnings).toEqual([])
    expect(inspectCatalogPrices(source('售價95元')).warnings[0]?.kind).toBe('conflicting-base-price')
  })
  it('keeps contextual prices distinct without changing merchant text', () => {
    const input = source('兩份150元，原價100元特價80元，加購10元，附贈價值20元')
    const before = JSON.stringify(input)
    expect(inspectCatalogPrices(input).warnings.map(value => value.kind)).toEqual(['bundle-price', 'promotion-price', 'promotion-price', 'option-price', 'unclassified-price'])
    expect(JSON.stringify(input)).toBe(before)
  })
  it('handles grouped and full-width prices', () => {
    expect(inspectCatalogPrices(source('售價１，２００元', 1200)).warningCount).toBe(0)
    expect(inspectCatalogPrices(source('售價1,200元')).warnings[0]?.mentionedAmount).toBe(1200)
  })
  it('rejects invalid source and bounds detailed warnings', () => {
    expect(inspectCatalogPrices({ items: [{ id: 'bad', name: 'bad', price: '80', description: '' }] }).valid).toBe(false)
    const report = inspectCatalogPrices(source(Array.from({ length: 120 }).fill('售價95元').join('，')))
    expect(report.warningCount).toBe(120)
    expect(report.warnings).toHaveLength(100)
    expect(report.truncated).toBe(true)
  })
})
