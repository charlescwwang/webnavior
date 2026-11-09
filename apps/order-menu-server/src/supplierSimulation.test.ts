import { Hono } from 'hono'
import { expect, it } from 'vitest'

import { createPosBridgeApp } from './app'
import { createInMemorySimulatorGateway } from './simulator'
import { supplierCatalog } from './supplierSimulation'

it('keeps mounted merchant catalogs public while protecting their ordering endpoints', async () => {
  const app = new Hono()
  app.route('/supplier', createPosBridgeApp({ mountPath: '/supplier', allowedOrigin: 'http://menu.test', authenticate: async () => undefined, gateway: createInMemorySimulatorGateway('accepted', 'authorized', Date.now, 'after-order', supplierCatalog) }))
  expect((await app.request('/supplier/v1/catalog')).status).toBe(200)
  expect((await app.request('/supplier/v1/ordering-context')).status).toBe(401)
})

// Report: this chat Nov09 — retire dumplings from the supplier simulation,
// including the public catalog used by both the grid and assistant tools.
it('publishes the supplier menu without the retired dumpling item', async () => {
  const gateway = createInMemorySimulatorGateway('accepted', 'authorized', Date.now, 'after-order', supplierCatalog)
  const app = createPosBridgeApp({ allowedOrigin: 'http://menu.test', authenticate: async () => 'device', gateway })
  const response = await app.request('/v1/catalog')
  expect(response.status).toBe(200)
  const { catalog } = await response.json()
  expect(catalog.items).toHaveLength(12)
  expect(catalog.items.some((item: { id: string }) => ['supplier-item-03', 'supplier-item-05', 'supplier-item-06', 'supplier-item-08'].includes(item.id))).toBe(false)
  expect(catalog.items.find((item: { id: string }) => item.id === 'supplier-item-02')).toMatchObject({ price: 130, available: true })
})
