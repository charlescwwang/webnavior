import { describe, expect, it } from 'vitest'

import { buildAdminUiRedirectUrl, buildAdminUiUrl, resolveAdminUiUrl } from '../server-admin-ui'

describe('admin UI URL helpers', () => {
  it('builds admin UI URLs under the configured admin base path', () => {
    expect(buildAdminUiUrl('https://webnavior.example', '/users', '?query=alice')).toBe(
      'https://webnavior.example/users?query=alice',
    )
  })

  it('maps server /admin requests to the standalone admin UI while preserving queries', () => {
    expect(buildAdminUiRedirectUrl(
      'https://webnavior.example/',
      'https://api.webnavior.example/admin/voice-packs?provider=openai',
    )).toBe('https://webnavior.example/voice-packs?provider=openai')
  })

  it('adds the API server origin for standalone admin UI cross-environment redirects', () => {
    expect(buildAdminUiRedirectUrl(
      'https://admin-preview.example/',
      'https://api.webnavior.example/admin/users?api_server_url=https%3A%2F%2Fevil.example',
      'https://api.webnavior.example/api/admin',
    )).toBe(
      'https://admin-preview.example/users?api_server_url=https%3A%2F%2Fapi.webnavior.example',
    )
  })

  it('keeps the configured admin UI URL', () => {
    expect(resolveAdminUiUrl(
      'https://admin-preview.example',
      'https://api.webnavior.example',
    )).toBe('https://admin-preview.example')
  })
})
