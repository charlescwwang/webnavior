import type { CatalogSnapshot, PaymentMethod, PosGateway, PosSubmission, SubmittedOrder } from './contracts'
import type { TableAssignment } from './seatingContracts'

import { randomInt, randomUUID } from 'node:crypto'

/**
 * Owns idempotency at the integration boundary, independent of a POS vendor's
 * own receipt format. An uncertain outcome stays stable because submitting the
 * same customer order again could create a duplicate order in the real POS.
 */
export function createBridge(gateway: PosGateway, tableAssignment: TableAssignment = 'reservation') {
  const submittedByKey = new Map<string, SubmittedOrder>()
  const fingerprints = new Map<string, string>()
  const paymentKeys = new Map<string, string>()
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
    const fingerprint = JSON.stringify(submission.cart)
    const previous = fingerprints.get(submission.idempotencyKey)
    if (previous !== undefined && previous !== fingerprint)
      return { cart: submission.cart, id: `order-${randomUUID()}`, receipt: { customerMessage: '同一送單識別碼的內容不一致，請洽門市人員確認。', environment: 'test', retryable: false, status: 'rejected' } }
    fingerprints.set(submission.idempotencyKey, fingerprint)
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
          : (submission.cart.fulfillmentMode === 'dine-in' && tableAssignment === 'reservation' && (!submission.cart.tableHoldId || submission.cart.tableHoldId !== payment.tableHoldId)) || (submission.cart.fulfillmentMode === 'takeout' && (submission.cart.tableHoldId || payment.tableHoldId))
              ? { customerMessage: '內用訂單必須綁定已保留的桌位與同一筆付款。', environment: 'test' as const, retryable: false, status: 'rejected' as const }
              : validateCartAgainstCatalog(submission, catalog) ?? await submitPaidCart(submission)
    const order: SubmittedOrder = {
      cart: submission.cart,
      id: `order-${randomUUID()}`,
      // Assign after the POS outcome is known, inside the existing idempotency
      // boundary. Concurrent requests and later receipt replays reuse this number.
      receipt: receipt.status === 'accepted'
        ? { ...receipt, pickupNumber: String(randomInt(100, 1000)) }
        : receipt,
    }
    submittedByKey.set(submission.idempotencyKey, order)
    return order
  }

  async function submitPaidCart(submission: PosSubmission) {
    const paymentKey = paymentKeys.get(submission.cart.paymentId)
    if (paymentKey !== undefined && paymentKey !== submission.idempotencyKey)
      return { customerMessage: '這筆付款已用於另一筆送單，請洽門市人員確認。', environment: 'test' as const, retryable: false, status: 'rejected' as const }
    // Claim before the external write, including across simultaneous different
    // keys. Keep the claim on failure: a missing response cannot prove no order.
    paymentKeys.set(submission.cart.paymentId, submission.idempotencyKey)
    try {
      return await gateway.submit(submission)
    }
    catch { return { customerMessage: '無法確認 POS 是否已收單，請勿重複送單。', environment: 'test' as const, retryable: false, status: 'uncertain' as const } }
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
  let count = 0
  let total = 0
  const lineIds = new Set<string>()
  const invalidLine = submission.cart.lines.find((line) => {
    const item = itemById.get(line.itemId)
    if (!item || !item.available || item.name !== line.name || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || lineIds.has(line.id))
      return true
    lineIds.add(line.id)
    const groups = new Map(item.optionGroups.map(group => [group.id, group]))
    if (Object.keys(line.options).some(groupId => !groups.has(groupId)))
      return true
    let unitPrice = item.price
    for (const group of item.optionGroups) {
      const selected = line.options[group.id]
      if (selected === undefined) {
        if (group.required)
          return true
        continue
      }
      const option = group.values.find(value => value.id === selected)
      if (!option)
        return true
      unitPrice += option.priceDelta
    }
    if (!Number.isSafeInteger(unitPrice) || unitPrice < 0 || unitPrice !== line.unitPrice)
      return true
    count += line.quantity
    total += unitPrice * line.quantity
    return !Number.isSafeInteger(count) || !Number.isSafeInteger(total)
  })
  if (!invalidLine && submission.cart.lines.length > 0 && count === submission.cart.itemCount && total === submission.cart.total)
    return undefined

  return {
    customerMessage: '餐點選項、份數或總額與店家菜單不符，請重新確認訂單。',
    environment: 'test' as const,
    retryable: true,
    status: 'rejected' as const,
  }
}
