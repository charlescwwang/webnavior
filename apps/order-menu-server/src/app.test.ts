import { describe, expect, it } from 'vitest'

import { createPosBridgeApp } from './app'
import { createInMemorySimulatorGateway } from './simulator'

async function acceptedOrder(gateway: ReturnType<typeof createInMemorySimulatorGateway>, app: ReturnType<typeof createPosBridgeApp>) {
  const catalog = await gateway.getCatalog()
  const { payment } = await (await app.request('/v1/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 145, method: 'card' }) })).json()
  return {
    cart: {
      catalogRevision: catalog.revision,
      fulfillmentMode: 'takeout' as const,
      itemCount: 1,
      lines: [{ id: 'line-1', itemId: 'signature-shrimp-roll-bento', name: '周氏蝦捲招牌便當', options: {}, quantity: 1, unitPrice: 145 }],
      paymentId: payment.id,
      total: 145,
    },
    idempotencyKey: 'customer-session-0001',
  }
}

describe('pOS Bridge contract', () => {
  it('assigns a three-digit pickup number once after acceptance and retains it across concurrent replays', async () => {
    const gateway = createInMemorySimulatorGateway()
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://localhost:5166', gateway })
    const submission = await acceptedOrder(gateway, app)
    const send = async () => (await app.request('/v1/orders', { body: JSON.stringify(submission), headers: { 'Content-Type': 'application/json' }, method: 'POST' })).json()
    const [first, second] = await Promise.all([send(), send()])
    expect(first.order.receipt.pickupNumber).toMatch(/^[1-9]\d{2}$/)
    expect(second.order.receipt.pickupNumber).toBe(first.order.receipt.pickupNumber)
    expect((await send()).order.receipt.pickupNumber).toBe(first.order.receipt.pickupNumber)
  })
  it.each(['rejected', 'uncertain'] as const)('does not allocate a pickup number to a %s order', async (mode) => {
    const gateway = createInMemorySimulatorGateway(mode)
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://localhost:5166', gateway })
    const submission = await acceptedOrder(gateway, app)
    const result = await (await app.request('/v1/orders', { body: JSON.stringify(submission), headers: { 'Content-Type': 'application/json' }, method: 'POST' })).json()
    expect(result.order.receipt.status).toBe(mode)
    expect(result.order.receipt.pickupNumber).toBeUndefined()
  })
  it('shares one POS submission and receipt when the same order arrives concurrently', async () => {
    const gateway = createInMemorySimulatorGateway()
    let submitted = 0
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://localhost:5166', gateway: { ...gateway, submit: async (submission) => {
      submitted++
      return await gateway.submit(submission)
    } } })
    const submission = await acceptedOrder(gateway, app)
    const send = () => app.request('/v1/orders', { body: JSON.stringify(submission), headers: { 'Content-Type': 'application/json' }, method: 'POST' })
    const [first, second] = await Promise.all([send(), send()])
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(await second.json()).toEqual(await first.json())
    expect(submitted).toBe(1)
  })
  it('does not misreport an unavailable POS as an expired table hold', async () => {
    const gateway = createInMemorySimulatorGateway()
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://localhost:5166', gateway: { ...gateway, getTableHold: async () => {
      throw new Error('POS disconnected')
    } } })
    const { hold } = await (await app.request('/v1/seating/holds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 0, partySize: 2, tableIds: ['T1'], splitApproved: false }) })).json()
    expect((await app.request(`/v1/seating/holds/${hold.id}`)).status).toBe(503)
    const available = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://localhost:5166', gateway })
    expect((await available.request('/v1/seating/holds/expired')).status).toBe(404)
  })
  it('reserves through HTTP, locks the same hold to payment and occupies it exactly once', async () => {
    const gateway = createInMemorySimulatorGateway()
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://localhost:5166', gateway })
    const request = (path: string, body: unknown) => app.request(path, { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, method: 'POST' })
    const held = await request('/v1/seating/holds', { expectedRevision: 0, partySize: 5, tableIds: ['T1', 'T2'], splitApproved: true })
    expect(held.status).toBe(201)
    const { hold } = await held.json() as { hold: { id: string } }
    const paymentResponse = await request('/v1/payments', { amount: 145, method: 'card', tableHoldId: hold.id })
    expect(paymentResponse.status).toBe(201)
    const { payment } = await paymentResponse.json() as { payment: { id: string } }
    expect((await app.request(`/v1/seating/holds/${hold.id}`, { method: 'DELETE' })).status).toBe(409)
    expect((await request('/v1/payments', { amount: 145, method: 'card', tableHoldId: hold.id })).status).toBe(503)
    const order = await acceptedOrder(gateway, app)
    const submission = { ...order, cart: { ...order.cart, fulfillmentMode: 'dine-in', tableHoldId: hold.id, paymentId: payment.id } }
    const result = await request('/v1/orders', submission)
    expect(result.status).toBe(201)
    await expect(result.json()).resolves.toMatchObject({ order: { receipt: { status: 'accepted' } } })
    await expect((await app.request('/v1/seating')).json()).resolves.toMatchObject({ seating: { tables: expect.arrayContaining([{ id: 'T1', label: '1 號桌', capacity: 4, status: 'occupied' }, { id: 'T2', label: '2 號桌', capacity: 4, status: 'occupied' }]) } })
    await expect((await request('/v1/orders', submission)).json()).resolves.toMatchObject({ order: { receipt: { status: 'accepted' } } })
  })

  it('rejects a stale table snapshot and simultaneous claims, without accepting silent splitting', async () => {
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://localhost:5166', gateway: createInMemorySimulatorGateway() })
    const reserve = (body: unknown) => app.request('/v1/seating/holds', { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, method: 'POST' })
    expect((await reserve({ expectedRevision: 0, partySize: 5, tableIds: ['T1', 'T2'], splitApproved: false })).status).toBe(409)
    const results = await Promise.all([reserve({ expectedRevision: 0, partySize: 4, tableIds: ['T1'], splitApproved: false }), reserve({ expectedRevision: 0, partySize: 4, tableIds: ['T1'], splitApproved: false })])
    expect(results.map(response => response.status).sort()).toEqual([201, 409])
    expect((await reserve({ expectedRevision: 0, partySize: 4, tableIds: ['T2'], splitApproved: false })).status).toBe(409)
    expect((await reserve({ partySize: 4, tableIds: ['T2'], splitApproved: false })).status).toBe(400)
  })

  it('keeps pending and uncertain payment holds locked beyond the unpaid deadline', async () => {
    for (const status of ['pending', 'uncertain'] as const) {
      let now = 0
      const gateway = createInMemorySimulatorGateway('accepted', status, () => now)
      const hold = await gateway.reserveTables({ expectedRevision: 0, partySize: 2, tableIds: ['T1'], splitApproved: false })
      expect((await gateway.createPayment(145, 'card', hold.id)).status).toBe(status)
      now = 600001
      expect((await gateway.getSeating()).tables[0]?.status).toBe('held')
      await expect(gateway.releaseTables(hold.id)).rejects.toThrow('Payment')
    }
  })

  it('rejects dine-in without a payment-bound hold and does not steal seats through a pickup order', async () => {
    const gateway = createInMemorySimulatorGateway()
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://localhost:5166', gateway })
    const order = await acceptedOrder(gateway, app)
    const submit = (cart: unknown, idempotencyKey: string) => app.request('/v1/orders', { body: JSON.stringify({ cart, idempotencyKey }), headers: { 'Content-Type': 'application/json' }, method: 'POST' })
    await expect((await submit({ ...order.cart, fulfillmentMode: 'dine-in' }, 'dine-without-hold-0001')).json()).resolves.toMatchObject({ order: { receipt: { status: 'rejected' } } })
    const { hold } = await (await app.request('/v1/seating/holds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 0, partySize: 2, tableIds: ['T1'], splitApproved: false }) })).json()
    const { payment } = await (await app.request('/v1/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 145, method: 'card', tableHoldId: hold.id }) })).json()
    await expect((await submit({ ...order.cart, tableHoldId: hold.id, paymentId: payment.id }, 'pickup-with-hold-0001')).json()).resolves.toMatchObject({ order: { receipt: { status: 'rejected' } } })
    expect((await gateway.getTableHold(hold.id))?.status).toBe('locked')
  })
  it('returns the simulator catalog through the browser-facing bridge', async () => {
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://localhost:5166', gateway: createInMemorySimulatorGateway() })

    const response = await app.request('/v1/catalog', { headers: { Origin: 'http://localhost:5166' } })

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5166')
    const result = await response.json() as { catalog: { items: Array<{ category: string, id: string, price: number }>, revision: string, store: { name: string } } }
    expect(result.catalog.revision).toMatch(/^source-menu-v2-/)
    expect(result.catalog.store.name).toBe('周氏蝦捲')
    expect(result.catalog.items).toHaveLength(7)
    expect(Object.fromEntries(result.catalog.items.reduce((counts, item) => {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
      return counts
    }, new Map<string, number>()))).toEqual({ 便當: 5, 點心: 1, 麵食: 1 })
    expect(result.catalog.items).toContainEqual(expect.objectContaining({ id: 'signature-shrimp-roll-bento', name: '周氏蝦捲招牌便當', price: 145 }))
    expect(result.catalog.items).toContainEqual(expect.objectContaining({ id: 'dumplings', name: '水餃', price: 80 }))
  })

  it('returns one accepted test receipt for duplicate idempotency keys', async () => {
    const gateway = createInMemorySimulatorGateway()
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://localhost:5166', gateway })
    const request = { body: JSON.stringify(await acceptedOrder(gateway, app)), headers: { 'Content-Type': 'application/json' }, method: 'POST' }

    const first = await app.request('/v1/orders', request)
    const second = await app.request('/v1/orders', request)

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    const firstOrder = await first.json() as { order: { id: string, receipt: { environment: string, status: string } } }
    const secondOrder = await second.json() as { order: { id: string, receipt: { environment: string, status: string } } }
    expect(secondOrder).toEqual(firstOrder)
    expect(firstOrder.order.receipt).toMatchObject({ environment: 'test', status: 'accepted' })
  })

  it('keeps rejected submissions reviewable instead of converting them into success', async () => {
    const gateway = createInMemorySimulatorGateway('rejected')
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://localhost:5166', gateway })

    const response = await app.request('/v1/orders', {
      body: JSON.stringify(await acceptedOrder(gateway, app)),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    await expect(response.json()).resolves.toMatchObject({
      order: { receipt: { environment: 'test', retryable: true, status: 'rejected' } },
    })
  })

  it('rejects a stale catalog revision before forwarding an order to the POS', async () => {
    const gateway = createInMemorySimulatorGateway()
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://localhost:5166', gateway })
    const order = await acceptedOrder(gateway, app)
    const response = await app.request('/v1/orders', {
      body: JSON.stringify({ ...order, cart: { ...order.cart, catalogRevision: 'stale-revision' } }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      order: { receipt: { retryable: true, status: 'rejected' } },
    })
  })

  it('rejects a submission without an idempotency key', async () => {
    const gateway = createInMemorySimulatorGateway()
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://localhost:5166', gateway })
    const { idempotencyKey: _, ...withoutKey } = await acceptedOrder(gateway, app)

    const response = await app.request('/v1/orders', {
      body: JSON.stringify(withoutKey),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(response.status).toBe(400)
  })

  it('requires an authorized payment for the exact cart total', async () => {
    const gateway = createInMemorySimulatorGateway()
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://localhost:5166', gateway })
    const order = await acceptedOrder(gateway, app)
    const { paymentId: _, ...unpaidCart } = order.cart

    const unpaid = await app.request('/v1/orders', {
      body: JSON.stringify({ ...order, cart: unpaidCart }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    expect(unpaid.status).toBe(400)

    const { payment: wrongAmountPayment } = await (await app.request('/v1/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 144, method: 'card' }) })).json()
    const wrongAmount = await app.request('/v1/orders', {
      body: JSON.stringify({ ...order, cart: { ...order.cart, paymentId: wrongAmountPayment.id }, idempotencyKey: 'wrong-amount-0001' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    await expect(wrongAmount.json()).resolves.toMatchObject({ order: { receipt: { status: 'rejected' } } })
  })

  it.each(['pending', 'rejected', 'uncertain'] as const)('does not submit a cart with a %s payment', async (paymentStatus) => {
    const gateway = createInMemorySimulatorGateway('accepted', paymentStatus)
    const app = createPosBridgeApp({ authenticate: async () => 'test-device', allowedOrigin: 'http://localhost:5166', gateway })
    const response = await app.request('/v1/orders', {
      body: JSON.stringify(await acceptedOrder(gateway, app)),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    await expect(response.json()).resolves.toMatchObject({
      order: { receipt: { retryable: paymentStatus !== 'uncertain', status: paymentStatus === 'uncertain' ? 'uncertain' : 'rejected' } },
    })
  })
})
