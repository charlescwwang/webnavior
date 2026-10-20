import type { WebMcpTool } from '@proj-airi/stage-ui/services/webmcp-adapter'

import type { MenuItem } from '../../../order-menu/src/domain/order-machine'
import type { MenuToolName } from '../../../order-menu/src/webmcp'
import type { KioskRoutesOptions } from '../../../server/src/routes/kiosk'
import type { KioskInteractionDecision } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'

import { Buffer } from 'node:buffer'
import { readFile, writeFile } from 'node:fs/promises'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { menu } from '../../../order-menu/src/domain/order-machine'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { mockDB } from '../../../server/src/libs/mock-db'
import { createKioskRoutes } from '../../../server/src/routes/kiosk'
import { createKioskService } from '../../../server/src/services/domain/kiosk'
import { decideInteraction } from '../../../server/src/services/domain/kiosk-interaction-decision'
import { defaultDecisionInstruction } from '../../../server/src/services/domain/kiosk-interaction-decision/prompt'
import { createEnvelopeCrypto } from '../../../server/src/utils/envelope-crypto'
import { runFastPath } from './kiosk-fast-path'

import * as schema from '../../../server/src/schemas'

const enabled = process.env.KIOSK_MAIN_SCOPE_REPLAY === '1'
const productionRecords: unknown[] = []

// Report: this chat, 2026-10-19. Experimental live-provider probe, not acceptance labels.
describe.skipIf(!enabled)('live Main Agent menu query scope through the real Kiosk route', () => {
  let app: ReturnType<typeof createKioskRoutes>
  let headers: Record<string, string>
  let model: string
  let secret: Buffer | undefined
  beforeAll(async () => {
    const profile = JSON.parse(await readFile('/tmp/webnavior-main-scope-profile.json', 'utf8'))
    model = profile.model_id
    const crypto = createEnvelopeCrypto({ masterKey: Buffer.from(process.env.LLM_ROUTER_MASTER_KEY!, 'base64') })
    secret = profile.api_key_ciphertext ? crypto.decryptKey(profile.api_key_ciphertext, { keyEntryId: 'default', modelName: `webnavior-ai:provider-profile:${profile.id}` }) : undefined
    const gateway: KioskRoutesOptions['llmGateway'] = {
      complete: async ({ body }) => {
        const response = await fetch(`${profile.base_url.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret.toString()}` } : {}) },
          body: JSON.stringify({ ...body, model, chat_template_kwargs: { enable_thinking: profile.enable_thinking } }),
          signal: AbortSignal.timeout(60_000),
        })
        if (!response.ok)
          throw new Error(`Main provider HTTP ${response.status}`)
        return response
      },
    }
    const db = await mockDB(schema)
    app = createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: gateway, runtimeModelPolicy: { modelFor: async () => model }, systemOne: { isEnabled: async () => true, maxActionCandidates: async () => 22 as const, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction, storeInstruction: '', updatedAt: null }), decide: async (state, questions) => {
      const response = await fetch('http://projev.aikcitri.qzz.io/v1/systemone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, questions }), signal: AbortSignal.timeout(30_000) })
      if (!response.ok)
        throw new Error(`Jev HTTP ${response.status}`)
      return await response.json() as { answers?: Record<string, unknown> }
    } } })
    const enrolled = await app.request('/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    expect(enrolled.ok).toBe(true)
    headers = { 'Content-Type': 'application/json', 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]! }
  }, 60_000)
  afterAll(() => secret?.fill(0))

  describe('production scope flow', () => {
    // Report: this chat, session IRWWpQr2aQ0m67i1M_0yi entries29–38, 2026-10-19.
    it.each([
      { transcript: '其他項目', namedQuery: undefined },
      { transcript: '我是說其他品項', namedQuery: undefined },
      { transcript: '我是說其他品巷', namedQuery: undefined },
      { transcript: '看看別的選擇', namedQuery: undefined },
      { transcript: '有韭菜盒嗎？', namedQuery: '韭菜盒' },
      { transcript: '不限價格，看看其他便當', namedQuery: undefined, action: 'update', itemIds: ['shrimp', 'basil'], prices: {} },
      { transcript: '重新挑選，不限價位和種類', namedQuery: undefined, action: 'reset', itemIds: ['shrimp', 'basil', 'noodles'], prices: {} },
      { transcript: '改成一百五以下的便當', namedQuery: undefined, action: 'update', itemIds: ['shrimp', 'chicken', 'fish'], prices: { maxPrice: 150 } },
    ])('real Main distinguishes a relative request from a named subject: $transcript', async (scenario) => {
      const { transcript, namedQuery } = scenario
      const requestedAction = 'action' in scenario ? scenario.action : 'clarify'
      const runtime = createMenuToolRuntime({ menu: [
        { id: 'shrimp', name: '周氏蝦捲招牌便當', price: 145, category: '便當' },
        { id: 'chicken', name: '椒麻雞便當', price: 135, category: '便當' },
        { id: 'fish', name: '泰式酸辣魚便當', price: 140, category: '便當' },
        { id: 'pork', name: '炸排骨便當', price: 130, category: '便當' },
        { id: 'basil', name: '打拋豬便當', price: 125, category: '便當' },
        { id: 'noodles', name: '紅燒牛肉麵', price: 150, category: '麵食' },
        { id: 'dumplings', name: '水餃', price: 80, category: '點心' },
      ].map(item => ({ ...menu[0]!, ...item, description: item.name, aliases: [], recommendationTags: [], optionGroups: [] })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.invoke('menu_recommend', { category: '便當', minPrice: 130, maxPrice: 140 })
      const started = await app.request('/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
      const { session } = await started.json() as { session: { id: string } }
      for (const [kind, content] of [
        ['user_text', '有推薦什麼嗎？'],
        ['assistant_text', '推薦3 項：周氏蝦捲招牌便當、椒麻雞便當、泰式酸辣魚便當。'],
        ['user_text', '有一百三到一百四的便當嗎'],
        ['assistant_text', '推薦3 項：椒麻雞便當、泰式酸辣魚便當、炸排骨便當。'],
        ['user_text', '還有賣其他的嗎？'],
        ['assistant_text', '目前沒有其他符合原條件且尚未推薦的餐點。'],
      ]) {
        const recorded = await app.request(`/visitor-sessions/${session.id}/entries`, { method: 'POST', headers, body: JSON.stringify({ kind, content }) })
        expect(recorded.status).toBe(201)
      }
      const response = await app.request(`/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: transcript, decisionState: { phase: 'ordering', readOnly: true, requireMenuRead: true }, tools: runtime.toolDefinitions.filter(tool => ['menu_get', 'menu_recommend'].includes(tool.name)).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) }) })
      expect(response.status).toBe(200)
      interface Reply { answer?: string, toolCalls: Array<{ id: string, function: { name: string, arguments: string } }> }
      let reply = await response.json() as Reply
      let question: string | undefined
      let presented = false
      expect(reply.toolCalls.length).toBeGreaterThan(0)
      for (let step = 0; step < 3 && reply.toolCalls.length; step++) {
        expect(reply.toolCalls).toHaveLength(1)
        const call = reply.toolCalls[0]!
        const args = JSON.parse(call.function.arguments)
        productionRecords.push({ input: transcript, reply })
        await writeFile('/tmp/webnavior-main-relative-subject-results.json', JSON.stringify(productionRecords, null, 2), { mode: 0o600 })
        if (namedQuery) {
          expect(call.function.name).toBe('menu_get')
          expect([args.query, ...(args.queries ?? [])]).toContain(namedQuery)
        }
        else {
          if (call.function.name === 'menu_recommend') {
            expect(args.action).toBe(requestedAction)
          }
          else {
            expect(call.function.name).toBe('menu_get')
            expect(args.display).toBe(false)
          }
          expect(args.query).toBeUndefined()
          expect(args.queries).toBeUndefined()
          if (requestedAction === 'clarify') {
            expect(args.category).toBeUndefined()
            expect(args.minPrice).toBeUndefined()
            expect(args.maxPrice).toBeUndefined()
          }
        }
        const receipt = await runtime.invokeForAgent(call.function.name as MenuToolName, args)
        if (receipt && typeof receipt === 'object' && 'queryAction' in receipt && receipt.queryAction === 'clarify') {
          expect(receipt).not.toHaveProperty('presentation')
          expect(receipt).not.toHaveProperty('pendingCustomerChoice')
          if ('customerMessage' in receipt && typeof receipt.customerMessage === 'string')
            question = receipt.customerMessage
        }
        if ('itemIds' in scenario && scenario.itemIds !== undefined && call.function.name === 'menu_recommend') {
          expect(receipt).toMatchObject({ queryAction: requestedAction, appliedPriceConditions: scenario.prices, items: scenario.itemIds.map(id => ({ id })) })
          expect(receipt).not.toHaveProperty('pendingCustomerChoice')
          presented = true
        }
        const continued = await app.request(`/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ toolResults: [{ name: call.function.name, toolCallId: call.id, content: JSON.stringify(receipt) }], decisionState: { phase: 'ordering', readOnly: true }, tools: runtime.toolDefinitions.filter(tool => ['menu_get', 'menu_recommend'].includes(tool.name)).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) }) })
        expect(continued.status).toBe(200)
        reply = await continued.json() as Reply
        productionRecords.push({ input: transcript, receipt, continuation: reply })
        await writeFile('/tmp/webnavior-main-relative-subject-results.json', JSON.stringify(productionRecords, null, 2), { mode: 0o600 })
      }
      expect(reply.toolCalls).toHaveLength(0)
      expect(reply.answer).toBeTruthy()
      if (!namedQuery && requestedAction === 'clarify') {
        expect(question).toBeDefined()
        expect(reply.answer).toBe(question)
      }
      if ('itemIds' in scenario && scenario.itemIds !== undefined)
        expect(presented).toBe(true)
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    }, 120_000)

    // Report: this chat, visitor session wu0beMfO… entries26–30, 2026-10-19.
    it.each([
      { transcript: '一百三以下的呢？', shownFirst: false },
      { transcript: '一百三以下呢？', shownFirst: false },
      { transcript: '一百三以下的呢？', shownFirst: true },
      { transcript: '一百三以下呢？', shownFirst: true },
    ])('updates a previous budget through real Jev, Main and Menu: $transcript/shownFirst=$shownFirst', async ({ transcript, shownFirst }) => {
      const runtime = createMenuToolRuntime({ menu: [
        { id: 'shrimp', name: '周氏蝦捲招牌便當', price: 145 },
        { id: 'chicken', name: '椒麻雞便當', price: 135 },
        { id: 'fish', name: '泰式酸辣魚便當', price: 140 },
        { id: 'pork', name: '炸排骨便當', price: 130 },
        { id: 'basil', name: '打拋豬便當', price: 125 },
        { id: 'noodles', name: '紅燒牛肉麵', price: 150 },
        { id: 'dumplings', name: '水餃', price: 80 },
      ].map(item => ({ ...menu[0]!, ...item, description: item.name, aliases: [], recommendationTags: [], optionGroups: [] })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.invoke('menu_recommend', { maxPrice: 120 })
      const scopeOffer = await runtime.invoke('menu_get', { maxPrice: 120 }) as { pendingCustomerChoice: { questionId: string } }
      await runtime.invoke('kiosk_query_scope', { questionId: scopeOffer.pendingCustomerChoice.questionId, choice: 'CATALOG' })
      const started = await app.request('/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
      const { session } = await started.json() as { session: { id: string } }
      for (const [kind, content] of [
        ...(!shownFirst ? [['user_text', '掠過'], ['assistant_text', '已略過手機登記，現在可以直接點餐。']] : []),
        ['user_text', shownFirst ? '有推薦什麼嗎' : '推薦什麼？'],
        ['assistant_text', '推薦3 項：周氏蝦捲招牌便當、椒麻雞便當、泰式酸辣魚便當。'],
        ['user_text', shownFirst ? '有一百二以下的嗎' : '有一百二以下的嗎？'],
        ['assistant_text', '你想看剛才推薦的，還是整份菜單符合的餐點？'],
        ...(shownFirst
          ? [['user_text', '剛才的'], ['assistant_text', '剛才推薦的：目前沒有符合條件的餐點。'], ['user_text', '那整份的有嗎？'], ['assistant_text', '推薦一項：水餃。']]
          : [['user_text', '整份'], ['assistant_text', '整份菜單：推薦一項：水餃。']]),
      ]) {
        const recorded = await app.request(`/visitor-sessions/${session.id}/entries`, { method: 'POST', headers, body: JSON.stringify({ kind, content }) })
        expect(recorded.status).toBe(201)
      }
      const tools: WebMcpTool[] = runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'http://localhost:5166' }))
      const decide = async (request: Parameters<Parameters<typeof runFastPath>[0]['decide']>[0]) => {
        const response = await app.request('/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ ...request, visitorSessionId: session.id }) })
        expect(response.status).toBe(200)
        const decision = await response.json() as KioskInteractionDecision
        productionRecords.push({ input: transcript, decision })
        return decision
      }
      const entry = await runFastPath({ transcript, isEnabled: async () => true, webMcp: { tools, execute: (tool, args) => runtime.invoke(tool.name as MenuToolName, args) }, decide })
      productionRecords.push({ input: transcript, entry })
      await writeFile('/tmp/webnavior-main-scope-production-results.json', JSON.stringify(productionRecords, null, 2), { mode: 0o600 })
      expect(entry).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', decisionState: { constraints: { price: { maxPrice: 130 }, unresolvedPrice: false } } })
      if (entry.kind !== 'NEEDS_ASSISTANT')
        throw new Error('Price follow-up did not reach the read-only Main task')
      await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'updated-budget', transcript, expectedMenuRevision: 0, readOnly: true, constraints: { maxPrice: 130 } })
      const response = await app.request(`/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: transcript, decisionState: { ...entry.decisionState, readOnly: true, requireMenuRead: true }, tools: tools.filter(tool => ['menu_get', 'menu_recommend'].includes(tool.name)).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) }) })
      expect(response.status).toBe(200)
      const reply = await response.json() as { toolCalls: Array<{ function: { name: string, arguments: string } }> }
      expect(reply.toolCalls).toHaveLength(1)
      const call = reply.toolCalls[0]!
      expect(call.function.name).toBe('menu_recommend')
      expect(JSON.parse(call.function.arguments)).toHaveProperty('action', 'update')
      const result = await runtime.invokeForAgent(call.function.name as MenuToolName, JSON.parse(call.function.arguments))
      await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'updated-budget' })
      expect(result).toMatchObject({ appliedPriceConditions: { maxPrice: 130 }, items: expect.arrayContaining([{ id: 'pork', price: 130 }, { id: 'basil', price: 125 }, { id: 'dumplings', price: 80 }].map(item => expect.objectContaining(item))) })
      expect(result).not.toHaveProperty('pendingCustomerChoice')
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    }, 120_000)

    // Report: this chat, session tVUWid2B_4UvHrFMVl-x2, 2026-10-19.
    it.each([
      { transcript: '那在一百二到一百四之間的有嗎？', minPrice: 120, maxPrice: 140, expected: [120, 130, 140] },
      { transcript: '一百零二到一百零四之間有嗎？', minPrice: 102, maxPrice: 104, expected: [102, 104] },
    ])('taiwanese price range through Jev, Main and Menu: $transcript', async ({ transcript, minPrice, maxPrice, expected }) => {
      const runtime = createMenuToolRuntime({ menu: [102, 104, 119, 120, 130, 140, 141].map((price, index) => ({ ...menu[0]!, id: `price-${price}`, name: `測試餐點${['甲', '乙', '丙', '丁', '戊', '己', '庚'][index]}`, price, aliases: [], description: '測試餐點', category: '主食', recommendationTags: [], optionGroups: [] })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.invoke('menu_recommend', { maxPrice: 119, limit: 1 })
      const scopeOffer = await runtime.invoke('menu_get', { maxPrice: 119 }) as { pendingCustomerChoice: { questionId: string } }
      await runtime.invoke('kiosk_query_scope', { questionId: scopeOffer.pendingCustomerChoice.questionId, choice: 'CATALOG' })
      const started = await app.request('/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
      const { session } = await started.json() as { session: { id: string } }
      const tools: WebMcpTool[] = runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'http://localhost:5166' }))
      const decide = async (request: Parameters<Parameters<typeof runFastPath>[0]['decide']>[0]) => {
        const response = await app.request('/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ ...request, visitorSessionId: session.id }) })
        expect(response.status).toBe(200)
        const decision = await response.json() as KioskInteractionDecision
        productionRecords.push({ input: transcript, decision })
        return decision
      }
      const entry = await runFastPath({ transcript, isEnabled: async () => true, webMcp: { tools, execute: (tool, args) => runtime.invoke(tool.name as MenuToolName, args) }, decide })
      productionRecords.push({ input: transcript, entry })
      await writeFile('/tmp/webnavior-main-scope-production-results.json', JSON.stringify(productionRecords, null, 2), { mode: 0o600 })
      let directResult: unknown
      if (entry.kind === 'NEEDS_ASSISTANT') {
        expect(entry.decisionState).toMatchObject({ constraints: { price: { minPrice, maxPrice }, unresolvedPrice: false } })
        await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'spoken-range', transcript, expectedMenuRevision: 0, readOnly: true, constraints: { minPrice, maxPrice } })
        const response = await app.request(`/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: transcript, decisionState: { ...entry.decisionState, readOnly: true, requireMenuRead: true }, tools: tools.filter(tool => ['menu_get', 'menu_recommend'].includes(tool.name)).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) }) })
        expect(response.status).toBe(200)
        const reply = await response.json() as { toolCalls: Array<{ function: { name: string, arguments: string } }> }
        expect(reply.toolCalls).toHaveLength(1)
        const call = reply.toolCalls[0]!
        expect(call.function.name).toBe('menu_recommend')
        expect(JSON.parse(call.function.arguments)).toHaveProperty('action', 'update')
        directResult = await runtime.invokeForAgent(call.function.name as MenuToolName, JSON.parse(call.function.arguments))
        await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'spoken-range' })
      }
      if (directResult) {
        expect(directResult).toMatchObject({ appliedPriceConditions: { minPrice, maxPrice }, items: expected.map(price => ({ price })) })
        expect(directResult).not.toHaveProperty('pendingCustomerChoice')
      }
      else {
        expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '整份菜單' })).toHaveProperty('phase', 'query_scope')
        const result = await runFastPath({ transcript: '整份菜單', isEnabled: async () => true, webMcp: { tools, execute: (tool, args) => runtime.invoke(tool.name as MenuToolName, args) }, decide })
        expect(result).toMatchObject({ kind: 'FAST_ACTION', result: { appliedPriceConditions: { minPrice, maxPrice }, items: expected.map(price => ({ price })) } })
      }
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    }, 120_000)

    it('real Main finishes one recommendation read without requesting another batch', async () => {
      const runtime = createMenuToolRuntime({ menu, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      const tools = runtime.toolDefinitions.filter(tool => ['menu_recommend', 'menu_get', 'cart_get'].includes(tool.name)).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }))
      const started = await app.request('/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
      const { session } = await started.json() as { session: { id: string } }
      const first = await app.request(`/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '推薦幾個餐點', decisionState: { phase: 'ordering', readOnly: true, requireMenuRead: true }, tools: tools.filter(tool => tool.function.name === 'menu_recommend') }) })
      expect(first.status).toBe(200)
      const initial = await first.json() as { toolCalls: Array<{ id: string, function: { name: string, arguments: string } }> }
      expect(initial.toolCalls).toHaveLength(1)
      const call = initial.toolCalls[0]!
      const receipt = await runtime.invokeForAgent(call.function.name as MenuToolName, JSON.parse(call.function.arguments))
      productionRecords.push({ input: '推薦幾個餐點', initial, receipt })
      await writeFile('/tmp/webnavior-main-scope-production-results.json', JSON.stringify(productionRecords, null, 2), { mode: 0o600 })
      expect(receipt).toHaveProperty('items')
      expect((receipt as { items: unknown[] }).items.length).toBeLessThanOrEqual(3)
      const response = await app.request(`/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ toolResults: [{ name: call.function.name, toolCallId: call.id, content: JSON.stringify(receipt) }], decisionState: { phase: 'ordering', readOnly: true }, tools: tools.filter(tool => tool.function.name !== 'menu_recommend') }) })
      expect(response.status).toBe(200)
      const continuation = await response.json() as { answer?: string, toolCalls: unknown[] }
      productionRecords.push({ input: '推薦幾個餐點', continuation })
      await writeFile('/tmp/webnavior-main-scope-production-results.json', JSON.stringify(productionRecords, null, 2), { mode: 0o600 })
      expect(continuation.toolCalls).toHaveLength(0)
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    }, 120_000)

    // Report: this chat, session -_n4bX6MRFcoRGilxK9-_ entries3–23, 2026-10-19.
    it('reaches the scope question from a price query after the reported bento conversation', async () => {
      const transcript = '120以下有什麼？'
      const runtime = createMenuToolRuntime({ menu: [
        { id: 'signature-shrimp-roll-bento', name: '周氏蝦捲招牌便當', price: 145, category: '便當' },
        { id: 'spicy-chicken-bento', name: '椒麻雞便當', price: 135, category: '便當' },
        { id: 'thai-sour-spicy-fish-bento', name: '泰式酸辣魚便當', price: 140, category: '便當' },
        { id: 'fried-pork-chop-bento', name: '炸排骨便當', price: 130, category: '便當' },
        { id: 'thai-basil-pork-bento', name: '打拋豬便當', price: 125, category: '便當' },
        { id: 'beef-noodle-soup', name: '紅燒牛肉麵', price: 150, category: '麵食' },
        { id: 'dumpling', name: '水餃', price: 80, category: '主食' },
      ].map(item => ({ ...menu[0]!, ...item, description: item.name, aliases: [], recommendationTags: [], optionGroups: [] })), screen: () => 'menu', onMenuRequested: () => {}, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.invoke('menu_recommend', { limit: 3 })
      await runtime.invoke('menu_recommend', { limit: 3, more: true })
      const conversation = { messages: [
        { role: 'user' as const, content: '有推薦的便當嗎？' },
        { role: 'assistant' as const, content: '推薦3 項：周氏蝦捲招牌便當、椒麻雞便當、泰式酸辣魚便當。 我推薦：周氏蝦捲招牌便當、椒麻雞便當、泰式酸辣魚便當。 單份基本售價：周氏蝦捲招牌便當 NT$145、椒麻雞便當 NT$135、泰式酸辣魚便當 NT$140。' },
        { role: 'user' as const, content: '120員以下的' },
        { role: 'assistant' as const, content: '120 元以下目前没有符合的便當。需要查看其他類別的餐點或調整預算嗎？' },
        { role: 'user' as const, content: '推薦幾個餐點' },
        { role: 'assistant' as const, content: '推薦3 項：周氏蝦捲招牌便當、椒麻雞便當、泰式酸辣魚便當。 推薦3 項：炸排骨便當、打拋豬便當、紅燒牛肉麵。 單份基本售價：周氏蝦捲招牌便當 NT$145、椒麻雞便當 NT$135、泰式酸辣魚便當 NT$140、炸排骨便當 NT$130、打拋豬便當 NT$125、紅燒牛肉麵 NT$150。' },
      ] }
      const tools: WebMcpTool[] = runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'http://localhost:5166' }))
      const result = await runFastPath({ transcript, isEnabled: async () => true, webMcp: { tools, execute: (tool, args) => runtime.invoke(tool.name as MenuToolName, args) }, decide: request => decideInteraction({ ...request, conversation, policy: { decisionInstruction: '', storeInstruction: '' }, invoke: async (state, questions) => {
        const response = await fetch('http://projev.aikcitri.qzz.io/v1/systemone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, questions }), signal: AbortSignal.timeout(30_000) })
        expect(response.ok).toBe(true)
        return await response.json()
      } }) })
      productionRecords.push({ input: transcript, conversation, result })
      await writeFile('/tmp/webnavior-main-scope-production-results.json', JSON.stringify(productionRecords, null, 2), { mode: 0o600 })
      expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', decisionState: { constraints: { price: { maxPrice: 120 }, unresolvedPrice: false } } })
      expect(['MENU_QUERY', 'UNCERTAIN_FILTER']).toContain(result.reason)
      const started = await app.request('/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
      const { session } = await started.json() as { session: { id: string } }
      await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'reported-price-query', transcript, expectedMenuRevision: 0, readOnly: true, constraints: { maxPrice: 120 } })
      const response = await app.request(`/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: transcript, decisionState: { ...result.decisionState, readOnly: true, requireMenuRead: true }, tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) }) })
      expect(response.status).toBe(200)
      const reply = await response.json() as { toolCalls: Array<{ function: { name: string, arguments: string } }> }
      expect(reply.toolCalls.length).toBeGreaterThan(0)
      const call = reply.toolCalls[0]!
      const offer = await runtime.invokeForAgent(call.function.name as MenuToolName, JSON.parse(call.function.arguments))
      expect(offer).toHaveProperty('pendingCustomerChoice.purpose', 'menu-query-scope')
      expect(offer).not.toHaveProperty('items')
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    }, 120_000)

    it.each([
      // Report: this chat, session -IQxJ9IOqXiIewQHNA86c, 2026-10-19.
      { input: '剛才推薦', expected: ['dumpling'] },
      { input: '剛才的', expected: ['dumpling'] },
      { input: '剛才的推薦', expected: ['dumpling'] },
      // Holdout phrasing lives only in tests, never in the model instructions.
      { input: '剛剛的', expected: ['dumpling'] },
      { input: '前面的', expected: ['dumpling'] },
      { input: '你之前介紹的', expected: ['dumpling'] },
      { input: '就你起先提到那一些吧', expected: ['dumpling'] },
      { input: '不用找新的，先前那批就行', expected: ['dumpling'] },
      { input: '不是全部，我只看你介紹過的', expected: ['dumpling'] },
      { input: '前面的不要，改看全部', expected: ['dumpling', 'soup', 'greens'] },
      { input: '不只那幾樣，店裡符合的都找', expected: ['dumpling', 'soup', 'greens'] },
      { input: '整張菜單都算進去', expected: ['dumpling', 'soup', 'greens'] },
      { input: '剛才那幾個', expected: ['dumpling'] },
      { input: '推薦裡面的', expected: ['dumpling'] },
      { input: '全部都看看', expected: ['dumpling', 'soup', 'greens'] },
      { input: '第二個', expected: ['dumpling', 'soup', 'greens'] },
      { input: '好', expected: [], clarify: true },
      { input: '都可以', expected: [], clarify: true },
      { input: '你說的那個是哪個？', expected: [], clarify: true },
      { input: '兩個有什麼差別？', expected: [], clarify: true },
      { input: '小陳，你想吃什麼', expected: [] },
      { input: '整份菜單，不過改成100以下', expected: [], fresh: true },
      { input: '剛剛的，但改成100以下', expected: [], fresh: true },
      { input: '不要麵，要素食', expected: [], fresh: true },
      { input: '幫我加兩份水餃', expected: [], fresh: true },
    ])('real route + host + menu: $input', async ({ input, expected, fresh, clarify }) => {
      const runtime = createMenuToolRuntime({ menu: [{ id: 'dumpling', name: '水餃', price: 80 }, { id: 'beef-noodles', name: '牛肉麵', price: 130 }, { id: 'soup', name: '蔬菜湯', price: 110 }, { id: 'greens', name: '燙青菜', price: 120 }].map((item): MenuItem => ({ ...menu[0]!, ...item, description: item.name, category: item.id === 'beef-noodles' ? '麵食' : item.id === 'dumpling' ? '主食' : '蔬菜', recommendationTags: [], aliases: [], optionGroups: [], composition: { ingredients: item.id === 'beef-noodles' ? ['beef', 'wheat'] : item.id === 'dumpling' ? ['pork', 'wheat'] : ['vegetables'], complete: true, source: 'merchant', revision: 'query-scope-replay', removals: [], ...(item.id === 'soup' || item.id === 'greens' ? { dietaryLabels: ['vegetarian'] } : {}) } })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.invoke('menu_recommend', { limit: 2 })
      const started = await app.request('/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
      const { session } = await started.json() as { session: { id: string } }
      const tools: WebMcpTool[] = runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'http://localhost:5166' }))
      // Exercise the initial price interpretation and Main tool request too;
      // starting directly with an owned question misses entry-route failures.
      const decide = async (request: Parameters<Parameters<typeof runFastPath>[0]['decide']>[0]) => {
        const response = await app.request('/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ ...request, visitorSessionId: session.id }) })
        expect(response.status).toBe(200)
        return await response.json() as KioskInteractionDecision
      }
      const entry = await runFastPath({ transcript: '120以下有什麼', isEnabled: async () => true, webMcp: { tools, execute: (tool, args) => runtime.invoke(tool.name as MenuToolName, args) }, decide })
      if (entry.kind === 'NEEDS_ASSISTANT') {
        expect(entry.decisionState).toMatchObject({ constraints: { price: { maxPrice: 120 }, unresolvedPrice: false } })
        await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'initial-price', transcript: '120以下有什麼', expectedMenuRevision: 0, readOnly: true, constraints: { maxPrice: 120 } })
        const response = await app.request(`/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '120以下有什麼', decisionState: { ...entry.decisionState, readOnly: true, requireMenuRead: true }, tools: tools.filter(tool => ['menu_get', 'menu_recommend'].includes(tool.name)).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) }) })
        expect(response.status).toBe(200)
        const reply = await response.json() as { toolCalls: Array<{ function: { name: string, arguments: string } }> }
        expect(reply.toolCalls).toHaveLength(1)
        const call = reply.toolCalls[0]!
        expect(await runtime.invokeForAgent(call.function.name as MenuToolName, JSON.parse(call.function.arguments))).toHaveProperty('pendingCustomerChoice.purpose', 'menu-query-scope')
        await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'initial-price' })
      }
      expect(await runtime.invoke('kiosk_fast_path_context', { transcript: input })).toMatchObject({ phase: 'query_scope', constraints: { price: { maxPrice: 120 } } })
      const traces: unknown[] = []
      const result = await runFastPath({ onTrace: trace => traces.push(trace), transcript: input, isEnabled: async () => true, webMcp: { tools, execute: (tool, args) => runtime.invoke(tool.name as MenuToolName, args) }, decide: async (request) => {
        const response = await app.request('/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ ...request, visitorSessionId: session.id }) })
        const payload = await response.json()
        expect(response.status, JSON.stringify(payload)).toBe(200)
        return payload as KioskInteractionDecision
      } })
      productionRecords.push({ input, result, traces })
      await writeFile('/tmp/webnavior-main-scope-production-results.json', JSON.stringify(productionRecords, null, 2), { mode: 0o600 })
      console.info(JSON.stringify({ productionScope: input, kind: result.kind, reason: result.reason }))
      if (expected.length) {
        expect(result).toMatchObject({ kind: 'FAST_ACTION', result: { appliedPriceConditions: { maxPrice: 120 }, items: expected.map(id => ({ id })) } })
      }
      else if (fresh) {
        expect((await runtime.invoke('kiosk_fast_path_context', { transcript: input }) as { phase: string }).phase).not.toBe('query_scope')
        expect(result.kind).not.toBe('IGNORE')
        if (input === '整份菜單，不過改成100以下' || input === '剛剛的，但改成100以下') {
          expect(result.decisionState).toMatchObject({ constraints: { price: { maxPrice: 100 }, unresolvedPrice: false } })
          await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'fresh-price', transcript: input, expectedMenuRevision: 0, readOnly: true, constraints: { maxPrice: 100 } })
          const response = await app.request(`/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: input, decisionState: { ...result.decisionState, readOnly: true, requireMenuRead: true }, tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) }) })
          expect(response.status).toBe(200)
          const reply = await response.json() as { toolCalls: Array<{ function: { name: string, arguments: string } }> }
          expect(reply.toolCalls.length).toBeGreaterThan(0)
          const call = reply.toolCalls[0]!
          const next = await runtime.invokeForAgent(call.function.name as MenuToolName, JSON.parse(call.function.arguments)) as { pendingCustomerChoice: { questionId: string } }
          expect(next).toHaveProperty('pendingCustomerChoice.purpose', 'menu-query-scope')
          expect(await runtime.invoke('kiosk_query_scope', { questionId: next.pendingCustomerChoice.questionId, choice: 'CATALOG', transcript: '全部' })).toMatchObject({ appliedPriceConditions: { maxPrice: 100 }, items: [{ id: 'dumpling', price: 80 }] })
        }
      }
      else if (clarify) {
        expect(result).toMatchObject({ kind: 'CLARIFICATION', question: { purpose: 'menu-query-scope' } })
        expect(result).toHaveProperty('prompt', '剛才推薦的是只查剛才介紹的那幾道；整份菜單是查店裡所有餐點。你想查哪個範圍？')
        const answer = await runFastPath({ transcript: '你先前提到那批', isEnabled: async () => true, webMcp: { tools, execute: (tool, args) => runtime.invoke(tool.name as MenuToolName, args) }, decide })
        expect(answer).toMatchObject({ kind: 'FAST_ACTION', result: { appliedPriceConditions: { maxPrice: 120 }, items: [{ id: 'dumpling' }] } })
      }
      else {
        expect(result.kind).toBe('IGNORE')
      }
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: input === '幫我加兩份水餃' && result.kind === 'FAST_ACTION' ? 2 : 0 } })
    }, 120_000)
  })
})
