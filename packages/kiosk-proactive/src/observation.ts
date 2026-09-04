import type { AttentionObservation, DetectionZone, FaceLandmarkObservation } from './types'

/** The calibrated centre area used until a site administrator adjusts the kiosk camera zone. */
export const defaultDetectionZone: DetectionZone = {
  x: 0.2,
  y: 0.15,
  width: 0.6,
  height: 0.7,
}

/**
 * Turns anonymous per-face measurements into the counts consumed by the
 * interaction policy. It intentionally discards all geometry after counting.
 */
export function createAttentionObservation(
  observedAtMs: number,
  faces: FaceLandmarkObservation[],
  zone: DetectionZone,
): AttentionObservation {
  const facesInZone = faces.filter(face => isInsideDetectionZone(face.centre, zone))

  return {
    observedAtMs,
    presencePeople: facesInZone.length,
    attendingPeople: facesInZone.filter(face => face.facesCamera).length,
  }
}

/** Returns whether a normalized camera point falls inside the calibrated detection zone. */
export function isInsideDetectionZone(point: { x: number, y: number }, zone: DetectionZone) {
  return point.x >= zone.x
    && point.x <= zone.x + zone.width
    && point.y >= zone.y
    && point.y <= zone.y + zone.height
}
