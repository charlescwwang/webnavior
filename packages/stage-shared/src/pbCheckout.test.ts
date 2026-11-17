import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { pbSubmissionResultSchema, readPbOrderState, readPbSubmissionResult } from './pbCheckout'

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

// Report: this chat, Nov17, cases 6/7/11 — payment pages have no automatic readable state.
describe('fresh PB order state without submission authority', () => {
  it('reads pending payment and only same-order approved payment entrances', () => {
    const raw = page({ CarrierType: 6, LoveCode: '123', payment: null, has_refunded_payment: false })
    const snapshot = { ...raw, props: { ...raw.props, payMethods: [{ title: '信用卡', url: 'https://app.esgpb.com/order/ecpay/redirect/HASH/Credit' }, { title: '別單', url: 'https://app.esgpb.com/order/ecpay/redirect/OTHER/Credit' }, { title: '外站', url: 'https://example.com/pay' }] } }
    const state = readPbOrderState(`https://app.esgpb.com${expected.cartPath}`, url, snapshot)
    expect(state.paymentStatus).toBe('pending')
    expect(state.invoice.method).toBe('donation')
    expect(state.invoice.code).toBe('123')
    expect(state.paymentMethods).toEqual(['信用卡'])
    expect(state).not.toHaveProperty('confirmationToken')
  })

  it('requires matched page identity and verified payment evidence', () => {
    const entry = `https://app.esgpb.com${expected.cartPath}`
    const paid = { ...page({ status: 50, payment: 'LinePay', has_refunded_payment: false }), component: 'Order/Show', url: url.replace('/choosePayment', '') }
    expect(readPbOrderState(entry, paid.url, paid).paymentStatus).toBe('paid')
    expect(readPbOrderState(entry, paid.url, { ...paid, props: { ...paid.props, order: { ...paid.props.order, payment: null } } }).paymentStatus).toBe('unknown')
    expect(() => readPbOrderState(entry, url, { ...paid, url })).toThrow()
    expect(() => readPbOrderState(entry, url.replace('HASH', 'OTHER'), page())).toThrow()
    expect(() => readPbOrderState(entry, url, { ...page(), props: { ...page().props, storeHash: 'other' } })).toThrow()
  })
})
