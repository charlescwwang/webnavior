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

  it('uses the service-provided customer message when a tool-only turn succeeds', () => {
    const messages: ChatHistoryItem[] = [
      { role: 'user', content: '請移除肉燥飯' },
      {
        role: 'assistant',
        content: '',
        slices: [],
        tool_results: [{ id: 'tool-1', result: '{"customerMessage":"已從購物車移除古早味肉燥飯。"}' }],
      },
    ]

    const recovery = findCustomerReplyRecovery(messages, 0)
    expect(recovery).toMatchObject({
      customerMessage: '已從購物車移除古早味肉燥飯。',
      kind: 'success',
      messageIndex: 1,
    })
    expect(customerReplyFallback('zh-Hant', recovery?.kind, recovery?.customerMessage)).toBe('已從購物車移除古早味肉燥飯。')
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
