import { createPinia, disposePinia, getActivePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { client } from '../composables/api'
import { triggerSignIn } from '../libs/auth'
import { useAuthStore } from './auth'

vi.mock('../libs/auth', () => ({
  triggerSignIn: vi.fn(),
}))

vi.mock('../composables/api', () => ({
  client: { api: { v1: { flux: { $get: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ flux: 42 }) }) } } } },
}))

afterEach(() => {
  const pinia = getActivePinia()
  if (pinia)
    disposePinia(pinia)
  vi.unstubAllEnvs()
})

describe('auth store sign-in requests', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(triggerSignIn).mockReset()
    vi.mocked(triggerSignIn).mockResolvedValue()
  })

  it('allows sign-in to be requested again after an external flow is canceled', async () => {
    const authStore = useAuthStore()

    // ROOT CAUSE:
    //
    // Pocket remains mounted after launching the external login page. If the
    // user returns without authenticating, `needsLogin` used to remain true,
    // so a later click could not produce the transition that triggers sign-in.
    // Consuming each request restores the false -> true transition.
    authStore.needsLogin = true
    await nextTick()

    expect(triggerSignIn).toHaveBeenCalledTimes(1)
    expect(authStore.needsLogin).toBe(false)

    authStore.needsLogin = true
    await nextTick()

    expect(triggerSignIn).toHaveBeenCalledTimes(2)
    expect(authStore.needsLogin).toBe(false)
  })
})

describe('kiosk cloud credits', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(client.api.v1.flux.$get).mockClear()
  })

  it.each([['false', 0], ['true', 2]])('cloud enabled=%s: preserves authentication and gates automatic and explicit credits requests', async (enabled, calls) => {
    vi.stubEnv('VITE_AIRI_CLOUD_ENABLED', enabled)
    const store = useAuthStore()
    const now = new Date()
    store.user = { id: 'customer', name: 'Customer', email: 'customer@example.com', emailVerified: false, createdAt: now, updatedAt: now }
    store.session = { id: 'session', userId: 'customer', token: 'test', expiresAt: now, createdAt: now, updatedAt: now }
    await nextTick()
    await store.updateCredits()
    expect(store.isAuthenticated).toBe(true)
    expect(store.userId).toBe('customer')
    expect(client.api.v1.flux.$get).toHaveBeenCalledTimes(calls)
    store.clearAllAuthState()
    await nextTick()
  })
})
