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

/**
 * Determines when VAD may begin a new customer utterance.
 *
 * While ASR or the ordering model is working, accepting another utterance
 * would replace the active turn and discard its result. Speech synthesis is
 * intentionally excluded from that lock so customers can still barge in and
 * stop a spoken answer.
 */
export function canStartKioskVoiceTurn(phase: KioskInteractionPhase) {
  return phase === 'listening' || phase === 'speaking'
}

/**
 * Serializes customer and proactive kiosk work into one cancellable turn.
 *
 * A customer barge-in may supersede spoken output. Callers must gate ASR and
 * model phases with `canStartKioskVoiceTurn`, then check `isCurrent` after
 * every asynchronous boundary before presenting or persisting a result.
 */
export function useKioskInteractionTurn() {
  const phase = shallowRef<KioskInteractionPhase>('listening')
  let activeTurn: (KioskInteractionTurn & { controller: AbortController }) | undefined
  let nextTurnId = 0
  const canProactivelySpeak = computed(() => phase.value === 'listening' && activeTurn === undefined)

  function begin(kind: KioskInteractionTurnKind, initialPhase: KioskInteractionPhase): KioskInteractionTurn {
    cancel()

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

  function cancel() {
    activeTurn?.controller.abort()
    activeTurn = undefined
    phase.value = 'listening'
  }

  function cancelProactive() {
    if (activeTurn?.kind === 'proactive')
      cancel()
  }

  /**
   * Gives an actual customer utterance precedence over a background greeting,
   * while preserving the no-interruption rule for customer work in progress.
   */
  function beginCustomerVoiceTurn() {
    cancelProactive()
    if (!canStartKioskVoiceTurn(phase.value))
      return undefined
    return begin('voice', 'hearing-speech')
  }

  onScopeDispose(cancel)

  return {
    advance,
    begin,
    beginCustomerVoiceTurn,
    canProactivelySpeak: readonly(canProactivelySpeak),
    cancel,
    cancelProactive,
    complete,
    isCurrent,
    phase: readonly(phase),
  }
}
