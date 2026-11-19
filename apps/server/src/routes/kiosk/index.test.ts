import type { ConversationContext } from '@proj-airi/stage-shared/kiosk-conversation'

import type { KioskRoutesOptions } from '.'
import type { Database } from '../../libs/db'
import type { KioskProfileSnapshot } from '../../schemas/kiosk'
import type { HonoEnv } from '../../types/hono'

import { defaultDeviceSettings } from '@proj-airi/kiosk-proactive'
import { orderingTools } from '@proj-airi/stage-shared/ordering-tools'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKioskRoutes, kioskDeviceCookieName } from '.'
import { mockDB } from '../../libs/mock-db'
import { createKioskService } from '../../services/domain/kiosk'
import { replyTool } from '../../services/domain/kiosk-agent-interaction/conversationContext'
import { buildResponsesRequest, translateResponsesResponse } from '../../services/domain/llm-router/responses'
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

describe('kiosk routes', () => {
  let db: Database

  it.each([0, 60_001, -1, 1.5])('rejects invalid conversation model budgets %s before calling Main', async (budgetMs) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>()
    const app = new Hono<HonoEnv>().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'unexpected' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '您好', budgetMs }) })
    expect(response.status).toBe(400)
    expect(complete).not.toHaveBeenCalled()
  })

  // Report: this chat, Nov15 — text arriving before a native failure must not turn it into success.
  it.each(['failed', 'incomplete', 'truncated', 'json-incomplete'])('rejects a native %s reply without dispatching a tool', async (failure) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => {
      const response = { id: 'native-failed', status: failure === 'failed' ? 'failed' : 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'function_call', call_id: 'partial', name: 'find_menu_item', arguments: '{' }] }
      if (failure === 'json-incomplete')
        return await translateResponsesResponse(Response.json(response), false)
      const events = [{ type: 'response.output_text.delta', delta: '尚未核實的草稿' }, ...(failure === 'truncated' ? [] : [{ type: `response.${failure}`, response }])]
      return await translateResponsesResponse(new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } }), true)
    })
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json', 'Accept': 'text/event-stream' }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const reply = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '請找餐點' }) })
    const body = await reply.text()
    expect(body).toContain('turn-failed')
    expect(body).not.toContain('turn-finished')
    expect(body).not.toContain('tool-requested')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  // Report: this chat, Nov15 — native reasoning/function items must survive the actual tool continuation.
  it.each(['json', 'sse'])('retains native Responses output on the matching tool batch only (%s)', async (transport) => {
    const call = { id: 'native-call', type: 'function', function: { name: 'find_menu_item', arguments: '{}' } }
    const nativeOutput = [
      { id: 'reason-1', type: 'reasoning', encrypted_content: 'opaque-test-reasoning', summary: [] },
      { id: 'item-1', type: 'function_call', call_id: call.id, name: call.function.name, arguments: '{}' },
    ]
    const nativeRequests: Record<string, unknown>[] = []
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async ({ body }) => {
      nativeRequests.push(buildResponsesRequest(body, 'native-test'))
      const output = nativeRequests.length === 1 ? nativeOutput : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '查詢完成。' }] }]
      const response = { id: `response-${nativeRequests.length}`, status: 'completed', output }
      const raw = transport === 'json' ? Response.json(response) : new Response(`data: ${JSON.stringify({ type: 'response.completed', response })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
      return await translateResponsesResponse(raw, transport === 'sse')
    })
    const service = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: service, llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const cookie = enrolled.headers.get('Set-Cookie')!.split(';')[0]!
    const headers = { 'Cookie': cookie, 'Content-Type': 'application/json', ...(transport === 'sse' ? { Accept: 'text/event-stream' } : {}) }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const path = `/api/kiosk/visitor-sessions/${session.id}/messages`
    const first = await app.request(path, { method: 'POST', headers, body: JSON.stringify({ content: '請找餐點', tools: [{ type: 'function', function: { name: call.function.name, parameters: { type: 'object' } } }] }) })
    expect(first.status).toBe(200)
    expect(await first.text()).not.toContain('opaque-test-reasoning')
    const second = await app.request(path, { method: 'POST', headers, body: JSON.stringify({ toolResults: [{ name: call.function.name, toolCallId: call.id, content: '{"items":[]}' }] }) })
    expect(second.status).toBe(200)
    await second.text()
    expect(complete.mock.calls[1]![0].body.messages).toContainEqual(expect.objectContaining({ role: 'assistant', responses_output: nativeOutput, tool_calls: [call] }))
    expect(nativeRequests[1]!.input).toEqual(expect.arrayContaining([...nativeOutput, { type: 'function_call_output', call_id: call.id, output: '{"items":[]}' }]))
    expect((nativeRequests[1]!.input as Array<Record<string, unknown>>).filter(item => item.type === 'function_call')).toHaveLength(1)
    const third = await app.request(path, { method: 'POST', headers, body: JSON.stringify({ content: '另一個新問題' }) })
    expect(third.status).toBe(200)
    await third.text()
    expect(JSON.stringify(complete.mock.calls[2]![0].body.messages)).not.toContain('opaque-test-reasoning')
  })

  beforeEach(async () => {
    db = await mockDB(schema)
  })

  it('retains development device enrollment across app restarts while enforcing server revocation', async () => {
    const service = createKioskService(db)
    const app = new Hono<HonoEnv>().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'failed' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: service, llmGateway, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const cookie = enrolled.headers.get('Set-Cookie')!
    expect(cookie).toContain('Max-Age=2592000')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    const headers = { Cookie: cookie.split(';')[0]! }
    expect((await app.request('/api/kiosk/identity', { headers })).status).toBe(200)
    const { device } = await enrolled.json() as { device: { id: string } }
    await db.update(schema.kioskDeviceCredentials).set({ revokedAt: new Date() }).where(eq(schema.kioskDeviceCredentials.deviceId, device.id))
    expect((await app.request('/api/kiosk/identity', { headers })).status).toBe(401)
  })

  // Report: docs/research/2026-10-27-security-audit.md
  it('proxies POS requests only for an enrolled device and rejects foreign origins and arbitrary paths', async () => {
    const forward = vi.fn<NonNullable<KioskRoutesOptions['posGateway']>['forward']>(async () => Response.json({ payment: { id: 'scratch-payment' } }))
    const app = new Hono<HonoEnv>().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'failed' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway, runtimeModelPolicy, apiOrigin: 'https://kiosk.example.com', trustedOrigins: ['http://100.92.1.80:5169', 'http://172.17.69.17:5169'], posGateway: { forward } }))
    const path = '/api/kiosk/pos/v1/payments'
    expect((await app.request(path, { method: 'POST', body: '{}' })).status).toBe(401)
    expect(forward).not.toHaveBeenCalled()
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const cookie = enrolled.headers.get('Set-Cookie')!.split(';')[0]!
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
    // The selected LAN origin reaches the same authenticated POS boundary.
    expect((await app.request(path, { method: 'POST', headers: { Cookie: cookie, Origin: 'http://100.92.1.80:5169' }, body: '{}' })).status).toBe(200)
    expect(forward).toHaveBeenCalledTimes(3)
    expect((await app.request(path, { method: 'POST', headers: { Cookie: cookie, Origin: 'http://172.17.69.17:5169' }, body: '{}' })).status).toBe(200)
    expect(forward).toHaveBeenCalledTimes(4)
    expect((await app.request(path, { method: 'POST', headers: { Cookie: cookie, Origin: 'http://100.92.1.81:5169' }, body: '{}' })).status).toBe(403)
    expect(forward).toHaveBeenCalledTimes(4)
  })

  it('verifies a legacy development device without automatically registering a replacement during payment', async () => {
    const kioskService = createKioskService(db)
    const registration = await kioskService.registerDevelopmentDevice({ registrationCode: '483920' })
    const legacySite = await kioskService.createSite({ name: 'Legacy test site', slug: 'legacy-auth-check' })
    await db.update(schema.kioskDevices).set({ siteId: legacySite.id }).where(eq(schema.kioskDevices.id, registration.device.id))
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, llmGateway, runtimeModelPolicy }))
    const response = await app.request('/api/kiosk/identity', { headers: { Cookie: `${kioskDeviceCookieName}=${registration.credential}` } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ device: { id: registration.device.id, siteId: legacySite.id } })
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(await db.query.kioskDevices.findMany()).toHaveLength(1)
  })

  // Report: docs/plans/2026-10-22-kiosk-field-investigation.md, payment HTTP400s.
  it('accepts the current Menu LINE Pay and JKoPay decision payload', async () => {
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '街口支付', candidates: [{ id: 'intent:select-payment:jkopay', description: '街口支付' }], decisionState: { phase: 'checkout_payment_select', allowedPaymentMethods: ['linepay', 'jkopay'] } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'SYSTEM_ONE_DISABLED' })
  })

  it.each(['json', 'sse'].flatMap(transport => [0, 27, undefined].map(reasoningTokens => ({ transport, reasoningTokens }))))('records actual Main payload size and provider usage ($transport, reasoning=$reasoningTokens)', async ({ transport, reasoningTokens }) => {
    const usage = { prompt_tokens: 123, ...(reasoningTokens !== undefined ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } } : {}) }
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => transport === 'json'
      ? Response.json({ choices: [{ message: { content: '您好。' } }], usage })
      : new Response(`data: {"choices":[{"delta":{"content":"您好。"}}]}\n\ndata: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }))
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const cookie = enrolled.headers.get('Set-Cookie')!.split(';')[0]!
    const headers = { 'Cookie': cookie, 'Content-Type': 'application/json' }
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
    if (reasoningTokens === undefined)
      expect(metrics).not.toHaveProperty('reasoningTokens')
    else
      expect(metrics.reasoningTokens).toBe(reasoningTokens)
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
      .mockImplementationOnce(async () => {
        await new Promise(resolve => setTimeout(resolve, 30))
        return Response.json({ choices: [{ message: { content: '已付款成功。' } }] })
      })
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'reply', type: 'function', function: { name: replyTool.function.name, arguments: '{"kind":"payment-methods"}' } }] } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const context: ConversationContext = { contextId: 'current', capturedAt: Date.now(), taskId: 'task', sourceUtterance: '有哪些付款方式？', phase: 'ordering', entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], paymentMethods: [{ id: 'linepay', label: 'LINE Pay' }], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers: { ...headers, ...(transport === 'sse' ? { Accept: 'text/event-stream' } : {}) }, body: JSON.stringify({ budgetMs: 5000, content: context.sourceUtterance, decisionState: { phase: 'ordering', readOnly: true, context } }) })
    expect(response.status).toBe(200)
    const text = await response.text()
    const events = transport === 'sse' ? text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))) : []
    const final = transport === 'sse' ? events.find(event => event.type === 'turn-finished') : JSON.parse(text)
    expect(final.reply).toEqual({ kind: 'payment-methods' })
    expect(final.toolCalls).toEqual([])
    expect(complete).toHaveBeenCalledTimes(2)
    const firstBudget = complete.mock.calls[0]![0].budgetMs!
    const repairBudget = complete.mock.calls[1]![0].budgetMs!
    expect(firstBudget).toBeGreaterThan(0)
    expect(firstBudget).toBeLessThanOrEqual(5000)
    expect(repairBudget).toBeGreaterThan(0)
    expect(repairBudget).toBeLessThan(firstBudget - 20)
    expect(complete.mock.calls[1]![0].body.tools).toEqual([replyTool])
    expect(JSON.stringify(complete.mock.calls[1]![0].body)).not.toContain('已付款成功')
    expect(events.some(event => event.type === 'assistant-delta')).toBe(false)
    expect(events.some(event => event.type === 'tool-requested')).toBe(false)
  })

  it.each(['json', 'sse'])('does not renew an expired model budget for reply repair (%s)', async (transport) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => {
      await new Promise(resolve => setTimeout(resolve, 150))
      return Response.json({ choices: [{ message: { content: '已付款成功。' } }] })
    })
    const app = new Hono<HonoEnv>().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'unexpected' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const context: ConversationContext = { contextId: 'current', capturedAt: Date.now(), taskId: 'task', sourceUtterance: '有哪些付款方式？', phase: 'ordering', entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], paymentMethods: [{ id: 'linepay', label: 'LINE Pay' }], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers: { ...headers, ...(transport === 'sse' ? { Accept: 'text/event-stream' } : {}) }, body: JSON.stringify({ budgetMs: 100, content: context.sourceUtterance, decisionState: { phase: 'ordering', readOnly: true, context } }) })
    const text = await response.text()
    if (transport === 'sse') {
      expect(text).toContain('turn-failed')
      expect(text).toContain('timeout')
    }
    else {
      expect(response.status).toBe(504)
    }
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('supplies one complete current catalog without forcing an extra lookup (continuation=%s)', async (continuation) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'response', type: 'function', function: { name: replyTool.function.name, arguments: '{"kind":"clarification"}' } }] } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
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
    expect(prompt).toContain('手機填寫／略過步驟已完成')
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
    const systemOne = { isEnabled: async () => true, decide, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), routing: async () => 'staged' as const, maxActionCandidates: async () => 22 as const }
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy, systemOne }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
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
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"choice":"SERVICE_INFO"}' } }] } }] }))
    const systemOne = { isEnabled: async () => true, routing: async () => 'staged' as const, maxActionCandidates: async () => 22 as const, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), decide: stagedProvider({ admission: 'SERVICE', purpose: 'HANDOFF' }) }
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy, systemOne }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
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

  it.each(['SHOWN', 'CATALOG', 'invented', 'IGNORE'].flatMap(choice => (['off', 'enforce'] as const).map(mode => ({ choice, mode }))))('uses Main Agent only for the live scope question: $choice ($mode)', async ({ choice, mode }) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'scope', type: 'function', function: { name: 'scope_decide', arguments: JSON.stringify({ choice }) } }] } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const { device } = await enrolled.json() as { device: { id: string } }
    await db.update(schema.kioskDevices).set({ settings: { version: 1, overrides: { backgroundSpeechMode: mode } } }).where(eq(schema.kioskDevices.id, device.id))
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ candidates: [], transcript: '剛才那幾個', decisionState: { phase: 'query_scope', waitingFor: { questionId: 'scope-1', purpose: 'menu-query-scope', question: '剛才推薦的還是整份菜單？', expiresAt: Date.now() + 60_000, choices: [{ id: 'SHOWN', description: '剛才推薦的' }, { id: 'CATALOG', description: '整份菜單' }] } } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ kind: 'SCOPE_CHOICE', choice: choice === 'invented' || (choice === 'IGNORE' && mode === 'off') ? 'ASK' : choice })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete.mock.calls[0]![0].body).toMatchObject({ temperature: 0, tools: [{ function: { name: 'scope_decide' } }], tool_choice: 'required' })
    expect(complete.mock.calls[0]![0].body.tools).toMatchObject([{ function: { parameters: { properties: { choice: { enum: mode === 'enforce' ? ['ASK', 'SHOWN', 'CATALOG', 'NEW_REQUEST', 'IGNORE'] : ['ASK', 'SHOWN', 'CATALOG', 'NEW_REQUEST'] } } } } }])
    expect(JSON.stringify(complete.mock.calls[0]![0].body.messages)).not.toContain('scope-1')
    expect(JSON.stringify(complete.mock.calls[0]![0].body.messages)).not.toContain('expiresAt')
  })

  it.each(['application/json', 'text/event-stream'])('requires a fresh menu lookup and keeps no-tool claims out of dialogue over %s', async (accept) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { content: '推薦韭菜盒、甜不辣。' } }] }))
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json', 'Accept': accept }
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

  // Report: this chat, 2026-10-29; PB follow-up quotes used historical facts without a fresh receipt.
  it('requires current browser evidence without injecting owned Menu instructions', async () => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { content: '兩份20元。' } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const tools = ['browser_observe', 'browser_quote'].map(name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } }))
    const browserContext = { taskId: 'quote', sourceUtterance: '雞腿便當兩份多少錢？', phase: 'browsing', readOnly: true, catalog: { complete: false, products: [] }, allowedToolNames: tools.map(tool => tool.function.name) }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '雞腿便當兩份多少錢？', tools, decisionState: { phase: 'ordering', browserContext } }) })
    expect(response.status).toBe(200)
    expect(complete.mock.calls[0]![0].body).toMatchObject({ tool_choice: 'required', tools })
    expect(complete.mock.calls[0]![0].body).toMatchObject({ messages: expect.arrayContaining([expect.objectContaining({ role: 'system', content: expect.stringContaining('外站點餐網頁') })]) })
    expect(complete.mock.calls[0]![0].body).not.toMatchObject({ messages: expect.arrayContaining([expect.objectContaining({ role: 'system', content: expect.stringContaining('menu_recommend') })]) })
    expect(complete.mock.calls[0]![0].body).toMatchObject({ messages: expect.arrayContaining([expect.objectContaining({ role: 'system', content: expect.stringContaining('每輪最多 3 道') })]) })
    expect(complete.mock.calls[0]![0].body).toMatchObject({ messages: expect.arrayContaining([expect.objectContaining({ role: 'system', content: expect.stringContaining('沒有提供菜單翻頁工具') })]) })
    expect(complete.mock.calls[0]![0].body).toMatchObject({ messages: expect.arrayContaining([expect.objectContaining({ role: 'system', content: expect.stringContaining('完整菜單查無指定餐點時告知沒找到') })]) })
    // Report: this chat, Nov11; 雞腿 → 有什麼便當 reused a stale filtered screen.
    expect(complete.mock.calls[0]![0].body).toMatchObject({ messages: expect.arrayContaining([expect.objectContaining({ role: 'system', content: expect.stringContaining('關鍵字結果只是候選，依語意選出真正符合的餐點') })]) })
    expect(complete.mock.calls[0]![0].body).toMatchObject({ messages: expect.arrayContaining([expect.objectContaining({ role: 'system', content: expect.stringContaining('不要這些') })]) })
    // Report: this chat, Nov11; checkout in a new conversation skipped its unfinished cart.
    expect(complete.mock.calls[0]![0].body).toMatchObject({ messages: expect.arrayContaining([expect.objectContaining({ role: 'system', content: expect.stringContaining('購物車核對的「好」只進發票流程，不是送單同意') })]) })
    expect(complete.mock.calls[0]![0].body).toMatchObject({ messages: expect.arrayContaining([expect.objectContaining({ role: 'system', content: expect.stringContaining('接待重置由程式負責') })]) })
  })

  // Report: this chat, Nov11; PB passed bridge implementation descriptions to
  // Main and lacked master's refreshed context/tool-scope projection.
  // Report: this chat, Nov12; model option names must not break native validation or continuation history.
  it.each(['json', 'sse'])('translates model option names at dispatch and back in continuation history (%s)', async (transport) => {
    const modelArguments = { lines: [{ productRef: 'p-1', evidence: '雞腿飯一份', quantity: 1, selectedOptions: [], unansweredOptionGroupRefs: [], note: '' }] }
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>()
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'draft-1', type: 'function', function: { name: 'browser_order_draft', arguments: JSON.stringify(modelArguments) } }] } }] }))
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { content: '請確認餐點。' } }] }))
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json', ...(transport === 'sse' ? { Accept: 'text/event-stream' } : {}) }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const tools = [{ type: 'function', function: { name: 'browser_observe', parameters: { type: 'object', properties: {} } } }, { type: 'function', function: { name: 'browser_order_draft', parameters: { type: 'object', properties: { lines: { type: 'array', items: { type: 'object', properties: { choices: { type: 'array' }, askGroups: { type: 'array' } }, required: ['choices', 'askGroups'] } } } } } }]
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '我要雞腿飯一份', tools }) })
    expect(response.status).toBe(200)
    expect(complete.mock.calls[0]![0].body.tools).toContainEqual(expect.objectContaining({ function: expect.objectContaining({ name: 'browser_order_draft', parameters: expect.objectContaining({ properties: expect.objectContaining({ lines: expect.objectContaining({ items: expect.objectContaining({ required: ['selectedOptions', 'unansweredOptionGroupRefs'] }) }) }) }) }) }))
    const text = await response.text()
    const final = transport === 'sse' ? text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(event => event.type === 'turn-finished') : JSON.parse(text)
    expect(JSON.parse(final.toolCalls[0].function.arguments).lines[0]).toEqual({ productRef: 'p-1', evidence: '雞腿飯一份', quantity: 1, choices: [], askGroups: [], note: '' })
    // The next request uses the persisted tool batch, rather than supplying a
    // model-shaped batch from the fixture and masking an outbound seam bug.
    const continued = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ tools, toolResults: [{ name: 'browser_order_draft', toolCallId: 'draft-1', content: JSON.stringify({ ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '請確認餐點。' }) }] }) })
    expect(continued.status).toBe(200)
    await continued.text()
    const messages = complete.mock.calls[1]![0].body.messages as Array<{ role: string, tool_calls?: Array<{ function: { arguments: string } }> }>
    expect(JSON.parse(messages.find(message => message.tool_calls)?.tool_calls?.[0]?.function.arguments ?? '{}')).toEqual(modelArguments)
  })

  it.each(['json', 'sse'])('selects only the table workflow from the current PB page (%s)', async (transport) => {
    const call = { id: 'table-choice', type: 'function', function: { name: 'select_table', arguments: JSON.stringify({ tableName: 'A1 桌' }) } }
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => transport === 'json'
      ? Response.json({ choices: [{ message: { tool_calls: [call] } }] })
      : new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, ...call }] } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }))
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json', ...(transport === 'sse' ? { Accept: 'text/event-stream' } : {}) }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const tools = ['select_table', 'list_cart_items', 'add_items_to_cart'].map(name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } }))
    const browserContext = { taskId: 'table-task', sourceUtterance: '我要A1桌', page: 'table', phase: 'selecting_table', readOnly: true, tableChoices: ['櫃台取餐', 'A1 桌'], catalog: { complete: false, products: [] }, allowedToolNames: ['select_table'] }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '我要A1桌', tools, decisionState: { phase: 'ordering', browserContext } }) })
    expect(response.status).toBe(200)
    await response.text()
    const body = complete.mock.calls[0]![0].body
    const system = (body.messages as Array<{ role: string, content: string }>).find(message => message.role === 'system')!.content
    expect(system).toContain('## 桌號流程')
    expect(system).toContain('等待顧客指定桌號或要求開始點餐')
    expect(system).toContain('A1 桌')
    expect(system).not.toContain('## 選餐與草稿流程')
    expect(system).not.toContain('## 發票與結帳流程')
    expect((body.tools as Array<{ function: { name: string } }>).map(tool => tool.function.name)).toEqual(['select_table'])
  })

  it.each([
    { name: 'get_menu_item_details', readOnly: true },
    { name: 'get_menu_item_details', readOnly: false },
    { name: 'list_menu_items', readOnly: true },
  ])('allows a factual public $name read without forcing another operation (readOnly=$readOnly)', async ({ name, readOnly }) => {
    const kioskService = createKioskService(db)
    const registration = await kioskService.registerDevelopmentDevice({ registrationCode: '483920' })
    const headers = { 'Cookie': `${kioskDeviceCookieName}=${registration.credential}`, 'Content-Type': 'application/json' }
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ id: 'details', type: 'function', function: { name, arguments: name === 'list_menu_items' ? '{}' : '{"names":["雞腿飯"]}' } }] } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '雞腿飯單份130元。' } }] }))
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: false, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy }))
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const tools = [name, 'point_to_menu_items', 'ask_customer_question'].map(name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } }))
    const browserContext = { taskId: 'price', sourceUtterance: '雞腿飯多少錢', phase: 'browsing', readOnly, catalog: { complete: true, products: [] }, allowedToolNames: tools.map(tool => tool.function.name) }
    const decisionState = { phase: 'ordering', readOnly, browserContext }
    const first = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '雞腿飯多少錢', tools, decisionState }) })
    expect(first.status).toBe(200)
    await first.text()
    const next = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ tools, decisionState, toolResults: [{ toolCallId: 'details', name, content: JSON.stringify({ ok: true, source: 'browser', dataOnly: true, products: [{ name: '雞腿飯', price: 130 }] }) }] }) })
    expect(next.status).toBe(200)
    await next.text()
    expect(complete.mock.calls[1]![0].body).not.toHaveProperty('tool_choice')
  })

  it.each([
    ['json', 'search_menu_items'],
    ['sse', 'search_menu_items'],
    ['json', 'list_menu_items'],
    ['sse', 'list_menu_items'],
  ])('requires a presented result or recorded question after a public lookup (%s, %s)', async (transport, lookup) => {
    const kioskService = createKioskService(db)
    const registration = await kioskService.registerDevelopmentDevice({ registrationCode: '483920' })
    const headers = { 'Cookie': `${kioskDeviceCookieName}=${registration.credential}`, 'Content-Type': 'application/json', ...(transport === 'sse' ? { Accept: 'text/event-stream' } : {}) }
    const calls = [
      { id: 'fish-search', type: 'function', function: { name: lookup, arguments: lookup === 'search_menu_items' ? '{"query":"魚"}' : '{}' } },
      { id: 'fish-question', type: 'function', function: { name: 'ask_customer_question', arguments: '{"questionType":"purchase-recommendation","name":"魚丸湯"}' } },
    ]
    let callIndex = 0
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => {
      const call = calls[callIndex++]!
      return transport === 'json'
        ? Response.json({ choices: [{ message: { tool_calls: [call] } }] })
        : new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, ...call }] } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    })
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: false, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy }))
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const tools = [lookup, 'point_to_menu_items', 'ask_customer_question'].map(name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } }))
    const browserContext = { taskId: 'fish', sourceUtterance: '我想吃魚', phase: 'browsing', readOnly: false, catalog: { complete: true, products: [{ ref: 'fish', name: '魚丸湯', price: 50 }] }, allowedToolNames: tools.map(tool => tool.function.name) }
    const url = `/api/kiosk/visitor-sessions/${session.id}/messages`
    const decisionState = { phase: 'ordering', browserContext }
    const initial = await app.request(url, { method: 'POST', headers, body: JSON.stringify({ content: '我想吃魚', tools, decisionState }) })
    expect(initial.status).toBe(200)
    await initial.text()
    const next = await app.request(url, { method: 'POST', headers, body: JSON.stringify({ tools, decisionState, toolResults: [{ toolCallId: 'fish-search', name: lookup, content: JSON.stringify({ ok: true, source: 'browser', ...(lookup === 'list_menu_items' ? { dataOnly: true } : {}), customerMessage: '目前查到：魚丸湯，單份50元。', products: [{ name: '魚丸湯', price: 50 }] }) }] }) })
    expect(next.status).toBe(200)
    const text = await next.text()
    const final = transport === 'sse' ? text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(event => event.type === 'turn-finished') : JSON.parse(text)
    expect(final.toolCalls[0].function.name).toBe('ask_customer_question')
    expect(complete.mock.calls[1]![0].body.tool_choice).toBe('required')
    const system = (complete.mock.calls[1]![0].body.messages as Array<{ role: string, content: string }>).find(message => message.role === 'system')!.content
    expect(system).toContain('需要顧客回答的問題一律使用 ask_customer_question')
  })

  it('sends one fresh PB state and consistent model descriptions while removing phase-illegal tools', async () => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { content: '請問要幾份？' } }] }))
    const kioskService = createKioskService(db)
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const tools = ['browser_observe', 'browser_cart_get', 'browser_product_get', 'browser_cart_add', 'browser_confirm_add'].map(name => ({ type: 'function', function: { name, description: 'call this FIRST; internal control implementation', parameters: { type: 'object', properties: {} } } }))
    const browserContext = { taskId: 'host-turn', sourceUtterance: '兩份', phase: 'collecting_quantity', readOnly: false, catalog: { complete: true, products: [{ ref: 'p-1', name: '炸雞腿便當', price: 130 }] }, cart: { version: 'fresh-cart', subtotal: 0, lines: [] }, draft: { productRef: 'p-1', name: '炸雞腿便當', missing: ['quantity', 'configuration', 'confirmation'] }, waitingFor: { questionId: 'quantity-q', purpose: 'browser-order-quantity', question: '請問要幾份？', expiresAt: Date.now() + 60_000, choices: [{ id: 'cancel', description: '先不要' }] }, allowedToolNames: ['browser_observe', 'browser_cart_get', 'browser_product_get'] }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '兩份', tools, decisionState: { phase: 'ordering', browserContext } }) })
    expect(response.status).toBe(200)
    const body = complete.mock.calls[0]![0].body
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'browser_cart_get' } })
    const exposed = body.tools as Array<{ function: { name: string, description: string } }>
    expect(exposed.map(tool => tool.function.name)).toEqual(['browser_observe', 'browser_cart_get', 'browser_product_get'])
    expect(exposed.every(tool => ['用途：', '使用時機：', '參數來源：', '結果：'].every(field => tool.function.description.includes(field)))).toBe(true)
    expect(JSON.stringify(exposed)).not.toContain('call this FIRST')
    const system = (body.messages as Array<{ role: string, content: string }>).find(message => message.role === 'system')!.content
    expect(system).toContain('本輪最新外站點餐狀態')
    expect(system).toContain('fresh-cart')
    expect(system).toContain('等待顧客提供餐點份數')
    expect(system).not.toContain('collecting_quantity')
    expect(system).not.toContain('host-turn')
    expect(system).not.toContain('手機填寫')

    const updated = { ...browserContext, sourceUtterance: '我要雞腿便當', phase: 'browsing', draft: undefined, waitingFor: undefined, allowedToolNames: tools.map(tool => tool.function.name) }
    await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '我要雞腿便當', tools, decisionState: { phase: 'ordering', browserContext: updated } }) })
    expect(complete.mock.calls[1]![0].body.tool_choice).toBe('required')
    const nextSystem = (complete.mock.calls[1]![0].body.messages as Array<{ role: string, content: string }>).find(message => message.role === 'system')!.content
    expect(nextSystem).not.toContain('quantity-q')
    expect(nextSystem).toContain('我要雞腿便當')
  })

  it.each([false, true])('requires a presented browser action while permitting bounded Host conversation (conversation=%s)', async (conversation) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'cart-context', type: 'function', function: { name: 'browser_cart_get', arguments: '{"includeCatalog":true}' } }] } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const tools = ['browser_observe', 'browser_cart_get', 'browser_cart_add', 'browser_confirm_add', ...(conversation ? ['browser_respond'] : [])].map(name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } }))
    await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '當日餐點各一份', tools }) })
    expect(complete.mock.calls[0]![0].body).toMatchObject({ tool_choice: { type: 'function', function: { name: 'browser_cart_get' } } })
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ tools, toolResults: [{ name: 'browser_cart_get', toolCallId: 'cart-context', content: JSON.stringify({ ok: true, dataOnly: true, cart: {}, products: [] }) }] }) })
    expect(response.status).toBe(200)
    expect(complete.mock.calls[1]![0].body).toMatchObject({ tool_choice: 'required' })
    await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ tools, toolResults: [{ name: 'browser_cart_get', toolCallId: 'selected-product', content: JSON.stringify({ ok: true, source: 'browser', dataOnly: true, selectedProduct: { productRef: 'p-today', name: '每日新品', configurationVersion: 'today', unitPrice: 10 }, cart: { version: 'cart' }, products: [] }) }] }) })
    expect(complete.mock.calls[2]![0].body).toMatchObject({ tool_choice: { type: 'function', function: { name: 'browser_cart_add' } } })
    await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ tools, toolResults: [{ name: 'browser_cart_get', toolCallId: 'confirmed-product', content: JSON.stringify({ ok: true, source: 'browser', dataOnly: true, confirmedAddition: { productRef: 'p-today', quantity: 2 }, cart: { version: 'cart' } }) }] }) })
    expect(complete.mock.calls[3]![0].body).toMatchObject({ tool_choice: { type: 'function', function: { name: 'browser_confirm_add' } } })
  })

  // Report: this chat, Nov14 — public add tool questions were skipped during answer lookup.
  it.each(['browser_cart_add', 'add_items_to_cart', 'ask_customer_question'].flatMap(name => [false, true].map(superseded => ({ name, superseded }))))('requires a recorded browser question and same user turn before and after answer IO ($name, superseded=$superseded)', async ({ name: toolName, superseded }) => {
    const kioskService = createKioskService(db)
    const registration = await kioskService.registerDevelopmentDevice({ registrationCode: '483920' })
    const headers = { 'Cookie': `${kioskDeviceCookieName}=${registration.credential}`, 'Content-Type': 'application/json' }
    let visitorSessionId: string
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async ({ body }) => {
      if (superseded)
        await kioskService.appendInteractionEntry({ visitorSessionId, kind: 'user_text', content: '改兩份' })
      const tools = body.tools as Array<{ function: { name: string } }>
      const name = tools[0]!.function.name
      return Response.json({ choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify({ choice: name === 'judge_browser_answer_relation' ? 'ANSWER' : 'confirm', reason: '回答目前完整提案' }) } }] } }] })
    })
    const finite = vi.fn(async () => {
      throw new Error('Main must not call Jev again.')
    })
    const isEnabled = vi.fn(async () => true)
    const app = new Hono<HonoEnv>().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'failed' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: false, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy, systemOne: { isEnabled, decide: finite, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), routing: async () => 'staged' as const, maxActionCandidates: async () => 22 as const } }))
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    visitorSessionId = session.id
    const question = { questionId: 'browser-q', purpose: 'browser-confirm-add', question: '確認每日新品一份10元嗎？', expiresAt: Date.now() + 60_000, choices: [{ id: 'confirm', description: '同意完整提案' }, { id: 'cancel', description: '先不加入' }] }
    await kioskService.appendInteractionEntry({ visitorSessionId, kind: 'tool_result', metadata: { name: toolName }, content: JSON.stringify({ source: 'browser', status: 'clarification', pendingCustomerChoice: question }) })
    await kioskService.appendInteractionEntry({ visitorSessionId, kind: 'user_text', content: '對' })
    const url = `/api/kiosk/visitor-sessions/${visitorSessionId}/browser-answer`
    const body = JSON.stringify({ transcript: '對', questionId: question.questionId, ...(toolName === 'ask_customer_question' ? { decisionSource: 'main' } : {}) })
    expect((await app.request(url, { method: 'POST', body })).status).toBe(401)
    expect(await (await app.request(url, { method: 'POST', headers, body: JSON.stringify({ transcript: '對', questionId: 'fabricated' }) })).json()).toEqual({ kind: 'UNCERTAIN', provider: 'unavailable' })
    expect(complete).not.toHaveBeenCalled()
    expect(await (await app.request(url, { method: 'POST', headers, body })).json()).toMatchObject(superseded ? { kind: 'UNCERTAIN', provider: 'unavailable' } : { kind: 'ANSWER', choiceId: 'confirm', provider: 'main' })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete.mock.calls[0]![0].budgetMs).toBeGreaterThan(0)
    expect(complete.mock.calls[0]![0].budgetMs).toBeLessThanOrEqual(12_000)
    expect(finite).not.toHaveBeenCalled()
    expect(isEnabled).not.toHaveBeenCalled()
  })

  it('uses one finite request only for an explicit first System One question answer', async () => {
    const kioskService = createKioskService(db)
    const registration = await kioskService.registerDevelopmentDevice({ registrationCode: '483920' })
    const profile = await kioskService.getDeviceProfile(registration.device.id)
    const session = await kioskService.startVisitorSession({ deviceId: registration.device.id, profileReleaseId: profile!.id, serviceId: profile!.snapshot.interactiveService.id })
    const question = { questionId: 'first-answer', purpose: 'browser-confirm-add', question: '要甲餐一份嗎？', expiresAt: Date.now() + 60_000, choices: [{ id: 'confirm', description: '加入甲餐一份' }, { id: 'cancel', description: '不要甲餐' }] }
    await kioskService.appendInteractionEntry({ visitorSessionId: session.id, kind: 'tool_result', metadata: { name: 'add_items_to_cart' }, content: JSON.stringify({ source: 'browser', status: 'clarification', pendingCustomerChoice: question }) })
    await kioskService.appendInteractionEntry({ visitorSessionId: session.id, kind: 'user_text', content: '好' })
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>()
    const decide = vi.fn(async () => ({ answers: { answer: { choice: 'confirm', confidence: 0.95 } } }))
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: false, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy, systemOne: { isEnabled: async () => true, decide, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), routing: async () => 'staged' as const, maxActionCandidates: async () => 22 as const } }))
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/browser-answer`, { method: 'POST', headers: { 'Cookie': `${kioskDeviceCookieName}=${registration.credential}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: '好', questionId: question.questionId, decisionSource: 'system-one' }) })
    expect(await response.json()).toMatchObject({ kind: 'ANSWER', choiceId: 'confirm', provider: 'system-one' })
    expect(decide).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()
  })

  it.each(['accepted', 'changed-quantity', 'added-option', 'old-utterance', 'missing-decision'] as const)('admits only a compiled current Jev browser intent without another model (%s)', async (mode) => {
    const kioskService = createKioskService(db)
    const registration = await kioskService.registerDevelopmentDevice({ registrationCode: '483920' })
    const profile = await kioskService.getDeviceProfile(registration.device.id)
    const session = await kioskService.startVisitorSession({ deviceId: registration.device.id, profileReleaseId: profile!.id, serviceId: profile!.snapshot.interactiveService.id })
    const transcript = '每日新品兩份'
    const utteranceId = 42
    if (mode !== 'missing-decision')
      await kioskService.appendDeviceInteraction({ deviceId: registration.device.id, visitorSessionId: session.id, kind: 'service_event', content: 'Server finite decision fixture', metadata: { browserAuthority: { source: 'system-one', actionId: 'intent:add-item', transcript, utteranceId: mode === 'old-utterance' ? 41 : utteranceId } } })
    await kioskService.appendDeviceInteraction({ deviceId: registration.device.id, visitorSessionId: session.id, kind: 'user_text', content: transcript, metadata: { utteranceId } })
    const plan = { source: 'system-one' as const, toolName: 'browser_cart_add' as const, arguments: JSON.stringify({ version: 'current-cart', productRef: 'daily-ref', quantity: mode === 'changed-quantity' ? 3 : 2, unitPrice: 10, note: '', selection: { version: 'daily-config', variantRef: '', choices: mode === 'added-option' ? [{ ref: 'rice', quantity: 1 }] : [] } }), effect: { transcript, action: 'add' as const, description: '每日新品兩份', deltas: [{ name: '每日新品', kind: 'product' as const, mode: 'increase' as const, quantity: 2 }], note: '', completedEffects: [], storeFacts: '' } }
    expect(await kioskService.claimBrowserPlan({ deviceId: registration.device.id, visitorSessionId: session.id, plan })).toMatchObject({ choice: mode === 'accepted' ? 'ALLOW' : 'CLARIFY' })
    expect(await kioskService.claimBrowserPlan({ deviceId: registration.device.id, visitorSessionId: session.id, plan })).toMatchObject({ choice: 'CLARIFY' })
  })

  // Report: this chat, Nov15 — one model decision must not be judged again by Main or Jev.
  it.each(['main', 'system-one'] as const)('claims an issued %s plan without a second semantic model decision', async (source) => {
    const kioskService = createKioskService(db)
    const registration = await kioskService.registerDevelopmentDevice({ registrationCode: '483920' })
    const profile = await kioskService.getDeviceProfile(registration.device.id)
    const session = await kioskService.startVisitorSession({ deviceId: registration.device.id, profileReleaseId: profile!.id, serviceId: profile!.snapshot.interactiveService.id })
    const transcript = source === 'main' ? '每日新品兩份' : '原餐改成兩份'
    const headers = { 'Cookie': `${kioskDeviceCookieName}=${registration.credential}`, 'Content-Type': 'application/json' }
    if (source === 'system-one')
      await kioskService.appendDeviceInteraction({ deviceId: registration.device.id, visitorSessionId: session.id, kind: 'service_event', content: 'Initial finite decision', metadata: { browserAuthority: { source, actionId: 'intent:set-quantity', transcript, utteranceId: 42 } } })
    const user = await kioskService.appendDeviceInteraction({ deviceId: registration.device.id, visitorSessionId: session.id, kind: 'user_text', content: transcript, metadata: { utteranceId: 42 } })
    const args = source === 'main' ? { version: 'fresh', productRef: 'daily', quantity: 2, unitPrice: 10, note: '', selection: { version: 'cfg', variantRef: '', choices: [] } } : { version: 'fresh', lineRef: 'selected', quantity: 2 }
    const toolName = source === 'main' ? 'browser_cart_add' : 'browser_cart_quantity'
    if (source === 'main')
      await kioskService.appendDeviceInteraction({ deviceId: registration.device.id, visitorSessionId: session.id, kind: 'tool_call', content: 'Issued model call', metadata: { browserAuthority: { source, userEntryId: user.id, readOnly: false }, toolCalls: [{ id: 'issued', type: 'function', function: { name: toolName, arguments: JSON.stringify(args) } }] } })
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => {
      throw new Error('No model may reclassify an issued operation.')
    })
    const decide = vi.fn(async () => ({ answers: { purpose: { choice: 'UNCERTAIN', confidence: 0.99 } } }))
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: false, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy, systemOne: { isEnabled: async () => true, decide, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), routing: async () => 'staged' as const, maxActionCandidates: async () => 22 as const } }))
    const effect = source === 'main'
      ? { transcript, action: 'add', description: 'Add two', serving: { productName: '每日新品', variantName: '', options: [] }, deltas: [{ name: '每日新品', kind: 'product', mode: 'increase', quantity: 2 }] }
      : { transcript, action: 'quantity', description: 'Set two', cartTarget: { selected: { name: '原餐', quantity: 3 }, others: [{ name: '原餐', quantity: 1, sameConfiguration: true }] }, deltas: [{ name: '原餐', kind: 'cart_line', mode: 'set', quantity: 2 }] }
    const request = () => app.request(`/api/kiosk/visitor-sessions/${session.id}/browser-plan`, { method: 'POST', headers, body: JSON.stringify({ source, toolName, arguments: JSON.stringify(args), effect }) })
    expect(await (await request()).json()).toMatchObject({ choice: 'ALLOW', provider: source, admission: 'issued-plan' })
    expect(await (await request()).json()).toMatchObject({ choice: 'CLARIFY' })
    expect(complete).not.toHaveBeenCalled()
    expect(decide).not.toHaveBeenCalled()
  })

  // Report: docs/plans/2026-10-28-windows-kiosk-electron.md, S09.
  it.each(['repeated-option', 'requested-note', 'public-requested-note', 'omitted-note'])('matches the original issued note/options without asking a second model (%s)', async (mode) => {
    const publicCall = mode === 'public-requested-note'
    const repeatedOption = mode === 'repeated-option'
    const kioskService = createKioskService(db)
    const registration = await kioskService.registerDevelopmentDevice({ registrationCode: '483920' })
    const headers = { 'Cookie': `${kioskDeviceCookieName}=${registration.credential}`, 'Content-Type': 'application/json' }
    const note = mode === 'omitted-note' ? '' : repeatedOption ? '加白飯' : '不要辣'
    const args = { version: 'cart', productRef: 'p-current', quantity: 1, unitPrice: 15, note, selection: { version: 'config', variantRef: '', choices: [{ ref: 'rice', quantity: 1 }] } }
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => {
      const name = publicCall ? 'add_items_to_cart' : 'browser_cart_add'
      const input = publicCall ? { items: [{ name: '每日新品', quantity: 1, options: [{ group: '配飯', name: '白飯', quantity: 1 }], note }] } : args
      return Response.json({ choices: [{ message: { tool_calls: [{ id: 'note-call', type: 'function', function: { name, arguments: JSON.stringify(input) } }] } }] })
    })
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: false, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy }))
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const transcript = `每日新品一份加白飯${repeatedOption ? '' : '，不要辣'}`
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: transcript, decisionState: { phase: 'ordering', readOnly: false }, tools: [{ type: 'function', function: { name: publicCall ? 'add_items_to_cart' : 'browser_cart_add', description: 'Add actual meal', parameters: { type: 'object', properties: {} } } }] }) })
    expect(response.status).toBe(200)
    await response.text()
    const effect = { transcript, action: 'add', description: '加入一份加白飯餐點', note, serving: { productName: '每日新品', variantName: '', options: [{ name: '白飯', quantity: 1 }] }, deltas: [{ name: '白飯', kind: 'option', mode: 'increase', quantity: 1 }, { name: '每日新品', kind: 'product', mode: 'increase', quantity: 1 }] }
    const request = () => app.request(`/api/kiosk/visitor-sessions/${session.id}/browser-plan`, { method: 'POST', headers, body: JSON.stringify({ source: 'main', toolName: 'browser_cart_add', arguments: JSON.stringify(args), effect }) })
    const changed = await app.request(`/api/kiosk/visitor-sessions/${session.id}/browser-plan`, { method: 'POST', headers, body: JSON.stringify({ source: 'main', toolName: 'browser_cart_add', arguments: JSON.stringify({ ...args, note: '擅自新增的備註' }), effect: { ...effect, note: '擅自新增的備註' } }) })
    expect(await changed.json()).toMatchObject({ choice: 'CLARIFY' })
    expect(await (await request()).json()).toMatchObject({ choice: 'ALLOW', admission: 'issued-plan' })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(await (await request()).json()).toMatchObject({ choice: 'CLARIFY' })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  // Report: docs/plans/2026-10-28-windows-kiosk-electron.md, S09.
  it.each([{ quantity: 14, superseded: false, group: false }, { quantity: 27, superseded: false, group: false }, { quantity: 14, superseded: true, group: false }, { quantity: 5, superseded: false, group: true }])('matches exact issued multi-row parameters and refuses a newer user turn (%j)', async ({ quantity, superseded, group }) => {
    const kioskService = createKioskService(db)
    const registration = await kioskService.registerDevelopmentDevice({ registrationCode: '483920' })
    const headers = { 'Cookie': `${kioskDeviceCookieName}=${registration.credential}`, 'Content-Type': 'application/json' }
    const args = { version: 'cart', lineRef: 'selected', quantity, ...(group ? { lineRefs: ['selected', 'other'] } : {}) }
    let visitorSessionId = ''
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'quantity-call', type: 'function', function: { name: 'browser_cart_quantity', arguments: JSON.stringify(args) } }] } }] }))
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: false, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy }))
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    visitorSessionId = session.id
    const transcript = group ? '原餐總共改成五份' : '原餐總共改成二十七份'
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: transcript, decisionState: { phase: 'ordering', readOnly: false }, tools: [{ type: 'function', function: { name: 'browser_cart_quantity', description: 'Set row quantity', parameters: { type: 'object', properties: {} } } }] }) })
    expect(response.status).toBe(200)
    await response.text()
    const body = JSON.stringify({ source: 'main', toolName: 'browser_cart_quantity', arguments: JSON.stringify(args), effect: { transcript, action: 'quantity', description: '改單列份數', deltas: [{ name: '原餐', kind: 'cart_line', mode: 'set', quantity }], cartTarget: group ? { selected: { name: '原餐', quantity: 30 }, groupSize: 2, others: [] } : { selected: { name: '原餐', quantity: 17 }, others: [{ name: '原餐', quantity: 13, sameConfiguration: true }] } } })
    if (superseded)
      await kioskService.appendDeviceInteraction({ deviceId: registration.device.id, visitorSessionId, kind: 'user_text', content: '先別改' })
    const request = () => app.request(`/api/kiosk/visitor-sessions/${session.id}/browser-plan`, { method: 'POST', headers, body })
    expect(await (await request()).json()).toMatchObject({ choice: superseded ? 'CLARIFY' : 'ALLOW' })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(await (await request()).json()).toMatchObject({ choice: 'CLARIFY' })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it.each(['accepted', 'read-only', 'changed-arguments', 'superseded', 'concurrent', 'unissued'] as const)('admits only the current exact one-use Main browser plan without another model (%s)', async (mode) => {
    const kioskService = createKioskService(db)
    const registration = await kioskService.registerDevelopmentDevice({ registrationCode: '483920' })
    const headers = { 'Cookie': `${kioskDeviceCookieName}=${registration.credential}`, 'Content-Type': 'application/json' }
    const args = { version: 'fresh-cart', productRef: 'fresh-product', quantity: 2, unitPrice: 15, note: '', selection: { version: 'daily-config', variantRef: '', choices: [{ ref: 'rice', quantity: 1 }] } }
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'plan-call', type: 'function', function: { name: 'browser_cart_add', arguments: JSON.stringify(args) } }] } }] }))
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: false, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy }))
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const transcript = '請加兩份每日新品，每份一份白飯'
    if (mode === 'unissued') {
      await kioskService.appendDeviceInteraction({ deviceId: registration.device.id, visitorSessionId: session.id, kind: 'user_text', content: transcript })
    }
    else {
      const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: transcript, decisionState: { phase: 'ordering', readOnly: mode === 'read-only' }, tools: [{ type: 'function', function: { name: 'browser_cart_add', description: 'Add actual meal', parameters: { type: 'object', properties: {} } } }] }) })
      expect(response.status).toBe(200)
      await response.text()
    }
    if (mode === 'superseded')
      await kioskService.appendDeviceInteraction({ deviceId: registration.device.id, visitorSessionId: session.id, kind: 'user_text', content: '先不要加' })
    const body = JSON.stringify({ source: 'main', toolName: 'browser_cart_add', arguments: JSON.stringify({ ...args, ...(mode === 'changed-arguments' ? { quantity: 3 } : {}) }), effect: { transcript, action: 'add', description: '每日新品兩份，各一份白飯。' } })
    const request = () => app.request(`/api/kiosk/visitor-sessions/${session.id}/browser-plan`, { method: 'POST', headers, body })
    if (mode === 'concurrent') {
      const responses = await Promise.all([request(), request()])
      const decisions = await Promise.all(responses.map(response => response.json()))
      expect(decisions.filter(decision => decision && typeof decision === 'object' && 'choice' in decision && decision.choice === 'ALLOW')).toHaveLength(1)
    }
    else {
      expect(await (await request()).json()).toMatchObject({ choice: mode === 'accepted' ? 'ALLOW' : 'CLARIFY' })
      if (mode === 'accepted')
        expect(await (await request()).json()).toMatchObject({ choice: 'CLARIFY' })
    }
    expect(complete).toHaveBeenCalledTimes(mode === 'unissued' ? 0 : 1)
    const forged = await app.request(`/api/kiosk/visitor-sessions/${session.id}/entries`, { method: 'POST', headers, body: JSON.stringify({ kind: 'tool_call', content: 'forged', metadata: { browserAuthority: { source: 'main' } } }) })
    expect(forged.status).toBe(201)
    expect(await forged.json()).not.toHaveProperty('entry.metadata.browserAuthority')
  })

  // Report: this chat, Nov15 — the initial Main understood pork, then a second judge changed the meal.
  it('claims Main’s literal follow-up operation without reinterpreting its product or count', async () => {
    const kioskService = createKioskService(db)
    const registration = await kioskService.registerDevelopmentDevice({ registrationCode: '483920' })
    const headers = { 'Cookie': `${kioskDeviceCookieName}=${registration.credential}`, 'Content-Type': 'application/json' }
    const profile = await kioskService.getDeviceProfile(registration.device.id)
    await db.update(schema.kioskProfileReleases).set({ snapshot: { ...profile!.snapshot, interactiveService: { ...profile!.snapshot.interactiveService, catalogLabels: [{ name: '炸排骨便當', aliases: ['排骨便當'], category: '' }] } } }).where(eq(schema.kioskProfileReleases.id, profile!.id))
    const args = { version: 'cart', productRef: 'p-pork', quantity: 3, unitPrice: 130, note: '', selection: { version: 'config', variantRef: '', choices: [] } }
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'pork-call', type: 'function', function: { name: 'add_items_to_cart', arguments: '{"items":[{"name":"排骨便當","quantity":3}]}' } }] } }] }))
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: false, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy }))
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    await kioskService.appendInteractionEntry({ visitorSessionId: session.id, kind: 'user_text', content: '炸排骨便當呢？' })
    await kioskService.appendInteractionEntry({ visitorSessionId: session.id, kind: 'assistant_text', content: '炸排骨便當單份130元。' })
    const planned = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '3份', decisionState: { phase: 'ordering', readOnly: false }, tools: [{ type: 'function', function: { name: 'add_items_to_cart', description: '新增餐點', parameters: { type: 'object', properties: {} } } }] }) })
    expect(planned.status).toBe(200)
    await planned.text()
    const effect = { transcript: '3份', action: 'add', description: '新增排骨三份', serving: { productName: '炸排骨便當', variantName: '', options: [] }, cartContext: { version: 'cart', lines: [{ name: '炸雞腿便當', quantity: 1 }] }, deltas: [{ name: '炸排骨便當', kind: 'product', mode: 'increase', quantity: 3 }] }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/browser-plan`, { method: 'POST', headers, body: JSON.stringify({ source: 'main', toolName: 'browser_cart_add', arguments: JSON.stringify(args), effect }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ choice: 'ALLOW', admission: 'issued-plan' })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete.mock.calls[0][0].body.messages).toEqual(expect.arrayContaining([{ role: 'user', content: '炸排骨便當呢？' }, { role: 'assistant', content: '炸排骨便當單份130元。' }]))
  })

  it('refuses a planless browser-effect without asking any model or granting write admission', async () => {
    const kioskService = createKioskService(db)
    const registration = await kioskService.registerDevelopmentDevice({ registrationCode: '483920' })
    const profile = await kioskService.getDeviceProfile(registration.device.id)
    const session = await kioskService.startVisitorSession({ deviceId: registration.device.id, profileReleaseId: profile!.id, serviceId: profile!.snapshot.interactiveService.id })
    const headers = { 'Cookie': `${kioskDeviceCookieName}=${registration.credential}`, 'Content-Type': 'application/json' }
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>()
    const app = new Hono<HonoEnv>().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'failed' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: false, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy }))
    const url = `/api/kiosk/visitor-sessions/${session.id}/browser-effect`
    expect((await app.request(url, { method: 'POST', body: '{}' })).status).toBe(401)
    const response = await app.request(url, { method: 'POST', headers, body: JSON.stringify({ transcript: '三份', action: 'add' }) })
    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({ choice: 'CLARIFY', provider: 'unavailable', code: 'ISSUED_PLAN_REQUIRED' })
    expect(complete).not.toHaveBeenCalled()
  })

  it.each([false, true])('keeps menu-inquiry tools read-only after a lookup (dataOnly=%s) and restores tools for a new request', async (dataOnly) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ id: 'inquiry-menu', type: 'function', function: { name: 'menu_get', arguments: '{"query":"水餃"}' } }] } }] }))
      .mockImplementation(async () => Response.json({ choices: [{ message: { content: '水餃目前可以點。' } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
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
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, llmGateway, runtimeModelPolicy, systemOne: { isEnabled: async () => true, decide: stagedProvider({ admission: 'SERVICE', purpose: 'UNCERTAIN' }), getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), routing: async () => 'staged' as const, maxActionCandidates: async () => 22 as const } }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', body: JSON.stringify({ registrationCode: '483920' }), headers: { 'Content-Type': 'application/json' } })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '酸辣魚便當', candidates: [], decisionState: { phase: 'ordering', clarificationOffer: { id: 'browser-offer1', label: '泰式酸辣魚便當' }, interactionState: { screen: 'request_confirmation', matchingCartLines: 0 } } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ kind: 'NEEDS_CLARIFICATION' })
  })

  // Report: this chat, Oct 8 — the admin switch promised an assistant handoff.
  it('authenticates live Fast Path status and bypasses decisions while disabled without changing the session', async () => {
    const kioskService = createKioskService(db)
    let enabled = false
    const decide = vi.fn(async () => ({ answers: { route: { choice: 'IGNORE' } } }))
    const getPolicy = vi.fn(async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }))
    const systemOne = { isEnabled: async () => enabled, decide, getPolicy, routing: async () => 'staged' as const, maxActionCandidates: async () => 22 as const }
    const app = new Hono<HonoEnv>().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'unexpected' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, kioskService, llmGateway, runtimeModelPolicy, secureCookies: false, systemOne }))
    expect((await app.request('/api/kiosk/interaction-decisions/status')).status).toBe(401)
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', body: JSON.stringify({ registrationCode: '483920' }), headers: { 'Content-Type': 'application/json' } })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
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
    expect(await (await app.request('/api/kiosk/interaction-decisions/status', { headers })).json()).toEqual({ enabled: false })
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '有水餃嗎', candidates: [] }) })
    expect(await response.json()).toEqual({ kind: 'NEEDS_ASSISTANT', reason: 'SYSTEM_ONE_DISABLED' })
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
      const reviewing = JSON.stringify(body).includes('前一輪有限選項仍不確定')
      return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_request', arguments: JSON.stringify(reviewing ? { admission: 'uncertain', disposition: 'abstain' } : { choice: 'UNCERTAIN' }) } }] } }] })
    })
    const systemOne = { isEnabled: async () => true, routing: async () => 'staged' as const, maxActionCandidates: async () => 22 as const, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), decide: async (_state: string, questions: Record<string, unknown>) => ({ answers: Object.fromEntries(Object.keys(questions).map(key => [key, { choice: ({ admission: 'SERVICE', phone: 'SKIP' } as Record<string, string>)[key], confidence: key === 'phone' ? (uncertainService ? 0.3255 : 0.4977) : 0.95 }])) }) }
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy, systemOne }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
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
    // Background filtering is off for this enrolled device; only phone is decided.
    expect(payload).toMatchObject({ modelCalls: 1, modelQuestions: 1 })
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
    const systemOne = { isEnabled: async () => true, routing: async () => 'staged' as const, maxActionCandidates: async () => 22 as const, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), decide: stagedProvider({ admission: scope === 'REQUEST' && confidence >= 0.6 ? 'BACKGROUND' : scope === 'REQUEST' ? 'SERVICE' : scope }, scope === 'REQUEST' && confidence >= 0.6 ? relevanceConfidence : confidence) }
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy, systemOne }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    // This case exercises enabled filtering. The ordinary device default is off.
    const { device } = await enrolled.clone().json() as { device: { id: string } }
    await db.update(schema.kioskDevices).set({ settings: { version: 1, overrides: { backgroundSpeechMode: 'enforce' } } }).where(eq(schema.kioskDevices.id, device.id))
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
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
    const systemOne = { isEnabled: async () => true, decide, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), routing: async () => 'staged' as const, maxActionCandidates: async () => 22 as const }
    const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, kioskService: createKioskService(db), llmGateway, runtimeModelPolicy, secureCookies: false, systemOne }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', body: JSON.stringify({ registrationCode: '483920' }), headers: { 'Content-Type': 'application/json' } })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '略過電話', candidates: [{ id: 'intent:skip-customer-entry', description: '略過自願電話登記，進入菜單。', requiresHighConfidence: true }], decisionState: { phase: 'customer_entry', interactionState: { screen: 'customer_entry', matchingCartLines: 0 } } }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:skip-customer-entry' })
    expect(JSON.parse(decide.mock.calls[0]![0])).toMatchObject({ customerUtterance: '略過電話', phase: 'customer_entry' })
    expect(decide).toHaveBeenCalledTimes(1)
  })

  it('carries bounded price evidence through the authenticated HTTP schema and returns its choice ID', async () => {
    const kioskService = createKioskService(db)
    const decide = stagedProvider({ admission: 'SERVICE', purpose: 'QUERY' })
    const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_price_choice', arguments: '{"choice":"UPPER_INCLUSIVE"}' } }] } }] }))
    const app = new Hono<HonoEnv>().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'unexpected' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, kioskService, llmGateway: { complete }, runtimeModelPolicy, secureCookies: false, systemOne: { isEnabled: async () => true, decide, getPolicy: async () => ({ decisionInstruction: '已儲存提示', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), routing: async () => 'staged' as const, maxActionCandidates: async () => 22 as const } }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', body: JSON.stringify({ registrationCode: '483920' }), headers: { 'Content-Type': 'application/json' } })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '100元以下的便當', candidates: [{ id: 'intent:search-menu', description: '查詢' }], decisionState: { phase: 'ordering', constraints: { exclude: [], unresolvedPrice: true }, priceEvidence: { amounts: [{ text: '100元', amount: 100 }], choices: [{ id: 'UPPER_INCLUSIVE', kind: 'condition', conditions: { maxPrice: 100 }, description: '單份不超過100' }, { id: 'NONE', kind: 'none', description: '無價格需求' }, { id: 'UNSUPPORTED', kind: 'unsupported', description: '需要釐清' }] } } }) })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER', priceChoiceId: 'UPPER_INCLUSIVE' })
    expect(decide.mock.calls[0]?.[0]).toContain('100元')
    expect(decide.mock.calls[0]?.[1]).not.toHaveProperty('admission')
    expect(decide.mock.calls[0]?.[1]).toHaveProperty('purpose')
    expect(complete).toHaveBeenCalledOnce()
  })

  it('saves failed decision diagnostics without promoting them into completed dialogue', async () => {
    const kioskService = createKioskService(db)
    const app = new Hono<HonoEnv>().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'unexpected' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, kioskService, llmGateway, runtimeModelPolicy, secureCookies: false }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', body: JSON.stringify({ registrationCode: '483920' }), headers: { 'Content-Type': 'application/json' } })
    const cookie = enrolled.headers.get('Set-Cookie')!.split(';')[0]!
    const headers = { 'Cookie': cookie, 'Content-Type': 'application/json' }
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
    const app = new Hono<HonoEnv>().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'unexpected' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, kioskService, llmGateway, runtimeModelPolicy, secureCookies: false, systemOne: { isEnabled: async () => true, decide, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), routing: async () => 'staged' as const, maxActionCandidates: async () => 22 as const } }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', body: JSON.stringify({ registrationCode: '483920' }), headers: { 'Content-Type': 'application/json' } })
    const cookie = enrolled.headers.get('Set-Cookie')!.split(';')[0]!
    const headers = { 'Cookie': cookie, 'Content-Type': 'application/json' }
    const first = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ segmented: true, includeTrace: true, transcript: '有賣什麼', candidates: [{ id: 'intent:search-menu', description: '查菜單' }], decisionState: { phase: 'ordering' } }) })
    expect(first.status).toBe(200)
    let body = await first.json() as { kind: string, continuationId?: string, actionId?: string }
    expect(body.kind).toBe('DECISION_PROGRESS')
    expect(body).toHaveProperty('question', 'purpose')
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
      routing: async () => 'staged' as const,
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
    expect(decide).toHaveBeenCalledTimes(6)
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
    const device = await kioskService.resolveDeviceCredential(cookie.split('=')[1]!)
    await db.update(schema.kioskDevices).set({ settings: { ...defaultDeviceSettings, overrides: { observationEnabled: true, greetingEnabled: true, proactiveVlmEnabled: true } } }).where(eq(schema.kioskDevices.id, device!.id))
    const headers = { 'Cookie': cookie, 'Content-Type': 'application/json' }
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
    expect(messages[0]).toMatchObject({ content: expect.stringContaining('【店家服務資訊與即時操作分界】') })
    expect(messages[0]).toMatchObject({ content: expect.stringContaining('沒有提供的資訊明確說明無法確認') })
    expect(messages[0]).toMatchObject({ content: expect.stringContaining('即時訂單與配送狀態仍以最新工具回傳為準') })
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

  // User report (2026-11-11): PB must honor the published character and its ongoing rules.
  it.each([true, false])('keeps the published character identity and card rules in PB conversation (card=%s)', async (withCard) => {
    const kioskService = createKioskService(db)
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { content: '您好。' } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const bootstrap = await app.request('/api/kiosk/bootstrap', { headers })
    const { profile } = await bootstrap.json() as { profile: { releaseId: string, snapshot: KioskProfileSnapshot } }
    await db.update(schema.kioskProfileReleases).set({ snapshot: {
      ...profile.snapshot,
      characterName: 'PB 小葵',
      agentInstructions: '以親切的店務助手口吻回覆。',
      ...(withCard ? { characterCard: { description: '我是餐廳助手', personality: '溫和簡潔', scenario: '協助點餐', systemPrompt: '保持角色語氣', postHistoryInstructions: '每次回覆都維持繁體中文與簡潔語氣。' } } : {}),
    } }).where(eq(schema.kioskProfileReleases.id, profile.releaseId))
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const tools = [{ type: 'function', function: { name: 'browser_observe', parameters: { type: 'object', properties: {} } } }]
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '你好。', tools }) })
    expect(response.status).toBe(200)
    const messages = complete.mock.calls[0]![0].body.messages as Array<{ role: string, content: string }>
    expect(messages.filter(message => message.role === 'system')).toHaveLength(1)
    expect(messages[0]!.content).toContain('角色名稱：PB 小葵')
    expect(messages[0]!.content).toContain('以親切的店務助手口吻回覆。')
    expect(messages[0]!.content).toContain('目前服務為外站點餐網頁')
    if (withCard) {
      expect(messages[0]!.content).toContain('溫和簡潔')
      expect(messages[0]!.content).toContain('保持角色語氣')
      expect(messages[0]!.content).toContain('每次回覆都維持繁體中文與簡潔語氣。')
    }
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

  it('binds ASR vocabulary to the assigned site and rejects malformed or foreign menu context', async () => {
    const kioskService = createKioskService(db)
    const registration = await kioskService.registerDevelopmentDevice({ registrationCode: '483920' })
    const profile = await kioskService.getDeviceProfile(registration.device.id)
    await db.update(schema.kioskProfileReleases).set({ snapshot: { ...profile!.snapshot, interactiveService: { ...profile!.snapshot.interactiveService, catalogLabels: [{ name: '周氏水餃(最低8顆)', aliases: ['水餃'], category: '' }] } } }).where(eq(schema.kioskProfileReleases.id, profile!.id))
    const transcribe = vi.fn(async () => '十顆水餃兩份，不要魚丸湯')
    const app = new Hono().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'unexpected' }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: false, secureCookies: false, kioskService, llmGateway, runtimeModelPolicy, audioGateway: { transcribe, speak: vi.fn() } }))
    const send = (serviceId: string, menuNames: string) => {
      const body = new FormData()
      body.set('file', new File(['audio'], 'order.wav'))
      body.set('serviceId', serviceId)
      body.set('menuNames', menuNames)
      return app.request('/api/kiosk/audio/transcriptions', { method: 'POST', headers: { Cookie: `${kioskDeviceCookieName}=${registration.credential}` }, body })
    }
    const response = await send(profile!.snapshot.interactiveService.id, '["魚丸湯"]')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ text: '十顆水餃兩份，不要魚丸湯' })
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ modelName: 'restaurant-asr', vocabulary: ['魚丸湯', '周氏水餃', '水餃'] }))
    expect((await send('unassigned-site', '["魚丸湯"]')).status).toBe(400)
    expect((await send(profile!.snapshot.interactiveService.id, '{invalid')).status).toBe(400)
    expect((await send(profile!.snapshot.interactiveService.id, JSON.stringify(['字'.repeat(101)]))).status).toBe(400)
    expect(transcribe).toHaveBeenCalledOnce()
  })

  it('resolves ASR and TTS from the authenticated device policy without accepting client provider settings', async () => {
    const kioskService = createKioskService(db)
    const transcribe = vi.fn(async () => '我要一份牛肉麵')
    const speak = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'Content-Type': 'audio/mpeg' },
    }))
    const app = new Hono().onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'unexpected' }, 500)).route('/api/kiosk', createKioskRoutes({
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
    expect((await app.request('/api/kiosk/audio/recognition-policy', { headers: { Cookie: cookie } })).status).toBe(404)
    expect((await app.request('/api/kiosk/audio/falcon-transcriptions', { method: 'POST', headers: { Cookie: cookie } })).status).toBe(404)
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

  // Report: current Kiosk SSE audit; progress must arrive before a complete tool call.
  it('emits safe reply progress before provider DONE without dispatching partial tools', async () => {
    let upstream!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        upstream = controller
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers: { ...headers, Accept: 'text/event-stream' }, body: JSON.stringify({ content: '我要點餐' }) })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toContain('turn-started')
    upstream.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"partial","type":"function","function":{"name":"find_menu_item","arguments":"{"}}]}}]}\n\n'))
    const progress = decoder.decode((await reader.read()).value)
    expect(progress).toBe('data: {"type":"reply-progress"}\n\n')
    expect(progress).not.toContain('find_menu_item')
    expect(progress).not.toContain('tool-requested')
    upstream.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}]}\n\ndata: [DONE]\n\n'))
    upstream.close()
    let tail = ''
    while (true) {
      const chunk = await reader.read()
      if (chunk.done)
        break
      tail += decoder.decode(chunk.value)
    }
    expect(tail).not.toContain('reply-progress')
    expect(tail).toContain('tool-requested')
    expect(tail).toContain('turn-finished')
    expect(response.headers.get('X-Accel-Buffering')).toBe('no')
  })

  // Report: this chat, 2026-11-16 — ordinary replies should paint before DONE.
  it('emits ordinary reply text before the upstream stream completes', async () => {
    let upstream!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { upstream = controller },
    }), { headers: { 'Content-Type': 'text/event-stream' } }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers: { ...headers, Accept: 'text/event-stream' }, body: JSON.stringify({ content: '你好' }) })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toContain('turn-started')
    upstream.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"您好，"}}]}\n\n'))
    expect(decoder.decode((await reader.read()).value)).toContain('reply-progress')
    expect(decoder.decode((await reader.read()).value)).toContain('"text":"您好，","type":"assistant-delta"')
    upstream.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"歡迎。"}}]}\n\ndata: [DONE]\n\n'))
    upstream.close()
    let tail = ''
    while (true) {
      const chunk = await reader.read()
      if (chunk.done)
        break
      tail += decoder.decode(chunk.value)
    }
    expect(tail).toContain('"text":"歡迎。","type":"assistant-delta"')
    expect(tail).toContain('"answer":"您好，歡迎。"')
    expect(tail).toContain('turn-finished')
  })

  // Report: this chat, 2026-11-16 — DEV-642583 — safe service replies must stream even with browser context.
  it('streams a read-only service answer with browser context before provider DONE', async () => {
    let upstream!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { upstream = controller },
    }), { headers: { 'Content-Type': 'text/event-stream' } }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers: { ...headers, Accept: 'text/event-stream' }, body: JSON.stringify({ content: '你是誰', decisionState: { phase: 'ordering', readOnly: true, serviceReply: true, browserContext: { taskId: 'service', sourceUtterance: '你是誰', phase: 'browsing', readOnly: true, catalog: { complete: false, products: [] }, allowedToolNames: ['browser_cart_get'] } }, tools: [{ type: 'function', function: { name: 'browser_cart_get', parameters: { type: 'object', properties: {} } } }] }) })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toContain('turn-started')
    upstream.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"您好，"}}]}\n\n'))
    expect(decoder.decode((await reader.read()).value)).toContain('reply-progress')
    const firstDelta = await Promise.race([reader.read(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Safe service delta was withheld')), 1000))])
    expect(decoder.decode(firstDelta.value)).toContain('"text":"您好，","type":"assistant-delta"')
    upstream.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"歡迎。"}}]}\n\ndata: [DONE]\n\n'))
    upstream.close()
    let tail = ''
    while (true) {
      const chunk = await reader.read()
      if (chunk.done)
        break
      tail += decoder.decode(chunk.value)
    }
    expect(tail).toContain('"text":"歡迎。","type":"assistant-delta"')
    expect(tail).toContain('"answer":"您好，歡迎。"')
    expect(tail).toContain('turn-finished')
    expect(complete.mock.calls[0]![0].body).not.toHaveProperty('tools')
  })

  // Report: this chat, Nov17 case 6 — payment facts must not allow unchecked service-success prose.
  it.each(['payment', 'cart'])('requires a verified Host reply on %s pages even after a general-question decision', async (page) => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'payment-reply', type: 'function', function: { name: 'reply_to_customer', arguments: JSON.stringify({ kind: 'checkout-guidance' }) } }] } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '我要用信用卡付款', decisionState: { phase: 'ordering', readOnly: true, serviceReply: true, browserContext: { taskId: 'payment', sourceUtterance: '我要用信用卡付款', page, phase: page === 'payment' ? 'viewing_order' : 'configuring', readOnly: true, checkout: page === 'cart' ? { methods: [{ method: 'none', label: '無載具', selected: true }], fields: [], ready: false, missing: ['請選擇發票'], orderNote: '' } : undefined, order: page === 'payment' ? { reference: 'TEST-1', status: 20, total: 64, paymentStatus: 'pending', paymentMethods: ['信用卡'], invoice: {} } : undefined, catalog: { complete: false, products: [] }, allowedToolNames: ['reply_to_customer'] } }, tools: [{ type: 'function', function: { name: 'reply_to_customer', parameters: orderingTools.reply_to_customer.parameters } }] }) })
    expect(complete.mock.calls[0]![0].body.tools).toEqual(expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: 'reply_to_customer' }) })]))
  })

  it('finishes a Kiosk SSE turn when the selected provider returns one JSON completion', async () => {
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { content: '您好。' } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers: { ...headers, Accept: 'text/event-stream' }, body: JSON.stringify({ content: '你好' }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')
    const events = await response.text()
    expect(events).toContain('"type":"turn-finished"')
    expect(events).toContain('"answer":"您好。"')
    expect(events).not.toContain('"type":"assistant-delta"')
    expect(events).not.toContain('"type":"turn-failed"')
  })

  it('withholds draft prose when a later tool call can change the verified outcome', async () => {
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
    expect(replyEvents.match(/"type":"reply-progress"/g)).toHaveLength(1)
    expect(replyEvents).not.toContain('"type":"assistant-delta"')
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

// Report: this chat, Nov14 — public repair receipts must select an actually published tool.
describe('public PB repair contract', () => {
  it.each([{ action: 'add', name: 'add_items_to_cart' }, { action: 'quantity', name: 'set_cart_item_quantity' }, { action: 'remove', name: 'remove_items_from_cart' }, { action: 'replace', name: 'replace_item_in_cart' }])('selects $name for a $action correction', async ({ action, name }) => {
    const db = await mockDB(schema)
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { content: '' } }] }))
    const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
    const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const tools = ['add_items_to_cart', 'set_cart_item_quantity', 'remove_items_from_cart', 'replace_item_in_cart'].map(name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } }))
    const browserContext = { taskId: 'repair', sourceUtterance: '調整餐點', phase: 'browsing', readOnly: false, catalog: { complete: true, products: [] }, allowedToolNames: tools.map(tool => tool.function.name) }
    await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '調整餐點', tools, decisionState: { phase: 'ordering', browserContext }, toolResults: [{ toolCallId: 'repair', name: 'add_items_to_cart', content: JSON.stringify({ ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, requiredAction: action }) }] }) })
    expect(complete.mock.calls[0]![0].body.tool_choice).toEqual({ type: 'function', function: { name } })
  })
})

// Report: this chat, Nov14 audit — verify the HTTP/model boundary preserves the public schema.
it('preserves all published PB names and parameter schemas through the model request', async () => {
  const db = await mockDB(schema)
  const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { content: '' } }] }))
  const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
  const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
  const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
  const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
  const { session } = await started.json() as { session: { id: string } }
  const tools = Object.entries(orderingTools).map(([name, definition]) => ({ type: 'function', function: { name, description: definition.description, parameters: definition.parameters } }))
  const browserContext = { taskId: 'contract-audit', sourceUtterance: '看看菜單', phase: 'browsing', readOnly: false, catalog: { complete: true, products: [] }, allowedToolNames: tools.map(tool => tool.function.name) }
  const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '看看菜單', tools, decisionState: { phase: 'ordering', browserContext } }) })
  expect(response.status).toBe(200)
  expect(complete.mock.calls[0]![0].body.tools).toEqual(tools)
  expect(JSON.stringify(complete.mock.calls[0]![0].body.tools)).not.toContain('selectedOptions')
  expect(JSON.stringify(complete.mock.calls[0]![0].body.tools)).not.toContain('browser_')
})

// Report: this chat; public tools without a Browser snapshot got the owned Menu prompt.
it.each([
  ['menu list', ['list_menu_items', 'get_menu_item_details']],
  ['table', ['select_table', 'start_ordering_at_table', 'ask_customer_question', 'reply_to_customer']],
  ['item details', ['get_menu_item_details', 'open_menu_item_details']],
  ['cart', ['list_cart_items', 'open_cart', 'set_cart_item_quantity']],
  ['service reply', ['reply_to_customer']],
])('recognizes public PB %s tools without injecting owned Menu instructions', async (_scope, names) => {
  const db = await mockDB(schema)
  const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { content: '請問想查哪一道餐點？' } }] }))
  const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy }))
  const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"registrationCode":"483920"}' })
  const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
  const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: '{"serviceId":"development-ordering-service"}' })
  const { session } = await started.json() as { session: { id: string } }
  const tools = names.map(name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } }))
  await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '有什麼餐點？', tools }) })
  const system = complete.mock.calls[0][0].body.messages as Array<{ role: string, content: string }>
  expect(system[0].content).toContain('目前服務為外站點餐網頁')
  expect(system[0].content).not.toContain('使用menu_get或menu_recommend')
  // Missing page facts cannot select a browse workflow for a table/cart-only scope.
  expect(system[0].content).not.toContain('目前點餐流程：')
  expect(complete.mock.calls[0][0].body.tools).toEqual(tools)
})

// Report: this chat, 2026-11-18 — the third entry must retain its own device credential over HTTP.
it.each([
  ['http://172.17.69.17:5169', false],
  ['http://100.92.1.80:5169', false],
  ['https://kiosk.example.test', true],
  ['http://172.17.69.18:5169', true],
])('keeps enrollment cookie security scoped to configured origin %s', async (origin, secure) => {
  const db = await mockDB(schema)
  const service = createKioskService(db)
  const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({
    developmentRegistrationEnabled: true,
    secureCookies: true,
    kioskService: service,
    llmGateway: { complete: async () => Response.json({}) },
    runtimeModelPolicy: { modelFor: async () => 'test' },
    trustedOrigins: ['http://172.17.69.17:5169', 'http://100.92.1.80:5169'],
  }))
  const response = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Origin': origin, 'Content-Type': 'application/json' }, body: '{"registrationCode":"483931"}' })
  expect(response.status).toBe(201)
  expect(response.headers.get('Set-Cookie')?.includes('; Secure')).toBe(secure)
  expect(response.headers.get('Set-Cookie')).toContain('HttpOnly')
})
