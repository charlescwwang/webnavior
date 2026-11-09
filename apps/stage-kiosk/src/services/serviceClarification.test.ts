import type { CatalogSnapshot } from '../../../order-menu-server/src/domain/contracts'
import type { KioskDecisionState } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'

import { conversationContextSchema, replyFromContext, serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it, vi } from 'vitest'

import { historicalSupplierCatalog } from '../../../order-menu-server/src/fixtures/historicalSupplierCatalog'
import { createPosSimulator } from '../../../order-menu-server/src/simulator'
import { supplierCatalog } from '../../../order-menu-server/src/supplierSimulation'
import { applySupplierOrdering } from '../../../order-menu/src/supplierOrdering'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { resolveOrderingIntent } from '../../../server/src/services/domain/kiosk-conversation-skills'
import { resolveServiceHandoff } from '../../../server/src/services/domain/kiosk-interaction-decision/serviceResolution'
import { conversationDecisionStateFrom, refreshConversationState, runFastPath } from './kiosk-fast-path'
import { createInvitationWindow, createServiceClarificationWindow, operationReplyFrom, orderAssistanceFromRejection, questionReceiptFrom } from './questionPresentation'

// Report: this chat Nov09 — fish browsing still carried a stale checkout question.
it.each([
  { purpose: 'cart-review', query: '魚' },
  { purpose: 'checkout-entry', query: '魚' },
  { purpose: 'cart-review', query: '麵' },
  { purpose: 'checkout-entry', query: '麵' },
  { purpose: 'cart-review', query: '水餃' },
  { purpose: 'checkout-entry', query: '水餃' },
])('lets $query browsing replace an older $purpose without checkout consent', async ({ purpose, query }) => {
  const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  let screen: 'menu' | 'cart_review' = 'menu'
  const runtime = createMenuToolRuntime({
    menu: catalog.items,
    serviceContext: () => ({ id: 'table-context', serviceMode: 'table-service', directSubmissionSupported: true, table: { id: 'a03', label: 'a03' } }),
    screen: () => screen,
    onReviewRequested: () => { screen = 'cart_review' },
    onRecommendationsChange: () => { screen = 'menu' },
    onAction: () => {},
    onCartChange: () => {},
    onMenuSelection: () => {},
  })
  await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 3 })
  const old = await runtime.invoke('order_ask_question', { purpose }) as { pendingCustomerChoice: { questionId: string, question: string } }
  await runtime.invoke('kiosk_dialogue_presented', { questionId: old.pendingCustomerChoice.questionId, content: old.pendingCustomerChoice.question })
  const read = await runtime.invoke('menu_get', { query, display: true }) as { pendingCustomerChoice?: { questionId: string, question: string } }
  expect(read.pendingCustomerChoice).toBeDefined()
  await runtime.invoke('kiosk_dialogue_presented', { questionId: read.pendingCustomerChoice!.questionId, content: read.pendingCustomerChoice!.question })
  const state = await runtime.invoke('kiosk_fast_path_context', { transcript: '還有其他的嗎？' }) as KioskDecisionState
  expect(state.waitingFor?.purpose).toBe('item-order')
  expect(state.intentRecovery?.candidateIds).not.toContain('intent:start-checkout')
  const complete = vi.fn()
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: JSON.stringify({ choice: 'MENU_INFORMATION_ONLY', subjects: [query] }) } }] } }] }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"choice":"MENU_INFORMATION_ONLY","subjects":[]}' } }] } }] }))
  const continuation = await resolveServiceHandoff({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' }, '還有其他的嗎？', state, complete)
  expect(continuation).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' })
  const task = conversationDecisionStateFrom(state, continuation)!
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'more-meals', transcript: '還有其他的嗎？', expectedMenuRevision: task.menuRevision, readOnly: task.readOnly === true, constraints: {} })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(context.allowedToolNames).toContain('menu_recommend')
  expect(context.allowedToolNames).not.toContain('checkout_start')
  expect(await runtime.invokeForAgent('menu_recommend', { action: 'continue' })).toHaveProperty('customerMessage', expect.any(String))
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 3)
})

// Report: this chat Nov09 — an already-added dumpling serving followed by 三份.
it('asks before changing or adding servings, then applies a separately qualified total correction', async () => {
  const runtime = createMenuToolRuntime({ menu: applySupplierOrdering(historicalSupplierCatalog.items), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('order_add_item', { itemId: 'supplier-item-08', quantity: 1, options: [{ groupId: 'extra-pieces', valueId: 'extra-5' }] })
  const webMcp: Parameters<typeof runFastPath>[0]['webMcp'] = { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) }
  const result = await runFastPath({ transcript: '我要三份', isEnabled: async () => true, webMcp, decide: request => resolveServiceHandoff({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' }, request.transcript, request.decisionState, async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"choice":"ORDER_ADDITION","subjects":[]}' } }] } }] })) })
  expect(result.kind).toBe('SERVICE_CLARIFICATION')
  const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(before.cart.lines).toHaveLength(1)
  expect(before.cart.lines[0]).toMatchObject({ quantity: 1, unitPrice: 104, options: [{ groupId: 'extra-pieces', valueId: 'extra-5' }] })
  const current = await runtime.invoke('kiosk_interaction_state') as KioskDecisionState
  const qualified = await resolveServiceHandoff({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' }, '水餃改成總共三份', current, async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"choice":"ORDER_MUTATION","subjects":[]}' } }] } }] }))
  const task = conversationDecisionStateFrom(current, qualified)!
  expect(task.requestScope).toBe('order-operation')
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'quantity-correction', transcript: '水餃改成總共三份', expectedMenuRevision: task.menuRevision, readOnly: task.readOnly === true, constraints: {} })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(context.allowedToolNames).toContain('cart_set_line_quantity')
  await runtime.invokeForAgent('cart_set_line_quantity', { lineId: before.cart.lines[0]!.id, quantity: 3 })
  const after = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(after.cart.lines).toHaveLength(1)
  expect(after.cart).toMatchObject({ itemCount: 3, total: 312 })
  expect(after.cart.lines[0]).toMatchObject({ quantity: 3, options: [{ groupId: 'extra-pieces', valueId: 'extra-5' }] })
})

// Report: this chat Nov09, supplier replacement consent 對一份 locked the Kiosk.
it.each(['original', 'supplier'] as const)('keeps a replacement answer usable after semantic uncertainty on %s', async (catalogKind) => {
  const original = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  const items = catalogKind === 'supplier' ? applySupplierOrdering(supplierCatalog.items) : original.items
  const itemId = catalogKind === 'supplier' ? 'supplier-item-02' : 'fried-pork-chop-bento'
  const runtime = createMenuToolRuntime({ menu: items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'proposal', transcript: '一份排骨飯這樣就好', expectedMenuRevision: 0, constraints: {} })
  await runtime.invoke('kiosk_conversation_context')
  await runtime.invokeForAgent('menu_get', { query: '排骨飯' })
  await runtime.invoke('kiosk_conversation_context')
  const proposal = await runtime.invokeForAgent('menu_confirm_item', { itemId }) as { pendingCustomerChoice: { questionId: string, question: string } }
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'proposal' })
  await runtime.invoke('kiosk_dialogue_presented', { questionId: proposal.pendingCustomerChoice.questionId, content: proposal.pendingCustomerChoice.question })
  const result = await runFastPath({ transcript: '對一份', isEnabled: async () => true, decide: async request => resolveOrderingIntent({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' }, { ...request, backgroundSpeechMode: 'off' }, async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_ordering_intent', arguments: JSON.stringify({ choice: 'UNCERTAIN', requestCoverage: 'UNCERTAIN' }) } }] } }] })), webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) } })
  expect(result.kind).toBe('CLARIFICATION')
  expect(await runtime.invoke('kiosk_interaction_state')).toHaveProperty('phase', 'meal_confirmation')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '對，一份' }) as KioskDecisionState & { candidates: Array<{ id: string }> }
  const yes = answer.candidates.find(candidate => candidate.id.endsWith(':yes'))!
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: yes.id })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId, quantity: 1 }] } })
  await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: yes.id })).rejects.toThrow('STALE_PLAN')
})

// Report: this chat Nov09, old-menu session s6ma-FTAYX9AQsBuN4NSo.
it.each(['我是說泰式酸辣魚', '我要泰式酸辣魚一份', '牛肉麵不要了，改成泰式酸辣魚一份'])('hands a new fragment order to Main without restoring the old quantity restriction: %s', async (transcript) => {
  const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '我要紅燒牛肉麵' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const decide = vi.fn()
    .mockResolvedValueOnce({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', modelQuestions: 1 })
    .mockResolvedValueOnce({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', requestScope: 'order-operation', modelQuestions: 1 })
  const result = await runFastPath({ transcript, isEnabled: async () => true, decide, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) } })
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  const task = conversationDecisionStateFrom(result.decisionState, result)!
  expect(task.readOnly).not.toBe(true)
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'new-fish', transcript, expectedMenuRevision: task.menuRevision, readOnly: task.readOnly === true, constraints: {} })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(context.phase).toBe('ordering')
  expect(context.allowedToolNames).toContain('menu_get')
  expect(context.allowedToolNames).toContain('order_cancel_request')
  expect(context.retainedRequests).toEqual([expect.objectContaining({ itemId: 'beef-noodle-soup', status: 'suspended' })])
  if (transcript.startsWith('牛肉麵不要了')) {
    // The qualified replacement follows the existing explicit cancellation
    // tool; merely asking about another dish never performs this step.
    await runtime.invokeForAgent('order_cancel_request', { requestId: context.retainedRequests[0]!.id })
    expect(await runtime.invoke('kiosk_conversation_context')).toHaveProperty('retainedRequests', [])
  }
  await runtime.invokeForAgent('menu_get', { query: '泰式酸辣魚', display: true })
  const afterLookup = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(afterLookup.allowedToolNames).toContain('menu_confirm_item')
  expect(await runtime.invokeForAgent('menu_confirm_item', { itemId: 'thai-sour-spicy-fish-bento' })).toHaveProperty('pendingCustomerChoice')
  expect(context.waitingFor).toBeUndefined()
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

it('treats a service answer as a read-only cue rather than answering an older Menu question', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const state = await runtime.invoke('kiosk_fast_path_context', { transcript: '對' }) as KioskDecisionState
  const window = createServiceClarificationWindow()
  window.present({ questionId: 'service', question: '您想查詢資訊還是調整訂單？', sourceUtterance: '幫我處理一下', expiresAt: Date.now() + 30000, contextKey: serviceContextKey(state) })
  const decide = vi.fn(async (request) => {
    expect(request.decisionState.serviceClarification.questionId).toBe('service')
    return { kind: 'NEEDS_ASSISTANT' as const, reason: 'UNCERTAIN_OPERATION' as const, recovery: { status: 'completed' as const, admission: 'service' as const, disposition: 'assistant' as const, readOnly: true, contextKey: serviceContextKey(state) } }
  })
  const result = await runFastPath({ transcript: '對', isEnabled: async () => true, serviceClarification: state => window.current(state), decide, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) } })
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(conversationDecisionStateFrom(result.decisionState, result)).toMatchObject({ readOnly: true, serviceClarification: { questionId: 'service' } })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  expect(window.current({ ...state, revisions: { cart: 1, checkout: 0, selectedItem: 0 } })).toBeUndefined()
})

it('rejects a recovered decision if the cart changed while Main was deciding', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const result = await runFastPath({ transcript: '幫我確認', isEnabled: async () => true, decide: async (request) => {
    const key = serviceContextKey(request.decisionState!)
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    return { kind: 'NEEDS_ASSISTANT', recovery: { status: 'completed', admission: 'service', contextKey: key } }
  }, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) } })
  expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST' })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1 } })
})

// Report: frozen live112 C07-A2, attempt552; validating completed service
// recovery reread the decision producer and replaced its current answer ticket.
it('revalidates recovered configuration context without issuing another answer lease', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '我要蝦捲' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  let questionId: string | undefined
  const result = await runFastPath({ transcript: '好', isEnabled: async () => true, decide: async (request) => {
    questionId = request.decisionState?.waitingFor?.questionId
    return { kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION', recovery: { status: 'completed', admission: 'service', disposition: 'assistant', contextKey: serviceContextKey(request.decisionState!) } }
  }, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) } })
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result.decisionState?.waitingFor?.questionId).toBe(questionId)
  expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ waitingFor: { questionId } })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

// Report: reported-20261103-background-service-clarification-loop in orderingIncidents.ts.
it('preserves an unexpired question across a long silent chain without renewing it', () => {
  vi.useFakeTimers()
  try {
    const state = { phase: 'ordering' }
    const window = createServiceClarificationWindow()
    const cue = { questionId: 'original', question: '查詢還是調整？', sourceUtterance: '幫我', contextKey: serviceContextKey(state), expiresAt: Date.now() + 30000 }
    window.present(cue)
    for (let index = 0; index < 20; index++) {
      window.settle({ kind: index % 2 ? 'UNAVAILABLE' : 'IGNORE' })
      vi.advanceTimersByTime(1000)
      expect(window.current(state)).toEqual(cue)
    }
    window.settle({ kind: 'NEEDS_ASSISTANT' })
    expect(window.current(state)).toBeUndefined()
    window.present(cue)
    vi.advanceTimersByTime(10000)
    expect(window.current(state)).toEqual(cue)
  }
  finally { vi.useRealTimers() }
})

// Report: Nov3 frozen C14-F2; an independent fulfillment request omits the old checkout question.
it('revalidates an independent fulfillment request against unchanged Menu state', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, checkout: {
    snapshot: () => undefined,
    revision: () => 0,
    paymentStatus: () => undefined,
    paymentMethods: ['linepay'],
    assertCanRestart: () => {},
    restart: () => {},
    cancel: () => {},
    start: () => ({ stage: 'membership' }),
    skipMembership: () => ({ stage: 'invoice' }),
    chooseInvoice: method => ({ stage: 'invoice', invoiceMethod: method }),
    requestTaxId: () => ({ stage: 'tax-id', taxId: '' }),
    setTaxId: taxId => ({ stage: 'tax-id', taxId }),
    confirmInvoice: () => ({ stage: 'payment' }),
    confirmTaxId: () => ({ stage: 'payment' }),
    selectPayment: async () => ({ status: 'selected', customerMessage: '等待付款' }),
  } })
  await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll', quantity: 1 })
  const receipt = await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
  const question = questionReceiptFrom(receipt)
  expect(question?.purpose).toBe('checkout-entry')
  await runtime.invoke('kiosk_dialogue_presented', { questionId: question!.questionId, content: operationReplyFrom(receipt)! })
  const result = await runFastPath({ transcript: '更正，我要內用', isEnabled: async () => true, decide: async (request) => {
    expect(request.decisionState?.intentRecovery?.kind).toBe('request')
    expect(request.decisionState?.waitingFor).toBeUndefined()
    return { kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', requestScope: 'order-operation', resolvedBy: 'main-service', recovery: { status: 'completed', admission: 'service', disposition: 'assistant', contextKey: serviceContextKey(request.decisionState!) } }
  }, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) } })
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { fulfillmentMode: 'takeout', itemCount: 1 } })
})

// Report: this chat Nov7; staff help is a separate, non-commerce invitation.
it('regression K1107-STAFF binds help to one live service answer and invalidates changed context', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const cue = { purpose: 'staff-assistance' as const, questionId: 'staff-question', question: '需要幫您呼叫工作人員嗎？', sourceUtterance: '過敏安全無法確認', contextKey: serviceContextKey(context), expiresAt: Date.now() + 30000 }
  const window = createServiceClarificationWindow()
  window.present(cue)
  expect(window.current(context)?.purpose).toBe('staff-assistance')
  const state = { phase: context.phase, serviceClarification: cue }
  const answer = conversationDecisionStateFrom(state, { reason: 'UNCERTAIN_OPERATION', recovery: { status: 'completed', admission: 'service', disposition: 'assistant', readOnly: true } })
  const fresh = refreshConversationState(context, answer)
  expect(fresh.context?.staffAssistance?.questionId).toBe(cue.questionId)
  const directAnswer = conversationDecisionStateFrom(state, { reason: 'GENERAL_QUESTION' })
  expect(refreshConversationState(context, directAnswer).context?.staffAssistance?.questionId).toBe(cue.questionId)
  const newRequest = conversationDecisionStateFrom(state, { reason: 'NEW_REQUEST', recovery: { status: 'completed', admission: 'service', disposition: 'assistant', readOnly: false } })
  expect(refreshConversationState(context, newRequest).context?.staffAssistance).toBeUndefined()
  const changed = { ...context, revisions: { ...context.revisions, cart: context.revisions.cart + 1 } }
  expect(refreshConversationState(changed, answer).context?.staffAssistance).toBeUndefined()
  expect(window.current(changed)).toBeUndefined()
  window.present(cue)
  window.reset()
  expect(window.current(context)).toBeUndefined()
})

// Report: this chat, Nov7 — a yes to special-order intent is not staff-call or order consent.
it('binds special-order confirmation to its current context and revokes it on cart changes', () => {
  const context = parse(conversationContextSchema, { contextId: 'special', capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] })
  const cue = { purpose: 'order-assistance' as const, questionId: 'intent', question: '是要整份菜單各一份嗎？', sourceUtterance: '全部各一份', contextKey: serviceContextKey(context), expiresAt: Date.now() + 30000 }
  const state = { phase: 'ordering', serviceClarification: cue }
  expect(refreshConversationState(context, state).context?.orderAssistance?.questionId).toBe('intent')
  expect(refreshConversationState(context, state).context?.staffAssistance).toBeUndefined()
  expect(conversationDecisionStateFrom(state, { reason: 'NEW_REQUEST', requestScope: 'order-operation' })?.serviceClarification).toBeUndefined()
  expect(refreshConversationState({ ...context, revisions: { ...context.revisions, cart: 1 } }, state).context?.orderAssistance).toBeUndefined()
  expect(refreshConversationState(context, { ...state, serviceClarification: { ...cue, expiresAt: Date.now() - 1 } }).context?.orderAssistance).toMatchObject({ questionId: cue.questionId })
})

// Report: this chat, Nov7 — business refusals are EXECUTION_FAILED, not successful Fast Path actions.
it('offers intent confirmation only for a proven no-effect quantity rejection', () => {
  const rejection = { ok: false, executed: false, rejection: 'quantity-limit', error: 'QUANTITY_LIMIT', toolName: 'order_add_item', maximum: 20, requestedQuantity: 100, customerMessage: '每款單次最多20份。' }
  const state = { phase: 'ordering', revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 } }
  const cue = orderAssistanceFromRejection(rejection, '水餃100份', state)!
  expect(cue.purpose).toBe('staff-assistance')
  expect(cue.question).toContain('20份')
  expect(cue.question).toContain('需要幫您通知服務人員嗎')
  expect(cue.question).not.toContain('已經呼叫')
  expect(orderAssistanceFromRejection(rejection, '水餃100份', state, true)).toBeUndefined()
  expect(orderAssistanceFromRejection({ ...rejection, executed: true }, '水餃100份', state)).toBeUndefined()
  expect(orderAssistanceFromRejection(rejection, '水餃100份', undefined)).toBeUndefined()
  expect(orderAssistanceFromRejection({ error: 'TOOL_FAILED' }, '水餃100份', state)).toBeUndefined()
})

// Report: this chat, Nov08 — an unchanged cart does not imply an unchanged screen.
it('rejects recovered meaning after recommendations change during model work', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: () => {} })
  const result = await runFastPath({ transcript: '請再幫我看看', isEnabled: async () => true, decide: async (request) => {
    const key = serviceContextKey(request.decisionState!)
    await runtime.invoke('menu_recommend', { action: 'update', limit: 3 })
    return { kind: 'NEEDS_ASSISTANT', recovery: { status: 'completed', admission: 'service', contextKey: key } }
  }, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) } })
  expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST' })
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

// Report: this chat, Nov09 — a Host navigation invitation changed the service cue key and stole the next assent.
it('binds a new service question to Menu state and supersedes the old Host invitation', async () => {
  const invitations = createInvitationWindow()
  const services = createServiceClarificationWindow()
  const raw = { phase: 'ordering', revisions: { menu: 1, cart: 0, checkout: 0, selectedItem: 0, recommendation: 1 } }
  invitations.present({ questionId: 'return', purpose: 'menu-return-invitation', question: '回菜單嗎？', choices: [{ id: 'intent:return-menu', description: '返回菜單' }], expiresAt: Date.now() + 30000 })
  const projected = invitations.decisionState(raw, Date.now())!
  const cue = { questionId: 'staff', purpose: 'staff-assistance' as const, question: '需要服務人員協助嗎？', sourceUtterance: '低脂餐', contextKey: serviceContextKey(projected), expiresAt: Date.now() + 30000 }
  services.present(cue, raw)
  const active = services.current(raw)
  expect(active).toHaveProperty('questionId', 'staff')
  expect(invitations.decisionState({ ...raw, serviceClarification: active }, Date.now())).not.toHaveProperty('waitingFor')
  invitations.supersede()
  expect(invitations.history()).toMatchObject([{ status: 'superseded' }])
  expect(invitations.decisionState(raw, Date.now())).not.toHaveProperty('waitingFor')
})

// Report: this chat Nov09 03:55 — staff assent was requalified as a meal request on both pages.
it.each(['original', 'supplier'])('keeps a finite staff answer in its current invitation: %s', async (merchant) => {
  const runtime = createMenuToolRuntime({ ...(merchant === 'supplier' ? { menu: applySupplierOrdering(supplierCatalog.items), merchant: { id: 'shalun-simulation', operatorName: '周氏蝦捲', paymentPolicy: 'cashless' } } : {}), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const services = createServiceClarificationWindow()
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const cue = { purpose: 'staff-assistance' as const, questionId: 'food-safety', question: '需要幫您呼叫服務人員嗎？', sourceUtterance: '食安資訊', contextKey: serviceContextKey(context), expiresAt: Date.now() - 120000 }
  const decide = vi.fn(async () => ({ kind: 'SERVICE_CLARIFICATION' as const, question: { ...cue, purpose: 'order-assistance' as const, question: '您是要依照「好啊」安排餐點嗎？' } }))
  for (const transcript of ['好啊', '對啊', '對的', '是啊', '好', '可以', '不用', '不需要', '不用了']) {
    services.present(cue)
    const accepted = vi.fn()
    const result = await runFastPath({ transcript, isEnabled: async () => true, serviceClarification: state => services.current(state), onUtteranceAccepted: accepted, decide, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) } })
    expect(result.kind).toBe('SERVICE_REPLY')
    expect(accepted).toHaveBeenCalledTimes(1)
    if (result.kind !== 'SERVICE_REPLY')
      throw new Error('Expected a direct staff reply')
    expect(result.questionId).toBe(cue.questionId)
    expect(result.reply.action).toBe(['不用', '不需要', '不用了'].includes(transcript) ? 'decline' : 'accept')
    expect(result.reply.content.includes('已通知服務人員')).toBe(result.reply.action === 'accept')
    expect(decide).not.toHaveBeenCalled()
    expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  }
  for (const [transcript, question] of [
    ['好啊，水餃兩份', cue],
    ['小明，好啊', cue],
    ['好啊', { ...cue, contextKey: 'changed-cart' }],
  ] as const) {
    decide.mockClear()
    services.present(question)
    await runFastPath({ transcript, isEnabled: async () => true, serviceClarification: state => services.current(state), decide, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) } })
    expect(decide).toHaveBeenCalledTimes(1)
  }
})

it('retires generic clarification read-only scope only after this turn receives independent operation qualification', () => {
  const state = { phase: 'ordering', readOnly: true, serviceClarification: { questionId: 'old-meaning', question: '要調整什麼？', sourceUtterance: '剛才的設定不對', contextKey: 'current', expiresAt: Date.now() + 30000 } }
  const qualified = conversationDecisionStateFrom(state, { reason: 'NEW_REQUEST', requestScope: 'order-operation', recovery: { status: 'completed', admission: 'service', disposition: 'assistant', readOnly: true } })
  expect(qualified?.readOnly).not.toBe(true)
  expect(qualified?.serviceClarification).toBeUndefined()
  const unqualified = conversationDecisionStateFrom(state, { reason: 'UNCERTAIN_OPERATION', recovery: { status: 'completed', admission: 'service', disposition: 'assistant', readOnly: true } })
  expect(unqualified?.readOnly).toBe(true)
  expect(unqualified?.serviceClarification).toHaveProperty('questionId', 'old-meaning')
})

it('uses a newly qualified cart-option correction without changing servings or another meal', async () => {
  const runtime = createMenuToolRuntime({ menu: applySupplierOrdering(historicalSupplierCatalog.items), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('order_add_item', { itemId: 'supplier-item-10', quantity: 1 })
  await runtime.invoke('order_add_item', { itemId: 'supplier-item-08', quantity: 2, options: [{ groupId: 'extra-pieces', valueId: 'extra-0' }] })
  const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const qualified = conversationDecisionStateFrom({ phase: 'ordering', readOnly: true }, { requestScope: 'order-operation', reason: 'NEW_REQUEST' })!
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'correction', transcript: '水餃每份加量改成五粒', expectedMenuRevision: 0, readOnly: qualified.readOnly === true, constraints: {} })
  await runtime.invoke('kiosk_conversation_context')
  const line = before.cart.lines.find(line => line.itemId === 'supplier-item-08')!
  await runtime.invokeForAgent('cart_set_line_option', { lineId: line.id, groupId: 'extra-pieces', valueId: 'extra-5' })
  const after = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(after.cart.lines.find(line => line.itemId === 'supplier-item-08')).toMatchObject({ quantity: 2, unitPrice: 104, options: [{ groupId: 'extra-pieces', valueId: 'extra-5' }] })
  expect(after.cart.lines.find(line => line.itemId === 'supplier-item-10')).toEqual(before.cart.lines.find(line => line.itemId === 'supplier-item-10'))
  expect(after.cart.total).toBe(438)
})

// Report: this chat Nov09 — the answer to an oversized-order question locked DEV-403776.
it('hands a bound special-order answer to Main without granting an order effect', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const cue = { purpose: 'order-assistance' as const, questionId: 'oversized', question: '您是要一百份嗎？', sourceUtterance: '水餃100份', contextKey: serviceContextKey(context), expiresAt: Date.now() + 30000 }
  const decide = vi.fn(async () => ({ kind: 'UNAVAILABLE' as const, reason: 'INVALID_CHOICE' as const }))
  const result = await runFastPath({ transcript: '對啊', isEnabled: async () => true, serviceClarification: () => cue, decide, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) } })
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(decide).not.toHaveBeenCalled()
  const task = conversationDecisionStateFrom(result.decisionState, result)
  expect(task?.readOnly).toBe(true)
  expect(refreshConversationState(context, task).context?.orderAssistance?.questionId).toBe(cue.questionId)
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

// Report: this chat Nov09 — accepting quantity help must stay non-blocking and preserve normal ordering.
it.each(['accept', 'decline'] as const)('continues ordering after a quantity assistance %s', async (action) => {
  const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  const itemId = catalog.items.find(item => item.name.includes('水餃'))!.id
  const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('order_add_item', { itemId, quantity: 1 })
  const rejection = await runtime.executeTool('order_add_item', { itemId, quantity: 100 })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const cue = orderAssistanceFromRejection(rejection, '水餃100份', context)!
  expect(cue.purpose).toBe('staff-assistance')
  const decision = conversationDecisionStateFrom({ ...context, serviceClarification: cue }, { reason: 'GENERAL_QUESTION', requestScope: 'service-information' })
  const answerContext = refreshConversationState(context, decision).context!
  const reply = replyFromContext(JSON.stringify({ kind: 'staff-assistance', action }), answerContext)!
  if (action === 'accept')
    expect(reply.content).toContain('已通知服務人員')
  else
    expect(reply.content).not.toContain('已通知服務人員')
  expect(reply.kind).toBe('staff-assistance')
  expect(answerContext.cart.itemCount).toBe(1)
  expect(await runtime.invoke('order_add_item', { itemId, quantity: 2 })).toHaveProperty('cart.itemCount', 3)
})

// Report: this chat Nov09 11:30 — 好的 was reclassified as identity prose after a staff offer.
it.each(['好的', '不用了'])('completes the quantity staff answer without model reinterpretation: %s', async (transcript) => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '蝦捲100份' })
  const rejection = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const before = await runtime.invoke('kiosk_interaction_state') as KioskDecisionState
  const window = createServiceClarificationWindow()
  window.present(orderAssistanceFromRejection(rejection, '蝦捲100份', before)!)
  const decide = vi.fn(async () => ({ kind: 'NEEDS_ASSISTANT' as const, reason: 'GENERAL_QUESTION' as const }))
  const result = await runFastPath({ transcript, isEnabled: async () => true, serviceClarification: state => window.current(state), decide, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) } })
  window.settle(result)
  expect(result.kind).toBe('SERVICE_REPLY')
  if (result.kind !== 'SERVICE_REPLY')
    throw new Error('Expected a direct staff reply')
  expect(result.reply.content.includes('已通知服務人員')).toBe(transcript === '好的')
  expect(result.reply.content).not.toContain('我是點餐助手')
  expect(decide).not.toHaveBeenCalled()
  expect(window.current(before)).toBeUndefined()
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  expect(await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll', quantity: 2 })).toHaveProperty('cart.itemCount', 2)
})

// Report: this chat Nov09 — semantic staff answers must not select the older cart-review action.
it.each(['accept', 'decline'] as const)('finishes a semantic staff %s against the current question', async (action) => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll', quantity: 1 })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const cue = { purpose: 'staff-assistance' as const, questionId: 'current-staff', question: '需要通知服務人員嗎？', sourceUtterance: '100份', contextKey: serviceContextKey(context), expiresAt: Date.now() + 30000 }
  const result = await runFastPath({ transcript: '麻煩幫我通知一下', isEnabled: async () => true, serviceClarification: () => cue, decide: async () => ({ kind: 'STAFF_ANSWER', questionId: cue.questionId, action }), webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) } })
  expect(result.kind).toBe('SERVICE_REPLY')
  if (result.kind !== 'SERVICE_REPLY')
    throw new Error('Expected staff-only receipt')
  expect(result.reply.action).toBe(action)
  expect(result.reply.content.includes('已通知服務人員')).toBe(action === 'accept')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 1)
})
