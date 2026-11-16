import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import { shallowReadonly, shallowRef } from 'vue'

/** Display-only text for one model round; never persists drafts or starts TTS. */
export function useKioskStreamingReply() {
  const message = shallowRef<ChatHistoryItem>()
  let owner: { turnId: number, messageId: string | undefined } | undefined

  function clear(turnId?: number) {
    // A retired request may finish cleanup after its replacement has started.
    if (turnId !== undefined && owner?.turnId !== turnId)
      return
    owner = undefined
    message.value = undefined
  }

  function begin(turnId: number, messageId: string | undefined) {
    clear()
    owner = { turnId, messageId }
  }

  function append(turnId: number, text: string) {
    // A cancelled turn, tool request or previous round cannot revive its draft.
    if (!owner || owner.turnId !== turnId || !text)
      return
    const content = `${message.value?.content ?? ''}${text}`
    message.value = { role: 'assistant', id: owner.messageId, content, slices: [{ type: 'text', text: content }], tool_results: [] }
  }

  return { message: shallowReadonly(message), begin, append, clear }
}
