import type { InferOutput } from 'valibot'

import { array, boolean, integer, maxLength, maxValue, minLength, minValue, number, object, omit, optional, picklist, pipe, string } from 'valibot'

/** Vendor-observed labels used for speech understanding, without executable identity. */
export const cartLineLabelSchema = object({
  name: pipe(string(), minLength(1), maxLength(500)),
  quantity: number(),
  description: optional(pipe(string(), maxLength(2_000))),
  /** Readable website option summary for public cart targeting, never a fingerprint. */
  configuration: optional(pipe(string(), maxLength(2_000))),
  note: optional(pipe(string(), maxLength(200))),
  /** Observed quantities apply to each serving, not the whole cart row. */
  options: optional(pipe(array(object({ name: pipe(string(), minLength(1), maxLength(500)), quantity: pipe(number(), integer(), minValue(1), maxValue(100)) })), maxLength(100))),
})

/** Current-cart labels help interpret speech; they are not proof or executable targets. */
export const cartSnapshotSchema = object({
  version: pipe(string(), minLength(1), maxLength(120)),
  lines: pipe(array(omit(cartLineLabelSchema, ['configuration'])), maxLength(2_000)),
})

const servingSchema = object({
  productName: pipe(string(), minLength(1), maxLength(500)),
  variantName: pipe(string(), maxLength(500)),
  options: pipe(array(object({ name: pipe(string(), minLength(1), maxLength(500)), quantity: number() })), maxLength(100)),
})

/** Read-only semantic evidence; opaque Host correlations are not write authority or model tools. */
export const browserEffectSchema = object({
  /** Exact current customer turn for admission; previous answers belong in storeFacts. */
  transcript: pipe(string(), minLength(1), maxLength(8_000)),
  action: picklist(['add', 'quantity', 'remove', 'replace']),
  description: pipe(string(), minLength(1), maxLength(4_000)),
  note: optional(pipe(string(), maxLength(200)), ''),
  /** Includes verified configuration labels/notes; do not truncate them into a different serving. */
  completedEffects: optional(pipe(array(pipe(string(), maxLength(4_000))), maxLength(16)), []),
  /** Opaque Host identity for product, variant and per-serving choices; never sent to the model. */
  servingKey: optional(pipe(string(), minLength(1), maxLength(8_000))),
  /** This turn's verified additions only; not the initial cart or a model's claimed completion. */
  completedAdditions: optional(pipe(array(object({
    servingKey: pipe(string(), minLength(1), maxLength(8_000)),
    note: pipe(string(), maxLength(200)),
    quantity: pipe(number(), integer(), minValue(1), maxValue(99)),
  })), maxLength(16))),
  storeFacts: optional(pipe(string(), maxLength(4_000)), ''),
  /** Fresh Host read; absence is unknown, never proof that the cart is empty. */
  cartContext: optional(cartSnapshotSchema),
  /** Proposed per-serving labels; meal count and total option counts stay hidden from extraction. */
  serving: optional(servingSchema),
  /** Explicit current-cart source for an additional meal with the same customization. */
  copySource: optional(cartLineLabelSchema),
  /** Other rows are the same verified product; configuration identity is Host-derived. */
  cartTarget: optional(object({
    selected: cartLineLabelSchema,
    /** Omitted for a single row; multiple rows must be one Host-verified configuration. */
    groupSize: optional(pipe(number(), integer(), minValue(1), maxValue(2_000))),
    others: pipe(array(object({ ...cartLineLabelSchema.entries, sameConfiguration: boolean() })), maxLength(2_000)),
  })),
  deltas: optional(pipe(array(object({ name: pipe(string(), maxLength(200)), kind: picklist(['product', 'option', 'cart_line']), mode: picklist(['increase', 'set', 'remove']), quantity: number() })), maxLength(100)), []),
})

export type BrowserEffect = InferOutput<typeof browserEffectSchema>
/** Deterministic claim result for an operation already selected by a recorded model decision. */
export interface EffectDecision {
  choice: 'ALLOW' | 'CLARIFY'
  provider: 'system-one' | 'main' | 'unavailable'
  /** Set only after matching and consuming a Server-recorded model operation; never a Host assertion. */
  admission?: 'issued-plan'
  checks?: { stage: 'effect', choice: 'ALLOW', provider: EffectDecision['provider'], reason: string }[]
}

/** Short answers select an issued effect ID; they never carry executable parameters. */
export const browserAnswerSchema = object({
  /** Routing only, never purchase authority. Omission belongs to the Main flow. */
  decisionSource: optional(picklist(['main', 'system-one'])),
  transcript: pipe(string(), minLength(1), maxLength(8_000)),
  questionId: pipe(string(), minLength(1), maxLength(120)),
  /** Omission means unknown cart context, never an assertion that the cart is empty. */
  cartContext: optional(cartSnapshotSchema),
})
export type BrowserAnswer = InferOutput<typeof browserAnswerSchema>
export interface AnswerDecision {
  kind: 'ANSWER' | 'NEW_REQUEST' | 'UNCERTAIN'
  choiceId?: string
  provider: EffectDecision['provider']
  checks?: { stage: 'relation' | 'selection', choice: string, provider: EffectDecision['provider'], reason: string, model?: string }[]
}

/** Finite cart writes eligible for server-owned plan admission. */
export const browserWriteToolNameSchema = picklist(['browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace'])

/** Executable proposal must match an already issued semantic plan, never a client ALLOW flag. */
export const browserPlanSchema = object({
  effect: browserEffectSchema,
  source: picklist(['main', 'system-one']),
  toolName: browserWriteToolNameSchema,
  arguments: pipe(string(), minLength(2), maxLength(8_000)),
})
export type BrowserPlan = InferOutput<typeof browserPlanSchema>
