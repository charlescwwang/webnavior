import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import { CookieCompatibility } from './browserCookieCompatibility.mjs'

function setup(retainedCookies = []) {
  const session = new EventEmitter()
  const cookies = new Map()
  const writes = []
  session.send = async (method, params) => {
    if (method === 'Network.getCookies')
      return { cookies: retainedCookies }
    if (method === 'Network.setCookie') {
      writes.push(params)
      cookies.set(params.name, { ...params, domain: params.domain ?? new URL(params.url).hostname, expires: params.expires ?? -1 })
      return { success: true }
    }
    return {}
  }
  const context = {
    cookies: async () => [...cookies.values()],
    clearCookies: async ({ name }) => cookies.delete(name),
  }
  const compatibility = new CookieCompatibility(context, 'https://app.esgpb.com')
  const response = (value, overrides = {}, line = `order_session=${value}; Path=/order; Secure; HttpOnly; SameSite=Lax`, blockedReasons = ['SameSiteLax']) => {
    session.emit('Network.requestWillBeSent', { requestId: value, request: { url: 'https://app.esgpb.com/order/login' } })
    session.emit('Network.responseReceivedExtraInfo', { requestId: value, blockedCookies: [{
      blockedReasons,
      cookieLine: line,
      cookie: { name: 'order_session', value, domain: 'app.esgpb.com', path: '/order', secure: true, httpOnly: true, sameSite: 'Lax', priority: 'Medium', session: true, expires: -1, ...overrides },
    }] })
  }
  return { session, cookies, writes, compatibility, response }
}

describe('scoped iframe cookie compatibility', () => {
  // Report: this chat, 2026-10-29; first-party PB login was lost on the first iframe request.
  it('prepares retained login before iframe navigation without replacing its authenticated value', async () => {
    const retained = [
      { name: 'order_session', value: 'authenticated-session', domain: 'app.esgpb.com', path: '/order', secure: true, httpOnly: true, sameSite: 'Lax', session: true },
      { name: 'srvkey', value: 'existing-route', domain: '.esgpb.com', path: '/', secure: true, httpOnly: false, session: false, expires: Date.now() / 1000 + 3600 },
      { name: 'other_session', value: 'unrelated', domain: 'app.esgpb.com', path: '/order', secure: true, httpOnly: true, sameSite: 'Lax', session: true },
      { name: 'XSRF-TOKEN', value: 'strict', domain: 'app.esgpb.com', path: '/order', secure: true, httpOnly: false, sameSite: 'Strict', session: true },
    ]
    const { session, writes, compatibility } = setup(retained)
    await compatibility.prepareRetainedSession(session)
    expect(writes).toHaveLength(2)
    expect(writes[0].value).toBe('authenticated-session')
    expect(writes[0].url).toBe('https://app.esgpb.com/order/')
    expect(writes[0].domain).toBeUndefined()
    expect(writes[0].sameSite).toBe('None')
    expect(writes[0].httpOnly).toBe(true)
    expect(writes[1].domain).toBe('.esgpb.com')
    expect(writes[1].expires).toBe(retained[1].expires)
    expect(writes.some(cookie => cookie.name === 'other_session')).toBe(false)
    expect(writes.some(cookie => cookie.value === 'strict')).toBe(false)
  })

  // Report: this chat's ESGPB iframe diagnosis; original Session/XSRF cookies were rejected as Lax.
  it('uses raw blocked-cookie evidence and preserves scope/HttpOnly through rotation and restoration', async () => {
    const { session, cookies, writes, compatibility, response } = setup()
    await compatibility.attach(session)
    response('first')
    response('rotated')
    await compatibility.settle()
    expect(writes).toHaveLength(2)
    expect(writes[0].sameSite).toBe('None')
    expect(writes[0].httpOnly).toBe(true)
    expect(writes[0].path).toBe('/order')
    expect(writes[0].url).toBe('https://app.esgpb.com/order/')
    expect(writes[0].domain).toBeUndefined()
    expect(cookies.get('order_session').value).toBe('rotated')
    await compatibility.disable()
    expect(writes.at(-1).sameSite).toBe('Lax')
    expect(writes.at(-1).value).toBe('rotated')
    expect(session.listenerCount('Network.responseReceivedExtraInfo')).toBe(0)
  })

  it('never resurrects a cookie deleted by logout', async () => {
    const { session, cookies, writes, compatibility, response } = setup()
    await compatibility.attach(session)
    response('first')
    await compatibility.settle()
    response('deleted', {}, 'order_session=deleted; Path=/order; Max-Age=0; Secure; HttpOnly; SameSite=Lax')
    await compatibility.settle()
    expect(cookies.has('order_session')).toBe(false)
    await compatibility.disable()
    expect(writes).toHaveLength(1)
  })

  it('rejects another domain, path, cookie name and partition rather than expanding access', async () => {
    const { session, writes, compatibility, response } = setup()
    await compatibility.attach(session)
    response('domain', { domain: 'other.example' })
    response('path', { path: '/' })
    response('partition', { partitionKey: { topLevelSite: 'https://example.org' } })
    response('name', { name: 'different_session' })
    await compatibility.settle()
    expect(writes).toHaveLength(0)
  })

  it('does not overwrite a Session subsequently replaced by another owner', async () => {
    const { session, cookies, writes, compatibility, response } = setup()
    await compatibility.attach(session)
    response('first')
    await compatibility.settle()
    cookies.set('order_session', { ...cookies.get('order_session'), value: 'other-owner' })
    await compatibility.disable()
    expect(writes).toHaveLength(1)
    expect(cookies.get('order_session').value).toBe('other-owner')
  })

  it('handles Chrome schemeful Lax blocking and the necessary root routing cookie', async () => {
    const { session, writes, compatibility, response } = setup()
    await compatibility.attach(session)
    response('schemeful', {}, undefined, ['SchemefulSameSiteLax'])
    response('routing', { name: 'srvkey', path: '/', httpOnly: false, sameSite: undefined }, 'srvkey=routing; Path=/; Secure', ['SchemefulSameSiteUnspecifiedTreatedAsLax'])
    await compatibility.settle()
    expect(writes).toHaveLength(2)
    expect(writes[1].name).toBe('srvkey')
    expect(writes[1].path).toBe('/')
    expect(writes[1].httpOnly).toBe(false)
  })

  it('holds a follow-up request until the observed Session rotation has been written', async () => {
    const { session, compatibility, response } = setup()
    const send = session.send
    let release
    const writing = new Promise(resolve => release = resolve)
    const resumed = []
    session.send = async (method, params) => {
      if (method === 'Network.setCookie')
        await writing
      if (method === 'Fetch.continueRequest')
        resumed.push(params.requestId)
      return send(method, params)
    }
    await compatibility.attach(session)
    response('rotating')
    session.emit('Fetch.requestPaused', { requestId: 'redirect' })
    await Promise.resolve()
    expect(resumed).toEqual([])
    release()
    await compatibility.settle()
    await expect.poll(() => resumed).toEqual(['redirect'])
    await compatibility.disable()
  })
})
