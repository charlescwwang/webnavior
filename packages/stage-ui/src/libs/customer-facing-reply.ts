import type { ChatAssistantMessage, ChatHistoryItem } from '../types/chat'

export interface CustomerReplyRecovery {
  /** Optional customer-safe result text supplied by the service that performed the operation. */
  customerMessage?: string
  kind: 'success' | 'failure'
  messageIndex: number
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

function isCompletedInteractionResult(result: unknown) {
  if (typeof result !== 'string')
    return false

  try {
    const parsed = JSON.parse(result) as unknown
    if (!parsed || typeof parsed !== 'object')
      return false

    const interaction = (parsed as Record<string, unknown>).interaction
    return !!interaction
      && typeof interaction === 'object'
      && (interaction as Record<string, unknown>).status === 'completed'
  }
  catch {
    return false
  }
}

function customerMessageFromToolResults(message: ChatAssistantMessage) {
  for (let index = message.tool_results.length - 1; index >= 0; index--) {
    const tool = message.tool_results[index]
    if (!tool)
      continue
    if (tool.isError || typeof tool.result !== 'string')
      continue

    try {
      const parsed = JSON.parse(tool.result) as unknown
      if (!parsed || typeof parsed !== 'object')
        continue
      const customerMessage = (parsed as Record<string, unknown>).customerMessage
      if (typeof customerMessage === 'string' && customerMessage.trim())
        return customerMessage.trim()
    }
    catch {
      continue
    }
  }
}

function recoveryForToolResults(message: ChatAssistantMessage, messageIndex: number): CustomerReplyRecovery | undefined {
  if (message.tool_results.some(tool => isCompletedInteractionResult(tool.result)))
    return undefined
  if (!message.tool_results.length)
    return undefined

  const kind = message.tool_results.some(tool => tool.isError) ? 'failure' : 'success'
  return {
    customerMessage: kind === 'success' ? customerMessageFromToolResults(message) : undefined,
    kind,
    messageIndex,
  }
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
    if (!text)
      return recoveryForToolResults(message, index)

    if (/(?:重新整理|重整|重置|重啟).{0,8}(?:系統|服務|設定)|(?:系統|服務|設定).{0,8}(?:重新整理|重整|重置|重啟)/u.test(text))
      return { kind: 'failure', messageIndex: index }

    return undefined
  }

  return undefined
}

/** A neutral customer-facing continuation derived from the final tool outcome. */
export function customerReplyFallback(
  locale = 'zh-Hant',
  outcome: CustomerReplyRecovery['kind'] = 'success',
  customerMessage?: string,
) {
  if (outcome === 'success' && customerMessage)
    return customerMessage

  if (outcome === 'failure') {
    if (locale.startsWith('en'))
      return 'This service step could not be completed right now. Please try again, or tell me how you would like to continue.'

    return '這個服務步驟暫時無法完成。請稍後再試，或告訴我接下來想怎麼處理。'
  }

  if (locale.startsWith('en'))
    return 'The requested step is complete. Would you like to continue, or is there another step I can help with?'

  return '目前操作已更新。請問要繼續進行，還是需要我協助下一步？'
}
