import { describe, expect, it } from 'vitest'

import { buildAuthUiRedirectUrl, buildAuthUiUrl, resolveAuthUiUrl } from '../auth-ui'

describe('auth UI URL helpers', () => {
  it('builds auth UI URLs under the configured auth base path', () => {
    expect(buildAuthUiUrl('https://webnavior.example', '/sign-in', '?client_id=web')).toBe(
      'https://webnavior.example/sign-in?client_id=web',
    )
  })

  it('maps server /auth requests to the standalone auth UI while preserving queries', () => {
    expect(buildAuthUiRedirectUrl(
      'https://webnavior.example/',
      'https://api.webnavior.example/auth/verify-email?verified=true',
    )).toBe('https://webnavior.example/verify-email?verified=true')
  })

  it('adds the API server origin for standalone auth UI cross-environment redirects', () => {
    expect(buildAuthUiRedirectUrl(
      'https://auth-preview.example/ui/',
      'https://api.webnavior.example/auth/sign-in?client_id=airi-stage-web&api_server_url=https%3A%2F%2Fevil.example',
      'https://api.webnavior.example/api/auth',
    )).toBe(
      'https://auth-preview.example/ui/sign-in?client_id=airi-stage-web&api_server_url=https%3A%2F%2Fapi.webnavior.example',
    )
  })

  it('keeps the configured auth UI URL', () => {
    expect(resolveAuthUiUrl(
      'https://auth-preview.example/ui',
      'https://api.webnavior.example',
    )).toBe('https://auth-preview.example/ui')
  })
})
