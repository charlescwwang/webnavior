import type { KioskRoutesOptions } from '.'
import type { Database } from '../../libs/db'
import type { KioskProfileSnapshot } from '../../schemas/kiosk'
import type { HonoEnv } from '../../types/hono'

import { defaultDeviceSettings } from '@proj-airi/kiosk-proactive'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKioskRoutes, kioskDeviceCookieName } from '.'
import { mockDB } from '../../libs/mock-db'
import { createKioskService } from '../../services/domain/kiosk'
import { ApiError } from '../../utils/error'

import * as schema from '../../schemas'

const llmGateway = {
  complete: async () => Response.json({ choices: [{ message: { content: '您好，我可以協助您點餐。' } }] }),
}

const runtimeModelPolicy = {
  modelFor: async (capability: 'chat' | 'vision' | 'asr' | 'tts') => capability === 'vision'
    ? 'test-vlm'
    : capability === 'asr'
      ? 'restaurant-asr'
      : capability === 'tts'
        ? 'restaurant-tts'
        : 'test-model',
}

describe('kiosk routes', () => {
  let db: Database

  beforeEach(async () => {
    db = await mockDB(schema)
  })

  it('requires device and operator identities, returns effective bootstrap values, and rejects stale or forged local writes', async () => {
    const kioskService = createKioskService(db)
    await db.insert(schema.user).values({ id: 'settings-admin', name: 'Admin', email: 'settings@test.local', role: 'admin' })
    const app = new Hono<HonoEnv>()
      .use('*', async (c, next) => {
        // The authentication boundary is supplied here; device resolution and
        // account role authorization still use the real database-backed service.
        c.set('user', c.req.header('X-Test-Operator') ? { id: 'settings-admin' } as HonoEnv['Variables']['user'] : null)
        await next()
      })
      .onError((error, c) => {
        if (error instanceof ApiError)
          return c.json({ error: error.errorCode }, error.statusCode)
        throw error
      })
      .route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, kioskService, llmGateway, runtimeModelPolicy, secureCookies: false }))
    const enrollment = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = enrollment.headers.get('Set-Cookie')!.split(';')[0]
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1])
    await kioskService.updateDeviceSettings({ deviceId: device!.id, siteId: device!.siteId, userId: 'settings-admin', source: 'admin', body: {
      version: 1,
      localControls: ['observationEnabled'],
      overrides: {},
    } })
    const body = JSON.stringify({ version: 2, overrides: { observationEnabled: true } })
    expect((await app.request('/api/kiosk/settings', { method: 'PUT', headers: { Cookie: cookie }, body })).status).toBe(401)
    expect((await app.request('/api/kiosk/settings', { method: 'PUT', headers: { 'X-Test-Operator': 'yes' }, body })).status).toBe(401)
    const headers = { 'Cookie': cookie, 'X-Test-Operator': 'yes', 'Content-Type': 'application/json' }
    expect((await app.request('/api/kiosk/settings', { method: 'PUT', headers, body: JSON.stringify({ version: 2, overrides: { greetingEnabled: true } }) })).status).toBe(403)
    expect((await app.request('/api/kiosk/settings', { method: 'PUT', headers, body: JSON.stringify({ version: 2, overrides: {}, deviceId: 'another-device' }) })).status).toBe(400)
    const saved = await app.request('/api/kiosk/settings', { method: 'PUT', headers, body })
    expect(saved.status).toBe(200)
    await expect(saved.json()).resolves.toMatchObject({ deviceId: device!.id, settings: { version: 3 }, effective: { observationEnabled: true } })
    expect((await app.request('/api/kiosk/settings', { method: 'PUT', headers, body })).status).toBe(409)
    const bootstrap = await app.request('/api/kiosk/bootstrap', { headers: { Cookie: cookie } })
    await expect(bootstrap.json()).resolves.toMatchObject({ deviceSettings: { settings: { version: 3 }, effective: { observationEnabled: true } } })
  })

  it('registers a development kiosk and uses its HttpOnly device cookie for bootstrap', async () => {
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService: createKioskService(db),
      llmGateway,
      runtimeModelPolicy,
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
      voiceVadSettings: { threshold: 0.5, minSpeechDurationMs: 250, maxSpeechDurationS: 9999, minSilenceDurationMs: 250, speechPadMs: 2000 },
    })
  })

  it('does not expose the development registration route when the feature is disabled', async () => {
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: false,
      kioskService: createKioskService(db),
      llmGateway,
      runtimeModelPolicy,
      secureCookies: false,
    }))

    const response = await app.request('/api/kiosk/development/register', { method: 'POST' })

    expect(response.status).toBe(404)
  })

  it('uses the Server embedding provider only to enrich a candidate speech decision', async () => {
    const embed = vi.fn(async () => [[1, 0], [1, 0]])
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      embeddingGateway: { embed },
      kioskService: createKioskService(db),
      llmGateway,
      runtimeModelPolicy,
      secureCookies: false,
    }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]

    const response = await app.request('/api/kiosk/turn-decisions', {
      method: 'POST',
      headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activeWork: true,
        currentRequest: '我要一碗擔仔麵',
        text: '我要一碗擔仔麵',
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ decision: 'ignore', reason: 'similar-acknowledgement' })
    expect(embed).toHaveBeenCalledWith(['我要一碗擔仔麵', '我要一碗擔仔麵'])
  })

  it('uses the ready Speech Guard before opening a new customer conversation', async () => {
    const classifyInitialSpeech = vi.fn(async () => ({ label: 'BACKGROUND_CONVERSATION' as const, score: 0.91 }))
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService,
      llmGateway,
      runtimeModelPolicy,
      secureCookies: false,
      speechGuard: {
        classifyInitialSpeech,
        getStatus: async () => ({ baselineCount: 680, ready: true }),
        initialize: async () => ({ baselineCount: 680, embeddingModelId: 'embeddinggemma', embeddingProfileId: 'profile-1' }),
      },
    }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1])
    await db.insert(schema.user).values({ id: 'admin', name: 'Admin', email: 'admin@test.local', role: 'admin' })
    await kioskService.updateDeviceSettings({ deviceId: device!.id, siteId: device!.siteId, userId: 'admin', source: 'admin', body: {
      version: 1,
      localControls: [],
      overrides: { voiceDiagnosticsEnabled: true },
    } })

    const response = await app.request('/api/kiosk/turn-decisions', {
      method: 'POST',
      headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeWork: false, presenceState: 'ENGAGED', text: '我昨天吃過這個' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      decision: 'candidate',
      diagnostic: { embeddingAvailable: true, speechGuard: { label: 'BACKGROUND_CONVERSATION', score: 0.91 } },
      reason: 'speech-guard-uncertain',
    })
    expect(classifyInitialSpeech).toHaveBeenCalledWith('我昨天吃過這個')
  })

  it('frames a proactive reminder as customer-facing copy instead of a Character Card setup turn', async () => {
    const complete = vi.fn(async () => Response.json({ choices: [{ message: { content: '想看看菜單嗎？我可以幫您。' } }] }))
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService,
      llmGateway: { complete },
      runtimeModelPolicy,
      secureCookies: false,
    }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1])
    await db.update(schema.kioskDevices).set({ settings: { ...defaultDeviceSettings, overrides: { observationEnabled: true, reminderEnabled: true, proactiveVlmEnabled: true } } }).where(eq(schema.kioskDevices.id, device!.id))
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

  it('sends a user turn for a proactive action when VLM is disabled', async () => {
    const complete = vi.fn(async () => Response.json({ choices: [{ message: { content: '您好，今天想吃些什麼？' } }] }))
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService,
      llmGateway: { complete },
      runtimeModelPolicy,
      secureCookies: false,
    }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1])
    await db.update(schema.kioskDevices)
      .set({ settings: { ...defaultDeviceSettings, overrides: { observationEnabled: true, greetingEnabled: true } } })
      .where(eq(schema.kioskDevices.id, device!.id))
    const started = await app.request('/api/kiosk/visitor-sessions', {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ serviceId: 'development-ordering-service' }),
    })
    const { session } = await started.json() as { session: { id: string } }

    const greeting = await app.request(`/api/kiosk/visitor-sessions/${session.id}/assistant-actions`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ frame: 'data:image/jpeg;base64,ZmFrZQ==', kind: 'greeting' }),
    })

    expect(greeting.status).toBe(200)
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: expect.stringContaining('主動互動台詞') }),
        ]),
      }),
      modelName: 'test-model',
    }))
  })

  it('keeps every Kiosk instruction in the leading system message for strict OpenAI-compatible chat templates', async () => {
    const complete = vi.fn(async (_input: Parameters<KioskRoutesOptions['llmGateway']['complete']>[0]) => Response.json({ choices: [{ message: { content: '您好，請問需要協助嗎？' } }] }))
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService,
      llmGateway: { complete },
      runtimeModelPolicy,
      secureCookies: false,
    }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
    const bootstrap = await app.request('/api/kiosk/bootstrap', { headers: { Cookie: cookie } })
    const { profile } = await bootstrap.json() as { profile: { releaseId: string, snapshot: KioskProfileSnapshot } }
    await db.update(schema.kioskProfileReleases).set({
      snapshot: {
        ...profile.snapshot,
        characterCard: {
          description: '',
          personality: '',
          postHistoryInstructions: '回覆前必須遵守這項後置指示。',
          scenario: '',
          systemPrompt: '',
        },
      },
    }).where(eq(schema.kioskProfileReleases.id, profile.releaseId))
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1])
    await db.update(schema.kioskDevices)
      .set({ settings: { ...defaultDeviceSettings, overrides: { greetingEnabled: true, observationEnabled: true, proactiveVlmEnabled: true } } })
      .where(eq(schema.kioskDevices.id, device!.id))
    const started = await app.request('/api/kiosk/visitor-sessions', {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ serviceId: 'development-ordering-service' }),
    })
    const { session } = await started.json() as { session: { id: string } }
    await app.request(`/api/kiosk/visitor-sessions/${session.id}/entries`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ content: '我想看看菜單。', kind: 'user_text', metadata: {} }),
    })

    const greeting = await app.request(`/api/kiosk/visitor-sessions/${session.id}/assistant-actions`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ frame: 'data:image/jpeg;base64,ZmFrZQ==', kind: 'greeting' }),
    })

    expect(greeting.status).toBe(200)
    const lastCompletion = complete.mock.calls.at(-1)
    expect(lastCompletion).toBeDefined()
    const messages = (lastCompletion![0].body as { messages: Array<{ content: unknown, role: string }> }).messages
    expect(messages.filter(message => message.role === 'system')).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('這是 Kiosk 的系統主動互動事件。'),
    })
    expect(messages[0]).toMatchObject({
      content: expect.stringContaining('【每次回覆都必須遵守的角色規則】\n回覆前必須遵守這項後置指示。'),
    })
    expect(messages[1]).toMatchObject({ role: 'user', content: '我想看看菜單。' })
  })

  it('only lets the registered device create, append to, and end its own visitor session', async () => {
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService,
      llmGateway,
      runtimeModelPolicy,
      secureCookies: false,
    }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1])
    await db.update(schema.kioskDevices).set({ settings: { ...defaultDeviceSettings, overrides: { observationEnabled: true, greetingEnabled: true, proactiveVlmEnabled: true } } }).where(eq(schema.kioskDevices.id, device!.id))

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
    await expect(reply.json()).resolves.toEqual({ agentInteraction: { mode: 'active' }, answer: '您好，我可以協助您點餐。', toolCalls: [] })

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
      body: JSON.stringify({ environment: 'test', id: 'demo-order-1', fulfillmentMode: 'takeout', itemCount: 2, status: 'accepted', total: 180 }),
    })
    expect(orderResult.status).toBe(201)
    await expect(orderResult.json()).resolves.toEqual({
      entry: expect.objectContaining({
        content: JSON.stringify({ environment: 'test', fulfillmentMode: 'takeout', id: 'demo-order-1', itemCount: 2, status: 'accepted', total: 180 }),
        kind: 'order_result',
        sequence: 4,
      }),
    })

    const retiredOrderResult = await app.request(`/api/kiosk/visitor-sessions/${session.id}/order-results`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ id: 'demo-order-2', fulfillmentMode: 'takeout', itemCount: 2, simulated: true, total: 180 }),
    })
    // This route-only harness has no app-wide API error middleware, so the
    // thrown validation error is exposed as 500 here rather than the full app's 400.
    expect(retiredOrderResult.status).toBe(500)

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

  it('uses the system control-plane chat binding', async () => {
    const kioskService = createKioskService(db)
    const complete = vi.fn(async () => Response.json({ choices: [{ message: { content: '已依店別模型回覆。' } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService,
      llmGateway: { complete },
      runtimeModelPolicy,
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

    const reply = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ content: '你好。' }),
    })

    expect(reply.status).toBe(200)
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ modelName: 'test-model' }))
  })

  it('keeps Server-owned audio model policy out of the device bootstrap', async () => {
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService,
      llmGateway,
      runtimeModelPolicy,
      secureCookies: false,
    }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
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
      runtimeModelPolicy,
      secureCookies: false,
    }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
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

  it('keeps the current browser tool exchange but replaces historical tool payloads with compact working context', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce(Response.json({
        choices: [{ message: {
          content: null,
          tool_calls: [{ id: 'call_menu', type: 'function', function: { name: 'menu_get', arguments: '{"query":"牛肉麵"}' } }],
        } }],
      }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '牛肉麵目前可以點餐。' } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '剛剛找到的是牛肉麵。' } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService: createKioskService(db),
      llmGateway: { complete },
      runtimeModelPolicy,
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
      name: 'menu_get',
      description: 'Find an item on the active menu.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    } }]

    const initialReply = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ content: '我要牛肉麵', tools }),
    })
    await expect(initialReply.json()).resolves.toEqual({ agentInteraction: { mode: 'active' }, answer: undefined, toolCalls: expect.any(Array) })

    const completedReply = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ tools, toolResults: [{ toolCallId: 'call_menu', name: 'menu_get', content: JSON.stringify({ items: [{ id: 'beef-noodles', name: '牛肉麵' }], presentation: { itemIds: ['beef-noodles'] } }) }] }),
    })
    await expect(completedReply.json()).resolves.toEqual({ agentInteraction: { mode: 'active' }, answer: '牛肉麵目前可以點餐。', toolCalls: [] })
    expect(complete).toHaveBeenLastCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        tools,
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: '我要牛肉麵' }),
          expect.objectContaining({ role: 'assistant', tool_calls: expect.any(Array) }),
          expect.objectContaining({ role: 'tool', tool_call_id: 'call_menu' }),
        ]),
      }),
    }))

    const followUp = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ content: '剛剛那個是什麼？', tools }),
    })
    await expect(followUp.json()).resolves.toEqual({ agentInteraction: { mode: 'active' }, answer: '剛剛找到的是牛肉麵。', toolCalls: [] })
    const followUpMessages = complete.mock.calls.at(-1)?.[0].body.messages as Array<{ content?: string, role: string, tool_calls?: unknown[] }>
    expect(followUpMessages[0]?.content).toContain('牛肉麵（beef-noodles）')
    expect(followUpMessages.some(message => message.role === 'tool')).toBe(false)
    expect(followUpMessages.some(message => Array.isArray(message.tool_calls))).toBe(false)
  })

  it('persists the full successful tool result and compact interaction state when the following model call fails', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce(Response.json({
        choices: [{ message: {
          content: null,
          tool_calls: [{ id: 'call_menu', type: 'function', function: { name: 'menu_get', arguments: '{"query":"牛肉麵"}' } }],
        } }],
      }))
      .mockRejectedValueOnce(new Error('provider timeout'))
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService,
      llmGateway: { complete },
      runtimeModelPolicy,
      secureCookies: false,
    }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1])
    const started = await app.request('/api/kiosk/visitor-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ serviceId: 'development-ordering-service' }),
    })
    const { session } = await started.json() as { session: { id: string } }
    const tools = [{ type: 'function', function: {
      name: 'menu_get',
      description: 'Find an item on the active menu.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    } }]
    await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ content: '我要牛肉麵', tools }),
    })
    const fullToolResult = JSON.stringify({
      customerMessage: '我找到牛肉麵。',
      items: [{ id: 'beef-noodles', name: '牛肉麵', description: '完整菜單介紹'.repeat(2_000) }],
      presentation: { itemIds: ['beef-noodles'], kind: 'query-results' },
    })

    const failedReply = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { 'Accept': 'text/event-stream', 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ tools, toolResults: [{ toolCallId: 'call_menu', name: 'menu_get', content: fullToolResult }] }),
    })

    expect(await failedReply.text()).toContain('"type":"turn-failed"')
    const modelMessages = complete.mock.calls.at(-1)?.[0].body.messages as Array<{ content?: string, role: string }>
    const modelToolResult = modelMessages.find(message => message.role === 'tool')?.content ?? ''
    expect(modelToolResult.length).toBeLessThanOrEqual(8_000)
    expect(JSON.parse(modelToolResult)).toMatchObject({ modelContextCompacted: true, presentation: { itemIds: ['beef-noodles'] } })

    const persisted = await kioskService.getVisitorSessionForDevice({ deviceId: device!.id, visitorSessionId: session.id })
    expect(persisted.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: fullToolResult, kind: 'tool_result' }),
    ]))
    expect(persisted.session.agentInteraction).toMatchObject({
      recentMenuSubjects: [{ id: 'beef-noodles', name: '牛肉麵' }],
      suggestedSubjectIds: ['beef-noodles'],
    })
  })

  it('streams customer-safe assistant deltas without persisting partial text', async () => {
    const complete = vi.fn(async () => new Response([
      'data: {"choices":[{"delta":{"content":"牛肉"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"麵可以點餐。"}}]}',
      '',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_menu","type":"function","function":{"name":"find_menu_item","arguments":"{}"}}]}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\r\n'), { headers: { 'Content-Type': 'text/event-stream' } }))
    const kioskService = createKioskService(db)
    const toolTraces: Array<{ phase: string, toolNames: string[], visitorSessionId: string }> = []
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService,
      llmGateway: { complete },
      runtimeModelPolicy,
      secureCookies: false,
      toolTraceObserver: { record: trace => toolTraces.push(trace) },
    }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
    const started = await app.request('/api/kiosk/visitor-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ serviceId: 'development-ordering-service' }),
    })
    const { session } = await started.json() as { session: { id: string } }

    const reply = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { 'Accept': 'text/event-stream', 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({
        content: '我要牛肉麵',
        tools: [{
          function: { name: 'find_menu_item', parameters: { type: 'object' } },
          type: 'function',
        }],
      }),
    })

    expect(reply.headers.get('Content-Type')).toContain('text/event-stream')
    const replyEvents = await reply.text()
    expect(replyEvents).toContain('"text":"牛肉","type":"assistant-delta"')
    expect(replyEvents).toContain('"id":"call_menu"')
    expect(replyEvents).toContain('"type":"tool-requested"')
    expect(replyEvents).toContain('"type":"turn-finished"')
    expect(toolTraces).toEqual([
      { phase: 'tools-provided', toolNames: ['find_menu_item'], visitorSessionId: session.id },
      { phase: 'llm-requests', toolNames: ['find_menu_item'], visitorSessionId: session.id },
    ])
    await expect(kioskService.getVisitorSessionForDevice({ deviceId: (await kioskService.resolveDeviceCredential(cookie.split('=')[1]))!.id, visitorSessionId: session.id })).resolves.toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ content: '牛肉麵可以點餐。', kind: 'assistant_text' }),
        expect.objectContaining({ kind: 'tool_call' }),
      ]),
    })
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ stream: true }) }))
  })
})
