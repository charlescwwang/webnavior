const allowedPaths = new Map([['order_session', '/order'], ['XSRF-TOKEN', '/order'], ['srvkey', '/']])
const laxReasons = new Set(['SameSiteLax', 'SameSiteUnspecifiedTreatedAsLax', 'SchemefulSameSiteLax', 'SchemefulSameSiteUnspecifiedTreatedAsLax'])

// NOTICE: ESGPB's Lax cookies prevent cross-site iframe login; missing srvkey also
// mixes backend-specific JS assets. This is an isolated client-side workaround,
// removable when the vendor supports embedding. See the Kiosk README and
// `https://chromedevtools.github.io/devtools-protocol/tot/Network/#event-responseReceivedExtraInfo`.
/**
 * Local experiment: recover only approved, unpartitioned order and routing cookies.
 * A CDP session must belong to the visible test browser; no cookie values leave this module.
 */
export class CookieCompatibility {
  constructor(context, origin) {
    this.context = context
    this.origin = new URL(origin).origin
    this.host = new URL(origin).hostname
    this.sessions = new Map()
    this.changed = new Map()
    this.pending = new Set()
    this.queue = Promise.resolve()
    this.gates = new Set()
    this.disabling = false
    this.failures = 0
    this.stats = { observed: 0, written: 0, deleted: 0, restored: 0, prepared: 0, unsupported: 0, gated: 0, reasons: {} }
  }

  /**
   * Preserve a just-verified first-party PB login before its first embedded request.
   * This is the explicit retained-login policy for the same three approved cookies,
   * not fabricated blocked-response evidence. Strict and unrelated cookies stay put.
   */
  async prepareRetainedSession(session) {
    if (this.disabling)
      throw new Error('Create a new compatibility owner after disabling.')
    const source = new URL(`${this.origin}/order/`)
    const { cookies } = await session.send('Network.getCookies', { urls: [source.href] })
    for (const cookie of cookies) {
      const domain = cookie.domain.replace(/^\./, '')
      const allowedDomain = domain === this.host || (this.host === 'app.esgpb.com' && cookie.name === 'srvkey' && domain === 'esgpb.com')
      if (!allowedPaths.has(cookie.name) || !allowedDomain || cookie.partitionKey || cookie.path !== allowedPaths.get(cookie.name))
        continue
      if ((cookie.sameSite && cookie.sameSite !== 'Lax') || (!cookie.session && cookie.expires <= Date.now() / 1000))
        continue
      // Chromium represents domain cookies with a leading dot; preserve that
      // distinction instead of broadening a host-only login cookie to subdomains.
      await this.write(session, cookie, source, cookie.domain.startsWith('.'))
      this.stats.prepared++
    }
  }

  /** Listen before reloading the iframe, so blocked Set-Cookie data is not missed. */
  async attach(session) {
    if (this.disabling)
      throw new Error('Create a new compatibility owner after disabling.')
    if (this.sessions.has(session))
      return
    const requests = new Map()
    const onRequest = ({ requestId, request }) => {
      requests.set(requestId, request.url)
      // Retain recently completed requests: ExtraInfo can arrive after responseReceived.
      if (requests.size > 512)
        requests.delete(requests.keys().next().value)
    }
    const onResponse = (event) => {
      const source = requests.get(event.requestId)
      if (!source)
        return
      const url = new URL(source)
      if (url.origin !== this.origin || !/^\/order(?:\/|$)/.test(url.pathname))
        return
      for (const blocked of event.blockedCookies ?? []) {
        const operation = this.queue.then(() => this.apply(session, blocked, url))
          .catch(() => { this.failures++ })
          .finally(() => this.pending.delete(operation))
        this.queue = operation
        this.pending.add(operation)
      }
    }
    const onPaused = ({ requestId }) => {
      // Cookie rotation must finish before a redirect/XHR constructs its next request.
      // Without this gate a successful login can be followed immediately by an anonymous GET.
      const operation = this.settle()
        .then(() => session.send('Fetch.continueRequest', { requestId }))
        .then(() => { this.stats.gated++ })
        .catch(() => {
          if (!this.disabling)
            this.failures++
        })
        .finally(() => this.gates.delete(operation))
      this.gates.add(operation)
    }
    session.on('Network.requestWillBeSent', onRequest)
    session.on('Network.responseReceivedExtraInfo', onResponse)
    session.on('Fetch.requestPaused', onPaused)
    this.sessions.set(session, { onRequest, onResponse, onPaused })
    await session.send('Network.enable')
    await session.send('Fetch.enable', { patterns: [{ urlPattern: `${this.origin}/order/*`, requestStage: 'Request' }] })
  }

  async apply(session, blocked, source) {
    const name = blocked.cookieLine.slice(0, blocked.cookieLine.indexOf('='))
    if (!allowedPaths.has(name))
      return
    this.stats.observed++
    for (const reason of blocked.blockedReasons)
      this.stats.reasons[reason] = (this.stats.reasons[reason] ?? 0) + 1
    const cookie = blocked.cookie
    const domain = cookie?.domain.replace(/^\./, '')
    // ESGPB's public load-balancer cookie may use its parent domain; auth cookies may not.
    const allowedDomain = domain === this.host || (this.host === 'app.esgpb.com' && name === 'srvkey' && domain === 'esgpb.com')
    if (!cookie || cookie.name !== name || cookie.partitionKey || !allowedDomain || cookie.path !== allowedPaths.get(name)) {
      this.stats.unsupported++
      return
    }
    // Restoration owns one browser cookie identity: name/domain/path; partitioned cookies are excluded.
    const key = JSON.stringify([cookie.name, cookie.domain, cookie.path])
    const maxAge = /(?:^|;)\s*max-age\s*=\s*(-?\d+)/i.exec(blocked.cookieLine)
    if ((maxAge && Number(maxAge[1]) <= 0) || (!cookie.session && cookie.expires <= Date.now() / 1000)) {
      await this.context.clearCookies({ name: cookie.name, domain: cookie.domain, path: cookie.path })
      this.changed.delete(key)
      this.stats.deleted++
      return
    }
    // Only SameSite blocking is eligible. Do not override unrelated browser policy or malformed cookies.
    if (!blocked.blockedReasons.some(reason => laxReasons.has(reason)))
      return
    await this.write(session, cookie, source, /(?:^|;)\s*domain\s*=/i.test(blocked.cookieLine))
  }

  /** Writes the current value with scoped iframe attributes; rotation ownership follows name/domain/path. */
  async write(session, cookie, source, domainAttribute) {
    const key = JSON.stringify([cookie.name, cookie.domain, cookie.path])
    const params = {
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      priority: cookie.priority,
    }
    // Domain-less cookies must stay host-only; a domain attribute changes their scope.
    if (domainAttribute)
      params.domain = cookie.domain
    else
      params.url = `${source.origin}/order/`
    if (!cookie.session)
      params.expires = cookie.expires
    const result = await session.send('Network.setCookie', { ...params, sameSite: 'None', secure: true })
    if (!result.success)
      throw new Error('Cookie compatibility write was rejected.')
    this.changed.set(key, { params, cookie, session })
    this.stats.written++
  }

  /** Wait for already observed writes. This is not proof that a future network response is settled. */
  async settle() {
    while (this.pending.size)
      await Promise.all(this.pending)
    if (this.failures)
      throw new Error('Cookie compatibility encountered a write failure; inspect the dedicated browser.')
  }

  /** Restore attributes on the latest cookie only; never resurrect a deleted or rotated Session. */
  async disable() {
    this.disabling = true
    for (const [session, listeners] of this.sessions) {
      session.off('Network.requestWillBeSent', listeners.onRequest)
      session.off('Network.responseReceivedExtraInfo', listeners.onResponse)
    }
    await this.settle()
    await Promise.all(this.gates)
    for (const [session, listeners] of this.sessions) {
      await session.send('Fetch.disable')
      session.off('Fetch.requestPaused', listeners.onPaused)
    }
    this.sessions.clear()
    const current = await this.context.cookies(`${this.origin}/order/`)
    for (const entry of this.changed.values()) {
      const cookie = current.find(item => item.name === entry.cookie.name && item.domain === entry.cookie.domain && item.path === entry.cookie.path && !item.partitionKey)
      if (!cookie || cookie.value !== entry.params.value || cookie.sameSite !== 'None')
        continue
      const result = await entry.session.send('Network.setCookie', {
        ...entry.params,
        value: cookie.value,
        ...(cookie.expires > 0 ? { expires: cookie.expires } : {}),
      })
      if (!result.success)
        throw new Error('Cookie attribute restoration was rejected.')
      this.stats.restored++
    }
    this.changed.clear()
  }
}
