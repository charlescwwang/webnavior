import type { InferOutput } from 'valibot'

import { array, boolean, check, integer, literal, maxLength, maxValue, minLength, minValue, number, object, optional, picklist, pipe, string } from 'valibot'

const id = pipe(string(), minLength(1), maxLength(200))
const label = pipe(string(), maxLength(500))
const revision = pipe(number(), integer(), minValue(0))
const quantity = pipe(number(), integer(), minValue(0), maxValue(20))
const option = object({ groupId: id, valueId: id })

/** Application resolution is preserved independently from the model's intent confidence. */
export const handoffSchema = object({
  intent: pipe(string(), maxLength(80)),
  status: picklist(['resolved', 'ambiguous', 'unmatched', 'target-absent', 'unavailable', 'stale', 'unrepresentable']),
  itemIds: pipe(array(id), maxLength(200)),
  lineIds: pipe(array(id), maxLength(200)),
})

/** One current question, never a historical instruction or payment authorization. */
export const conversationQuestionSchema = object({
  questionId: id,
  purpose: pipe(string(), maxLength(80)),
  question: pipe(string(), maxLength(2000)),
  expiresAt: number(),
  choices: pipe(array(object({ id, description: label })), maxLength(253)),
})

/** Complete product coverage with explicit fields; images and vendor metadata are excluded. */
export const conversationContextSchema = pipe(object({
  contextId: id,
  capturedAt: number(),
  taskId: optional(id),
  sourceUtterance: optional(pipe(string(), maxLength(8000))),
  handoff: optional(handoffSchema),
  entryComplete: boolean(),
  readOnly: boolean(),
  constraints: object({ excludeIngredients: pipe(array(id), maxLength(100)), includeIngredients: pipe(array(id), maxLength(100)), dietary: optional(literal('vegetarian')), minPrice: optional(number()), maxPrice: optional(number()), minPriceExclusive: optional(boolean()), maxPriceExclusive: optional(boolean()), priceOrder: optional(literal('ASC')) }),
  phase: pipe(string(), maxLength(80)),
  screen: optional(pipe(string(), maxLength(80))),
  revisions: object({ menu: revision, cart: revision, selectedItem: revision, checkout: revision, recommendation: optional(revision), seating: optional(revision) }),
  catalog: optional(object({
    complete: literal(true),
    itemCount: pipe(number(), integer(), minValue(0), maxValue(200)),
    items: pipe(array(object({
      id,
      name: label,
      aliases: pipe(array(label), maxLength(40)),
      category: label,
      price: pipe(number(), minValue(0)),
      description: optional(pipe(string(), maxLength(120))),
      availability: picklist(['available', 'sold-out', 'selection-failure', 'unknown']),
      optionGroups: pipe(array(object({ id, label, required: boolean(), values: pipe(array(object({ id, label, priceDelta: number() })), maxLength(100)) })), maxLength(40)),
      composition: optional(object({ ingredients: pipe(array(id), maxLength(100)), complete: boolean(), dietary: optional(pipe(array(label), maxLength(20))) })),
    })), maxLength(200)),
  })),
  cart: object({
    itemCount: pipe(number(), integer(), minValue(0)),
    total: pipe(number(), minValue(0)),
    fulfillmentMode: optional(picklist(['dine-in', 'takeout'])),
    lines: pipe(array(object({ id, itemId: id, name: label, quantity, unitPrice: number(), options: pipe(array(option), maxLength(40)) })), maxLength(200)),
  }),
  selection: optional(object({ itemId: id, quantity, options: pipe(array(option), maxLength(40)) })),
  paymentState: pipe(string(), maxLength(80)),
  checkout: optional(object({ stage: pipe(string(), maxLength(80)), invoiceMethod: optional(pipe(string(), maxLength(80))), taxId: optional(pipe(string(), maxLength(8))), carrierRegistered: boolean(), citizenRegistered: boolean() })),
  seating: optional(object({ partySize: optional(quantity), ready: boolean(), revision })),
  allowedPaymentMethods: pipe(array(id), maxLength(20)),
  fulfillmentModes: pipe(array(object({ id, label })), maxLength(20)),
  waitingFor: optional(conversationQuestionSchema),
  retainedRequests: pipe(array(object({ id, itemId: id, status: picklist(['active', 'suspended']) })), maxLength(20)),
  allowedToolNames: pipe(array(id), maxLength(100)),
}), check(value => (value.entryComplete || !value.catalog) && (!value.catalog || value.catalog.itemCount === value.catalog.items.length) && new TextEncoder().encode(JSON.stringify(value)).byteLength <= 256 * 1024, 'CONTEXT_UNAVAILABLE: incomplete or oversized conversation context'))

export type ConversationContext = InferOutput<typeof conversationContextSchema>
export type ConversationHandoff = InferOutput<typeof handoffSchema>

/** Result ownership is task-scoped; absence is a current-cart outcome, not a deletion receipt. */
export interface ConversationOutcome {
  status: 'completed' | 'already-absent' | 'needs-confirmation' | 'partial' | 'rejected' | 'uncertain'
  intent: string
  itemIds: string[]
  lineIds?: string[]
  taskId?: string
}

/** Shared stage/turn ceilings; progress transport never starts a fresh turn budget. */
export const serviceRecoveryLimits = { adjudicationMs: 8000, reviewMs: 12000, turnMs: 60_000, checkpointMs: 15_000, progressEvents: 4 } as const

/** Model service admission is evidence, never an operation ticket. */
export interface ServiceRecovery {
  status: 'eligible' | 'completed' | 'failed'
  recoveryId?: string
  utteranceId?: number
  stage?: 'adjudication' | 'review'
  admission?: 'service' | 'background' | 'uncertain'
  disposition?: 'assistant' | 'clarify' | 'ignore' | 'abstain'
  readOnly?: boolean
  failure?: 'invalid' | 'provider-error' | 'timeout' | 'cancelled' | 'unavailable'
  contextKey?: string
  rounds?: Array<{ stage: 'adjudication' | 'review', durationMs: number, requestBytes: number, inputTokens?: number }>
}

/** Host-owned, read-only understanding cue, separate from Menu operation questions. */
export const serviceClarificationSchema = object({
  questionId: id,
  question: pipe(string(), minLength(1), maxLength(200)),
  sourceUtterance: pipe(string(), maxLength(8000)),
  contextKey: pipe(string(), maxLength(1000)),
  expiresAt: number(),
})
export type ServiceClarification = InferOutput<typeof serviceClarificationSchema>

/** Started is emitted before the provider is invoked; it does not admit speech. */
export interface ServiceRecoveryProgress {
  kind: 'SERVICE_RECOVERY_PROGRESS'
  stage: 'adjudication' | 'review'
  status: 'started' | 'completed'
  /** Absolute recovery deadline; checkpoint waits share this budget. */
  deadlineAt?: number
  admission?: 'service' | 'background' | 'uncertain'
  durationMs?: number
  continuationId: string
  expiresAt: number
}

/** Correlation uses domain versions and the live question, never a transcript guess. */
export function serviceContextKey(state: { phase: string, menuRevision?: number, revisions?: { menu?: number, cart: number, checkout: number, selectedItem: number }, waitingFor?: { questionId: string, expiresAt: number } }, now = Date.now()): string {
  const question = state.waitingFor && state.waitingFor.expiresAt > now ? state.waitingFor.questionId : null
  return JSON.stringify([state.phase, state.menuRevision ?? state.revisions?.menu ?? null, state.revisions?.cart ?? null, state.revisions?.checkout ?? null, state.revisions?.selectedItem ?? null, question])
}
