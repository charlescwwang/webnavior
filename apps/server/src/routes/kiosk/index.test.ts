import type { Database } from '../../libs/db'

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKioskRoutes, kioskDeviceCookieName } from '.'
import { mockDB } from '../../libs/mock-db'
import { createKioskService } from '../../services/domain/kiosk'

import * as schema from '../../schemas'

const llmGateway = {
  complete: async () => Response.json({ choices: [{ message: { content: '您好，我可以協助您點餐。' } }] }),
  getDefaultModel: async () => 'test-model',
}

describe('kiosk routes', () => {
  let db: Database

  beforeEach(async () => {
    db = await mockDB(schema)
  })

  it('registers a development kiosk and uses its HttpOnly device cookie for bootstrap', async () => {
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService: createKioskService(db),
      llmGateway,
      secureCookies: false,
    }))

    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })

    expect(registration.status).toBe(201)
    expect(registration.headers.get('Set-Cookie')).toContain(`${kioskDeviceCookieName}=`)
    expect(registration.headers.get('Set-Cookie')).toContain('HttpOnly')

    const auditRows = await db.select().from(schema.kioskAuditLogs)
    expect(auditRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'device.registered',
        details: { registrationMethod: 'development' },
      }),
    ]))

    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
    const bootstrap = await app.request('/api/kiosk/bootstrap', { headers: { Cookie: cookie } })

    expect(bootstrap.status).toBe(200)
    await expect(bootstrap.json()).resolves.toMatchObject({
      device: expect.objectContaining({
        label: 'DEV-483920',
        registrationMethod: 'development',
      }),
      profile: expect.objectContaining({
        name: '開發 POC 點餐助手',
        snapshot: expect.objectContaining({
          greetingPrompt: '您好，今天想吃些什麼？我可以協助您挑選。',
          interactiveService: expect.objectContaining({ url: 'http://localhost:5166' }),
        }),
      }),
    })
  })

  it('does not expose the development registration route when the feature is disabled', async () => {
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: false,
      kioskService: createKioskService(db),
      llmGateway,
      secureCookies: false,
    }))

    const response = await app.request('/api/kiosk/development/register', { method: 'POST' })

    expect(response.status).toBe(404)
  })

  it('only lets the registered device create, append to, and end its own visitor session', async () => {
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService: createKioskService(db),
      llmGateway,
      secureCookies: false,
    }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]

    const started = await app.request('/api/kiosk/visitor-sessions', {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ serviceId: 'development-ordering-service' }),
    })
    expect(started.status).toBe(201)
    const { session } = await started.json() as { session: { id: string } }

    const reply = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ content: '你好，想要牛肉麵。' }),
    })
    expect(reply.status).toBe(200)
    await expect(reply.json()).resolves.toEqual({ answer: '您好，我可以協助您點餐。' })

    const proactiveReply = await app.request(`/api/kiosk/visitor-sessions/${session.id}/assistant-actions`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ kind: 'greeting' }),
    })
    expect(proactiveReply.status).toBe(200)
    await expect(proactiveReply.json()).resolves.toEqual({ answer: '您好，我可以協助您點餐。' })

    const orderResult = await app.request(`/api/kiosk/visitor-sessions/${session.id}/order-results`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ id: 'demo-order-1', fulfillmentMode: 'takeout', itemCount: 2, simulated: true, total: 180 }),
    })
    expect(orderResult.status).toBe(201)
    await expect(orderResult.json()).resolves.toEqual({
      entry: expect.objectContaining({
        content: JSON.stringify({ fulfillmentMode: 'takeout', id: 'demo-order-1', itemCount: 2, simulated: true, total: 180 }),
        kind: 'order_result',
        sequence: 4,
      }),
    })

    const entry = await app.request(`/api/kiosk/visitor-sessions/${session.id}/entries`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ content: '我要一份牛肉麵。', kind: 'user_text', metadata: {} }),
    })
    expect(entry.status).toBe(201)
    await expect(entry.json()).resolves.toEqual({
      entry: expect.objectContaining({ content: '我要一份牛肉麵。', sequence: 5 }),
    })

    const ended = await app.request(`/api/kiosk/visitor-sessions/${session.id}/end`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ state: 'completed' }),
    })
    expect(ended.status).toBe(200)
    await expect(ended.json()).resolves.toEqual({
      session: expect.objectContaining({ state: 'completed' }),
    })
  })

  it('uses a site-approved LLM override instead of the system default', async () => {
    const kioskService = createKioskService(db)
    const complete = vi.fn(async () => Response.json({ choices: [{ message: { content: '已依店別模型回覆。' } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService,
      llmGateway: { complete, getDefaultModel: async () => 'system-default' },
      secureCookies: false,
    }))

    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1])
    await kioskService.setSiteModelOverrides({ siteId: device!.siteId, overrides: { llm: 'restaurant-specialist' } })

    const started = await app.request('/api/kiosk/visitor-sessions', {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ serviceId: 'development-ordering-service' }),
    })
    const { session } = await started.json() as { session: { id: string } }

    const reply = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ content: '你好。' }),
    })

    expect(reply.status).toBe(200)
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ modelName: 'restaurant-specialist' }))
  })
})
