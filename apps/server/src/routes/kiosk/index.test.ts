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
      performanceProfile: 'balanced',
      voiceVadThreshold: 0.72,
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

  it('frames a proactive reminder as customer-facing copy instead of a Character Card setup turn', async () => {
    const complete = vi.fn(async () => Response.json({ choices: [{ message: { content: '想看看菜單嗎？我可以幫您。' } }] }))
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService,
      llmGateway: { complete, getDefaultModel: async () => 'test-model' },
      secureCookies: false,
    }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1])
    await kioskService.setSiteModelOverrides({ siteId: device!.siteId, overrides: { vision: 'test-vlm' } })
    const started = await app.request('/api/kiosk/visitor-sessions', {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ serviceId: 'development-ordering-service' }),
    })
    const { session } = await started.json() as { session: { id: string } }

    const reminder = await app.request(`/api/kiosk/visitor-sessions/${session.id}/assistant-actions`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ frame: 'data:image/jpeg;base64,ZmFrZQ==', kind: 'reminder' }),
    })

    expect(reminder.status).toBe(200)
    await expect(reminder.json()).resolves.toEqual({ answer: '想看看菜單嗎？我可以幫您。' })
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('只輸出一則給眼前顧客看的、簡短自然的繁體中文台詞。'),
          }),
        ]),
      }),
    }))
  })

  it('only lets the registered device create, append to, and end its own visitor session', async () => {
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService,
      llmGateway,
      secureCookies: false,
    }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1])
    await kioskService.setSiteModelOverrides({ siteId: device!.siteId, overrides: { vision: 'test-vlm' } })

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
    await expect(reply.json()).resolves.toEqual({ answer: '您好，我可以協助您點餐。', toolCalls: [] })

    const proactiveReply = await app.request(`/api/kiosk/visitor-sessions/${session.id}/assistant-actions`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ frame: 'data:image/jpeg;base64,ZmFrZQ==', kind: 'greeting' }),
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

  it('keeps Server-owned audio model policy out of the device bootstrap', async () => {
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService,
      llmGateway,
      secureCookies: false,
    }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1])
    await kioskService.setSiteModelOverrides({
      siteId: device!.siteId,
      overrides: { asr: 'restaurant-asr', tts: 'restaurant-tts' },
    })

    const bootstrap = await app.request('/api/kiosk/bootstrap', { headers: { Cookie: cookie } })

    expect(bootstrap.status).toBe(200)
    const payload = await bootstrap.json() as { profile: Record<string, unknown> }

    expect(payload.profile).not.toHaveProperty('audioModels')
  })

  it('resolves ASR and TTS from the authenticated device policy without accepting client provider settings', async () => {
    const kioskService = createKioskService(db)
    const transcribe = vi.fn(async () => '我要一份牛肉麵')
    const speak = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'Content-Type': 'audio/mpeg' },
    }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      audioGateway: { speak, transcribe },
      developmentRegistrationEnabled: true,
      kioskService,
      llmGateway,
      secureCookies: false,
    }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1])
    await kioskService.setSiteModelOverrides({
      siteId: device!.siteId,
      overrides: { asr: 'restaurant-asr', tts: 'restaurant-tts' },
    })

    const recording = new FormData()
    recording.set('file', new File(['audio'], 'order.webm', { type: 'audio/webm' }))
    const transcript = await app.request('/api/kiosk/audio/transcriptions', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: recording,
    })
    const audio = await app.request('/api/kiosk/audio/speech', {
      method: 'POST',
      headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '您好，想吃什麼？', locale: 'zh-TW', model: 'forbidden', voice: 'forbidden' }),
    })

    expect(transcript.status).toBe(200)
    await expect(transcript.json()).resolves.toEqual({ text: '我要一份牛肉麵' })
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ modelName: 'restaurant-asr' }))
    expect(audio.status).toBe(200)
    expect(audio.headers.get('Content-Type')).toBe('audio/mpeg')
    expect(speak).toHaveBeenCalledWith({ locale: 'zh-TW', modelName: 'restaurant-tts', text: '您好，想吃什麼？' })
  })

  it('keeps prior turns and browser-owned tool results in the model conversation', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce(Response.json({
        choices: [{ message: {
          content: null,
          tool_calls: [{ id: 'call_menu', type: 'function', function: { name: 'find_menu_item', arguments: '{"query":"牛肉麵"}' } }],
        } }],
      }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '牛肉麵目前可以點餐。' } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService: createKioskService(db),
      llmGateway: { complete, getDefaultModel: async () => 'test-model' },
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
    const { session } = await started.json() as { session: { id: string } }
    const tools = [{ type: 'function', function: {
      name: 'find_menu_item',
      description: 'Find an item on the active menu.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    } }]

    const initialReply = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ content: '我要牛肉麵', tools }),
    })
    await expect(initialReply.json()).resolves.toEqual({ answer: undefined, toolCalls: expect.any(Array) })

    const completedReply = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ tools, toolResults: [{ toolCallId: 'call_menu', name: 'find_menu_item', content: '{"available":true}' }] }),
    })
    await expect(completedReply.json()).resolves.toEqual({ answer: '牛肉麵目前可以點餐。', toolCalls: [] })
    expect(complete).toHaveBeenLastCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        tools,
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: '我要牛肉麵' }),
          expect.objectContaining({ role: 'assistant', tool_calls: expect.any(Array) }),
          expect.objectContaining({ role: 'tool', tool_call_id: 'call_menu', content: '{"available":true}' }),
        ]),
      }),
    }))
  })
})
