import type { InferOutput } from 'valibot'

import { array, boolean, finite, literal, looseObject, minLength, minValue, nullable, number, object, optional, parse, picklist, pipe, safeParse, strictObject, string, variant } from 'valibot'

import { isPbOrderResultUrl, readPbJourney } from './pbJourney'
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

/** Business position is a hint, separate from expiring answer/submission authority. */
export const pbCheckoutStepSchema = picklist(['review-checkout', 'cart-review', 'invoice-method', 'invoice-details', 'notification-details', 'notification-phone', 'notification-phone-confirm', 'checkout-details', 'submit-order'])
export type PbCheckoutStep = InferOutput<typeof pbCheckoutStepSchema>

/** Privacy-safe form facts for Jev; values and final confirmation authority stay with Host. */
export const pbCheckoutProgressSchema = object({
  source: literal('pb'),
  step: optional(pbCheckoutStepSchema),
  invoiceMethod: optional(pbInvoiceMethodSchema),
  ready: boolean(),
  fields: array(object({ kind: pbCheckoutSchema.entries.fields.item.entries.kind, present: boolean(), valid: boolean() })),
})

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
  strictObject({ ...submissionFields, status: literal('rejected'), dispatch: picklist(['dispatched', 'not-dispatched']), effect: literal('none'), consistency: literal('unavailable') }),
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

/** Verified result-page facts, independent of a submission receipt or permission to pay. */
export const pbOrderStateSchema = object({
  reference: string(),
  number: optional(string()),
  status: number(),
  total: number(),
  paymentStatus: picklist(['pending', 'paid', 'cancelled', 'unknown']),
  paymentMethod: optional(string()),
  paymentMethods: array(string()),
  invoice: object({ method: optional(pbInvoiceMethodSchema), code: optional(string()) }),
})
export type PbOrderState = InferOutput<typeof pbOrderStateSchema>

/** Fresh result facts plus a read-only decision about retiring this reception. */
export const pbOrderReceptionSchema = object({
  ok: literal(true),
  source: literal('browser'),
  page: picklist(['payment', 'order-result']),
  documentId: string(),
  order: pbOrderStateSchema,
  restart: picklist(['allowed', 'payment-pending', 'payment-unknown', 'operation-pending']),
})

/** Reads only the matching rendered order. Unknown payment evidence never becomes success. */
export function readPbOrderState(entry: string, current: string, raw: unknown): PbOrderState {
  const journey = readPbJourney(entry)
  if (!journey || !isPbOrderResultUrl(entry, current))
    throw new Error('PB order page is outside the configured journey.')
  const page = parse(looseObject({
    component: picklist(['Order/ChoosePayment', 'Order/Show']),
    url: string(),
    props: looseObject({ storeHash: string(), flowType: string(), order: looseObject({ hash: string(), number: optional(string()), status: number(), totalmoney: pipe(number(), finite(), minValue(0)), payment: optional(nullable(string())), has_refunded_payment: optional(boolean()), CarrierType: optional(number()), CarrierNum: optional(nullable(string())), CustomerIdentifier: optional(nullable(string())), LoveCode: optional(nullable(string())) }), payMethods: optional(array(looseObject({ title: string(), url: string() })), []) }),
  }), raw)
  const url = new URL(current)
  const order = page.props.order
  const orderPath = `${journey.basePath}orders/${order.hash}`
  if (new URL(page.url, journey.origin).href !== url.href || page.props.storeHash !== journey.store || page.props.flowType !== journey.flow
    || ![orderPath, `${orderPath}/choosePayment`].includes(url.pathname)
    || (page.component === 'Order/ChoosePayment') !== url.pathname.endsWith('/choosePayment')) {
    throw new Error('PB order snapshot identity does not match the current page.')
  }
  let paymentStatus: PbOrderState['paymentStatus'] = 'unknown'
  // These statuses are captured PB business states, not inferred from page titles.
  // A payment method alone proves neither a successful charge nor its final amount.
  if (order.status === 20 && order.payment === null && page.component === 'Order/ChoosePayment')
    paymentStatus = 'pending'
  else if ([50, 60, 70].includes(order.status) && ['LinePay', 'Credit'].includes(order.payment ?? '') && order.has_refunded_payment === false)
    paymentStatus = 'paid'
  else if (order.status === 79 && order.payment === null && order.has_refunded_payment === false)
    paymentStatus = 'cancelled'
  const method = ({ 5: 'none', 2: 'citizen', 3: 'carrier', 4: 'tax', 6: 'donation' } as const)[order.CarrierType as 5 | 2 | 3 | 4 | 6]
  let code: string | undefined
  if (method === 'carrier' || method === 'citizen')
    code = order.CarrierNum ?? undefined
  else if (method === 'tax')
    code = order.CustomerIdentifier ?? undefined
  else if (method === 'donation')
    code = order.LoveCode ?? undefined
  const paymentMethods = paymentStatus === 'pending'
    ? page.props.payMethods.filter((method) => {
        try {
          const target = new URL(method.url, journey.origin)
          return target.origin === journey.origin && !target.username && !target.password && !target.search && !target.hash
            && [`/order/linepay/redirect/${order.hash}/LinePay`, `/order/ecpay/redirect/${order.hash}/Credit`].includes(target.pathname)
        }
        catch { return false }
      }).map(method => method.title)
    : []
  return { reference: order.hash, number: order.number, status: order.status, total: order.totalmoney, paymentStatus, paymentMethod: paymentStatus === 'paid' ? order.payment ?? undefined : undefined, paymentMethods: [...new Set(paymentMethods)], invoice: { method, code } }
}
