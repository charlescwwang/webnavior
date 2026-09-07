import type { ChatHistoryItem } from '../types/chat'

import { describe, expect, it } from 'vitest'

import { customerReplyFallback, findCustomerReplyRecovery } from './customer-facing-reply'

describe('findCustomerReplyRecovery', () => {
  it('recovers a successful tool-only turn with a customer-facing continuation', () => {
    const messages: ChatHistoryItem[] = [
      { role: 'user', content: '幫我完成這個步驟' },
      {
        role: 'assistant',
        content: '',
        slices: [],
        tool_results: [{ id: 'tool-1', result: '{"ok":true}' }],
      },
    ]

    expect(findCustomerReplyRecovery(messages, 0)).toEqual({ kind: 'success', messageIndex: 1 })
  })

  it('does not report a completed order as a generic continuation', () => {
    const messages: ChatHistoryItem[] = [
      { role: 'user', content: '幫我繼續' },
      {
        role: 'assistant',
        content: '',
        slices: [],
        tool_results: [{ id: 'order-1', result: '{"interaction":{"status":"completed"}}' }],
      },
    ]

    expect(findCustomerReplyRecovery(messages, 0)).toBeUndefined()
  })

  it('recovers a failed tool-only turn without claiming the operation succeeded', () => {
    const messages: ChatHistoryItem[] = [
      { role: 'user', content: '幫我完成這個步驟' },
      {
        role: 'assistant',
        content: '',
        slices: [],
        tool_results: [{ id: 'tool-1', isError: true, result: 'timeout' }],
      },
    ]

    expect(findCustomerReplyRecovery(messages, 0)).toEqual({ kind: 'failure', messageIndex: 1 })
  })

  it('does not append a success message when the model returns no assistant or tool result', () => {
    expect(findCustomerReplyRecovery([{ role: 'user', content: '嗨' }], 0)).toBeUndefined()
  })
})

describe('customerReplyFallback', () => {
  it('gives the customer a next action without assuming a domain', () => {
    expect(customerReplyFallback()).toContain('繼續進行')
    expect(customerReplyFallback('en')).toContain('continue')
    expect(customerReplyFallback('zh-Hant', 'failure')).toContain('無法完成')
  })
})
