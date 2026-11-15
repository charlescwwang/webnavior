import { describe, expect, it } from 'vitest'

import { isOrderEvidencePath, sanitizeOrderBusinessPayload } from './orderEvidence'

const merchant = { origin: 'https://app.esgpb.com', store: '1kgJeql', flow: 'internal_use' as const }
describe('controlled original order business data', () => {
  it('preserves unknown business fields and carrier values while removing credentials and payment URLs', () => {
    const result = JSON.parse(sanitizeOrderBusinessPayload({ auth: { user: 'excluded' }, order: { hash: 'sample', phone: '0900000000', invoice_carrier: '/ABC1234', nested: { newBusiness: 7, access_token: 'never-retain' }, paymentUrl: 'https://web-pay.line.me/login?token=never-retain', receiptUrl: 'https://app.esgpb.com/order/store/1kgJeql/internal_use/orders/sample?token=never-retain' }, details: [{ name: '餐點', quantity: 3 }] }, merchant))
    expect(result.order.invoice_carrier).toBe('/ABC1234')
    expect(result.order.nested).toEqual({ newBusiness: 7 })
    expect(result.order.receiptUrl).toBe('https://app.esgpb.com/order/store/1kgJeql/internal_use/orders/sample')
    expect(result.order).not.toHaveProperty('paymentUrl')
    expect(result).not.toHaveProperty('auth')
    expect(JSON.stringify(result)).not.toContain('never-retain')
  })
  it('uses locale-independent key order for exact cross-platform digest bytes', () => {
    expect(sanitizeOrderBusinessPayload({ order: { z: 1, Z: 2, a: 3, á: 4 } }, merchant)).toBe('{"order":{"Z":2,"a":3,"z":1,"á":4}}')
  })
  it('rejects source query strings, another store and payment redirects', () => {
    expect(isOrderEvidencePath('/order/store/1kgJeql/internal_use/orders/sample/choosePayment', merchant)).toBe(true)
    expect(isOrderEvidencePath('/order/store/1kgJeql/internal_use/orders/sample?token=x', merchant)).toBe(false)
    expect(isOrderEvidencePath('/order/store/other/internal_use/orders/sample', merchant)).toBe(false)
    expect(isOrderEvidencePath('/order/linepay/redirect/sample/LinePay', merchant)).toBe(false)
  })
})
