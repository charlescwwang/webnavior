import type { DetectionZone, PresenceCandidate } from '@proj-airi/kiosk-proactive'

import { defaultPresenceSettings, isInsideDetectionZone } from '@proj-airi/kiosk-proactive'

/**
 * Admits microphone input and unsolicited speech using recent local evidence.
 * The camera owner must reset this window on restart or policy changes. Times
 * use performance.now(), independently of the customer-session wall clock.
 */
export function createVoicePresenceGate() {
  let lastSeenAtMs: number | undefined
  let lastLocatedAtMs: number | undefined

  function allows(input: { enabled: boolean, observing: boolean, nowMs: number }) {
    // Devices without observation retain their existing microphone service.
    // Once enabled, unavailable inference is unknown rather than presence.
    if (!input.enabled)
      return true
    if (!input.observing || lastSeenAtMs === undefined)
      return false
    const ageMs = input.nowMs - lastSeenAtMs
    return ageMs >= 0 && ageMs <= defaultPresenceSettings.lostGraceMs
  }

  return {
    observe(nowMs: number, candidate: Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'> | undefined, zone: DetectionZone) {
      const inZone = candidate && isInsideDetectionZone(candidate.centre, zone)
      if (inZone && Number.isFinite(candidate.poseQuality) && candidate.poseQuality >= 0) {
        lastLocatedAtMs = nowMs
        if (candidate.poseQuality >= 0.5)
          lastSeenAtMs = nowMs
      }
    },
    allows,
    /** Low-confidence geometry cannot admit speech, but is not confirmed departure. */
    shouldCancelProactive(input: { enabled: boolean, observing: boolean, nowMs: number }) {
      if (!input.enabled)
        return false
      if (!input.observing || lastSeenAtMs === undefined || lastLocatedAtMs === undefined)
        return true
      // Preserve only an already admitted turn while fresh uncertain geometry
      // still locates the visitor in-zone. This never renews start/ASR admission;
      // missing/out-of-zone observations do not renew it. Keep the same brief
      // grace after an uncertain frame; one subsequent miss is not instant exit.
      const locatedAgeMs = input.nowMs - lastLocatedAtMs
      return locatedAgeMs < 0 || locatedAgeMs > defaultPresenceSettings.lostGraceMs
    },
    reset() {
      lastSeenAtMs = undefined
      lastLocatedAtMs = undefined
    },
  }
}
