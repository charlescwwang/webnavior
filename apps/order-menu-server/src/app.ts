import type { ServiceMode } from '../../../packages/stage-shared/src/kioskServiceMode'
import type { PaymentMethod, PosGateway } from './domain/contracts'
import type { TableAssignment } from './domain/seatingContracts'

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { array, boolean, integer, literal, maxValue, minLength, minValue, number, object, optional, picklist, pipe, record, regex, safeParse, string } from 'valibot'

import { createBridge } from './domain/bridge'
import { inspectCatalogPrices } from './domain/catalogDiagnostics'
import { createOrderContinuations } from './domain/orderContinuation'
import { createTableOrders, TableOrderError } from './domain/tableOrders'

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
export function createPosBridgeApp(options: { allowedOrigin: string, gateway: PosGateway, tableAssignment?: TableAssignment, authenticate: (request: Request) => Promise<string | undefined>, serviceMode?: (request: Request) => Promise<ServiceMode>, onCatalogPriceDiagnostics?: (report: ReturnType<typeof inspectCatalogPrices>) => void }) {
  const app = new Hono<{ Variables: { owner: string } }>()
  const bridge = createBridge(options.gateway, options.tableAssignment)
  const continuations = createOrderContinuations()
  // Resource ownership and idempotency live for this simulator process. A real
  // provider integration must persist both before enabling live payments.
  const paymentOwners = new Map<string, string>()
  const completedPayments = new Set<string>()
  const holdOwners = new Map<string, string>()
  const bridges = new Map<string, ReturnType<typeof createBridge>>()
  // One latest report per bridge instance; repeated kiosk reads do not flood logs.
  let lastPriceDiagnosticKey: string | undefined
  const tableRounds = new Map<string, ReturnType<typeof createTableOrders>>()

  function orderRound(owner: string) {
    let round = tableRounds.get(owner)
    if (!round) {
      round = createTableOrders(options.gateway)
      tableRounds.set(owner, round)
    }
    return round
  }

  app.use('/v1/*', bodyLimit({ maxSize: 1024 * 1024 }))
  app.use('/v1/*', cors({ origin: options.allowedOrigin }))
  app.use('/v1/*', async (c, next) => {
    const path = c.req.path
    const publicRead = c.req.method === 'GET' && (path === '/v1/catalog' || path === '/v1/seating')
    const continuation = /^\/v1\/continuations\/[\w-]+(?:\/(?:table|takeout))?$/.test(path)
    if (publicRead || continuation)
      return next()
    try {
      const owner = await options.authenticate(c.req.raw)
      if (!owner)
        return c.json({ error: 'Kiosk authentication required.' }, 401)
      c.set('owner', owner)
    }
    catch { return c.json({ error: 'Kiosk authentication unavailable.' }, 503) }
    return next()
  })
  app.get('/health', c => c.json({ status: 'ok' }))
  app.get('/v1/catalog', async (c) => {
    const catalog = await bridge.getCatalog()
    const catalogPriceDiagnostics = inspectCatalogPrices(catalog)
    const key = JSON.stringify(catalogPriceDiagnostics)
    if (key !== lastPriceDiagnosticKey) {
      lastPriceDiagnosticKey = key
      if (!catalogPriceDiagnostics.valid || catalogPriceDiagnostics.warningCount) {
        try {
          options.onCatalogPriceDiagnostics?.(catalogPriceDiagnostics)
        }
        catch {
          // Maintenance logging cannot make the customer catalog unavailable.
          console.warn('[order-menu] Catalog price diagnostic callback failed.')
        }
      }
    }
    return c.json({ catalog, catalogPriceDiagnostics })
  })
  app.get('/v1/seating', async c => c.json({ seating: await options.gateway.getSeating() }))
  app.post('/v1/seating/holds', async (c) => {
    const result = safeParse(object({ expectedRevision: pipe(number(), integer(), minValue(0)), partySize: pipe(number(), integer(), minValue(1), maxValue(20)), tableIds: pipe(array(string()), minLength(1)), splitApproved: boolean() }), await c.req.json().catch(() => null))
    if (!result.success)
      return c.json({ error: 'Invalid table selection.' }, 400)
    try {
      const hold = await options.gateway.reserveTables(result.output)
      holdOwners.set(hold.id, c.get('owner'))
      return c.json({ hold }, 201)
    }
    catch {
      return c.json({ error: '桌位已變更或人數不符，請重新選桌。' }, 409)
    }
  })
  app.get('/v1/seating/holds/:id', async (c) => {
    if (holdOwners.get(c.req.param('id')) !== c.get('owner'))
      return c.json({ error: 'Unknown table hold.' }, 404)
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
    if (holdOwners.get(c.req.param('id')) !== c.get('owner'))
      return c.json({ error: 'Unknown table hold.' }, 404)
    try {
      await options.gateway.releaseTables(c.req.param('id'))
      return c.json({ released: true })
    }
    catch { return c.json({ error: '付款或入座狀態不允許釋放桌位。' }, 409) }
  })
  app.post('/v1/payments', async (c) => {
    const body = await c.req.json().catch(() => null) as { amount?: unknown, method?: unknown, tableHoldId?: unknown } | null
    if ((!body || (body.method !== 'card' && body.method !== 'mobile' && body.method !== 'linepay' && body.method !== 'jkopay')) || typeof body.amount !== 'number' || !Number.isSafeInteger(body.amount) || body.amount < 0)
      return c.json({ error: 'Invalid payment request.' }, 400)
    if (body.tableHoldId !== undefined && typeof body.tableHoldId !== 'string')
      return c.json({ error: 'Invalid table hold.' }, 400)
    if (body.tableHoldId && holdOwners.get(body.tableHoldId) !== c.get('owner'))
      return c.json({ error: 'Unknown table hold.' }, 404)
    try {
      const payment = await bridge.createPayment(body.amount, body.method as PaymentMethod, body.tableHoldId)
      paymentOwners.set(payment.id, c.get('owner'))
      return c.json({ payment }, 201)
    }
    catch {
      // A network failure could have started payment upstream. The client must
      // reconcile rather than treating an unknown terminal result as rejection.
      return c.json({ error: 'Payment could not be confirmed.' }, 503)
    }
  })
  app.get('/v1/payments/:paymentId', async (c) => {
    if (paymentOwners.get(c.req.param('paymentId')) !== c.get('owner'))
      return c.json({ error: 'Unknown payment.' }, 404)
    const payment = await bridge.getPayment(c.req.param('paymentId'))
    return payment ? c.json({ payment }) : c.json({ error: 'Unknown payment.' }, 404)
  })
  app.get('/v1/ordering-context', async (c) => {
    c.header('Cache-Control', 'no-store')
    const mode = await options.serviceMode?.(c.req.raw) ?? 'kiosk'
    return c.json({ context: orderRound(c.get('owner')).open(mode) })
  })
  app.post('/v1/ordering-context', async (c) => {
    const body = safeParse(object({ previousId: pipe(string(), minLength(1)) }), await c.req.json().catch(() => null))
    if (!body.success)
      return c.json({ error: 'Invalid order context.' }, 400)
    const mode = await options.serviceMode?.(c.req.raw) ?? 'kiosk'
    const owner = c.get('owner')
    const round = orderRound(owner)
    if (round.open(mode).serviceMode !== mode) {
      // A preference change is not cancellation of a pending/charged Kiosk
      // payment. Keep its pinned round until its accepted receipt is known.
      for (const [paymentId, paymentOwner] of paymentOwners) {
        if (paymentOwner !== owner || completedPayments.has(paymentId))
          continue
        const payment = await options.gateway.getPayment(paymentId)
        if (!payment || ['pending', 'authorized', 'uncertain'].includes(payment.status))
          return c.json({ error: '付款尚待確認，服務模式將於訂單完成後再切換。' }, 409)
      }
    }
    try {
      return c.json({ context: round.open(mode, body.output.previousId) })
    }
    catch { return c.json({ error: '訂單進行中或情境已更新，無法切換。' }, 409) }
  })
  app.post('/v1/table-orders', async (c) => {
    const result = safeParse(object({
      confirmedByUser: literal(true),
      contextId: pipe(string(), minLength(1)),
      idempotencyKey: pipe(string(), regex(/^[\w-]+$/), minLength(16)),
      cart: object({ catalogRevision: pipe(string(), minLength(1)), itemCount: pipe(number(), integer(), minValue(1)), total: pipe(number(), minValue(0)), lines: pipe(array(object({ id: string(), itemId: string(), name: string(), quantity: pipe(number(), integer(), minValue(1)), unitPrice: pipe(number(), minValue(0)), options: record(string(), string()) })), minLength(1)) }),
    }), await c.req.json().catch(() => null))
    if (!result.success)
      return c.json({ error: 'Invalid table order.' }, 400)
    try {
      const order = await orderRound(c.get('owner')).submit(result.output)
      return c.json({ order }, 201)
    }
    catch (error) {
      if (error instanceof TableOrderError)
        return c.json({ code: error.code, error: error.message }, 409)
      return c.json({ code: 'TABLE_ORDER_UNAVAILABLE', error: '這次無法完成送單，請稍後再試。' }, 503)
    }
  })
  app.post('/v1/orders', async (c) => {
    const result = safeParse(orderSubmissionSchema, await c.req.json().catch(() => null))
    if (!result.success)
      return c.json({ error: 'Invalid order submission.' }, 400)

    const owner = c.get('owner')
    if (paymentOwners.get(result.output.cart.paymentId) !== owner)
      return c.json({ error: 'Unknown payment.' }, 404)
    let ownedBridge = bridges.get(owner)
    if (!ownedBridge) {
      ownedBridge = createBridge(options.gateway, options.tableAssignment)
      bridges.set(owner, ownedBridge)
    }
    const order = await ownedBridge.submit(result.output)
    if (order.receipt.status === 'accepted')
      completedPayments.add(result.output.cart.paymentId)
    const continuation = continuations.issue(order, result.output.customerPhone)
    const receiptAccess = continuations.issueReceipt(order)
    return c.json({ order, ...(continuation ? { continuation } : {}), ...(receiptAccess ? { receiptAccess } : {}) }, 201)
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
    if (snapshot.readOnly)
      return c.json({ error: '此連結僅供查看訂單。' }, 409)
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
    if (continuations.read(c.req.param('token'))?.readOnly)
      return c.json({ error: '此連結僅供查看訂單。' }, 409)
    const snapshot = continuations.changeToTakeout(c.req.param('token'))
    return snapshot ? c.json(snapshot) : c.json({ error: '接續連結已失效。' }, 404)
  })
  return app
}
