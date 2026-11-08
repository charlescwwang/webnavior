import { describe, expect, it } from 'vitest'

import { isPosRoute, isPublicPosRoute } from './kioskPos'

describe('merchant POS proxy routes', () => {
  it('keeps the supplier namespace subject to the same public and device contracts', () => {
    expect(isPosRoute('supplier/v1/catalog')).toBe(true)
    expect(isPublicPosRoute('supplier/v1/catalog')).toBe(true)
    expect(isPosRoute('supplier/v1/orders')).toBe(true)
    expect(isPublicPosRoute('supplier/v1/orders')).toBe(false)
    expect(isPublicPosRoute('supplier/v1/continuations/receipt-token/table')).toBe(true)
    expect(isPosRoute('supplier/v1/private-admin')).toBe(false)
    expect(isPosRoute('other/v1/catalog')).toBe(false)
    expect(isPosRoute('supplier/supplier/v1/catalog')).toBe(false)
    expect(isPosRoute('https://other.example/v1/catalog')).toBe(false)
  })
})
