import type { ContextReply } from '@proj-airi/stage-shared/kiosk-conversation'

import type { CatalogSnapshot } from '../../../order-menu-server/src/domain/contracts'
import type { RecommendationPresentation } from '../../../order-menu/src/webmcp'
import type { DecisionConversation } from '../../src/services/domain/kiosk-interaction-decision/context'
import type { KioskConversationDecisionState, KioskInteractionDecision } from '../../src/services/domain/kiosk-interaction-decision/contracts'
import type { PriceConditions } from '../../src/services/domain/kiosk-interaction-decision/priceContracts'
import type { SystemOnePolicyInput, SystemOneQuestion } from '../../src/services/domain/kiosk-system-one'

import { Buffer } from 'node:buffer'

import Redis from 'ioredis'

import { errorMessageFrom } from '@moeru/std'
import { conversationContextSchema, serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { parse } from 'valibot'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPosSimulator } from '../../../order-menu-server/src/simulator'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { conversationDecisionStateFrom, refreshConversationState, runFastPath } from '../../../stage-kiosk/src/services/kiosk-fast-path'
import { resumeConversationRetry } from '../../../stage-kiosk/src/services/kioskConversationRetry'
import { createMenuReplyWindow, operationReplyFrom, questionReceiptFrom, replyFromConversation } from '../../../stage-kiosk/src/services/questionPresentation'
import { createDrizzle } from '../../src/libs/db'
import { mockDB } from '../../src/libs/mock-db'
import { createKioskRoutes } from '../../src/routes/kiosk'
import { createConfigKVService } from '../../src/services/adapters/config-kv'
import { createKioskService } from '../../src/services/domain/kiosk'
import { decideInteraction } from '../../src/services/domain/kiosk-interaction-decision'
import { createKioskSystemOneService } from '../../src/services/domain/kiosk-system-one'
import { createConcurrencyLedger } from '../../src/services/domain/llm-router/concurrency-ledger'
import { createLlmRouterService } from '../../src/services/domain/llm-router/router'
import { createWebnaviorAiRuntimeService } from '../../src/services/domain/webnavior-ai-control/runtime'
import { createEnvelopeCrypto } from '../../src/utils/envelope-crypto'
import { conversationCases } from './kioskConversationCases'
import { choose as chooseSlm } from './slmDecision'

import * as schema from '../../src/schemas'

// This cross-app replay lives outside Server src: it deliberately composes
// browser/host and Node runtime boundaries rather than importing DOM code into
// the Node-only Server project. Opt-in reads live provider configuration, but
// every visitor, profile health update and dialogue entry belongs to the
// isolated in-memory database.
describe.skipIf(process.env.KIOSK_PROVIDER_REPLAY !== '1')('configured kiosk provider replay', () => {
  let live: ReturnType<typeof createDrizzle>
  let redis: Redis
  let app: Hono
  let headers: Record<string, string>
  let sessionId: string
  let systemOne: ReturnType<typeof createKioskSystemOneService>
  let configuredPolicy: SystemOnePolicyInput
  let runtime: ReturnType<typeof createMenuToolRuntime>
  let ready = false
  let providerCalls = 0
  const runStarted = Date.now()
  let jevFailures = 0
  let stopped: string | undefined
  let shadowCalls = 0
  let shadowFailures = 0
  const shadowEnabled = process.env.KIOSK_SLM_SHADOW === '1'
  const shadowPending: Array<{ questionId: string, question: SystemOneQuestion, state: string, baseline?: string }> = []
  function countProviderCall() {
    if (stopped || providerCalls >= 600 || Date.now() - runStarted > 30 * 60_000)
      throw new Error(stopped ?? 'Provider replay budget exhausted')
    providerCalls++
  }
  let jevRequests: Array<{ questions: string[], durationMs: number }> = []
  let jevAnswers: Array<Record<string, unknown> | undefined> = []

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !process.env.REDIS_URL || !process.env.LLM_ROUTER_MASTER_KEY)
      throw new Error('Load the local Server environment before enabling provider replay.')
    live = createDrizzle({ DATABASE_URL: process.env.DATABASE_URL, DB_POOL_MAX: 1, DB_POOL_IDLE_TIMEOUT_MS: 1000, DB_POOL_CONNECTION_TIMEOUT_MS: 5000, DB_POOL_KEEPALIVE_INITIAL_DELAY_MS: 1000 })
    redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 })
    const configKV = createConfigKVService(redis)
    const envelopeCrypto = createEnvelopeCrypto({ masterKey: Buffer.from(process.env.LLM_ROUTER_MASTER_KEY, 'base64'), ...(process.env.LLM_ROUTER_MASTER_KEY_PREVIOUS ? { previousMasterKey: Buffer.from(process.env.LLM_ROUTER_MASTER_KEY_PREVIOUS, 'base64') } : {}) })
    configuredPolicy = await createKioskSystemOneService({ db: live.db, envelopeCrypto }).getPolicy()
    const db = await mockDB(schema)
    const active = await live.db.query.kioskSystemOneProfiles.findFirst({ where: eq(schema.kioskSystemOneProfiles.isActive, true) })
    if (!active)
      throw new Error('No configured active Jev provider.')
    await db.insert(schema.kioskSystemOneProfiles).values(active)
    process.stdout.write(`[configured-jev-endpoint] ${new URL(active.baseURL).origin}\n`)
    const configuredOne = createKioskSystemOneService({ db, envelopeCrypto, fetchImpl: async (...args) => {
      countProviderCall()
      return fetch(...args)
    }, traceObserver: { record: (trace) => {
      if (trace.phase === 'failed' || (trace.phase === 'response' && trace.status >= 400))
        process.stdout.write(`[jev-provider-error] ${JSON.stringify(trace.phase === 'failed' ? { error: trace.error } : { status: trace.status, payload: trace.payload })}\n`)
    } } })
    systemOne = { ...configuredOne, decide: async (...args) => {
      try {
        const result = await configuredOne.decide(...args)
        jevFailures = 0
        // Capture immutable inputs now; SLM runs after the Jev scenarios so its
        // prefill cost cannot change checkpoint deadlines or Jev/Main outcomes.
        if (shadowEnabled) {
          for (const [questionId, question] of Object.entries(args[1])) {
            if (shadowPending.length >= 24)
              break
            const baseline = result.answers?.[questionId]
            const choice = baseline && typeof baseline === 'object' && 'choice' in baseline && typeof baseline.choice === 'string' ? baseline.choice : undefined
            shadowPending.push({ questionId, question: structuredClone(question), state: args[0], baseline: choice })
          }
        }
        return result
      }
      catch (error) {
        jevFailures++
        if (jevFailures >= 3)
          stopped = 'Three consecutive Jev provider failures'
        process.stdout.write(`[jev-call-failed] ${JSON.stringify({ consecutive: jevFailures })}\n`)
        throw error
      }
    } }
    const loaded = await systemOne.inspectRuntimeModel(active)
    process.stdout.write(`[configured-jev] ${JSON.stringify({ implementation: active.implementation, configuredModel: active.modelId, loadedModel: loaded.modelId })}\n`)
    await systemOne.savePolicy(configuredPolicy)
    const router = createLlmRouterService({ configKV, envelopeCrypto, redis, gatewayMetrics: null, concurrencyLedger: createConcurrencyLedger(redis), fetchImpl: async (...args) => {
      countProviderCall()
      return fetch(...args)
    } })
    const runtimeModelPolicy = createWebnaviorAiRuntimeService({ configKV, envelopeCrypto, redis, db: live.db })
    const chatAlias = await runtimeModelPolicy.modelFor('chat')
    const routerConfig = await configKV.getOrThrow('LLM_ROUTER_CONFIG')
    process.stdout.write(`[provider-replay] ${JSON.stringify({ chatAlias, model: chatAlias ? routerConfig.llm.models[chatAlias]?.upstreams.map(upstream => upstream.overrideModel ?? chatAlias) : [] })}\n`)
    app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), systemOne, runtimeModelPolicy, llmGateway: { complete: async (input) => {
      const response = await router.route(input)
      if ([400, 401, 403, 404, 429].includes(response.status))
        stopped = `Provider HTTP ${response.status}`
      return response
    } } }))
    const registered = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '654321' }) })
    expect(registered.status).toBe(201)
    headers = { 'Cookie': registered.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json', 'Accept': 'text/event-stream' }
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    expect(started.status).toBe(201)
    sessionId = (await started.json() as { session: { id: string } }).session.id
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    runtime = createMenuToolRuntime({ menu: catalog.items, orderingReady: () => ready, onCustomerEntrySkipped: () => ready = true, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  }, 30_000)

  afterAll(async () => {
    for (const checkpoint of shadowPending) {
      if (shadowFailures >= 3)
        break
      shadowCalls++
      try {
        const shadow = await chooseSlm({ baseURL: process.env.KIOSK_SLM_URL ?? 'http://127.0.0.1:12434/engines/v1', modelId: process.env.KIOSK_SLM_MODEL ?? 'huggingface.co/unsloth/qwen3.5-4b-gguf:latest', timeoutMs: 60_000, format: 'label', state: checkpoint.state, question: checkpoint.question, fetchImpl: async (...request) => {
          countProviderCall()
          return fetch(...request)
        } })
        process.stdout.write(`[slm-shadow] ${JSON.stringify({ questionId: checkpoint.questionId, jevChoice: checkpoint.baseline, slmChoice: shadow.choice, agreement: checkpoint.baseline === shadow.choice, ...shadow, scope: 'same Jev-path checkpoint; agreement only, NOT gold accuracy; captured before SLM evaluation, no application effect' })}\n`)
        shadowFailures = 0
      }
      catch (error) {
        shadowFailures++
        process.stdout.write(`[slm-shadow-failed] ${JSON.stringify({ questionId: checkpoint.questionId, consecutive: shadowFailures, error: errorMessageFrom(error) })}\n`)
      }
    }
    if (shadowEnabled)
      process.stdout.write(`[slm-shadow-complete] ${JSON.stringify({ captured: shadowPending.length, attempted: shadowCalls, stopped: shadowFailures >= 3, providerCalls })}\n`)
    await live?.pool.end()
    if (redis)
      await redis.quit()
  }, 600_000)

  async function decide(transcript: string, conversation?: DecisionConversation, policy: SystemOnePolicyInput = { decisionInstruction: '', storeInstruction: '' }) {
    jevRequests = []
    jevAnswers = []
    const tools = runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://ordering.test' }))
    return await runFastPath({ transcript, isEnabled: async () => true, webMcp: { tools, execute: (tool, input) => runtime.invoke(runtime.toolDefinitions.find(definition => definition.name === tool.name)!.name, input) }, decide: request => decideInteraction({ ...request, conversation, policy, invoke: async (state, questions) => {
      const started = performance.now()
      const result = await systemOne.decide(state, questions)
      jevRequests.push({ questions: Object.keys(questions), durationMs: Math.round(performance.now() - started) })
      jevAnswers.push(result.answers)
      return result
    } }) })
  }

  // Report: this chat, 2026-10-19, visitor session hIHA3DAvjhrG8x0RjggBa.
  it('grounds an unmatched food refusal after a bento recommendation instead of inventing noodles', async () => {
    ready = true
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    runtime = createMenuToolRuntime({ menu: catalog.items, screen: () => 'menu', onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('menu_recommend', {})
    const decision = await decide('我不想吃飯', { messages: [{ role: 'user', content: '推薦一下' }, { role: 'assistant', content: '推薦3項：周氏蝦捲招牌便當、椒麻雞便當、泰式酸辣魚便當。' }] }, configuredPolicy)
    process.stdout.write(`[food-refusal] ${JSON.stringify({ kind: decision.kind, reason: decision.reason, jevAnswers })}\n`)
    expect(['NEEDS_ASSISTANT', 'IGNORE']).toContain(decision.kind)
    if (decision.kind === 'NEEDS_ASSISTANT') {
      expect(decision.reason).not.toBe('GENERAL_QUESTION')
      const state = conversationDecisionStateFrom(decision.decisionState, decision)!
      expect(state).toMatchObject({ requireMenuRead: true })
      const reply = await agent('我不想吃飯', state)
      process.stdout.write(`[food-refusal-main] ${JSON.stringify(reply)}\n`)
      expect(reply.calls.some(call => ['menu_get', 'menu_recommend'].includes(call.name))).toBe(true)
      expect(reply.answer).not.toContain('麻醬麵')
      expect(reply.answer).not.toContain('酸辣湯麵')
    }
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  }, 60_000)

  // Report: attachment a4c50e1a, 有魚排便當？ while fulfillment is pending.
  it('recovers unfamiliar menu inquiries without requiring a fulfillment answer or changing the cart', async () => {
    ready = true
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    for (const scenario of [
      { speech: '有魚排便當？', waiting: true },
      { speech: '有沒有魚排便當？', waiting: true },
      { speech: '有雞腿飯嗎？', waiting: true },
      { speech: '有魚排便當？', waiting: false },
    ]) {
      runtime = createMenuToolRuntime({ menu: catalog.items, screen: () => 'menu', onMenuRequested: () => {}, onMenuScroll: () => ({ status: 'BOUNDARY', position: 0 }), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      let conversation: DecisionConversation | undefined
      if (scenario.waiting) {
        const first = await runtime.invoke('order_add_item', { itemId: 'fried-pork-chop-bento', quantity: 1 })
        const question = questionReceiptFrom(first)!
        await runtime.invoke('kiosk_dialogue_presented', { content: question.question, questionId: question.questionId })
        conversation = { messages: [{ role: 'user', content: '有賣什麼便當' }, { role: 'assistant', content: '我找到周氏蝦捲招牌便當、椒麻雞便當、泰式酸辣魚便當、炸排骨便當、打拋豬便當。' }, { role: 'user', content: '一份排骨便當' }, { role: 'assistant', content: `已將炸排骨便當加入購物車，共 1 份。 ${question.question}` }] }
      }
      const before = await runtime.invoke('cart_get', { display: false }) as { cart: unknown }
      const decision = await decide(scenario.speech, conversation, configuredPolicy)
      process.stdout.write(`[unfamiliar-query] ${JSON.stringify({ ...scenario, kind: decision.kind, reason: decision.reason, jevRequests, jevAnswers })}\n`)
      expect(decision.kind, JSON.stringify(decision)).toBe('NEEDS_ASSISTANT')
      expect(['MENU_QUERY', 'UNCERTAIN_FILTER', 'UNRESOLVED_FILTER']).toContain(decision.reason)
      const state = conversationDecisionStateFrom(decision.decisionState, decision)!
      expect(state).toMatchObject({ readOnly: true, requireMenuRead: true })
      const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
      sessionId = (await started.json() as { session: { id: string } }).session.id
      const reply = await agent(scenario.speech, state)
      process.stdout.write(`[unfamiliar-query-main] ${JSON.stringify({ ...scenario, ...reply })}\n`)
      expect(reply.calls.some(call => call.name === 'menu_get')).toBe(true)
      expect(reply.calls.every(call => ['menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get', 'seating_get'].includes(call.name))).toBe(true)
      expect(reply.answer).toContain('查不到')
      expect(reply.answer).toContain(scenario.speech.includes('魚排') ? '魚排' : '雞腿')
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: before.cart })
    }
  }, 60_000)

  it('retains finite browsing, price and ingredient queries after unfamiliar-subject recovery', async () => {
    ready = true
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    for (const speech of ['有便當嗎？', '有哪些餐點？', '有100到130元的嗎？', '有含魚的便當嗎？']) {
      runtime = createMenuToolRuntime({ menu: catalog.items, screen: () => 'menu', onMenuRequested: () => {}, onMenuScroll: () => ({ status: 'BOUNDARY', position: 0 }), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      const decision = await decide(speech, undefined, configuredPolicy)
      process.stdout.write(`[query-scope-control] ${JSON.stringify({ speech, kind: decision.kind, reason: decision.reason, jevRequests, jevAnswers })}\n`)
      expect(decision.kind, JSON.stringify(decision)).toBe('FAST_ACTION')
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    }
  }, 30_000)

  // Report: this chat, 2026-10-18, first utterance 水餃一份 after opening ordering.
  it('orders the first named meal with quantity after skipping optional phone entry', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    for (const policy of [{ name: 'default', value: { decisionInstruction: '', storeInstruction: '' } }, { name: 'configured', value: configuredPolicy }]) {
      for (const [speech, itemId, quantity] of [['水餃一份', 'dumplings', 1], ['牛肉麵一份', 'beef-noodle-soup', 1], ['排骨便當一份', 'fried-pork-chop-bento', 1], ['我要水餃一份', 'dumplings', 1], ['水餃兩份', 'dumplings', 2], ['兩份牛肉麵', 'beef-noodle-soup', 2], ['水餃三份', 'dumplings', 3], ['牛肉麵5份', 'beef-noodle-soup', 5]] as const) {
        ready = false
        runtime = createMenuToolRuntime({ menu: catalog.items, screen: () => 'menu', onMenuRequested: () => {}, onMenuScroll: () => ({ status: 'BOUNDARY', position: 0 }), orderingReady: () => ready, onCustomerEntrySkipped: () => ready = true, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
        await runtime.invokeManual('customer_skip_phone', { confirmedByUser: true })
        const decision = await decide(speech, undefined, policy.value)
        process.stdout.write(`[first-meal-replay] ${JSON.stringify({ speech, policy: policy.name, kind: decision.kind, reason: decision.reason, jevRequests, jevAnswers })}\n`)
        expect(decision.kind, JSON.stringify(decision)).toBe('FAST_ACTION')
        expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: quantity, lines: [{ itemId, quantity }] } })
      }
    }
  }, 60_000)

  it('keeps first-turn meal inquiries read-only despite a mentioned serving count', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    for (const policy of [{ name: 'default', value: { decisionInstruction: '', storeInstruction: '' } }, { name: 'configured', value: configuredPolicy }]) {
      for (const speech of ['有哪種水餃？', '水餃一份多少錢？', '牛肉麵有哪些？']) {
        runtime = createMenuToolRuntime({ menu: catalog.items, screen: () => 'menu', onMenuRequested: () => {}, onMenuScroll: () => ({ status: 'BOUNDARY', position: 0 }), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
        const decision = await decide(speech, undefined, policy.value)
        process.stdout.write(`[first-inquiry-replay] ${JSON.stringify({ speech, policy: policy.name, kind: decision.kind, reason: decision.reason, jevRequests, jevAnswers })}\n`)
        expect(decision.kind, JSON.stringify(decision)).toBe('FAST_ACTION')
        if (decision.kind !== 'FAST_ACTION')
          throw new Error('Expected a finite menu read')
        expect(decision.result).toMatchObject({ items: expect.any(Array) })
        expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
        expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'ordering' })
      }
    }
  }, 60_000)

  // Report: this chat, 2026-10-19, session hIHA3DAvjhrG8x0RjggBa.
  it('replaces the reported noodle order with dumplings while fulfillment remains unanswered', async () => {
    ready = true
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    runtime = createMenuToolRuntime({ menu: catalog.items, screen: () => 'menu', onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const first = await runtime.invoke('order_add_item', { itemId: 'beef-noodle-soup', quantity: 1 })
    const question = questionReceiptFrom(first)!
    await runtime.invoke('kiosk_dialogue_presented', { content: question.question, questionId: question.questionId })
    const conversation: DecisionConversation = { messages: [{ role: 'user', content: '牛肉麵一份' }, { role: 'assistant', content: `已將紅燒牛肉麵加入購物車，共 1 份。 ${question.question}` }] }
    const decision = await decide('牛肉麵幫我改水餃', conversation, configuredPolicy)
    process.stdout.write(`[reported-replacement] ${JSON.stringify({ kind: decision.kind, reason: decision.reason, jevAnswers })}\n`)
    expect(decision.kind, JSON.stringify(decision)).toBe('NEEDS_ASSISTANT')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'beef-noodle-soup', quantity: 1 }] } })
    const saved = await app.request(`/api/kiosk/visitor-sessions/${sessionId}/entries`, { method: 'POST', headers, body: JSON.stringify({ kind: 'tool_result', content: JSON.stringify(first), metadata: { name: 'order_add_item', decisionRoute: 'fast_path' } }) })
    expect(saved.status).toBe(201)
    await recordReply(conversation.messages[1]!.content)
    const reply = await agent('牛肉麵幫我改水餃', conversationDecisionStateFrom(decision.decisionState, decision)!)
    process.stdout.write(`[reported-replacement-main] ${JSON.stringify(reply)}\n`)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'dumplings', quantity: 1 }] } })
    expect(reply.calls.some(call => call.name === 'order_add_item' && typeof call.input === 'object' && call.input !== null && 'replaceLineId' in call.input)).toBe(true)
    expect(reply.calls.some(call => ['cart_remove_item', 'order_set_fulfillment'].includes(call.name))).toBe(false)
  }, 60_000)

  it('routes cart replacements as whole requests and completes the reported swap with actual Jev and Main Agent', async () => {
    ready = true
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const conversation: DecisionConversation = { messages: [{ role: 'user', content: '水餃一份' }, { role: 'assistant', content: '已將水餃加入購物車，共 1 份。請問要內用還是自取？' }] }
    const scenarios = [
      { speech: '水餃不要，改牛肉麵', kind: 'NEEDS_ASSISTANT' },
      { speech: '水餃換牛肉麵一份', kind: 'NEEDS_ASSISTANT' },
      { speech: '剛才那份改牛肉麵', kind: 'NEEDS_ASSISTANT' },
      { speech: '水餃不要，改披薩', kind: 'NEEDS_ASSISTANT' },
      { speech: '再加一份牛肉麵', kind: 'FAST_ACTION' },
      { speech: '水餃改兩份', kind: 'FAST_ACTION' },
      { speech: '水餃不要了', kind: 'FAST_ACTION' },
      { speech: '小王，水餃不要，改牛肉麵', kind: 'IGNORE' },
    ]
    for (const [index, scenario] of scenarios.entries()) {
      runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      const first = await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
      const question = questionReceiptFrom(first)!
      await runtime.invoke('kiosk_dialogue_presented', { content: question.question, questionId: question.questionId })
      const result = await decide(scenario.speech, conversation)
      process.stdout.write(`[cart-change-replay] ${JSON.stringify({ ...scenario, actual: result.kind, reason: result.reason, jevRequests, jevAnswers })}\n`)
      expect(result.kind, JSON.stringify({ scenario, result })).toBe(scenario.kind)
      if (scenario.kind !== 'FAST_ACTION')
        expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'dumplings', quantity: 1 }] } })
      if ([0, 1, 3].includes(index)) {
        // Each independent fixture has its own visitor history, just as it
        // has its own browser cart. A previous successful swap is not context
        // or authorization for a fresh fixture's original meal.
        const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
        expect(started.status).toBe(201)
        sessionId = (await started.json() as { session: { id: string } }).session.id
        const saved = await app.request(`/api/kiosk/visitor-sessions/${sessionId}/entries`, { method: 'POST', headers, body: JSON.stringify({ kind: 'tool_result', content: JSON.stringify(first), metadata: { name: 'order_add_item', decisionRoute: 'fast_path' } }) })
        expect(saved.status).toBe(201)
        await recordReply(conversation.messages[1]!.content)
        const reply = await agent(scenario.speech, conversationDecisionStateFrom(result.decisionState, result)!)
        process.stdout.write(`[cart-change-main] ${JSON.stringify({ speech: scenario.speech, ...reply })}\n`)
        if (index === 3) {
          expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'dumplings', quantity: 1 }] } })
          expect(reply.calls.every(call => ['menu_get', 'cart_get'].includes(call.name) || reply.blockedTools.includes(call.name))).toBe(true)
        }
        else {
          expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'beef-noodle-soup', quantity: 1 }] } })
          expect(reply.calls.some(call => call.name === 'order_add_item' && typeof call.input === 'object' && call.input !== null && 'replaceLineId' in call.input)).toBe(true)
          expect(reply.calls.some(call => call.name === 'cart_remove_item')).toBe(false)
        }
      }
    }
  }, 180_000)

  it('keeps noodle variety inquiries grounded after an invented clarification example', async () => {
    ready = true
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const conversation: DecisionConversation = { messages: [
      { role: 'user', content: '水餃改回牛肉麵' },
      { role: 'assistant', content: '請提供牛肉麵的名稱，例如「红烧牛肉麵」或「清燉牛肉麵」，以便我為您查詢。' },
    ] }
    for (const scenario of [
      { speech: '有哪種牛肉麵？', context: conversation, item: '紅燒牛肉麵' },
      { speech: '有哪種牛肉麵？', context: undefined, item: '紅燒牛肉麵' },
      { speech: '牛肉麵有哪些？', context: conversation, item: '紅燒牛肉麵' },
      { speech: '有哪種水餃？', context: undefined, item: '水餃' },
      { speech: '有哪種水餃？', context: undefined, item: '水餃', emptyCart: true },
      { speech: '便當有幾種？', context: undefined, item: undefined },
    ]) {
      runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      if (!scenario.emptyCart)
        await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
      const decision = await decide(scenario.speech, scenario.context)
      process.stdout.write(`[noodle-variety-replay] ${JSON.stringify({ speech: scenario.speech, history: Boolean(scenario.context), kind: decision.kind, reason: decision.reason, jevRequests, jevAnswers })}\n`)
      expect(decision.kind, JSON.stringify({ scenario, decision })).toBe('FAST_ACTION')
      if (decision.kind !== 'FAST_ACTION')
        throw new Error('A complete variety inquiry must not be ignored')
      expect(decision.result).toMatchObject({ items: expect.any(Array) })
      if (scenario.item)
        expect(decision.result).toMatchObject({ items: [{ name: scenario.item }] })
      expect(JSON.stringify(decision.result)).not.toContain('清燉牛肉麵')
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: scenario.emptyCart ? 0 : 1, lines: scenario.emptyCart ? [] : [{ itemId: 'dumplings', quantity: 1 }] } })
    }
    const background = await decide('小王，我問你有哪種牛肉麵？')
    process.stdout.write(`[variety-background-replay] ${JSON.stringify({ kind: background.kind, jevRequests, jevAnswers })}\n`)
    expect(background.kind, JSON.stringify(background)).toBe('IGNORE')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'dumplings', quantity: 1 }] } })
  }, 90_000)

  it('grounds 水餃改回牛肉麵 in menu receipts instead of asking with invented varieties', async () => {
    ready = true
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const original = await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    expect(started.status).toBe(201)
    sessionId = (await started.json() as { session: { id: string } }).session.id
    // The real host persists accepted Fast Path receipts before escalation;
    // that endpoint also updates the Server's compact cart working context.
    const saved = await app.request(`/api/kiosk/visitor-sessions/${sessionId}/entries`, { method: 'POST', headers, body: JSON.stringify({ kind: 'tool_result', content: JSON.stringify(original), metadata: { name: 'order_add_item', decisionRoute: 'fast_path' } }) })
    expect(saved.status).toBe(201)
    await recordReply('已將炸排骨便當更換為水餃，共1份。')
    const decision = await decide('水餃改回牛肉麵')
    expect(decision.kind, JSON.stringify(decision)).toBe('NEEDS_ASSISTANT')
    const state = conversationDecisionStateFrom(decision.decisionState, decision)!
    expect(state.requireMenuRead).toBe(true)
    const reply = await agent('水餃改回牛肉麵', state)
    expect(reply.calls[0]?.name).toBe('menu_get')
    expect(reply.calls.some(call => call.name === 'order_add_item' && typeof call.input === 'object' && call.input !== null && 'replaceLineId' in call.input)).toBe(true)
    expect(reply.answer).not.toContain('清燉')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'beef-noodle-soup', quantity: 1 }] } })
    process.stdout.write(`[noodle-swap-replay] ${JSON.stringify(reply)}\n`)
  }, 90_000)

  async function recordReply(content: string) {
    const response = await app.request(`/api/kiosk/visitor-sessions/${sessionId}/entries`, { method: 'POST', headers, body: JSON.stringify({ kind: 'assistant_text', content }) })
    expect(response.status).toBe(201)
    await runtime.invoke('kiosk_dialogue_presented', { content })
  }

  async function agent(transcript: string, decisionState: KioskConversationDecisionState) {
    // Match the real Kiosk task lifecycle; runtime task guards must participate
    // in replay just as they do before the host executes an Agent tool.
    const taskId = crypto.randomUUID()
    const menuRevision = decisionState.menuRevision ?? conversationDecisionStateFrom(await runtime.invoke('kiosk_interaction_state'))?.menuRevision
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId, transcript, expectedMenuRevision: menuRevision, readOnly: decisionState.readOnly === true, ...(decisionState.handoff ? { handoff: decisionState.handoff } : {}), constraints: { excludeIngredients: decisionState.constraints?.exclude ?? [], includeIngredients: decisionState.constraints?.include ?? [], ...decisionState.constraints?.price, ...(decisionState.constraints?.dietary ? { dietary: decisionState.constraints.dietary } : {}), ...(decisionState.constraints?.unresolvedPrice ? { unresolvedPrice: true } : {}) } })
    const menu = createMenuReplyWindow()
    const requestedTools: string[] = []
    const calls: Array<{ name: string, input: unknown }> = []
    const blockedTools: string[] = []
    // These are end-to-end SSE request times, including routing, network and
    // persistence, rather than the provider's internal inference duration.
    const mainAgentRequests: number[] = []
    let toolMs = 0
    let payload: Record<string, unknown> = { content: transcript }
    let answer: string | undefined
    let selectedReply: ContextReply | undefined
    let question: ReturnType<typeof questionReceiptFrom>
    let completed = false
    let operationReply: string | undefined
    const deadline = AbortSignal.timeout(60_000)
    for (let round = 0; round < 5; round++) {
      const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context', { includeCatalog: decisionState.readOnly !== true || decisionState.requireMenuRead === true }))
      expect(context.taskId).toBe(taskId)
      decisionState = refreshConversationState(context, decisionState)
      const allowed = new Set(context.allowedToolNames)
      const tools = runtime.toolDefinitions.filter(tool => allowed.has(tool.name)).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }))
      payload = { ...payload, decisionState, tools }
      const started = performance.now()
      const response = await app.request(`/api/kiosk/visitor-sessions/${sessionId}/messages`, { method: 'POST', headers, body: JSON.stringify(payload), signal: deadline })
      expect(response.status).toBe(200)
      const events = (await response.text()).split(/\r?\n\r?\n/).flatMap(block => block.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))))
      mainAgentRequests.push(Math.round(performance.now() - started))
      const failure = events.find(event => event.type === 'turn-failed')
      expect(failure, JSON.stringify(failure)).toBeUndefined()
      const finished = events.find(event => event.type === 'turn-finished')
      expect(finished).toBeDefined()
      answer = finished.answer
      selectedReply = finished.reply
      if (!finished.toolCalls.length) {
        completed = true
        break
      }
      const toolResults = []
      for (const call of finished.toolCalls) {
        expect(calls.length).toBeLessThan(16)
        const definition = runtime.toolDefinitions.find(tool => tool.name === call.function.name)
        expect(definition).toBeDefined()
        const input = JSON.parse(call.function.arguments)
        requestedTools.push(call.function.name)
        calls.push({ name: call.function.name, input })
        const toolStarted = performance.now()
        const result = await runtime.invokeForAgent(definition!.name, input)
        process.stdout.write(`[configured-tool] ${JSON.stringify({ name: call.function.name, input, result })}\n`)
        if (result && typeof result === 'object' && 'ok' in result && result.ok === false)
          blockedTools.push(call.function.name)
        toolMs += performance.now() - toolStarted
        menu.record(call.function.name, result)
        question = questionReceiptFrom(result) ?? question
        if (!['menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get', 'seating_get'].includes(call.function.name))
          operationReply = operationReplyFrom(result) ?? operationReply
        toolResults.push({ toolCallId: call.id, name: call.function.name, content: JSON.stringify(result) })
      }
      payload = { toolResults }
    }
    expect(completed, JSON.stringify({ message: 'Provider tool loop must finish within five rounds', calls, answer })).toBe(true)
    const livePhase = conversationDecisionStateFrom(await runtime.invoke('kiosk_interaction_state'))?.phase
    const replyContext = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
    const presented = replyFromConversation({ status: 'completed', agentMode: 'active', answer, reply: selectedReply, requestedTools }, { menu, question, outcome: operationReply, context: replyContext, handoff: decisionState.handoff, serviceReply: decisionState.serviceReply, requireMenuRead: decisionState.requireMenuRead, failureMessage: '查詢未完成。', customerEntry: { phase: livePhase, prompt: '請先填寫手機或選擇略過。' } })
    expect(presented.role).toBe('assistant')
    await recordReply(presented.content)
    await runtime.invoke('kiosk_agent_task', { action: 'END', taskId })
    return { answer: presented.content, calls, blockedTools, mainAgentRequests, toolMs: Math.round(toolMs) }
  }

  // Plan: docs/plans/2026-10-28-kiosk-conversation-repair.md. Synthetic dialogue only.
  // A faultBeforeDecision is explicit transport injection, not a model result.
  it.each(conversationCases.filter(test => process.env.KIOSK_REPAIR_PILOT !== '1' || ['D01', 'D03', 'D05', 'D06', 'D09', 'D11'].includes(test.id)).flatMap(test => Array.from({ length: Math.min(3, Math.max(1, Number(process.env.KIOSK_REPAIR_REPEATS ?? 1))) }, (_, repeat) => ({ ...test, repeat: repeat + 1 }))))('configured conversation repair: $id / $repeat', async (scenario) => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    let shown: string[] = []
    runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: value => shown = value.itemIds, onMenuScroll: () => {
      throw new Error('No scroll requested in these cases.')
    }, checkout: {
      snapshot: () => undefined,
      revision: () => 0,
      paymentStatus: () => undefined,
      paymentMethods: ['linepay', 'jkopay'],
      assertCanRestart: () => {},
      restart: () => { throw new Error('Unexpected checkout') },
      cancel: () => { throw new Error('Unexpected checkout') },
      start: () => { throw new Error('Unexpected checkout') },
      chooseInvoice: () => { throw new Error('Unexpected invoice') },
      confirmTaxId: () => { throw new Error('Unexpected invoice') },
      requestTaxId: () => { throw new Error('Unexpected invoice') },
      setTaxId: () => { throw new Error('Unexpected invoice') },
      skipMembership: () => { throw new Error('Unexpected checkout') },
      selectPayment: async () => { throw new Error('Unexpected payment') },
    } })
    const opened = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    expect(opened.status).toBe(201)
    sessionId = (await opened.json() as { session: { id: string } }).session.id
    let pendingRetry: { state: 'available' | 'preparing' | 'submitted' | 'expired', text: string, sessionId: string, iframeRevision: number, requestId: number, contextKey: string } | undefined
    let previousCount = 0
    for (const [index, step] of scenario.steps.entries()) {
      const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context', { includeCatalog: true }))
      const shownBefore = [...shown]
      let speech = step.text
      if (step.faultBeforeDecision) {
        pendingRetry = { state: 'available', text: speech, sessionId, iframeRevision: 1, requestId: index + 1, contextKey: serviceContextKey(before) }
        process.stdout.write(`[conversation-chain] ${JSON.stringify({ id: scenario.id, repeat: scenario.repeat, turn: index + 1, outcome: 'injected-before-decision-failure', providerCalls })}\n`)
        continue
      }
      if (step.retry) {
        expect(pendingRetry).toBeDefined()
        const resumed = await resumeConversationRetry(pendingRetry!, { current: async () => ({ sessionId, iframeRevision: 1, contextKey: serviceContextKey(parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))) }), enqueue: (text) => {
          speech = text
          return { kind: 'ACCEPTED', id: index + 1 }
        }, record: async () => {} })
        expect(resumed.kind).toBe('ACCEPTED')
        expect(speech).toBe(step.text)
      }
      const savedInput = await app.request(`/api/kiosk/visitor-sessions/${sessionId}/entries`, { method: 'POST', headers, body: JSON.stringify({ kind: 'asr_transcript', content: speech, metadata: { source: 'asr_simulation' } }) })
      expect(savedInput.status).toBe(201)
      let decisionTrace: unknown
      const result = await runFastPath({ transcript: speech, isEnabled: () => systemOne.isEnabled(), webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://ordering.test' })), execute: (tool, input) => runtime.invoke(runtime.toolDefinitions.find(definition => definition.name === tool.name)!.name, input) }, decide: async ({ signal, ...request }) => {
        const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, signal, body: JSON.stringify({ ...request, includeTrace: true, visitorSessionId: sessionId }) })
        expect(response.status).toBe(200)
        const decision = await response.json() as KioskInteractionDecision
        decisionTrace = decision
        return decision
      } })
      let answer: string | undefined
      try {
        if (result.kind === 'NEEDS_ASSISTANT') {
          answer = (await agent(speech, conversationDecisionStateFrom(result.decisionState, result)!)).answer
        }
        else if (result.kind === 'SERVICE_CLARIFICATION') {
          answer = result.question.question
          await recordReply(answer)
        }
        else if (result.kind === 'CLARIFICATION') {
          answer = result.prompt
          await recordReply(answer)
        }
        else if (result.kind === 'FAST_ACTION') {
          answer = operationReplyFrom(result.result)
          if (answer)
            await recordReply(answer)
        }
        else if (result.kind === 'GREET') {
          answer = '您好！'
          await recordReply(answer)
        }
        const after = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context', { includeCatalog: true }))
        const count = step.count ?? previousCount
        expect(after.cart.itemCount).toBe(count)
        for (const line of after.cart.lines) expect(line.itemId).toBe('dumplings')
        if (step.outcome === 'idle') {
          expect(['IGNORE', 'INCOMPLETE']).toContain(result.kind)
          expect(shown).toEqual(shownBefore)
        }
        else {
          expect(answer?.trim()).toBeTruthy()
          expect(answer).not.toMatch(/使用.*(?:螢幕|畫面)|未完成|查詢未完成/)
          if (step.outcome === 'empty-query') {
            expect(shown).toEqual([])
            expect(answer).toMatch(/沒有|查無|查不到|找不到|未找到/)
          }
          if (step.outcome === 'catalog')
            expect([...shown].sort()).toEqual(catalog.items.map(item => item.id).sort())
          if (step.outcome === 'clarify') {
            expect(answer).not.toMatch(/水果|價位|刷卡|目前沒有符合條件/)
            expect(shown).toEqual(shownBefore)
          }
          if (step.outcome === 'payment') {
            for (const method of before.paymentMethods ?? []) expect(answer).toContain(method.label)
            expect(answer).not.toMatch(/水果|價位|餐點種類/)
            expect(shown).toEqual(shownBefore)
          }
          if (step.outcome === 'hearing') {
            expect(answer).toMatch(/收到|聽|接收/)
            expect(answer).not.toMatch(/內用|自取|付款|水果|餐點種類/)
            expect(shown).toEqual(shownBefore)
          }
          if (step.outcome === 'acknowledge')
            expect(shown).toEqual(shownBefore)
        }
        previousCount = count
      }
      finally {
        process.stdout.write(`[conversation-chain] ${JSON.stringify({ id: scenario.id, group: scenario.group, repeat: scenario.repeat, turn: index + 1, speech, decision: result.kind, decisionTrace, answer, cart: await runtime.invoke('cart_get', { display: false }), shown, providerCalls, scope: 'actual Jev+production recovery+conditional Main; scratch DB and Menu callbacks, no DOM or physical microphone' })}\n`)
      }
    }
  }, 240_000)

  // Report: this chat, 2026-10-26. Synthetic questions; production DB is read-only.
  it.each([
    { transcript: '有湯包嗎？', expected: ['湯包'] },
    { transcript: '請說明內用和自取，先不要修改訂單。', expected: ['內用', '自取'] },
  ])('configured explanation recovery: $transcript', async ({ transcript, expected }) => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    expect(started.status).toBe(201)
    sessionId = (await started.json() as { session: { id: string } }).session.id
    const reply = await agent(transcript, { phase: 'ordering', readOnly: true })
    for (const text of expected)
      expect(reply.answer).toContain(text)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    process.stdout.write(`[configured-explanation] ${JSON.stringify({ transcript, answer: reply.answer, toolCalls: reply.calls.map(call => call.name) })}\n`)
  }, 60_000)

  // Plan: docs/plans/2026-10-22-kiosk-multi-demand-evaluation.md.
  // New artificial utterances only. Actual configured models are used; a Jev
  // abstention is not replaced with a forced Main result to make the case pass.
  it.each([
    { id: 'multi-add', transcript: '牛肉麵跟水餃各一份', seed: undefined, quantity: undefined, mode: undefined, expected: [['beef-noodle-soup', 1], ['dumplings', 1]] },
    { id: 'single-ambiguous', transcript: '我要一份便當', seed: undefined, quantity: undefined, mode: undefined, expected: [] },
    { id: 'alternative-inquiry', transcript: '牛肉麵或水餃，你推薦哪個？先不要加', seed: undefined, quantity: undefined, mode: undefined, expected: [] },
    { id: 'replacement', transcript: '牛肉麵不要了，改水餃一份', seed: 'beef-noodle-soup', quantity: 1, mode: undefined, expected: [['dumplings', 1]] },
    { id: 'mixed-query-add', transcript: '牛肉麵一份幫我加，水餃一份多少錢？', seed: undefined, quantity: undefined, mode: undefined, expected: [['beef-noodle-soup', 1]] },
    { id: 'quantity-correction', transcript: '剛才的水餃總共只要兩份，請幫我改好', seed: 'dumplings', quantity: 3, mode: undefined, expected: [['dumplings', 2]] },
    { id: 'fulfillment-correction', transcript: '等等我要改成內用', seed: 'dumplings', quantity: 1, mode: 'takeout' as const, expected: [['dumplings', 1]] },
    { id: 'whole-menu', transcript: '我要看你們全部的菜單', seed: undefined, quantity: undefined, mode: undefined, expected: [] },
  ])('configured multi-demand acceptance: $id', async (scenario) => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    let presentedIds: string[] = []
    runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onMenuSelection: () => {}, onCartChange: () => {}, onMenuRequested: () => {}, onRecommendationsChange: presentation => presentedIds = presentation.itemIds })
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    expect(started.status).toBe(201)
    sessionId = (await started.json() as { session: { id: string } }).session.id
    const history: DecisionConversation = { messages: [] }
    if (scenario.seed) {
      const seeded = await runtime.invoke('order_add_item', { itemId: scenario.seed, quantity: scenario.quantity })
      const saved = await app.request(`/api/kiosk/visitor-sessions/${sessionId}/entries`, { method: 'POST', headers, body: JSON.stringify({ kind: 'tool_result', content: JSON.stringify(seeded), metadata: { name: 'order_add_item', decisionRoute: 'fast_path' } }) })
      expect(saved.status).toBe(201)
      const question = questionReceiptFrom(seeded)
      const content = operationReplyFrom(seeded)!
      await recordReply(content)
      if (question)
        await runtime.invoke('kiosk_dialogue_presented', { content: question.question, questionId: question.questionId })
      history.messages.push({ role: 'assistant', content: `${content} ${question?.question ?? ''}` })
    }
    if (scenario.mode)
      await runtime.invoke('order_set_fulfillment', { mode: scenario.mode })
    if (scenario.id === 'whole-menu')
      await runtime.invokeForAgent('menu_get', { query: '椒麻雞便當', display: true })
    const begin = performance.now()
    let decision
    let reply
    try {
      decision = await decide(scenario.transcript, history, configuredPolicy)
      process.stdout.write(`[configured-decision] ${JSON.stringify({ id: scenario.id, kind: decision.kind, reason: decision.reason, jevAnswers, jevRequests })}\n`)
      if (decision.kind === 'NEEDS_ASSISTANT')
        reply = await agent(scenario.transcript, conversationDecisionStateFrom(decision.decisionState, decision)!)
      else
        expect(['FAST_ACTION', 'CLARIFICATION']).toContain(decision.kind)
      const cart = await runtime.invoke('cart_get', { display: false }) as { cart: { lines: Array<{ itemId: string, quantity: number }>, fulfillmentMode?: string } }
      expect(cart.cart.lines.map(line => [line.itemId, line.quantity]).sort()).toEqual([...scenario.expected].sort())
      if (scenario.id === 'fulfillment-correction')
        expect(cart.cart.fulfillmentMode).toBe('dine-in')
      if (scenario.id === 'whole-menu')
        expect([...presentedIds].sort()).toEqual(catalog.items.map(item => item.id).sort())
      if (scenario.id === 'single-ambiguous') {
        const assent = await decide('對', history, configuredPolicy)
        process.stdout.write(`[configured-short-answer] ${JSON.stringify({ transcript: '對', decision: assent.kind, jevAnswers, jevRequests })}\n`)
        expect(assent.kind).toBe('CLARIFICATION')
        expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
        const choice = await decide('第二項', history, configuredPolicy)
        expect(choice.kind).toBe('FAST_ACTION')
        expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1 } })
      }
    }
    finally {
      process.stdout.write(`[configured-outcome] ${JSON.stringify({ id: scenario.id, transcript: scenario.transcript, decision: decision?.kind, reply, jevAnswers, jevRequests, cart: await runtime.invoke('cart_get', { display: false }), presentedIds, durationMs: Math.round(performance.now() - begin), scope: 'Actual configured Jev + conditional Main; scratch visitor DB; runtime callbacks, no real DOM/POS/payment' })}\n`)
    }
  }, 120_000)

  it('uses actual provider tools for recommendations and disputed menu names', async () => {
    ready = false
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    runtime = createMenuToolRuntime({ menu: catalog.items, orderingReady: () => ready, onCustomerEntrySkipped: () => ready = true, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const startedSession = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    expect(startedSession.status).toBe(201)
    sessionId = (await startedSession.json() as { session: { id: string } }).session.id
    const answers: string[] = []
    for (const transcript of ['有賣什麼嗎？', '麵食有哪些？']) {
      const started = performance.now()
      const decision = await decide(transcript)
      const jevFlowMs = Math.round(performance.now() - started)
      expect(decision).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' })
      const state = conversationDecisionStateFrom(decision.decisionState, decision)!
      const result = await agent(transcript, state)
      expect(result.calls.length).toBeGreaterThan(0)
      expect(result.calls[0]!.name).toMatch(/^menu_(get|recommend)$/)
      for (const fabricated of ['香菜肉絲乾麵', '韭菜盒', '甜不辣'])
        expect(result.answer).not.toContain(fabricated)
      expect(result.answer).not.toBe(answers[0])
      answers.push(result.answer)
      process.stdout.write(`[provider-replay] ${JSON.stringify({ transcript, ...result, jevRequests, jevFlowMs, durationMs: Math.round(performance.now() - started) })}\n`)
    }
    // A deliberately incorrect synthetic prior claim exercises repair. No real
    // visitor history or private character card is sent to either provider.
    await recordReply('推薦韭菜盒、甜不辣。')
    for (const transcript of ['菜單沒有你剛才說的韭菜盒吧', '真的有水餃嗎？']) {
      const started = performance.now()
      const decision = await decide(transcript)
      const jevFlowMs = Math.round(performance.now() - started)
      expect(decision).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' })
      const result = await agent(transcript, conversationDecisionStateFrom(decision.decisionState, decision)!)
      expect(result.calls.some(call => call.name === 'menu_get')).toBe(true)
      expect(result.answer).toContain(transcript.includes('韭菜盒') ? '介紹有誤' : '水餃目前可以點')
      process.stdout.write(`[provider-replay] ${JSON.stringify({ transcript, ...result, jevRequests, jevFlowMs, durationMs: Math.round(performance.now() - started) })}\n`)
    }
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'customer_entry' })
  }, 180_000)

  it('cancels or corrects the current draft through the configured Jev without adding it', async () => {
    await runtime.invokeManual('customer_skip_phone', { confirmedByUser: true })
    for (const transcript of ['我沒有要水餃，我是有有沒有', '不要水餃']) {
      const started = performance.now()
      const order = await decide('我要水餃')
      expect(order).toMatchObject({ kind: 'FAST_ACTION', result: { customerMessage: '請問水餃要幾份？' } })
      const result = await decide(transcript)
      expect(result.kind).toBe('FAST_ACTION')
      if (result.kind === 'FAST_ACTION')
        expect(operationReplyFrom(result.result)).toContain(transcript === '不要水餃' ? '已取消' : '您是在詢問')
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'ordering' })
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
      process.stdout.write(`[provider-replay] ${JSON.stringify({ transcript, answer: result.kind === 'FAST_ACTION' ? operationReplyFrom(result.result) : undefined, durationMs: Math.round(performance.now() - started) })}\n`)
    }
  }, 90_000)

  it('requires the optional phone choice for recommendations and orders with the configured Jev', async () => {
    const scenarios = [
      { transcript: '推薦一下', expected: 'CUSTOMER_ENTRY_REQUIRED' },
      { transcript: '幫我推薦不辣的餐點', expected: 'CUSTOMER_ENTRY_REQUIRED' },
      { transcript: '還有其他推薦嗎', expected: 'CUSTOMER_ENTRY_REQUIRED' },
      { transcript: '我要水餃一份', expected: 'CUSTOMER_ENTRY_REQUIRED' },
      { transcript: '我想吃飯', expected: 'CUSTOMER_ENTRY_REQUIRED' },
      { transcript: '我想吃牛肉麵', expected: 'CUSTOMER_ENTRY_REQUIRED' },
      { transcript: '我要點餐', expected: 'CUSTOMER_ENTRY_REQUIRED' },
      { transcript: '有水餃嗎', expected: 'NEEDS_ASSISTANT' },
      { transcript: '有哪些餐點', expected: 'NEEDS_ASSISTANT' },
      { transcript: '你是誰', expected: 'NEEDS_ASSISTANT' },
      { transcript: '我可以略過嗎', expected: 'NEEDS_ASSISTANT' },
      { transcript: '不用留電話，直接點餐', expected: 'FAST_ACTION' },
    ]
    for (const scenario of scenarios) {
      ready = false
      let cartChanges = 0
      runtime = createMenuToolRuntime({ orderingReady: () => ready, onCustomerEntrySkipped: () => ready = true, onAction: () => {}, onCartChange: () => cartChanges++, onMenuSelection: () => {} })
      const initialCartChanges = cartChanges
      const result = await decide(scenario.transcript)
      process.stdout.write(`[phone-replay] ${JSON.stringify({ ...scenario, kind: result.kind, reason: result.reason, jevRequests })}\n`)
      expect(result.kind, JSON.stringify({ scenario, result })).toBe(scenario.expected)
      if (scenario.expected === 'CUSTOMER_ENTRY_REQUIRED')
        expect(result).not.toHaveProperty('action')
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: scenario.expected === 'FAST_ACTION' ? 'ordering' : 'customer_entry' })
      expect(cartChanges).toBe(initialCartChanges)
    }
  }, 120_000)

  it('handles phone-entry greetings and mixed requests with the configured Jev', async () => {
    const scenarios = [
      { transcript: '你好', expected: 'GREET' },
      { transcript: '哈囉', expected: 'GREET' },
      { transcript: '早安', expected: 'GREET' },
      { transcript: '店員你好', expected: 'GREET' },
      { transcript: '小陳你好，好久不見', expected: 'IGNORE' },
      { transcript: '你好，幫我推薦一下', expected: 'CUSTOMER_ENTRY_REQUIRED' },
      { transcript: '你好，我要水餃一份', expected: 'CUSTOMER_ENTRY_REQUIRED' },
      { transcript: '你好，有水餃嗎', expected: 'NEEDS_ASSISTANT' },
      { transcript: '你好，你是誰', expected: 'NEEDS_ASSISTANT' },
      { transcript: '你好，請略過電話', expected: 'FAST_ACTION' },
    ]
    for (const scenario of scenarios) {
      ready = false
      let cartChanges = 0
      runtime = createMenuToolRuntime({ orderingReady: () => ready, onCustomerEntrySkipped: () => ready = true, onAction: () => {}, onCartChange: () => cartChanges++, onMenuSelection: () => {} })
      const initialCartChanges = cartChanges
      const result = await decide(scenario.transcript)
      process.stdout.write(`[phone-greeting-replay] ${JSON.stringify({ ...scenario, kind: result.kind, reason: result.reason, jevRequests })}\n`)
      // An uncertain companion recipient must also stay silent: require the
      // recipient refusal specifically, never a provider error or a greeting.
      if (scenario.expected === 'IGNORE' && result.kind === 'UNAVAILABLE')
        expect(result.reason).toBe('UNCERTAIN_RECIPIENT')
      else
        expect(result.kind, JSON.stringify({ scenario, result })).toBe(scenario.expected)
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: scenario.expected === 'FAST_ACTION' ? 'ordering' : 'customer_entry' })
      expect(cartChanges).toBe(initialCartChanges)
      if (scenario.expected === 'GREET') {
        expect(result).not.toHaveProperty('answeredQuestionId')
        expect(result).not.toHaveProperty('action')
      }
    }
  }, 120_000)

  it('selects payment methods through Jev without a second confirmation or starting a transaction', async () => {
    ready = true
    let revision = 0
    const selected: string[] = []
    runtime = createMenuToolRuntime({ orderingReady: () => ready, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, checkout: {
      snapshot: () => ({ stage: 'payment' }),
      revision: () => revision,
      paymentStatus: () => undefined,
      paymentMethods: ['linepay', 'jkopay'],
      assertCanRestart: () => {},
      restart: () => { throw new Error('Unexpected checkout restart') },
      start: () => { throw new Error('Unexpected checkout start') },
      skipMembership: () => { throw new Error('Unexpected membership operation') },
      chooseInvoice: () => { throw new Error('Unexpected invoice operation') },
      requestTaxId: () => { throw new Error('Unexpected invoice operation') },
      setTaxId: () => { throw new Error('Unexpected invoice operation') },
      confirmTaxId: () => { throw new Error('Unexpected invoice operation') },
      cancel: () => { throw new Error('Unexpected checkout cancellation') },
      selectPayment: async (method) => {
        selected.push(method)
        revision++
        return { customerMessage: '已選擇付款方式，尚未付款。', status: 'selected' }
      },
    } })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
    for (const scenario of [{ transcript: '我要用 LINE Pay', method: 'linepay' }, { transcript: '改成街口支付', method: 'jkopay' }]) {
      const before = selected.length
      const result = await decide(scenario.transcript)
      process.stdout.write(`[payment-selection-replay] ${JSON.stringify({ ...scenario, kind: result.kind, jevRequests })}\n`)
      expect(result.kind, JSON.stringify(result)).toBe('FAST_ACTION')
      if (result.kind !== 'FAST_ACTION')
        throw new Error('Expected direct payment-method selection')
      expect(result.result).toMatchObject({ payment: { method: scenario.method, status: 'selected' } })
      expect(result.result).not.toHaveProperty('pendingConfirmation')
      expect(selected).toHaveLength(before + 1)
      expect(selected.at(-1)).toBe(scenario.method)
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'checkout_payment_select', paymentState: 'idle' })
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1 } })
    }
  }, 60_000)

  it('keeps price replies and visible menu results aligned with the configured providers', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const scenarios: Array<{ transcript: string, phone: boolean, conditions: PriceConditions, empty?: boolean }> = [
      { transcript: '有價格130以下的嗎？', phone: false, conditions: { maxPrice: 130 } },
      { transcript: '有100~130之間的嗎？', phone: false, conditions: { minPrice: 100, maxPrice: 130 } },
      { transcript: '有１００～１３０之間的嗎？', phone: false, conditions: { minPrice: 100, maxPrice: 130 } },
      { transcript: '100到130元的餐點有哪些', phone: false, conditions: { minPrice: 100, maxPrice: 130 } },
      { transcript: '130以下有嗎', phone: false, conditions: { maxPrice: 130 } },
      { transcript: '不到130的便當有哪些', phone: false, conditions: { maxPrice: 130, maxPriceExclusive: true } },
      { transcript: '130以上的餐點有哪些', phone: false, conditions: { minPrice: 130 } },
      { transcript: '超過130的有嗎', phone: false, conditions: { minPrice: 130, minPriceExclusive: true } },
      { transcript: '剛好130的有嗎', phone: false, conditions: { minPrice: 130, maxPrice: 130 } },
      { transcript: '100以上不到130的餐點', phone: false, conditions: { minPrice: 100, maxPrice: 130, maxPriceExclusive: true } },
      { transcript: '130以下，便宜的先', phone: false, conditions: { maxPrice: 130, priceOrder: 'ASC' } },
      { transcript: '5000到6000之間的有嗎', phone: false, conditions: { minPrice: 5000, maxPrice: 6000 }, empty: true },
      { transcript: '有100~130之間的嗎？', phone: true, conditions: { minPrice: 100, maxPrice: 130 } },
      { transcript: '有價格130以下的嗎？', phone: true, conditions: { maxPrice: 130 } },
    ]
    for (const scenario of scenarios) {
      ready = !scenario.phone
      let presentation: RecommendationPresentation | undefined
      let cartChanges = 0
      runtime = createMenuToolRuntime({ menu: catalog.items, orderingReady: () => ready, onAction: () => {}, onCartChange: () => cartChanges++, onMenuSelection: () => {}, onRecommendationsChange: value => presentation = value })
      const initialCartChanges = cartChanges
      const result = await decide(scenario.transcript)
      process.stdout.write(`[price-replay] ${JSON.stringify({ ...scenario, kind: result.kind, reason: result.reason, jevRequests, jevAnswers })}\n`)
      expect(result.decisionState?.constraints?.price).toEqual(scenario.conditions)
      expect(result.decisionState?.constraints?.unresolvedPrice).toBe(false)
      let answer: string
      if (scenario.phone) {
        expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' })
        const projected = conversationDecisionStateFrom(result.decisionState, result)!
        await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'price-test', expectedMenuRevision: projected.menuRevision, constraints: { ...projected.constraints?.price, unresolvedPrice: projected.constraints?.unresolvedPrice } })
        const response = await agent(scenario.transcript, projected)
        answer = response.answer
        process.stdout.write(`[price-agent-replay] ${JSON.stringify(response)}\n`)
      }
      else {
        expect(result.kind, JSON.stringify(result)).toBe('FAST_ACTION')
        if (result.kind !== 'FAST_ACTION')
          throw new Error('Expected a qualified price read')
        expect(result.result).toMatchObject({ appliedPriceConditions: scenario.conditions })
        answer = operationReplyFrom(result.result)
      }
      expect(presentation).toBeDefined()
      if (scenario.empty)
        expect(presentation!.itemIds).toEqual([])
      else
        expect(presentation!.itemIds.length).toBeGreaterThan(0)
      expect(presentation!.itemIds.length).toBeLessThanOrEqual(3)
      for (const item of catalog.items) {
        if (presentation!.itemIds.includes(item.id)) {
          if (scenario.conditions.minPrice !== undefined) {
            if (scenario.conditions.minPriceExclusive)
              expect(item.price).toBeGreaterThan(scenario.conditions.minPrice)
            else
              expect(item.price).toBeGreaterThanOrEqual(scenario.conditions.minPrice)
          }
          if (scenario.conditions.maxPrice !== undefined) {
            if (scenario.conditions.maxPriceExclusive)
              expect(item.price).toBeLessThan(scenario.conditions.maxPrice)
            else
              expect(item.price).toBeLessThanOrEqual(scenario.conditions.maxPrice)
          }
          expect(answer).toContain(item.name)
        }
        else {
          expect(answer).not.toContain(item.name)
        }
      }
      if (scenario.conditions.priceOrder === 'ASC') {
        const prices = presentation!.itemIds.map(id => catalog.items.find(item => item.id === id)!.price)
        expect(prices).toEqual([...prices].sort((a, b) => a - b))
      }
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: scenario.phone ? 'customer_entry' : 'ordering' })
      expect(cartChanges).toBe(initialCartChanges)
    }
  }, 120_000)

  it('handles category follow-ups and unfinished-speech recovery with the configured Jev', async () => {
    const menu = [
      { id: 'base', name: '魚排飯', category: '主餐' },
      { id: 'dumpling', name: '水餃', category: '點心' },
      { id: 'soup', name: '蘿蔔湯', category: '湯類' },
      { id: 'noodle', name: '乾拌麵', category: '麵食' },
      { id: 'drink', name: '紅茶', category: '飲料' },
      { id: 'dessert', name: '豆花', category: '甜品' },
      { id: 'set', name: '雙人套餐', category: '套餐' },
    ].map(item => ({ ...item, description: '測試餐點', price: 80, imageUrl: '', optionGroups: [], recommendationTags: [] }))
    const scenarios = [
      { transcript: '小點心之類的', expected: 'FAST_ACTION' },
      { transcript: '湯類呢', expected: 'FAST_ACTION' },
      { transcript: '麵的有嗎', expected: 'FAST_ACTION' },
      { transcript: '飲料呢', expected: 'FAST_ACTION' },
      { transcript: '甜品之類的', expected: 'FAST_ACTION' },
      { transcript: '套餐的有嗎', expected: 'FAST_ACTION' },
      { transcript: '小陳，飲料之類的明天再討論', expected: 'IGNORE' },
      { transcript: '我要一份……', expected: 'INCOMPLETE' },
      { transcript: '小點心之類的', expected: 'FAST_ACTION', recordedRoute: true },
      { transcript: '小陳，飲料之類的明天再討論', expected: 'IGNORE', recordedRoute: true },
      { transcript: '我要一份……', expected: 'INCOMPLETE', recordedRoute: true },
    ]
    for (const scenario of scenarios) {
      const started = performance.now()
      const decisions: KioskInteractionDecision[] = []
      let recorded = false
      const runtime = createMenuToolRuntime({ menu, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      const receipt = await runtime.invokeManual('order_add_item', { itemId: 'base', quantity: 1 })
      const question = questionReceiptFrom(receipt)
      expect(question).toMatchObject({ purpose: 'fulfillment' })
      if (question)
        await runtime.invoke('kiosk_dialogue_presented', { content: operationReplyFrom(receipt), questionId: question.questionId })
      const result = await runFastPath({ transcript: scenario.transcript, isEnabled: async () => true, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://ordering.test' })), execute: (tool, input) => {
        return runtime.invoke(runtime.toolDefinitions.find(definition => definition.name === tool.name)!.name, input)
      } }, decide: async (request) => {
        const decision = await decideInteraction({ ...request, conversation: { messages: [{ role: 'user', content: '還有賣其他的嗎' }, { role: 'assistant', content: '剛才介紹了主餐，也可以繼續查詢其他分類。' }] }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke: (state, questions) => {
          if (scenario.recordedRoute && !recorded && questions.route) {
            recorded = true
            return Promise.resolve({ answers: { route: { choice: 'INCOMPLETE', confidence: 0.3233 } } })
          }
          return systemOne.decide(state, questions)
        } })
        decisions.push(decision)
        return decision
      } })
      process.stdout.write(`[category-replay] ${JSON.stringify({ ...scenario, kind: result.kind, answer: result.kind === 'FAST_ACTION' ? operationReplyFrom(result.result) : undefined, decisions, durationMs: Math.round(performance.now() - started) })}\n`)
      if (scenario.expected === 'IGNORE') {
        // Background speech may also fail closed when the broad model or its
        // question-relation check is uncertain. Neither result grants a read,
        // an old-question answer, or an Assistant handoff.
        expect(['IGNORE', 'UNAVAILABLE'], JSON.stringify({ scenario, result })).toContain(result.kind)
        if (result.kind === 'UNAVAILABLE')
          expect(['UNCERTAIN_OPERATION', 'UNCERTAIN_RECIPIENT']).toContain(result.reason)
      }
      else {
        expect(result.kind, JSON.stringify({ scenario, result })).toBe(scenario.expected)
      }
      if (result.kind === 'FAST_ACTION')
        expect(result.action.id).toBe('intent:search-menu')
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'base', quantity: 1 }] } })
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ waitingFor: { questionId: question!.questionId } })
    }
  }, 180_000)
})
