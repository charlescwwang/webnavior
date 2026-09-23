import type { PaymentMethod, PosGateway } from './domain/contracts'

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { array, integer, minLength, minValue, number, object, picklist, pipe, record, regex, safeParse, string } from 'valibot'

import { createBridge } from './domain/bridge'

const orderSubmissionSchema = object({
  cart: object({
    catalogRevision: pipe(string(), minLength(1)),
    fulfillmentMode: picklist(['dine-in', 'takeout']),
    itemCount: pipe(number(), integer(), minValue(1)),
    paymentId: pipe(string(), minLength(1)),
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
 * The browser-facing POS Bridge API. It intentionally has only catalog and
 * order submission endpoints so vendor-specific requests cannot leak into the
 * menu UI or native WebMCP result.
 */
export function createPosBridgeApp(options: { allowedOrigin: string, gateway: PosGateway }) {
  const app = new Hono()
  const bridge = createBridge(options.gateway)

  app.use('/v1/*', cors({ origin: options.allowedOrigin }))
  app.get('/health', c => c.json({ status: 'ok' }))
  app.get('/v1/catalog', async c => c.json({ catalog: await bridge.getCatalog() }))
  app.post('/v1/payments', async (c) => {
    const body = await c.req.json().catch(() => null) as { amount?: unknown, method?: unknown } | null
    if ((body?.method !== 'card' && body?.method !== 'mobile') || typeof body.amount !== 'number' || body.amount < 0)
      return c.json({ error: 'Invalid payment request.' }, 400)
    return c.json({ payment: await bridge.createPayment(body.amount, body.method as PaymentMethod) }, 201)
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
