import { basePath, categories, products, revision } from './catalog.js'
import { selection } from './order.js'
import { pageSnapshot } from './fixtureProtocol.js'

/**
 * Loopback-only simulator with one cookie-owned session per browser profile.
 * Reads use PB's Inertia/API shapes. UI writes use a separate test endpoint;
 * compare-and-swap revisions reject stale tabs rather than overwriting a cart.
 * Process restart discards sessions; no proxy or merchant writes exist here.
 */
export function fixturePlugin() {
  const sessions = new Map()
  return {
    name: 'pb-local-fixture',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url, 'http://127.0.0.1:5188')
        const isState = url.pathname === '/__lab/state'
        const isVendor = url.pathname.startsWith(`${basePath}/`) && (request.headers['x-inertia'] === 'true' || /\/(menu-categories|menu-category-items|getAttrByProduct\/\d+)$/.test(url.pathname))
        if (!isState && !isVendor)
          return next()
        const send = (status, value, headers = {}) => {
          response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
          response.end(JSON.stringify(value))
        }
        if (request.headers.host !== '127.0.0.1:5188')
          return send(403, { error: 'Only the exact local test origin is supported.' })
        const cookie = request.headers.cookie?.match(/(?:^|;\s*)pb_lab=([a-f0-9-]{36})(?:;|$)/)?.[1]
        let session = cookie && sessions.get(cookie)
        if (!session) {
          const id = crypto.randomUUID()
          session = { revision: 0, state: null, touchedAt: Date.now() }
          sessions.set(id, session)
          response.setHeader('Set-Cookie', `pb_lab=${id}; HttpOnly; SameSite=Strict; Path=/`)
        }
        session.touchedAt = Date.now()
        // Bound abandoned test browsers without expiring an active testing run.
        for (const [id, candidate] of sessions) {
          if (Date.now() - candidate.touchedAt > 86400000)
            sessions.delete(id)
        }
        if (request.method === 'PUT' && isState) {
          if (request.headers.origin !== url.origin)
            return send(403, { error: 'Cross-origin fixture writes are rejected.' })
          try {
            let body = ''
            for await (const part of request) {
              body += part
              if (body.length > 1_000_000)
                return send(413, { error: 'Test session is too large; export and reset.' })
            }
            const input = JSON.parse(body)
            if (input.revision !== session.revision)
              return send(409, { error: '另一分頁已更新測試資料，請重新整理後核對。' })
            const value = input.state
            if (value.schemaVersion !== 1 || !Array.isArray(value.cart) || !Array.isArray(value.orders) || typeof value.checkoutKey !== 'string' || !value.invoice || typeof value.table !== 'string')
              throw new Error('Invalid fixture session')
            value.cart = value.cart.map(line => ({ ...selection(line.productId, line.quantity, line.extra, line.note), lineId: line.lineId, vendorLineId: line.vendorLineId }))
            if (new Set(value.cart.map(line => line.vendorLineId)).size !== value.cart.length || value.cart.some(line => !Number.isSafeInteger(line.vendorLineId) || line.vendorLineId < 1))
              throw new Error('Invalid fixture line identity')
            session.state = value
            session.revision++
            return send(200, { revision: session.revision })
          }
          catch { return send(400, { error: 'Invalid fixture session' }) }
        }
        if (request.method !== 'GET')
          return send(405, { error: 'Vendor writes are not exposed by this test server.' })
        if (isState)
          return send(200, session)
        if (!session.state)
          return send(409, { error: 'Open the test page first.' })
        if (request.headers['x-inertia'] === 'true') {
          if (request.headers['x-inertia-version'] && request.headers['x-inertia-version'] !== revision)
            return send(409, { error: 'Reload after fixture version change.' }, { 'X-Inertia-Location': url.href })
          return send(200, pageSnapshot(session.state, request.url), { 'X-Inertia': 'true', Vary: 'X-Inertia' })
        }
        if (url.pathname.endsWith('/menu-categories'))
          return send(200, { categories: categories.map(category => ({ ...category, id: Number(category.id) })) })
        if (url.pathname.endsWith('/menu-category-items'))
          return send(200, { category: { id: Number(url.searchParams.get('category_id')) }, products: products.filter(item => item.categoryId === url.searchParams.get('category_id')).map(item => ({ ...item, id: item.vendorId })), productGroups: [], browseOnly: false })
        const product = products.find(item => item.vendorId === Number(url.pathname.split('/').at(-1)))
        return product ? send(200, product.attributes) : send(404, { error: 'Unknown product' })
      })
    },
  }
}
