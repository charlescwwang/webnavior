import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { pbSubmissionResultSchema, readPbSubmissionResult } from './pbCheckout'

const expected = { origin: 'https://app.esgpb.com', store: '1kgJeql', flow: 'internal_use', cartPath: '/order/store/1kgJeql/internal_use/orders/create', total: 64 }
const url = 'https://app.esgpb.com/order/store/1kgJeql/internal_use/orders/HASH/choosePayment'
function page(overrides = {}) {
  return { component: 'Order/ChoosePayment', url: new URL(url).pathname, props: { storeHash: '1kgJeql', flowType: 'internal_use', order: { hash: 'HASH', number: '4006', status: 20, totalmoney: 64, ...overrides } } }
}

describe('pb merchant submission outcomes', () => {
  it('keeps dispatch with no fresh page pending rather than accepted', () => {
    expect(readPbSubmissionResult(expected, expected.origin + expected.cartPath, undefined).status).toBe('pending')
    expect(readPbSubmissionResult(expected, url, undefined)).toMatchObject({ status: 'pending', effect: 'pending', consistency: 'unavailable' })
  })
  it('accepts matching merchant identity independently of pickup number and payment', () => {
    expect(readPbSubmissionResult(expected, url, page())).toMatchObject({ status: 'accepted', effect: 'applied', consistency: 'unavailable', reason: 'details-unverified', order: { hash: 'HASH', number: '4006', status: 20, total: 64 } })
  })
  it('preserves established-order fact when its amount conflicts', () => {
    expect(readPbSubmissionResult(expected, url, page({ totalmoney: 1 }))).toMatchObject({ status: 'accepted', consistency: 'conflict', reason: 'amount-mismatch', order: { total: 1 } })
  })
  it.each([{ hash: 'OTHER' }, { status: 10 }, { status: 999 }, { totalmoney: '64' }])('does not invent acceptance from malformed, stale or unrelated business data: %o', (overrides) => {
    expect(readPbSubmissionResult(expected, url, page(overrides)).status).toBe('unknown')
  })
  it('rejects cross-origin or stale page-url evidence', () => {
    expect(readPbSubmissionResult(expected, url.replace('app.esgpb.com', 'other.example'), page()).status).toBe('unknown')
    expect(readPbSubmissionResult(expected, url, { ...page(), url: expected.cartPath }).status).toBe('unknown')
  })
  it('cannot parse a pending acknowledgement as an applied merchant outcome', () => {
    expect(safeParse(pbSubmissionResultSchema, { ...readPbSubmissionResult(expected, url, undefined), effect: 'applied' }).success).toBe(false)
  })
})
