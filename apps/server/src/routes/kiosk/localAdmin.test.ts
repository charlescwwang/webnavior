import type { Database } from '../../libs/db'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'
import { beforeEach, expect, it, vi } from 'vitest'

import { mockDB } from '../../libs/mock-db'
import { createKioskService } from '../../services/domain/kiosk'
import { ApiError } from '../../utils/error'
import { createKioskRoutes, kioskDeviceCookieName } from './index'

import * as schema from '../../schemas'

let db: Database
let service: ReturnType<typeof createKioskService>
beforeEach(async () => {
  db = await mockDB(schema)
  service = createKioskService(db)
})
function app(localAdmin: { pin?: string, secret: string } = { pin: '4812', secret: 'test-server-secret-never-a-production-value' }) {
  return new Hono<HonoEnv>()
    .onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'failed' }, 500))
    .route('/api/kiosk', createKioskRoutes({
      kioskService: service,
      developmentRegistrationEnabled: false,
      secureCookies: true,
      apiOrigin: 'https://kiosk.example.test',
      trustedOrigins: ['http://100.92.1.80:5169', 'http://172.17.69.17:5169'],
      localAdmin,
      llmGateway: { complete: async () => Response.json({}) },
      runtimeModelPolicy: { modelFor: async () => 'test' },
    }))
}

// Report: this chat Nov8 — local operators have a PIN, not a management account.
it('saves settings with a server-verified PIN and device cookie without a user account', async () => {
  const enrolled = await service.registerDevelopmentDevice({ registrationCode: '483920' })
  const api = app()
  const cookie = `${kioskDeviceCookieName}=${enrolled.credential}`
  const headers = { 'Cookie': cookie, 'Origin': 'https://kiosk.example.test', 'Content-Type': 'application/json' }
  const before = await service.getDeviceSettings(enrolled.device.id)
  expect((await api.request('/api/kiosk/settings', { method: 'PUT', headers, body: JSON.stringify({ version: before.settings.version, overrides: { textOnlyMode: true } }) })).status).toBe(401)
  const login = await api.request('/api/kiosk/admin/session', { method: 'POST', headers, body: JSON.stringify({ pin: '4812' }) })
  expect(login.status).toBe(200)
  const issued = login.headers.get('Set-Cookie')!
  expect(issued).toContain('HttpOnly')
  expect(issued).toContain('Secure')
  expect(issued).toContain('SameSite=Strict')
  expect(issued).not.toContain('4812')
  const save = await api.request('/api/kiosk/settings', { method: 'PUT', headers: { ...headers, Cookie: `${cookie}; ${issued.split(';')[0]}` }, body: JSON.stringify({ version: before.settings.version, overrides: { textOnlyMode: true } }) })
  expect(save.status).toBe(200)
  expect((await service.getDeviceSettings(enrolled.device.id)).effective.textOnlyMode).toBe(true)
  const logs = await db.query.kioskAuditLogs.findMany()
  expect(logs.find(log => log.action === 'device.settings.updated')).toMatchObject({ actorUserId: null, details: { source: 'local-pin' } })
})

// Report: this chat, 2026-11-18 — mouth assistance must persist through the existing authenticated settings API.
it('persists mouth assistance on and off while leaving observation enabled', async () => {
  const enrolled = await service.registerDevelopmentDevice({ registrationCode: '483929' })
  const api = app()
  const headers = { 'Cookie': `${kioskDeviceCookieName}=${enrolled.credential}`, 'Origin': 'https://kiosk.example.test', 'Content-Type': 'application/json' }
  const login = await api.request('/api/kiosk/admin/session', { method: 'POST', headers, body: '{"pin":"4812"}' })
  const grant = login.headers.get('Set-Cookie')!.split(';')[0]
  const before = await service.getDeviceSettings(enrolled.device.id)
  expect(before.effective.mouthDetectionEnabled).toBe(false)
  for (const enabled of [true, false]) {
    const current = await service.getDeviceSettings(enrolled.device.id)
    const response = await api.request('/api/kiosk/settings', { method: 'PUT', headers: { ...headers, Cookie: `${headers.Cookie}; ${grant}` }, body: JSON.stringify({ version: current.settings.version, overrides: { observationEnabled: true, mouthDetectionEnabled: enabled } }) })
    expect(response.status).toBe(200)
    const saved = await service.getDeviceSettings(enrolled.device.id)
    expect(saved.effective.mouthDetectionEnabled).toBe(enabled)
    expect(saved.effective.observationEnabled).toBe(true)
  }
})

it('rejects wrong PINs, unregistered requests, cross-origin writes and repeated guesses', async () => {
  const enrolled = await service.registerDevelopmentDevice({ registrationCode: '483921' })
  const api = app()
  const headers = { 'Cookie': `${kioskDeviceCookieName}=${enrolled.credential}`, 'Origin': 'https://kiosk.example.test', 'Content-Type': 'application/json' }
  expect((await api.request('/api/kiosk/admin/session', { method: 'POST', headers: { Origin: headers.Origin }, body: '{"pin":"4812"}' })).status).toBe(401)
  const foreign = await api.request('/api/kiosk/admin/session', { method: 'POST', headers: { ...headers, Origin: 'https://other.example.test' }, body: '{"pin":"4812"}' })
  expect(foreign.status).toBe(403)
  expect(foreign.headers.get('Set-Cookie')).toBeNull()
  for (let i = 0; i < 4; i++) {
    const wrong = await api.request('/api/kiosk/admin/session', { method: 'POST', headers, body: '{"pin":"9999"}' })
    expect(wrong.status).toBe(401)
    expect(wrong.headers.get('Set-Cookie')).toBeNull()
  }
  expect((await api.request('/api/kiosk/admin/session', { method: 'POST', headers, body: '{"pin":"4812"}' })).status).toBe(429)
  expect(await db.query.kioskAuditLogs.findMany({ where: (logs, { eq }) => eq(logs.action, 'device.settings.updated') })).toHaveLength(0)
})

it('binds the grant to one credential, rejects tampering and keeps the target server-owned', async () => {
  const a = await service.registerDevelopmentDevice({ registrationCode: '483922' })
  const b = await service.registerDevelopmentDevice({ registrationCode: '483923' })
  const api = app()
  const headers = { 'Cookie': `${kioskDeviceCookieName}=${a.credential}`, 'Origin': 'https://kiosk.example.test', 'Content-Type': 'application/json' }
  const login = await api.request('/api/kiosk/admin/session', { method: 'POST', headers, body: '{"pin":"4812"}' })
  const grant = login.headers.get('Set-Cookie')!.split(';')[0]
  const update = { method: 'PUT', body: '{"version":1,"overrides":{"textOnlyMode":true}}' }
  expect((await api.request('/api/kiosk/settings', { ...update, headers: { ...headers, Cookie: `${kioskDeviceCookieName}=${b.credential}; ${grant}` } })).status).toBe(401)
  expect((await api.request('/api/kiosk/settings', { ...update, headers: { ...headers, Cookie: `${headers.Cookie}; ${grant}x` } })).status).toBe(401)
  expect((await api.request('/api/kiosk/settings', { ...update, headers: { ...headers, Cookie: `${headers.Cookie}; ${grant}`, Origin: 'https://other.example.test' } })).status).toBe(403)
  expect((await api.request('/api/kiosk/settings', { ...update, headers: { ...headers, Cookie: `${headers.Cookie}; ${grant}` }, body: JSON.stringify({ version: 1, overrides: {}, deviceId: b.device.id }) })).status).toBe(400)
  expect((await service.getDeviceSettings(b.device.id)).effective.textOnlyMode).toBe(false)
  const lock = await api.request('/api/kiosk/admin/session', { method: 'DELETE', headers })
  expect(lock.status).toBe(200)
  expect(lock.headers.get('Set-Cookie')).toContain('Max-Age=0')
})

it('rejects an expired grant without changing settings', async () => {
  const enrolled = await service.registerDevelopmentDevice({ registrationCode: '483924' })
  const api = app()
  const headers = { 'Cookie': `${kioskDeviceCookieName}=${enrolled.credential}`, 'Origin': 'https://kiosk.example.test', 'Content-Type': 'application/json' }
  const login = await api.request('/api/kiosk/admin/session', { method: 'POST', headers, body: '{"pin":"4812"}' })
  const grant = login.headers.get('Set-Cookie')!.split(';')[0]
  const deadline = Date.now() + 16 * 60 * 1000
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(deadline)
  try {
    const expired = await api.request('/api/kiosk/settings', { method: 'PUT', headers: { ...headers, Cookie: `${headers.Cookie}; ${grant}` }, body: '{"version":1,"overrides":{"textOnlyMode":true}}' })
    expect(expired.status).toBe(401)
  }
  finally {
    vi.useRealTimers()
  }
  expect((await service.getDeviceSettings(enrolled.device.id)).effective.textOnlyMode).toBe(false)
})

it('keeps local access closed when no Server PIN is configured', async () => {
  const enrolled = await service.registerDevelopmentDevice({ registrationCode: '483925' })
  const response = await app({ secret: 'test-server-secret' }).request('/api/kiosk/admin/session', { method: 'POST', headers: { 'Cookie': `${kioskDeviceCookieName}=${enrolled.credential}`, 'Origin': 'https://kiosk.example.test', 'Content-Type': 'application/json' }, body: '{"pin":"4812"}' })
  expect(response.status).toBe(503)
  expect(response.headers.get('Set-Cookie')).toBeNull()
})

// Report: this chat, 2026-11-17 — the selected LAN entry must retain local PIN settings access.
it.each(['http://100.92.1.80:5169', 'http://172.17.69.17:5169'])('allows configured LAN origin %s to unlock and save settings without weakening other origins', async (origin) => {
  const enrolled = await service.registerDevelopmentDevice({ registrationCode: '483930' })
  const api = app()
  const headers = { 'Cookie': `${kioskDeviceCookieName}=${enrolled.credential}`, 'Origin': origin, 'Content-Type': 'application/json' }
  const login = await api.request('/api/kiosk/admin/session', { method: 'POST', headers, body: '{"pin":"4812"}' })
  expect(login.status).toBe(200)
  expect(login.headers.get('Set-Cookie')).not.toContain('; Secure')
  const grant = login.headers.get('Set-Cookie')!.split(';')[0]
  const update = await api.request('/api/kiosk/settings', { method: 'PUT', headers: { ...headers, Cookie: `${headers.Cookie}; ${grant}` }, body: '{"version":1,"overrides":{"textOnlyMode":true}}' })
  expect(update.status).toBe(200)
  expect((await service.getDeviceSettings(enrolled.device.id)).effective.textOnlyMode).toBe(true)
  const wrongOrigin = await api.request('/api/kiosk/admin/session', { method: 'POST', headers: { ...headers, Origin: 'http://100.92.1.81:5169' }, body: '{"pin":"4812"}' })
  expect(wrongOrigin.status).toBe(403)
  const locked = await api.request('/api/kiosk/admin/session', { method: 'DELETE', headers })
  expect(locked.status).toBe(200)
  expect(locked.headers.get('Set-Cookie')).toContain('Max-Age=0')
  expect(locked.headers.get('Set-Cookie')).not.toContain('; Secure')
})
