import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import { describe, expect, it } from 'vitest'

import { customerReplyFallback, findCustomerReplyRecovery } from './customer-facing-reply'

describe('findCustomerReplyRecovery', () => {
  it('recovers a tool-only turn that has no customer-facing assistant text', () => {
    const messages: ChatHistoryItem[] = [
      { role: 'user', content: '幫我加蝦捲' },
      { role: 'tool', content: '{}', tool_call_id: 'tool-1' },
    ]

    expect(findCustomerReplyRecovery(messages, 0)).toEqual({ kind: 'append' })
  })

  it('replaces a leaked system-restart reply instead of leaving the customer at a dead end', () => {
    const messages: ChatHistoryItem[] = [
      { role: 'user', content: '幫我加蝦捲' },
      {
        role: 'assistant',
        content: '我會重新整理系統後繼續。',
        slices: [{ type: 'text', text: '我會重新整理系統後繼續。' }],
        tool_results: [],
      },
    ]

    expect(findCustomerReplyRecovery(messages, 0)).toEqual({ kind: 'replace', messageIndex: 1 })
  })

  it('preserves a normal customer-facing customization question', () => {
    const messages: ChatHistoryItem[] = [
      { role: 'user', content: '我要蝦捲' },
      {
        role: 'assistant',
        content: '這份蝦捲需要附甜漬嫩薑嗎？',
        slices: [{ type: 'text', text: '這份蝦捲需要附甜漬嫩薑嗎？' }],
        tool_results: [],
      },
    ]

    expect(findCustomerReplyRecovery(messages, 0)).toBeUndefined()
  })
})

describe('customerReplyFallback', () => {
  it('asks the customer for the next step without assuming a restaurant domain', () => {
    expect(customerReplyFallback()).toContain('繼續進行')
  })
})
