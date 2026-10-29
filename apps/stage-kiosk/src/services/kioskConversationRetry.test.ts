import type { ConversationRetry } from './kioskConversationRetry'

import { describe, expect, it, vi } from 'vitest'

import { isKioskConversationRetrySafeTool, resumeConversationRetry, retryMatches } from './kioskConversationRetry'

describe('kiosk conversation retry safety', () => {
  it('only allows a replay after read-only menu and cart tools', () => {
    expect(isKioskConversationRetrySafeTool('menu_recommend')).toBe(false)
    expect(isKioskConversationRetrySafeTool('cart_get')).toBe(true)
    expect(isKioskConversationRetrySafeTool('kiosk_session_history')).toBe(true)
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
