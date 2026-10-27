import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPosBridgeApp } from '../../order-menu-server/src/app'
import { createInMemorySimulatorGateway } from '../../order-menu-server/src/simulator'
import { changeToTakeout, continuationUrl, readContinuation } from './continuation'

afterEach(() => vi.restoreAllMocks())

describe('customer order continuation links', () => {
  it('uses the same clean, encoded destination for desktop links and QR rendering', () => {
    const link = continuationUrl({ token: 'test-order-capability', expiresAt: Date.now() + 1000 }, 'http://localhost:5166/?old=value#menu')
    expect(link).toBe('http://localhost:5166/?continuation=test-order-capability')
    expect(new URL(link).searchParams.has('old')).toBe(false)
  })

  it('changes a bound test order to pickup through the client without another payment or submission', async () => {
    const pos = createInMemorySimulatorGateway('accepted', 'authorized', Date.now, 'after-order')
    const payments = vi.spyOn(pos, 'createPayment')
    const submissions = vi.spyOn(pos, 'submit')
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://menu.test', gateway: pos, tableAssignment: 'after-order' })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => app.request(String(input), init))
    const catalog = await pos.getCatalog()
    const item = catalog.items[0]!
    const { payment } = await (await app.request('/v1/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: item.price, method: 'linepay' }) })).json()
    const order = await (await app.request('/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      idempotencyKey: 'pickup-change-order-0001',
      cart: { catalogRevision: catalog.revision, fulfillmentMode: 'dine-in', paymentId: payment.id, itemCount: 1, total: item.price, lines: [{ id: 'line-1', itemId: item.id, name: item.name, options: {}, quantity: 1, unitPrice: item.price }] },
    }) })).json()
    const token = order.continuation.token
    const bound = await readContinuation('http://bridge.test', token, 'demo-a08')
    expect(bound.table?.label).toBe('A08')
    const changed = await changeToTakeout('http://bridge.test', token)
    expect(changed.fulfillmentMode).toBe('takeout')
    expect(changed.table).toBeUndefined()
    expect(changed.orderId).toBe(bound.orderId)
    expect(changed.total).toBe(bound.total)
    expect(changed.expiresAt).toBe(bound.expiresAt)
    expect(await readContinuation('http://bridge.test', token)).toEqual(changed)
    await expect(readContinuation('http://bridge.test', token, 'demo-a08')).rejects.toThrow('已改為自取')
    await expect(changeToTakeout('http://bridge.test', 'not-issued')).rejects.toThrow('接續連結已失效')
    expect(payments).toHaveBeenCalledOnce()
    expect(submissions).toHaveBeenCalledOnce()
  })
})
