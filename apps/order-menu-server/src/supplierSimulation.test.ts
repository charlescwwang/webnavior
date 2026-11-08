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
