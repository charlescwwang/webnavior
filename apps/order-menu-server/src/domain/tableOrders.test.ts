import { describe, expect, it, vi } from 'vitest'

import { createInMemorySimulatorGateway } from '../simulator'
import { createTableOrders } from './tableOrders'

async function fixture(mode: 'accepted' | 'uncertain' = 'accepted') {
  const simulator = createInMemorySimulatorGateway(mode)
  const payment = vi.fn(simulator.createPayment)
  const submit = vi.fn(simulator.submitTableOrder!)
  const rounds = createTableOrders({ ...simulator, createPayment: payment, submitTableOrder: submit })
  const context = rounds.open('table-service')
  const catalog = await simulator.getCatalog()
  const item = catalog.items[0]!
  const input = { confirmedByUser: true as const, contextId: context.id, idempotencyKey: 'table-order-key-0001', cart: { catalogRevision: catalog.revision, itemCount: 2, total: item.price * 2, lines: [{ id: 'line-1', itemId: item.id, name: item.name, options: {}, quantity: 2, unitPrice: item.price }] } }
  return { simulator, rounds, context, input, payment, submit }
}

describe('table-service order round', () => {
  it('pins a random a01–a09 table and mode until explicit reset', async () => {
    const { rounds, context } = await fixture()
    expect(context.table?.label).toMatch(/^a0[1-9]$/)
    expect(rounds.open('kiosk')).toEqual(context)
    expect(rounds.open('kiosk', context.id).serviceMode).toBe('kiosk')
    expect(rounds.open('kiosk').table).toBeUndefined()
  })
  it('submits one confirmed table order without payment and shares concurrent/retried receipts', async () => {
    const { rounds, input, submit, payment, context } = await fixture()
    const [first, second] = await Promise.all([rounds.submit(input), rounds.submit(input)])
    expect(first.receipt.status).toBe('accepted')
    expect(first.serviceMode).toBe('table-service')
    expect(first.table).toEqual(context.table)
    expect(first.receipt.pickupNumber).toBeUndefined()
    expect(first.cart).not.toHaveProperty('paymentId')
    expect(second).toEqual(first)
    expect(await rounds.submit(input)).toEqual(first)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(payment).not.toHaveBeenCalled()
    await expect(rounds.submit({ ...input, idempotencyKey: 'another-order-key-0001' })).rejects.toThrow()
  })
  it('does not infer unpaid support from an existing paid POS API', async () => {
    const { simulator, input } = await fixture()
    const { submitTableOrder: _unsupported, ...paidOnly } = simulator
    const rounds = createTableOrders(paidOnly)
    const context = rounds.open('table-service')
    expect(context.directSubmissionSupported).toBe(false)
    await expect(rounds.submit({ ...input, contextId: context.id })).rejects.toThrow('尚未支援')
  })
  it('rejects kiosk context, another device context and changed retry payloads', async () => {
    const { rounds, input, simulator } = await fixture()
    const other = createTableOrders(simulator)
    await expect(other.submit(input)).rejects.toThrow('有效')
    const kiosk = other.open('kiosk')
    await expect(other.submit({ ...input, contextId: kiosk.id })).rejects.toThrow('有效')
    await rounds.submit(input)
    await expect(rounds.submit({ ...input, cart: { ...input.cart, total: 1 } })).rejects.toThrow('內容不一致')
  })
  it('validates price and catalog before calling the unpaid adapter', async () => {
    const { rounds, input, submit } = await fixture()
    const wrong = await rounds.submit({ ...input, cart: { ...input.cart, total: 1 } })
    expect(wrong.receipt.status).toBe('rejected')
    expect(submit).not.toHaveBeenCalled()
    const stale = await rounds.submit({ ...input, idempotencyKey: 'stale-catalog-0001', cart: { ...input.cart, catalogRevision: 'old' } })
    expect(stale.receipt.status).toBe('rejected')
    expect(submit).not.toHaveBeenCalled()
  })
  it('locks unknown outcomes against new rounds and new submission keys', async () => {
    const { rounds, context, input, submit } = await fixture('uncertain')
    const order = await rounds.submit(input)
    expect(order.receipt.status).toBe('uncertain')
    expect(() => rounds.open('kiosk', context.id)).toThrow('尚未確認')
    await expect(rounds.submit({ ...input, idempotencyKey: 'retry-other-key-0001' })).rejects.toThrow('尚待確認')
    expect(await rounds.submit(input)).toEqual(order)
    expect(submit).toHaveBeenCalledTimes(1)
  })
})
