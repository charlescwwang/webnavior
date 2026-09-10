import { describe, expect, it } from 'vitest'

import { createAuthUiRoutes } from './ui-routes'

const env = {
  ADDITIONAL_TRUSTED_ORIGINS: [],
  WEB_APP_URL: 'https://webnavior.example',
}

describe('webnavior auth UI routes', () => {
  it('keeps a local Vite callback origin when redirecting to the sign-in page', async () => {
    const routes = createAuthUiRoutes({ env })
    const response = await routes.request('http://localhost:5168/auth/sign-in?client_id=airi-stage-web&redirect_uri=http%3A%2F%2Flocalhost%3A5174%2Fauth%2Fcallback&state=state-123')

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('http://localhost:5174/auth/login?client_id=airi-stage-web&redirect_uri=http%3A%2F%2Flocalhost%3A5174%2Fauth%2Fcallback&state=state-123')
  })

  it('falls back to the configured Webnavior origin for an untrusted callback', async () => {
    const routes = createAuthUiRoutes({ env })
    const response = await routes.request('http://localhost:5168/auth/sign-in?redirect_uri=https%3A%2F%2Fevil.example%2Fauth%2Fcallback')

    expect(response.headers.get('location')).toBe('https://webnavior.example/auth/login?redirect_uri=https%3A%2F%2Fevil.example%2Fauth%2Fcallback')
  })
})
