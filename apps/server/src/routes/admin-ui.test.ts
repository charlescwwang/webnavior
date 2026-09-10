import { describe, expect, it } from 'vitest'

import { createAdminUiRoutes } from './admin-ui'

describe('webnavior admin UI routes', () => {
  it('redirects legacy admin paths to the local Webnavior dashboard', async () => {
    const routes = createAdminUiRoutes({ WEB_APP_URL: 'https://webnavior.example' })
    const response = await routes.request('http://localhost:5168/admin/users')

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://webnavior.example/dashboard')
  })
})
