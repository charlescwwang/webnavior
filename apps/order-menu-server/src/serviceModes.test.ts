import type { ServiceMode } from '../../../packages/stage-shared/src/kioskServiceMode'

import { describe, expect, it, vi } from 'vitest'

import { createPosBridgeApp } from './app'
import { createInMemorySimulatorGateway } from './simulator'

async function fixture(initialMode: ServiceMode = 'table-service') {
  let mode = initialMode
  const gateway = createInMemorySimulatorGateway()
  const payment = vi.fn(gateway.createPayment)
  const app = createPosBridgeApp({ allowedOrigin: 'http://menu.test', authenticate: async request => request.headers.get('x-test-owner') ?? 'device-1', serviceMode: async () => mode, gateway: { ...gateway, createPayment: payment } })
  const request = (path: string, body?: unknown, owner?: string) => app.request(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(owner ? { 'x-test-owner': owner } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const { context } = await (await request('/v1/ordering-context')).json()
  const catalog = await gateway.getCatalog()
  const item = catalog.items[0]!
  const cart = { catalogRevision: catalog.revision, lines: [{ id: 'line-1', itemId: item.id, name: item.name, options: {}, quantity: 1, unitPrice: item.price }], total: item.price, itemCount: 1 }
  return { app, request, context, cart, payment, setMode: (next: ServiceMode) => mode = next }
}

describe('authenticated service mode API', () => {
  it('pins the server mode/table despite caller fields and requires explicit confirmation', async () => {
    const { request, context, cart, payment } = await fixture()
    const input = { contextId: context.id, idempotencyKey: 'table-api-key-0001', cart }
    expect((await request('/v1/table-orders', input)).status).toBe(400)
    expect((await request('/v1/table-orders', { ...input, confirmedByUser: true }, 'device-2')).status).toBe(409)
    const response = await request('/v1/table-orders', { ...input, confirmedByUser: true, table: { id: 'attacker-table' } })
    expect(response.status).toBe(201)
    const result = await response.json()
    expect(result.order.table).toEqual(context.table)
    expect(result.order.receipt.status).toBe('accepted')
    expect(result.order.receipt.pickupNumber).toBeUndefined()
    expect(payment).not.toHaveBeenCalled()
    expect((await request('/v1/orders', { idempotencyKey: 'paid-api-key-00001', cart: { ...cart, fulfillmentMode: 'dine-in' } })).status).toBe(400)
  })
  it('applies configuration only on a new round and does not discard a pending Kiosk payment', async () => {
    const { request, context, cart, setMode } = await fixture('kiosk')
    const { payment } = await (await request('/v1/payments', { amount: cart.total, method: 'card' })).json()
    setMode('table-service')
    expect((await (await request('/v1/ordering-context')).json()).context).toEqual(context)
    expect((await request('/v1/ordering-context', { previousId: context.id })).status).toBe(409)
    const submitted = await request('/v1/orders', { idempotencyKey: 'paid-round-key-0001', cart: { ...cart, fulfillmentMode: 'takeout', paymentId: payment.id } })
    expect(submitted.status).toBe(201)
    expect((await submitted.json()).order.receipt.status).toBe('accepted')
    const next = await (await request('/v1/ordering-context', { previousId: context.id })).json()
    expect(next.context.serviceMode).toBe('table-service')
    expect(next.context.table.label).toMatch(/^a0[1-9]$/)
  })
})
