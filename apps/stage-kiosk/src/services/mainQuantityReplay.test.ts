import type { KioskRoutesOptions } from '../../../server/src/routes/kiosk'

import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { rawTool } from '@xsai/tool'
import { parse } from 'valibot'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { menu } from '../../../order-menu/src/domain/order-machine'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { mockDB } from '../../../server/src/libs/mock-db'
import { createKioskRoutes } from '../../../server/src/routes/kiosk'
import { createKioskService } from '../../../server/src/services/domain/kiosk'
import { createEnvelopeCrypto } from '../../../server/src/utils/envelope-crypto'
import { useKioskInteractionRecording } from '../composables/useKioskInteractionRecording'
import { createMenuReplyWindow, operationReplyFrom, questionReceiptFrom, replyFromConversation } from './questionPresentation'

import * as schema from '../../../server/src/schemas'

const api = vi.hoisted(() => ({ startKioskVisitorSession: vi.fn(), appendKioskInteraction: vi.fn(), streamKioskConversationMessage: vi.fn() }))
vi.mock('./kiosk-device', () => api)

// Synthetic utterances only. The API/Session/Cart are isolated; only the selected
// Main provider is real. Never point this harness at the production Kiosk API.
describe.skipIf(process.env.KIOSK_MAIN_QUANTITY_REPLAY !== '1')('configured Main quantity recovery with the real Host loop', () => {
  let gateway: KioskRoutesOptions['llmGateway']
  let model: string
  let secret: Buffer | undefined
  let requests = 0
  beforeAll(async () => {
    const profile = JSON.parse(await readFile('/tmp/webnavior-main-scope-profile.json', 'utf8'))
    model = profile.model_id
    const crypto = createEnvelopeCrypto({ masterKey: Buffer.from(process.env.LLM_ROUTER_MASTER_KEY!, 'base64') })
    secret = profile.api_key_ciphertext ? crypto.decryptKey(profile.api_key_ciphertext, { keyEntryId: 'default', modelName: `webnavior-ai:provider-profile:${profile.id}` }) : undefined
    gateway = { complete: async ({ body, abortSignal }) => {
      requests++
      return await fetch(`${profile.base_url.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret.toString()}` } : {}) }, body: JSON.stringify({ ...body, model, chat_template_kwargs: { enable_thinking: profile.enable_thinking } }), signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(abortSignal ? [abortSignal] : [])]) })
    } }
  })
  afterAll(() => secret?.fill(0))

  // Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct30.
  it.each(['addition', 'quantity'] as const)('completes synthetic %s with authoritative Cart and receipt checks', async (scenario) => {
    vi.resetAllMocks()
    requests = 0
    const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], category: '點心', price: 80, optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('menu_get', { query: '水餃' })
    if (scenario === 'quantity')
      await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 3 })
    const content = scenario === 'addition' ? '那就幫我點三份' : '這份數量改成兩份'
    const initial = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: `synthetic-${scenario}`, transcript: content, expectedMenuRevision: initial.revisions.menu, constraints: {} })
    const db = await mockDB(schema)
    const app = createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: gateway, runtimeModelPolicy: { modelFor: async () => model } })
    const enrolled = await app.request('/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    for (const entry of [{ kind: 'user_text', content: '請查水餃' }, { kind: 'assistant_text', content: '水餃目前可以點。' }])
      expect((await app.request(`/visitor-sessions/${session.id}/entries`, { method: 'POST', headers, body: JSON.stringify(entry) })).status).toBe(201)
    api.startKioskVisitorSession.mockResolvedValue({ session })
    api.appendKioskInteraction.mockImplementation(async entry => await app.request(`/visitor-sessions/${session.id}/entries`, { method: 'POST', headers, body: JSON.stringify(entry) }))
    api.streamKioskConversationMessage.mockImplementation(async ({ signal, ...body }) => {
      const response = await app.request(`/visitor-sessions/${session.id}/messages`, { method: 'POST', signal, headers, body: JSON.stringify(body) })
      expect(response.status).toBe(200)
      return await response.json()
    })
    const receipts = createMenuReplyWindow()
    let outcome: string | undefined
    let question: ReturnType<typeof questionReceiptFrom>
    const scope = effectScope()
    const startedAt = performance.now()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      const result = await recording.send('development-ordering-service', content, [], {
        taskId: `synthetic-${scenario}`,
        prepareRound: async () => {
          const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
          const tools = runtime.toolDefinitions.filter(tool => context.allowedToolNames.includes(tool.name)).map(tool => rawTool({ name: tool.name, description: tool.description, parameters: tool.inputSchema, execute: async (args: Record<string, unknown>) => runtime.invokeForAgent(tool.name, args) }))
          return { decisionState: { phase: context.phase, context }, tools }
        },
        onToolResult: (name, content) => {
          const receipt = JSON.parse(content)
          receipts.record(name, receipt)
          outcome = operationReplyFrom(receipt) ?? outcome
          question = questionReceiptFrom(receipt) ?? question
        },
      })
      const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
      console.info(JSON.stringify({ scenario, status: result?.status, reason: result?.reason, tools: result?.requestedTools, itemCount: context.cart.itemCount, providerRequests: requests, durationMs: Math.round(performance.now() - startedAt) }))
      expect(result?.status).toBe('completed')
      expect(context.cart.itemCount).toBe(scenario === 'addition' ? 3 : 2)
      const displayed = replyFromConversation(result!, { menu: receipts, context, outcome, question, failureMessage: '需求尚未完成。' })
      expect(displayed.role).toBe('assistant')
      expect(displayed.content).not.toContain('剛才沒有理解清楚')
      expect(receipts.hasOperation(scenario === 'addition' ? 'ADD_ITEM' : 'SET_QUANTITY')).toBe(true)
    }
    finally { scope.stop() }
  }, 70_000)
})
