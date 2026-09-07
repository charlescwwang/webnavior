import type { ChatHistoryItem } from '../types/chat'

import { describe, expect, it } from 'vitest'

import { customerReplyFallback, findCustomerReplyRecovery } from './customer-facing-reply'

describe('findCustomerReplyRecovery', () => {
  it('recovers a tool-only turn with a customer-facing continuation', () => {
    const messages: ChatHistoryItem[] = [
      { role: 'user', content: '幫我完成這個步驟' },
      { role: 'tool', content: '{}', tool_call_id: 'tool-1' },
    ]

    expect(findCustomerReplyRecovery(messages, 0)).toEqual({ kind: 'append' })
  })

  it('replaces a leaked system-restart reply', () => {
    const messages: ChatHistoryItem[] = [
      { role: 'user', content: '幫我繼續' },
      {
        role: 'assistant',
        content: '我會重新整理系統後繼續。',
        slices: [{ type: 'text', text: '我會重新整理系統後繼續。' }],
        tool_results: [],
      },
    ]

    expect(findCustomerReplyRecovery(messages, 0)).toEqual({ kind: 'replace', messageIndex: 1 })
  })
})

describe('customerReplyFallback', () => {
  it('gives the customer a next action without assuming a domain', () => {
    expect(customerReplyFallback()).toContain('繼續進行')
    expect(customerReplyFallback('en')).toContain('continue')
  })
})
