import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { DetectionZone } from '@proj-airi/kiosk-proactive'

import { isInsideDetectionZone } from '@proj-airi/kiosk-proactive'

/** Image-free mouth measurements; coordinates use the source camera, aperture is lip gap / mouth width. */
export interface MouthGeometry {
  centre: { x: number, y: number }
  widthPx: number
  aperture: number
}

/** Measures a unique in-zone mouth without allocating images for legacy ASR admission. */
export function readMouthGeometry(width: number, height: number, faces: readonly NormalizedLandmark[][], zone: DetectionZone): MouthGeometry | undefined {
  const candidates = faces.filter(face => face[1] && isInsideDetectionZone(face[1], zone))
  if (candidates.length !== 1 || width <= 0 || height <= 0)
    return undefined
  const face = candidates[0]!
  const left = face[61]
  const right = face[291]
  const upper = face[13]
  const lower = face[14]
  if (!left || !right || !upper || !lower || [left, right, upper, lower].some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y)))
    return undefined
  // Scale both axes to video pixels so aspect ratio and face translation cannot
  // turn closed lips into an apparent opening. Require at least eight pixels for a measurable mouth width.
  const widthPx = Math.hypot((left.x - right.x) * width, (left.y - right.y) * height)
  if (widthPx < 8)
    return undefined
  return {
    centre: { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 },
    widthPx,
    aperture: Math.hypot((upper.x - lower.x) * width, (upper.y - lower.y) * height) / widthPx,
  }
}

/**
 * Visual permission for new VAD phrases. A lease binds a phrase to uninterrupted
 * geometric target continuity, not biometric identity. Camera/mode/session owners
 * reset the gate; a missing, stale or replaced target permanently revokes old leases.
 * All times share the camera/audio performance clock.
 */
export function createMouthActivityGate(options: { enabled?: () => boolean, maxMotionGapMs?: () => number } = {}) {
  let previous: { timeMs: number, mouth: MouthGeometry } | undefined
  let lastMotionAtMs = -Infinity
  let revision = 0
  // Face inference runs at 10 fps. Allow one missed cadence, then fail closed.
  const freshnessMs = 250
  // New phrases require currently open lips. An admitted phrase may bridge
  // short closures, but sustained inactivity permanently revokes its lease.
  const onsetWindowMs = 600
  const openAperture = 0.04
  const maxMotionGapMs = () => Math.max(1000, options.maxMotionGapMs?.() ?? 1000)

  function reset() {
    previous = undefined
    lastMotionAtMs = -Infinity
    revision++
  }

  function fresh(nowMs: number) {
    return previous !== undefined && nowMs >= previous.timeMs && nowMs - previous.timeMs <= freshnessMs
  }

  return {
    observe(timeMs: number, mouth?: MouthGeometry) {
      if (options.enabled?.() === false) {
        reset()
        return
      }
      if (!Number.isFinite(timeMs) || !mouth || !Number.isFinite(mouth.aperture) || !Number.isFinite(mouth.widthPx) || mouth.widthPx < 8 || !Number.isFinite(mouth.centre.x) || !Number.isFinite(mouth.centre.y)) {
        reset()
        return
      }
      if (previous) {
        const age = timeMs - previous.timeMs
        const displacement = Math.hypot(mouth.centre.x - previous.mouth.centre.x, mouth.centre.y - previous.mouth.centre.y)
        const scale = mouth.widthPx / previous.mouth.widthPx
        // Large location/scale jumps are a target change, never lip motion.
        if (age <= 0 || age > freshnessMs || displacement > 0.1 || scale < 0.67 || scale > 1.5)
          reset()
      }
      // Expire before accepting new movement: reopening cannot revive the
      // old phrase that a bystander kept alive while this customer was silent.
      if (Number.isFinite(lastMotionAtMs) && timeMs - lastMotionAtMs >= maxMotionGapMs()) {
        revision++
        lastMotionAtMs = -Infinity
      }
      if (previous) {
        // Ratios ignore camera distance. Reject small landmark jitter and a held
        // opening; require a meaningful change plus an actually open lip interval.
        const change = Math.abs(mouth.aperture - previous.mouth.aperture)
        if (change >= 0.02 && mouth.aperture > openAperture)
          lastMotionAtMs = timeMs
      }
      previous = { timeMs, mouth }
    },
    allowsStart(nowMs: number) {
      if (options.enabled?.() === false)
        return true
      return fresh(nowMs) && previous!.mouth.aperture > openAperture && nowMs >= lastMotionAtMs && nowMs - lastMotionAtMs < onsetWindowMs
    },
    begin(nowMs: number): number | undefined {
      return this.allowsStart(nowMs) ? revision : undefined
    },
    complete(lease: number | undefined, nowMs: number) {
      if (options.enabled?.() === false)
        return true
      return lease !== undefined && lease === revision && fresh(nowMs) && nowMs >= lastMotionAtMs && nowMs - lastMotionAtMs < maxMotionGapMs()
    },
    reset,
  }
}
