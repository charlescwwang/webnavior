import type { ChatAssistantMessage, ChatHistoryItem } from '../types/chat'

export interface CustomerReplyRecovery {
  kind: 'append' | 'replace'
  messageIndex?: number
}

function assistantText(message: ChatAssistantMessage) {
  const sliceText = message.slices
    .filter(slice => slice.type === 'text')
    .map(slice => slice.text.trim())
    .filter(Boolean)
    .join('\n')

  if (sliceText)
    return sliceText

  return typeof message.content === 'string' ? message.content.trim() : ''
}

/**
 * Finds an Agent turn that completed tool work without giving the customer a
 * usable next step. This is domain-neutral so every Interaction Host can keep
 * a customer conversation moving even when a model ends immediately after tools.
 */
export function findCustomerReplyRecovery(messages: ChatHistoryItem[], turnStartIndex: number): CustomerReplyRecovery | undefined {
  for (let index = messages.length - 1; index >= turnStartIndex; index--) {
    const message = messages[index]
    if (message?.role !== 'assistant')
      continue

    const text = assistantText(message)
    if (!text || /(?:重新整理|重整|重置|重啟).{0,8}(?:系統|服務|設定)|(?:系統|服務|設定).{0,8}(?:重新整理|重整|重置|重啟)/u.test(text))
      return { kind: 'replace', messageIndex: index }

    return undefined
  }

  return { kind: 'append' }
}

/** A neutral customer-facing continuation for a completed tool-only turn. */
export function customerReplyFallback(locale = 'zh-Hant') {
  if (locale.startsWith('en'))
    return 'The requested step is complete. Would you like to continue, or is there another step I can help with?'

  return '目前操作已更新。請問要繼續進行，還是需要我協助下一步？'
}
