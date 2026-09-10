import { describe, expect, it } from 'vitest'

import { resolveExpectedHostOrigin } from './embedding-origin'

describe('resolveExpectedHostOrigin', () => {
  it('uses the configured browser-visible origin instead of an iframe referrer port', () => {
    expect(resolveExpectedHostOrigin({
      configuredOrigin: 'https://airi.example.com',
      isEmbedded: true,
      referrer: 'http://192.168.8.58:5169/kiosk/',
    })).toBe('https://airi.example.com')
  })

  it('preserves a port only when it is genuinely part of the embedding browser origin', () => {
    expect(resolveExpectedHostOrigin({
      configuredOrigin: undefined,
      isEmbedded: true,
      referrer: 'http://localhost:5169/',
    })).toBe('http://localhost:5169')
  })
})
