import type { PaymentMethod, PosGateway } from './domain/contracts'
import type { TableAssignment } from './domain/seatingContracts'

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { array, boolean, integer, maxValue, minLength, minValue, number, object, optional, picklist, pipe, record, regex, safeParse, string } from 'valibot'

import { createBridge } from './domain/bridge'
import { createOrderContinuations } from './domain/orderContinuation'

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
  customerPhone: optional(pipe(string(), regex(/^09\d{8}$/))),
  idempotencyKey: pipe(string(), regex(/^[\w-]+$/), minLength(16)),
})

/**
 * Browser-facing vendor-neutral catalog, seating, payment and order contracts.
 */
export function createPosBridgeApp(options: { allowedOrigin: string, gateway: PosGateway, tableAssignment?: TableAssignment }) {
  const app = new Hono()
  const bridge = createBridge(options.gateway, options.tableAssignment)
  const continuations = createOrderContinuations()

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
    if ((!body || (body.method !== 'card' && body.method !== 'mobile' && body.method !== 'linepay' && body.method !== 'jkopay')) || typeof body.amount !== 'number' || body.amount < 0)
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

    const order = await bridge.submit(result.output)
    const continuation = continuations.issue(order, result.output.customerPhone)
    return c.json({ order, ...(continuation ? { continuation } : {}) }, 201)
  })

  app.get('/v1/continuations/:token', (c) => {
    c.header('Cache-Control', 'no-store')
    const snapshot = continuations.read(c.req.param('token'))
    return snapshot ? c.json(snapshot) : c.json({ error: '接續連結已失效，請返回機台或洽門市人員。' }, 404)
  })
  app.post('/v1/continuations/:token/table', async (c) => {
    c.header('Cache-Control', 'no-store')
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body.tableCode !== 'string')
      return c.json({ error: '請先掃描桌上的 QR Code。' }, 400)
    const snapshot = continuations.read(c.req.param('token'))
    if (!snapshot)
      return c.json({ error: '接續連結已失效。' }, 404)
    if (snapshot.fulfillmentMode !== 'dine-in')
      return c.json({ error: '此測試訂單已改為自取，無法綁定桌號。' }, 409)
    try {
      return c.json(continuations.bind(c.req.param('token'), body.tableCode))
    }
    catch { return c.json({ error: '無法辨識此門市桌碼，請重新掃描。' }, 400) }
  })
  app.post('/v1/continuations/:token/takeout', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (body?.confirmed !== true)
      return c.json({ error: '請先確認是否改為自取。' }, 400)
    const snapshot = continuations.changeToTakeout(c.req.param('token'))
    return snapshot ? c.json(snapshot) : c.json({ error: '接續連結已失效。' }, 404)
  })
  return app
}
