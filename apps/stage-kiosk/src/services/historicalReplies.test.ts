import { describe, expect, it } from 'vitest'

import { historyData } from '../../../order-menu/src/evaluation/historyData'
import { createMenuReplyWindow, replyFromConversation } from './questionPresentation'

// Source: docs/plans/2026-10-22-kiosk-multi-demand-evaluation.md, R03/R04.
// Reuse sanitized facts while keeping presentation tests in their owning app.
describe('historical reply grounding', () => {
  it('r03 presents the authoritative three servings instead of the recorded seven-serving prose', () => {
    const source = historyData.cases.find(value => value.id === 'R03')
    if (!source || source.status === 'missing-evidence')
      throw new Error('Missing R03 evidence')
    const receipt = source.events.find(event => event.sequence === 29)
    const claim = source.events.find(event => event.sequence === 318)
    if (!receipt || receipt.kind !== 'tool_result' || !receipt.cart || !claim || claim.kind !== 'assistant_text')
      throw new Error('Missing original quantity receipt/claim')
    const window = createMenuReplyWindow()
    window.record('cart_get', { cart: receipt.cart })
    const reply = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['cart_get'], answer: claim.text }, { menu: window, failureMessage: '尚未完成。' })
    expect(reply.content).toContain('3 份')
    expect(reply.content).not.toContain('7 份')
  })

  it('r04 rejects the original no-tool fulfillment success claim', () => {
    const source = historyData.cases.find(value => value.id === 'R04')
    if (!source || source.status === 'missing-evidence')
      throw new Error('Missing R04 evidence')
    const claim = source.events.find(event => event.sequence === 349)
    if (!claim || claim.kind !== 'assistant_text')
      throw new Error('Missing original fulfillment claim')
    const reply = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], answer: claim.text }, { menu: createMenuReplyWindow(), handoff: { intent: 'SET_FULFILLMENT' }, failureMessage: '尚未完成。' })
    expect(reply).toEqual({ role: 'error', content: '尚未完成。' })
  })
})
