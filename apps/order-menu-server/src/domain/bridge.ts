import type { CatalogSnapshot, PaymentMethod, PosGateway, PosSubmission, SubmittedOrder } from './contracts'

import { randomUUID } from 'node:crypto'

/**
 * Owns idempotency at the integration boundary, independent of a POS vendor's
 * own receipt format. An uncertain outcome stays stable because submitting the
 * same customer order again could create a duplicate order in the real POS.
 */
export function createBridge(gateway: PosGateway) {
  const submittedByKey = new Map<string, SubmittedOrder>()

  async function getCatalog(): Promise<CatalogSnapshot> {
    return await gateway.getCatalog()
  }

  async function createPayment(amount: number, method: PaymentMethod) {
    return await gateway.createPayment(amount, method)
  }

  async function getPayment(paymentId: string) {
    return await gateway.getPayment(paymentId)
  }

  async function submit(submission: PosSubmission): Promise<SubmittedOrder> {
    const existing = submittedByKey.get(submission.idempotencyKey)
    if (existing)
      return existing

    const catalog = await gateway.getCatalog()
    const payment = await gateway.getPayment(submission.cart.paymentId)
    const receipt = submission.cart.catalogRevision !== catalog.revision
      ? {
          customerMessage: '菜單已更新，請重新確認餐點與價格後再送出訂單。',
          environment: 'test' as const,
          retryable: true,
          status: 'rejected' as const,
        }
      : payment?.status !== 'authorized' || payment.amount !== submission.cart.total
        ? paymentReceipt(payment?.status)
        : validateCartAgainstCatalog(submission, catalog) ?? await gateway.submit(submission)
    const order: SubmittedOrder = {
      cart: submission.cart,
      id: `order-${randomUUID()}`,
      receipt,
    }
    submittedByKey.set(submission.idempotencyKey, order)
    return order
  }

  return { createPayment, getCatalog, getPayment, submit }
}

function paymentReceipt(status: 'authorized' | 'pending' | 'rejected' | 'uncertain' | undefined) {
  return {
    customerMessage: status === 'uncertain' ? '付款狀態尚未確認，訂單已鎖定等待對帳。' : '付款尚未完成或金額不符，訂單未送出。',
    environment: 'test' as const,
    retryable: status !== 'uncertain',
    status: status === 'uncertain' ? 'uncertain' as const : 'rejected' as const,
  }
}

/** Final validation prevents a stale browser catalog from changing an order silently. */
function validateCartAgainstCatalog(submission: PosSubmission, catalog: CatalogSnapshot) {
  const itemById = new Map(catalog.items.map(item => [item.id, item]))
  const invalidLine = submission.cart.lines.find((line) => {
    const item = itemById.get(line.itemId)
    return !item || !item.available || item.price !== line.unitPrice
  })
  if (!invalidLine)
    return undefined

  return {
    customerMessage: `「${invalidLine.name}」的價格或供應狀態已變更，請重新確認訂單。`,
    environment: 'test' as const,
    retryable: true,
    status: 'rejected' as const,
  }
}
