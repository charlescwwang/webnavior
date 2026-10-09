import type { CatalogSnapshot, PaymentMethod, PosGateway, PosSubmission, SubmittedOrder } from './contracts'

import { randomUUID } from 'node:crypto'

/**
 * Owns idempotency at the integration boundary, independent of a POS vendor's
 * own receipt format. An uncertain outcome stays stable because submitting the
 * same customer order again could create a duplicate order in the real POS.
 */
export function createBridge(gateway: PosGateway) {
  const submittedByKey = new Map<string, SubmittedOrder>()
  const pendingByKey = new Map<string, Promise<SubmittedOrder>>()

  async function getCatalog(): Promise<CatalogSnapshot> {
    return await gateway.getCatalog()
  }

  async function createPayment(amount: number, method: PaymentMethod, tableHoldId?: string) {
    return await gateway.createPayment(amount, method, tableHoldId)
  }

  async function getPayment(paymentId: string) {
    return await gateway.getPayment(paymentId)
  }

  async function submit(submission: PosSubmission): Promise<SubmittedOrder> {
    const existing = submittedByKey.get(submission.idempotencyKey)
    if (existing)
      return existing
    const pending = pendingByKey.get(submission.idempotencyKey)
    if (pending)
      return await pending
    // Claim the key before yielding to POS reads. Completed-receipt caching
    // alone allows simultaneous requests to cross the external write boundary.
    const operation = submitOnce(submission)
    pendingByKey.set(submission.idempotencyKey, operation)
    try {
      return await operation
    }
    finally {
      pendingByKey.delete(submission.idempotencyKey)
    }
  }

  async function submitOnce(submission: PosSubmission): Promise<SubmittedOrder> {
    const catalog = await gateway.getCatalog()
    const payment = await gateway.getPayment(submission.cart.paymentId)
    const receipt = !catalog.store.fulfillmentModes.some(mode => mode.id === submission.cart.fulfillmentMode)
      ? { customerMessage: '店家目前未提供此用餐方式，請重新確認。', environment: 'test' as const, retryable: false, status: 'rejected' as const }
      : submission.cart.catalogRevision !== catalog.revision
        ? {
            customerMessage: '菜單已更新，請重新確認餐點與價格後再送出訂單。',
            environment: 'test' as const,
            retryable: true,
            status: 'rejected' as const,
          }
        : payment?.status !== 'authorized' || payment.amount !== submission.cart.total
          ? paymentReceipt(payment?.status)
          : (submission.cart.fulfillmentMode === 'dine-in' && (!submission.cart.tableHoldId || submission.cart.tableHoldId !== payment.tableHoldId)) || (submission.cart.fulfillmentMode === 'takeout' && (submission.cart.tableHoldId || payment.tableHoldId))
              ? { customerMessage: '內用訂單必須綁定已保留的桌位與同一筆付款。', environment: 'test' as const, retryable: false, status: 'rejected' as const }
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
