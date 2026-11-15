import type { InferOutput } from 'valibot'

import { array, boolean, maxLength, minLength, number, optional, picklist, pipe, strictObject, string } from 'valibot'

/** Default PB recommendation/selection batch; explicit information comparisons retain their own budget. */
export const browserRecommendationLimit = 3

/** Shared admission for queued/native/speech presentation; limiting happens after identity validation. */
export const browserPresentationInputSchema = strictObject({
  productRefs: pipe(array(pipe(string(), maxLength(200))), maxLength(100)),
  mode: optional(picklist(['recommendation', 'other-recommendations', 'information']), 'recommendation'),
  deferVisual: optional(boolean(), false),
  preservePage: optional(boolean(), false),
})

/** Fresh browser evidence for customer presentation, never purchase authority. */
export const productPresentationSchema = strictObject({
  products: pipe(array(strictObject({ ref: pipe(string(), minLength(1)), name: pipe(string(), minLength(1)), price: optional(number()) })), maxLength(10)),
  cue: picklist(['prepared', 'shown', 'target-unavailable', 'cancelled', 'cleared']),
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
