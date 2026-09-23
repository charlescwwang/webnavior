import type { CartSnapshot, PosOrderGateway, SubmissionReceipt, SubmittedOrder } from './domain/order-machine'

export type PaymentMethod = 'card' | 'mobile'
export type PaymentStatus = 'authorized' | 'pending' | 'rejected' | 'uncertain'

export interface PaymentIntent {
  amount: number
  id: string
  method: PaymentMethod
  status: PaymentStatus
}

function endpoint(baseUrl: string, path: string) {
  return new URL(path, `${baseUrl.replace(/\/$/, '')}/`).toString()
}

function isPayment(value: unknown): value is PaymentIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const payment = value as Record<string, unknown>
  return typeof payment.amount === 'number'
    && typeof payment.id === 'string'
    && (payment.method === 'card' || payment.method === 'mobile')
    && (payment.status === 'authorized' || payment.status === 'pending' || payment.status === 'rejected' || payment.status === 'uncertain')
}

/** Starts a customer-terminal payment without exposing that physical action as an Agent tool. */
export async function createPayment(baseUrl: string, amount: number, method: PaymentMethod) {
  const response = await fetch(endpoint(baseUrl, 'v1/payments'), {
    body: JSON.stringify({ amount, method }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  const payload = await response.json().catch(() => undefined) as { payment?: unknown } | undefined
  if (!response.ok || !isPayment(payload?.payment))
    throw new Error('無法啟動付款終端，請稍後再試。')
  return payload.payment
}

/** Reads the immutable result for one payment attempt from the POS Bridge. */
export async function getPayment(baseUrl: string, paymentId: string) {
  const response = await fetch(endpoint(baseUrl, `v1/payments/${encodeURIComponent(paymentId)}`))
  const payload = await response.json().catch(() => undefined) as { payment?: unknown } | undefined
  if (!response.ok || !isPayment(payload?.payment))
    throw new Error('無法確認付款結果，請交由門市人員查詢。')
  return payload.payment
}

function uncertainOrder(cart: CartSnapshot): SubmittedOrder {
  return {
    cart,
    id: `order-unknown-${crypto.randomUUID()}`,
    receipt: {
      customerMessage: 'POS Bridge 無法確認訂單狀態，請勿再次送單。',
      environment: 'test',
      retryable: false,
      status: 'uncertain',
    },
  }
}

function isReceipt(value: unknown): value is SubmissionReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const receipt = value as Record<string, unknown>
  return typeof receipt.customerMessage === 'string'
    && (receipt.environment === 'test' || receipt.environment === 'live')
    && typeof receipt.retryable === 'boolean'
    && (receipt.status === 'accepted' || receipt.status === 'rejected' || receipt.status === 'uncertain')
    && (receipt.posOrderId === undefined || typeof receipt.posOrderId === 'string')
}

function isSubmittedOrder(value: unknown): value is SubmittedOrder {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const order = value as Record<string, unknown>
  return typeof order.id === 'string' && isReceipt(order.receipt)
}

/** Calls the configured POS Bridge and never substitutes a browser-local demo order. */
export function createPosBridgeGateway(baseUrl: string): PosOrderGateway {
  let idempotencyKey: string | undefined

  return {
    submit: async (cart) => {
      idempotencyKey ??= `menu-${crypto.randomUUID()}`
      try {
        const response = await fetch(endpoint(baseUrl, 'v1/orders'), {
          body: JSON.stringify({ cart, idempotencyKey }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        })
        const payload = await response.json().catch(() => undefined) as { order?: unknown } | undefined
        if (!response.ok || !isSubmittedOrder(payload?.order))
          return uncertainOrder(cart)
        return payload.order
      }
      catch {
        return uncertainOrder(cart)
      }
    },
  }
}
