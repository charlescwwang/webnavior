import type { PaymentMethod, PosGateway } from './domain/contracts'

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { array, boolean, integer, maxValue, minLength, minValue, number, object, optional, picklist, pipe, record, regex, safeParse, string } from 'valibot'

import { createBridge } from './domain/bridge'

const orderSubmissionSchema = object({
  cart: object({
    catalogRevision: pipe(string(), minLength(1)),
    fulfillmentMode: picklist(['dine-in', 'takeout']),
    itemCount: pipe(number(), integer(), minValue(1)),
    paymentId: pipe(string(), minLength(1)),
    tableHoldId: optional(pipe(string(), minLength(1))),
    lines: pipe(array(object({
      id: pipe(string(), minLength(1)),
      itemId: pipe(string(), minLength(1)),
      name: pipe(string(), minLength(1)),
      options: record(string(), string()),
      quantity: pipe(number(), integer(), minValue(1)),
      unitPrice: pipe(number(), minValue(0)),
    })), minLength(1)),
    total: pipe(number(), minValue(0)),
  }),
  idempotencyKey: pipe(string(), regex(/^[\w-]+$/), minLength(16)),
})

/**
 * Browser-facing vendor-neutral catalog, seating, payment and order contracts.
 */
export function createPosBridgeApp(options: { allowedOrigin: string, gateway: PosGateway }) {
  const app = new Hono()
  const bridge = createBridge(options.gateway)

  app.use('/v1/*', cors({ origin: options.allowedOrigin }))
  app.get('/health', c => c.json({ status: 'ok' }))
  app.get('/v1/catalog', async c => c.json({ catalog: await bridge.getCatalog() }))
  app.get('/v1/seating', async c => c.json({ seating: await options.gateway.getSeating() }))
  app.post('/v1/seating/holds', async (c) => {
    const result = safeParse(object({ expectedRevision: pipe(number(), integer(), minValue(0)), partySize: pipe(number(), integer(), minValue(1), maxValue(20)), tableIds: pipe(array(string()), minLength(1)), splitApproved: boolean() }), await c.req.json().catch(() => null))
    if (!result.success)
      return c.json({ error: 'Invalid table selection.' }, 400)
    try {
      return c.json({ hold: await options.gateway.reserveTables(result.output) }, 201)
    }
    catch {
      return c.json({ error: '桌位已變更或人數不符，請重新選桌。' }, 409)
    }
  })
  app.get('/v1/seating/holds/:id', async (c) => {
    try {
      const hold = await options.gateway.getTableHold(c.req.param('id'))
      return hold ? c.json({ hold }) : c.json({ error: '桌位暫留已失效。' }, 404)
    }
    catch {
      // An unavailable upstream is not evidence that a protected hold expired.
      return c.json({ error: '無法確認桌位狀態，請勿釋放付款中的桌位。' }, 503)
    }
  })
  app.delete('/v1/seating/holds/:id', async (c) => {
    try {
      await options.gateway.releaseTables(c.req.param('id'))
      return c.json({ released: true })
    }
    catch { return c.json({ error: '付款或入座狀態不允許釋放桌位。' }, 409) }
  })
  app.post('/v1/payments', async (c) => {
    const body = await c.req.json().catch(() => null) as { amount?: unknown, method?: unknown, tableHoldId?: unknown } | null
    if ((body?.method !== 'card' && body?.method !== 'mobile') || typeof body.amount !== 'number' || body.amount < 0)
      return c.json({ error: 'Invalid payment request.' }, 400)
    if (body.tableHoldId !== undefined && typeof body.tableHoldId !== 'string')
      return c.json({ error: 'Invalid table hold.' }, 400)
    try {
      return c.json({ payment: await bridge.createPayment(body.amount, body.method as PaymentMethod, body.tableHoldId) }, 201)
    }
    catch {
      // A network failure could have started payment upstream. The client must
      // reconcile rather than treating an unknown terminal result as rejection.
      return c.json({ error: 'Payment could not be confirmed.' }, 503)
    }
  })
  app.get('/v1/payments/:paymentId', async (c) => {
    const payment = await bridge.getPayment(c.req.param('paymentId'))
    return payment ? c.json({ payment }) : c.json({ error: 'Unknown payment.' }, 404)
  })
  app.post('/v1/orders', async (c) => {
    const result = safeParse(orderSubmissionSchema, await c.req.json().catch(() => null))
    if (!result.success)
      return c.json({ error: 'Invalid order submission.' }, 400)

    return c.json({ order: await bridge.submit(result.output) }, 201)
  })

  return app
}
