import type { ContinuationAccess, ContinuationSnapshot } from './continuationContracts'
import type { SubmittedOrder } from './contracts'

import { randomUUID } from 'node:crypto'

/**
 * In-memory order capability registry. Restarting the bridge invalidates links.
 * Tokens identify one accepted order, never a membership login or a payment grant.
 * Fulfillment/table changes affect this test record only, preserving the original
 * receipt, payment and expiry. Pickup is terminal for table-binding operations.
 */
export function createOrderContinuations(now: () => number = Date.now) {
  const records = new Map<string, ContinuationSnapshot>()
  const accessByOrder = new Map<string, ContinuationAccess>()

  function read(token: string) {
    const snapshot = records.get(token)
    if (!snapshot || snapshot.expiresAt <= now()) {
      records.delete(token)
      return undefined
    }
    return structuredClone(snapshot)
  }

  function issue(order: SubmittedOrder, phone?: string, readOnly = false): ContinuationAccess | undefined {
    if (order.receipt.status !== 'accepted' || (!readOnly && (order.receipt.environment !== 'test' || order.cart.fulfillmentMode !== 'dine-in')))
      return undefined
    // One order may have an existing table-binding capability and a separate
    // read-only receipt. Their lifetime/idempotency must not grant each other's rights.
    const accessKey = JSON.stringify([order.id, readOnly])
    const existing = accessByOrder.get(accessKey)
    if (existing && read(existing.token))
      return existing
    // A receipt replay must not resurrect an expired bearer capability.
    if (existing)
      return undefined
    const access = { token: randomUUID(), expiresAt: now() + 30 * 60_000 }
    records.set(access.token, {
      environment: order.receipt.environment,
      ...(readOnly ? { readOnly: true } : {}),
      ...(order.receipt.pickupNumber ? { pickupNumber: order.receipt.pickupNumber } : {}),
      expiresAt: access.expiresAt,
      orderId: order.id,
      fulfillmentMode: order.cart.fulfillmentMode,
      phoneLabel: phone ? `${phone.slice(0, 4)}***${phone.slice(-3)}` : undefined,
      total: order.cart.total,
      lines: order.cart.lines.map(line => ({ name: line.name, quantity: line.quantity })),
    })
    accessByOrder.set(accessKey, access)
    return access
  }

  function bind(token: string, tableCode: string) {
    const snapshot = read(token)
    if (!snapshot)
      throw new Error('接續連結已失效，請返回機台或洽門市人員。')
    if (snapshot.readOnly)
      throw new Error('此連結僅供查看訂單。')
    if (snapshot.fulfillmentMode !== 'dine-in')
      throw new Error('此測試訂單已改為自取，無法綁定桌號。')
    // This fixture represents a scanned table QR, not a customer-editable label
    // or a claim that a real robot destination has been configured.
    if (tableCode !== 'demo-a08')
      throw new Error('無法辨識此門市桌碼，請重新掃描。')
    snapshot.table = { label: 'A08', destination: 'demo-destination-a08' }
    records.set(token, snapshot)
    return structuredClone(snapshot)
  }

  function changeToTakeout(token: string) {
    const snapshot = read(token)
    if (!snapshot)
      return undefined
    if (snapshot.readOnly)
      return undefined
    snapshot.fulfillmentMode = 'takeout'
    delete snapshot.table
    records.set(token, snapshot)
    return structuredClone(snapshot)
  }

  return {
    bind,
    changeToTakeout,
    issue,
    // Receipt projection deliberately omits even the masked phone label.
    issueReceipt: (order: SubmittedOrder) => issue(order, undefined, true),
    read,
  }
}
