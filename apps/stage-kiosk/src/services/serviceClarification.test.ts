import type { KioskDecisionState } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'

import { conversationContextSchema, serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it, vi } from 'vitest'

import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { conversationDecisionStateFrom, refreshConversationState, runFastPath } from './kiosk-fast-path'
import { createServiceClarificationWindow, operationReplyFrom, orderAssistanceFromRejection, questionReceiptFrom } from './questionPresentation'

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
    expect(window.current(state)).toBeUndefined()
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
it('binds special-order confirmation to its live context and expires it on cart changes', () => {
  const context = parse(conversationContextSchema, { contextId: 'special', capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] })
  const cue = { purpose: 'order-assistance' as const, questionId: 'intent', question: '是要整份菜單各一份嗎？', sourceUtterance: '全部各一份', contextKey: serviceContextKey(context), expiresAt: Date.now() + 30000 }
  const state = { phase: 'ordering', serviceClarification: cue }
  expect(refreshConversationState(context, state).context?.orderAssistance?.questionId).toBe('intent')
  expect(refreshConversationState(context, state).context?.staffAssistance).toBeUndefined()
  expect(conversationDecisionStateFrom(state, { reason: 'NEW_REQUEST', requestScope: 'order-operation' })?.serviceClarification).toBeUndefined()
  expect(refreshConversationState({ ...context, revisions: { ...context.revisions, cart: 1 } }, state).context?.orderAssistance).toBeUndefined()
  expect(refreshConversationState(context, { ...state, serviceClarification: { ...cue, expiresAt: Date.now() - 1 } }).context?.orderAssistance).toBeUndefined()
})

// Report: this chat, Nov7 — business refusals are EXECUTION_FAILED, not successful Fast Path actions.
it('offers intent confirmation only for a proven no-effect quantity rejection', () => {
  const rejection = { ok: false, executed: false, rejection: 'quantity-limit', error: 'QUANTITY_LIMIT', toolName: 'order_add_item', maximum: 20, requestedQuantity: 100, customerMessage: '每款單次最多20份。' }
  const state = { phase: 'ordering', revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 } }
  const cue = orderAssistanceFromRejection(rejection, '水餃100份', state)!
  expect(cue.purpose).toBe('order-assistance')
  expect(cue.question).toContain('水餃100份')
  expect(cue.question).not.toContain('已經呼叫')
  expect(orderAssistanceFromRejection(rejection, '水餃100份', state, true)).toBeUndefined()
  expect(orderAssistanceFromRejection({ ...rejection, executed: true }, '水餃100份', state)).toBeUndefined()
  expect(orderAssistanceFromRejection(rejection, '水餃100份', undefined)).toBeUndefined()
  expect(orderAssistanceFromRejection({ error: 'TOOL_FAILED' }, '水餃100份', state)).toBeUndefined()
})
