import { describe, expect, it } from 'vitest'

import { resolveReturnPath } from './auth-oidc'

describe('web callback return route', () => {
  const origin = 'https://webnavior.example'

  it('restores the management page and its selected site', () => {
    expect(resolveReturnPath('/admin/kiosk/profiles?site=store-1#draft', origin))
      .toBe('/admin/kiosk/profiles?site=store-1#draft')
  })

  it.each([undefined, '', 'https://airi.build', '//airi.build', '/\\airi.build', '/auth/login', '/auth/callback?code=old'])('uses admin for an unsafe or missing return path: %s', (path) => {
    expect(resolveReturnPath(path, origin)).toBe('/admin')
  })
})
