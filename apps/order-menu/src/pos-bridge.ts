import type { ContinuationAccess } from '../../order-menu-server/src/domain/continuationContracts'
import type { PaymentIntent, PaymentMethod } from '../../order-menu-server/src/domain/contracts'
import type { CartSnapshot, PosOrderGateway, SubmissionReceipt, SubmittedOrder } from './domain/order-machine'

export type { PaymentIntent, PaymentMethod, PaymentStatus } from '../../order-menu-server/src/domain/contracts'

/** Labels shared by the visible controls and semantic payment candidates. */
export const paymentLabels: Record<PaymentMethod, string> = { card: '信用卡', mobile: '行動支付', linepay: 'LINE Pay', jkopay: '街口支付' }

/** Deployed methods shared by the owned kiosk UI and native tool schema. */
export const testPaymentMethods: readonly PaymentMethod[] = ['linepay', 'jkopay']

function endpoint(baseUrl: string, path: string) {
  return new URL(path, `${baseUrl.replace(/\/$/, '')}/`).toString()
}

function isPayment(value: unknown): value is PaymentIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const payment = value as Record<string, unknown>
  return typeof payment.amount === 'number'
    && typeof payment.id === 'string'
    && typeof payment.method === 'string'
    && Object.hasOwn(paymentLabels, payment.method)
    && (payment.status === 'authorized' || payment.status === 'pending' || payment.status === 'rejected' || payment.status === 'uncertain')
}

/** Starts a customer-terminal payment without exposing that physical action as an Agent tool. */
export async function createPayment(baseUrl: string, amount: number, method: PaymentMethod, tableHoldId?: string) {
  const response = await fetch(endpoint(baseUrl, 'v1/payments'), {
    credentials: 'include',
    body: JSON.stringify({ amount, method, tableHoldId }),
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
  const response = await fetch(endpoint(baseUrl, `v1/payments/${encodeURIComponent(paymentId)}`), { credentials: 'include' })
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
export function createPosBridgeGateway(baseUrl: string, tableHoldId: () => string | undefined = () => undefined, customer?: { phone: () => string | undefined, onContinuation: (access: ContinuationAccess) => void }): PosOrderGateway {
  // One page serves many customers. Deduplicate replays of the same payment,
  // not every order submitted during the gateway's lifetime. Keep earlier keys
  // for late retries so they cannot create another order after a newer checkout.
  const idempotencyKeys = new Map<CartSnapshot['paymentId'], string>()

  return {
    submit: async (cart) => {
      let idempotencyKey = idempotencyKeys.get(cart.paymentId)
      if (!idempotencyKey) {
        idempotencyKey = `menu-${crypto.randomUUID()}`
        idempotencyKeys.set(cart.paymentId, idempotencyKey)
      }
      try {
        const response = await fetch(endpoint(baseUrl, 'v1/orders'), {
          credentials: 'include',
          body: JSON.stringify({ cart: { ...cart, ...(cart.fulfillmentMode === 'dine-in' ? { tableHoldId: tableHoldId() } : {}) }, idempotencyKey, customerPhone: customer?.phone() }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        })
        const payload = await response.json().catch(() => undefined) as { order?: unknown, continuation?: ContinuationAccess } | undefined
        if (!response.ok || !isSubmittedOrder(payload?.order))
          return uncertainOrder(cart)
        if (payload.order.receipt.status === 'accepted' && payload.continuation)
          customer?.onContinuation(payload.continuation)
        return payload.order
      }
      catch {
        return uncertainOrder(cart)
      }
    },
  }
}
