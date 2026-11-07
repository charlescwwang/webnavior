import { expect, it, vi } from 'vitest'

import { prepareFirefoxIframeLogin } from './firefoxIframeLogin.mjs'

it('prepares only fresh approved Firefox cookies without widening domain, path or lifetime', async () => {
  const session = { name: 'order_session', value: 'synthetic', domain: 'app.esgpb.com', path: '/order', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }
  const routing = { ...session, name: 'srvkey', domain: '.esgpb.com', path: '/', httpOnly: false }
  const cookies = [session, routing, { ...session, name: 'analytics' }, { ...session, sameSite: 'Strict' }, { ...session, partitionKey: 'https://other.test' }, { ...session, expires: 1 }, { ...session, path: '/' }, { ...session, domain: '.esgpb.com' }]
  const addCookies = vi.fn(async () => {})
  expect(await prepareFirefoxIframeLogin({ cookies: async () => cookies, addCookies })).toEqual({ prepared: 2 })
  expect(addCookies).toHaveBeenCalledExactlyOnceWith([{ ...session, sameSite: 'None', secure: true }, { ...routing, sameSite: 'None', secure: true }])
})

it('does not overwrite a login already prepared or invent one when none exists', async () => {
  const addCookies = vi.fn(async () => {})
  expect(await prepareFirefoxIframeLogin({ cookies: async () => [], addCookies })).toEqual({ prepared: 0 })
  expect(addCookies).not.toHaveBeenCalled()
})
