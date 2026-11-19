import { describe, expect, it } from 'vitest'

import { getAuthTrustedOrigins, getTrustedOrigin, isKioskHttpOrigin, isKioskOrigin, isLoopbackOrigin, resolveCheckoutRedirectBase, resolveTrustedRequestOrigin } from '../origin'

describe('origin utils', () => {
  it('identifies configured HTTP loopback origins for local development', () => {
    expect(isLoopbackOrigin('http://localhost:3000')).toBe(true)
    expect(isLoopbackOrigin('https://127.0.0.1:3000')).toBe(true)
    expect(isLoopbackOrigin('http://[::1]:3000')).toBe(true)
    expect(isLoopbackOrigin('https://kiosk.example.com')).toBe(false)
    expect(isLoopbackOrigin('https://localhost.attacker.example')).toBe(false)
    expect(isLoopbackOrigin('file://localhost')).toBe(false)
    expect(isLoopbackOrigin('invalid')).toBe(false)
  })

  it('allows localhost origins', () => {
    expect(getTrustedOrigin('http://localhost:5173')).toBe('http://localhost:5173')
  })

  it('allows https localhost (mkcert dev)', () => {
    expect(getTrustedOrigin('https://localhost:5273')).toBe('https://localhost:5273')
    expect(getTrustedOrigin('https://127.0.0.1:5273')).toBe('https://127.0.0.1:5273')
  })

  it('rejects legacy external AIRI origins', () => {
    expect(getTrustedOrigin('https://accounts.airi.build')).toBe('')
    expect(getTrustedOrigin('https://admin.airi.build')).toBe('')
  })

  it('rejects private LAN Vite dev origins unless listed in ADDITIONAL_TRUSTED_ORIGINS', () => {
    expect(getTrustedOrigin('https://10.0.0.129:5273')).toBe('')
    expect(getTrustedOrigin('https://198.18.0.1:5273')).toBe('')
    expect(getTrustedOrigin('https://192.168.1.5:5273')).toBe('')

    const extra = ['https://10.0.0.129:5273', 'https://198.18.0.1:5273', 'https://192.168.1.5:5273']
    expect(getTrustedOrigin('https://10.0.0.129:5273', extra)).toBe('https://10.0.0.129:5273')
    expect(getTrustedOrigin('https://198.18.0.1:5273', extra)).toBe('https://198.18.0.1:5273')
    expect(getTrustedOrigin('https://192.168.1.5:5273', extra)).toBe('https://192.168.1.5:5273')
  })

  it('rejects untrusted origins', () => {
    expect(getTrustedOrigin('https://example.com')).toBe('')
  })

  it('prefers a trusted referer origin', () => {
    const request = new Request('http://localhost/api/v1/stripe/checkout', {
      headers: {
        referer: 'https://webnavior.example/dashboard',
        origin: 'https://example.com',
      },
    })

    expect(resolveTrustedRequestOrigin(request, ['https://webnavior.example'])).toBe('https://webnavior.example')
  })

  it('falls back to a trusted origin header when referer is missing', () => {
    const request = new Request('http://localhost/api/v1/stripe/checkout', {
      headers: {
        origin: 'http://localhost:5173',
      },
    })

    expect(resolveTrustedRequestOrigin(request)).toBe('http://localhost:5173')
  })

  it('collects api and request origins for auth', () => {
    const request = new Request('http://localhost/api/auth/sign-in/social', {
      headers: {
        origin: 'http://localhost:5173',
      },
    })

    expect(getAuthTrustedOrigins({
      API_SERVER_URL: 'https://webnavior.example',
      ADDITIONAL_TRUSTED_ORIGINS: [],
    }, request)).toEqual([
      'https://webnavior.example',
      'http://localhost:*',
      'http://127.0.0.1:*',
      'http://localhost:5173',
    ])
  })

  describe('resolveCheckoutRedirectBase', () => {
    const fallback = 'https://webnavior.example'

    it('prefers the trusted request origin over the fallback', () => {
      const request = new Request('http://localhost/api/v1/stripe/checkout', {
        headers: { referer: 'http://localhost:5173/settings/flux' },
      })

      expect(resolveCheckoutRedirectBase(request, [], fallback)).toBe('http://localhost:5173')
    })

    // ROOT CAUSE:
    //
    // The packaged Electron renderer loads from file://, so its Stripe checkout
    // request carries no Referer and an opaque/absent Origin. resolveTrustedRequestOrigin
    // then returns undefined and the checkout route threw
    // `createBadRequestError('Missing trusted request origin', 'INVALID_ORIGIN')`,
    // blocking FLUX purchases on desktop (web/mobile were unaffected because they
    // send a trusted web origin).
    //
    // Before patch: no trusted origin -> undefined -> route throws INVALID_ORIGIN.
    // After patch: no trusted origin -> falls back to the configured web app URL,
    // which Stripe accepts as a success_url/cancel_url base.
    it('falls back to the web app URL when the request has no trusted origin (Electron file://)', () => {
      const request = new Request('http://localhost/api/v1/stripe/checkout', {
        method: 'POST',
        // file:// renderers send no Referer; Origin is absent or the opaque literal "null".
        headers: { origin: 'null' },
      })

      expect(resolveTrustedRequestOrigin(request, [])).toBeUndefined()
      expect(resolveCheckoutRedirectBase(request, [], fallback)).toBe(fallback)
    })

    it('falls back to the web app URL for an untrusted web origin', () => {
      const request = new Request('http://localhost/api/v1/stripe/checkout', {
        headers: { origin: 'https://evil.example.com' },
      })

      expect(resolveCheckoutRedirectBase(request, [], fallback)).toBe(fallback)
    })
  })

  it('includes ADDITIONAL_TRUSTED_ORIGINS in Better Auth trustedOrigins list', () => {
    expect(getAuthTrustedOrigins({
      API_SERVER_URL: 'https://webnavior.example',
      ADDITIONAL_TRUSTED_ORIGINS: ['https://10.0.0.129:5273'],
    })).toEqual([
      'https://webnavior.example',
      'https://10.0.0.129:5273',
      'http://localhost:*',
      'http://127.0.0.1:*',
    ])
  })

  it('does not include native deep-link schemes in Better Auth trustedOrigins', () => {
    expect(getTrustedOrigin('capacitor://localhost')).toBe('capacitor://localhost')
    expect(getTrustedOrigin('ai.moeru.airi-pocket://links')).toBe('')

    const authOrigins = getAuthTrustedOrigins({
      API_SERVER_URL: 'https://webnavior.example',
      ADDITIONAL_TRUSTED_ORIGINS: [],
    })

    expect(authOrigins).not.toContain('capacitor://localhost')
    expect(authOrigins).not.toContain('ai.moeru.airi-pocket://links')
  })

  it('does not trust legacy external callback origins', () => {
    const authOrigins = getAuthTrustedOrigins({
      API_SERVER_URL: 'https://webnavior.example',
      ADDITIONAL_TRUSTED_ORIGINS: [],
    })

    expect(authOrigins).not.toContain('https://accounts.airi.build')
    expect(authOrigins).not.toContain('https://admin.airi.build')
  })
})

it('uses exact server-owned Kiosk origins for PIN/POS and HTTP cookie policy', () => {
  const origins = ['http://172.17.69.17:5169', 'http://100.92.1.80:5169']
  expect(isKioskOrigin(origins[0], 'https://public.example', origins)).toBe(true)
  expect(isKioskOrigin('http://172.17.69.18:5169', 'https://public.example', origins)).toBe(false)
  expect(isKioskOrigin('http://172.17.69.17:5168', 'https://public.example', origins)).toBe(false)
  expect(isKioskOrigin('https://public.example', 'https://public.example', origins)).toBe(true)
  expect(isKioskOrigin(undefined, 'https://public.example', origins)).toBe(false)
  expect(isKioskHttpOrigin(origins[0], origins)).toBe(true)
  expect(isKioskHttpOrigin('https://public.example', [...origins, 'https://public.example'])).toBe(false)
  expect(isKioskHttpOrigin(undefined, origins)).toBe(false)
  expect(isKioskOrigin('http://localhost:5169', 'http://127.0.0.1:5168', [])).toBe(true)
})
