import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

export type CustomerRequestStatus = 'queued' | 'processing' | 'completed' | 'cancelled' | 'failed' | 'review'

/** Display correlation is local to a reception; durable records also carry visitorSessionId. */
export function requestMessageId(utteranceId: number | undefined, role: 'user' | 'reply'): string | undefined {
  return utteranceId === undefined ? undefined : `utterance:${utteranceId}:${role}${role === 'reply' ? `:${crypto.randomUUID()}` : ''}`
}

/** Groups late/multiple replies under the originating customer, preserving customer order. */
export function groupConversationMessages(messages: readonly ChatHistoryItem[]): ChatHistoryItem[] {
  const groups = new Map<string, ChatHistoryItem[]>()
  for (const message of messages) {
    const match = message.id?.match(/^utterance:(\d+):reply/)
    if (match)
      groups.set(match[1], [...(groups.get(match[1]) ?? []), message])
  }
  const customers = new Set(messages.filter(message => message.role === 'user').map(message => message.id?.match(/^utterance:(\d+):user$/)?.[1]).filter(Boolean))
  return messages.flatMap((message) => {
    const customer = message.id?.match(/^utterance:(\d+):user$/)
    if (customer)
      return [message, ...(groups.get(customer[1]) ?? [])]
    const reply = message.id?.match(/^utterance:(\d+):reply/)
    return reply && customers.has(reply[1]) ? [] : [message]
  })
}
