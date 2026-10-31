import type { CatalogSnapshot } from '../../../order-menu-server/src/domain/contracts'
import type { MenuToolName } from '../../../order-menu/src/toolDefinitions'
import type { KioskRoutesOptions } from '../../../server/src/routes/kiosk'
import type { KioskConversationDecisionState, KioskInteractionDecision } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'

import { Buffer } from 'node:buffer'
import { appendFileSync, writeFileSync } from 'node:fs'

import { conversationContextSchema, serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { rawTool } from '@xsai/tool'
import { object, parse, safeParse, string, unknown } from 'valibot'
import { expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { createPosSimulator } from '../../../order-menu-server/src/simulator'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { createDrizzle } from '../../../server/src/libs/db'
import { mockDB } from '../../../server/src/libs/mock-db'
import { createKioskRoutes } from '../../../server/src/routes/kiosk'
import { createKioskService } from '../../../server/src/services/domain/kiosk'
import { createKioskSystemOneService } from '../../../server/src/services/domain/kiosk-system-one'
import { createEnvelopeCrypto } from '../../../server/src/utils/envelope-crypto'
import { useKioskInteractionRecording } from '../composables/useKioskInteractionRecording'
import { conversationDecisionStateFrom, refreshConversationState, runFastPath } from './kiosk-fast-path'
import { createMenuReplyWindow, createServiceClarificationWindow, operationReplyFrom, questionReceiptFrom, replyFromConversation } from './questionPresentation'

import * as schema from '../../../server/src/schemas'

const api = vi.hoisted(() => ({ startKioskVisitorSession: vi.fn(), appendKioskInteraction: vi.fn(), streamKioskConversationMessage: vi.fn() }))
vi.mock('./kiosk-device', () => api)

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct30 budget flow.
// Opt-in: only profiles/policy are selected from live DB. All sessions, Menu,
// cart and profile copies are scratch; providers receive synthetic utterances.
it.skipIf(process.env.KIOSK_BUDGET_ORDER_REPLAY !== '1')('completes the current-menu budget, alternatives and quantity conversation', async () => {
  const output = process.env.KIOSK_BUDGET_REPLAY_OUTPUT!
  if (!output)
    throw new Error('A new private output file is required.')
  writeFileSync(output, '', { flag: 'wx', mode: 0o600 })
  const record = (type: string, value: unknown) => appendFileSync(output, `${JSON.stringify({ type, value })}\n`)
  const live = createDrizzle({ DATABASE_URL: process.env.DATABASE_URL!, DB_POOL_MAX: 1, DB_POOL_CONNECTION_TIMEOUT_MS: 5000, DB_POOL_IDLE_TIMEOUT_MS: 10000, DB_POOL_KEEPALIVE_INITIAL_DELAY_MS: 0 })
  const envelopeCrypto = createEnvelopeCrypto({ masterKey: Buffer.from(process.env.LLM_ROUTER_MASTER_KEY!, 'base64') })
  const profiles = await (async () => {
    try {
      const active = await live.db.query.kioskSystemOneProfiles.findFirst({ where: (fields, { eq }) => eq(fields.isActive, true) })
      const selected = await live.db.query.webnaviorAiCapabilitySelections.findFirst({ where: (fields, { eq }) => eq(fields.capability, 'chat'), with: { providerProfile: true } })
      const sourceSession = await live.db.query.kioskVisitorSessions.findFirst({ where: (fields, { eq }) => eq(fields.id, 'eCda22nNnyhWzB5rMVvsM') })
      const profile = sourceSession && await live.db.query.kioskProfileReleases.findFirst({ where: (fields, { eq }) => eq(fields.id, sourceSession.profileReleaseId) })
      const policy = await createKioskSystemOneService({ db: live.db, envelopeCrypto }).getPolicy()
      if (!active || active.implementation === 'slm' || !selected?.providerProfile.modelId || !profile)
        throw new Error('Expected existing active JEV/Main and field profile; no configuration will be changed.')
      return { active, main: selected.providerProfile, profile, policy }
    }
    finally { await live.pool.end() }
  })()
  const { active, main, profile, policy } = profiles
  record('configuration', { jev: { implementation: active.implementation, model: active.modelId, origin: new URL(active.baseURL).origin }, main: { model: main.modelId, origin: new URL(main.baseURL).origin, thinking: main.enableThinking }, personaRelease: profile.id, synthetic: true })
  const secret = main.apiKeyCiphertext ? envelopeCrypto.decryptKey(main.apiKeyCiphertext, { keyEntryId: 'default', modelName: `webnavior-ai:provider-profile:${main.id}` }) : undefined
  const startedAt = Date.now()
  let requests = 0
  let turn = 0
  const requestLimit = Number(process.env.KIOSK_BUDGET_REPLAY_REQUEST_LIMIT ?? 80)
  const durationLimit = Number(process.env.KIOSK_BUDGET_REPLAY_DURATION_LIMIT ?? 300_000)
  if (!Number.isInteger(requestLimit) || requestLimit < 1 || requestLimit > 80 || !Number.isFinite(durationLimit) || durationLimit < 1 || durationLimit > 300_000)
    throw new Error('Replay limits must remain within the authorized ceiling.')
  const budget = () => {
    if (requests >= requestLimit || Date.now() - startedAt > durationLimit)
      throw new Error('Frozen replay limit reached (80 requests/5 minutes).')
    requests++
  }
  const db = await mockDB(schema)
  await db.insert(schema.kioskSystemOneProfiles).values(active)
  const systemOne = createKioskSystemOneService({ db, envelopeCrypto, fetchImpl: async (...args) => {
    budget()
    return await fetch(...args)
  }, traceObserver: { record: trace => record('jev', { turn, trace }) } })
  await systemOne.savePolicy(policy)
  const gateway: KioskRoutesOptions['llmGateway'] = { complete: async ({ body, abortSignal }) => {
    budget()
    const request = { ...body, model: main.modelId, ...(main.kind === 'openai-compatible' ? { chat_template_kwargs: { enable_thinking: main.enableThinking } } : {}) }
    record('mainRequest', { turn, request })
    const response = await fetch(new URL('chat/completions', `${main.baseURL.replace(/\/+$/, '')}/`), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret.toString()}` } : {}) }, body: JSON.stringify(request), signal: AbortSignal.any([AbortSignal.timeout(main.timeoutMs), ...(abortSignal ? [abortSignal] : [])]) })
    record('mainResponse', { turn, status: response.status, body: await response.clone().text() })
    return response
  } }
  const kioskService = createKioskService(db)
  const app = createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, systemOne, llmGateway: gateway, runtimeModelPolicy: { modelFor: async () => main.modelId! } })
  const registered = await app.request('/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
  expect(registered.status).toBe(201)
  const headers = { 'Cookie': registered.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
  const { device } = await registered.json() as { device: { id: string } }
  const assigned = await kioskService.getDeviceProfile(device.id)
  expect(assigned).toBeDefined()
  await db.update(schema.kioskProfileReleases).set({ snapshot: { ...profile.snapshot, interactiveService: { ...profile.snapshot.interactiveService, id: 'development-ordering-service' } } })
  const start = await app.request('/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
  expect(start.status).toBe(201)
  const { session } = await start.json() as { session: { id: string } }
  const append = async (kind: string, content: string, metadata = {}) => {
    const response = await app.request(`/visitor-sessions/${session.id}/entries`, { method: 'POST', headers, body: JSON.stringify({ kind, content, metadata }) })
    expect(response.status).toBe(201)
  }
  const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  expect(catalog.items).toHaveLength(7)
  const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const snapshot = async () => parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const clarification = createServiceClarificationWindow()
  api.startKioskVisitorSession.mockResolvedValue({ session })
  api.appendKioskInteraction.mockImplementation(async entry => await app.request(`/visitor-sessions/${session.id}/entries`, { method: 'POST', headers, body: JSON.stringify(entry) }))
  api.streamKioskConversationMessage.mockImplementation(async ({ signal, ...body }) => {
    const response = await app.request(`/visitor-sessions/${session.id}/messages`, { method: 'POST', signal, headers, body: JSON.stringify(body) })
    expect(response.status).toBe(200)
    return await response.json()
  })
  const scope = effectScope()
  const recording = scope.run(() => useKioskInteractionRecording())!
  const seen = new Set<string>()
  // This is a fixture precondition: entry already completed, no previous topic/cart.
  const utterances = ['我有一百元，可以吃什麼', '有其他的嗎', '改成兩百元以內，看看其他餐點', '還有其他的嗎', '我要水餃', '兩份']
  const skillProbe = process.env.KIOSK_BUDGET_REPLAY_FLOW === 'meal-skill'
  let stages = [1, 2, 3, 4, 5, 6]
  if (skillProbe)
    stages = [5]
  else if (process.env.KIOSK_BUDGET_REPLAY_FLOW === 'core')
    stages = [1, 2, 5, 6]
  record('flow', { stages, freshProviders: true, seededPrefix: skillProbe })
  try {
    if (skillProbe) {
    // Reconstruct the two successful synthetic turns from core-cart as fixture
    // setup. Only the subsequent meal request uses live models; this is a
    // single-turn skill probe, never a full-flow live acceptance claim.
      const prefix = [
        { text: utterances[0]!, args: { action: 'update', maxPrice: 100 } },
        { text: utterances[1]!, args: { action: 'update', maxPrice: 100, excludeItemIds: ['dumplings'] } },
      ]
      for (const step of prefix) {
        const receipt = await runtime.invokeForAgent('menu_recommend', step.args)
        const message = receipt as { customerMessage: string }
        await append('asr_transcript', step.text, { decisionRoute: 'fast_path' })
        await append('assistant_text', message.customerMessage)
        await runtime.invoke('kiosk_dialogue_presented', { content: message.customerMessage })
        record('fixturePrefix', { text: step.text, receipt })
      }
    }
    for (const stage of stages) {
      const text = utterances[stage - 1]!
      turn++
      const turnDeadlineAt = Date.now() + 60_000
      let recordedInput = false
      const before = await snapshot()
      const tools: string[] = []
      const fast = await runFastPath({ transcript: text, onTrace: trace => record('fastTrace', { turn, trace }), isEnabled: () => systemOne.isEnabled(), serviceClarification: state => clarification.current(state), decide: async ({ signal, ...request }) => {
        const response = await app.request('/interaction-decisions', { method: 'POST', headers, signal, body: JSON.stringify({ ...request, utteranceId: turn, visitorSessionId: session.id }) })
        expect(response.status).toBe(200)
        return await response.json() as KioskInteractionDecision
      }, onExecuted: async (result) => {
        record('fastReceipt', { turn, result })
        if (!recordedInput) {
          await append('asr_transcript', text, { utteranceId: turn, decisionRoute: 'fast_path' })
          recordedInput = true
        }
        const trace = safeParse(object({ decisionTrace: object({ operationPlan: object({ toolName: string(), input: unknown() }) }) }), result)
        if (trace.success) {
          const operation = trace.output.decisionTrace.operationPlan
          await append('tool_call', JSON.stringify(operation.input), { name: operation.toolName, decisionRoute: 'fast_path' })
          await append('tool_result', JSON.stringify(result), { name: operation.toolName, decisionRoute: 'fast_path' })
        }
      }, webMcp: { tools: runtime.toolDefinitions.map(t => ({ ...t, origin: 'https://ordering.test' })), execute: async (tool, input) => {
        tools.push(tool.name)
        return await runtime.invoke(tool.name as MenuToolName, input)
      } } })
      record('decision', { turn, text, fast })
      let answer = ''
      let question: ReturnType<typeof questionReceiptFrom>
      if (fast.kind === 'NEEDS_ASSISTANT') {
        const state = conversationDecisionStateFrom(fast.decisionState, fast) ?? { phase: 'ordering' }
        const taskId = `budget-order-${turn}`
        await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId, transcript: text, expectedMenuRevision: before.revisions.menu, readOnly: state.readOnly === true, ...(state.handoff ? { handoff: state.handoff } : {}), constraints: { excludeIngredients: state.constraints?.exclude ?? [], includeIngredients: state.constraints?.include ?? [], ...state.constraints?.price, ...(state.constraints?.unresolvedPrice ? { unresolvedPrice: true } : {}) } })
        const receipts = createMenuReplyWindow()
        let outcome: string | undefined
        try {
          const result = await recording.send('development-ordering-service', text, [], { taskId, utteranceId: turn, budgetMs: Math.max(1, turnDeadlineAt - Date.now()), prepareRound: async () => {
            const context = await snapshot()
            const decisionState: KioskConversationDecisionState = refreshConversationState(context, state)
            return { decisionState, tools: runtime.toolDefinitions.filter(t => context.allowedToolNames.includes(t.name)).map(t => rawTool({ name: t.name, description: t.description, parameters: t.inputSchema, execute: async (args: Record<string, unknown>) => {
              const result = await runtime.invokeForAgent(t.name, args)
              record('toolReceipt', { turn, name: t.name, args, result })
              return result
            } })) }
          }, onToolResult: (name, content) => {
            const result = JSON.parse(content)
            tools.push(name)
            receipts.record(name, result)
            question = questionReceiptFrom(result) ?? question
            if (!['menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get', 'seating_get'].includes(name))
              outcome = operationReplyFrom(result) ?? outcome
          } })
          const context = await snapshot()
          record('hostResult', { turn, result })
          expect(result?.status).toBe('completed')
          const displayed = replyFromConversation(result!, { menu: receipts, context, question, outcome, handoff: state.handoff, requireMenuRead: state.requireMenuRead, serviceReply: state.serviceReply, failureMessage: '需求尚未完成。' })
          expect(displayed.role).toBe('assistant')
          answer = displayed.content
          if (displayed.clarification || result?.reply?.kind === 'clarification')
            clarification.present({ questionId: crypto.randomUUID(), question: answer, sourceUtterance: text, contextKey: serviceContextKey(context), expiresAt: Date.now() + 30000 })
        }
        finally { await runtime.invoke('kiosk_agent_task', { action: 'END', taskId }) }
      }
      else {
        if (!recordedInput)
          await append('asr_transcript', text, { utteranceId: turn })
        if (fast.kind === 'FAST_ACTION') {
          answer = operationReplyFrom(fast.result) ?? ''
          question = questionReceiptFrom(fast.result)
        }
        else if (fast.kind === 'CLARIFICATION') {
          answer = fast.prompt
          question = fast.question
        }
        else if (fast.kind === 'SERVICE_CLARIFICATION') {
          clarification.present(fast.question)
          answer = fast.question.question
        }
      }
      if (answer) {
        await append('assistant_text', answer)
        await runtime.invoke('kiosk_dialogue_presented', { content: answer, ...(question ? { questionId: question.questionId } : {}) })
      }
      const after = await snapshot()
      record('turn', { turn, text, answer, tools, before, after })
      console.info(JSON.stringify({ turn, text, answer, decision: fast.kind, tools, shown: after.presentation?.itemIds, itemCount: after.cart.itemCount, requests }))
      expect(answer).not.toBe('')
      expect(answer).not.toContain('剛才沒有理解清楚')
      if (stage === 1) {
        expect(after.presentation?.itemIds).toEqual(['dumplings'])
        expect(after.cart.itemCount).toBe(0)
        seen.add('dumplings')
      }
      if (stage === 2) {
        expect(after.cart.itemCount).toBe(0)
        expect(answer).toMatch(/沒有|找不到|調整|換.*(?:類|條件|價位)|想看.*(?:類|價位)/)
        for (const id of after.presentation?.itemIds ?? [])
          expect(catalog.items.find(item => item.id === id)!.price).toBeLessThanOrEqual(100)
      }
      if (stage === 3 || stage === 4) {
        const shown = after.presentation?.itemIds ?? []
        expect(shown.length).toBeGreaterThan(0)
        for (const id of shown) {
          expect(seen.has(id)).toBe(false)
          expect(catalog.items.find(item => item.id === id)!.price).toBeLessThanOrEqual(200)
          seen.add(id)
        }
        expect(after.cart.itemCount).toBe(0)
      }
      if (stage === 5) {
        expect(after.waitingFor?.purpose).toMatch(/quantity|configuration/)
        expect(after.cart.itemCount).toBe(0)
      }
      if (stage === 6) {
        expect(after.cart.lines).toMatchObject([{ itemId: 'dumplings', quantity: 2 }])
        expect(after.cart.itemCount).toBe(2)
        expect(after.cart.total).toBe(2 * catalog.items.find(item => item.id === 'dumplings')!.price)
        expect(answer).not.toMatch(/推薦一項/)
      }
    }
  }
  finally {
    scope.stop()
    secret?.fill(0)
    record('summary', { requests, durationMs: Date.now() - startedAt })
  }
}, 360_000)
