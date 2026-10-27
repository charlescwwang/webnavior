import { afterEach, describe, expect, it, vi } from 'vitest'

import { createKioskAuthentication } from './kiosk'

afterEach(() => vi.restoreAllMocks())

// Report: docs/research/2026-10-27-security-audit.md
// Network responses are controlled at the real verification boundary.
describe('kiosk credential verification', () => {
  it('derives Site and device ownership from the API and forwards only to its configured endpoint', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ device: { id: 'device-A', siteId: 'site-A' } }))
    const authenticate = createKioskAuthentication('http://127.0.0.1:5168')
    const request = new Request('https://bridge.test/v1/payments', { headers: { 'cookie': 'airi_kiosk_device=scratch-credential', 'x-device-id': 'attacker-device', 'x-site-id': 'attacker-site' } })
    expect(await authenticate(request)).toBe(JSON.stringify(['site-A', 'device-A']))
    expect(String(fetch.mock.calls[0]![0])).toBe('http://127.0.0.1:5168/api/kiosk/identity')
    expect(fetch.mock.calls[0]![1]?.headers).toEqual({ cookie: 'airi_kiosk_device=scratch-credential' })
    fetch.mockResolvedValueOnce(new Response(null, { status: 401 }))
    expect(await authenticate(request)).toBeUndefined()
    fetch.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(authenticate(request)).rejects.toThrow('unavailable')
  })

  it('does not contact the API without a device credential', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    expect(await createKioskAuthentication('http://127.0.0.1:5168')(new Request('https://bridge.test'))).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })
})
