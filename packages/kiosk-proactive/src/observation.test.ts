import { describe, expect, it } from 'vitest'

import { createAttentionObservation, defaultDetectionZone, isInsideDetectionZone } from './observation'

describe('createAttentionObservation', () => {
  it('counts only faces inside the local calibrated zone', () => {
    expect(createAttentionObservation(100, [
      { centre: { x: 0.5, y: 0.5 }, facesCamera: true },
      { centre: { x: 0.1, y: 0.5 }, facesCamera: true },
      { centre: { x: 0.6, y: 0.6 }, facesCamera: false },
    ], defaultDetectionZone)).toEqual({
      observedAtMs: 100,
      attendingPeople: 1,
      presencePeople: 2,
    })
  })
})

describe('isInsideDetectionZone', () => {
  it('includes the calibrated boundary so a person does not flicker out at its edge', () => {
    expect(isInsideDetectionZone({ x: 0.2, y: 0.15 }, defaultDetectionZone)).toBe(true)
    expect(isInsideDetectionZone({ x: 0.8, y: 0.85 }, defaultDetectionZone)).toBe(true)
  })
})
