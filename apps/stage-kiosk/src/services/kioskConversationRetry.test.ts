import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import type { ConversationRetry } from './kioskConversationRetry'

import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'

import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { createRetryContext, isKioskConversationRetrySafeTool, readConversationRetryContext, recoverConversationService, resetConversationService, resumeConversationRetry, retryMatches } from './kioskConversationRetry'

// Report: this chat, 2026-10-29; PB recovery/retry incorrectly required owned Menu tools.
it('recovers a browser service and reads its own fresh retry context without Menu tools', async () => {
  const tool = { name: 'browser_recovery_context', description: 'Host context', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const execute = vi.fn(async () => ({ source: 'browser', documentId: 'document', contextKey: 'fresh-menu-cart', canRetry: true }))
  const client = { tools: shallowRef([tool]), execute, recover: vi.fn(async () => {}) }
  await recoverConversationService(client, [])
  expect(client.recover).toHaveBeenCalledOnce()
  expect(await readConversationRetryContext(client)).toBe(JSON.stringify(['browser', 'document', 'fresh-menu-cart']))
  expect(execute).toHaveBeenCalledWith(tool, {})
})

it.each([false, undefined])('keeps browser recovery paused without verified settled state (%s)', async (canRetry) => {
  const tool = { name: 'browser_recovery_context', description: 'Host context', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const client = { tools: shallowRef([tool]), execute: vi.fn(async () => ({ source: 'browser', documentId: 'document', contextKey: 'fresh', canRetry })), recover: vi.fn(async () => {}) }
  await expect(recoverConversationService(client, [])).rejects.toThrow()
})

it('rejects a retry after the external document or its live data changed', async () => {
  const tool = { name: 'browser_recovery_context', description: 'Host context', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  let state = { source: 'browser', documentId: 'first', contextKey: 'menu-v1-cart-v1', canRetry: true }
  const client = { tools: shallowRef([tool]), execute: vi.fn(async () => state) }
  const contextKey = await readConversationRetryContext(client)
  const retry = { state: 'available' as const, text: '原句', sessionId: 'visitor', iframeRevision: 1, requestId: 1, contextKey }
  state = { ...state, contextKey: 'menu-v2-cart-v1' }
  expect(retryMatches(retry, { ...retry, contextKey: await readConversationRetryContext(client) })).toBe(false)
  state = { ...state, documentId: 'replacement', contextKey: 'menu-v1-cart-v1' }
  expect(retryMatches(retry, { ...retry, contextKey: await readConversationRetryContext(client) })).toBe(false)
})

it('retains owned Menu task ownership checks and releases only this host task', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  context.taskId = 'foreign'
  const tools = ['kiosk_conversation_context', 'kiosk_agent_task'].map(name => ({ name, description: name, inputSchema: { type: 'object' }, origin: 'https://menu.example' }))
  const execute = vi.fn(async (tool: ServiceTool) => tool.name === 'kiosk_conversation_context' ? context : { ok: true })
  const client = { tools: shallowRef(tools), execute, recover: vi.fn(async () => {}) }
  await expect(recoverConversationService(client, ['owned'])).rejects.toThrow('another owner')
  expect(execute).toHaveBeenCalledTimes(1)
  context.taskId = 'owned'
  await recoverConversationService(client, ['owned'])
  expect(execute).toHaveBeenLastCalledWith(tools[1], { action: 'END', taskId: 'owned' })
})

describe('kiosk conversation retry safety', () => {
  it('only allows a replay after read-only menu and cart tools', () => {
    expect(isKioskConversationRetrySafeTool('menu_recommend')).toBe(false)
    expect(isKioskConversationRetrySafeTool('cart_get')).toBe(true)
    expect(isKioskConversationRetrySafeTool('kiosk_session_history')).toBe(true)
    expect(isKioskConversationRetrySafeTool('browser_observe')).toBe(true)
    expect(isKioskConversationRetrySafeTool('browser_search')).toBe(true)
    expect(isKioskConversationRetrySafeTool('browser_quote')).toBe(true)
    expect(isKioskConversationRetrySafeTool('browser_clarify_product')).toBe(true)
    expect(isKioskConversationRetrySafeTool('browser_set_note')).toBe(false)
    expect(isKioskConversationRetrySafeTool('order_add_item')).toBe(false)
    expect(isKioskConversationRetrySafeTool('cart_set_line_quantity')).toBe(false)
    expect(isKioskConversationRetrySafeTool('checkout_select_payment')).toBe(false)
  })
})

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct28 retry -> old fruit query.
it('does not transparently replay recommendation state or a displayed menu', () => {
  expect(isKioskConversationRetrySafeTool('menu_recommend')).toBe(false)
  expect(isKioskConversationRetrySafeTool('menu_show_recommendations')).toBe(false)
  expect(isKioskConversationRetrySafeTool('menu_get')).toBe(false)
  expect(isKioskConversationRetrySafeTool('menu_get', { display: false })).toBe(true)
})

it('invalidates retry after changing session, iframe, cart, checkout or question', () => {
  const retry = { state: 'available' as const, text: '請再幫我確認', sessionId: 'visitor', iframeRevision: 1, requestId: 1, contextKey: 'current' }
  expect(retryMatches(retry, retry)).toBe(true)
  expect(retryMatches(retry, { ...retry, sessionId: 'different' })).toBe(false)
  expect(retryMatches(retry, { ...retry, iframeRevision: 2 })).toBe(false)
  expect(retryMatches(retry, { ...retry, contextKey: 'changed-revisions-or-question' })).toBe(false)
})

it('sends the original text through normal admission once, with explicit retry lineage', async () => {
  const retry: ConversationRetry = { state: 'available', text: '沒聽清楚的原句', sessionId: 'visitor', iframeRevision: 1, requestId: 3, originalUtteranceId: 2, contextKey: 'current' }
  const enqueue = vi.fn(() => ({ kind: 'ACCEPTED' as const, id: 4 }))
  const record = vi.fn(async () => {})
  const io = { current: async () => retry, enqueue, record }
  expect(await resumeConversationRetry(retry, io)).toEqual({ kind: 'ACCEPTED', id: 4 })
  expect(enqueue).toHaveBeenCalledWith('沒聽清楚的原句')
  expect(record).toHaveBeenCalledWith({ kind: 'conversation_retry', originalRequestId: 3, originalUtteranceId: 2, utteranceId: 4, status: 'ACCEPTED' })
  expect(await resumeConversationRetry(retry, io)).toEqual({ kind: 'BUSY' })
  expect(enqueue).toHaveBeenCalledTimes(1)
})

it('never enqueues a retry whose fresh ownership or context has changed', async () => {
  const retry: ConversationRetry = { state: 'available', text: '原句', sessionId: 'old', iframeRevision: 1, requestId: 3, contextKey: 'old' }
  const enqueue = vi.fn(() => ({ kind: 'ACCEPTED' as const, id: 4 }))
  expect(await resumeConversationRetry(retry, { current: async () => ({ sessionId: 'new', iframeRevision: 1, contextKey: 'new' }), enqueue, record: async () => {} })).toEqual({ kind: 'STALE' })
  expect(enqueue).not.toHaveBeenCalled()
})

it('consumes a retry before the fresh snapshot returns so concurrent clicks cannot enqueue twice', async () => {
  const retry: ConversationRetry = { state: 'available', text: '原句', sessionId: 'visitor', iframeRevision: 1, requestId: 3, contextKey: 'current' }
  let resolveCurrent!: (current: ConversationRetry) => void
  const current = new Promise<ConversationRetry>(resolve => resolveCurrent = resolve)
  const enqueue = vi.fn(() => ({ kind: 'ACCEPTED' as const, id: 4 }))
  const io = { current: () => current, enqueue, record: async () => {} }
  const first = resumeConversationRetry(retry, io)
  expect(await resumeConversationRetry(retry, io)).toEqual({ kind: 'BUSY' })
  expect(enqueue).not.toHaveBeenCalled()
  resolveCurrent(retry)
  expect(await first).toEqual({ kind: 'ACCEPTED', id: 4 })
  expect(enqueue).toHaveBeenCalledTimes(1)
})

// Report: this chat, 2026-10-30; customer reset replaced PB's active order document.
describe('browser customer reset', () => {
  function setup() {
    const tools = ['browser_recovery_context', 'browser_customer_reset'].map(name => ({ name, description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }))
    return { tools: shallowRef(tools), execute: vi.fn(async () => ({ ok: true, status: 'customer-reset', cartPreserved: true, documentId: 'doc' })), refresh: vi.fn(), waitUntilReady: vi.fn(async () => {}), getDocumentId: vi.fn(() => 'doc') }
  }
  it('renews only a verified preserved document and never calls a vendor clear', async () => {
    const client = setup()
    expect(await resetConversationService(client)).toBe('preserved')
    expect(client.execute).toHaveBeenCalledExactlyOnceWith(client.tools.value[1], {})
    expect(client.refresh).toHaveBeenCalledTimes(1)
    expect(client.waitUntilReady).toHaveBeenCalledTimes(1)
  })
  it('ends an advertised visual owner before admitting the new reset revision', async () => {
    const client = setup()
    const visual = { ...client.tools.value[0], name: 'browser_present' }
    client.tools.value.push(visual)
    await resetConversationService(client)
    expect(client.execute).toHaveBeenNthCalledWith(1, visual, { productRefs: [] })
    expect(client.execute).toHaveBeenNthCalledWith(2, client.tools.value[1], {})
  })
  it('keeps reset blocked on an unknown effect or document mismatch', async () => {
    const client = setup()
    client.execute.mockResolvedValueOnce({ ok: false, status: 'unknown', cartPreserved: false, documentId: 'doc' })
    await expect(resetConversationService(client)).rejects.toThrow()
    expect(client.refresh).not.toHaveBeenCalled()
    client.execute.mockResolvedValueOnce({ ok: true, status: 'customer-reset', cartPreserved: true, documentId: 'different' })
    await expect(resetConversationService(client)).rejects.toThrow('document changed')
    expect(client.refresh).not.toHaveBeenCalled()
  })
  it('retains the owned Menu reload policy while refusing an unsupported browser reset', async () => {
    const client = setup()
    client.tools.value = []
    expect(await resetConversationService(client)).toBe('reload')
    client.tools.value = [{ name: 'browser_recovery_context', description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }]
    await expect(resetConversationService(client)).rejects.toThrow('does not support')
    expect(client.execute).not.toHaveBeenCalled()
  })
})

// Report: this chat, Oct31 v2 actual Electron inquiry; valid execution evidence
// was rejected by the strict recovery schema before Main could read the menu.
it('admits native operation timing on a fresh browser recovery receipt', async () => {
  const tool = { name: 'browser_recovery_context', description: 'Host context', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const execute = vi.fn(async () => ({ source: 'browser', documentId: 'document', contextKey: 'fresh-menu-cart', canRetry: true, execution: { documentId: 'document', operationId: 'recovery', durationMs: 25, steps: [] } }))
  expect(await readConversationRetryContext({ tools: shallowRef([tool]), execute })).toBe(JSON.stringify(['browser', 'document', 'fresh-menu-cart']))
})

// Report: this chat, Nov1: Main kept reading full recovery state after writes,
// even though the task could no longer offer a safe conversation retry.
it('stops retry-context IO after an effect and cannot revive it from a late read', async () => {
  const tool = { name: 'browser_recovery_context', description: 'Host context', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  let settle = (_value: object) => {}
  const execute = vi.fn(() => new Promise<object>(resolve => settle = resolve))
  const context = createRetryContext({ tools: shallowRef([tool]), execute })
  const first = context.capture()
  context.invalidate()
  settle({ source: 'browser', documentId: 'document', contextKey: 'fresh', canRetry: true })
  expect(await first).toBeUndefined()
  expect(await context.capture()).toBeUndefined()
  expect(execute).toHaveBeenCalledOnce()
})

it('anchors retry to the original demand and rejects later changed state', async () => {
  const tool = { name: 'browser_recovery_context', description: 'Host context', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const execute = vi.fn(async () => ({ source: 'browser', documentId: 'document', contextKey: 'first', canRetry: true }))
  const context = createRetryContext({ tools: shallowRef([tool]), execute })
  const key = await context.capture()
  expect(key).toContain('first')
  execute.mockResolvedValue({ source: 'browser', documentId: 'document', contextKey: 'changed', canRetry: true })
  expect(await context.capture()).toBe(key)
  expect(execute).toHaveBeenCalledOnce()
  const current = await readConversationRetryContext({ tools: shallowRef([tool]), execute })
  expect(current).toContain('changed')
  const request = { state: 'available' as const, text: '原句', sessionId: 'visitor', iframeRevision: 1, requestId: 1, contextKey: key! }
  expect(retryMatches(request, { ...request, contextKey: current })).toBe(false)
})

// Report: this chat, Nov4 S13-9; an 8-second PB recovery read failure
// rejected the new Main task before its first model round or cart review.
it('disables retry without rejecting a new demand when its anchor read fails', async () => {
  const tool = { name: 'browser_recovery_context', description: 'Host context', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const execute = vi.fn(async () => {
    throw new Error('PB read timed out')
  })
  const context = createRetryContext({ tools: shallowRef([tool]), execute })
  await expect(context.capture()).resolves.toBeUndefined()
  await expect(context.capture()).resolves.toBeUndefined()
  expect(execute).toHaveBeenCalledOnce()
  await expect(readConversationRetryContext({ tools: shallowRef([tool]), execute })).rejects.toThrow('PB read timed out')
})

it('never grants retry authority from an unsettled browser receipt', async () => {
  const tool = { name: 'browser_recovery_context', description: 'Host context', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const execute = vi.fn(async () => ({ source: 'browser', documentId: 'document', contextKey: 'fresh', canRetry: false }))
  const context = createRetryContext({ tools: shallowRef([tool]), execute })
  await expect(context.capture()).resolves.toBeUndefined()
  await expect(readConversationRetryContext({ tools: shallowRef([tool]), execute })).rejects.toThrow('not settled')
})
