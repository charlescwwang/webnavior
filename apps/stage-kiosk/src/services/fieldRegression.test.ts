import { describe, expect, it } from 'vitest'

import { createMenuReplyWindow, replyFromConversation } from './questionPresentation'

// Report: docs/plans/2026-10-22-kiosk-field-investigation.md, seq137/349/371.
describe('field operation replies', () => {
  it.each(['已加入排骨便當。', '已設為內用。'])('rejects an unverified no-tool completion: %s', (answer) => {
    expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], answer }, { menu: createMenuReplyWindow(), failureMessage: '尚未完成。' })).toEqual({ role: 'error', content: '尚未完成。' })
  })

  it('does not let a cart read complete a fulfillment change', () => {
    const menu = createMenuReplyWindow()
    menu.record('cart_get', { cart: { lines: [], total: 0 } })
    expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['cart_get'], answer: '已設為內用。' }, { menu, handoff: { intent: 'SET_FULFILLMENT' }, failureMessage: '尚未完成。' })).toEqual({ role: 'error', content: '尚未完成。' })
  })
})
