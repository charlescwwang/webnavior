import type { InferOutput } from 'valibot'

import { array, maxLength, minLength, number, optional, picklist, pipe, strictObject, string } from 'valibot'

/** Fresh browser evidence for customer presentation, never purchase authority. */
export const productPresentationSchema = strictObject({
  products: pipe(array(strictObject({ ref: pipe(string(), minLength(1)), name: pipe(string(), minLength(1)), price: optional(number()) })), maxLength(10)),
  cue: picklist(['shown', 'target-unavailable', 'cancelled', 'cleared']),
  durationMs: optional(number()),
  stage: optional(picklist(['information', 'acting', 'completed'])),
})

export type ProductPresentation = InferOutput<typeof productPresentationSchema>

/** Original Menu movement policy, shared with the isolated PB renderer. */
export const agentCursorTiming = {
  dwellMs: 520,
  maximumTravelMs: 1150,
  minimumTravelMs: 650,
  pressMs: 180,
  scrollSettleMs: 420,
  speedPixelsPerSecond: 720,
} as const
