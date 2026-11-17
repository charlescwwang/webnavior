import type { DetectionZone } from '@proj-airi/kiosk-proactive'

import { isInsideDetectionZone } from '@proj-airi/kiosk-proactive'

/** Anonymous geometry for one decoded frame, never a MediaPipe array index or biometric identity. */
export interface CustomerFace {
  centre: { x: number, y: number }
  bodyScale: number
  facesCamera: boolean
}

/** A revision changes whenever visual continuity is lost, including ambiguous crossings. */
export interface CustomerTarget {
  index?: number
  revision: number
  candidates: number
  reason: 'acquired' | 'tracking' | 'challenger' | 'switched' | 'missing' | 'ambiguous'
}

function separation(left: CustomerFace, right: CustomerFace) {
  return Math.hypot(left.centre.x - right.centre.x, left.centre.y - right.centre.y)
}

function follows(previous: CustomerFace, next: CustomerFace) {
  const ratio = next.bodyScale / previous.bodyScale
  return separation(previous, next) <= 0.1 && ratio >= 0.67 && ratio <= 1.5
}

/**
 * Chooses the ordering position before matching a mouth. A clearly better face
 * must persist for 400 ms; close scores/overlapping tracks grant no mouth authority.
 * Call reset on camera/session changes. Only in-zone geometry is retained.
 */
export function createCustomerTarget() {
  let current: CustomerFace | undefined
  let challenger: { face: CustomerFace, since: number } | undefined
  let lastAt = -Infinity
  let revision = 0

  function reset() {
    current = undefined
    challenger = undefined
    lastAt = -Infinity
    revision++
  }

  return {
    reset,
    observe(timeMs: number, faces: readonly CustomerFace[], zone: DetectionZone, interactionZone = zone): CustomerTarget {
      if (timeMs <= lastAt || timeMs - lastAt > 250)
        reset()
      lastAt = timeMs
      const score = (face: CustomerFace) => {
        const dx = (face.centre.x - interactionZone.x - interactionZone.width / 2) / Math.max(0.01, interactionZone.width / 2)
        const dy = (face.centre.y - interactionZone.y - interactionZone.height / 2) / Math.max(0.01, interactionZone.height / 2)
        // Interaction ROI wins over the wider observation area. Centrality,
        // frontal attention and apparent scale then break ties; arrival order never does.
        return (isInsideDetectionZone(face.centre, interactionZone) ? 2 : 0)
          + Math.max(0, 1 - Math.hypot(dx, dy)) * 0.8
          + (face.facesCamera ? 0.35 : 0) + Math.min(face.bodyScale, 0.5) * 0.8
      }
      const candidates = faces.map((face, index) => ({ face, index, score: score(face) }))
        .filter(({ face }) => Number.isFinite(face.bodyScale) && face.bodyScale > 0 && isInsideDetectionZone(face.centre, zone))
        .sort((left, right) => right.score - left.score)
      const result = (reason: CustomerTarget['reason'], index?: number): CustomerTarget => ({ reason, index, revision, candidates: candidates.length })
      const best = candidates[0]
      if (!best) {
        if (current)
          revision++
        current = undefined
        challenger = undefined
        return result('missing')
      }
      const matches = current ? candidates.filter(candidate => follows(current!, candidate.face)) : []
      if (matches.length > 1 || (candidates[1] && best.score - candidates[1].score < 0.12)) {
        if (current)
          revision++
        current = undefined
        challenger = undefined
        return result('ambiguous')
      }
      const tracked = matches[0]
      if (!tracked) {
        revision++
        current = best.face
        challenger = undefined
        return result('acquired', best.index)
      }
      current = tracked.face
      if (best.index === tracked.index || best.score - tracked.score < 0.25) {
        challenger = undefined
        return result('tracking', tracked.index)
      }
      if (!challenger || !follows(challenger.face, best.face))
        challenger = { face: best.face, since: timeMs }
      challenger.face = best.face
      if (timeMs - challenger.since < 400)
        return result('challenger', tracked.index)
      current = best.face
      challenger = undefined
      revision++
      return result('switched', best.index)
    },
  }
}
