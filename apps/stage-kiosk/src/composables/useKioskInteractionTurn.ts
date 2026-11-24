import { computed, onScopeDispose, readonly, shallowRef } from 'vue'

export type KioskInteractionPhase
  = 'listening'
    | 'hearing-speech'
    | 'transcribing'
    | 'thinking'
    | 'using-tool'
    | 'speaking'

export type KioskInteractionTurnKind = 'conversation' | 'proactive' | 'voice'

export interface KioskInteractionTurn {
  id: number
  kind: KioskInteractionTurnKind
  signal: AbortSignal
}

export interface KioskVoiceCandidate {
  id: number
  signal: AbortSignal
}

/**
 * Serializes customer and proactive kiosk work into one cancellable turn.
 *
 * A customer barge-in may supersede spoken output. ASR candidates remain
 * independent until the decision queue decides whether to interrupt work.
 */
export function useKioskInteractionTurn(onBegin?: () => void) {
  const phase = shallowRef<KioskInteractionPhase>('listening')
  let activeTurn: (KioskInteractionTurn & { controller: AbortController }) | undefined
  const voiceCandidates = new Map<number, KioskVoiceCandidate & { controller: AbortController }>()
  let nextTurnId = 0
  const canProactivelySpeak = computed(() => phase.value === 'listening' && activeTurn === undefined)

  function begin(kind: KioskInteractionTurnKind, initialPhase: KioskInteractionPhase): KioskInteractionTurn {
    cancelActiveTurn()
    onBegin?.()

    const controller = new AbortController()
    activeTurn = {
      controller,
      id: ++nextTurnId,
      kind,
      signal: controller.signal,
    }
    phase.value = initialPhase
    return activeTurn
  }

  function isCurrent(turn: KioskInteractionTurn) {
    return activeTurn?.id === turn.id && !turn.signal.aborted
  }

  function advance(turn: KioskInteractionTurn, nextPhase: KioskInteractionPhase) {
    if (!isCurrent(turn))
      return false

    phase.value = nextPhase
    return true
  }

  function complete(turn: KioskInteractionTurn) {
    if (!isCurrent(turn))
      return false

    activeTurn = undefined
    phase.value = 'listening'
    return true
  }

  function cancelActiveTurn(reason?: string) {
    activeTurn?.controller.abort(reason)
    activeTurn = undefined
    phase.value = 'listening'
  }

  function cancel() {
    for (const candidate of voiceCandidates.values())
      candidate.controller.abort()
    voiceCandidates.clear()
    cancelActiveTurn()
  }

  function cancelProactive(reason?: string) {
    if (activeTurn?.kind === 'proactive')
      cancelActiveTurn(reason)
  }

  /** Captures ASR independently so a model or tool turn cannot discard speech. */
  function beginCustomerVoiceCandidate() {
    const controller = new AbortController()
    const candidate = { controller, id: ++nextTurnId, signal: controller.signal }
    voiceCandidates.set(candidate.id, candidate)
    return candidate
  }

  function isCurrentVoiceCandidate(candidate: KioskVoiceCandidate) {
    return voiceCandidates.has(candidate.id) && !candidate.signal.aborted
  }

  function completeVoiceCandidate(candidate: KioskVoiceCandidate) {
    if (!isCurrentVoiceCandidate(candidate))
      return false
    voiceCandidates.delete(candidate.id)
    return true
  }

  onScopeDispose(cancel)

  return {
    advance,
    begin,
    beginCustomerVoiceCandidate,
    canProactivelySpeak: readonly(canProactivelySpeak),
    cancel,
    cancelActiveTurn,
    cancelProactive,
    complete,
    completeVoiceCandidate,
    isCurrent,
    isCurrentVoiceCandidate,
    phase: readonly(phase),
  }
}
