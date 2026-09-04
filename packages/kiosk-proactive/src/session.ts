import type { AttentionObservation, InteractionPhase, ProactiveGreetingTrigger, ProactiveInteractionDecision, ProactiveInteractionSettings } from './types'

export const defaultAttentionGreetingPrompt = '你是餐飲 kiosk 的 AIRI 服務員。請以繁體中文自然、中性地招呼正在看向 kiosk 的可能是一組訪客。不要推測或稱呼年齡、性別、種族或外貌，也不要提到相機、偵測或辨識。限兩句內，表示可協助瀏覽菜單、點餐或介紹兒童餐等需求。'
export const defaultPresenceGreetingPrompt = '你是餐飲 kiosk 的 AIRI 服務員。請以繁體中文自然、中性地向剛進入 kiosk 互動區的可能是一組訪客主動招呼。不要假設對方已注意到 kiosk，不要推測或稱呼年齡、性別、種族或外貌，也不要提到相機、偵測或辨識。限兩句內，表示如有需要可協助瀏覽菜單、點餐或介紹兒童餐。'

/** Default conservative settings for the CPU kiosk proof of concept. */
export const defaultProactiveInteractionSettings: ProactiveInteractionSettings = {
  enabled: false,
  dwellMs: 2500,
  emptyResetMs: 1500,
  minAttendingPeople: 1,
  triggerMode: 'attention',
  attentionGreetingPrompt: defaultAttentionGreetingPrompt,
  presenceGreetingPrompt: defaultPresenceGreetingPrompt,
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
  let activeTrigger: ProactiveGreetingTrigger | undefined

  function decide(observation: AttentionObservation): ProactiveInteractionDecision {
    validateObservation(observation, lastObservedAtMs)
    lastObservedAtMs = observation.observedAtMs

    if (!settings.enabled) {
      reset()
      return decision('disabled', peopleMatchingTrigger(observation))
    }

    const trigger = matchingTrigger(observation)
    if (!trigger)
      return handleNoAttention(observation)

    emptyStartedAtMs = undefined

    if (phase === 'greeted')
      return decision('already-greeted', trigger.people)

    // Mixed mode must not count a passerby's dwell time as screen attention.
    // A signal change starts a new dwell interval while retaining the same
    // anonymous interaction window and its once-only greeting invariant.
    if (activeTrigger !== trigger.kind) {
      activeTrigger = trigger.kind
      attentionStartedAtMs = observation.observedAtMs
    }
    attentionStartedAtMs ??= observation.observedAtMs

    phase = 'observing'
    if (observation.observedAtMs - attentionStartedAtMs < settings.dwellMs)
      return decision('observing', trigger.people)

    phase = 'greeted'
    return decision('dwell-met', trigger.people, true, trigger.kind)
  }

  function reset() {
    phase = 'idle'
    attentionStartedAtMs = undefined
    emptyStartedAtMs = undefined
    activeTrigger = undefined
  }

  function handleNoAttention(observation: AttentionObservation): ProactiveInteractionDecision {
    if (phase === 'idle')
      return decision('no-attention', peopleMatchingTrigger(observation))

    emptyStartedAtMs ??= observation.observedAtMs
    if (observation.observedAtMs - emptyStartedAtMs < settings.emptyResetMs)
      return decision('no-attention', peopleMatchingTrigger(observation))

    reset()
    return decision('window-reset', peopleMatchingTrigger(observation))
  }

  function decision(
    reason: ProactiveInteractionDecision['reason'],
    triggeringPeople: number,
    shouldGreet = false,
    greetingTrigger?: ProactiveGreetingTrigger,
  ): ProactiveInteractionDecision {
    return { phase, shouldGreet, reason, triggeringPeople, greetingTrigger }
  }

  function peopleMatchingTrigger(observation: AttentionObservation) {
    return matchingTrigger(observation)?.people ?? 0
  }

  function matchingTrigger(observation: AttentionObservation) {
    const attentionMatches = observation.attendingPeople >= settings.minAttendingPeople
    const presenceMatches = observation.presencePeople >= settings.minAttendingPeople

    if (settings.triggerMode === 'attention')
      return attentionMatches ? { kind: 'attention' as const, people: observation.attendingPeople } : undefined

    if (settings.triggerMode === 'presence')
      return presenceMatches ? { kind: 'presence' as const, people: observation.presencePeople } : undefined

    // When both conditions are true, an explicit look at the kiosk is the
    // stronger social signal and therefore selects the attention greeting.
    if (attentionMatches)
      return { kind: 'attention' as const, people: observation.attendingPeople }

    return presenceMatches ? { kind: 'presence' as const, people: observation.presencePeople } : undefined
  }

  return { decide, reset }
}

function validateObservation(observation: AttentionObservation, lastObservedAtMs: number) {
  if (!Number.isFinite(observation.observedAtMs) || observation.observedAtMs < lastObservedAtMs)
    throw new Error('Attention observations must use a monotonic finite timestamp')

  if (!Number.isInteger(observation.attendingPeople) || observation.attendingPeople < 0)
    throw new Error('attendingPeople must be a non-negative integer')

  if (!Number.isInteger(observation.presencePeople) || observation.presencePeople < 0)
    throw new Error('presencePeople must be a non-negative integer')
}
