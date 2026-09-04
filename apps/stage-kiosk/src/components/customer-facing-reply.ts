import type { ChatAssistantMessage, ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

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

  if (typeof message.content === 'string')
    return message.content.trim()

  return ''
}

/**
 * Identifies a model turn that ended without a customer-facing continuation.
 *
 * The kiosk must never expose model self-talk about restarting or reorganizing
 * its own system: customers need the next ordering question instead.
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

/** Returns a short, actionable fallback after a completed tool-only turn. */
export function customerReplyFallback() {
  return '目前操作已更新。請問要繼續進行，還是需要我協助下一步？'
}
