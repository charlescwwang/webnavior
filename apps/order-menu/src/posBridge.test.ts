import type { ContinuationAccess } from '../../order-menu-server/src/domain/continuationContracts'
import type { CartSnapshot } from './domain/order-machine'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPosBridgeApp } from '../../order-menu-server/src/app'
import { createInMemorySimulatorGateway } from '../../order-menu-server/src/simulator'
import { createPosBridgeGateway } from './pos-bridge'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('paid order continuation through the browser gateway', () => {
  // Report: this chat, 2026-10-18 — completion shows the reward without the table-binding order QR.
  it.each(['takeout', 'expired-dine-in'] as const)('issues a fresh dine-in continuation after a previous %s order on the same kiosk', async (previous) => {
    vi.useFakeTimers()
    const pos = createInMemorySimulatorGateway('accepted', 'authorized', Date.now, 'after-order')
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://menu.test', gateway: pos, tableAssignment: 'after-order' })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => app.request(String(input), init))
    const issued: ContinuationAccess[] = []
    const browser = createPosBridgeGateway('http://bridge.test', () => undefined, { phone: () => undefined, onContinuation: access => issued.push(access) })
    const catalog = await pos.getCatalog()
    const item = catalog.items[0]!
    const { payment: firstPayment } = await (await app.request('/v1/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: item.price, method: 'linepay' }) })).json()
    const cart: CartSnapshot = {
      catalogRevision: catalog.revision,
      fulfillmentMode: previous === 'takeout' ? 'takeout' : 'dine-in',
      paymentId: firstPayment.id,
      itemCount: 1,
      total: item.price,
      lines: [{ id: 'line-1', itemId: item.id, name: item.name, options: {}, quantity: 1, unitPrice: item.price }],
    }
    const first = await browser.submit(cart)
    expect(first.receipt.status).toBe('accepted')
    const before = issued.length
    vi.setSystemTime(Date.now() + 31 * 60_000)
    const { payment: nextPayment } = await (await app.request('/v1/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: item.price, method: 'jkopay' }) })).json()
    const next = await browser.submit({ ...cart, fulfillmentMode: 'dine-in', paymentId: nextPayment.id })
    expect(next.receipt.status).toBe('accepted')
    expect(issued).toHaveLength(before + 1)
    expect(next.id).not.toBe(first.id)
    expect(next.cart.fulfillmentMode).toBe('dine-in')
    expect(await (await app.request(`/v1/continuations/${issued.at(-1)!.token}`)).json()).toMatchObject({ orderId: next.id })
    expect((await browser.submit({ ...cart, fulfillmentMode: 'dine-in', paymentId: nextPayment.id })).id).toBe(next.id)
    expect((await browser.submit({ ...cart })).id).toBe(first.id)
  })

  it('recovers a lost accepted response using the same payment without creating another order', async () => {
    const pos = createInMemorySimulatorGateway('accepted', 'authorized', Date.now, 'after-order')
    const submit = vi.spyOn(pos, 'submit')
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://menu.test', gateway: pos, tableAssignment: 'after-order' })
    let loseResponse = true
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const response = await app.request(String(input), init)
      if (loseResponse) {
        loseResponse = false
        throw new Error('Response lost after acceptance')
      }
      return response
    })
    const issued: ContinuationAccess[] = []
    const browser = createPosBridgeGateway('http://bridge.test', () => undefined, { phone: () => undefined, onContinuation: access => issued.push(access) })
    const catalog = await pos.getCatalog()
    const item = catalog.items[0]!
    const { payment } = await (await app.request('/v1/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: item.price, method: 'linepay' }) })).json()
    const cart: CartSnapshot = { catalogRevision: catalog.revision, fulfillmentMode: 'dine-in', paymentId: payment.id, itemCount: 1, total: item.price, lines: [{ id: 'line-1', itemId: item.id, name: item.name, options: {}, quantity: 1, unitPrice: item.price }] }
    expect((await browser.submit(cart)).receipt.status).toBe('uncertain')
    expect(issued).toHaveLength(0)
    const recovered = await browser.submit({ ...cart })
    expect(recovered.receipt.status).toBe('accepted')
    expect(issued).toHaveLength(1)
    expect(submit).toHaveBeenCalledOnce()
    expect(await (await app.request(`/v1/continuations/${issued[0]!.token}`)).json()).toMatchObject({ orderId: recovered.id })
  })
})
