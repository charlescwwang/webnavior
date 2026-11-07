import { describe, expect, it } from 'vitest'

import { createPosBridgeApp } from './app'
import { createInMemorySimulatorGateway } from './simulator'

// Report: docs/research/2026-10-27-security-audit.md
// These requests run against a scratch simulator, never the deployed POS.
describe('pOS security boundary', () => {
  it('rejects unauthenticated payment writes even from the allowed Origin', async () => {
    const app = createPosBridgeApp({ allowedOrigin: 'https://menu.test', gateway: createInMemorySimulatorGateway(), authenticate: async () => undefined })
    const response = await app.request('/v1/payments', { method: 'POST', headers: { 'Origin': 'https://menu.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 145, method: 'linepay' }) })
    expect(response.status).toBe(401)
    expect((await app.request('/v1/catalog')).status).toBe(200)
  })

  it('rejects a forged total and prevents reusing one payment with another submission key', async () => {
    const gateway = createInMemorySimulatorGateway()
    let submissions = 0
    const app = createPosBridgeApp({ allowedOrigin: 'https://menu.test', authenticate: async () => 'site-1/device-1', gateway: { ...gateway, submit: async (submission) => {
      submissions++
      return gateway.submit(submission)
    } } })
    const catalog = await gateway.getCatalog()
    const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const { payment } = await (await post('/v1/payments', { amount: 145, method: 'linepay' })).json()
    const cart = { catalogRevision: catalog.revision, fulfillmentMode: 'takeout', itemCount: 2, lines: [{ id: 'line-1', itemId: 'signature-shrimp-roll-bento', name: '蝦捲招牌便當', options: {}, quantity: 2, unitPrice: 145 }], paymentId: payment.id, total: 145 }
    const forged = await post('/v1/orders', { cart, idempotencyKey: 'forged-total-0001' })
    expect(await forged.json()).toMatchObject({ order: { receipt: { status: 'rejected' } } })
    expect(submissions).toBe(0)
    const valid = { ...cart, itemCount: 1, lines: [{ ...cart.lines[0], quantity: 1 }] }
    const first = await post('/v1/orders', { cart: valid, idempotencyKey: 'valid-order-0001' })
    expect(await first.json()).toMatchObject({ order: { receipt: { status: 'accepted' } } })
    const reused = await post('/v1/orders', { cart: valid, idempotencyKey: 'another-order-0001' })
    expect(await reused.json()).toMatchObject({ order: { receipt: { status: 'rejected' } } })
    expect(submissions).toBe(1)
  })
})

// The test authorizer represents already verified devices in distinct Sites.
// Production derives both identifiers from the API's bootstrap response.
describe('pOS isolation and replay', () => {
  it('isolates payment reads and order submissions between Sites', async () => {
    const gateway = createInMemorySimulatorGateway()
    const app = createPosBridgeApp({ allowedOrigin: 'https://menu.test', gateway, authenticate: async request => request.headers.get('test-owner') ?? undefined })
    const paymentResponse = await app.request('/v1/payments', { method: 'POST', headers: { 'test-owner': 'site-A/device-A', 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 145, method: 'linepay' }) })
    const { payment } = await paymentResponse.json()
    expect((await app.request(`/v1/payments/${payment.id}`, { headers: { 'test-owner': 'site-B/device-B' } })).status).toBe(404)
    expect((await app.request(`/v1/payments/${payment.id}`, { headers: { 'test-owner': 'site-A/device-A' } })).status).toBe(200)
    const catalog = await gateway.getCatalog()
    const cart = { catalogRevision: catalog.revision, fulfillmentMode: 'takeout', itemCount: 1, lines: [{ id: 'line-1', itemId: 'signature-shrimp-roll-bento', name: '蝦捲招牌便當', options: {}, quantity: 1, unitPrice: 145 }], paymentId: payment.id, total: 145 }
    const send = (owner: string, key: string) => app.request('/v1/orders', { method: 'POST', headers: { 'test-owner': owner, 'Content-Type': 'application/json' }, body: JSON.stringify({ cart, idempotencyKey: key }) })
    expect((await send('site-B/device-B', 'foreign-order-0001')).status).toBe(404)
    const [first, second] = await Promise.all([send('site-A/device-A', 'owned-order-0001'), send('site-A/device-A', 'owned-order-0002')])
    const states = [await first.json(), await second.json()].map(value => value.order.receipt.status).sort()
    expect(states).toEqual(['accepted', 'rejected'])
  })

  it('fails closed when device verification is unavailable', async () => {
    const app = createPosBridgeApp({ allowedOrigin: 'https://menu.test', gateway: createInMemorySimulatorGateway(), authenticate: async () => {
      throw new Error('API offline')
    } })
    expect((await app.request('/v1/payments', { method: 'POST' })).status).toBe(503)
    expect((await app.request('/v1/continuations/not-issued')).status).toBe(404)
  })
})

describe('server-owned cart calculations', () => {
  it('checks option prices and rejects an idempotency key reused with changed contents', async () => {
    const gateway = createInMemorySimulatorGateway()
    const catalog = await gateway.getCatalog()
    const item = catalog.items[0]!
    item.optionGroups = [{ id: 'size', label: '份量', required: true, values: [{ id: 'large', label: '大份', priceDelta: 20 }] }]
    const app = createPosBridgeApp({ allowedOrigin: 'https://menu.test', authenticate: async () => 'device-1', gateway: { ...gateway, getCatalog: async () => catalog } })
    const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const { payment } = await (await post('/v1/payments', { amount: item.price + 20, method: 'linepay' })).json()
    const cart = { catalogRevision: catalog.revision, fulfillmentMode: 'takeout', itemCount: 1, paymentId: payment.id, total: item.price + 20, lines: [{ id: 'line-1', itemId: item.id, name: item.name, quantity: 1, options: { size: 'large' }, unitPrice: item.price + 20 }] }
    const invalid = await post('/v1/orders', { cart: { ...cart, lines: [{ ...cart.lines[0], options: { size: 'invented' } }] }, idempotencyKey: 'bad-option-order-0001' })
    expect(await invalid.json()).toMatchObject({ order: { receipt: { status: 'rejected' } } })
    const first = await post('/v1/orders', { cart, idempotencyKey: 'option-order-0001' })
    const accepted = await first.json()
    expect(accepted).toMatchObject({ order: { receipt: { status: 'accepted' } } })
    const changed = await post('/v1/orders', { cart: { ...cart, total: 1 }, idempotencyKey: 'option-order-0001' })
    expect(await changed.json()).toMatchObject({ order: { receipt: { status: 'rejected' } } })
    const replay = await post('/v1/orders', { cart, idempotencyKey: 'option-order-0001' })
    expect(await replay.json()).toEqual(accepted)
  })
})
