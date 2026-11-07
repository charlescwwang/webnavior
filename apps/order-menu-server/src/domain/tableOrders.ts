import type { OrderingContext, ServiceMode } from '../../../../packages/stage-shared/src/kioskServiceMode'
import type { PosGateway, SubmissionReceipt, SubmittedTableOrder, TableOrderSubmission } from './contracts'

import { randomInt, randomUUID } from 'node:crypto'

import { validateCartAgainstCatalog } from './bridge'

/** A proven pre-submission refusal, distinct from an unknown POS outcome. */
export class TableOrderError extends Error {
  constructor(readonly code: 'CONFIRMATION_REQUIRED' | 'IDEMPOTENCY_CONFLICT' | 'INVALID_CONTEXT' | 'ALREADY_SUBMITTED' | 'ORDER_PENDING' | 'SUBMISSION_UNAVAILABLE', message: string) {
    super(message)
    this.name = 'TableOrderError'
  }
}

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
      throw new TableOrderError('CONFIRMATION_REQUIRED', '請先核對訂單內容，再確認是否送出。')
    const fingerprint = JSON.stringify(input)
    const prior = receipts.get(input.idempotencyKey) ?? pending.get(input.idempotencyKey)
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new TableOrderError('IDEMPOTENCY_CONFLICT', '這次送單內容已變更，請重新確認訂單。')
      return await prior.order
    }
    const round = context
    if (!round || round.id !== input.contextId || round.serviceMode !== 'table-service' || !round.table)
      throw new TableOrderError('INVALID_CONTEXT', '訂單資訊已更新，請重新確認訂單後再送出。')
    if (settled?.receipt.status === 'accepted')
      throw new TableOrderError('ALREADY_SUBMITTED', '訂單已送出，請勿重複送出。')
    if (settled?.receipt.status === 'uncertain' || pending.size)
      throw new TableOrderError('ORDER_PENDING', '訂單送出結果尚待確認，請勿重複送出。')
    const submitTableOrder = gateway.submitTableOrder
    if (!submitTableOrder)
      throw new TableOrderError('SUBMISSION_UNAVAILABLE', '這份訂單無法直接送出。')
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
