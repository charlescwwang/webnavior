import { describe, expect, it, vi } from 'vitest'

import { createPosBridgeApp } from './app'
import { createInMemorySimulatorGateway } from './simulator'

async function placeDineIn(mode: 'accepted' | 'uncertain' = 'accepted') {
  const gateway = createInMemorySimulatorGateway(mode, 'authorized', Date.now, 'after-order')
  const app = createPosBridgeApp({ allowedOrigin: 'http://localhost:5166', gateway, tableAssignment: 'after-order' })
  const catalog = await gateway.getCatalog()
  const item = catalog.items[0]!
  const payment = await gateway.createPayment(item.price, 'linepay')
  const submission = {
    customerPhone: '0900000000',
    idempotencyKey: 'continuation-order-0001',
    cart: { catalogRevision: catalog.revision, fulfillmentMode: 'dine-in', itemCount: 1, paymentId: payment.id, total: item.price, lines: [{ id: 'line-1', itemId: item.id, name: item.name, options: {}, quantity: 1, unitPrice: item.price }] },
  }
  const send = () => app.request('/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(submission) })
  const result = await (await send()).json()
  return { app, result, send }
}

describe('order continuation after kiosk checkout', () => {
  it.each([false, true])('changes the same test order to pickup with table bound=%s and retains its payment and expiry', async (bound) => {
    const { app, result, send } = await placeDineIn()
    const path = `/v1/continuations/${result.continuation.token}`
    if (bound)
      await app.request(`${path}/table`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tableCode: 'demo-a08' }) })
    const original = await (await app.request(path)).json()
    const change = () => app.request(`${path}/takeout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) })
    const response = await change()
    expect(response.status).toBe(200)
    const changed = await response.json()
    expect(changed).toMatchObject({ fulfillmentMode: 'takeout', orderId: original.orderId, expiresAt: original.expiresAt, lines: original.lines, total: original.total, phoneLabel: original.phoneLabel })
    expect(changed.table).toBeUndefined()
    expect(await (await app.request(path)).json()).toEqual(changed)
    expect(await (await change()).json()).toEqual(changed)
    const replay = await (await send()).json()
    expect(replay.order).toEqual(result.order)
    expect(replay.continuation).toEqual(result.continuation)
    expect(await (await app.request(path)).json()).toEqual(changed)
    const staleBind = await app.request(`${path}/table`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tableCode: 'demo-a08' }) })
    expect(staleBind.status).toBe(409)
    expect(await (await app.request(path)).json()).toEqual(changed)
  })

  it('requires explicit confirmation before changing to pickup', async () => {
    const { app, result } = await placeDineIn()
    const path = `/v1/continuations/${result.continuation.token}`
    const original = await (await app.request(path)).json()
    for (const body of [{}, { confirmed: false }]) {
      const response = await app.request(`${path}/takeout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      expect(response.status).toBe(400)
      expect(await (await app.request(path)).json()).toEqual(original)
    }
  })

  it('does not allow an expired or unknown link to change an order to pickup', async () => {
    vi.useFakeTimers()
    try {
      const { app, result } = await placeDineIn()
      vi.setSystemTime(Date.now() + 31 * 60_000)
      for (const token of [result.continuation.token, 'not-issued']) {
        const response = await app.request(`/v1/continuations/${token}/takeout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) })
        expect(response.status).toBe(404)
      }
    }
    finally { vi.useRealTimers() }
  })

  it('accepts paid dine-in without a selected table and binds only a recognized scanned table', async () => {
    const { app, result, send } = await placeDineIn()
    expect(result.order.receipt.status).toBe('accepted')
    expect(result.continuation.token).toBeTypeOf('string')
    expect(await (await send()).json()).toMatchObject({ continuation: result.continuation })
    const path = `/v1/continuations/${result.continuation.token}`
    const snapshot = await (await app.request(path)).json()
    expect(snapshot.orderId).toBe(result.order.id)
    expect(snapshot.phoneLabel).toBe('0900***000')
    expect(JSON.stringify(snapshot)).not.toContain('0900000000')
    expect(snapshot.table).toBeUndefined()
    const unknown = await app.request(`${path}/table`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tableCode: 'unknown' }) })
    expect(unknown.status).toBe(400)
    const bind = () => app.request(`${path}/table`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tableCode: 'demo-a08' }) })
    expect(await (await bind()).json()).toMatchObject({ table: { label: 'A08', destination: 'demo-destination-a08' } })
    expect(await (await bind()).json()).toMatchObject({ table: { label: 'A08' } })
    expect((await app.request('/v1/continuations/not-issued')).status).toBe(404)
  })

  it('does not issue a continuation for an uncertain order', async () => {
    const { result } = await placeDineIn('uncertain')
    expect(result.order.receipt.status).toBe('uncertain')
    expect(result.continuation).toBeUndefined()
  })

  it('expires access without allowing receipt replay to renew it', async () => {
    vi.useFakeTimers()
    try {
      const { app, result, send } = await placeDineIn()
      vi.setSystemTime(Date.now() + 31 * 60_000)
      expect((await app.request(`/v1/continuations/${result.continuation.token}`)).status).toBe(404)
      expect((await (await send()).json()).continuation).toBeUndefined()
    }
    finally { vi.useRealTimers() }
  })
})
