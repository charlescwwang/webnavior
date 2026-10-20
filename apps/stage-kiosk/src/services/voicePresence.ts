import type { DetectionZone, PresenceCandidate } from '@proj-airi/kiosk-proactive'

import { defaultPresenceSettings, isInsideDetectionZone } from '@proj-airi/kiosk-proactive'

/**
 * Admits microphone input and unsolicited speech using recent local evidence.
 * The camera owner must reset this window on restart or policy changes. Times
 * use performance.now(), independently of the customer-session wall clock.
 */
export function createVoicePresenceGate() {
  let lastSeenAtMs: number | undefined

  return {
    observe(nowMs: number, candidate: Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'> | undefined, zone: DetectionZone) {
      if (candidate && candidate.poseQuality >= 0.5 && isInsideDetectionZone(candidate.centre, zone))
        lastSeenAtMs = nowMs
    },
    allows(input: { enabled: boolean, observing: boolean, nowMs: number }) {
      // Devices without observation retain their existing microphone service.
      // Once enabled, unavailable inference is unknown rather than presence.
      if (!input.enabled)
        return true
      if (!input.observing || lastSeenAtMs === undefined)
        return false
      const ageMs = input.nowMs - lastSeenAtMs
      // Reuse the presence policy's brief occlusion grace, while also expiring
      // evidence if no new frames arrive. ENGAGED alone can otherwise be stale.
      return ageMs >= 0 && ageMs <= defaultPresenceSettings.lostGraceMs
    },
    reset() {
      lastSeenAtMs = undefined
    },
  }
}
