import type { InferOutput } from 'valibot'

import { array, boolean, check, integer, literal, maxLength, maxValue, minLength, minValue, number, object, optional, picklist, pipe, safeParse, strictObject, string, variant } from 'valibot'

/** Price copy shared by menu displays and spoken ordering receipts; no currency symbols. */
export function formatOrderingPrice(amount: number): string {
  return `${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(amount)}元`
}

/** Normalizes price tokens only in assistant presentation/TTS, preserving source evidence. */
export function normalizeOrderingPrices(text: string): string {
  return text.replace(/(?:NTD|TWD|NT(?:\s{0,4}[$＄])?|[$＄])\s{0,4}(\d+(?:,\d{3})*(?:\.\d+)?)(?:\s{0,4}元)?/giu, '$1元')
}

const id = pipe(string(), minLength(1), maxLength(200))
const label = pipe(string(), maxLength(500))
const revision = pipe(number(), integer(), minValue(0))
/** Menu policy shared with tool contracts; not a provider confidence threshold. */
export const orderQuantityMaximum = 20
const quantity = pipe(number(), integer(), minValue(0), maxValue(orderQuantityMaximum))
/** A proven business refusal before an effect, never a retryable malformed tool input. */
export const quantityLimitRejectionSchema = strictObject({
  ok: literal(false),
  executed: literal(false),
  rejection: literal('quantity-limit'),
  error: literal('QUANTITY_LIMIT'),
  toolName: id,
  maximum: literal(orderQuantityMaximum),
  requestedQuantity: pipe(number(), integer(), minValue(orderQuantityMaximum + 1)),
  customerMessage: pipe(string(), minLength(1), maxLength(2000)),
})
export type QuantityLimitRejection = InferOutput<typeof quantityLimitRejectionSchema>
/** Menu-owned validation failures issued before any effect; one correction may be requested. */
export const toolInputRejectionSchema = strictObject({
  ok: literal(false),
  executed: literal(false),
  toolName: id,
  error: picklist(['MENU_QUERY_ACTION_REQUIRED', 'INVALID_OPTION_COMBINATION', 'INVALID_TOOL_INPUT', 'UNCONFIRMED_ITEM']),
  message: pipe(string(), minLength(1), maxLength(2000)),
  customerMessage: optional(pipe(string(), minLength(1), maxLength(2000))),
})

/** One catalog-owned option selection shared by drafts and cart snapshots. */
export const conversationOptionSchema = object({ groupId: id, valueId: id })

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
  requestId: optional(id),
  purpose: pipe(string(), maxLength(80)),
  question: pipe(string(), maxLength(2000)),
  expiresAt: number(),
  choices: pipe(array(object({ id, description: label })), maxLength(253)),
})

export type ConversationQuestion = InferOutput<typeof conversationQuestionSchema>

const recoveryCandidates = pipe(array(id), minLength(1), maxLength(253), check(ids => new Set(ids).size === ids.length, 'Recovery candidates must be unique'))
/** Menu-issued interpretation scope, never an execution ticket or customer consent. */
export const intentRecoverySchema = variant('kind', [
  object({ kind: literal('request'), candidateIds: recoveryCandidates }),
  object({ kind: literal('answer'), questionId: id, requestId: optional(id), candidateIds: recoveryCandidates }),
])
export type IntentRecovery = InferOutput<typeof intentRecoverySchema>

/** Uncommitted meal progress; absent quantity means unknown, never one serving. */
export const conversationRequestSchema = pipe(object({
  id,
  itemId: id,
  status: picklist(['active', 'suspended', 'confirming']),
  sourceUtterance: optional(pipe(string(), maxLength(8000))),
  quantity: optional(pipe(number(), integer(), minValue(1), maxValue(20))),
  options: pipe(array(conversationOptionSchema), maxLength(40)),
  missing: object({ quantity: boolean(), optionGroupIds: pipe(array(id), maxLength(40)) }),
  expectedRevisions: object({ menu: optional(revision), cart: optional(revision), selectedItem: optional(revision), checkout: optional(revision), recommendation: optional(revision), seating: optional(revision) }),
}), check(value => value.missing.quantity === (value.quantity === undefined)
  && new Set(value.options.map(option => option.groupId)).size === value.options.length
  && !value.missing.optionGroupIds.some(groupId => value.options.some(option => option.groupId === groupId)), 'Draft slots and missing fields must describe the same progress'))
export type ConversationRequest = InferOutput<typeof conversationRequestSchema>

/** Complete product coverage with explicit fields; images and vendor metadata are excluded. */
export const conversationContextSchema = pipe(object({
  serviceMode: optional(picklist(['kiosk', 'table-service'])),
  serviceTable: optional(object({ id, label })),
  contextId: id,
  capturedAt: number(),
  taskId: optional(id),
  sourceUtterance: optional(pipe(string(), maxLength(8000))),
  handoff: optional(handoffSchema),
  entryComplete: boolean(),
  readOnly: boolean(),
  constraints: object({ excludeIngredients: pipe(array(id), maxLength(100)), includeIngredients: pipe(array(id), maxLength(100)), dietary: optional(literal('vegetarian')), minPrice: optional(number()), maxPrice: optional(number()), minPriceExclusive: optional(boolean()), maxPriceExclusive: optional(boolean()), priceOrder: optional(literal('ASC')) }),
  unavailableConditions: optional(pipe(array(object({ id, label })), maxLength(100))),
  quantityPolicy: optional(object({ maximum: literal(orderQuantityMaximum), mentionedCounts: optional(pipe(array(pipe(number(), integer(), minValue(0))), maxLength(100))), message: pipe(string(), minLength(1), maxLength(2000)) })),
  phase: pipe(string(), maxLength(80)),
  screen: optional(pipe(string(), maxLength(80))),
  /** Current rendered menu scope, separate from the complete catalog and cart. */
  presentation: optional(object({ itemIds: pipe(array(id), maxLength(200)), category: pipe(string(), maxLength(200)), queries: pipe(array(label), maxLength(20)) })),
  /** Saved browse conditions are not the current utterance's operation constraints. */
  queryState: optional(object({ category: label, queries: pipe(array(label), maxLength(20)), exhausted: boolean(), prices: object({ minPrice: optional(number()), maxPrice: optional(number()), minPriceExclusive: optional(boolean()), maxPriceExclusive: optional(boolean()), priceOrder: optional(literal('ASC')) }), filters: object({ excludeIngredients: pipe(array(id), maxLength(100)), includeIngredients: pipe(array(id), maxLength(100)), dietary: optional(literal('vegetarian')) }) })),
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
    lines: pipe(array(object({ id, itemId: id, name: label, quantity, unitPrice: number(), options: pipe(array(conversationOptionSchema), maxLength(40)) })), maxLength(200)),
  }),
  selection: optional(object({ itemId: id, quantity, options: pipe(array(conversationOptionSchema), maxLength(40)) })),
  paymentState: pipe(string(), maxLength(80)),
  checkout: optional(object({ stage: pipe(string(), maxLength(80)), invoiceMethod: optional(pipe(string(), maxLength(80))), taxId: optional(pipe(string(), maxLength(8))), invoiceDraftReady: optional(boolean()), carrierRegistered: boolean(), citizenRegistered: boolean() })),
  seating: optional(object({ partySize: optional(quantity), ready: boolean(), revision })),
  allowedPaymentMethods: pipe(array(id), maxLength(20)),
  /** Offered methods; unlike allowedPaymentMethods, this does not grant phase-specific execution. */
  paymentMethods: optional(pipe(array(object({ id, label })), maxLength(20))),
  fulfillmentModes: pipe(array(object({ id, label })), maxLength(20)),
  waitingFor: optional(conversationQuestionSchema),
  retainedRequests: pipe(array(conversationRequestSchema), maxLength(20)),
  intentRecovery: optional(intentRecoverySchema),
  allowedToolNames: pipe(array(id), maxLength(100)),
}), check(value => (value.entryComplete || !value.catalog) && (!value.catalog || value.catalog.itemCount === value.catalog.items.length) && new TextEncoder().encode(JSON.stringify(value)).byteLength <= 256 * 1024, 'CONTEXT_UNAVAILABLE: incomplete or oversized conversation context'))

export type ConversationContext = InferOutput<typeof conversationContextSchema>
export type ConversationHandoff = InferOutput<typeof handoffSchema>

/** A model may select a factual reply, but cannot supply operation-success prose. */
export const contextReplySchema = pipe(strictObject({
  kind: picklist(['payment-methods', 'fulfillment-modes', 'menu-information', 'quantity-limit', 'clarification', 'greeting', 'acknowledgement', 'hearing-check', 'service-information']),
  topic: optional(picklist(['identity', 'capabilities', 'location', 'hours', 'other', 'menu-kind'])),
  subjects: optional(pipe(array(pipe(string(), minLength(1), maxLength(120))), minLength(1), maxLength(5))),
}), check(value => value.kind !== 'clarification' || value.topic === undefined || value.topic === 'menu-kind', 'Clarification asks for unclear meaning; missing service data uses service-information/topic:other.'))

/** Validated non-operation outcome; customer facts are rendered from fresh context. */
export type ContextReply = InferOutput<typeof contextReplySchema>

/** A missing-data reply reports unavailable evidence, never a menu result or completed action. */
export function isMissingInformationReply(reply: ContextReply | undefined): boolean {
  return reply?.kind === 'service-information' && reply.topic === 'other'
}

/** Shared gateway tool-call shape, without provider credentials or runtime dependencies. */
export interface ConversationToolCall {
  function: { arguments: string, name: string }
  id: string
  type: 'function'
}

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
  if (selection.output.kind === 'greeting')
    return { kind, content: '您好，需要點餐或查詢菜單嗎？也可以用台語點餐。' }
  if (selection.output.kind === 'acknowledgement')
    return { kind, content: '好的，您可以繼續告訴我想點的餐點或訂單調整。' }
  if (selection.output.kind === 'hearing-check')
    return { kind, content: '有收到您的這句話，您可以繼續說明想點的餐點或訂單調整。' }
  if (kind === 'quantity-limit')
    return context.entryComplete && context.quantityPolicy ? { kind, content: context.quantityPolicy.message } : undefined
  if (selection.output.kind === 'clarification') {
    // Generic meaning uncertainty must not revive a pending purchase question.
    const content = selection.output.topic === 'menu-kind'
      ? '目前菜單未提供可確認符合這個種類的餐點，您想改看哪一類？'
      : '剛才沒有理解清楚，請再說一次您想查詢的餐點或訂單調整。'
    return { kind, content }
  }
  if (selection.output.kind === 'payment-methods') {
    const methods = context.paymentMethods
    return { kind, content: methods?.length ? `目前支援${methods.map(method => method.label).join('、')}。` : '目前沒有可確認的付款方式，請查看付款畫面或詢問服務人員。' }
  }
  if (selection.output.kind === 'fulfillment-modes')
    return { kind, content: context.fulfillmentModes.length ? `目前提供${context.fulfillmentModes.map(mode => mode.label).join('、')}。` : '目前沒有可確認的取餐方式，請詢問服務人員。' }
  if (selection.output.kind === 'service-information') {
    // Menu owns commerce facts, not store location/hours. Without a published
    // source those facts are explicitly unavailable, never inferred from persona.
    const topic = selection.output.topic
    if (topic === 'identity')
      return { kind, content: '我是這台機台的點餐助手，可以協助您查詢餐點與操作點餐流程。' }
    if (topic === 'capabilities')
      return { kind, content: context.entryComplete ? '我主要負責查詢菜單、價格、餐點選項，以及點餐、修改與核對訂單；其他事項請洽現場店員。' : '我可以先說明點餐方式；選擇填寫手機或略過後，可以查詢菜單、點餐與核對訂單。' }
    if (topic === 'location' || topic === 'hours')
      return { kind, content: `目前服務資料未提供可確認的${topic === 'location' ? '店內位置或路線' : '營業時間'}，請詢問現場店員。` }
    return { kind, topic: 'other' as const, content: '目前沒有可確認的這項資料，請詢問現場店員；我可以協助查詢菜單、點餐與調整訂單。' }
  }
  if (!context.entryComplete || !context.catalog?.complete || !selection.output.subjects?.length)
    return undefined
  const normalize = (text: string) => text.normalize('NFKC').trim().toLocaleLowerCase()
  const content = selection.output.subjects.map((subject) => {
    const name = normalize(subject)
    const items = context.catalog!.items.filter(item => [item.name, item.category, ...item.aliases].some(label => normalize(label) === name))
    // Literal coverage does not establish semantic absence or authorize a
    // substitute. Keep the wording limited to what this complete catalog lists.
    return items.length
      ? `${items.map(item => `${item.name}，單份基本售價 ${formatOrderingPrice(item.price)}${item.availability === 'sold-out' ? '，目前售完' : item.availability === 'available' ? '' : '，可供狀態需確認'}`).join('；')}。`
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
  /** Unverified requirements retained only while answering this clarification. */
  unavailableConditions: optional(pipe(array(object({ id, label })), maxLength(20))),
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
