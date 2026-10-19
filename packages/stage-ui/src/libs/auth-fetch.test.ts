import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useAuthStore } from '../stores/auth'
import { authedFetch } from './auth-fetch'

const authMocks = vi.hoisted(() => ({
  getAuthToken: vi.fn(() => 'access-token'),
  triggerSignIn: vi.fn(),
}))

const posthogMocks = vi.hoisted(() => ({
  getPosthogIdentitySnapshot: vi.fn<() => { distinctId: string, sessionId: string } | null>(() => ({
    distinctId: 'distinct-1',
    sessionId: 'session-1',
  })),
}))

vi.mock('./auth', () => ({
  getAuthToken: authMocks.getAuthToken,
  triggerSignIn: authMocks.triggerSignIn,
}))

vi.mock('../stores/analytics/posthog', () => ({
  getPosthogIdentitySnapshot: posthogMocks.getPosthogIdentitySnapshot,
}))

describe('authedFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
    authMocks.triggerSignIn.mockClear()
    authMocks.getAuthToken.mockReturnValue('access-token')
    posthogMocks.getPosthogIdentitySnapshot.mockReturnValue({
      distinctId: 'distinct-1',
      sessionId: 'session-1',
    })
  })

  it('starts sign-in when an expired management session cannot be refreshed', async () => {
    const authStore = useAuthStore()
    vi.spyOn(authStore, 'refreshTokenNow').mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401 })))

    const response = await authedFetch('https://api.example.test/api/kiosk/sites')
    await nextTick()

    expect(response.status).toBe(401)
    expect(authStore.needsLogin).toBe(false)
    expect(authMocks.triggerSignIn).toHaveBeenCalledTimes(1)
  })

  it.each([403, 500, 502])('returns API status %s without requesting login', async (status) => {
    const authStore = useAuthStore()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('API failure', { status })))

    const response = await authedFetch('https://api.example.test/api/kiosk/sites')
    await nextTick()

    expect(response.status).toBe(status)
    expect(authStore.needsLogin).toBe(false)
    expect(authMocks.triggerSignIn).not.toHaveBeenCalled()
  })

  it('sends PostHog identity headers with authenticated API requests', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await authedFetch('https://api.airi.build/api/v1/stripe/checkout', {
      method: 'POST',
    })

    const headers = fetchMock.mock.calls[0]?.[1]?.headers
    expect(headers).toBeInstanceOf(Headers)
    expect((headers as Headers).get('Authorization')).toBe('Bearer access-token')
    expect((headers as Headers).get('x-posthog-distinct-id')).toBe('distinct-1')
    expect((headers as Headers).get('x-posthog-session-id')).toBe('session-1')
  })

  it('omits PostHog identity headers when analytics has no active identity', async () => {
    posthogMocks.getPosthogIdentitySnapshot.mockReturnValue(null)
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await authedFetch('https://api.example.test/api/v1/stripe/checkout')

    const headers = fetchMock.mock.calls[0]?.[1]?.headers
    expect(headers).toBeInstanceOf(Headers)
    expect((headers as Headers).get('Authorization')).toBe('Bearer access-token')
    expect((headers as Headers).get('x-posthog-distinct-id')).toBeNull()
    expect((headers as Headers).get('x-posthog-session-id')).toBeNull()
  })

  it('does not send PostHog identity headers to non-server origins', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await authedFetch('https://third-party.example.test/resource')

    const headers = fetchMock.mock.calls[0]?.[1]?.headers
    expect(headers).toBeInstanceOf(Headers)
    expect((headers as Headers).get('Authorization')).toBe('Bearer access-token')
    expect((headers as Headers).get('x-posthog-distinct-id')).toBeNull()
    expect((headers as Headers).get('x-posthog-session-id')).toBeNull()
  })
})
