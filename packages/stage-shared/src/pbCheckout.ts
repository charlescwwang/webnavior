import type { InferOutput } from 'valibot'

import { array, boolean, finite, literal, looseObject, minLength, minValue, number, object, optional, picklist, pipe, safeParse, strictObject, string, variant } from 'valibot'

import { serviceOperationSchema } from './serviceOperation'

/** Values name actual PB invoice controls, not merchant-provided ingredient facts. */
export const pbInvoiceMethodSchema = picklist(['none', 'carrier', 'citizen', 'tax', 'donation'])
export type PbInvoiceMethod = InferOutput<typeof pbInvoiceMethodSchema>

/** Fresh rendered checkout fields. A snapshot never authorizes order submission. */
export const pbCheckoutSchema = object({
  methods: array(object({ method: pbInvoiceMethodSchema, label: string(), selected: boolean() })),
  fields: array(object({ kind: picklist(['carrier', 'citizen', 'tax', 'donation', 'phone', 'email']), label: string(), value: string(), valid: boolean() })),
  missing: array(string()),
  ready: boolean(),
  orderNote: string(),
  total: optional(number()),
  confirmationToken: optional(string()),
})
export type PbCheckout = InferOutput<typeof pbCheckoutSchema>

const submissionFields = {
  schemaVersion: literal(1),
  ok: literal(true),
  source: literal('browser'),
  code: literal('order-submission-result'),
  dispatch: literal('dispatched'),
  reason: string(),
  execution: optional(serviceOperationSchema),
  customerMessage: string(),
}
const merchantOrderSchema = strictObject({ hash: pipe(string(), minLength(1)), number: optional(string()), status: number(), total: pipe(number(), finite(), minValue(0)) })

/** Merchant acceptance, dispatch and payment are separate facts; no confirmation ticket leaves execution. */
export const pbSubmissionResultSchema = variant('status', [
  strictObject({ ...submissionFields, status: literal('pending'), effect: literal('pending'), consistency: literal('unavailable') }),
  strictObject({ ...submissionFields, status: literal('accepted'), effect: literal('applied'), consistency: picklist(['matched', 'conflict', 'unavailable']), order: merchantOrderSchema }),
  strictObject({ ...submissionFields, status: literal('unknown'), effect: literal('unknown'), consistency: literal('unavailable') }),
  strictObject({ ...submissionFields, status: literal('rejected'), effect: literal('none'), consistency: literal('unavailable') }),
])
export type PbSubmissionResult = InferOutput<typeof pbSubmissionResultSchema>

/** Captured from the confirmed checkout before dispatch, never reconstructed from the result page. */
export interface PbSubmissionExpectation {
  origin: string
  store: string
  flow: string
  cartPath: string
  total: number
}

/**
 * Reads one fresh result snapshot for an already-dispatched, correlated operation.
 * The caller owns operation correlation; a matching URL alone cannot establish it.
 * Detail equivalence is deliberately unavailable until a line-level verifier exists.
 */
export function readPbSubmissionResult(expected: PbSubmissionExpectation, currentUrl: string, rawPage: unknown): PbSubmissionResult {
  const base = { schemaVersion: 1 as const, ok: true as const, source: 'browser' as const, code: 'order-submission-result' as const, dispatch: 'dispatched' as const }
  const unknown = (reason: string): PbSubmissionResult => ({ ...base, status: 'unknown', effect: 'unknown', consistency: 'unavailable', reason, customerMessage: '訂單結果仍在確認，請先查看目前畫面，避免重複送出。' })
  let current: URL
  try {
    current = new URL(currentUrl)
  }
  catch { return unknown('invalid-url') }
  if (current.origin !== expected.origin || current.username || current.password || current.search || current.hash)
    return unknown('identity-mismatch')
  const prefix = `/order/store/${expected.store}/${expected.flow}/`
  if (expected.cartPath !== `${prefix}orders/create` || !Number.isFinite(expected.total) || expected.total < 0)
    return unknown('invalid-expectation')
  const match = current.pathname.startsWith(prefix) ? current.pathname.slice(prefix.length).match(/^orders\/([\w-]{1,200})(?:\/choosePayment)?$/) : null
  if (!match && current.pathname !== expected.cartPath)
    return unknown('identity-mismatch')
  if (rawPage === undefined)
    return { ...base, status: 'pending', effect: 'pending', consistency: 'unavailable', reason: 'result-not-ready', customerMessage: '訂單正在送出，請稍候查看訂單結果。' }
  const parsed = safeParse(looseObject({ component: picklist(['Order/ChoosePayment', 'Order/Show']), url: string(), props: looseObject({ storeHash: string(), flowType: string(), order: looseObject({ hash: pipe(string(), minLength(1)), number: optional(string()), status: number(), totalmoney: pipe(number(), finite(), minValue(0)) }) }) }), rawPage)
  if (!parsed.success)
    return unknown('invalid-result-format')
  const page = parsed.output
  let pageUrl: URL
  try {
    pageUrl = new URL(page.url, expected.origin)
  }
  catch { return unknown('invalid-result-format') }
  if (!match || match[1] === 'create' || pageUrl.href !== current.href || page.props.storeHash !== expected.store || page.props.flowType !== expected.flow || page.props.order.hash !== match[1])
    return unknown('identity-mismatch')
  if (![20, 30, 40, 50, 60, 70].includes(page.props.order.status))
    return unknown('unverified-order-status')
  const order = { hash: page.props.order.hash, ...(page.props.order.number === undefined ? {} : { number: page.props.order.number }), status: page.props.order.status, total: page.props.order.totalmoney }
  const conflict = order.total !== expected.total
  return { ...base, status: 'accepted', effect: 'applied', consistency: conflict ? 'conflict' : 'unavailable', reason: conflict ? 'amount-mismatch' : 'details-unverified', order, customerMessage: conflict ? '訂單已送出，但金額與剛才確認的內容不同，請先核對畫面上的訂單。' : `訂單已送出${order.number ? `，取餐編號 ${order.number}` : ''}。請查看畫面上的訂單與後續步驟。` }
}
