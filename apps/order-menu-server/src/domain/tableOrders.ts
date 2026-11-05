import type { OrderingContext, ServiceMode } from '../../../../packages/stage-shared/src/kioskServiceMode'
import type { PosGateway, SubmissionReceipt, SubmittedTableOrder, TableOrderSubmission } from './contracts'

import { randomInt, randomUUID } from 'node:crypto'

import { validateCartAgainstCatalog } from './bridge'

/** Owns one authenticated device's pinned order round and unpaid submission lifecycle. */
export function createTableOrders(gateway: PosGateway) {
  let context: OrderingContext | undefined
  let settled: SubmittedTableOrder | undefined
  const receipts = new Map<string, { fingerprint: string, order: SubmittedTableOrder }>()
  const pending = new Map<string, { fingerprint: string, order: Promise<SubmittedTableOrder> }>()

  function open(mode: ServiceMode, previousId?: string): OrderingContext {
    if (previousId !== undefined && context?.id !== previousId)
      throw new Error('訂單情境已更新，請重新載入。')
    if (previousId !== undefined && (pending.size || settled?.receipt.status === 'uncertain'))
      throw new Error('訂單尚未確認，請勿切換模式或重新開始。')
    if (!context || previousId !== undefined) {
      const label = `a${String(randomInt(1, 10)).padStart(2, '0')}`
      context = { id: randomUUID(), serviceMode: mode, ...(mode === 'table-service' ? { table: { id: label, label } } : {}), directSubmissionSupported: Boolean(gateway.submitTableOrder) }
      settled = undefined
    }
    return structuredClone(context)
  }

  async function submit(input: TableOrderSubmission): Promise<SubmittedTableOrder> {
    if (input.confirmedByUser !== true)
      throw new Error('必須先確認訂單。')
    const fingerprint = JSON.stringify(input)
    const prior = receipts.get(input.idempotencyKey) ?? pending.get(input.idempotencyKey)
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new Error('同一送單識別碼的內容不一致。')
      return await prior.order
    }
    const round = context
    if (!round || round.id !== input.contextId || round.serviceMode !== 'table-service' || !round.table)
      throw new Error('此裝置沒有有效的隨桌訂單情境。')
    if (settled?.receipt.status === 'accepted' || settled?.receipt.status === 'uncertain' || pending.size)
      throw new Error('此輪訂單已送出或尚待確認，請勿再次送單。')
    const submitTableOrder = gateway.submitTableOrder
    if (!submitTableOrder)
      throw new Error('目前 POS 尚未支援未付款的隨桌送單。')
    const table = round.table
    const operation = (async () => {
      const catalog = await gateway.getCatalog()
      let receipt: SubmissionReceipt | undefined = input.cart.catalogRevision !== catalog.revision
        ? { customerMessage: '菜單已更新，請重新確認餐點後再送單。', environment: 'test' as const, retryable: true, status: 'rejected' as const }
        : validateCartAgainstCatalog(input, catalog)
      if (!receipt) {
        try {
          receipt = await submitTableOrder({ ...input, table })
        }
        catch { receipt = { customerMessage: '無法確認是否已收單，請勿重複送單。', environment: 'test', retryable: false, status: 'uncertain' } }
      }
      // Table service never creates a pickup number, even if an adapter included one.
      const { pickupNumber: _pickupNumber, ...tableReceipt } = receipt
      const order: SubmittedTableOrder = { id: `order-${randomUUID()}`, serviceMode: 'table-service', table, cart: { ...input.cart, fulfillmentMode: 'dine-in' }, receipt: tableReceipt }
      settled = order
      receipts.set(input.idempotencyKey, { fingerprint, order })
      return order
    })()
    pending.set(input.idempotencyKey, { fingerprint, order: operation })
    try {
      return await operation
    }
    finally { pending.delete(input.idempotencyKey) }
  }

  return { open, submit }
}
