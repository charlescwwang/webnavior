import { describe, expect, it } from 'vitest'

import { createPosBridgeApp } from './app'
import { createInMemorySimulatorGateway } from './simulator'

async function acceptedOrder(gateway = createInMemorySimulatorGateway()) {
  const catalog = await gateway.getCatalog()
  const payment = await gateway.createPayment(95, 'card')
  return {
    cart: {
      catalogRevision: catalog.revision,
      fulfillmentMode: 'takeout' as const,
      itemCount: 1,
      lines: [{ id: 'line-1', itemId: 'dish-ai-1789630028994-0', name: '炸蝦捲(每份二條)', options: {}, quantity: 1, unitPrice: 95 }],
      paymentId: payment.id,
      total: 95,
    },
    idempotencyKey: 'customer-session-0001',
  }
}

describe('pOS Bridge contract', () => {
  it('returns the simulator catalog through the browser-facing bridge', async () => {
    const app = createPosBridgeApp({ allowedOrigin: 'http://localhost:5166', gateway: createInMemorySimulatorGateway() })

    const response = await app.request('/v1/catalog', { headers: { Origin: 'http://localhost:5166' } })

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5166')
    const result = await response.json() as { catalog: { items: Array<{ category: string, id: string, price: number }>, revision: string, store: { name: string } } }
    expect(result.catalog.revision).toMatch(/^source-menu-v2-/)
    expect(result.catalog.store.name).toBe('周氏蝦捲')
    expect(result.catalog.items).toHaveLength(35)
    expect(Object.fromEntries(result.catalog.items.reduce((counts, item) => {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
      return counts
    }, new Map<string, number>()))).toEqual({ 主食: 11, 小點: 18, 其他: 2, 套餐: 2, 飲品: 2 })
    expect(result.catalog.items).toContainEqual(expect.objectContaining({ id: 'fish-floss-minced-pork-rice-set', name: '魚鬆肉燥飯套餐', price: 380 }))
    expect(result.catalog.items).toContainEqual(expect.objectContaining({ id: 'dish-ai-1789630028994-0', name: '炸蝦捲(每份二條)', price: 95 }))
  })

  it('returns one accepted test receipt for duplicate idempotency keys', async () => {
    const gateway = createInMemorySimulatorGateway()
    const app = createPosBridgeApp({ allowedOrigin: 'http://localhost:5166', gateway })
    const request = { body: JSON.stringify(await acceptedOrder(gateway)), headers: { 'Content-Type': 'application/json' }, method: 'POST' }

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
    const app = createPosBridgeApp({ allowedOrigin: 'http://localhost:5166', gateway })

    const response = await app.request('/v1/orders', {
      body: JSON.stringify(await acceptedOrder(gateway)),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    await expect(response.json()).resolves.toMatchObject({
      order: { receipt: { environment: 'test', retryable: true, status: 'rejected' } },
    })
  })

  it('rejects a stale catalog revision before forwarding an order to the POS', async () => {
    const gateway = createInMemorySimulatorGateway()
    const app = createPosBridgeApp({ allowedOrigin: 'http://localhost:5166', gateway })
    const order = await acceptedOrder(gateway)
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
    const app = createPosBridgeApp({ allowedOrigin: 'http://localhost:5166', gateway })
    const { idempotencyKey: _, ...withoutKey } = await acceptedOrder(gateway)

    const response = await app.request('/v1/orders', {
      body: JSON.stringify(withoutKey),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(response.status).toBe(400)
  })

  it('requires an authorized payment for the exact cart total', async () => {
    const gateway = createInMemorySimulatorGateway()
    const app = createPosBridgeApp({ allowedOrigin: 'http://localhost:5166', gateway })
    const order = await acceptedOrder(gateway)
    const { paymentId: _, ...unpaidCart } = order.cart

    const unpaid = await app.request('/v1/orders', {
      body: JSON.stringify({ ...order, cart: unpaidCart }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    expect(unpaid.status).toBe(400)

    const wrongAmountPayment = await gateway.createPayment(94, 'card')
    const wrongAmount = await app.request('/v1/orders', {
      body: JSON.stringify({ ...order, cart: { ...order.cart, paymentId: wrongAmountPayment.id }, idempotencyKey: 'wrong-amount-0001' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    await expect(wrongAmount.json()).resolves.toMatchObject({ order: { receipt: { status: 'rejected' } } })
  })

  it.each(['pending', 'rejected', 'uncertain'] as const)('does not submit a cart with a %s payment', async (paymentStatus) => {
    const gateway = createInMemorySimulatorGateway('accepted', paymentStatus)
    const app = createPosBridgeApp({ allowedOrigin: 'http://localhost:5166', gateway })
    const response = await app.request('/v1/orders', {
      body: JSON.stringify(await acceptedOrder(gateway)),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    await expect(response.json()).resolves.toMatchObject({
      order: { receipt: { retryable: paymentStatus !== 'uncertain', status: paymentStatus === 'uncertain' ? 'uncertain' : 'rejected' } },
    })
  })
})
