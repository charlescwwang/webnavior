import type { InferOutput } from 'valibot'

import { array, boolean, check, integer, literal, maxLength, maxValue, minLength, minValue, number, object, optional, picklist, pipe, safeParse, strictObject, string } from 'valibot'

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
  /** Current rendered menu scope, separate from the complete catalog and cart. */
  presentation: optional(object({ itemIds: pipe(array(id), maxLength(200)), category: pipe(string(), maxLength(200)), queries: pipe(array(label), maxLength(20)) })),
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
  /** Offered methods; unlike allowedPaymentMethods, this does not grant phase-specific execution. */
  paymentMethods: optional(pipe(array(object({ id, label })), maxLength(20))),
  fulfillmentModes: pipe(array(object({ id, label })), maxLength(20)),
  waitingFor: optional(conversationQuestionSchema),
  retainedRequests: pipe(array(object({ id, itemId: id, status: picklist(['active', 'suspended']) })), maxLength(20)),
  allowedToolNames: pipe(array(id), maxLength(100)),
}), check(value => (value.entryComplete || !value.catalog) && (!value.catalog || value.catalog.itemCount === value.catalog.items.length) && new TextEncoder().encode(JSON.stringify(value)).byteLength <= 256 * 1024, 'CONTEXT_UNAVAILABLE: incomplete or oversized conversation context'))

export type ConversationContext = InferOutput<typeof conversationContextSchema>
export type ConversationHandoff = InferOutput<typeof handoffSchema>

/** A model may select a factual reply, but cannot supply operation-success prose. */
export const contextReplySchema = strictObject({
  kind: picklist(['payment-methods', 'fulfillment-modes', 'menu-information', 'clarification']),
  subjects: optional(pipe(array(pipe(string(), minLength(1), maxLength(120))), minLength(1), maxLength(5))),
})

/**
 * Renders an information/clarification selection from fresh service-owned facts.
 * It grants no operation authority and never treats a snapshot as a write receipt.
 */
export function replyFromContext(answer: string | undefined, context: ConversationContext) {
  let value: unknown
  try {
    value = JSON.parse(answer ?? '')
  }
  catch { return undefined }
  const selection = safeParse(contextReplySchema, value)
  if (!selection.success)
    return undefined
  const kind = selection.output.kind
  if (selection.output.kind === 'clarification') {
    const content = context.waitingFor && context.waitingFor.expiresAt > Date.now()
      ? context.waitingFor.question
      : '請再說明你想查詢或調整的內容。'
    return { kind, content }
  }
  if (selection.output.kind === 'payment-methods') {
    const methods = context.paymentMethods
    return { kind, content: methods?.length ? `目前支援${methods.map(method => method.label).join('、')}。` : '目前沒有可確認的付款方式，請查看付款畫面或詢問服務人員。' }
  }
  if (selection.output.kind === 'fulfillment-modes')
    return { kind, content: context.fulfillmentModes.length ? `目前提供${context.fulfillmentModes.map(mode => mode.label).join('、')}。` : '目前沒有可確認的取餐方式，請詢問服務人員。' }
  if (!context.entryComplete || !context.catalog?.complete || !selection.output.subjects?.length)
    return undefined
  const normalize = (text: string) => text.normalize('NFKC').trim().toLocaleLowerCase()
  const content = selection.output.subjects.map((subject) => {
    const name = normalize(subject)
    const items = context.catalog!.items.filter(item => [item.name, item.category, ...item.aliases].some(label => normalize(label) === name))
    // Literal coverage does not establish semantic absence or authorize a
    // substitute. Keep the wording limited to what this complete catalog lists.
    return items.length
      ? `${items.map(item => `${item.name}，單份基本售價 NT$${item.price}${item.availability === 'sold-out' ? '，目前售完' : item.availability === 'available' ? '' : '，可供狀態需確認'}`).join('；')}。`
      : `目前菜單沒有標示「${subject}」，請問你指的是哪一道餐點？`
  }).join(' ')
  return { kind, content }
}

/**
 * Rejects bare assent as authority to choose one target from several.
 * This is a negative guard only: names, ordinals and qualified answers still
 * require the current question's normal resolution and authorization.
 */
export function isTargetAcknowledgement(transcript: string): boolean {
  return /^(?:[對是好嗯]|對啊|對呀|對的|是的|沒錯|沒錯啊|好的|好啊|嗯嗯|yes|yeah|ok|okay)[\s，。！？,.!?]*$/iu.test(transcript.trim())
}

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
