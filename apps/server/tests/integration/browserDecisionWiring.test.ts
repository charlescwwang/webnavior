import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import type { DecisionStageResult } from '../../src/services/domain/kiosk-interaction-decision/contracts'
import type { HonoEnv } from '../../src/types/hono'

import { Buffer } from 'node:buffer'

import { Hono } from 'hono'
import { expect, it, vi } from 'vitest'

import { createBrowserDialogue } from '../../../stage-kiosk/src/services/browserDialogue'
import { createBrowserFastPathSource } from '../../../stage-kiosk/src/services/browserFastPath'
import { runFastPath } from '../../../stage-kiosk/src/services/kiosk-fast-path'
import { mockDB } from '../../src/libs/mock-db'
import { createKioskRoutes } from '../../src/routes/kiosk'
import { createKioskService } from '../../src/services/domain/kiosk'
import { createKioskSystemOneService } from '../../src/services/domain/kiosk-system-one'
import { createEnvelopeCrypto } from '../../src/utils/envelope-crypto'

import * as schema from '../../src/schemas'

// Cross-app integration uses both application runtimes; each app retains its
// own production TypeScript project instead of Server importing renderer code.
// Report: this chat; verify production candidates across both provider protocols.
it.each((['dasein', 'lookski', 'openai-decisions'] as const).flatMap(implementation => [false, true].map(segmented => ({ implementation, segmented }))))('connects production candidates through $implementation and back to Host operations (segmented=$segmented)', async ({ implementation, segmented }) => {
  const db = await mockDB(schema)
  let selected = 'start'
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    if (implementation !== 'openai-decisions')
      return Response.json({ answers: body.questions.ready ? { ready: { noul: 1 } } : { action: { choice: selected, confidence: 0.95 } } })
    const question = body.questions[0]
    const choice = question.name === 'ready' ? 'READY' : selected
    return Response.json({ answers: [{ name: question.name, type: 'choice', choice, confidence: 0.95, probabilities: question.choices.map((option: { value: string }) => ({ value: option.value, probability: option.value === choice ? 0.96 : 0.04 / (question.choices.length - 1) })) }] })
  })
  const systemOne = createKioskSystemOneService({ db, envelopeCrypto: createEnvelopeCrypto({ masterKey: Buffer.alloc(32, 4) }), fetchImpl })
  const profile = await systemOne.save({ name: 'synthetic', implementation, baseURL: implementation !== 'openai-decisions' ? 'http://jev.test' : 'https://api.openai.com/v1', modelId: implementation === 'openai-decisions' ? 'gpt-6-luna' : 'Qwen/Qwen3.5-4B', plaintextKey: 'synthetic-only', timeoutMs: 5000 })
  await systemOne.readiness(profile.id)
  await systemOne.activate(profile.id)
  fetchImpl.mockClear()
  const complete = vi.fn(async () => Response.json({ choices: [] }))
  const service = createKioskService(db)
  const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: service, llmGateway: { complete }, runtimeModelPolicy: { modelFor: async () => 'test-main' }, systemOne }))
  const enrollment = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"registrationCode":"483920"}' })
  const cookie = enrollment.headers.get('Set-Cookie')!.split(';')[0]!
  const headers = { 'Cookie': cookie, 'Content-Type': 'application/json' }
  const input = { transcript: '開始點餐', includeTrace: true, candidates: [{ id: 'start', description: '使用目前B3開始點餐' }], decisionState: { phase: 'selecting_table', tableSelection: { choices: ['櫃台取餐', 'B3 吧檯'], selectedTable: 'B3 吧檯' } } }
  const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify(input) })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ kind: 'FAST_ACTION', actionId: 'start', modelCalls: 1, trace: { decisionState: expect.stringContaining('B3') } })
  expect(fetchImpl).toHaveBeenCalledOnce()
  expect(complete).not.toHaveBeenCalled()
  expect(String(fetchImpl.mock.calls[0][0])).toBe(implementation !== 'openai-decisions' ? 'http://jev.test/v1/systemone' : 'https://api.openai.com/v1/decisions')

  // Force answers only at the model IO boundary: every candidate, projection,
  // HTTP field, provider encoding and Host dispatch comes from production code.
  // This proves wiring, not model accuracy or merchant execution.
  const tools: ServiceTool[] = ['browser_cart_get', 'browser_observe', 'browser_product_get', 'browser_open_product', 'browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_review', 'browser_return_menu', 'browser_present', 'browser_table_select', 'browser_start_ordering'].map(name => ({ name, description: name, inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }))
  const products = ['A套餐', '炸排骨便當', '三杯雞便當', '蛋花湯', 'B套餐'].map((name, index) => ({ ref: `p-${index}`, name, price: 100 + index, kind: 'product', priceType: 1, configurations: [{ version: `config-${index}`, variantRef: '', name, unitPrice: 100 + index, groups: [] }] }))
  const facts = { ok: true, page: 'menu', products, cart: { version: 'cart-current', lines: [{ ref: 'pork', productRef: 'p-1', name: '炸排骨便當', quantity: 3 }, { ref: 'chicken', productRef: 'p-2', name: '三杯雞便當', quantity: 4 }] } }
  // Baseline cases use explicit effects and known targets, including the
  // user-accepted 三杯雞 alias. 套餐 is shared by A/B, never B alone.
  const cases = [
    { text: '開始點餐', id: 'start', operation: 'browser_start_ordering', args: { name: 'B3 吧檯' }, facts: { page: 'table', tableChoices: ['櫃台取餐', 'B3 吧檯'], selectedTable: 'B3 吧檯' } },
    { text: 'A套餐裡面有哪些餐點？', id: 'intent:read-item', operation: 'browser_product_get', args: { names: ['A套餐'] } },
    { text: '請打開A套餐的餐點視窗', id: 'intent:select-item', operation: 'browser_open_product', args: { name: 'A套餐' } },
    { text: '我要炸排骨便當', id: 'intent:ask-quantity', operation: 'browser_ask_quantity', args: { productRef: 'p-1' }, facts: { cart: { version: 'cart-current', lines: [] } } },
    { text: '炸排骨便當再加兩份', id: 'intent:add-item', operation: 'browser_cart_add', args: { productRef: 'p-1', quantity: 2, version: 'cart-current' } },
    { text: 'A套餐兩份、蛋花湯一份', id: 'intent:add-items', operation: 'browser_add_items', args: { items: [{ name: 'A套餐', quantity: 2 }, { name: '蛋花湯', quantity: 1 }] } },
    { text: '三杯雞改成兩份', id: 'intent:set-quantity', operation: 'browser_cart_quantity', args: { version: 'cart-current', lineRef: 'chicken', quantity: 2 }, facts: { page: 'cart' } },
    { text: '炸排骨便當全部不要', id: 'intent:remove-item', operation: 'browser_cart_remove', args: { version: 'cart-current', lineRef: 'pork' } },
    { text: '打開購物車', id: 'intent:view-cart', operation: 'browser_cart_review', args: {} },
    { text: '取消搜尋，回到完整菜單', id: 'intent:return-menu', operation: 'browser_return_menu', args: {}, facts: { search: '蜜汁雞排' } },
    { text: '兩份', id: 'answer:current', operation: 'browser_answer_question', args: {}, question: 'quantity', facts: { cart: { version: 'cart-current', lines: [] } } },
    { text: '炸排骨便當', id: 'answer:current', operation: 'browser_answer_question', args: {}, question: 'product', facts: { cart: { version: 'cart-current', lines: [] } } },
  ]
  for (const sample of cases) {
    selected = sample.id
    fetchImpl.mockClear()
    const current = { ...facts, ...sample.facts }
    const dialogue = createBrowserDialogue({ owner: () => 'visitor-wiring', documentId: () => 'document-wiring', answer: async () => ({ kind: 'UNCERTAIN', provider: 'main' }) })
    if (sample.question === 'quantity')
      dialogue.presentQuantity(current, 'p-1', '我要炸排骨便當')
    if (sample.question === 'product')
      dialogue.presentProducts(current, '便當', '我要便當')
    const execute = vi.fn(async (tool: ServiceTool, _args: Record<string, unknown>) => ({ ok: true, source: 'browser', status: 'verified', customerMessage: '已核對。', dataOnly: tool.name === 'browser_product_get', products: [products[0]], productDialog: tool.name === 'browser_open_product' ? [{ name: 'A套餐' }] : [] }))
    const source = createBrowserFastPathSource({ tools, read: async () => current, execute, hasPendingQuestion: dialogue.hasPending, pendingQuestion: raw => dialogue.conversation(raw).waitingFor, canAnswerLocally: dialogue.canAnswerLocally, catalogLabels: () => [{ name: '三杯雞便當', aliases: ['三杯雞'], category: '' }, { name: 'A套餐', aliases: ['套餐'], category: '' }, { name: 'B套餐', aliases: ['套餐'], category: '' }] })
    const outcome = await runFastPath({
      transcript: sample.text,
      isEnabled: systemOne.isEnabled,
      source,
      webMcp: { tools, execute },
      decide: async (request) => {
        const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ ...request, segmented }) })
        expect(response.status, sample.text).toBe(200)
        let decision = await response.json() as DecisionStageResult
        const consumed = new Set<string>()
        while (decision.kind === 'DECISION_PROGRESS' || decision.kind === 'SERVICE_RECOVERY_PROGRESS') {
          expect(consumed.has(decision.continuationId)).toBe(false)
          consumed.add(decision.continuationId)
          expect(consumed.size).toBeLessThanOrEqual(24)
          const next = await app.request(`/api/kiosk/interaction-decisions/${encodeURIComponent(decision.continuationId)}`, { method: 'POST', headers, body: '{}' })
          expect(next.status, sample.text).toBe(200)
          decision = await next.json() as DecisionStageResult
        }
        return decision
      },
    })
    expect(outcome.kind, sample.text).toBe('FAST_ACTION')
    expect(execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: sample.operation }), expect.objectContaining(sample.args))
    expect(fetchImpl, sample.text).toHaveBeenCalledOnce()
    const wire = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    const state = JSON.parse(implementation !== 'openai-decisions' ? wire.state : wire.input)
    const choices = implementation !== 'openai-decisions' ? wire.questions.action.criteria : Object.fromEntries(wire.questions[0].choices.map((choice: { value: string, description: string }) => [choice.value, choice.description]))
    expect(Object.hasOwn(choices, sample.id), sample.text).toBe(true)
    expect(choices, sample.text).not.toHaveProperty('IGNORE')
    if (sample.question)
      expect(Object.keys(choices), sample.text).toEqual(['answer:current', 'HANDOFF'])
    expect(choices).toMatchObject(Object.fromEntries(state.availableActions.map((choice: { id: string, description: string }) => [choice.id, choice.description])))
    expect(state.customerUtterance).toBe(sample.text)
    if (sample.question)
      expect(state.waitingFor.questionId).toBe(dialogue.conversation(current).waitingFor!.questionId)
    if (sample.facts?.page === 'cart')
      expect(state.screen.screen).toBe('cart_review')
  }
  expect(complete).not.toHaveBeenCalled()
})
