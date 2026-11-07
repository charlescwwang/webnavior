import type { ServiceRecoveryProgress } from '@proj-airi/stage-shared/kiosk-conversation'

import type { FastPathResult } from '../services/kiosk-fast-path'

import { onScopeDispose, readonly, shallowRef } from 'vue'

interface Progress {
  utteranceId: number
  messageKey: 'confirming' | 'still-confirming' | 'processing' | 'ignored' | 'uncertain' | 'failed' | 'browser-unavailable'
  pending: boolean
  retryable: boolean
  elapsedMs: number
}

/** Owns pre-Agent receipt/progress/terminal UI without admitting ambient speech. */
export function useKioskDecisionProgress() {
  const state = shallowRef<Progress>()
  const recovering = shallowRef<number>()
  let active: { id: number, source: 'asr' | 'simulation', admitted: boolean, startedAt: number } | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  const stop = () => {
    clearInterval(timer)
    timer = undefined
  }
  const update = () => {
    if (!active)
      return
    if (active.source === 'asr' && !active.admitted) {
      state.value = undefined
      return
    }
    const elapsedMs = Math.max(0, Date.now() - active.startedAt)
    state.value = { utteranceId: active.id, pending: true, retryable: false, elapsedMs, messageKey: active.admitted ? 'processing' : elapsedMs >= 5000 ? 'still-confirming' : 'confirming' }
  }
  function cancel(id?: number) {
    if (id !== undefined && active?.id !== id)
      return
    stop()
    active = undefined
    recovering.value = undefined
    state.value = undefined
  }
  onScopeDispose(() => cancel())
  return {
    state: readonly(state),
    recovering: readonly(recovering),
    start(id: number, source: 'asr' | 'simulation', startedAt = Date.now()) {
      cancel()
      active = { id, source, admitted: false, startedAt }
      update()
      timer = setInterval(update, 250)
    },
    admit(id: number, admitted: boolean) {
      if (active?.id === id) {
        active.admitted = admitted
        update()
      }
    },
    recovery(id: number, event: ServiceRecoveryProgress) {
      if (active?.id !== id)
        return
      recovering.value = id
      active.admitted = event.status === 'completed' && event.admission === 'service'
      update()
    },
    finish(id: number, result: Pick<FastPathResult, 'kind' | 'reason' | 'recovery' | 'browserContextError'>) {
      if (active?.id !== id)
        return
      stop()
      recovering.value = undefined
      if (['IGNORE', 'UNAVAILABLE', 'INCOMPLETE'].includes(result.kind) && (active.source === 'simulation' || active.admitted)) {
        if (result.browserContextError) {
          state.value = { utteranceId: id, pending: false, elapsedMs: Date.now() - active.startedAt, messageKey: 'browser-unavailable', retryable: true }
          active = undefined
          return
        }
        const failed = result.kind === 'UNAVAILABLE' && (Boolean(result.recovery?.failure) || ['PROVIDER_FAILURE', 'INVALID_CHOICE', 'CANDIDATE_BUDGET'].includes(result.reason ?? ''))
        state.value = { utteranceId: id, pending: false, elapsedMs: Date.now() - active.startedAt, messageKey: failed ? 'failed' : result.kind === 'IGNORE' ? 'ignored' : 'uncertain', retryable: failed }
      }
      else {
        state.value = undefined
      }
      active = undefined
    },
    cancel,
  }
}
