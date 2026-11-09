import type { InferOutput } from 'valibot'

import { array, boolean, check, integer, literal, maxLength, maxValue, minLength, minValue, number, object, optional, picklist, pipe, safeParse, strictObject, string, variant } from 'valibot'

import { orderingMessages } from '../../i18n/src/orderingMessages'

/** Shared customer-response policy for Main execution and reply repair. */
export const serviceResponseInstruction = '你是智慧點餐助手，以菜單查詢、餐點選擇、點餐與訂單調整的服務職責為準，不因模型會回答就延伸到一般知識、計算、推測或建議。說明餐點只使用店家提供的事實與銷售單位；顧客詢問如何換算、拆分或推導購買數量時，回到菜單標示的份量與點餐單位，不代算或擅自填入份數。這不影響依顧客明確指定的合法份數加改餐，或依系統回執說明購物車數量與金額；訂單計算仍由原系統負責。服務範圍外的問題簡短、自然地說明點餐助手可提供的協助，並引導回菜單、選餐或點餐，不用「資訊不足」「資料不足」評價問題，不按領域新增拒絕規則。不得使用「目前沒有」「暫時不支援」「還沒有」等暗示未來能力的措辭，不捏造資訊或擅自建議詢問店員。點餐服務內尚無法確認的店家事實仍須如實說明無法確認，不把未知當成職責外或聽不懂；必要的缺份數、規格、指涉與操作同意仍沿用既有確認流程。要求只能部分滿足時保留未完成部分並確認意願，不自行替代、略過或送出訂單。飲食安全不推測，沿用既有工作人員協助流程。'

/** Price copy shared by menu displays and spoken ordering receipts; no currency symbols. */
export function formatOrderingPrice(amount: number): string {
  return `${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(amount)}元`
}

/** Normalizes price tokens only in assistant presentation/TTS, preserving source evidence. */
export function normalizeOrderingPrices(text: string): string {
  return text.replace(/(?:NTD|TWD|NT(?:\s{0,4}[$＄])?|[$＄])\s{0,4}(\d+(?:,\d{3})*(?:\.\d+)?)(?:\s{0,4}元)?/giu, '$1元')
}

/** Preserves merchant portion details and states the current base price once. */
export function describeOrderingDetails(price: number, description = ''): string {
  const details = normalizeOrderingPrices(description.trim())
  // Descriptions can already list this price. Compare complete numeric tokens,
  // so 180元 cannot accidentally suppress a separate 80元 base price.
  const includesBasePrice = [...details.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*元/gu)].some(match => Number(match[1]!.replaceAll(',', '')) === price)
  const sentence = details ? `${details}${details.endsWith('。') ? '' : '。'}` : ''
  return includesBasePrice ? sentence : `${sentence}單份基本售價 ${formatOrderingPrice(price)}。`
}

const id = pipe(string(), minLength(1), maxLength(200))
const label = pipe(string(), maxLength(500))
const revision = pipe(number(), integer(), minValue(0))

/** Domain-owner versions carried unchanged through Menu, Host and decision HTTP requests. */
export const decisionRevisionsSchema = object({
  menu: optional(revision),
  cart: revision,
  selectedItem: revision,
  checkout: revision,
  recommendation: optional(revision),
  seating: optional(revision),
})

/** Versions issued by state owners; absent optional owners cannot authorize their effects. */
export type DecisionRevisions = InferOutput<typeof decisionRevisionsSchema>
/** Menu policy shared with tool contracts; not a provider confidence threshold. */
export const orderQuantityMaximum = 20

/** Clarifies an omitted target without deciding whether to change or add servings. */
export const quantityChangeQuestion = orderingMessages['zh-Hant'].quantityChangeQuestion
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

/** Verified merchant information; executable checkout options are not merchant promises. */
export const merchantFactsSchema = object({
  id,
  operatorName: optional(label),
  paymentPolicy: picklist(['cashless', 'unknown']),
  paymentMethods: optional(pipe(array(object({ id, label })), maxLength(20))),
  deliverySupported: optional(boolean()),
  orderTiming: optional(picklist(['made-to-order', 'unknown'])),
})
export type MerchantFacts = InferOutput<typeof merchantFactsSchema>

/** Display guidance never creates an answer ticket or authorizes an operation. */
export const customerReplySchema = object({
  facts: pipe(string(), maxLength(8000)),
  nextQuestion: optional(pipe(string(), maxLength(2000))),
  pricedItemIds: optional(pipe(array(id), maxLength(200))),
  /** Same query and constraints replace earlier reads; different queries remain independent. */
  queryKey: optional(pipe(string(), maxLength(8000))),
})
export type CustomerReply = InferOutput<typeof customerReplySchema>

/** Joins receipt-owned facts with exactly one display question; the validated question wins. */
export function renderCustomerReply(reply: CustomerReply, question?: ConversationQuestion): string {
  return [reply.facts, question?.question ?? reply.nextQuestion].filter(Boolean).join(' ')
}

/** One catalog-owned option selection shared by drafts and cart snapshots. */
export const conversationOptionSchema = object({ groupId: id, valueId: id })

/** Application resolution is preserved independently from the model's intent confidence. */
export const handoffSchema = object({
  intent: pipe(string(), maxLength(80)),
  /** Literal original food subjects qualified for a pure addition or a menu lookup. */
  subjects: optional(pipe(array(label), maxLength(20))),
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
  // Answer-ticket deadline in this snapshot; the displayed question remains
  // current until its owner changes identity/state, irrespective of silence.
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
  merchant: optional(merchantFactsSchema),
  serviceMode: optional(picklist(['kiosk', 'table-service'])),
  serviceTable: optional(object({ id, label })),
  contextId: id,
  capturedAt: number(),
  taskId: optional(id),
  sourceUtterance: optional(pipe(string(), maxLength(8000))),
  /** Host-presented assistance invitation; it never authorizes order operations. */
  staffAssistance: optional(object({ questionId: id, expiresAt: number() })),
  /** Confirmation of a special request grants only a staff-assistance offer. */
  orderAssistance: optional(object({ questionId: id, expiresAt: number() })),
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
  revisions: object({ ...decisionRevisionsSchema.entries, menu: revision }),
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
      optionGroups: pipe(array(object({ id, label, required: boolean(), values: pipe(array(object({ id, label, priceDelta: number() })), maxLength(200)) })), maxLength(40)),
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
  deliverySupported: optional(boolean()),
  orderTiming: optional(picklist(['made-to-order', 'unknown'])),
  fulfillmentModes: pipe(array(object({ id, label })), maxLength(20)),
  waitingFor: optional(conversationQuestionSchema),
  retainedRequests: pipe(array(conversationRequestSchema), maxLength(20)),
  intentRecovery: optional(intentRecoverySchema),
  allowedToolNames: pipe(array(id), maxLength(100)),
}), check(value => (value.entryComplete || !value.catalog) && (!value.catalog || value.catalog.itemCount === value.catalog.items.length) && new TextEncoder().encode(JSON.stringify(value)).byteLength <= 256 * 1024, 'CONTEXT_UNAVAILABLE: incomplete or oversized conversation context'))

export type ConversationContext = InferOutput<typeof conversationContextSchema>
export type ConversationHandoff = InferOutput<typeof handoffSchema>

/** Quotes a short original request; long requests keep their full text in the dialogue. */
export function orderAssistanceQuestion(sourceUtterance: string): string {
  const request = sourceUtterance.trim()
  return request && request.length <= 140
    ? orderingMessages['zh-Hant'].specialOrderConfirm.replace('{request}', request)
    : orderingMessages['zh-Hant'].specialOrderLongConfirm
}

/** A model may select a factual reply, but cannot supply operation-success prose. */
export const contextReplySchema = pipe(strictObject({
  kind: picklist(['payment-methods', 'fulfillment-modes', 'menu-information', 'quantity-limit', 'clarification', 'greeting', 'acknowledgement', 'hearing-check', 'service-information', 'staff-assistance']),
  topic: optional(picklist(['identity', 'operator', 'capabilities', 'out-of-scope', 'location', 'hours', 'other', 'menu-kind', 'ordering-units', 'delivery', 'order-timing', 'promotions'])),
  subjects: optional(pipe(array(pipe(string(), minLength(1), maxLength(120))), minLength(1), maxLength(5))),
  action: optional(picklist(['confirm-order', 'offer', 'accept', 'decline'])),
}), check(value => value.topic !== 'ordering-units' || (value.kind === 'service-information' && Boolean(value.subjects?.length)), 'Ordering units requires original menu subjects.'), check(value => value.kind === 'staff-assistance' ? value.action !== undefined && value.topic === undefined && value.subjects === undefined : value.action === undefined, 'Assistance selection requires its own action.'), check(value => value.kind !== 'clarification' || value.topic === undefined || value.topic === 'menu-kind', 'Clarification asks for unclear meaning; missing service data uses service-information/topic:other.'))

/** Validated non-operation outcome; customer facts are rendered from fresh context. */
export type ContextReply = InferOutput<typeof contextReplySchema>

/** A missing-data reply reports unavailable evidence, never a menu result or completed action. */
export function isMissingInformationReply(reply: ContextReply | undefined): boolean {
  return reply?.kind === 'service-information' && ['other', 'promotions'].includes(reply.topic ?? '')
}

/** Service boundaries and catalog unit facts never claim a browser read or order effect. */
export function isServiceLimitationReply(reply: ContextReply | undefined): boolean {
  return (reply?.kind === 'staff-assistance' && ['confirm-order', 'offer'].includes(reply.action ?? '')) || isMissingInformationReply(reply) || (reply?.kind === 'service-information' && ['out-of-scope', 'ordering-units'].includes(reply.topic ?? ''))
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
export function replyFromContext(answer: string | undefined, context: ConversationContext): (ContextReply & { content: string }) | undefined {
  let value: unknown
  try {
    value = JSON.parse(answer ?? '')
  }
  catch { return undefined }
  const selection = safeParse(contextReplySchema, value)
  if (!selection.success)
    return undefined
  const kind = selection.output.kind
  const currentQuestion = context.waitingFor
  const guide = (facts: string, next: string = orderingMessages['zh-Hant'].nextOrderQuestion) => {
    if (currentQuestion)
      return `${facts}${currentQuestion.question}`.trim()
    if (!['ordering', 'configuration', 'clarification', 'meal_confirmation'].includes(context.phase))
      return facts
    return `${facts}${next}`.trim()
  }
  if (selection.output.kind === 'greeting' || selection.output.kind === 'acknowledgement') {
    const phrases = selection.output.kind === 'greeting' ? orderingMessages['zh-Hant'].greetings : orderingMessages['zh-Hant'].acknowledgements
    // Re-rendering the same turn must not change its displayed/spoken receipt.
    const index = Array.from(context.contextId).reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0) % phrases.length
    return { kind, content: kind === 'acknowledgement' && currentQuestion ? guide('好的。') : phrases[index] }
  }
  if (selection.output.kind === 'hearing-check')
    return { kind, content: guide('有收到您的這句話。') }
  if (kind === 'quantity-limit')
    return context.entryComplete && context.quantityPolicy ? { kind, content: context.quantityPolicy.message } : undefined
  if (selection.output.kind === 'clarification') {
    // Generic meaning uncertainty must not revive a pending purchase question.
    const content = selection.output.topic === 'menu-kind'
      ? orderingMessages['zh-Hant'].queryActions.unsupportedKind
      : '您想查詢哪道餐點，或調整哪項訂單內容？'
    return { kind, content }
  }
  if (selection.output.kind === 'payment-methods') {
    const merchant = context.merchant
    const methods = merchant?.paymentMethods
    const facts = methods?.length
      ? `目前支援${methods.map(method => method.label).join('、')}。`
      : merchant?.paymentPolicy === 'cashless' ? orderingMessages['zh-Hant'].cashlessPayment : orderingMessages['zh-Hant'].paymentInformationUnknown
    return { kind, content: guide(facts) }
  }
  if (selection.output.kind === 'fulfillment-modes')
    return { kind, content: guide(context.fulfillmentModes.length ? `目前提供${context.fulfillmentModes.map(mode => mode.label).join('、')}。` : '取餐方式需要服務人員確認。') }
  if (selection.output.kind === 'staff-assistance') {
    const orderConfirmed = Boolean(context.orderAssistance)
    const staffInvited = Boolean(context.staffAssistance)
    if (selection.output.action === 'confirm-order') {
      return context.entryComplete && context.sourceUtterance && !orderConfirmed && !staffInvited
        ? { kind, action: 'confirm-order' as const, content: orderAssistanceQuestion(context.sourceUtterance) }
        : undefined
    }
    if (selection.output.action === 'offer') {
      if (orderConfirmed)
        return { kind, action: 'offer' as const, content: orderingMessages['zh-Hant'].specialOrderLimits }
      return context.unavailableConditions?.length ? { kind, action: 'offer' as const, content: assistanceQuestion(context.unavailableConditions) } : undefined
    }
    if (selection.output.action === 'decline' && orderConfirmed)
      return { kind, action: 'decline' as const, content: '好的，接下來想點什麼餐點？' }
    if (!staffInvited)
      return undefined
    if (selection.output.action === 'decline' && context.unavailableConditions?.some(condition => ['sodium', 'sugar', 'energy', 'fat', 'protein'].includes(condition.id)))
      return { kind: 'clarification', content: orderingMessages['zh-Hant'].nutritionDeclined }
    // This is the operator-requested simulated presentation, not a delivery receipt.
    return { kind, action: selection.output.action, content: selection.output.action === 'accept' ? guide(orderingMessages['zh-Hant'].staffNotification) : '好的，接下來想點什麼餐點？' }
  }
  const unitInformation = selection.output.kind === 'service-information' && selection.output.topic === 'ordering-units'
  if (selection.output.kind === 'service-information' && !unitInformation) {
    // Menu owns commerce facts, not store location/hours. Without a published
    // source those facts are explicitly unavailable, never inferred from persona.
    const topic = selection.output.topic
    if (topic === 'operator') {
      return context.merchant?.operatorName
        ? { kind, content: guide(`本機點餐服務的營運業者是${context.merchant.operatorName}。`, '您想查詢哪道餐點？') }
        : { kind: 'staff-assistance', action: 'offer', content: orderingMessages['zh-Hant'].operatorInformationUnknown }
    }
    if (topic === 'identity')
      return { kind, content: guide('我是這台機台的點餐助手，可以幫您查菜單和點餐。', '您想吃什麼？') }
    if (topic === 'capabilities')
      return { kind, content: guide(orderingMessages['zh-Hant'].orderingGuide, '您想先點哪道餐點？') }
    if (topic === 'delivery')
      return { kind, topic, content: context.merchant?.deliverySupported === false ? orderingMessages['zh-Hant'].noDelivery : '外送安排需要服務人員確認。要繼續現場點餐嗎？' }
    if (topic === 'order-timing')
      return { kind, topic, content: context.merchant?.orderTiming === 'made-to-order' ? orderingMessages['zh-Hant'].madeToOrderOnly : '預約安排需要服務人員確認。想現在點餐嗎？' }
    if (topic === 'out-of-scope')
      return { kind, topic: 'out-of-scope' as const, content: '我是點餐助手，可以幫您看菜單、選餐和確認訂單。您想吃什麼？' }
    if (topic === 'promotions')
      return { kind: 'staff-assistance', action: 'offer', content: orderingMessages['zh-Hant'].promotionAssistance }
    if (topic === 'location' || topic === 'hours')
      return { kind: 'staff-assistance', action: 'offer', content: '這項店家資訊需要服務人員確認，需要幫您呼叫嗎？' }
    return { kind, topic: 'other' as const, content: '我可以協助查菜單、選餐和調整訂單，您想先查詢什麼餐點？' }
  }
  if (!context.entryComplete || !context.catalog?.complete || !selection.output.subjects?.length)
    return undefined
  const normalize = (text: string) => text.normalize('NFKC').trim().toLocaleLowerCase()
  const content = selection.output.subjects.map((subject) => {
    const name = normalize(subject)
    const items = context.catalog!.items.filter(item => [item.name, item.category, ...item.aliases].some(label => normalize(label) === name))
    // Absence applies only to this exact product or merchant alias in the
    // complete catalog; it does not authorize a substitute or exclude a category.
    if (!items.length)
      return `目前沒有提供「${subject}」。`
    return items.map((item) => {
      const availability = item.availability === 'sold-out' ? '目前售完。' : item.availability === 'available' ? '' : '可供狀態需確認。'
      return `${item.name}，${unitInformation ? item.description || '份量請依菜單標示。' : describeOrderingDetails(item.price, item.description === item.name ? '' : item.description)}${availability}`
    }).join(' ')
  }).join(' ')
  // Catalog-only prose owns no Menu question ticket. Keep its follow-up open;
  // a concrete quantity prompt is issued by the displayed Menu receipt instead.
  const nextQuestion = '您想查詢哪道餐點？'
  return unitInformation ? { kind, topic: 'ordering-units', content: guide(`${content} 請依菜單標示的單位點餐，不代為換算。`, nextQuestion) } : { kind, content: guide(content, nextQuestion) }
}

/** Shared invitation wording; showing it never constitutes a staff-delivery receipt. */
export function assistanceQuestion(conditions: ConversationContext['unavailableConditions']) {
  // A single food-safety topic needs a direct evidence limitation; mixed
  // requirements continue through the existing combined assistance policy.
  if (conditions?.length && conditions.every(condition => condition.id === 'food-safety'))
    return orderingMessages['zh-Hant'].foodSafetyUnavailable
  const nutrition = conditions?.some(condition => ['sodium', 'sugar', 'energy', 'fat', 'protein'].includes(condition.id))
  return nutrition ? orderingMessages['zh-Hant'].nutritionUnavailable : orderingMessages['zh-Hant'].conditionAssistance
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
  /** Finite validation category; never raw provider text or customer-facing copy. */
  validationFailure?: 'response-shape' | 'tool-selection' | 'arguments-json' | 'unexpected-question' | 'argument-fields'
  contextKey?: string
  rounds?: Array<{ stage: 'adjudication' | 'review', durationMs: number, requestBytes: number, inputTokens?: number }>
}

/** Host-owned, read-only understanding cue, separate from Menu operation questions. */
export const serviceClarificationSchema = object({
  /** Distinguishes ordinary assistance consent from an unclear ordering request. */
  purpose: optional(picklist(['staff-assistance', 'order-assistance'])),
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
export function serviceContextKey(state: { phase: string, menuRevision?: number, revisions?: DecisionRevisions, waitingFor?: { questionId: string, expiresAt: number } }, _now = Date.now()): string {
  const question = state.waitingFor?.questionId ?? null
  // A displayed recommendation or seating update can change what a short
  // answer refers to without editing the cart. Both invalidate old recovery.
  return JSON.stringify([state.phase, state.menuRevision ?? state.revisions?.menu ?? null, state.revisions?.cart ?? null, state.revisions?.checkout ?? null, state.revisions?.selectedItem ?? null, state.revisions?.recommendation ?? null, state.revisions?.seating ?? null, question])
}
