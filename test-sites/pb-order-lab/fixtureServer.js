import { basePath, categories, products, revision } from './catalog.js'
import { createFixtureLedger } from './fixtureLedger.js'
import { pageSnapshot } from './fixtureProtocol.js'

/**
 * Isolated simulator with one cookie-owned session per browser profile.
 * Reads use PB's Inertia/API shapes. UI writes use a separate test endpoint;
 * compare-and-swap revisions reject stale tabs rather than overwriting a cart.
 * Process restart discards sessions; no proxy or merchant writes exist here.
 */
export function fixturePlugin({ origin = 'http://127.0.0.1:5188', base = '/' } = {}) {
  // Only explicitly configured origins reach a cookie-owned simulator session.
  // Proxy deployments preserve the public Host; forwarded headers grant no access.
  const origins = new Map(['http://127.0.0.1:5188', origin].map((value) => {
    const url = new URL(value)
    return [url.host, url.origin]
  }))
  const sessions = new Map()
  return {
    name: 'pb-local-fixture',
    configureServer: install,
    configurePreviewServer: install,
  }

  function install(server) {
    server.middlewares.use(async (request, response, next) => {
      const requestOrigin = origins.get(request.headers.host)
      const url = new URL(request.url, requestOrigin ?? origin)
      // The public build scopes its state API under /pb-test/; local test
      // scripts retain their explicit loopback /__lab/ boundary.
      const labPath = url.pathname.startsWith(base) ? `/${url.pathname.slice(base.length)}` : url.pathname
      const isState = labPath === '/__lab/state'
      const isLedger = labPath === '/__lab/ledger'
      const isFault = labPath === '/__lab/faults'
      const isVendor = url.pathname.startsWith(`${basePath}/`) && (request.headers['x-inertia'] === 'true' || /\/(?:menu-categories|menu-category-items|getAttrByProduct\/\d+)$/.test(url.pathname))
      if (!isState && !isVendor && !isLedger && !isFault) {
        // Preview serves built assets only. PB-style history routes still load
        // that same entry, while the browser retains the actual order URL.
        if (base !== '/' && request.method === 'GET' && (url.pathname.startsWith(`${basePath}/`) || url.pathname === '/test/orders' || /^\/order\/(?:linepay|ecpay)\/redirect\//.test(url.pathname)))
          request.url = `${base}index.html`
        return next()
      }
      const send = (status, value, headers = {}) => {
        response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
        response.end(JSON.stringify(value))
      }
      if (!requestOrigin)
        return send(403, { error: 'Only configured test origins are supported.' })
      const cookie = request.headers.cookie?.match(/(?:^|;\s*)pb_lab=([a-f0-9-]{36})(?:;|$)/)?.[1]
      let session = cookie && sessions.get(cookie)
      if (!session) {
        const id = crypto.randomUUID()
        session = { revision: 0, state: null, touchedAt: Date.now(), ledger: createFixtureLedger() }
        sessions.set(id, session)
        response.setHeader('Set-Cookie', `pb_lab=${id}; HttpOnly; SameSite=Strict; Path=/`)
      }
      session.touchedAt = Date.now()
      // Bound abandoned test browsers without expiring an active testing run.
      for (const [id, candidate] of sessions) {
        if (Date.now() - candidate.touchedAt > 86400000)
          sessions.delete(id)
      }
      if (isFault && request.method === 'POST') {
        if (request.headers.origin !== url.origin)
          return send(403, { error: 'Cross-origin fixture faults are rejected.' })
        let body = ''
        for await (const part of request) {
          body += part
          if (body.length > 2048)
            return send(413, { error: 'Fixture fault request is too large.' })
        }
        try {
          const result = session.ledger.armFault(JSON.parse(body))
          return send(result.status, result.error ? { error: result.error } : { armed: true })
        }
        catch { return send(400, { error: 'Invalid fixture fault.' }) }
      }
      if (request.method === 'PUT' && isState) {
        if (request.headers.origin !== url.origin) {
          session.ledger.rejectWrite('cross-origin')
          return send(403, { error: 'Cross-origin fixture writes are rejected.' })
        }
        let body = ''
        for await (const part of request) {
          body += part
          if (body.length > 1_000_000) {
            session.ledger.rejectWrite('body-limit')
            return send(413, { error: 'Test session is too large; export and reset.' })
          }
        }
        const result = session.ledger.write(body, session.state, session.revision)
        if (result.status !== 200)
          return send(result.status, { error: result.error })
        session.state = result.state
        session.revision = result.revision
        // Commit first, then simulate a lost transport acknowledgement. This
        // never replays the transition or suppresses its server ledger entry.
        if (result.dropAck)
          return response.destroy()
        return send(200, { revision: session.revision })
      }
      if (request.method !== 'GET')
        return send(405, { error: 'Vendor writes are not exposed by this test server.' })
      if (isLedger)
        return send(200, session.ledger.snapshot())
      if (isFault)
        return send(405, { error: 'Arm fixture faults with a same-origin POST.' })
      if (isState)
        return send(200, { revision: session.revision, state: session.state, touchedAt: session.touchedAt })
      if (!session.state)
        return send(409, { error: 'Open the test page first.' })
      if (request.headers['x-inertia'] === 'true') {
        if (request.headers['x-inertia-version'] && request.headers['x-inertia-version'] !== revision)
          return send(409, { error: 'Reload after fixture version change.' }, { 'X-Inertia-Location': url.href })
        const page = pageSnapshot(session.state, url.href)
        const fault = session.ledger.resultFault(url.pathname)
        if (fault === 'malformed-json') {
          response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Inertia': 'true' })
          return response.end('{')
        }
        if (fault === 'missing-order')
          delete page.props.order
        return send(200, page, { 'X-Inertia': 'true', 'Vary': 'X-Inertia' })
      }
      if (url.pathname.endsWith('/menu-categories'))
        return send(200, { categories: categories.map(category => ({ ...category, id: Number(category.id) })) })
      if (url.pathname.endsWith('/menu-category-items'))
        return send(200, { category: { id: Number(url.searchParams.get('category_id')) }, products: products.filter(item => item.categoryId === url.searchParams.get('category_id')).map(item => ({ ...item, id: item.vendorId })), productGroups: [], browseOnly: false })
      const product = products.find(item => item.vendorId === Number(url.pathname.split('/').at(-1)))
      return product ? send(200, product.attributes) : send(404, { error: 'Unknown product' })
    })
  }
}
