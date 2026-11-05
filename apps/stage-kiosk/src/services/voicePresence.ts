import type { PresenceCandidate } from '@proj-airi/kiosk-proactive'

import { defaultPresenceSettings } from '@proj-airi/kiosk-proactive'

/** Snapshot of the current admission decision; no face/image/identity is stored. */
export interface VoicePresenceDecision {
  allowed: boolean
  reason: 'observation_disabled' | 'fresh_person' | 'not_observing' | 'no_person' | 'low_quality' | 'outside_zone' | 'stale'
  ageMs: number | null
  quality: number | null
  insideZone: boolean | null
}

/**
 * Admits voice only with recent valid local evidence. ENGAGED presentation is
 * independent: manual activity or retained low-quality detections can keep that
 * label while this gate lacks fresh valid evidence. Voice accepts the canonical
 * greeting OR interaction ROI; it never treats the ENGAGED label itself as proof.
 */
export function createVoicePresenceGate() {
  let lastSeenAtMs: number | undefined
  let quality: number | null = null
  let insideZone: boolean | null = null

  function inspect(input: { enabled: boolean, observing: boolean, nowMs: number }): VoicePresenceDecision {
    const ageMs = lastSeenAtMs === undefined ? null : input.nowMs - lastSeenAtMs
    const snapshot = { ageMs, quality, insideZone }
    if (!input.enabled)
      return { ...snapshot, allowed: true, reason: 'observation_disabled' }
    if (!input.observing)
      return { ...snapshot, allowed: false, reason: 'not_observing' }
    // Preserve the existing1500ms grace exactly. A rejected recent candidate
    // cannot erase a still-fresh valid person, nor renew an expired one.
    if (ageMs !== null && ageMs >= 0 && ageMs <= defaultPresenceSettings.lostGraceMs)
      return { ...snapshot, allowed: true, reason: 'fresh_person' }
    if (quality !== null && quality < 0.5)
      return { ...snapshot, allowed: false, reason: 'low_quality' }
    if (insideZone === false)
      return { ...snapshot, allowed: false, reason: 'outside_zone' }
    return { ...snapshot, allowed: false, reason: ageMs === null ? 'no_person' : 'stale' }
  }

  return {
    observe(nowMs: number, candidate: PresenceCandidate | undefined) {
      quality = candidate?.poseQuality ?? null
      // Consume the same frame's canonical ROI results used by presence display.
      // The greeting zone may end above the customer's torso centre; retain that
      // existing area and also accept the interaction ROI that establishes ENGAGED.
      insideZone = candidate ? candidate.greetingRoiHit || candidate.interactionRoiHit : null
      if (candidate && candidate.poseQuality >= 0.5 && insideZone)
        lastSeenAtMs = nowMs
    },
    inspect,
    allows(input: { enabled: boolean, observing: boolean, nowMs: number }) {
      return inspect(input).allowed
    },
    reset() {
      lastSeenAtMs = undefined
      quality = null
      insideZone = null
    },
  }
}
