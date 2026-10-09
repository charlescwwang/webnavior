import type { PresenceCandidate, PresenceSettings, PresenceState, ProactiveGreetingTrigger, ProactiveInteractionSettings } from './types'

import { isInsideDetectionZone } from './observation'
import { createInteractionWindow } from './session'

/** Conservative installation-independent defaults; values are normalized to the camera frame. */
export const defaultPresenceSettings: PresenceSettings = {
  greetingRoi: { x: 0.15, y: 0.1, width: 0.7, height: 0.8 },
  interactionRoi: { x: 0.3, y: 0.18, width: 0.4, height: 0.7 },
  greetingMinSamples: 2,
  greetingCooldownMs: 12_000,
  passingSpeedPerSecond: 0.45,
  passingMaxDwellMs: 2_000,
  approachingScaleVelocityPerSecond: 0.012,
  approachingMinSamples: 3,
  approachingIdleSuppressMs: 1_500,
  visualEngagedIdleProtectionMs: 15_000,
  engagedBodyScale: 0.12,
  engagedExitBodyScale: 0.09,
  engagedDwellMs: 1_200,
  transitionDwellMs: 500,
  lostGraceMs: 1_500,
  historySize: 6,
}

export interface PresenceDecision {
  state: PresenceState
  previousState: PresenceState
  candidate?: PresenceCandidate
  dwellMs: number
  velocityX: number
  scaleVelocity: number
  lastSeenAgeMs: number
  greetingEligible: boolean
  greetingTrigger?: ProactiveGreetingTrigger
  idleSuppressed: boolean
  transitionReason: string
}

/**
 * Keeps a small anonymous sample history. It never attempts identity tracking:
 * the host supplies the currently most relevant local candidate each cadence.
 */
export function createPresenceWindow(settings: PresenceSettings, greeting: ProactiveInteractionSettings) {
  let state: PresenceState = 'EMPTY'
  let stateStartedAtMs = 0
  let firstSeenAtMs: number | undefined
  let lastSeenAtMs: number | undefined
  let lastObservedAtMs = -Infinity
  let greetedAtMs: number | undefined
  let lastReason = 'initial'
  // Geometry owns presence; the existing interaction policy owns configured
  // trigger, dwell and absence reset. A pending trigger is claimed by the host.
  const interactionWindow = createInteractionWindow(greeting)
  let pendingTrigger: ProactiveGreetingTrigger | undefined
  const history: Array<{ at: number, candidate: PresenceCandidate }> = []

  function decide(observedAtMs: number, candidate?: Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'>, interaction = false): PresenceDecision {
    if (!Number.isFinite(observedAtMs) || observedAtMs < lastObservedAtMs)
      throw new Error('Presence observations must use monotonic finite timestamps')
    lastObservedAtMs = observedAtMs

    const enriched = candidate && {
      ...candidate,
      greetingRoiHit: isInsideDetectionZone(candidate.centre, settings.greetingRoi),
      interactionRoiHit: isInsideDetectionZone(candidate.centre, settings.interactionRoi),
    }
    if (!enriched)
      return decideMissing(observedAtMs)

    firstSeenAtMs ??= observedAtMs
    lastSeenAtMs = observedAtMs
    history.push({ at: observedAtMs, candidate: enriched })
    if (history.length > settings.historySize)
      history.shift()

    const previousState = state
    const dwellMs = observedAtMs - firstSeenAtMs
    const { velocityX, scaleVelocity } = trends()
    const isPassing = Math.abs(velocityX) >= settings.passingSpeedPerSecond && dwellMs <= settings.passingMaxDwellMs
    const isApproaching = enriched.poseQuality >= 0.5
      && history.length >= settings.approachingMinSamples
      && scaleVelocity >= settings.approachingScaleVelocityPerSecond
      && (enriched.greetingRoiHit || enriched.interactionRoiHit)
    const isNear = enriched.poseQuality >= 0.5
      && enriched.interactionRoiHit
      && enriched.bodyScale >= (state === 'ENGAGED' ? settings.engagedExitBodyScale : settings.engagedBodyScale)

    if (interaction)
      transition('ENGAGED', observedAtMs, 'interaction event')
    else if (isNear && dwellMs >= settings.engagedDwellMs)
      transition('ENGAGED', observedAtMs, 'near interaction ROI dwell met')
    else if (state === 'ENGAGED' && enriched.poseQuality < 0.5)
      lastReason = 'low pose quality retained engaged state'
    else if (isApproaching)
      transition('APPROACHING', observedAtMs, 'positive body scale trend into ROI')
    else if (isPassing)
      transition('PASSING', observedAtMs, 'short dwell with horizontal movement')
    else
      transition('DISTANT', observedAtMs, enriched.poseQuality < 0.5 ? 'low quality candidate' : 'present without approach evidence')

    const observable = enriched.poseQuality >= 0.5 && enriched.greetingRoiHit
    const policy = interactionWindow.decide({ observedAtMs, presencePeople: observable ? 1 : 0, attendingPeople: observable && enriched.attention === true ? 1 : 0 })
    if (policy.shouldGreet)
      pendingTrigger = policy.greetingTrigger
    if (!observable || policy.reason === 'no-attention' || policy.reason === 'window-reset' || policy.reason === 'disabled')
      pendingTrigger = undefined
    const greetingEligible = Boolean(pendingTrigger)
      && enriched.greetingRoiHit
      // A fast passer must still survive more than one local inference, but
      // should not have to wait for a third sample after the scheduler boosts.
      && history.length >= settings.greetingMinSamples
      && (greetedAtMs == null || observedAtMs - greetedAtMs >= settings.greetingCooldownMs)

    return decision(previousState, enriched, dwellMs, velocityX, scaleVelocity, greetingEligible, pendingTrigger)
  }

  function decideMissing(observedAtMs: number): PresenceDecision {
    interactionWindow.decide({ observedAtMs, presencePeople: 0, attendingPeople: 0 })
    pendingTrigger = undefined
    const previousState = state
    const lastSeenAgeMs = lastSeenAtMs == null ? Infinity : observedAtMs - lastSeenAtMs
    if (lastSeenAgeMs > settings.lostGraceMs) {
      transition('EMPTY', observedAtMs, 'candidate lost beyond grace period')
      firstSeenAtMs = undefined
      history.length = 0
    }
    else if (state !== 'EMPTY') {
      lastReason = 'candidate temporarily lost within grace period'
    }
    return {
      state,
      previousState,
      dwellMs: firstSeenAtMs == null ? 0 : observedAtMs - firstSeenAtMs,
      velocityX: 0,
      scaleVelocity: 0,
      lastSeenAgeMs,
      greetingEligible: false,
      idleSuppressed: idleSuppressed(observedAtMs),
      transitionReason: lastReason,
    }
  }

  function trends() {
    const first = history[0]
    const last = history.at(-1)
    if (!first || !last || last.at === first.at)
      return { velocityX: 0, scaleVelocity: 0 }
    const seconds = (last.at - first.at) / 1_000
    return {
      velocityX: (last.candidate.centre.x - first.candidate.centre.x) / seconds,
      scaleVelocity: (last.candidate.bodyScale - first.candidate.bodyScale) / seconds,
    }
  }

  function transition(next: PresenceState, observedAtMs: number, reason: string) {
    if (next === state)
      return
    if (observedAtMs - stateStartedAtMs < settings.transitionDwellMs && state !== 'EMPTY')
      return
    state = next
    stateStartedAtMs = observedAtMs
    lastReason = reason
  }

  function decision(previousState: PresenceState, candidate: PresenceCandidate, dwellMs: number, velocityX: number, scaleVelocity: number, greetingEligible: boolean, greetingTrigger?: ProactiveGreetingTrigger): PresenceDecision {
    return {
      state,
      previousState,
      candidate,
      dwellMs,
      velocityX,
      scaleVelocity,
      lastSeenAgeMs: 0,
      greetingEligible,
      greetingTrigger,
      idleSuppressed: idleSuppressed(lastObservedAtMs),
      transitionReason: lastReason,
    }
  }

  function idleSuppressed(observedAtMs: number) {
    return state === 'ENGAGED'
      || (state === 'APPROACHING' && observedAtMs - stateStartedAtMs < settings.approachingIdleSuppressMs)
  }

  /** Claims the cooldown only after the caller has successfully started the greeting turn. */
  function claimGreeting() {
    greetedAtMs = lastObservedAtMs
    pendingTrigger = undefined
  }

  return { claimGreeting, decide }
}
