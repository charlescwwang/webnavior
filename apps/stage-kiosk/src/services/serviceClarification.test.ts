import type { KioskDecisionState } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'

import { serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { expect, it, vi } from 'vitest'

import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { conversationDecisionStateFrom, runFastPath } from './kiosk-fast-path'
import { createServiceClarificationWindow } from './questionPresentation'

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
  await runtime.invoke('kiosk_fast_path_context', { transcript: '我要周氏蝦捲' })
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
