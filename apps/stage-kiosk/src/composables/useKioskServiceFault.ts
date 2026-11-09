import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'
import type { Ref } from 'vue'

import type { FastPathResult } from '../services/kiosk-fast-path'
import type { ConversationTurnResult } from './useKioskInteractionRecording'

import { useSessionStorage } from '@vueuse/core'
import { readonly, watch } from 'vue'

import { shouldShowDecisionRetry } from '../services/kiosk-fast-path'

/** A technical conversation fault stays latched through reload until an explicit recovery. */
export function useKioskServiceFault(messages: Ref<ChatHistoryItem[]>) {
  const locked = useSessionStorage('kiosk/service-fault', false)
  watch(() => messages.value.at(-1), (message) => {
    if (message?.role === 'error')
      locked.value = true
  }, { flush: 'sync' })
  function failUtterance(input: { transcript: string, message: string, shownInput: boolean, uncertain?: boolean }) {
    messages.value = [
      ...messages.value,
      ...(!input.shownInput ? [{ role: 'user' as const, content: input.transcript }] : []),
      input.uncertain === false
        ? { role: 'assistant', content: input.message, slices: [], tool_results: [] }
        : { role: 'error', content: input.message },
    ]
  }
  return {
    /** Publishes an unexpected processing failure into the existing assistance lifecycle. */
    failUtterance,
    /** Terminal technical failures use the same pause before or after browser effects. */
    failConversation(result: Pick<ConversationTurnResult, 'status' | 'reason'>, input: { transcript: string, message: string, shownInput: boolean }) {
      if (result.status === 'completed' || result.status === 'waiting' || !result.reason || !['provider-error', 'timeout', 'tool-limit', 'duplicate-tool-call', 'context-unavailable', 'service-unavailable', 'session-error'].includes(result.reason))
        return false
      failUtterance(input)
      return true
    },
    locked: readonly(locked),
    lock: () => locked.value = true,
    /** Retains failed speech without granting service admission or operation authority. */
    failDecision(result: Pick<FastPathResult, 'kind' | 'reason' | 'recovery'>, input: { transcript: string, message: string, shownInput: boolean }) {
      if ((result.reason === 'SYSTEM_ONE_DISABLED' && result.recovery?.status !== 'failed') || !shouldShowDecisionRetry(result))
        return false
      // Format/provider failures are technical even before any order effect.
      // Publishing an error enters the same persisted assistance lifecycle.
      failUtterance(input)
      return true
    },
    // Call only after PIN-validated recovery or a successfully reset order round.
    clear: () => locked.value = false,
  }
}
