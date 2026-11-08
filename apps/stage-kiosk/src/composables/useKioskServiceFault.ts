import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'
import type { Ref } from 'vue'

import type { FastPathResult } from '../services/kiosk-fast-path'

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
    locked: readonly(locked),
    lock: () => locked.value = true,
    /** Retains failed speech without granting service admission or operation authority. */
    failDecision(result: Pick<FastPathResult, 'kind' | 'reason' | 'recovery'>, input: { transcript: string, message: string, shownInput: boolean }) {
      if (!shouldShowDecisionRetry(result))
        return false
      // Decision failures precede browser execution. They need a visible
      // outcome, but cannot justify locking an untouched order.
      failUtterance({ ...input, uncertain: false })
      return true
    },
    // Call only after PIN-validated recovery or a successfully reset order round.
    clear: () => locked.value = false,
  }
}
