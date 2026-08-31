import type { AttentionObservation, InteractionPhase, ProactiveInteractionDecision, ProactiveInteractionSettings } from './types'

/** Default conservative settings for the CPU kiosk proof of concept. */
export const defaultProactiveInteractionSettings: ProactiveInteractionSettings = {
  enabled: false,
  dwellMs: 2500,
  emptyResetMs: 1500,
  minAttendingPeople: 1,
}

/**
 * Keeps the anonymous interaction-window invariant: one greeting can be emitted
 * only after continuous attention, and never again until the area has been empty
 * for the configured reset period.
 */
export function createInteractionWindow(settings: ProactiveInteractionSettings) {
  let phase: InteractionPhase = 'idle'
  let attentionStartedAtMs: number | undefined
  let emptyStartedAtMs: number | undefined
  let lastObservedAtMs = -Infinity

  function decide(observation: AttentionObservation): ProactiveInteractionDecision {
    validateObservation(observation, lastObservedAtMs)
    lastObservedAtMs = observation.observedAtMs

    if (!settings.enabled) {
      reset()
      return decision('disabled', observation.attendingPeople)
    }

    if (observation.attendingPeople < settings.minAttendingPeople)
      return handleNoAttention(observation)

    emptyStartedAtMs = undefined

    if (phase === 'greeted')
      return decision('already-greeted', observation.attendingPeople)

    if (attentionStartedAtMs === undefined)
      attentionStartedAtMs = observation.observedAtMs

    phase = 'observing'
    if (observation.observedAtMs - attentionStartedAtMs < settings.dwellMs)
      return decision('observing', observation.attendingPeople)

    phase = 'greeted'
    return decision('dwell-met', observation.attendingPeople, true)
  }

  function reset() {
    phase = 'idle'
    attentionStartedAtMs = undefined
    emptyStartedAtMs = undefined
  }

  function handleNoAttention(observation: AttentionObservation): ProactiveInteractionDecision {
    if (phase === 'idle')
      return decision('no-attention', observation.attendingPeople)

    emptyStartedAtMs ??= observation.observedAtMs
    if (observation.observedAtMs - emptyStartedAtMs < settings.emptyResetMs)
      return decision('no-attention', observation.attendingPeople)

    reset()
    return decision('window-reset', observation.attendingPeople)
  }

  function decision(
    reason: ProactiveInteractionDecision['reason'],
    attendingPeople: number,
    shouldGreet = false,
  ): ProactiveInteractionDecision {
    return { phase, shouldGreet, reason, attendingPeople }
  }

  return { decide, reset }
}

function validateObservation(observation: AttentionObservation, lastObservedAtMs: number) {
  if (!Number.isFinite(observation.observedAtMs) || observation.observedAtMs < lastObservedAtMs)
    throw new Error('Attention observations must use a monotonic finite timestamp')

  if (!Number.isInteger(observation.attendingPeople) || observation.attendingPeople < 0)
    throw new Error('attendingPeople must be a non-negative integer')
}
