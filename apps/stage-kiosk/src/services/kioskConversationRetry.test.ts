import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import type { ConversationRetry } from './kioskConversationRetry'

import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'

import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { createRetryContext, isKioskConversationRetrySafeTool, readConversationRetryContext, recoverConversationService, resetConversationService, resumeConversationRetry, retryMatches } from './kioskConversationRetry'

// Report: this chat, Nov19 02:19–02:23 — reset preflight tried dismissing PB's announcement under its own cover.
it('resets a menu using read-only preflight even when an admission read would try a hidden announcement click', async () => {
  const tools = ['browser_state_get', 'browser_cart_get', 'browser_recovery_context', 'browser_customer_reset'].map(name => ({ name, description: name, inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }))
  const execute = vi.fn(async (tool: ServiceTool, input: Record<string, unknown>) => {
    if (tool.name === 'browser_recovery_context')
      return { source: 'browser', documentId: 'menu', contextKey: 'old-cart', canRetry: false, canReset: true, blockedBy: 'order' }
    if (tool.name === 'browser_customer_reset')
      return { ok: true, source: 'browser', status: 'customer-reset', cartCleared: true, documentId: 'menu' }
    if (input.forAdmission)
      return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '公告按鈕被遮住。' }
    return { ok: true, source: 'browser', page: 'menu', cart: { lines: [{}] } }
  })
  const client = { tools: shallowRef(tools), execute, refresh: vi.fn(), waitUntilReady: vi.fn(async () => {}), getDocumentId: () => 'menu' }
  await expect(resetConversationService(client)).resolves.toBe('preserved')
  expect(execute.mock.calls.some(([, input]) => input.forAdmission)).toBe(false)
  expect(execute).toHaveBeenCalledWith(tools[3], {})
})

// Report: this chat, Nov19 01:21 — healthy PB reads remained blocked by an
// earlier submission marker, while the customer saw a connection outage.
it('distinguishes an unconfirmed order from a disconnected menu without clearing or replaying it', async () => {
  const tool = { name: 'browser_recovery_context', description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const client = { tools: shallowRef([tool]), recover: vi.fn(async () => {}), execute: vi.fn(async () => ({ source: 'browser', documentId: 'live', contextKey: 'pending', canRetry: false, canReset: false, blockedBy: 'order' })) }
  await expect(recoverConversationService(client, [])).rejects.toThrow('訂單紀錄')
  expect(client.execute).toHaveBeenCalledExactlyOnceWith(tool, {})
})

// Report: this chat, Nov19 — the native table peer explicitly requires entry
// before cart inspection; Restart previously parsed its absent cart and failed.
it('enters the selected table once when Restart must reach the menu before inspecting the cart', async () => {
  const tools = ['browser_cart_get', 'browser_recovery_context', 'browser_start_ordering', 'browser_customer_reset'].map(name => ({ name, description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }))
  let started = false
  const execute = vi.fn(async (tool: ServiceTool) => {
    if (tool.name === 'browser_cart_get')
      return started ? { ok: true, page: 'menu', cart: { lines: [], tableName: 'A3-1 桌' } } : { ok: true, page: 'table', selectedTable: 'A3-1 桌', cartAdmission: 'after-table-entry' }
    if (tool.name === 'browser_recovery_context')
      return { source: 'browser', documentId: 'current', contextKey: 'entry', canRetry: false, canReset: true, blockedBy: 'order' }
    if (tool.name === 'browser_start_ordering') {
      started = true
      return { ok: true, source: 'browser', code: 'table-entry-starting', effect: 'none', selectedTable: 'A3-1 桌', customerMessage: '正在準備菜單。' }
    }
    return { ok: true, status: 'customer-reset', cartCleared: true, documentId: 'current' }
  })
  const client = { tools: shallowRef(tools), execute, refresh: vi.fn(), waitUntilReady: vi.fn(async () => {}), getDocumentId: () => 'current' }
  expect(await resetConversationService(client)).toBe('preserved')
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_start_ordering')).toHaveLength(1)
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_customer_reset')).toHaveLength(1)
  expect(execute).toHaveBeenCalledWith(tools[2], { name: 'A3-1 桌', forReset: true })
})

// Report: this chat, 2026-10-29; PB recovery/retry incorrectly required owned Menu tools.
it('recovers a browser service and reads its own fresh retry context without Menu tools', async () => {
  const tool = { name: 'browser_recovery_context', description: 'Host context', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const execute = vi.fn(async () => ({ source: 'browser', documentId: 'document', contextKey: 'fresh-menu-cart', canRetry: true, canReset: true }))
  const client = { tools: shallowRef([tool]), execute, recover: vi.fn(async () => {}) }
  await recoverConversationService(client, [])
  expect(client.recover).toHaveBeenCalledOnce()
  expect(await readConversationRetryContext(client)).toBe(JSON.stringify(['browser', 'document', 'fresh-menu-cart']))
  expect(execute).toHaveBeenCalledWith(tool, {})
})

it.each([false, undefined])('keeps browser recovery paused without verified settled state (%s)', async (canRetry) => {
  const tool = { name: 'browser_recovery_context', description: 'Host context', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const client = { tools: shallowRef([tool]), execute: vi.fn(async () => ({ source: 'browser', documentId: 'document', contextKey: 'fresh', canRetry, canReset: false })), recover: vi.fn(async () => {}) }
  await expect(recoverConversationService(client, [])).rejects.toThrow()
})

it('rejects a retry after the external document or its live data changed', async () => {
  const tool = { name: 'browser_recovery_context', description: 'Host context', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  let state = { source: 'browser', documentId: 'first', contextKey: 'menu-v1-cart-v1', canRetry: true, canReset: true }
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
    return { tools: shallowRef(tools), execute: vi.fn(async (): Promise<unknown> => ({ ok: true, status: 'customer-reset', cartCleared: true, documentId: 'doc' })), refresh: vi.fn(), waitUntilReady: vi.fn(async () => {}), getDocumentId: vi.fn(() => 'doc') }
  }
  it('renews the retained document only after a verified empty-cart reset', async () => {
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
    client.execute.mockResolvedValueOnce({ ok: false, status: 'unknown', cartCleared: false, documentId: 'doc' })
    await expect(resetConversationService(client)).rejects.toThrow()
    expect(client.refresh).not.toHaveBeenCalled()
    client.execute.mockResolvedValueOnce({ ok: true, status: 'customer-reset', cartCleared: true, documentId: 'different' })
    await expect(resetConversationService(client)).rejects.toThrow('document changed')
    expect(client.refresh).not.toHaveBeenCalled()
  })
  it('keeps the customer active with the native clear failure message', async () => {
    const client = setup()
    client.execute.mockResolvedValueOnce({ ok: false, status: 'unknown', customerMessage: '清空結果尚未確認，已暫停開始下一位接待。' })
    await expect(resetConversationService(client)).rejects.toThrow('清空結果尚未確認，已暫停開始下一位接待。')
    expect(client.refresh).not.toHaveBeenCalled()
    expect(client.waitUntilReady).not.toHaveBeenCalled()
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

// Report: this chat, Nov15; a leftover cart must be handled before Start, and reset on the table page must work.
it.each([false, true])('resets from table entry with an actually %s occupied cart', async (occupied) => {
  const tools = ['browser_recovery_context', 'browser_cart_get', 'browser_start_ordering', 'browser_customer_reset'].map(name => ({ name, description: name, inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }))
  let documentId = 'table-document'
  const execute = vi.fn(async (tool: ServiceTool) => {
    if (tool.name === 'browser_recovery_context')
      return { source: 'browser', documentId, contextKey: 'fresh', canRetry: true, canReset: true }
    if (tool.name === 'browser_cart_get')
      return { ok: true, page: documentId === 'table-document' ? 'table' : 'menu', selectedTable: 'B3 吧檯', cart: { tableName: 'B3 吧檯', version: 'fresh', lines: occupied ? [{}] : [] } }
    if (tool.name === 'browser_start_ordering') {
      documentId = 'menu-document'
      return { ok: true, source: 'browser', code: 'table-entry-starting', effect: 'none', selectedTable: 'B3 吧檯', customerMessage: '正在準備菜單。' }
    }
    return { ok: true, status: 'customer-reset', cartCleared: true, documentId }
  })
  const client = { tools: shallowRef(tools), execute, refresh: vi.fn(), waitUntilReady: vi.fn(async () => {}), getDocumentId: () => documentId }
  expect(await resetConversationService(client)).toBe(occupied ? 'preserved' : 'reload')
  expect(execute).toHaveBeenCalledWith(tools[1], { includeCatalog: false, forAdmission: true })
  if (occupied) {
    expect(execute).toHaveBeenCalledWith(tools[2], { name: 'B3 吧檯', forReset: true })
    expect(execute).toHaveBeenCalledWith(tools[3], {})
    expect(client.refresh).toHaveBeenCalledOnce()
  }
  else {
    expect(execute).not.toHaveBeenCalledWith(tools[2], expect.anything())
    expect(execute).not.toHaveBeenCalledWith(tools[3], expect.anything())
    expect(client.refresh).not.toHaveBeenCalled()
  }
})

// Report: this chat, Nov15; the original merchant Start was blocked by its SSR mask.
it('retains a rejected Start reason and never proceeds to clear the cart', async () => {
  const tools = ['browser_recovery_context', 'browser_cart_get', 'browser_start_ordering', 'browser_customer_reset'].map(name => ({ name, description: name, inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }))
  const execute = vi.fn(async (tool: ServiceTool) => {
    if (tool.name === 'browser_recovery_context')
      return { source: 'browser', documentId: 'table', contextKey: 'fresh', canRetry: true, canReset: true }
    if (tool.name === 'browser_cart_get')
      return { ok: true, page: 'table', selectedTable: 'A3 桌', cart: { lines: [{}] } }
    return { ok: false, error: '「開始點餐」被其他畫面遮住，請確認後再試。' }
  })
  const client = { tools: shallowRef(tools), execute, refresh: vi.fn(), waitUntilReady: vi.fn(async () => {}), getDocumentId: () => 'table' }
  await expect(resetConversationService(client)).rejects.toThrow('「開始點餐」被其他畫面遮住')
  expect(execute).not.toHaveBeenCalledWith(tools[3], expect.anything())
})

// Report: this chat, Nov15; early preparation must preserve unknown merchant-effect barriers.
it.each(['table', 'cart'])('explains an uncertain submission on %s instead of offering an ineffective reset', async (page) => {
  const tools = ['browser_recovery_context', 'browser_cart_get', 'browser_customer_reset'].map(name => ({ name, description: name, inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }))
  const execute = vi.fn(async (tool: ServiceTool) => tool.name === 'browser_cart_get'
    ? { ok: true, page, selectedTable: 'A1 桌', cart: { lines: [{}] } }
    : { source: 'browser', documentId: 'current', contextKey: 'pending-order', canRetry: false, canReset: false, blockedBy: 'order' })
  const client = { tools: shallowRef(tools), execute, refresh: vi.fn(), waitUntilReady: vi.fn(), getDocumentId: () => 'current' }
  await expect(resetConversationService(client)).rejects.toThrow('核對 PB 訂單紀錄')
  expect(execute).not.toHaveBeenCalledWith(tools[2], expect.anything())
})

it.each([false, true])('clears a retired document cart marker only through explicit reset (occupied=%s)', async (occupied) => {
  // A stored cart marker prohibits replaying the old purchase, but must not
  // prohibit the customer's separate request to discard that unfinished cart.
  const tools = ['browser_recovery_context', 'browser_cart_get', 'browser_start_ordering', 'browser_customer_reset'].map(name => ({ name, description: name, inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }))
  let started = false
  const execute = vi.fn(async (tool: ServiceTool) => {
    if (tool.name === 'browser_recovery_context')
      return { source: 'browser', documentId: 'current-document', contextKey: 'retired-cart', canRetry: false, canReset: true }
    if (tool.name === 'browser_cart_get')
      return { ok: true, page: started ? 'menu' : 'table', selectedTable: 'B3 吧檯', cart: { tableName: 'B3 吧檯', lines: occupied ? [{}] : [] } }
    if (tool.name === 'browser_start_ordering') {
      started = true
      return { ok: true, source: 'browser', code: 'table-entry-starting', effect: 'none', selectedTable: 'B3 吧檯', customerMessage: '正在準備菜單。' }
    }
    return { ok: true, status: 'customer-reset', cartCleared: true, documentId: 'current-document' }
  })
  const client = { tools: shallowRef(tools), execute, refresh: vi.fn(), waitUntilReady: vi.fn(async () => {}), getDocumentId: () => 'current-document' }
  expect(await resetConversationService(client)).toBe('preserved')
  expect(execute).toHaveBeenCalledWith(tools[3], {})
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_customer_reset')).toHaveLength(1)
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_start_ordering')).toHaveLength(occupied ? 1 : 0)
  expect(client.refresh).toHaveBeenCalledOnce()
})

// Report: this chat, Nov15; both Restart buttons exposed an internal English guard error.
it('does not enter the menu or dismiss a table reset while a previous operation is unresolved', async () => {
  const tools = ['browser_recovery_context', 'browser_cart_get', 'browser_start_ordering', 'browser_customer_reset'].map(name => ({ name, description: name, inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }))
  const execute = vi.fn(async (tool: ServiceTool) => tool.name === 'browser_cart_get'
    ? { ok: true, page: 'table', selectedTable: 'B3 吧檯', cart: { lines: [] } }
    : { source: 'browser', documentId: 'table', contextKey: 'unsettled', canRetry: false, canReset: false })
  const client = { tools: shallowRef(tools), execute, refresh: vi.fn(), waitUntilReady: vi.fn(async () => {}), getDocumentId: () => 'table' }
  await expect(resetConversationService(client)).rejects.toThrow('上一筆餐點操作的結果仍在確認')
  expect(execute).not.toHaveBeenCalledWith(tools[2], expect.anything())
  expect(execute).not.toHaveBeenCalledWith(tools[3], expect.anything())
  expect(client.refresh).not.toHaveBeenCalled()
})

// Report: this chat, Nov15; PB can acknowledge Start before its asynchronous SPA navigation commits.
it('waits for the actual menu after a table Start acknowledgement before clearing the cart', async () => {
  const tools = ['browser_recovery_context', 'browser_cart_get', 'browser_start_ordering', 'browser_customer_reset'].map(name => ({ name, description: name, inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }))
  let started = false
  let pendingMenuReads = 0
  const execute = vi.fn(async (tool: ServiceTool) => {
    if (tool.name === 'browser_cart_get') {
      const waiting = !started || pendingMenuReads++ === 0
      return { ok: true, page: waiting ? 'table' : 'menu', selectedTable: 'B3 吧檯', cart: { tableName: 'B3 吧檯', lines: [{}] } }
    }
    if (tool.name === 'browser_recovery_context')
      return { source: 'browser', documentId: 'spa-document', contextKey: 'fresh', canRetry: true, canReset: true }
    if (tool.name === 'browser_start_ordering') {
      started = true
      return { ok: true, source: 'browser', code: 'table-entry-starting', effect: 'none', selectedTable: 'B3 吧檯', customerMessage: '正在準備菜單。' }
    }
    return { ok: true, status: 'customer-reset', cartCleared: true, documentId: 'spa-document' }
  })
  const client = { tools: shallowRef(tools), execute, refresh: vi.fn(), waitUntilReady: vi.fn(async () => {}), getDocumentId: () => 'spa-document' }
  expect(await resetConversationService(client)).toBe('preserved')
  expect(pendingMenuReads).toBe(2)
  expect(execute).toHaveBeenLastCalledWith(tools[3], {})
})

// Report: this chat, Oct31 v2 actual Electron inquiry; valid execution evidence
// was rejected by the strict recovery schema before Main could read the menu.
it('admits native operation timing on a fresh browser recovery receipt', async () => {
  const tool = { name: 'browser_recovery_context', description: 'Host context', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const execute = vi.fn(async () => ({ source: 'browser', documentId: 'document', contextKey: 'fresh-menu-cart', canRetry: true, canReset: true, execution: { documentId: 'document', operationId: 'recovery', durationMs: 25, steps: [] } }))
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
  settle({ source: 'browser', documentId: 'document', contextKey: 'fresh', canRetry: true, canReset: true })
  expect(await first).toBeUndefined()
  expect(await context.capture()).toBeUndefined()
  expect(execute).toHaveBeenCalledOnce()
})

it('anchors retry to the original demand and rejects later changed state', async () => {
  const tool = { name: 'browser_recovery_context', description: 'Host context', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const execute = vi.fn(async () => ({ source: 'browser', documentId: 'document', contextKey: 'first', canRetry: true, canReset: true }))
  const context = createRetryContext({ tools: shallowRef([tool]), execute })
  const key = await context.capture()
  expect(key).toContain('first')
  execute.mockResolvedValue({ source: 'browser', documentId: 'document', contextKey: 'changed', canRetry: true, canReset: true })
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
  const execute = vi.fn(async () => ({ source: 'browser', documentId: 'document', contextKey: 'fresh', canRetry: false, canReset: false }))
  const context = createRetryContext({ tools: shallowRef([tool]), execute })
  await expect(context.capture()).resolves.toBeUndefined()
  await expect(readConversationRetryContext({ tools: shallowRef([tool]), execute })).rejects.toThrow('先前操作仍在確認')
})

// Report: this chat, Nov17 cases 7/11 — result-only tools bypassed verified reception reset.
it.each(['paid', 'cancelled'] as const)('permits entry reload after a fresh %s result without invoking editor tools', async (paymentStatus) => {
  const tool = { name: 'browser_state_get', description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const execute = vi.fn(async () => ({ ok: true, source: 'browser', page: 'order-result', documentId: 'result-document', restart: 'allowed', order: { reference: 'order-1', status: paymentStatus === 'paid' ? 50 : 79, total: 50, paymentStatus, paymentMethods: [], invoice: {} } }))
  const client = { tools: shallowRef([tool]), execute, refresh: vi.fn(), waitUntilReady: vi.fn(), getDocumentId: () => 'result-document' }
  expect(await resetConversationService(client)).toBe('reload')
  expect(execute).toHaveBeenCalledExactlyOnceWith(tool, { includeCatalog: false })
  expect(client.refresh).not.toHaveBeenCalled()
})

// Report: this chat, Nov17 cases 7/11 — Restart must not reload away an unresolved payment.
it.each(['payment-pending', 'payment-unknown', 'operation-pending'] as const)('keeps the same customer on a result page when restart is %s', async (restart) => {
  const tool = { name: 'browser_state_get', description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const execute = vi.fn(async () => ({ ok: true, source: 'browser', page: 'payment', documentId: 'result-document', restart, order: { reference: 'order-1', status: 20, total: 50, paymentStatus: 'pending', paymentMethods: [], invoice: {} } }))
  const client = { tools: shallowRef([tool]), execute, refresh: vi.fn(), waitUntilReady: vi.fn(), getDocumentId: () => 'result-document' }
  await expect(resetConversationService(client)).rejects.toThrow(restart === 'payment-pending' ? /尚未付款/ : /確認/)
  expect(client.refresh).not.toHaveBeenCalled()
})

// Report: this chat, Nov17 case 17 — stale or unavailable result reads cannot authorize entry reload.
it.each(['read-failed', 'stale-document', 'missing-restart-policy', 'unpaid-with-allowed-policy'] as const)('rejects %s instead of falling back to an unchecked reload', async (failure) => {
  const tool = { name: 'browser_state_get', description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const execute = vi.fn(async () => {
    if (failure === 'read-failed')
      throw new Error('Transport failed')
    return { ok: true, source: 'browser', page: 'order-result', documentId: failure === 'stale-document' ? 'previous-document' : 'document', restart: failure === 'missing-restart-policy' ? undefined : 'allowed', order: { reference: 'order-1', status: 50, total: 50, paymentStatus: failure === 'unpaid-with-allowed-policy' ? 'pending' : 'paid', paymentMethods: [], invoice: {} } }
  })
  const client = { tools: shallowRef([tool]), execute, refresh: vi.fn(), waitUntilReady: vi.fn(), getDocumentId: () => 'document' }
  await expect(resetConversationService(client)).rejects.toThrow(/訂單/)
  expect(client.refresh).not.toHaveBeenCalled()
})
