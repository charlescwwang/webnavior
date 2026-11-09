import type { ConversationContext, ConversationHandoff, ConversationQuestion, ConversationRequest, DecisionRevisions, IntentRecovery, ServiceClarification, ServiceRecovery, ServiceRecoveryProgress } from '@proj-airi/stage-shared/kiosk-conversation'

import type { PriceConditions, PriceEvidence } from './priceContracts'
import type { ScopeChoice } from './queryScopeContracts'

/** Hard per-utterance question ceiling; normal routes do not consume this allowance. */
export const decisionQuestionBudget = 24

/** Literal catalog matches, not inferred intent or authorization to order. */
export interface CatalogMentionEvidence {
  products: Array<{ label: string, matchedText: string, source: 'name' | 'alias' | 'fragment' }>
  categories: Array<{ label: string, matchedText: string, itemCount: number }>
}

/** Safe application-owned interaction facts shared by Jev and Agent requests. */
export interface KioskDecisionState {
  serviceMode?: 'kiosk' | 'table-service'
  /** Host response guard for a semantically admitted food query, never order authority. */
  requireMenuRead?: boolean
  /** This Agent task may read menu information, never change the order or pending question. */
  readOnly?: boolean
  /** A browser-issued, short-lived proposal; it can only create a question. */
  clarificationOffer?: { id: string, label: string }
  priceEvidence?: PriceEvidence
  catalogEvidence?: CatalogMentionEvidence
  /** Bounded catalog evidence; possible matches are not verified customer targets. */
  productResolution?: { status: 'exact' | 'possible' | 'none' | 'overflow', count: number, references: readonly { label: string, refId: string }[] }
  /** Separate unfinished user fragment; never concatenated into the current utterance. */
  incompleteSpeech?: { transcript: string, expiresAt: number, related?: boolean }
  revisions?: DecisionRevisions
  /** Application-owned catalog revision, not a vendor catalog identifier. */
  menuRevision?: number
  /** Verified receipts from this same request, not past model plans. */
  completedReads?: Array<{ toolName: string, customerMessage: string }>
  /** Ordering-service-issued domain choices, not a raw vendor POS catalog. */
  fulfillmentModes?: Array<{ id: 'dine-in' | 'takeout', label: string }>
  ingredientReferences?: readonly { id: string, label: string }[]
  dietaryReferences?: readonly { id: 'vegetarian', label: string }[]
  /** Mentioned condition topics without supporting store data; mention is not a request. */
  unavailableConditionReferences?: readonly { id: string, label: string }[]
  /** Current Menu-owned drafts; omission means no draft snapshot was supplied. */
  retainedRequests?: ConversationRequest[]
  /** Menu alone issues which finite effects Main may independently interpret. */
  intentRecovery?: IntentRecovery
  waitingFor?: PresentedQuestion
  activeRequest?: { stage: 'starting' | 'thinking' | 'tool_requested' | 'mutating', text: string }
  allowedPaymentMethods?: readonly string[]
  checkoutSnapshot?: unknown
  constraints?: { exclude: readonly string[], include?: readonly string[], dietary?: 'vegetarian', price?: PriceConditions, unresolvedPrice?: boolean }
  interactionState?: InteractionState
  paymentState?: string
  serviceClarification?: ServiceClarification
  phase: string
  references?: readonly { label: string, refId: string }[]
}

/** Safe handoff facts; completed reads do not authorize any later mutation. */
export type KioskConversationDecisionState = Pick<KioskDecisionState, 'serviceMode' | 'intentRecovery' | 'retainedRequests' | 'revisions' | 'readOnly' | 'requireMenuRead' | 'phase' | 'fulfillmentModes' | 'waitingFor' | 'allowedPaymentMethods' | 'interactionState' | 'paymentState' | 'constraints' | 'menuRevision' | 'completedReads' | 'unavailableConditionReferences' | 'incompleteSpeech' | 'priceEvidence' | 'serviceClarification'> & {
  context?: ConversationContext
  /** Preserves whole-turn semantic qualification for bounded proposal recovery. */
  requestScope?: KioskInteractionDecision['requestScope']
  /** A qualified price inquiry accompanies this operation; its answer must survive the write. */
  priceInquiry?: boolean
  handoff?: ConversationHandoff
  serviceReply?: boolean
  /** Unresolved meaning allows a typed reply, never browsing or order effects. */
  replyOnly?: boolean
}

/** A finite semantic outcome. Food slots are chosen from application-issued references. */
export type KioskInteractionDecision = {
  /** Selected application-issued interpretation; never model-authored amounts. */
  recovery?: ServiceRecovery
  /** Main skill selection is distinct from JEV scores; execution still validates the issued candidate. */
  resolvedBy?: 'main-skill' | 'main-service'
  /** Qualified whole-turn purpose; independent from admission and effect targets. */
  requestScope?: 'menu-information' | 'order-information' | 'order-operation' | 'service-information' | 'order-preservation'
  priceChoiceId?: string
  /** Correlated conversational invitation consumed by this answer, never mutation permission. */
  answeredQuestionId?: string
  /** Host invitation replaced by a verified independent request; retain its history without answer authority. */
  supersededQuestionId?: string
  trace?: unknown
  /** Actual provider invocations, independent of the number of questions per request. */
  modelCalls?: number
  /** Questions actually evaluated; one HTTP exchange can contain several forwards. */
  modelQuestions?: number
  /** Mechanical refusal cause; never a second interpretation of the utterance. */
  reason?: 'GENERAL_QUESTION' | 'MENU_QUERY' | 'PROVIDER_FAILURE' | 'SYSTEM_ONE_DISABLED' | 'CANDIDATE_BUDGET' | 'UNSUPPORTED_PRICE' | 'UNSUPPORTED_FILTER' | 'UNCERTAIN_FILTER' | 'UNRESOLVED_FILTER' | 'INVALID_CHOICE' | 'UNCERTAIN_OPERATION' | 'UNCERTAIN_RECIPIENT' | 'UNCERTAIN_GREETING' | 'UNCERTAIN_SERVICE_REQUEST' | 'NEW_REQUEST' | 'DEVIATED' | 'UNCERTAIN_REVIEW'
} & (
  | { kind: 'SCOPE_CHOICE', choice: ScopeChoice }
  | { kind: 'COMPLETE', confidence?: number }
  | { kind: 'CONTINUE_INCOMPLETE' }
  | { kind: 'CLARIFICATION', confidence?: number }
  | { kind: 'NEEDS_CLARIFICATION', confidence?: number }
  | { kind: 'FAST_ACTION', actionId: string, confidence?: number, searchInterpretation?: 'product' | 'filter', ingredientFilters?: { excludeIngredients: string[], includeIngredients: string[], dietary?: 'vegetarian' } }
  | { kind: 'INCOMPLETE', confidence?: number }
  | { kind: 'IGNORE', confidence?: number }
  | { kind: 'GREET', confidence?: number }
  | { kind: 'CUSTOMER_ENTRY_REQUIRED', confidence?: number }
  | { kind: 'FOLLOW_UP_ACTIVE', confidence?: number }
  | { kind: 'NEEDS_ASSISTANT', confidence?: number, handoff?: ConversationHandoff }
  | { kind: 'SERVICE_CLARIFICATION', question: ServiceClarification }
  | { kind: 'STAFF_ANSWER', questionId: string, action: 'accept' | 'decline' }
  | { kind: 'UNAVAILABLE' }
)

/** A server-owned one-use checkpoint, never permission to execute a tool. */
export type DecisionStageResult = KioskInteractionDecision | ServiceRecoveryProgress | {
  kind: 'DECISION_PROGRESS'
  continuationId: string
  expiresAt: number
  question: string
  choice?: string
  confidence?: number
  /** Adapter-validated label with no calibrated probability; presentation only. */
  selectionMode?: 'unscored'
  durationMs: number
}

/** Safe application-owned interaction facts shared by Jev and Agent requests. */
export interface InteractionState {
  /** Total current servings; zero is real cart evidence, not a missing named match. */
  cartItemCount?: number
  /** Visible browser surface; independent from the order/checkout phase. */
  screen?: KioskScreen
  lastAddedItemName?: string
  matchingCartLines: number
  pendingAction?: string
  pendingIntent?: string
  selectedItemName?: string
  /** Current party/selection question, never POS hold tokens or payment authority. */
  seating?: { partySize?: number, ready: boolean, question: string }
}

/** Browser-owned screen identity, not inferred from selected items or model prose. */
export type KioskScreen = 'customer_entry' | 'menu' | 'cart_review' | 'item_configuration' | 'request_confirmation' | 'checkout'

/** Presented application-owned question; choices describe effects, never tool arguments. */
export type PresentedQuestion = ConversationQuestion

/** A bounded host invitation; accepting can recommend, never add or pay. */
export function createRecommendationInvitation(questionId: string, now: number): PresentedQuestion {
  return { questionId, purpose: 'recommendation-invitation', question: '需要我推薦幾樣餐點嗎？', expiresAt: now + 30000, choices: [{ id: 'intent:recommend', description: '顧客同意目前推薦邀請，開始一輪最多三項餐點推薦，不新增訂購。' }, { id: 'DECLINE_INVITATION', description: '顧客拒絕目前推薦邀請，不修改訂單，也沒有提出其他需求。' }] }
}
