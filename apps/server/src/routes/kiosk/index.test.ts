import type { ConversationContext } from '@proj-airi/stage-shared/kiosk-conversation'

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
import { replyTool } from '../../services/domain/kiosk-agent-interaction/conversationContext'
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

/** Explicit staged wire responses; each test still chooses its own semantic outcomes. */
function stagedProvider(choices: Record<string, string>, confidence = 0.95) {
  return vi.fn(async (_state: string, questions: Record<string, unknown>) => ({
    answers: Object.fromEntries(Object.keys(questions).map(key => [key, { choice: choices[key], confidence }])),
  }))
}

// These historical routing cases exercise the former always-enforced policy.
// Default-off and observe behavior have their own explicit policy/settings tests.
async function useBackgroundEnforcement(db: Database, cookie: string) {
  const service = createKioskService(db)
  const device = await service.resolveDeviceCredential(cookie.split('=')[1]!)
  if (!device)
    throw new Error('Missing test device')
  const { settings } = await service.getDeviceSettings(device.id)
  if (settings.overrides.backgroundSpeechMode === 'enforce')
    return
  await db.update(schema.kioskDevices).set({ settings: { ...settings, overrides: { ...settings.overrides, backgroundSpeechMode: 'enforce' } } }).where(eq(schema.kioskDevices.id, device.id))
}

describe('kiosk routes', () => {
  let db: Database

  beforeEach(async () => {
    db = await mockDB(schema)
  })

  it('records device audio warnings without requiring a customer session or accepting conversation content', async () => {
    const kioskService = createKioskService(db)
    const registration = await kioskService.registerDevelopmentDevice({ registrationCode: '483920' })
    const audioWarningLogger = vi.fn()
    const app = new Hono<HonoEnv>().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'failed' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, llmGateway, runtimeModelPolicy, audioWarningLogger }))
    const warning = { generation: 1, stage: 'mask_runtime', outcome: 'standard', channels: 8 }
    const send = (body: unknown, authenticated = true) => app.request('/api/kiosk/audio/warnings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: `${kioskDeviceCookieName}=${registration.credential}` } : {}) }, body: JSON.stringify(body) })
    expect((await send(warning, false)).status).toBe(401)
    expect(audioWarningLogger).not.toHaveBeenCalled()
    expect((await send({ ...warning, transcript: 'customer words' })).status).toBe(400)
    expect(audioWarningLogger).not.toHaveBeenCalled()
    expect((await send(warning)).status).toBe(200)
    expect(audioWarningLogger).toHaveBeenCalledExactlyOnceWith({ ...warning, deviceId: registration.device.id, siteId: registration.device.siteId })
    expect(await db.query.kioskVisitorSessions.findMany()).toHaveLength(0)
    expect(await db.query.kioskInteractionEntries.findMany()).toHaveLength(0)
  })

  // Report: docs/research/2026-10-27-security-audit.md
  it('proxies POS requests only for an enrolled device and rejects foreign origins and arbitrary paths', async () => {
    const forward = vi.fn<NonNullable<KioskRoutesOptions['posGateway']>['forward']>(async () => Response.json({ payment: { id: 'scratch-payment' } }))
    const app = new Hono<HonoEnv>().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'failed' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway, runtimeModelPolicy, apiOrigin: 'https://kiosk.example.com', posGateway: { forward } }))
    const path = '/api/kiosk/pos/v1/payments'
    expect((await app.request(path, { method: 'POST', body: '{}' })).status).toBe(401)
    expect(forward).not.toHaveBeenCalled()
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const cookie = enrolled.headers.get('Set-Cookie')!.split(';')[0]!
    await useBackgroundEnforcement(db, cookie)
    expect((await app.request(path, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://attacker.example' }, body: '{}' })).status).toBe(403)
    expect(forward).not.toHaveBeenCalled()
    expect((await app.request(path, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://kiosk.example.com' }, body: '{}' })).status).toBe(200)
    expect(forward).toHaveBeenCalledOnce()
    expect(forward.mock.calls[0]![0]).toMatchObject({ path: 'v1/payments', method: 'POST', credential: cookie.split('=')[1] })
    expect((await app.request('/api/kiosk/pos/v1/private-admin')).status).toBe(404)
    expect(forward).toHaveBeenCalledOnce()
    const local = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: false, secureCookies: false, kioskService: createKioskService(db), llmGateway, runtimeModelPolicy, apiOrigin: 'http://localhost:5168', posGateway: { forward } }))
    expect((await local.request(path, { method: 'POST', headers: { Cookie: cookie, Origin: 'http://localhost:5166' }, body: '{}' })).status).toBe(200)
    expect(forward).toHaveBeenCalledTimes(2)
    // Existing enrolled credentials still bootstrap after development enrollment
    // is disabled; customers do not need to register their browser again.
    const closed = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: false, secureCookies: false, kioskService: createKioskService(db), llmGateway, runtimeModelPolicy }))
    expect((await closed.request('/api/kiosk/bootstrap', { headers: { Cookie: cookie } })).status).toBe(200)
    expect((await closed.request('/api/kiosk/development/register', { method: 'POST' })).status).toBe(404)
  })

  it('verifies a legacy development device without automatically registering a replacement during payment', async () => {
    const kioskService = createKioskService(db)
    const registration = await kioskService.registerDevelopmentDevice({ registrationCode: '483920' })
    const legacySite = await kioskService.createSite({ name: 'Legacy test site', slug: 'legacy-auth-check' })
    await db.update(schema.kioskDevices).set({ siteId: legacySite.id }).where(eq(schema.kioskDevices.id, registration.device.id))
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, llmGateway, runtimeModelPolicy }))
    const response = await app.request('/api/kiosk/identity', { headers: { Cookie: `${kioskDeviceCookieName}=${registration.credential}` } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ device: { id: registration.device.id, siteId: legacySite.id }, serviceMode: 'kiosk' })
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(await db.query.kioskDevices.findMany()).toHaveLength(1)
  })

  // Report: docs/plans/2026-10-22-kiosk-field-investigation.md, payment HTTP400s.
  it('accepts the current Menu LINE Pay and JKoPay decision payload', async () => {
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '街口支付', candidates: [{ id: 'intent:select-payment:jkopay', description: '街口支付' }], decisionState: { phase: 'checkout_payment_select', allowedPaymentMethods: ['linepay', 'jkopay'] } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'SYSTEM_ONE_DISABLED' })
  })

  it.each(['json', 'sse'])('records actual Main payload size and provider usage (%s)', async (transport) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => transport === 'json'
      ? Response.json({ choices: [{ message: { content: '您好。' } }], usage: { prompt_tokens: 123 } })
      : new Response('data: {"choices":[{"delta":{"content":"您好。"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":123}}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const cookie = enrolled.headers.get('Set-Cookie')!.split(';')[0]!
    await useBackgroundEnforcement(db, cookie)
    const headers = { 'Cookie': cookie, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers: { ...headers, ...(transport === 'sse' ? { Accept: 'text/event-stream' } : {}) }, body: JSON.stringify({ content: '你是誰' }) })
    expect(response.status).toBe(200)
    await response.text()
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1]!)
    const saved = await kioskService.getVisitorSessionForDevice({ deviceId: device!.id, visitorSessionId: session.id })
    const entry = saved.entries.find(entry => entry.kind === 'service_event' && entry.content.includes('main_round_metrics'))
    expect(entry).toBeDefined()
    const metrics = JSON.parse(entry!.content)
    expect(metrics.inputTokens).toBe(123)
    expect(metrics.requestBytes).toBe(new TextEncoder().encode(JSON.stringify(complete.mock.calls[0]![0].body)).byteLength)
    expect(metrics.contextBytes).toBe(0)
    expect(metrics.durationMs).toBeGreaterThanOrEqual(0)
    if (transport === 'sse') {
      expect(metrics.firstOutputMs).toBeGreaterThanOrEqual(0)
      expect(metrics.firstOutputMs).toBeLessThanOrEqual(metrics.durationMs)
    }
    else {
      expect(metrics).not.toHaveProperty('firstOutputMs')
    }
    expect(metrics).not.toHaveProperty('messages')
  })

  // Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct28 no-tool rejection.
  it.each(['json', 'sse'])('repairs an unverified draft once and transports a typed reply (%s)', async (transport) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>()
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { content: '已付款成功。' } }] }))
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'reply', type: 'function', function: { name: replyTool.function.name, arguments: '{"kind":"payment-methods"}' } }] } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const context: ConversationContext = { contextId: 'current', capturedAt: Date.now(), taskId: 'task', sourceUtterance: '有哪些付款方式？', phase: 'ordering', entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], paymentMethods: [{ id: 'linepay', label: 'LINE Pay' }], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers: { ...headers, ...(transport === 'sse' ? { Accept: 'text/event-stream' } : {}) }, body: JSON.stringify({ content: context.sourceUtterance, decisionState: { phase: 'ordering', readOnly: true, context } }) })
    expect(response.status).toBe(200)
    const text = await response.text()
    const events = transport === 'sse' ? text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))) : []
    const final = transport === 'sse' ? events.find(event => event.type === 'turn-finished') : JSON.parse(text)
    expect(final.reply).toEqual({ kind: 'payment-methods' })
    expect(JSON.stringify(complete.mock.calls[0]![0].body.messages)).toContain('ordering@7')
    expect(final.toolCalls).toEqual([])
    expect(complete).toHaveBeenCalledTimes(2)
    expect(complete.mock.calls[1]![0].body.tools).toEqual([replyTool])
    expect(JSON.stringify(complete.mock.calls[1]![0].body)).not.toContain('已付款成功')
    expect(events.some(event => event.type === 'assistant-delta')).toBe(false)
    expect(events.some(event => event.type === 'tool-requested')).toBe(false)
  })

  // Report: docs/plans/2026-10-28-kiosk-conversation-repair.md, DINp seq193/213/218/221.
  it.each([
    { text: '可以送出去了', choice: 'UNSUPPORTED', allowed: false },
    { text: '不要清空，改幫我送出', choice: 'UNSUPPORTED', allowed: false },
    { text: '好，但改成兩份', choice: 'UNSUPPORTED', allowed: false },
    { text: '對', choice: 'SUPPORTED', allowed: true },
    { text: '好啊，清空吧', choice: 'SUPPORTED', allowed: true },
  ].flatMap(testCase => ['json', 'sse'].map(transport => ({ ...testCase, transport }))))('regression K1107-CONFIRM reviews the complete answer before clearing ($transport): $text', async ({ text, choice, allowed, transport }) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async ({ body }) => {
      const tools = body.tools as Array<{ function: { name: string } }>
      if (tools[0]?.function.name === 'verify_customer_operation')
        return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'verify_customer_operation', arguments: JSON.stringify({ choice }) } }] } }] })
      return Response.json({ choices: [{ message: { tool_calls: [{ id: 'clear', type: 'function', function: { name: 'order_answer_confirmation', arguments: JSON.stringify({ confirmationId: 'clear-question', confirmedByUser: true }) } }] } }] })
    })
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const context: ConversationContext = { contextId: 'current', capturedAt: Date.now(), taskId: 'reply-task', sourceUtterance: text, phase: 'pending_confirmation', entryComplete: true, readOnly: false, constraints: { excludeIngredients: [], includeIngredients: [] }, revisions: { menu: 1, cart: 1, selectedItem: 0, checkout: 0 }, cart: { itemCount: 1, total: 80, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: ['order_answer_confirmation'], waitingFor: { questionId: 'clear-question', purpose: 'operation-confirmation', question: '要清空目前購物車嗎？', choices: [{ id: 'intent:confirm:clear-question', description: '清空目前購物車' }], expiresAt: Date.now() + 30000 } }
    const tools = [{ type: 'function', function: { name: 'order_answer_confirmation', parameters: { type: 'object', properties: { confirmationId: { type: 'string' }, confirmedByUser: { type: 'boolean' } }, required: ['confirmationId', 'confirmedByUser'], additionalProperties: false } } }]
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers: { ...headers, ...(transport === 'sse' ? { Accept: 'text/event-stream' } : {}) }, body: JSON.stringify({ content: text, tools, decisionState: { phase: context.phase, context } }) })
    expect(response.status).toBe(200)
    const raw = await response.text()
    const result = (transport === 'sse' ? raw.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(event => event.type === 'turn-finished') : JSON.parse(raw)) as { toolCalls: Array<{ function: { name: string } }>, reply?: { kind: string } }
    expect(result.toolCalls.map(call => call.function.name)).toEqual(allowed ? ['order_answer_confirmation'] : [])
    expect(complete).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(complete.mock.calls[1]![0].body.messages)).toContain(text)
    expect(JSON.stringify(complete.mock.calls[1]![0].body.messages)).toContain('要清空目前購物車嗎？')
    if (!allowed)
      expect(result.reply?.kind).toBe('clarification')
  })

  // Report: Nov7 configured model split a replacement into removal, then stopped.
  it.each(['json', 'sse'])('repairs a rejected partial replacement once and rechecks its consent (%s)', async (transport) => {
    let proposed = 0
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async ({ body }) => {
      const tools = body.tools as Array<{ function: { name: string } }>
      if (tools[0]?.function.name === 'verify_customer_operation')
        return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'verify_customer_operation', arguments: JSON.stringify({ choice: proposed > 1 ? 'SUPPORTED' : 'UNSUPPORTED' }) } }] } }] })
      if (tools[0]?.function.name === 'preserve_requested_quantities')
        return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'preserve_requested_quantities', arguments: '{"quantities":[{"callId":"swap","quantity":1,"replaceExisting":true}]}' } }] } }] })
      proposed++
      return Response.json({ choices: [{ message: { tool_calls: [{ id: 'swap', type: 'function', function: proposed > 1 ? { name: 'order_add_item', arguments: '{"itemId":"dumplings","quantity":1,"replaceLineId":"old"}' } : { name: 'cart_remove_item', arguments: '{"lineId":"old"}' } }] } }] })
    })
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json', ...(transport === 'sse' ? { Accept: 'text/event-stream' } : {}) }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const context: ConversationContext = { contextId: 'swap', capturedAt: Date.now(), taskId: 'swap-task', sourceUtterance: '牛肉麵不要了，改水餃一份', phase: 'ordering', entryComplete: true, readOnly: false, constraints: { excludeIngredients: [], includeIngredients: [] }, revisions: { menu: 0, cart: 1, selectedItem: 0, checkout: 0 }, cart: { itemCount: 1, total: 150, lines: [{ id: 'old', itemId: 'beef', name: '牛肉麵', quantity: 1, unitPrice: 150, options: [] }] }, waitingFor: { questionId: 'mode', purpose: 'fulfillment', question: '內用還是自取？', choices: [], expiresAt: Date.now() + 30000 }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: ['cart_remove_item', 'order_add_item'] }
    const tools = context.allowedToolNames.map(name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } }))
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: context.sourceUtterance, tools, decisionState: { phase: context.phase, requestScope: 'order-operation', context } }) })
    const text = await response.text()
    const result = transport === 'sse' ? text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(event => event.type === 'turn-finished') : JSON.parse(text)
    expect(response.status).toBe(200)
    expect(result.toolCalls.map((call: { function: { name: string } }) => call.function.name)).toEqual(['order_add_item'])
    expect(complete).toHaveBeenCalledTimes(5)
    expect(JSON.stringify(complete.mock.calls[2]![0].body)).toContain('replaceLineId')
    const device = await createKioskService(db).resolveDeviceCredential(headers.Cookie.split('=')[1]!)
    const saved = await createKioskService(db).getVisitorSessionForDevice({ deviceId: device!.id, visitorSessionId: session.id })
    const metric = saved.entries.find(entry => entry.kind === 'service_event' && entry.content.includes('main_round_metrics'))!
    expect(JSON.parse(metric.content).operationReviewRequests).toBe(2)
    expect(JSON.parse(metric.content).replyRepairRequests).toBe(1)
  })

  // Report: Nov6 hA7/I_A7; uncertain speech must not open or clear the cart.
  it.each([
    { replyOnly: true, tool: 'cart_get', choice: 'SUPPORTED', expectedCalls: 1 },
    { replyOnly: false, tool: 'cart_get', choice: 'UNSUPPORTED', expectedCalls: 2 },
    { replyOnly: false, tool: 'cart_clear', choice: 'UNSUPPORTED', expectedCalls: 2 },
    { replyOnly: false, tool: 'cart_get', choice: 'SUPPORTED', expectedCalls: 2 },
  ])('regression K1107-CART enforces the admitted scope before browser effects: %j', async ({ replyOnly, tool, choice, expectedCalls }) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async ({ body }) => {
      const tools = body.tools as Array<{ function: { name: string } }>
      if (tools[0]?.function.name === 'verify_customer_operation')
        return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'verify_customer_operation', arguments: JSON.stringify({ choice }) } }] } }] })
      return Response.json({ choices: [{ message: { tool_calls: [{ id: 'cart', type: 'function', function: { name: tool, arguments: '{"display":true}' } }] } }] })
    })
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const context: ConversationContext = { contextId: 'current', capturedAt: Date.now(), taskId: 'uncertain-task', sourceUtterance: '不知道收了什麼印進去', phase: 'ordering', entryComplete: true, readOnly: false, constraints: { excludeIngredients: [], includeIngredients: [] }, revisions: { menu: 1, cart: 1, selectedItem: 0, checkout: 0 }, cart: { itemCount: 1, total: 80, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [tool] }
    if (!replyOnly && choice === 'SUPPORTED')
      context.sourceUtterance = '幫我看一下購物車'
    const tools = [{ type: 'function', function: { name: tool, parameters: { type: 'object', properties: { display: { type: 'boolean' } } } } }]
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: context.sourceUtterance, tools, decisionState: { phase: context.phase, replyOnly, context } }) })
    expect(response.status).toBe(200)
    const result = await response.json() as { toolCalls: Array<{ function: { name: string } }>, reply?: { kind: string } }
    const allowed = !replyOnly && choice === 'SUPPORTED'
    expect(result.toolCalls.map(call => call.function.name)).toEqual(allowed ? [tool] : [])
    expect(complete).toHaveBeenCalledTimes(expectedCalls)
    const kioskService = createKioskService(db)
    const device = await kioskService.resolveDeviceCredential(headers.Cookie.split('=')[1]!)
    const saved = await kioskService.getVisitorSessionForDevice({ deviceId: device!.id, visitorSessionId: session.id })
    const entry = saved.entries.find(entry => entry.kind === 'service_event' && entry.content.includes('main_round_metrics'))
    expect(entry).toBeDefined()
    expect(JSON.parse(entry!.content).operationReviewRequests).toBe(replyOnly ? 0 : 1)
    if (!allowed)
      expect(result.reply?.kind).toBe('clarification')
    if (replyOnly)
      expect(complete.mock.calls[0]![0].body.tools).toEqual([replyTool])
  })

  // Report: frozen live112 C09-A1, attempt478; a service-only pause was
  // incorrectly offered menu_recommend and became a price/category question.
  it.each(['acknowledgement', 'out-of-scope'])('keeps a qualified service reply %s out of menu and order tools', async (kind) => {
    const reply = kind === 'out-of-scope' ? { kind: 'service-information', topic: 'out-of-scope' } : { kind: 'acknowledgement' }
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'ack', type: 'function', function: { name: replyTool.function.name, arguments: JSON.stringify(reply) } }] } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const context: ConversationContext = { contextId: 'current', capturedAt: Date.now(), taskId: 'pause', sourceUtterance: kind === 'out-of-scope' ? '幫我處理點餐以外的工作' : '先等一下', phase: 'configuration', entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: ['menu_recommend'] }
    const tools = ['menu_recommend', 'order_add_item'].map(name => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } }))
    const result = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: context.sourceUtterance, tools, decisionState: { phase: context.phase, readOnly: true, serviceReply: true, context } }) })
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ reply, toolCalls: [] })
    expect(complete.mock.calls[0]![0].body.tools).toEqual([replyTool])
    expect(complete.mock.calls[0]![0].body.tool_choice).toBe('required')
  })

  // Report: this chat, Nov2; a known bulk-order refusal must not be reviewed into a write.
  it('ends a quantity-limit selector without a completion review or browser mutation', async () => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'limit', type: 'function', function: { name: replyTool.function.name, arguments: '{"kind":"quantity-limit"}' } }] } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const context: ConversationContext = { contextId: 'current', capturedAt: Date.now(), taskId: 'quantity-limit', sourceUtterance: '排骨便當200份', phase: 'ordering', entryComplete: true, readOnly: false, constraints: { excludeIngredients: [], includeIngredients: [] }, revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: ['order_add_item'], quantityPolicy: { maximum: 20, message: '每種餐點最多20份。' } }
    const tools = [{ type: 'function', function: { name: 'order_add_item', parameters: { type: 'object', properties: { quantity: { type: 'integer', maximum: 20 } } } } }]
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: context.sourceUtterance, tools, decisionState: { phase: 'ordering', context } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ reply: { kind: 'quantity-limit' }, toolCalls: [] })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  // Report: live112 C11-A2, attempt706; an empty-cart evidence read plus
  // a proven-unexecuted proposal must not replace the needed clarification.
  it('keeps an unexecuted ambiguous order in typed clarification after cart evidence', async () => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>()
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { content: '請問是炸排骨便當兩份嗎？' } }] }))
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'clarify', type: 'function', function: { name: replyTool.function.name, arguments: '{"kind":"clarification"}' } }] } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const context: ConversationContext = { contextId: 'current', capturedAt: Date.now(), taskId: 'unbound', sourceUtterance: '那個兩份', phase: 'ordering', entryComplete: true, readOnly: false, constraints: { excludeIngredients: [], includeIngredients: [] }, revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] }
    const toolResults = [{ toolCallId: 'cart', name: 'cart_get', content: JSON.stringify({ cart: context.cart }) }, { toolCallId: 'unavailable', name: 'order_add_item', content: JSON.stringify({ ok: false, executed: false, error: 'UNKNOWN_TOOL' }) }]
    const result = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: context.sourceUtterance, toolResults, decisionState: { phase: 'ordering', context } }) })
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ reply: { kind: 'clarification' }, toolCalls: [] })
    expect(complete).toHaveBeenCalledTimes(2)
    expect(complete.mock.calls[1]![0].body.tools).toEqual([replyTool])
  })

  // Report: this chat, Nov2; direct Main asked the customer to click invoice
  // confirmation instead of executing it, then reply-only repair hid the miss.
  it.each(['carrier', 'citizen', 'tax-id'] as const)('reviews omitted %s confirmation before removing browser tools', async (method) => {
    const name = method === 'tax-id' ? 'checkout_confirm_tax_id' : 'checkout_confirm_invoice'
    const phase = method === 'tax-id' ? 'checkout_tax_id' : 'checkout_invoice'
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>()
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { content: '請按畫面上的確認繼續。' } }] }))
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'confirm', type: 'function', function: { name, arguments: '{"confirmedByUser":true}' } }] } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const context: ConversationContext = { contextId: 'invoice', capturedAt: Date.now(), taskId: 'invoice', sourceUtterance: '填好了，送出', phase, entryComplete: true, readOnly: false, constraints: { excludeIngredients: [], includeIngredients: [] }, revisions: { menu: 1, cart: 1, selectedItem: 0, checkout: 1 }, cart: { itemCount: 1, total: 80, lines: [] }, checkout: { stage: method === 'tax-id' ? 'tax-id' : 'invoice', invoiceMethod: method, invoiceDraftReady: true, carrierRegistered: false, citizenRegistered: false }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [name] }
    const tools = [{ type: 'function', function: { name, description: '確認已填資料', parameters: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } } }]
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: context.sourceUtterance, tools, decisionState: { phase, context } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ toolCalls: [{ function: { name } }] })
    expect(complete).toHaveBeenCalledTimes(2)
    expect(complete.mock.calls[1]![0].body.tools).toEqual([...tools, replyTool])
  })

  // Report: this chat, Nov2; returning to order and confirmation ended in prose only.
  it.each(['return', 'answer'] as const)('reviews omitted checkout navigation %s before removing browser tools', async (method) => {
    const name = method === 'return' ? 'checkout_cancel' : 'order_answer_confirmation'
    const phase = method === 'return' ? 'checkout_invoice' : 'pending_confirmation'
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>()
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { content: '請按畫面上的確認繼續。' } }] }))
      .mockImplementation(async ({ body }) => {
        const tools = body.tools as Array<{ function: { name: string } }>
        const review = tools[0]?.function.name === 'verify_customer_operation'
        return Response.json({ choices: [{ message: { tool_calls: [{ id: 'confirm', type: 'function', function: { name: review ? 'verify_customer_operation' : name, arguments: JSON.stringify(review ? { choice: 'SUPPORTED' } : { confirmationId: 'invoice-action', confirmedByUser: true }) } }] } }] })
      })
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const context: ConversationContext = { contextId: 'invoice', capturedAt: Date.now(), taskId: 'invoice', sourceUtterance: method === 'return' ? '回到訂單頁面' : '確認', phase, entryComplete: true, readOnly: false, constraints: { excludeIngredients: [], includeIngredients: [] }, revisions: { menu: 1, cart: 1, selectedItem: 0, checkout: 1 }, cart: { itemCount: 1, total: 80, lines: [] }, checkout: { stage: 'invoice', invoiceMethod: 'carrier', invoiceDraftReady: false, carrierRegistered: false, citizenRegistered: false }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [name], ...(method === 'answer' ? { waitingFor: { questionId: 'invoice-action', purpose: 'operation-confirmation', question: '確認目前操作嗎？', expiresAt: Date.now() + 30000, choices: [{ id: 'intent:confirm:invoice-action', description: '確認目前操作' }] } } : {}) }
    const tools = [{ type: 'function', function: { name, description: '確認已填資料', parameters: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } } }]
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: context.sourceUtterance, tools, decisionState: { phase, context } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ toolCalls: [{ function: { name } }] })
    expect(complete).toHaveBeenCalledTimes(method === 'answer' ? 3 : 2)
    expect(complete.mock.calls[1]![0].body.tools).toEqual([...tools, replyTool])
  })

  // Report: this chat, Nov5; saying "cancelled" did not close the recipe confirmation.
  it.each(['answer', 'proposal'] as const)('requires a real tool or substantive reply for an original recipe (%s)', async (stage) => {
    const name = stage === 'answer' ? 'order_answer_confirmation' : 'menu_confirm_item'
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async ({ body }) => {
      const tools = body.tools as Array<{ function: { name: string } }>
      if (tools[0]?.function.name === 'verify_customer_operation')
        return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'verify_customer_operation', arguments: '{"choice":"SUPPORTED"}' } }] } }] })
      return Response.json({ choices: [{ message: { tool_calls: [{ id: 'answer', type: 'function', function: { name, arguments: JSON.stringify(stage === 'answer' ? { confirmationId: 'recipe', confirmedByUser: false } : { itemId: 'bento', originalRecipe: true }) } }] } }] })
    })
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const context: ConversationContext = { contextId: 'recipe', capturedAt: Date.now(), sourceUtterance: '那不要了', phase: stage === 'answer' ? 'meal_confirmation' : 'configuration', unavailableConditions: [{ id: 'spice', label: '辣度' }], entryComplete: true, readOnly: false, constraints: { excludeIngredients: [], includeIngredients: [] }, revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [name], ...(stage === 'answer' ? { waitingFor: { questionId: 'recipe', purpose: 'confirm-meal', question: '接受原版餐點嗎？', expiresAt: Date.now() + 30000, choices: [{ id: 'confirm-meal:recipe:no', description: '拒絕原版餐點' }] } } : {}) }
    const tools = [{ type: 'function', function: { name, description: '回答原版確認', parameters: { type: 'object', properties: stage === 'answer' ? { confirmationId: { type: 'string' }, confirmedByUser: { type: 'boolean' } } : { itemId: { type: 'string' }, originalRecipe: { type: 'boolean' } }, required: stage === 'answer' ? ['confirmationId', 'confirmedByUser'] : ['itemId', 'originalRecipe'], additionalProperties: false } } }]
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: context.sourceUtterance, tools, decisionState: { phase: context.phase, context } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ toolCalls: [{ function: { name } }] })
    const policy = complete.mock.calls[0]![0].body
    expect(policy.tool_choice).toBe('required')
    const presented = policy.tools as Array<{ function: { name: string, parameters: { properties: { kind?: { enum: string[] } } } } }>
    const reply = presented.find(tool => tool.function.name === 'respond_to_customer')!
    expect(reply.function.parameters.properties.kind!.enum).not.toContain('acknowledgement')
    expect(reply.function.parameters.properties.kind!.enum).toContain('menu-information')
    if (stage === 'proposal')
      expect(reply.function.parameters.properties.kind!.enum).not.toContain('clarification')
  })

  // Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct31 alternatives replay.
  it.each([false, true].flatMap(selector => [false, true].map(readOnly => ({ selector, readOnly }))))('preserves accepted menu receipts after one draft review (selector=$selector, readOnly=$readOnly)', async ({ selector, readOnly }) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>()
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: selector ? { tool_calls: [{ id: 'premature', type: 'function', function: { name: replyTool.function.name, arguments: '{"kind":"menu-information","subjects":["水餃"]}' } }] } : { content: '推薦炸排骨便當。' } }] }))
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'next', type: 'function', function: { name: 'menu_recommend', arguments: '{"action":"continue"}' } }] } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const context: ConversationContext = { contextId: 'current', capturedAt: Date.now(), taskId: 'alternatives', sourceUtterance: '還有其他的嗎', phase: 'ordering', entryComplete: true, readOnly, constraints: { excludeIngredients: [], includeIngredients: [] }, revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: ['menu_recommend', ...(!readOnly ? ['order_add_item'] : [])] }
    const tools = [{ type: 'function', function: { name: 'menu_recommend', description: '換推薦', parameters: { type: 'object', properties: {} } } }, ...(!readOnly ? [{ type: 'function', function: { name: 'order_add_item', description: '新增', parameters: { type: 'object', properties: {} } } }] : [])]
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: context.sourceUtterance, tools, decisionState: { phase: 'ordering', readOnly, requireMenuRead: true, context } }) })
    expect(response.status).toBe(200)
    const final = await response.json() as { toolCalls: { function: { name: string } }[] }
    expect(final.toolCalls).toMatchObject([{ function: { name: 'menu_recommend' } }])
    expect(complete).toHaveBeenCalledTimes(2)
    expect(complete.mock.calls[1]![0].body.tools).toMatchObject([...tools.filter(tool => tool.function.name === 'menu_recommend'), { function: { name: replyTool.function.name, parameters: { properties: { kind: { enum: ['clarification', 'service-information', 'staff-assistance'] } } } } }])
    expect(JSON.stringify(complete.mock.calls[1]![0].body.messages)).toContain('展示下一批推薦')
    complete.mockImplementationOnce(async () => Response.json({ choices: [{ message: { content: '推薦炸排骨便當。' } }] }))
    const continued = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ tools, decisionState: { phase: 'ordering', readOnly, requireMenuRead: true, context }, toolResults: [{ name: 'menu_recommend', toolCallId: 'next', content: JSON.stringify({ items: [{ id: 'pork', name: '炸排骨便當' }], presentation: { kind: 'recommendation', itemIds: ['pork'] }, customerMessage: '推薦炸排骨便當。' }) }] }) })
    expect(continued.status).toBe(200)
    expect(await continued.json()).not.toHaveProperty('reply.kind', 'clarification')
    expect(complete).toHaveBeenCalledTimes(3)
  })

  // Reports: live112 C02-F2 and C05-F3, retained in conversationFindings.
  it.each(['category', 'unchanged'] as const)('reviews a questionable query before emitting browser effects: %s', async (kind) => {
    const args = kind === 'category' ? { action: 'update', category: '點心' } : { action: 'update', category: '麵食', maxPrice: 150 }
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>()
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'proposal', type: 'function', function: { name: 'menu_recommend', arguments: JSON.stringify(args) } }] } }] }))
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'review', type: 'function', function: { name: kind === 'category' ? 'verify_menu_kind' : 'menu_recommend', arguments: kind === 'category' ? '{"choice":"UNCONFIRMED"}' : '{"action":"continue"}' } }] } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const context: ConversationContext = { contextId: 'current', capturedAt: Date.now(), taskId: 'query-review', sourceUtterance: kind === 'category' ? '那有什麼甜點' : '其他麵食呢', phase: 'ordering', entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, queryState: { category: '麵食', queries: [], exhausted: true, prices: { maxPrice: 150 }, filters: { excludeIngredients: [], includeIngredients: [] } }, revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, catalog: { complete: true, itemCount: 1, items: [{ id: 'dumplings', name: '水餃', category: '點心', aliases: [], price: 80, availability: 'available', optionGroups: [] }] }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: ['menu_recommend'] }
    const tools = [{ type: 'function', function: { name: 'menu_recommend', description: '查詢', parameters: { type: 'object', properties: {} } } }]
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: context.sourceUtterance, tools, decisionState: { phase: 'ordering', readOnly: true, requireMenuRead: true, context } }) })
    expect(response.status).toBe(200)
    const result = await response.json() as { reply?: { kind: string, topic: string }, toolCalls: Array<{ function: { name: string, arguments: string } }> }
    expect(complete).toHaveBeenCalledTimes(2)
    if (kind === 'category') {
      expect(result.toolCalls).toEqual([])
      expect(result.reply).toMatchObject({ kind: 'clarification', topic: 'menu-kind' })
    }
    else {
      expect(result.toolCalls).toMatchObject([{ function: { name: 'menu_recommend', arguments: '{"action":"continue"}' } }])
    }
  })

  it.each([false, true])('supplies one complete current catalog without forcing an extra lookup (continuation=%s)', async (continuation) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'response', type: 'function', function: { name: replyTool.function.name, arguments: '{"kind":"clarification"}' } }] } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const context: ConversationContext = { contextId: 'current', capturedAt: Date.now(), taskId: 'task', sourceUtterance: '排骨飯一份', phase: 'ordering', entryComplete: true, readOnly: false, constraints: { excludeIngredients: [], includeIngredients: [] }, revisions: { menu: 1, cart: 2, selectedItem: 0, checkout: 0 }, catalog: { complete: true, itemCount: 1, items: [{ id: 'pork', name: '完整菜單唯一測試便當', aliases: ['排骨便當'], category: '便當', price: 130, availability: 'available', optionGroups: [] }] }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: ['order_add_item', 'menu_confirm_item'] }
    const tools = ['menu_get', 'order_add_item', 'menu_confirm_item', 'customer_skip_phone'].map(name => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } }))
    if (continuation) {
      // Keep the original receipt durable, but do not repeat its full product
      // details when the next round already has the complete current catalog.
      const entries = [
        { kind: 'user_text', content: '排骨飯一份' },
        { kind: 'tool_call', content: 'menu then cart', metadata: { toolCalls: [{ id: 'past-menu', type: 'function', function: { name: 'menu_get', arguments: '{}' } }, { id: 'cart', type: 'function', function: { name: 'cart_get', arguments: '{}' } }] } },
        { kind: 'tool_result', content: JSON.stringify({ items: context.catalog!.items, catalog: context.catalog, possibleItems: context.catalog!.items }), metadata: { toolCallId: 'past-menu', name: 'menu_get' } },
      ]
      for (const entry of entries) {
        const saved = await app.request(`/api/kiosk/visitor-sessions/${session.id}/entries`, { method: 'POST', headers, body: JSON.stringify(entry) })
        expect(saved.status).toBe(201)
      }
    }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ tools, decisionState: { phase: 'ordering', context, requireMenuRead: true }, ...(continuation ? { toolResults: [{ name: 'cart_get', toolCallId: 'cart', content: '{"cart":{"lines":[],"total":0}}' }] } : { content: '排骨飯一份' }) }) })
    expect(response.status).toBe(200)
    const body = complete.mock.calls[0]![0].body
    expect(body.tools).toEqual([tools[1], tools[2], replyTool])
    expect(body).not.toHaveProperty('tool_choice')
    const prompt = JSON.stringify(body.messages)
    expect(prompt.split('完整菜單唯一測試便當')).toHaveLength(2)
    expect(prompt).toContain('目前可直接查詢菜單與點餐')
    expect(prompt).toContain('排骨便當')
    expect(prompt).not.toContain('imageUrl')
    // This route-only harness has no API error middleware; schema rejection is 500 here.
    const inconsistent = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '測試狀態', decisionState: { phase: 'customer_entry', context } }) })
    expect(inconsistent.status).toBe(500)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  // Report: attachment a553fda2, 大腸臭臭鍋一份: Main replayed a stale phone reminder before menu lookup.
  it.each([false, true])('does not offer host-owned phone skip to Main (continuation=%s)', async (continuation) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { content: '查詢中。' } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const tools = ['customer_skip_phone', 'menu_get', 'order_add_item'].map(name => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } }))
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ tools, ...(continuation ? { toolResults: [{ name: 'menu_get', toolCallId: 'lookup', content: '{"items":[],"customerMessage":"目前菜單查不到大腸臭臭鍋。"}' }] } : { content: '大腸臭臭鍋一份', decisionState: { phase: 'ordering' } }) }) })
    expect(response.status).toBe(200)
    expect(complete).toHaveBeenCalledOnce()
    expect(complete.mock.calls[0]![0].body.tools).toEqual([tools[1], tools[2]])
  })

  // Report: this chat, 2026-10-20: low-confidence price INFORMATION left Main's reads blocked.
  it.each([false, true])('uses Main to resolve weak price semantics before handoff (segmented=%s)', async (segmented) => {
    const decide = stagedProvider({ admission: 'SERVICE', purpose: 'QUERY' })
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_price_choice', arguments: '{"choice":"INFORMATION"}' } }] } }] }))
    const systemOne = { isEnabled: async () => true, decide, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), maxActionCandidates: async () => 22 as const }
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy, systemOne }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '有水餃或牛肉麵嗎？多少錢？', segmented, includeTrace: true, candidates: [{ id: 'intent:search-menu', description: '查詢餐點' }], decisionState: { phase: 'ordering', priceEvidence: { amounts: [], choices: [{ id: 'INFORMATION', kind: 'information', description: '只詢價' }, { id: 'NONE', kind: 'none', description: '無價格需求' }, { id: 'UNSUPPORTED', kind: 'unsupported', description: '無法完整表示' }] }, constraints: { exclude: [], include: [], unresolvedPrice: true } } }) })
    expect(response.status).toBe(200)
    let payload = await response.json()
    for (let step = 0; step < 10; step++) {
      if (!payload || typeof payload !== 'object' || !('kind' in payload) || payload.kind !== 'DECISION_PROGRESS' || !('continuationId' in payload))
        break
      payload = await (await app.request(`/api/kiosk/interaction-decisions/${String(payload.continuationId)}`, { method: 'POST', headers, body: '{}' })).json()
    }
    expect(payload).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER', priceChoiceId: 'INFORMATION', trace: { priceResolution: { choice: 'INFORMATION' } } })
    expect(payload).not.toHaveProperty('actionId')
    expect(complete).toHaveBeenCalledOnce()
  })

  // Report: this chat, 2026-10-21; store FAQ sent to unclassified Main.
  it('recovers a store FAQ sent to generic Main without turning it into a menu lookup', async () => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"recipient":"kiosk","choice":"SERVICE_INFORMATION_ONLY"}' } }] } }] }))
    const systemOne = { isEnabled: async () => true, maxActionCandidates: async () => 22 as const, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), decide: stagedProvider({ admission: 'SERVICE', purpose: 'HANDOFF' }) }
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy, systemOne }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '你們幾點關門？', includeTrace: true, candidates: [], decisionState: { phase: 'ordering', catalogEvidence: { products: [], categories: [] } } }) })
    expect(response.status).toBe(200)
    const decision = await response.json()
    expect(decision).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION' })
    expect(decision).not.toHaveProperty('actionId')
    expect(complete).toHaveBeenCalledOnce()
    expect(complete.mock.calls[0]![0].body).toHaveProperty('tools', [expect.objectContaining({ function: expect.objectContaining({ name: 'resolve_service_scope' }) })])
  })

  // Report: this chat, 2026-10-20 — 水餃一份 啊 我不要了 on the phone-entry page.
  it('preserves a retracted order for Main without requiring a menu read or exposing phone/order mutations', async () => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { content: '好的，這份水餃先不點。' } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const tools = ['menu_get', 'customer_skip_phone', 'order_add_item', 'checkout_start'].map(name => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } }))
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '水餃一份 啊 我不要了', decisionState: { phase: 'customer_entry', readOnly: true }, tools }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ answer: '好的，這份水餃先不點。', toolCalls: [] })
    expect(complete).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: '水餃一份 啊 我不要了' }),
        expect.objectContaining({ role: 'system', content: expect.stringContaining('沒有剩餘操作，只需確認先不點') }),
      ]),
    }) }))
    expect(complete.mock.calls[0]![0].body).not.toHaveProperty('tools')
    expect(complete.mock.calls[0]![0].body).not.toHaveProperty('tool_choice', 'required')
  })

  // Report: this chat, query-action voice clarification, 2026-10-19.
  it.each([false, true])('finishes a query clarification without another provider call (stream=%s)', async (stream) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>()
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const question = '你想調整價位，還是換餐點種類？'
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers: { ...headers, ...(stream ? { Accept: 'text/event-stream' } : {}) }, body: JSON.stringify({ decisionState: { phase: 'ordering', readOnly: true }, toolResults: [{ name: 'menu_recommend', toolCallId: 'clarification', content: JSON.stringify({ queryAction: 'clarify', items: [], customerMessage: question }) }] }) })
    expect(response.status).toBe(200)
    if (stream)
      expect(await response.text()).toContain(question)
    else
      expect(await response.json()).toMatchObject({ answer: question, toolCalls: [] })
    expect(complete).not.toHaveBeenCalled()
  })

  // Report: attachment a6e7ea59; device off/observe must reach Main without downstream admission.
  it.each(['off', 'observe'] as const)('honors device background mode %s for a weak non-menu question', async (mode) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async ({ body }) => {
      const wire = JSON.stringify(body.tools)
      expect(wire).not.toContain('BACKGROUND')
      expect(wire).not.toContain('recipient')
      const tools = body.tools as Array<{ function: { name: string } }>
      const name = tools[0]!.function.name
      return Response.json({ choices: [{ message: { tool_calls: [{ function: { name, arguments: name === 'resolve_service_request' ? '{"admission":"service","disposition":"assistant"}' : '{"choice":"SERVICE_INFORMATION_ONLY"}' } }] } }] })
    })
    const decide = vi.fn(async (_state: string, questions: Record<string, unknown>) => ({ answers: Object.fromEntries(Object.keys(questions).map(key => [key, { choice: key === 'admission' ? 'BACKGROUND' : 'SINGLE', confidence: key === 'admission' ? 0.99 : 0.226 }])) }))
    const systemOne = { isEnabled: async () => true, maxActionCandidates: async () => 22 as const, getPolicy: async () => ({ decisionInstruction: '', storeInstruction: '', defaultDecisionInstruction: '', updatedAt: null }), decide }
    const service = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: service, llmGateway: { complete }, runtimeModelPolicy, systemOne }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"registrationCode":"483920"}' })
    const cookie = enrolled.headers.get('Set-Cookie')!.split(';')[0]!
    const device = (await service.resolveDeviceCredential(cookie.split('=')[1]!))!
    const { settings } = await service.getDeviceSettings(device.id)
    await db.update(schema.kioskDevices).set({ settings: { ...settings, overrides: { ...settings.overrides, backgroundSpeechMode: mode } } }).where(eq(schema.kioskDevices.id, device.id))
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers: { 'Cookie': cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: '王大陸你認識嗎？', includeTrace: true, candidates: [{ id: 'intent:search-menu', description: '查菜單' }], decisionState: { phase: 'ordering' } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION', trace: { backgroundObservation: { mode } } })
    expect(complete).toHaveBeenCalledTimes(2)
    expect(decide.mock.calls.some(([, questions]) => 'admission' in questions)).toBe(mode === 'observe')
  })

  // Report: this chat, 2026-11-06; the early scope endpoint also needs device policy.
  it.each(['off', 'observe'] as const)('does not offer IGNORE for a scope question in %s', async (mode) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async ({ body }) => {
      expect(JSON.stringify(body.tools)).not.toContain('IGNORE')
      return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'scope_decide', arguments: '{"choice":"NEW_REQUEST"}' } }] } }] })
    })
    const service = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: service, llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"registrationCode":"483920"}' })
    const cookie = enrolled.headers.get('Set-Cookie')!.split(';')[0]!
    const device = (await service.resolveDeviceCredential(cookie.split('=')[1]!))!
    const { settings } = await service.getDeviceSettings(device.id)
    await db.update(schema.kioskDevices).set({ settings: { ...settings, overrides: { ...settings.overrides, backgroundSpeechMode: mode } } }).where(eq(schema.kioskDevices.id, device.id))
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers: { 'Cookie': cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: '王大陸你認識嗎？', candidates: [], decisionState: { phase: 'query_scope', waitingFor: { questionId: 'scope', purpose: 'menu-query-scope', question: '剛才還是全部？', expiresAt: Date.now() + 30000, choices: [] } } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ kind: 'SCOPE_CHOICE', choice: 'NEW_REQUEST' })
  })

  it.each(['SHOWN', 'CATALOG', 'invented'])('uses Main Agent only for the live scope question: %s', async (choice) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'scope', type: 'function', function: { name: 'scope_decide', arguments: JSON.stringify({ choice }) } }] } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ candidates: [], transcript: '剛才那幾個', decisionState: { phase: 'query_scope', waitingFor: { questionId: 'scope-1', purpose: 'menu-query-scope', question: '剛才推薦的還是整份菜單？', expiresAt: Date.now() + 60_000, choices: [{ id: 'SHOWN', description: '剛才推薦的' }, { id: 'CATALOG', description: '整份菜單' }] } } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ kind: 'SCOPE_CHOICE', choice: choice === 'invented' ? 'ASK' : choice })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete.mock.calls[0]![0].body).toMatchObject({ temperature: 0, tools: [{ function: { name: 'scope_decide' } }], tool_choice: 'required' })
    expect(JSON.stringify(complete.mock.calls[0]![0].body.messages)).not.toContain('scope-1')
    expect(JSON.stringify(complete.mock.calls[0]![0].body.messages)).not.toContain('expiresAt')
  })

  it.each(['application/json', 'text/event-stream'])('requires a fresh menu lookup and keeps no-tool claims out of dialogue over %s', async (accept) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { content: '推薦韭菜盒、甜不辣。' } }] }))
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json', 'Accept': accept }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const tools = ['menu_get', 'menu_recommend', 'order_add_item'].map(name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } }))
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '還有其他的嗎？', tools, decisionState: { phase: 'ordering', requireMenuRead: true } }) })
    expect(response.status).toBe(200)
    await response.text()
    expect(complete).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.objectContaining({ tool_choice: 'required', tools: tools.slice(0, 2) }) }))
    const transcript = await kioskService.getVisitorSessionForDevice({ deviceId: (await kioskService.resolveDeviceCredential(headers.Cookie.split('=')[1]!))!.id, visitorSessionId: session.id })
    expect(transcript.entries.filter(entry => entry.kind === 'assistant_text').map(entry => entry.content)).not.toContain('推薦韭菜盒、甜不辣。')
  })

  it.each([false, true])('keeps menu-inquiry tools read-only after a lookup (dataOnly=%s) and restores tools for a new request', async (dataOnly) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ id: 'inquiry-menu', type: 'function', function: { name: 'menu_get', arguments: '{"query":"水餃"}' } }] } }] }))
      .mockImplementation(async () => Response.json({ choices: [{ message: { content: '水餃目前可以點。' } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const url = `/api/kiosk/visitor-sessions/${session.id}/messages`
    const tools = ['menu_get', 'order_add_item', 'cart_remove_item'].map(name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } }))
    const initial = await app.request(url, { method: 'POST', headers, body: JSON.stringify({ content: '有水餃嗎？', tools, decisionState: { phase: 'ordering', requireMenuRead: true, readOnly: true } }) })
    expect(initial.status).toBe(200)
    await initial.text()
    expect(complete.mock.calls.at(-1)?.[0].body.tools).toEqual(tools.slice(0, 1))
    const continuation = await app.request(url, { method: 'POST', headers, body: JSON.stringify({ tools, decisionState: { phase: 'ordering', requireMenuRead: true, readOnly: true }, toolResults: [{ toolCallId: 'inquiry-menu', name: 'menu_get', content: JSON.stringify({ dataOnly, items: [{ id: 'dumplings', name: '水餃' }] }) }] }) })
    expect(continuation.status).toBe(200)
    await continuation.text()
    expect(complete.mock.calls.at(-1)?.[0].body.tools).toEqual(tools.slice(0, 1))
    if (dataOnly)
      expect(complete.mock.calls.at(-1)?.[0].body.tool_choice).toBe('required')
    else
      expect(complete.mock.calls.at(-1)?.[0].body).not.toHaveProperty('tool_choice')
    const next = await app.request(url, { method: 'POST', headers, body: JSON.stringify({ content: '我要水餃一份', tools, decisionState: { phase: 'ordering' } }) })
    expect(next.status).toBe(200)
    await next.text()
    expect(complete.mock.calls.at(-1)?.[0].body.tools).toEqual(tools)
  })

  it('preserves browser clarification offers through HTTP validation', async () => {
    const kioskService = createKioskService(db)
    const decide = stagedProvider({ admission: 'SERVICE', purpose: 'UNCERTAIN' })
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, llmGateway, runtimeModelPolicy, systemOne: { isEnabled: async () => true, decide, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), maxActionCandidates: async () => 22 as const } }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', body: JSON.stringify({ registrationCode: '483920' }), headers: { 'Content-Type': 'application/json' } })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '酸辣魚便當', candidates: [], decisionState: { phase: 'ordering', clarificationOffer: { id: 'browser-offer1', label: '泰式酸辣魚便當' }, interactionState: { screen: 'request_confirmation', matchingCartLines: 0 } } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ kind: 'UNAVAILABLE' })
    expect(JSON.parse(decide.mock.calls[1]![0])).toHaveProperty('clarificationOffer', { id: 'browser-offer1', label: '泰式酸辣魚便當' })
  })

  // Report: N05-UX-BACKGROUND-FULFILLMENT final replay — Main guessed an answer after Jev abstained.
  it('qualifies service before exposing answer choices after a finite-answer abstention', async () => {
    const complete = vi.fn(async (_input: { body: Record<string, unknown> }) => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_request', arguments: '{"choice":"BACKGROUND"}' } }] } }] }))
    const decide = stagedProvider({ admission: 'SERVICE', purpose: 'ANSWER', operation: 'HANDOFF' })
    const systemOne = { isEnabled: async () => true, decide, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), maxActionCandidates: async () => 22 as const }
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy, systemOne }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const candidates = [{ id: 'intent:set-fulfillment:dine-in', description: '設為內用', requiresHighConfidence: true }]
    const waitingFor = { questionId: 'fulfillment', purpose: 'fulfillment', question: '內用還是自取？', expiresAt: Date.now() + 30000, choices: candidates }
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '他只要問過他就過去了啊', candidates, decisionState: { phase: 'ordering', waitingFor, intentRecovery: { kind: 'answer', questionId: 'fulfillment', candidateIds: candidates.map(candidate => candidate.id) } } }) })
    expect(response.status).toBe(200)
    const decision = await response.json()
    expect(decision).toMatchObject({ kind: 'IGNORE' })
    expect(decision).not.toHaveProperty('actionId')
    expect(complete).toHaveBeenCalledOnce()
    expect(JSON.stringify(complete.mock.calls[0]![0].body.tools)).toContain('resolve_service_request')
    expect(JSON.stringify(complete.mock.calls[0]![0].body.tools)).not.toContain('resolve_ordering_intent')
  })

  // Report: Nov5 live N05-UX-BACKGROUND-PHONE — Jev proposed skip for a camera comment.
  it.each(['BACKGROUND', 'SKIP_PHONE'] as const)('verifies even a finite phone skip proposal before executing: %s', async (choice) => {
    const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_phone_choice', arguments: JSON.stringify({ choice }) } }] } }] }))
    const systemOne = { isEnabled: async () => true, maxActionCandidates: async () => 22 as const, getPolicy: async () => ({ decisionInstruction: '', storeInstruction: '', defaultDecisionInstruction: '', updatedAt: null }), decide: async (_state: string, questions: Record<string, unknown>) => ({ answers: Object.fromEntries(Object.keys(questions).map(key => [key, { choice: key === 'admission' ? 'SERVICE' : 'SKIP', confidence: 0.99 }])) }) }
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy, systemOne }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: choice === 'BACKGROUND' ? '這好像是新推出的樣品相機' : '略過', candidates: [{ id: 'intent:skip-customer-entry', description: '略過電話', requiresHighConfidence: true }], decisionState: { phase: 'customer_entry' } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ kind: choice === 'BACKGROUND' ? 'IGNORE' : 'FAST_ACTION' })
    expect(complete).toHaveBeenCalledOnce()
  })

  // Report: this chat, Oct 8 — the admin switch promised an assistant handoff.
  it('authenticates live Fast Path status and bypasses decisions while disabled without changing the session', async () => {
    const kioskService = createKioskService(db)
    let enabled = false
    const decide = vi.fn(async () => ({ answers: { route: { choice: 'IGNORE' } } }))
    const getPolicy = vi.fn(async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }))
    const systemOne = { isEnabled: async () => enabled, decide, getPolicy, maxActionCandidates: async () => 22 as const }
    const app = new Hono<HonoEnv>().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'unexpected' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, kioskService, llmGateway, runtimeModelPolicy, secureCookies: false, systemOne }))
    expect((await app.request('/api/kiosk/interaction-decisions/status')).status).toBe(401)
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', body: JSON.stringify({ registrationCode: '483920' }), headers: { 'Content-Type': 'application/json' } })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    await app.request(`/api/kiosk/visitor-sessions/${session.id}/entries`, { method: 'POST', headers, body: JSON.stringify({ kind: 'assistant_text', content: '請問幾位？' }) })
    const status = await app.request('/api/kiosk/interaction-decisions/status', { headers })
    expect(status.headers.get('Cache-Control')).toBe('no-store')
    expect(await status.json()).toEqual({ enabled: false })
    const body = JSON.stringify({ segmented: true, transcript: '一位', candidates: [], visitorSessionId: session.id })
    const disabled = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body })
    expect(await disabled.json()).toEqual({ kind: 'NEEDS_ASSISTANT', reason: 'SYSTEM_ONE_DISABLED' })
    expect(decide).not.toHaveBeenCalled()
    expect(getPolicy).not.toHaveBeenCalled()
    const retained = await app.request(`/api/kiosk/visitor-sessions/${session.id}/history`, { headers })
    expect(await retained.json()).toMatchObject({ entries: [{ content: '請問幾位？' }] })
    enabled = true
    expect(await (await app.request('/api/kiosk/interaction-decisions/status', { headers })).json()).toEqual({ enabled: true })
    await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body })
    expect(decide).toHaveBeenCalledOnce()
  })

  it('reports no configured System One as disabled rather than a broken semantic decision', async () => {
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, kioskService: createKioskService(db), llmGateway, runtimeModelPolicy, secureCookies: false }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', body: JSON.stringify({ registrationCode: '483920' }), headers: { 'Content-Type': 'application/json' } })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    expect(await (await app.request('/api/kiosk/interaction-decisions/status', { headers })).json()).toEqual({ enabled: false })
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '有水餃嗎', candidates: [] }) })
    expect(await response.json()).toEqual({ kind: 'NEEDS_ASSISTANT', reason: 'SYSTEM_ONE_DISABLED' })
  })

  // Report: this chat, 2026-11-02; phone entry「關閉」became a generic acknowledgement.
  it('resolves the phone effect after recovery first admits 關閉 as a service request', async () => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async ({ body }) => {
      const tools = body.tools as Array<{ function: { name: string } }>
      const name = tools[0]!.function.name
      const args = name === 'resolve_phone_choice' ? { choice: 'SKIP_PHONE' } : JSON.stringify(body.tools).includes('"admission"') ? { recipient: 'kiosk', admission: 'service', disposition: 'assistant' } : { choice: 'UNCERTAIN' }
      return Response.json({ choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }] })
    })
    const systemOne = { isEnabled: async () => true, maxActionCandidates: async () => 22 as const, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), decide: stagedProvider({ admission: 'UNCERTAIN' }) }
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy, systemOne }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '關閉', includeTrace: true, candidates: [{ id: 'intent:skip-customer-entry', description: '略過自願電話登記', requiresHighConfidence: true }], decisionState: { phase: 'customer_entry', waitingFor: { questionId: 'phone-close', purpose: 'customer-entry', question: '手機可以選填，或關閉登記直接點餐。', expiresAt: Date.now() + 30_000, choices: [{ id: 'intent:skip-customer-entry', description: '關閉自願電話登記' }] } } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:skip-customer-entry', answeredQuestionId: 'phone-close', recovery: { admission: 'service' }, trace: { phoneResolution: { choice: 'SKIP_PHONE' } } })
    expect(complete).toHaveBeenCalledTimes(3)
  })

  // Report: this chat, 2026-10-20; REQUEST0.7406 / SKIP0.4977.
  it.each([
    { choice: 'SKIP_PHONE', segmented: false, uncertainService: false },
    { choice: 'SKIP_PHONE', segmented: true, uncertainService: false },
    { choice: 'KEEP_PHONE', segmented: false, uncertainService: false },
    { choice: 'UNCERTAIN', segmented: false, uncertainService: false },
    // Report: attachment e2821679, 2026-10-21; REQUEST0.7406/SKIP0.5227/BACKGROUND0.3255.
    { choice: 'SKIP_PHONE', segmented: false, uncertainService: true },
    { choice: 'SKIP_PHONE', segmented: true, uncertainService: true },
    { choice: 'KEEP_PHONE', segmented: false, uncertainService: true },
    { choice: 'UNCERTAIN', segmented: false, uncertainService: true },
  ])('resolves a weak phone skip with Main without exposing browser tools: $choice/segmented=$segmented/uncertainService=$uncertainService', async ({ choice, segmented, uncertainService }) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async ({ body }) => {
      const tools = body.tools as Array<{ function: { name: string } }>
      if (tools[0]?.function.name === 'resolve_phone_choice')
        return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_phone_choice', arguments: JSON.stringify({ choice }) } }] } }] })
      const reviewing = JSON.stringify(body.tools).includes('"admission"')
      return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_request', arguments: JSON.stringify(reviewing ? { recipient: 'uncertain', admission: 'uncertain', disposition: 'abstain' } : { choice: 'UNCERTAIN' }) } }] } }] })
    })
    const systemOne = { isEnabled: async () => true, maxActionCandidates: async () => 22 as const, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), decide: async (_state: string, questions: Record<string, unknown>) => ({ answers: Object.fromEntries(Object.keys(questions).map(key => [key, { choice: ({ admission: 'SERVICE', phone: 'SKIP' } as Record<string, string>)[key], confidence: key === 'phone' ? (uncertainService ? 0.3255 : 0.4977) : 0.95 }])) }) }
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy, systemOne }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '略過', segmented, includeTrace: true, candidates: [{ id: 'intent:skip-customer-entry', description: '略過電話', requiresHighConfidence: true }], decisionState: { phase: 'customer_entry' } }) })
    expect(response.status).toBe(200)
    let payload = await response.json()
    for (let step = 0; step < 6; step++) {
      if (!payload || typeof payload !== 'object' || !('kind' in payload) || payload.kind !== 'DECISION_PROGRESS' || !('continuationId' in payload))
        break
      const next = await app.request(`/api/kiosk/interaction-decisions/${String(payload.continuationId)}`, { method: 'POST', headers, body: '{}' })
      expect(next.status).toBe(200)
      payload = await next.json()
    }
    expect(payload).toHaveProperty('trace.phoneResolution.choice', choice)
    if (choice === 'SKIP_PHONE') {
      expect(payload).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:skip-customer-entry' })
      expect(payload).not.toHaveProperty('confidence')
    }
    else {
      expect(payload).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
      expect(payload).not.toHaveProperty('actionId')
    }
    expect(payload).toMatchObject({ modelCalls: 2, modelQuestions: 2 })
    expect(complete).toHaveBeenCalledOnce()
    expect(complete.mock.calls[0]![0].body).toHaveProperty('tools', [expect.objectContaining({ function: expect.objectContaining({ name: 'resolve_phone_choice' }) })])
    expect(JSON.stringify(complete.mock.calls[0]![0].body)).not.toContain('0.4977')
  })

  it.each([
    { scope: 'REQUEST', confidence: 0.3, relevanceConfidence: 0.95, kind: 'UNAVAILABLE' },
    { scope: 'BACKGROUND', confidence: 0.95, relevanceConfidence: 0.95, kind: 'IGNORE' },
    { scope: 'REQUEST', confidence: 0.7406, relevanceConfidence: 0.95, kind: 'IGNORE' },
  ])('does not resolve phone choice for rejected speech: $scope/$confidence/$relevanceConfidence', async ({ scope, confidence, relevanceConfidence, kind }) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>()
    const systemOne = { isEnabled: async () => true, maxActionCandidates: async () => 22 as const, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), decide: stagedProvider({ admission: scope === 'REQUEST' && confidence >= 0.6 ? 'BACKGROUND' : scope === 'REQUEST' ? 'SERVICE' : scope }, scope === 'REQUEST' && confidence >= 0.6 ? relevanceConfidence : confidence) }
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy, systemOne }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '小王，略過', includeTrace: true, candidates: [{ id: 'intent:skip-customer-entry', description: '略過電話' }], decisionState: { phase: 'customer_entry' } }) })
    const decision = await response.json()
    expect(decision).toMatchObject({ kind })
    expect(decision).not.toHaveProperty('actionId')
    expect(decision).not.toHaveProperty('trace.phoneResolution')
    if (confidence < 0.6) {
      expect(complete).toHaveBeenCalledOnce()
      // Uncertain admission may use service recovery, never the phone effect resolver.
      for (const [request] of complete.mock.calls)
        expect(JSON.stringify(request.body.tools)).not.toContain('resolve_phone_choice')
    }
    else {
      expect(complete).not.toHaveBeenCalled()
    }
  })

  it('accepts the optional phone-entry screen and forwards its skip candidate to Jev', async () => {
    const decide = stagedProvider({ admission: 'SERVICE', phone: 'SKIP' })
    const systemOne = { isEnabled: async () => true, decide, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), maxActionCandidates: async () => 22 as const }
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, kioskService: createKioskService(db), llmGateway: { complete: async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_phone_choice', arguments: '{"choice":"SKIP_PHONE"}' } }] } }] }) }, runtimeModelPolicy, secureCookies: false, systemOne }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', body: JSON.stringify({ registrationCode: '483920' }), headers: { 'Content-Type': 'application/json' } })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '略過電話', candidates: [{ id: 'intent:skip-customer-entry', description: '略過自願電話登記，進入菜單。', requiresHighConfidence: true }], decisionState: { phase: 'customer_entry', interactionState: { screen: 'customer_entry', matchingCartLines: 0 } } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:skip-customer-entry' })
    expect(JSON.parse(decide.mock.calls[0]![0])).toMatchObject({ customerUtterance: '略過電話', phase: 'customer_entry' })
    expect(decide).toHaveBeenCalledTimes(2)
  })

  it('carries bounded price evidence through the authenticated HTTP schema and returns its choice ID', async () => {
    const kioskService = createKioskService(db)
    const decide = stagedProvider({ admission: 'SERVICE', purpose: 'QUERY' })
    const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_price_choice', arguments: '{"choice":"UPPER_INCLUSIVE"}' } }] } }] }))
    const app = new Hono<HonoEnv>().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'unexpected' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, kioskService, llmGateway: { complete }, runtimeModelPolicy, secureCookies: false, systemOne: { isEnabled: async () => true, decide, getPolicy: async () => ({ decisionInstruction: '已儲存提示', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), maxActionCandidates: async () => 22 as const } }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', body: JSON.stringify({ registrationCode: '483920' }), headers: { 'Content-Type': 'application/json' } })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '100元以下的便當', candidates: [{ id: 'intent:search-menu', description: '查詢' }], decisionState: { phase: 'ordering', constraints: { exclude: [], unresolvedPrice: true }, priceEvidence: { amounts: [{ text: '100元', amount: 100 }], choices: [{ id: 'UPPER_INCLUSIVE', kind: 'condition', conditions: { maxPrice: 100 }, description: '單份不超過100' }, { id: 'NONE', kind: 'none', description: '無價格需求' }, { id: 'UNSUPPORTED', kind: 'unsupported', description: '需要釐清' }] } } }) })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER', priceChoiceId: 'UPPER_INCLUSIVE' })
    expect(decide.mock.calls[0]?.[0]).toContain('100元')
    expect(decide.mock.calls[0]?.[1]).toHaveProperty('admission')
    expect(decide.mock.calls[1]?.[1]).toHaveProperty('purpose')
    expect(complete).toHaveBeenCalledOnce()
  })

  it('saves failed decision diagnostics without promoting them into completed dialogue', async () => {
    const kioskService = createKioskService(db)
    const app = new Hono<HonoEnv>().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'unexpected' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, kioskService, llmGateway, runtimeModelPolicy, secureCookies: false }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', body: JSON.stringify({ registrationCode: '483920' }), headers: { 'Content-Type': 'application/json' } })
    const cookie = enrolled.headers.get('Set-Cookie')!.split(';')[0]!
    await useBackgroundEnforcement(db, cookie)
    const headers = { 'Cookie': cookie, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    for (const decisionRoute of ['fast_path', 'execution_failed', 'unavailable']) {
      const metadata = { decisionRoute, utteranceId: 6, source: 'asr', questionId: 'checkout-question' }
      const saved = await app.request(`/api/kiosk/visitor-sessions/${session.id}/entries`, { method: 'POST', headers, body: JSON.stringify({ kind: 'asr_transcript', content: '好', metadata }) })
      expect(saved.status).toBe(201)
      await expect(saved.json()).resolves.toMatchObject({ entry: { metadata } })
    }
  })

  it('exposes one-use decision stages through authenticated API requests without accepting client answers', async () => {
    const kioskService = createKioskService(db)
    const decide = stagedProvider({ admission: 'SERVICE', purpose: 'SINGLE', family: 'MENU', operation: 'intent:search-menu' })
    const scopedGateway = { complete: vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"recipient":"kiosk","choice":"MENU_INFORMATION_ONLY"}' } }] } }] })) }
    const app = new Hono<HonoEnv>().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'unexpected' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, kioskService, llmGateway: scopedGateway, runtimeModelPolicy, secureCookies: false, systemOne: { isEnabled: async () => true, decide, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), maxActionCandidates: async () => 22 as const } }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', body: JSON.stringify({ registrationCode: '483920' }), headers: { 'Content-Type': 'application/json' } })
    const cookie = enrolled.headers.get('Set-Cookie')!.split(';')[0]!
    await useBackgroundEnforcement(db, cookie)
    const headers = { 'Cookie': cookie, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const first = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ segmented: true, includeTrace: true, transcript: '有賣什麼', candidates: [{ id: 'intent:search-menu', description: '查菜單' }], decisionState: { phase: 'ordering' } }) })
    expect(first.status).toBe(200)
    let body = await first.json() as { kind: string, continuationId?: string, actionId?: string }
    expect(body.kind).toBe('DECISION_PROGRESS')
    expect(body).toHaveProperty('question', 'admission')
    expect(decide).toHaveBeenCalledTimes(1)
    const id = body.continuationId!
    expect((await app.request(`/api/kiosk/interaction-decisions/${id}`, { method: 'POST', body: '{}' })).status).toBe(401)
    while (body.kind === 'DECISION_PROGRESS') {
      const next = await app.request(`/api/kiosk/interaction-decisions/${body.continuationId}`, { method: 'POST', headers, body: '{}' })
      expect(next.status).toBe(200)
      body = await next.json() as typeof body
    }
    expect(body.actionId).toBe('intent:search-menu')
    expect((await app.request(`/api/kiosk/interaction-decisions/${id}`, { method: 'POST', headers, body: '{}' })).status).toBe(400)
    expect(decide.mock.calls.map(([, questions]) => Object.keys(questions))).toEqual([
      ['admission'],
      ['purpose'],
      ['family'],
      ['operation'],
    ])
  })

  it('requires device and PIN identities, returns effective bootstrap values, and rejects stale or forged local writes', async () => {
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
      .route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, kioskService, llmGateway, runtimeModelPolicy, secureCookies: false, localAdmin: { pin: '4812', secret: 'test-server-secret' } }))
    const enrollment = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = enrollment.headers.get('Set-Cookie')!.split(';')[0]
    await useBackgroundEnforcement(db, cookie)
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1])
    await kioskService.updateDeviceSettings({ deviceId: device!.id, siteId: device!.siteId, userId: 'settings-admin', source: 'admin', body: {
      version: 1,
      overrides: {},
    } })
    const body = JSON.stringify({ version: 2, overrides: { observationEnabled: true } })
    expect((await app.request('/api/kiosk/settings', { method: 'PUT', headers: { Cookie: cookie }, body })).status).toBe(401)
    expect((await app.request('/api/kiosk/settings', { method: 'PUT', headers: { 'X-Test-Operator': 'yes' }, body })).status).toBe(401)
    expect((await app.request('/api/kiosk/settings', { method: 'PUT', headers: { 'Cookie': cookie, 'X-Test-Operator': 'yes' }, body })).status).toBe(401)
    const login = await app.request('/api/kiosk/admin/session', { method: 'POST', headers: { 'Cookie': cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '4812' }) })
    expect(login.status).toBe(200)
    const grant = login.headers.get('Set-Cookie')!.split(';')[0]
    const headers = { 'Cookie': `${cookie}; ${grant}`, 'X-Test-Operator': 'yes', 'Content-Type': 'application/json' }
    expect((await app.request('/api/kiosk/settings', { method: 'PUT', headers, body: JSON.stringify({ version: 2, overrides: { unknownSetting: true } }) })).status).toBe(400)
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
    await useBackgroundEnforcement(db, cookie)
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

  it('does not expose the removed embedding turn-decision endpoint', async () => {
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService: createKioskService(db),
      llmGateway,
      runtimeModelPolicy,
      secureCookies: false,
    }))

    const response = await app.request('/api/kiosk/turn-decisions', { method: 'POST' })

    expect(response.status).toBe(404)
  })

  it('uses the active System One service for finite interaction decisions and never calls the chat gateway', async () => {
    const kioskService = createKioskService(db)
    const decide = stagedProvider({ admission: 'SERVICE', requestRelation: 'NEW_REQUEST', purpose: 'SINGLE', family: 'ITEM', operation: 'intent:add-item', operationRequest: 'OPERATION', operationCoverage: 'SINGLE' }, 0.91)
    const complete = vi.fn(async () => Response.json({ choices: [] }))
    const systemOne: NonNullable<KioskRoutesOptions['systemOne']> = {
      isEnabled: async () => true,
      decide,
      getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: 'default', storeInstruction: '', updatedAt: null }),
      maxActionCandidates: async () => 253,
    }
    const app = new Hono().route('/api/kiosk', createKioskRoutes({
      developmentRegistrationEnabled: true,
      kioskService,
      llmGateway: { complete },
      runtimeModelPolicy,
      secureCookies: false,
      systemOne,
    }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
    await useBackgroundEnforcement(db, cookie)
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1]!)
    const profile = await kioskService.getDeviceProfile(device!.id)
    const session = await kioskService.startVisitorSession({ deviceId: device!.id, profileReleaseId: profile!.id, serviceId: profile!.snapshot.interactiveService.id })
    await kioskService.appendInteractionEntry({ visitorSessionId: session.id, kind: 'assistant_text', content: '推薦蝦捲，要一份嗎？' })

    const response = await app.request('/api/kiosk/interaction-decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({
        visitorSessionId: session.id,
        candidates: [{ description: '新增餐點。', id: 'intent:add-item', requiresHighConfidence: true }],
        decisionState: { catalogEvidence: { products: [{ label: '蝦捲', matchedText: '蝦捲', source: 'name', itemId: 'must-not-reach-jev' }], categories: [] }, fulfillmentModes: [{ id: 'takeout', label: '櫃台自取' }], activeRequest: { stage: 'thinking', text: '我要一份蝦捲' }, allowedPaymentMethods: [], constraints: { exclude: [] }, interactionState: { matchingCartLines: 0, screen: 'cart_review', seating: { partySize: 5, ready: false, question: '是否同意分桌？', tableHoldId: 'must-not-reach-jev' } }, paymentState: 'idle', phase: 'ordering', references: [{ label: '蝦捲', refId: 'item:shrimp' }] },
        includeTrace: true,
        presenceState: 'ENGAGED',
        transcript: '我要一份蝦捲',
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ actionId: 'intent:add-item', confidence: 0.91, kind: 'FAST_ACTION', trace: { decisionState: expect.stringContaining('"phase":"ordering"') } })
    expect(decide).toHaveBeenCalledTimes(7)
    expect(decide).toHaveBeenCalledWith(expect.stringContaining('"screen":"cart_review"'), expect.any(Object))
    expect(decide).toHaveBeenCalledWith(expect.stringContaining('"matchedText":"蝦捲","source":"name"'), expect.any(Object))
    expect(decide).toHaveBeenCalledWith(expect.stringContaining('"fulfillmentModes":[{"id":"takeout","label":"櫃台自取"}]'), expect.any(Object))
    expect(decide).toHaveBeenCalledWith(expect.stringContaining('"activeRequest":{"stage":"thinking","text":"我要一份蝦捲"}'), expect.any(Object))
    expect(complete).not.toHaveBeenCalled()
    expect(decide).toHaveBeenCalledWith(expect.stringContaining('"role":"assistant"'), expect.any(Object))
    expect(decide).toHaveBeenCalledWith(expect.stringContaining('"seating":{"partySize":5,"ready":false,"question":"是否同意分桌？"}'), expect.any(Object))
    expect(JSON.stringify(decide.mock.calls)).not.toContain('must-not-reach-jev')
    expect(decide).toHaveBeenCalledWith(expect.stringContaining('推薦蝦捲，要一份嗎？'), expect.any(Object))
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
    await useBackgroundEnforcement(db, cookie)
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

  it('generates an entry welcome with the selected VLM and optional-phone context', async () => {
    const complete = vi.fn(async () => Response.json({ choices: [{ message: { content: '歡迎光臨！手機可以選填或略過。' } }] }))
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, kioskService, llmGateway: { complete }, runtimeModelPolicy, secureCookies: false }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const cookie = enrolled.headers.get('Set-Cookie')!.split(';')[0]!
    await useBackgroundEnforcement(db, cookie)
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1]!)
    await db.update(schema.kioskDevices).set({ settings: { ...defaultDeviceSettings, overrides: { observationEnabled: true, greetingEnabled: true, proactiveVlmEnabled: true } } }).where(eq(schema.kioskDevices.id, device!.id))
    const headers = { 'Cookie': cookie, 'Content-Type': 'application/json' }
    await useBackgroundEnforcement(db, headers.Cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/assistant-actions`, { method: 'POST', headers, body: JSON.stringify({ frame: 'data:image/jpeg;base64,ZmFrZQ==', kind: 'greeting', phase: 'customer_entry', invitationAllowed: false }) })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ answer: '歡迎光臨！手機可以選填或略過。' })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      modelName: 'test-vlm',
      body: expect.objectContaining({ messages: expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: expect.stringContaining('目前是自願電話登記頁') }),
        expect.objectContaining({ role: 'user', content: expect.arrayContaining([expect.objectContaining({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,ZmFrZQ==' } })]) }),
      ]) }),
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
    await useBackgroundEnforcement(db, cookie)
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
      body: JSON.stringify({ frame: 'data:image/jpeg;base64,ZmFrZQ==', kind: 'greeting', invitationAllowed: true }),
    })

    expect(greeting.status).toBe(200)
    const presented = await greeting.json() as { answer: string, pendingCustomerChoice: { questionId: string, purpose: string, question: string, choices: Array<{ id: string }> } }
    expect(presented.pendingCustomerChoice.purpose).toBe('recommendation-invitation')
    expect(presented.answer).toContain(presented.pendingCustomerChoice.question)
    expect(presented.answer).toBe('您好，歡迎光臨。 需要我推薦幾樣餐點嗎？')
    expect(presented.pendingCustomerChoice.choices.map(choice => choice.id)).toEqual(['intent:recommend', 'DECLINE_INVITATION'])
    const saved = await kioskService.getVisitorSessionForDevice({ deviceId: device!.id, visitorSessionId: session.id })
    expect(saved.entries.at(-1)?.metadata).toMatchObject({ questionId: presented.pendingCustomerChoice.questionId })
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
    await useBackgroundEnforcement(db, cookie)
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
    expect(messages[0]).toMatchObject({ content: expect.stringContaining('【服務資訊與即時操作分界】') })
    expect(messages[0]).toMatchObject({ content: expect.stringContaining('沒有提供的資訊明確說明無法確認') })
    expect(messages[0]).toMatchObject({ content: expect.stringContaining('即時訂單狀態以最新工具回傳為準') })
    expect(messages[0]).toMatchObject({ content: expect.stringContaining('不得使用「目前沒有」、「暫時不支援」、「還沒有」') })
    expect(messages[0]).toMatchObject({ content: expect.stringContaining('不需要針對不同領域建立個別拒絕規則') })
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
    await useBackgroundEnforcement(db, cookie)
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
      body: JSON.stringify({ environment: 'test', id: 'demo-order-1', fulfillmentMode: 'takeout', itemCount: 2, pickupNumber: '368', status: 'accepted', total: 180 }),
    })
    expect(orderResult.status).toBe(201)
    await expect(orderResult.json()).resolves.toEqual({
      entry: expect.objectContaining({
        content: JSON.stringify({ environment: 'test', fulfillmentMode: 'takeout', id: 'demo-order-1', itemCount: 2, pickupNumber: '368', status: 'accepted', total: 180 }),
        kind: 'order_result',
        sequence: 5,
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
      entry: expect.objectContaining({ content: '我要一份牛肉麵。', sequence: 6 }),
    })

    const tableResult = { environment: 'test', id: 'table-order-1', fulfillmentMode: 'dine-in', itemCount: 1, status: 'accepted', total: 80, serviceMode: 'table-service', table: { id: 'a03', label: 'a03' }, lines: [{ name: '水餃', quantity: 1, total: 80 }] }
    const tableArchived = await app.request(`/api/kiosk/visitor-sessions/${session.id}/order-results`, { method: 'POST', headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]), body: JSON.stringify(tableResult) })
    expect(tableArchived.status).toBe(201)
    const archived = await tableArchived.json() as { entry: { content: string } }
    expect(JSON.parse(archived.entry.content)).toMatchObject(tableResult)
    expect(JSON.parse(archived.entry.content)).not.toHaveProperty('pickupNumber')

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
    await useBackgroundEnforcement(db, cookie)
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
    await useBackgroundEnforcement(db, cookie)
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
    await useBackgroundEnforcement(db, cookie)
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

  it('retains every tool exchange of the current request and drops them when a new customer request begins', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce(Response.json({
        choices: [{ message: {
          content: null,
          tool_calls: [{ id: 'call_menu', type: 'function', function: { name: 'menu_get', arguments: '{"query":"牛肉麵"}' } }],
        } }],
      }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: {
        content: null,
        tool_calls: [{ id: 'call_cart', type: 'function', function: { name: 'cart_get', arguments: '{"display":false}' } }],
      } }] }))
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
    await useBackgroundEnforcement(db, cookie)
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
    await expect(completedReply.json()).resolves.toEqual({ agentInteraction: { mode: 'active' }, answer: undefined, toolCalls: expect.any(Array) })
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

    const cartReply = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, {
      method: 'POST',
      headers: new Headers([['Cookie', cookie], ['Content-Type', 'application/json']]),
      body: JSON.stringify({ tools, toolResults: [{ toolCallId: 'call_cart', name: 'cart_get', content: JSON.stringify({ cart: { lines: [], itemCount: 0, total: 0 } }) }] }),
    })
    await expect(cartReply.json()).resolves.toEqual({ agentInteraction: { mode: 'active' }, answer: '牛肉麵目前可以點餐。', toolCalls: [] })
    const continuationMessages = complete.mock.calls.at(-1)?.[0].body.messages as Array<{ content?: string, role: string, tool_call_id?: string, tool_calls?: Array<{ id: string }> }>
    expect(continuationMessages.filter(message => message.role === 'tool').map(message => message.tool_call_id)).toEqual(['call_menu', 'call_cart'])
    expect(continuationMessages.filter(message => message.tool_calls).flatMap(message => message.tool_calls!.map(call => call.id))).toEqual(['call_menu', 'call_cart'])

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

  // Report: this chat, 2026-10-14 — successful greetings were hidden whenever menu tools were offered.
  it.each([undefined, { phase: 'ordering' as const }])('keeps streamed prose as a draft until the host validates it: %j', async (decisionState) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { content: '您好！需要什麼協助？' } }] }))
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
    await useBackgroundEnforcement(db, cookie)
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1])
    const started = await app.request('/api/kiosk/visitor-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ serviceId: 'development-ordering-service' }),
    })
    const { session } = await started.json() as { session: { id: string } }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { 'Accept': 'text/event-stream', 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ content: '嗨', decisionState, tools: [{ type: 'function', function: { name: 'menu_get', parameters: { type: 'object', properties: {} } } }] }),
    })
    const events = await response.text()
    expect(events).toContain('您好！需要什麼協助？')
    expect(events).toContain('"type":"turn-finished"')
    const transcript = await kioskService.getVisitorSessionForDevice({ deviceId: device!.id, visitorSessionId: session.id })
    expect(transcript.entries.filter(entry => entry.kind === 'assistant_text')).toEqual([])
    expect(transcript.entries.some(entry => entry.kind === 'service_event' && entry.content === '您好！需要什麼協助？')).toBe(true)
    expect(complete.mock.calls[0]?.[0].body.messages).toContainEqual({ role: 'user', content: '嗨' })
  })

  it.each([['timeout', 504], ['provider-error', 503]] as const)('preserves successful tool receipts and reports %s when the model continuation fails', async (reason, statusCode) => {
    const complete = vi.fn()
      .mockResolvedValueOnce(Response.json({
        choices: [{ message: {
          content: null,
          tool_calls: [{ id: 'call_menu', type: 'function', function: { name: 'menu_get', arguments: '{"query":"牛肉麵"}' } }],
        } }],
      }))
      .mockRejectedValueOnce(new ApiError(statusCode, 'TEST_MODEL_FAILURE', 'model failure'))
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
    await useBackgroundEnforcement(db, cookie)
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

    const failedEvents = await failedReply.text()
    expect(failedEvents).toContain('"type":"turn-failed"')
    expect(failedEvents).toContain(`"reason":"${reason}"`)
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
    await useBackgroundEnforcement(db, cookie)
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
        expect.objectContaining({ content: '牛肉麵可以點餐。', kind: 'service_event' }),
        expect.objectContaining({ kind: 'tool_call' }),
      ]),
    })
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ stream: true }) }))
  })

  it('retains fast-path history while isolating a checkout follow-up from previous ordering dialogue', async () => {
    let modelMessages: Array<{ content: string, role: string }> = []
    const complete = vi.fn(async (request: Parameters<KioskRoutesOptions['llmGateway']['complete']>[0]) => {
      modelMessages = request.body.messages as Array<{ content: string, role: string }>
      return Response.json({ choices: [{ message: { content: '我會確認剛才那份水餃。' } }] })
    })
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
    await useBackgroundEnforcement(db, cookie)
    const started = await app.request('/api/kiosk/visitor-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ serviceId: 'development-ordering-service' }),
    })
    const { session } = await started.json() as { session: { id: string } }
    const lifecycle = await app.request(`/api/kiosk/visitor-sessions/${session.id}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ content: 'proactive_greeting', kind: 'service_event' }),
    })
    expect(lifecycle.status).toBe(201)
    for (const entry of [
      { content: '我要一份水餃', kind: 'asr_transcript', metadata: { decisionRoute: 'fast_path' } },
      { content: '已加入一份水餃。', kind: 'assistant_text', metadata: { decisionRoute: 'fast_path' } },
    ]) {
      const saved = await app.request(`/api/kiosk/visitor-sessions/${session.id}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
        body: JSON.stringify(entry),
      })
      expect(saved.status).toBe(201)
    }

    const history = await app.request(`/api/kiosk/visitor-sessions/${session.id}/history`, {
      headers: { Cookie: cookie },
    })
    expect(history.status).toBe(200)
    await expect(history.json()).resolves.toMatchObject({
      entries: [
        { content: '我要一份水餃', index: 0, role: 'user' },
        { content: '已加入一份水餃。', index: 1, role: 'assistant' },
      ],
    })

    await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ content: '再一份', decisionState: { fulfillmentModes: [{ id: 'takeout', label: '櫃台自取' }], phase: 'checkout_payment_select', paymentState: 'idle', allowedPaymentMethods: ['card', 'mobile'] } }),
    })

    expect(modelMessages[0]?.content).toContain('目前 Kiosk 畫面：checkout_payment_select')
    expect(modelMessages[0]?.content).toContain('目前可選付款方式：card、mobile')
    expect(modelMessages[0]?.content).toContain('"label":"櫃台自取"')
    // Checkout reads the structured browser state and this utterance; the
    // earlier ordering exchange remains available through the history endpoint.
    expect(modelMessages.filter(message => message.role !== 'system')).toEqual([
      { content: '再一份', role: 'user' },
    ])
    for (let index = 0; index < 18; index++) {
      const saved = await app.request(`/api/kiosk/visitor-sessions/${session.id}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
        body: JSON.stringify({ content: `後續對話 ${index}`, kind: 'assistant_text' }),
      })
      expect(saved.status).toBe(201)
    }
    const recentHistory = await app.request(`/api/kiosk/visitor-sessions/${session.id}/history`, { headers: { Cookie: cookie } })
    const recentPage = await recentHistory.json() as { entries: Array<{ content: string }>, nextBefore: number }
    expect(recentPage.entries).toHaveLength(16)
    expect(recentPage.nextBefore).toBeGreaterThan(0)
    const olderHistory = await app.request(`/api/kiosk/visitor-sessions/${session.id}/history?before=${recentPage.nextBefore}`, { headers: { Cookie: cookie } })
    const olderPage = await olderHistory.json() as { entries: Array<{ content: string }> }
    expect(olderPage.entries[0]).toMatchObject({ content: '我要一份水餃' })
  })

  // Report: this chat, 2026-10-14 — accepted receipts must survive manual takeover.
  it.each([{ decisionRoute: 'fast_path' }, { source: 'manual_control' }])('keeps a browser cart receipt as the Agent working snapshot: %j', async (origin) => {
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, kioskService, llmGateway, runtimeModelPolicy, secureCookies: false }))
    const registration = await app.request('/api/kiosk/development/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: '483920' }),
    })
    const cookie = registration.headers.get('Set-Cookie')!.split(';')[0]
    await useBackgroundEnforcement(db, cookie)
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1])
    const started = await app.request('/api/kiosk/visitor-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ serviceId: 'development-ordering-service' }),
    })
    const { session } = await started.json() as { session: { id: string } }
    const cart = { fulfillmentMode: undefined, itemCount: 1, lines: [{ id: 'L1', itemId: 'dumplings', name: '水餃', options: {}, quantity: 1, unitPrice: 75 }], total: 75 }
    const saved = await app.request(`/api/kiosk/visitor-sessions/${session.id}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ content: JSON.stringify({ cart, line: cart.lines[0] }), kind: 'tool_result', metadata: { ...origin, name: 'order_add_item' } }),
    })

    expect(saved.status).toBe(201)
    const menuSaved = await app.request(`/api/kiosk/visitor-sessions/${session.id}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ content: JSON.stringify({ items: [{ id: 'dumplings', name: '水餃' }], presentation: { itemIds: ['dumplings'] } }), kind: 'tool_result', metadata: { ...origin, name: 'menu_get' } }),
    })
    expect(menuSaved.status).toBe(201)
    const transcript = await kioskService.getVisitorSessionForDevice({ deviceId: device!.id, visitorSessionId: session.id })
    expect(transcript.session.agentInteraction.cartSummary).toMatchObject({ itemCount: 1, lines: [expect.objectContaining({ lineId: 'L1', itemId: 'dumplings' })] })
    expect(transcript.session.agentInteraction.recentMenuSubjects).toContainEqual({ id: 'dumplings', name: '水餃' })
  })
})
