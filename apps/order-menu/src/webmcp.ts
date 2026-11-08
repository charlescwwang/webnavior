import type { ConversationContext, ConversationHandoff, MerchantFacts, ConversationQuestion as PresentedQuestion } from '@proj-airi/stage-shared/kiosk-conversation'
import type { OrderingContext } from '@proj-airi/stage-shared/kiosk-service-mode'

import type { PaymentMethod } from '../../order-menu-server/src/domain/contracts'
import type { RecommendationStrategy } from '../../order-menu-server/src/domain/recommendation'
import type { KioskScreen } from '../../server/src/services/domain/kiosk-interaction-decision/contracts'
import type { PriceConditions } from '../../server/src/services/domain/kiosk-interaction-decision/priceContracts'
import type { ScopeChoice } from '../../server/src/services/domain/kiosk-interaction-decision/queryScopeContracts'
import type { QueryCondition, QueryView } from './domain/browsing'
import type { CheckoutSnapshot, InvoiceMethod } from './domain/checkout-flow'
import type { IngredientFilters } from './domain/composition'
import type { CartSnapshot, FulfillmentMode, MenuItem, MenuPageState, PosOrderGateway, RecommendationTag, Selection, SubmittedOrder } from './domain/order-machine'
import type { SelectedQueryScope } from './domain/queryScope'
import type { SeatingContext } from './domain/seating'
import type { HostToolName } from './hostTools'
import type { DecisionContext, DomainPlan, DomainReference, IntentCandidate, KioskRevisions, OperationPlan, PendingConfirmation, PendingQuestion } from './kiosk-intents'
import type { ScrollDirection, ScrollResult } from './menuScroll'
import type { MenuToolDefinition, MenuToolName } from './toolDefinitions'

import { errorMessageFrom } from '@moeru/std'
import { conversationContextSchema, customerReplySchema, describeOrderingDetails, handoffSchema, isTargetAcknowledgement, renderCustomerReply, serviceRecoveryLimits } from '@proj-airi/stage-shared/kiosk-conversation'
import { servicePolicy } from '@proj-airi/stage-shared/kiosk-service-mode'
import { parse, safeParse } from 'valibot'

import { orderingMessages } from '../../../packages/i18n/src/orderingMessages'
import { ingredientDefinitions, vegetarianIngredients } from '../../order-menu-server/src/domain/composition'
import { currentRecommendationSignal } from '../../order-menu-server/src/domain/recommendation'
import { describeConditions, describeGuidance, removeCondition } from './domain/browsing'
import { invoiceDraftReady } from './domain/checkout-flow'
import { emptyFilterMessage, filterAvailability, filterIngredients, ingredientFilters, mentionedIngredients, mentionedUnavailableConditions, unsupportedPreparation } from './domain/composition'
import { findMenuCandidates, itemMatchesQuery } from './domain/menuIdentity'
import { catalogInfo, createOrderMachine, itemAvailability, ItemSelectionError, menuPageState, menuPageStates } from './domain/order-machine'
import { filterPrices, intersectPrices, priceClarification, priceConditions, priceDescription } from './domain/pricing'
import { mentionedServingCounts, QuantityLimitError, rejectQuantity } from './domain/quantityPolicy'
import { createQueryScope } from './domain/queryScope'
import { hostToolNames } from './hostTools'
import { authorize, buildClarificationPrompt, compileOperationPlan, configurationQuestion, createConfirmation, createQuestion, deriveDecisionContext, describeQuestion, describeRequest, intentRecovery, questionIsCurrent, resolveClarificationReference, resolveIntent, targetReferenceLimit, validateConfirmation } from './kiosk-intents'
import { createMealClarification, mealMessages } from './mealClarification'
import { paymentLabels } from './pos-bridge'
import { toolDefinitions } from './toolDefinitions'

export type { MenuToolName } from './toolDefinitions'

export type MenuPresentationToolName = 'menu_get' | 'menu_recommend' | 'menu_show_recommendations'

/** Development-only page state exposed to the operator panel, never the Agent. */
export interface MenuTestSnapshot {
  items: Array<{ id: string, name: string, state: MenuPageState }>
}

const kioskHostOnlyToolNames = new Set<MenuToolName>(hostToolNames)
// Menu reads and order changes share the explicit phone-or-skip entry gate.
const intentTools: Record<string, readonly MenuToolName[]> = {
  REMOVE_ITEM: ['cart_remove_item'],
  ADD_ITEM: ['order_cancel_request', 'menu_select_item', 'menu_set_quantity', 'menu_set_item_option', 'order_add_item', 'cart_add_item', 'menu_confirm_item'],
  SET_QUANTITY: ['menu_set_quantity', 'cart_set_line_quantity'],
  SET_OPTION: ['menu_set_item_option', 'cart_set_line_option'],
  CLEAR_CART: ['cart_clear'],
}

const menuBrowsingToolNames = new Set<MenuToolName>(['menu_get', 'menu_recommend', 'menu_show_recommendations'])
// These effects require a target bound before this Agent task; later reads
// cannot create customer consent to a different item.
const selectionToolNames = new Set<MenuToolName>(['cart_add_item', 'menu_set_item_option', 'menu_set_quantity'])
const cartLineToolNames = new Set<MenuToolName>(['cart_remove_item', 'cart_set_line_quantity', 'cart_set_line_option'])
const itemTargetToolNames = new Set<MenuToolName>(['menu_select_item', 'order_add_item', ...selectionToolNames])

function isKioskHostOnlyToolName(name: MenuToolName): name is HostToolName {
  return kioskHostOnlyToolNames.has(name)
}

export interface MenuPresentationActivity {
  state: 'idle' | 'loading'
  toolName: MenuPresentationToolName
}

export interface AgentAction {
  controlId?: string
  inputValue?: string
  expandCustomization?: boolean
  label: string
  targetId?: string
}

type FastPathRevisions = Partial<KioskRevisions>

interface IssuedFastPathContext {
  candidates: Map<string, IntentCandidate>
  context: DecisionContext
  expiresAt: number
  /** Correlates a new-request route with the retained question it interrupted. */
  interruptedQuestion?: { kind: 'configuration' | 'clarification', id: string }
}

interface PendingFastPathClarification {
  id: string
  candidate: IntentCandidate
  candidateRefs: string[]
  context: DecisionContext
  expectedRevisions: FastPathRevisions
  /** Short-lived answer authority, renewed only for a new customer utterance. */
  issued?: { id: string, expiresAt: number, transcript: string }
}

interface PendingFastPathConfirmation {
  /** The proposing task cannot answer its own question before a new customer turn. */
  taskId?: string
  presented?: boolean
  cart: string
  operation: OperationPlan
  record: PendingConfirmation
}

interface PendingConfiguration {
  id: string
  plan: DomainPlan
  clarificationAttempts?: number
  /** Only choices issued by the latest snapshot may complete this session. */
  issued?: { id: string, expiresAt: number, transcript: string, choices: Map<string, IntentCandidate>, unitGuidanceId?: string }
}

/** A surface switch waits for the visible, unadded meal; it never owns a cart write. */
interface PendingNavigation {
  id: string
  itemId: string
  name: 'cart_get' | 'order_set_fulfillment'
  input: Record<string, unknown>
  revisions: FastPathRevisions
  state: 'choice' | 'completing'
  taskId?: string
  presented?: boolean
  issued?: { id: string, expiresAt: number }
}

/** One customer-mentioned subject retained by a query-result presentation. */
export interface QueryPresentationSubject {
  id: string
  itemIds: string[]
  label: string
}

/** A customer-facing collection chosen from the current menu catalog. */
export interface RecommendationPresentation {
  kind: 'query-results' | 'recommendation'
  itemIds: string[]
  reason?: string
  /** These cards propose a new browse choice without changing the saved conditions. */
  proposedAlternatives?: boolean
  /** Query-result subjects remain available even when the default grid is full. */
  subjects?: QueryPresentationSubject[]
  title?: string
}

const presentationToolNames = new Set<MenuPresentationToolName>([
  'menu_get',
  'menu_recommend',
  'menu_show_recommendations',
])

export function isMenuPresentationTool(name: MenuToolName): name is MenuPresentationToolName {
  return presentationToolNames.has(name as MenuPresentationToolName)
}

function menuPresentationToolFor(name: MenuToolName, input: Record<string, unknown>): MenuPresentationToolName | undefined {
  if (!isMenuPresentationTool(name))
    return undefined
  if (name !== 'menu_get')
    return name

  // A complete catalog read does not replace the menu grid. Reserve the
  // loading surface for filtered lookups that will visibly change it.
  const { category, queries } = getMenuQuery(input)
  return category || queries.length > 0 || input.display === true || input.excludeIngredients !== undefined || input.includeIngredients !== undefined || input.excludeItemIds !== undefined ? name : undefined
}

/** Returns the DOM control identifier used to visually follow an AI option change. */
export function optionControlId(itemId: string, groupId: string, valueId: string) {
  return `${itemId}:option:${groupId}:${valueId}`
}

/** Returns the DOM control identifier used to visually follow an AI quantity change. */
export function quantityControlId(itemId: string) {
  return `${itemId}:quantity`
}

/** Distinguishes individual plus/minus buttons from their quantity container. */
export function quantityStepControlId(ownerId: string, direction: 'increase' | 'decrease', cart = false) {
  return `${cart ? 'cart' : 'item'}:quantity:${encodeURIComponent(ownerId)}:${direction}`
}

export function closeItemControlId(itemId: string) {
  return `item:close:${encodeURIComponent(itemId)}`
}

export function cartOptionControlId(lineId: string, groupId: string, valueId: string) {
  return `cart:option:${encodeURIComponent(lineId)}:${encodeURIComponent(groupId)}:${encodeURIComponent(valueId)}`
}

/** Returns the DOM control identifier used to visually follow a service-mode change. */
export function fulfillmentControlId(mode: FulfillmentMode) {
  return `order:fulfillment:${mode}`
}

/** Encodes one opaque cart line ID into the exact registered removal control. */
export function cartRemovalControlId(lineId: string) {
  return `cart:remove:${encodeURIComponent(lineId)}`
}

/** Returns the DOM control identifier for the selected item's add action. */
export function addItemControlId(itemId: string) {
  return `${itemId}:add`
}

export interface CheckoutToolController {
  assertCanRestart: () => void
  cancel: () => unknown
  chooseInvoice: (method: Exclude<InvoiceMethod, 'tax-id'>) => CheckoutSnapshot
  confirmInvoice: () => CheckoutSnapshot
  confirmTaxId: () => CheckoutSnapshot
  requestTaxId: () => CheckoutSnapshot
  paymentStatus: () => 'pending' | 'uncertain' | undefined
  revision: () => number
  restart: () => void
  paymentMethods?: readonly PaymentMethod[]
  /** Opens the selected method's scan step; must not authorize payment or submit an order. */
  selectPayment: (method: PaymentMethod) => Promise<{ customerMessage: string, status: 'selected' }>
  setTaxId: (taxId: string) => CheckoutSnapshot
  skipMembership: () => CheckoutSnapshot
  snapshot: () => CheckoutSnapshot | undefined
  start: () => CheckoutSnapshot
}

interface MenuToolRuntimeOptions {
  /** Merchant claims are configured independently from test checkout controls. */
  merchant?: MerchantFacts
  serviceContext?: () => OrderingContext | undefined
  /** Development-only page scenarios; never enabled for the production service. */
  testing?: boolean
  onMenuChanged?: (items: MenuItem[]) => void
  /** Read the same reactive state that owns the visible browser surface. */
  screen?: () => KioskScreen
  /** Actual item dialog identity; machine selection alone does not prove visibility. */
  visibleItemId?: () => string | undefined
  /** IDs in the current Vue menu grid after its presentation update. */
  visibleItemIds?: () => string[]
  fulfillmentModes?: readonly { id: FulfillmentMode, label: string }[]
  /** Optional venue capability, backed by POS rather than browser-local seats. */
  seating?: {
    context: () => SeatingContext
    refresh: () => Promise<void>
    release: () => Promise<void>
    setPartySize: (value: number) => Promise<void>
    reserve: (choiceId: string, splitApproved: boolean, expectedRevision: number) => Promise<void>
    reset: () => Promise<void>
  }
  /** Routes Agent checkout actions through the same state transitions as visible controls. */
  checkout?: CheckoutToolController
  /** Submits confirmed carts to the current ordering environment. */
  gateway?: PosOrderGateway
  /** Initial POS catalog. The browser must not substitute a local menu on failure. */
  menu?: MenuItem[]
  /** Customer entry is browser-owned; the model never receives the phone value. */
  orderingReady?: () => boolean
  /** Enters the menu without identifying a customer; requires an explicit skip. */
  onCustomerEntrySkipped?: () => void
  /** Receives touch-entered phone from the host; never exposed to conversational tools. */
  onCustomerPhoneProvided?: (phone: string) => void
  /** Offers optional phone entry once for a fresh order hosted by the Kiosk. */
  onCustomerEntryRequested?: () => void
  /** Clears browser identity only when the host starts a different customer session. */
  onSessionReset?: () => Promise<void> | void
  /** Locks customer writes until the matching host task has settled. */
  onAgentControlChange?: (locked: boolean) => void
  onAction: (action: AgentAction) => Promise<void> | void
  /** Browser UI executes through actual control handlers; headless runtimes apply domain actions directly. */
  onControl?: <T>(action: AgentAction, apply: () => T | Promise<T>) => Promise<T>
  onCartChange: (cart: CartSnapshot) => void
  /** Reveals review controls and waits for their DOM registration before cursor animation. */
  onReviewRequested?: () => Promise<void> | void
  /** Returns to ordering without cancelling checkout or clearing any cart line. */
  onMenuRequested?: () => Promise<void> | void
  onMenuSelection: (itemId: string | undefined) => void
  /** Browser-owned viewport movement; unavailable hosts do not advertise this tool. */
  onMenuScroll?: (direction: ScrollDirection) => ScrollResult
  /** Mirrors an order-level dine-in or self-pickup choice into the menu UI. */
  onFulfillmentChange?: (mode: FulfillmentMode | undefined) => void
  /** Mirrors the active tool selection into the menu UI. */
  onSelectionChange?: (selection: Selection) => void
  /** Shares the same browser-owned question with voice and touch controls. */
  onQueryScopeChange?: (question: PresentedQuestion | undefined) => void
  onClarificationChange?: (question: PresentedQuestion | undefined) => void
  /** Notifies the embedding host after the first successfully confirmed order. */
  onOrderConfirmed?: (order: SubmittedOrder) => void
  /** Mirrors every final POS receipt into the visible customer flow. */
  onOrderSubmission?: (order: SubmittedOrder) => void
  /** A returned promise settles after Vue has applied the new dish grid; other return values are ignored. */
  onRecommendationsChange?: (presentation: RecommendationPresentation) => unknown
  /** Publishes detached query facts after changes, catalog replacement and reset. */
  onQueryStateChange?: (state: QueryView | undefined) => void
  /** Keeps visible loading feedback aligned with actual menu-rendering tools. */
  onMenuPresentationActivity?: (activity: MenuPresentationActivity) => Promise<void> | void
}

function requiredString(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${key} is required.`)
  return value
}

function requiredNumber(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (typeof value !== 'number')
    throw new Error(`${key} is required.`)
  return value
}

function checkoutControllerOrThrow(controller: CheckoutToolController | undefined) {
  if (!controller)
    throw new Error('Checkout controls are unavailable in this environment.')
  return controller
}

function requiredInvoiceMethod(input: Record<string, unknown>) {
  if (input.method !== 'carrier' && input.method !== 'citizen' && input.method !== 'donation')
    throw new Error('method must be carrier, citizen or donation.')
  return input.method
}

function requiredPaymentMethod(input: Record<string, unknown>) {
  if (input.method !== 'card' && input.method !== 'mobile' && input.method !== 'linepay' && input.method !== 'jkopay')
    throw new Error('method must be a supported payment method.')
  return input.method
}

function requiredFulfillmentMode(input: Record<string, unknown>): FulfillmentMode {
  const mode = requiredString(input, 'mode')
  if (mode === 'dine-in' || mode === 'takeout')
    return mode
  throw new Error('mode must be dine-in or takeout.')
}

interface ItemOptionInput {
  groupId: string
  valueId: string
}

function itemOptionInputs(input: Record<string, unknown>): ItemOptionInput[] {
  if (input.options === undefined)
    return []
  if (!Array.isArray(input.options))
    throw new Error('options must be an array.')

  const seenGroupIds = new Set<string>()
  return input.options.map((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option))
      throw new Error('Each option must include groupId and valueId.')

    const optionInput = option as Record<string, unknown>
    const groupId = requiredString(optionInput, 'groupId')
    const valueId = requiredString(optionInput, 'valueId')
    if (seenGroupIds.has(groupId))
      throw new Error(`options must not repeat groupId ${groupId}.`)
    seenGroupIds.add(groupId)
    return { groupId, valueId }
  })
}

function cartNextStep(cart: CartSnapshot, context?: OrderingContext) {
  if (context && !servicePolicy(context.serviceMode).requiresPayment)
    return 'Confirm this table cart with the customer; call checkout_start only after explicit consent to submit. No payment or fulfillment selection.'
  return cart.fulfillmentMode
    ? 'Confirm the cart with the customer. Call checkout_start only after explicit customer consent.'
    : 'The customer still needs to choose dine-in or self-pickup before order confirmation. Ask when appropriate, but continue adding requested items first.'
}

/**
 * Removes presentational image URLs from model-facing menu results.
 *
 * Before:
 * - a browser menu item with an image URL and all UI-only fields
 *
 * After:
 * - the stable ordering data needed to answer one customer request
 */
function menuItemForAgent(item: MenuItem) {
  return {
    composition: item.composition,
    available: item.available !== false,
    id: item.id,
    name: item.name,
    description: item.description,
    category: item.category,
    price: item.price,
    recommendationTags: item.recommendationTags,
    optionGroups: item.optionGroups,
  }
}

// Exclusions are resolved catalog identities, never user phrases. Validate them
// against the current menu before filtering or replacing a visible batch.
function menuExclusions(input: Record<string, unknown>, menu: readonly MenuItem[]): string[] {
  if (input.excludeItemIds === undefined)
    return []
  if (!Array.isArray(input.excludeItemIds) || !input.excludeItemIds.every(id => typeof id === 'string'))
    throw new Error('excludeItemIds must be an array of current menu item IDs.')
  const ids = [...new Set<string>(input.excludeItemIds)]
  if (ids.some(id => !menu.some(item => item.id === id)))
    throw new Error('UNKNOWN_MENU_EXCLUSION: Read the current catalog and use its exact item IDs.')
  return ids
}

function getMenuQuery(input: Record<string, unknown>) {
  const category = typeof input.category === 'string' ? input.category.trim() : ''
  const additionalQueries = input.queries
  if (additionalQueries !== undefined && !Array.isArray(additionalQueries))
    throw new Error('queries must be an array of one to four non-empty strings.')

  if (additionalQueries && (additionalQueries.length === 0 || additionalQueries.length > 4))
    throw new Error('queries must be an array of one to four non-empty strings.')

  const rawQueries: string[] = typeof input.query === 'string' ? [input.query] : []
  for (const query of additionalQueries ?? []) {
    if (typeof query !== 'string' || !query.trim())
      throw new Error('queries must be an array of one to four non-empty strings.')
    rawQueries.push(query)
  }

  const queries = [...new Set(rawQueries
    .map(query => query.trim().toLocaleLowerCase())
    .filter(Boolean))]
  if (queries.length > 4)
    throw new Error('queries must include at most four values.')

  return { category, queries }
}

/**
 * Chooses a compact first view without letting one broad subject hide another.
 * Every subject is offered one distinct result before extra slots are filled in
 * round-robin order. Subjects themselves retain all matched IDs for expansion.
 */
function coverageItemIds(subjects: QueryPresentationSubject[], maximum = 4) {
  const selected: string[] = []
  const selectedIds = new Set<string>()
  const add = (itemId: string | undefined) => {
    if (!itemId || selectedIds.has(itemId) || selected.length >= maximum)
      return false
    selectedIds.add(itemId)
    selected.push(itemId)
    return true
  }

  for (const subject of subjects)
    add(subject.itemIds.find(itemId => !selectedIds.has(itemId)))

  for (let itemIndex = 1; selected.length < maximum; itemIndex++) {
    let added = false
    for (const subject of subjects)
      added = add(subject.itemIds[itemIndex]) || added
    if (!added)
      break
  }
  return selected
}

function recommendationNeeds(input: Record<string, unknown>): RecommendationTag[] {
  const needs = input.needs
  const validTags: RecommendationTag[] = ['rice', 'fried']
  if (needs === undefined)
    return []
  if (!Array.isArray(needs) || needs.length === 0 || !needs.every(tag => typeof tag === 'string' && validTags.includes(tag as RecommendationTag)))
    throw new Error('needs must contain one or more supported recommendation tags.')

  return [...new Set(needs)] as RecommendationTag[]
}

function ingredientFilterDescription(filters: IngredientFilters) {
  const label = (ids: string[]) => ids.map(id => ingredientDefinitions.find(definition => definition.id === id)!.label).join('、')
  return [filters.dietary ? '素食條件' : '', filters.excludeIngredients.length ? `排除${label(filters.excludeIngredients)}` : '', filters.includeIngredients.length ? `含${label(filters.includeIngredients)}` : ''].filter(Boolean).join('；')
}

function recommendationPresentation(input: Record<string, unknown>): RecommendationPresentation {
  const itemIds = input.itemIds
  if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 4 || !itemIds.every(itemId => typeof itemId === 'string' && itemId.trim()))
    throw new Error('itemIds must contain one to four menu item IDs.')

  const normalizedItemIds = itemIds.map(itemId => itemId.trim())
  if (new Set(normalizedItemIds).size !== normalizedItemIds.length)
    throw new Error('itemIds must not repeat an item ID.')

  const title = typeof input.title === 'string' ? input.title.trim() : undefined
  const reason = typeof input.reason === 'string' ? input.reason.trim() : undefined
  if (title && title.length > 36)
    throw new Error('title must be 36 characters or fewer.')
  if (reason && reason.length > 90)
    throw new Error('reason must be 90 characters or fewer.')

  return {
    kind: 'recommendation',
    itemIds: normalizedItemIds,
    ...(reason ? { reason } : {}),
    ...(title ? { title } : {}),
  }
}

/** Builds an LLM-readable retry result instead of allowing browser mediation to hide the validation error. */
function invocationFailure(name: MenuToolName, error: unknown) {
  if (error instanceof QuantityLimitError)
    return rejectQuantity(name, error.quantity)!
  if (error instanceof ItemSelectionError)
    return { ok: false, rejection: error.rejection, customerMessage: error.message, recovery: 'Keep the cart and let the customer choose another item; do not retry automatically.' }
  const message = errorMessageFrom(error) ?? 'The requested menu operation could not be completed.'
  const recovery = name === 'menu_select_item' && message === 'itemId is required.'
    ? 'First call menu_get. Then call menu_select_item again with itemId set to exactly one item.id returned by menu_get.'
    : name === 'checkout_start' && message.includes('Choose dine-in or self-pickup before starting checkout.')
      ? 'Ask the customer whether this order is dine-in or self-pickup. Then call order_set_fulfillment before retrying checkout_start.'
      : 'Check this tool\'s required arguments and the latest menu or cart result, then retry only with valid values.'

  return { ok: false, error: message, recovery }
}

/**
 * Presents one domain interface to the approved iframe host and human UI controls. Each
 * mutation announces itself before updating state.
 */
export function createMenuToolRuntime(options: MenuToolRuntimeOptions) {
  let uiExecutionDurationMs = 0
  const policy = () => servicePolicy(options.serviceContext?.()?.serviceMode ?? 'kiosk')
  // A voice/Main checkout request opens a cart-bound review first. Only a
  // subsequently presented question can authorize the next submission call.
  let tableOrderReview: { contextId: string, cart: string, questionId?: string } | undefined
  let tableSubmissionPending = false
  let tableSubmissionUncertain = false
  const machine = createOrderMachine({ gateway: options.gateway, menu: options.menu })
  let completedOrderId: string | undefined
  let presentationItemIds: string[] | undefined
  let presentationFocus: { menuRevision: number } | undefined
  let pendingFastPathConfirmation: PendingFastPathConfirmation | undefined
  let pendingFastPathClarification: PendingFastPathClarification | undefined
  let pendingConfiguration: PendingConfiguration | undefined
  let pendingNavigation: PendingNavigation | undefined
  // Only the foreground meal is sent to Jev. Retained drafts do not resume
  // automatically after a different meal completes; no cart line is implied.
  const suspendedConfigurations: PendingConfiguration[] = []
  const mealClarification = createMealClarification()
  let queryScope: ReturnType<typeof createQueryScope> | undefined
  let queryScopeInput: { name: 'menu_get' | 'menu_recommend', input: Record<string, unknown> } | undefined
  let clarificationTranscript = ''
  let issuedFastPathContext: IssuedFastPathContext | undefined
  // Admitted customer calls must settle before an Agent can acquire ownership.
  let manualOperations = 0
  // Host-owned, per Agent turn. A new task replaces this record; END from an
  // interrupted older turn cannot clear its successor's verified conditions.
  // Target IDs come from the host-bound utterance, never from Agent lookup
  // arguments. An empty list requires a new customer confirmation; a contextual
  // short reply may retain a unique domain-resolved pre-task presentation reference with a quantity.
  let agentTask: { taskId: string, transcript: string, handoff?: ConversationHandoff, expectedRevisions?: KioskRevisions, allowedToolNames?: string[], returnToMenu?: boolean, targetItemIds?: string[], broadMenuQuery: boolean, readOnly: boolean, filters: IngredientFilters, prices: PriceConditions, unresolvedPrice: boolean, unresolvedMenu: boolean, menuRevision: number, expiresAt: number, querySubjects?: QueryPresentationSubject[] } | undefined
  let waitingFor: PendingQuestion | undefined
  let offeredQuestion: typeof waitingFor
  // Records belong to this order, not a model turn. Completed/superseded
  // questions stay recorded until reset; only the pending pointer grants context.
  const questionHistory = new Map<string, { question: PendingQuestion, status: 'offered' | 'pending' | 'deferred' | 'answered' | 'superseded' }>()
  let configuredFulfillmentModes = options.fulfillmentModes ?? [{ id: 'dine-in' as const, label: '內用' }, { id: 'takeout' as const, label: '自取' }]
  let fulfillmentModes = policy().requiresPayment ? configuredFulfillmentModes : [{ id: 'dine-in' as const, label: '隨桌供餐' }]
  // The runtime owns this invariant even when no host updates POS capabilities.
  // Table service uses the same cart format without asking for fulfillment.
  if (!policy().requiresPayment)
    machine.setFulfillmentMode('dine-in')
  let pendingReadContinuation: { candidateId: string, expiresAt: number, operation: OperationPlan, result: Record<string, unknown> } | undefined
  // Conditions and delivered items belong to this order, not an idle timer.
  // An explicit fresh recommendation replaces the batch; reset clears it.
  let recommendationRevision = 0
  let recommendationBatch: { seenIds: Set<string>, filters: IngredientFilters, excludedItemIds: string[], needs: RecommendationTag[], prices: PriceConditions, category: string, queries: string[], strategy?: RecommendationStrategy, scope?: SelectedQueryScope, exhausted: boolean, hadMatches: boolean, menuRevision: number | undefined } | undefined

  function getQueryState(): QueryView | undefined {
    if (!recommendationBatch || recommendationBatch.menuRevision !== machine.getRevisions().menu)
      return undefined
    return { revision: recommendationRevision, menuRevision: machine.getRevisions().menu, conditions: describeConditions(recommendationBatch, machine.getMenu()) }
  }

  // Candidate cards are proposals to view, not accepted changes to the saved
  // positive preference. Keep exclusions, dietary facts, budget and explicit
  // dish exclusions; require a new customer choice before changing anything.
  async function queryGuidance(reason: 'unclear' | 'empty' | 'exhausted', display = true) {
    const previous = recommendationBatch
    if (reason === 'exhausted' && previous && !previous.hadMatches)
      reason = 'empty'
    const candidates = previous && previous.menuRevision === machine.getRevisions().menu
      ? filterIngredients(filterPrices(machine.getMenu().filter(item => !previous.excludedItemIds.includes(item.id)), previous.prices), { ...previous.filters, includeIngredients: [] }).matches.filter(item => !previous.seenIds.has(item.id) && previous.needs.every(need => item.recommendationTags.includes(need))).slice(0, 2)
      : []
    let presentation: RecommendationPresentation | undefined
    if (candidates.length && display) {
      presentation = { kind: 'query-results', itemIds: candidates.map(item => item.id), title: '您想改看哪一道？', proposedAlternatives: true }
      presentationItemIds = [...presentation.itemIds]
      await options.onRecommendationsChange?.(presentation)
    }
    const customerReply = describeGuidance(reason, candidates)
    return { queryAction: 'clarify', items: [], dataOnly: !display, customerReply, customerMessage: renderCustomerReply(customerReply), guidance: { reason, itemIds: candidates.map(item => item.id) }, ...(presentation ? { presentation } : {}) }
  }

  // A fuzzy name is not a preparation waiver. Discovery and execution share
  // this speech-derived gate so models are not offered an inapplicable flag.
  function hasPreparationRequest(source: DecisionContext) {
    const speech = source.catalogEvidence.products.reduce((text, product) => text.replaceAll(product.matchedText, ''), source.transcript ?? '')
    return mentionedUnavailableConditions(speech).length > 0 || mentionedIngredients(speech).length > 0
  }

  // Tool execution and embedded-host discovery must expose the same POS
  // capabilities, not a static enum containing unavailable service modes.
  function availableToolDefinitions(): MenuToolDefinition[] {
    const categories = [...new Set(machine.getMenu().map(item => item.category))]
    const category = { type: 'string', ...(categories.length ? { enum: categories } : {}), description: '只可使用目前 POS 的精確分類名稱；不要自行改寫分類。未知時省略，使用 query 查找餐點。' }
    return toolDefinitions.flatMap((definition) => {
      if (definition.name === 'kiosk_test_menu' && !options.testing)
        return []
      if (definition.name === 'kiosk_customer_entry_start' && !options.onCustomerEntryRequested)
        return []
      if (definition.name === 'kiosk_customer_phone' && !options.onCustomerPhoneProvided)
        return []
      if (definition.name === 'customer_skip_phone' && !options.onCustomerEntrySkipped)
        return []
      if (!options.seating && ['seating_get', 'seating_reserve', 'order_set_party_size'].includes(definition.name))
        return []
      if (definition.name === 'order_ask_question') {
        const properties = definition.inputSchema.properties as Record<string, { type: string, enum: string[] }>
        return [{ ...definition, inputSchema: { ...definition.inputSchema, properties: { purpose: { ...properties.purpose, enum: properties.purpose.enum.filter(purpose => (options.seating || (purpose !== 'tables' && purpose !== 'party-size')) && (options.onCustomerEntrySkipped || purpose !== 'customer-entry')) } } } }]
      }
      if (definition.name === 'checkout_select_payment' && options.checkout?.paymentMethods)
        return [{ ...definition, inputSchema: { ...definition.inputSchema, properties: { method: { type: 'string', enum: [...options.checkout.paymentMethods] } } } }]
      if (definition.name === 'menu_open' && !options.onMenuRequested)
        return []
      if (definition.name === 'menu_scroll' && !options.onMenuScroll)
        return []
      // Tool discovery describes stable capabilities, not one utterance's
      // authorization. originalRecipe is still checked when invoked; changing
      // this schema at BEGIN would invalidate the Host's next context read.
      if (definition.name === 'menu_get')
        return [{ ...definition, inputSchema: { ...definition.inputSchema, properties: { ...(definition.inputSchema.properties as Record<string, unknown>), category } } }]
      if (definition.name === 'menu_recommend') {
        const strategies = (['POPULAR', 'NEW_ARRIVAL', 'CHEF_SPECIAL'] as const).filter(strategy => machine.getMenu().some(item => item.available !== false && currentRecommendationSignal(item.recommendationSignals, strategy, Date.now())))
        return [{ ...definition, inputSchema: { ...definition.inputSchema, required: ['action'], properties: {
          ...(definition.inputSchema.properties as Record<string, unknown>),
          category,
          ...(strategies.length ? { strategy: { type: 'string', enum: strategies, description: '只可使用 POS 有當前排序資料的策略；不得把菜單順序當熱銷。' } } : {}),
        } } }]
      }
      if (!policy().requiresPayment && ((definition.name.startsWith('checkout_') && definition.name !== 'checkout_start') || ['order_set_fulfillment', 'order_set_party_size', 'seating_reserve'].includes(definition.name)))
        return []
      if (!policy().requiresPayment && definition.name === 'checkout_start' && (!options.serviceContext?.()?.directSubmissionSupported || tableSubmissionPending || tableSubmissionUncertain))
        return []
      if (!policy().requiresPayment && definition.name === 'checkout_start')
        return [{ ...definition, description: '顧客要求付款或結帳時，第一次呼叫只核對本桌訂單並詢問是否送出；呈現後須等下一次顧客明確確認，才會送出。confirmedByUser=true不能取代這次確認。不選用餐方式、不付款。' }]
      if (definition.name !== 'order_set_fulfillment')
        return [definition]
      if (!fulfillmentModes.length)
        return []
      return [{
        ...definition,
        description: `${definition.description} 目前 POS 選項：${fulfillmentModes.map(mode => `${mode.id}=${mode.label}`).join('、')}。`,
        inputSchema: { ...definition.inputSchema, properties: { mode: { type: 'string', enum: fulfillmentModes.map(mode => mode.id), description: '只可選擇目前 POS 提供的方式。' } } },
      }]
    })
  }
  /**
   * Revisions come from the state owners at write time. Snapshot comparison
   * here would miss an edit followed by an undo before the next read.
   */
  function currentFastPathRevisions() {
    return { ...machine.getRevisions(), recommendation: recommendationRevision, checkout: options.checkout?.revision() ?? 0, ...(options.seating ? { seating: options.seating.context().revision } : {}) }
  }

  // Retire the owner, captured request and visible controls together. A later
  // checkout cancellation must not revive a previous menu-scope question.
  function clearQueryScope() {
    queryScope = undefined
    queryScopeInput = undefined
    options.onQueryScopeChange?.(undefined)
  }

  function currentFastPathContext(transcript = '', previousTranscript?: string, renewQuestion = false) {
    const revisions = currentFastPathRevisions()
    let context = deriveDecisionContext({
      serviceMode: options.serviceContext?.()?.serviceMode,
      orderAccepted: completedOrderId !== undefined,
      orderSubmissionBlocked: !policy().requiresPayment && (!options.serviceContext?.()?.directSubmissionSupported || tableSubmissionPending || tableSubmissionUncertain),
      customerEntryPending: policy().requiresPayment && options.orderingReady?.() === false,
      customerEntrySkipSupported: Boolean(options.onCustomerEntrySkipped),
      waitingFor: waitingFor && questionIsCurrent(waitingFor, revisions, Date.now()) ? waitingFor : undefined,
      fulfillmentModes,
      cart: machine.getCart(),
      checkout: options.checkout?.snapshot(),
      paymentMethods: options.checkout?.paymentMethods,
      menu: machine.getMenu(),
      menuScrollSupported: Boolean(options.onMenuScroll),
      menuReturnSupported: Boolean(options.onMenuRequested),
      paymentStatus: options.checkout?.paymentStatus(),
      presentationItemIds: presentationFocus?.menuRevision === revisions.menu ? presentationItemIds : undefined,
      recommendationConditions: recommendationBatch && recommendationBatch.menuRevision === revisions.menu ? [ingredientFilterDescription(recommendationBatch.filters), priceDescription(recommendationBatch.prices), recommendationBatch.category, ...(recommendationBatch.excludedItemIds.length ? [`排除餐點：${recommendationBatch.excludedItemIds.join('、')}`] : []), ...recommendationBatch.queries, ...recommendationBatch.needs].filter(Boolean).join('、') || '原本條件' : undefined,
      recentAddedLineId: machine.getLastAddedLineId(),
      revisions,
      selectedItem: machine.getSelection(),
      transcript,
      previousTranscript,
      seating: options.seating?.context(),
    })
    if (waitingFor && (!questionIsCurrent(waitingFor, revisions, Date.now()) || waitingFor.phase !== context.phase)) {
      // Revisions invalidate an execution ticket, not the unanswered need.
      // Rebase only if the current domain still asks the same question; a
      // completed phase must never revive an old membership/payment answer.
      const next = createQuestion({ ...context, waitingFor: undefined }, crypto.randomUUID(), Date.now())
      if (!next || next.purpose !== waitingFor.purpose || next.phase !== waitingFor.phase) {
        finishQuestion('superseded')
      }
      else if (renewQuestion) {
        const status = questionHistory.get(waitingFor.questionId)?.status === 'deferred' ? 'deferred' : 'pending'
        finishQuestion('superseded')
        waitingFor = rememberQuestion(next, status)
        context = deriveDecisionContext({ ...context, waitingFor })
      }
    }
    else if (waitingFor && renewQuestion) {
      // The retained need is still current, but each new answer needs a full
      // inference window. Reusing the previous turn's nearly expired ticket
      // rejected valid answers a few seconds after they started. Passive reads
      // never renew it, and live phase/revision checks still guard execution.
      const status = questionHistory.get(waitingFor.questionId)?.status === 'deferred' ? 'deferred' : 'pending'
      waitingFor = rememberQuestion({ ...waitingFor, expiresAt: Date.now() + 30_000 }, status)
      context = deriveDecisionContext({ ...context, waitingFor })
    }
    return { ...context, interactionState: { ...context.interactionState, ...(options.screen ? { screen: options.screen() } : {}) } }
  }

  function rememberQuestion(question: PendingQuestion, status: 'offered' | 'pending' | 'deferred') {
    questionHistory.set(question.questionId, { question, status })
    return question
  }

  function finishQuestion(status: 'answered' | 'superseded') {
    if (waitingFor)
      questionHistory.set(waitingFor.questionId, { question: waitingFor, status })
    waitingFor = undefined
  }

  function revisionsMatch(expected: FastPathRevisions, actual: KioskRevisions) {
    return (expected.cart === undefined || expected.cart === actual.cart)
      && (expected.checkout === undefined || expected.checkout === actual.checkout)
      && (expected.menu === undefined || expected.menu === actual.menu)
      && (expected.selectedItem === undefined || expected.selectedItem === actual.selectedItem)
      && (expected.seating === undefined || expected.seating === actual.seating)
      && (expected.recommendation === undefined || expected.recommendation === actual.recommendation)
  }

  // Both decision and passive Host readers project the same issued target
  // question. Only the decision entrypoint creates/renews its answer lease.
  function clarificationSnapshot(context: DecisionContext, transcript?: string) {
    const pending = pendingFastPathClarification
    if (!pending || pending.context.phase !== context.phase || !revisionsMatch(pending.expectedRevisions, context.revisions))
      return undefined
    const issued = pending.issued
    const questionId = issued?.id ?? pending.id
    const pendingReferences = pending.context.references.filter(reference => pending.candidateRefs.includes(reference.refId))
    const resolvedRef = transcript === undefined ? undefined : resolveClarificationReference(transcript, pendingReferences)
    const choices = [...pending.candidateRefs.map((ref, index) => ({ description: `顧客指的是${pending.context.references.find(reference => reference.refId === ref)?.label ?? '指定餐點'}。`, id: `clarify:${questionId}:${index}`, requiresHighConfidence: true })), { id: `clarify:${questionId}:cancel`, description: '顧客取消這次待釐清的需求；保留購物車。' }]
    return {
      candidates: choices,
      waitingFor: { questionId, purpose: 'item-clarification', question: buildClarificationPrompt(pendingReferences), choices, expiresAt: issued?.expiresAt ?? 0 },
      catalogEvidence: context.catalogEvidence,
      interactionState: { ...context.interactionState, pendingIntent: pending.candidate.intent },
      retainedRequests: retainedRequests(context),
      phase: 'clarification',
      paymentState: options.checkout?.paymentStatus() ?? 'idle',
      references: publicReferences(pendingReferences),
      menuRevision: context.revisions.menu,
      revisions: context.revisions,
      ...(resolvedRef ? { resolvedCandidateId: `clarify:${questionId}:${pending.candidateRefs.indexOf(resolvedRef)}` } : {}),
    }
  }

  function configurationSnapshot(context: DecisionContext, transcript = '', issueAnswer = false) {
    const pending = pendingConfiguration
    if (!pending)
      return undefined
    if (context.phase !== 'ordering' || !revisionsMatch(pending.plan.expectedRevisions, context.revisions)) {
      pendingConfiguration = undefined
      return undefined
    }
    // A query may need its own target question while the unadded meal waits.
    // Answer that foreground clarification first, then resume the retained meal.
    if (pendingFastPathClarification && pendingFastPathClarification.context.phase === context.phase && revisionsMatch(pendingFastPathClarification.expectedRevisions, context.revisions))
      return undefined
    // The unadded meal lives until cancellation, reset or relevant state edits.
    // A fresh turn gets a distinct short-lived ticket, so late model answers
    // cannot overwrite this turn; read-only host snapshots never replace it.
    const questionId = issueAnswer ? crypto.randomUUID() : pending.issued?.id ?? pending.id
    const question = configurationQuestion(pending.plan, context.menu, questionId, transcript)
    if (!question)
      return undefined
    const cancel = { id: `configure:${questionId}:cancel`, description: '顧客明確表示取消／不要這筆尚未加入的餐點時才選，保留購物車；單說另一個品名或分類不是取消。' }
    const inquiry = { id: `configure:${questionId}:inquiry`, description: '顧客糾正不是要點這道，而是在問有沒有：放棄這筆未加入的需求，查詢同一餐點是否可點；不變更購物車、不猜份數。', requiresHighConfidence: true }
    // A quantity in pieces/weight is not a withdrawal or an availability query.
    // Give Jev a legal no-write continuation instead of forcing that false binary.
    const unitGuidance = question.slot === 'quantity' && !question.choices.length
      ? [{ id: `configure:${questionId}:unit-guidance`, description: '以顆數、重量或體積回答目前的份數問題，或要求換算份數；提醒以份為單位並繼續問份數，不加餐、不撤回需求。', requiresHighConfidence: true }]
      : []
    if (issueAnswer)
      pending.issued = { id: questionId, expiresAt: Date.now() + 30_000, transcript, choices: new Map(question.choices.map(choice => [choice.id, choice])), unitGuidanceId: unitGuidance[0]?.id }
    const choices = [...question.choices.map(({ id, description }) => ({ id, description, requiresHighConfidence: true })), ...unitGuidance, cancel, inquiry]
    const item = context.menu.find(item => item.id === pending.plan.slots.itemId)!
    // An unissued host snapshot describes the question but grants no answer
    // authority. The expiry belongs to the ticket, never to the retained meal.
    const expiresAt = pending.issued?.expiresAt ?? 0
    const waitingFor = { questionId, requestId: pending.id, purpose: 'item-configuration', question: question.prompt, expiresAt, choices }
    return { menuRevision: context.revisions.menu, revisions: context.revisions, ...(context.priceEvidence ? { priceEvidence: context.priceEvidence } : {}), constraints: context.constraints, ingredientReferences: context.ingredientReferences, dietaryReferences: context.dietaryReferences, unavailableConditionReferences: context.unavailableConditionReferences, phase: 'configuration', retainedRequests: retainedRequests(context), intentRecovery: intentRecovery(context, waitingFor), paymentState: 'idle', candidates: choices, catalogEvidence: context.catalogEvidence, interactionState: { ...context.interactionState, pendingIntent: 'ADD_ITEM' }, references: [{ refId: 'CONFIGURING_ITEM', label: item.name }], waitingFor }
  }

  function navigationSnapshot(context: DecisionContext, issueAnswer = false) {
    const pending = pendingNavigation
    if (!pending || pending.state !== 'choice')
      return undefined
    if (context.phase !== 'ordering' || options.visibleItemId?.() !== pending.itemId || !revisionsMatch(pending.revisions, context.revisions)) {
      pendingNavigation = undefined
      return undefined
    }
    if (issueAnswer)
      pending.issued = { id: crypto.randomUUID(), expiresAt: Date.now() + 30_000 }
    const questionId = pending.issued?.id ?? pending.id
    const destination = pending.name === 'cart_get' ? mealMessages.viewCart : fulfillmentModes.find(mode => mode.id === pending.input.mode)!.label
    const question: PresentedQuestion = {
      questionId,
      requestId: pending.id,
      purpose: 'draft-navigation',
      question: mealMessages.finishOrCancel.replace('{destination}', destination),
      expiresAt: pending.issued?.expiresAt ?? Date.now() + 30_000,
      choices: [
        { id: `navigate:${questionId}:complete`, description: '明確選擇先完成目前餐點，加入後再切換；不授權猜份數或加入。單說好／對無法決定二選一，不能選此項。' },
        { id: `navigate:${questionId}:cancel`, description: '明確選擇取消目前尚未加入的餐點，再執行剛才要求的切換；保留既有購物車。單說好／對無法決定二選一，不能選此項。' },
      ],
    }
    return { phase: 'clarification', waitingFor: question, candidates: question.choices.map(choice => ({ ...choice, requiresHighConfidence: true })), menuRevision: context.revisions.menu, revisions: context.revisions, retainedRequests: retainedRequests(context), interactionState: context.interactionState, paymentState: 'idle', intentRecovery: { kind: 'answer' as const, questionId, requestId: pending.id, candidateIds: question.choices.map(choice => choice.id) } }
  }

  async function answerNavigation(candidateId: string, onAction = options.onAction) {
    const pending = pendingNavigation
    const snapshot = navigationSnapshot(currentFastPathContext())
    if (!pending || !snapshot || !pending.issued || pending.issued.expiresAt <= Date.now() || !snapshot.candidates.some(choice => choice.id === candidateId))
      throw new Error('STALE_PLAN: The draft navigation choice expired or changed.')
    pending.issued = undefined
    if (candidateId.endsWith(':complete')) {
      pending.state = 'completing'
      const question = configurationSnapshot(currentFastPathContext(), '', true)?.waitingFor
      return { customerMessage: question?.question ?? mealMessages.finishCurrentMeal, ...(question ? { pendingCustomerChoice: question } : {}) }
    }
    pendingNavigation = undefined
    await closeMeal(pending.itemId, onAction)
    return await invoke(pending.name, pending.input, onAction)
  }

  function mealConfirmationSnapshot(context: DecisionContext, issueAnswer = false) {
    const question = issueAnswer ? mealClarification.issueAnswer(context) : mealClarification.question(context)
    options.onClarificationChange?.(question)
    if (!question)
      return undefined
    return { menuRevision: context.revisions.menu, revisions: context.revisions, ...(context.priceEvidence ? { priceEvidence: context.priceEvidence } : {}), constraints: context.constraints, ingredientReferences: context.ingredientReferences, dietaryReferences: context.dietaryReferences, unavailableConditionReferences: context.unavailableConditionReferences, intentRecovery: intentRecovery(context, question), phase: 'meal_confirmation', retainedRequests: retainedRequests(context), waitingFor: question, candidates: [...question.choices.map(choice => ({ ...choice, requiresHighConfidence: true })), ...(mealClarification.inquiry(context) ? [{ id: `inquire-meal:${question.questionId}`, description: '查詢目前確認的這款餐點現在是否可點，例如「我想問還有沒有」「還能點嗎」「沒有了嗎」；不是購買或否認購買，不新增餐點。', requiresHighConfidence: true }] : [])], catalogEvidence: context.catalogEvidence, paymentState: 'idle', interactionState: context.interactionState }
  }

  // All readers receive the same detached draft facts. A suspended draft from
  // a replaced catalog cannot resume and must not be presented as current.
  function retainedRequests(context: DecisionContext): ConversationContext['retainedRequests'] {
    const confirmation = mealClarification.progress(context)
    const drafts = [
      ...(pendingConfiguration ? [{ ...pendingConfiguration, status: confirmation ? 'suspended' as const : 'active' as const }] : []),
      ...suspendedConfigurations.map(draft => ({ ...draft, status: 'suspended' as const })),
    ]
    return [
      ...(confirmation ? [confirmation] : []),
      ...drafts.filter(draft => draft.plan.expectedRevisions.menu === context.revisions.menu && context.menu.some(item => item.id === draft.plan.slots.itemId))
        .map(draft => describeRequest(draft.id, draft.status, draft.plan, context.menu)),
    ]
  }

  function suspendMeal() {
    if (pendingConfiguration) {
      // Do not duplicate the same draft when a lookup returns to it.
      if (!suspendedConfigurations.some(draft => draft.id === pendingConfiguration!.id))
        suspendedConfigurations.push({ ...pendingConfiguration, issued: undefined })
      pendingConfiguration = undefined
    }
  }

  function activateMeal(plan: DomainPlan) {
    const retainedIndex = suspendedConfigurations.findIndex(draft => draft.plan.slots.itemId === plan.slots.itemId && draft.plan.expectedRevisions.menu === plan.expectedRevisions.menu)
    let retained = pendingConfiguration?.plan.slots.itemId === plan.slots.itemId ? pendingConfiguration : undefined
    if (retainedIndex >= 0)
      retained = suspendedConfigurations.splice(retainedIndex, 1)[0]
    if (pendingConfiguration?.plan.slots.itemId !== plan.slots.itemId)
      suspendMeal()
    const slots = { ...retained?.plan.slots, ...plan.slots }
    if (retained?.plan.slots.options && plan.slots.options) {
      const previous: Array<{ groupId: string, valueId: string }> = JSON.parse(String(retained.plan.slots.options))
      const next: Array<{ groupId: string, valueId: string }> = JSON.parse(String(plan.slots.options))
      slots.options = JSON.stringify([...new Map([...previous, ...next].map(option => [option.groupId, option])).values()])
    }
    const requestId = retained?.id ?? plan.requestId ?? crypto.randomUUID()
    pendingConfiguration = { id: requestId, plan: { ...plan, requestId, sourceUtterance: retained?.plan.sourceUtterance ?? plan.sourceUtterance, slots } }
    return pendingConfiguration
  }

  function clearMealProgress() {
    pendingNavigation = undefined
    pendingConfiguration = undefined
    suspendedConfigurations.length = 0
    mealClarification.clear()
    options.onClarificationChange?.(undefined)
  }

  async function beginMeal(plan: DomainPlan, onAction: MenuToolRuntimeOptions['onAction']) {
    const active = activateMeal(plan)
    const question = configurationQuestion(active.plan, machine.getMenu(), active.id)
    if (question) {
      await revealItem(String(plan.slots.itemId), onAction)
      // Bind our own selection effect without refreshing cart/menu authority.
      active.plan.expectedRevisions.selectedItem = machine.getRevisions().selectedItem
      return { customerMessage: question.prompt, pendingConfiguration: { id: active.id }, pendingCustomerChoice: configurationSnapshot(currentFastPathContext(), '', true)!.waitingFor }
    }
    const operation = compileOperationPlan(active.plan)
    if (authorize(operation, currentFastPathContext()).kind !== 'EXECUTE')
      throw new Error('The confirmed meal became stale before execution.')
    pendingConfiguration = undefined
    return await invoke(operation.toolName, operation.input, onAction)
  }

  function clarificationRevisions(refs: readonly string[], context: DecisionContext): FastPathRevisions {
    return {
      ...(refs.some(ref => ref.startsWith('cart:')) ? { cart: context.revisions.cart } : {}),
      ...(context.phase !== 'ordering' ? { checkout: context.revisions.checkout } : {}),
      ...(refs.some(ref => ref.startsWith('item:') || ref.startsWith('selected:') || ref.startsWith('cart:')) ? { menu: context.revisions.menu } : {}),
      ...(refs.some(ref => ref.startsWith('selected:')) ? { selectedItem: context.revisions.selectedItem } : {}),
    }
  }

  function publicReferences(references: readonly DomainReference[]): DomainReference[] {
    const counts: Record<string, number> = {}
    return references.map((reference) => {
      // Jev receives only per-turn ordinals. The issued context retains the
      // actual item/line mapping, and revisions invalidate that mapping.
      let prefix = 'CATEGORY'
      if (reference.refId.startsWith('cart:'))
        prefix = 'CART_LINE'
      else if (reference.refId.startsWith('selected:'))
        prefix = 'SELECTED_ITEM'
      else if (reference.refId.startsWith('item:'))
        prefix = 'ITEM'
      else if (reference.refId.startsWith('table:'))
        prefix = 'TABLE_CHOICE'
      counts[prefix] = (counts[prefix] ?? 0) + 1
      return { label: reference.label, refId: `${prefix}_${counts[prefix]}` }
    })
  }

  function confirmationIsValid(pending: PendingFastPathConfirmation, context: DecisionContext) {
    const validation = validateConfirmation(pending.record, {
      action: pending.operation.intent as PendingConfirmation['action'],
      cartRevision: context.revisions.cart,
      checkoutRevision: context.revisions.checkout,
      now: Date.now(),
      payload: pending.operation.slots,
      selectedItemRevision: context.revisions.selectedItem,
    })

    return validation.kind === 'VALID'
      && pending.cart === cartFingerprint(machine.getCart())
      && authorize(pending.operation, context).kind !== 'BLOCKED'
  }

  function confirmationSnapshot(context: DecisionContext) {
    const pending = pendingFastPathConfirmation
    if (!pending)
      return
    const valid = confirmationIsValid(pending, context)
    const confirmationId = pending.record.confirmationId
    const choices = [
      { id: `intent:confirm:${confirmationId}`, description: confirmationMessage(pending.operation, fulfillmentModes) },
      { id: `intent:cancel-confirmation:${confirmationId}`, description: '取消剛才待確認的操作，保留目前訂單及結帳進度。' },
    ]
    const question: PresentedQuestion = {
      questionId: confirmationId,
      purpose: 'operation-confirmation',
      question: confirmationMessage(pending.operation, fulfillmentModes),
      expiresAt: pending.record.expiresAt,
      choices,
    }
    // Keep expired/stale intent visible to Main: bare assent must not become
    // a choice for the underlying invoice page. Only a fresh request may replace it.
    return {
      phase: 'pending_confirmation' as const,
      waitingFor: question,
      candidates: valid ? choices : [],
      ...(valid && pending.presented ? { intentRecovery: { kind: 'answer' as const, questionId: confirmationId, candidateIds: choices.map(choice => choice.id) } } : {}),
      menuRevision: context.revisions.menu,
      revisions: context.revisions,
      retainedRequests: retainedRequests(context),
      interactionState: { ...context.interactionState, pendingAction: pending.record.action },
      paymentState: options.checkout?.paymentStatus() ?? 'idle',
    }
  }

  async function announce(
    label: string,
    targetId?: string,
    actionOptions: Pick<AgentAction, 'controlId' | 'expandCustomization'> = {},
    onAction = options.onAction,
  ) {
    await onAction({
      label,
      targetId,
      ...actionOptions,
    })
  }

  async function revealItem(itemId: string, onAction: MenuToolRuntimeOptions['onAction']) {
    // A retained quantity/options answer continues the visible dialog. Reopening
    // it would replay the item click; a separate lookup may have hidden it, though.
    if (options.screen?.() === 'item_configuration' && options.visibleItemId?.() === itemId)
      return
    const previousItemId = options.visibleItemId?.()
    if (previousItemId && previousItemId !== itemId)
      await closeMeal(previousItemId, onAction)
    if (options.screen?.() === 'cart_review')
      await leaveReview(onAction)
    const item = machine.getMenu().find(candidate => candidate.id === itemId)
    // Selection owns the dialog, not the browsing query. Replacing the grid
    // here loses the customer's category/filter when the dialog closes.
    machine.assertItemSelectable(itemId)
    await applyControl(`正在選擇${item?.name ?? '餐點'}`, itemId, {}, () => {
      machine.assertItemSelectable(itemId)
      // Opening the actual dialog establishes selection in its click handler.
      // Later quantity answers reuse this state rather than mutating outside a control.
      const selection = machine.selectMenuItem(itemId)
      options.onSelectionChange?.(selection)
      options.onMenuSelection(itemId)
    }, onAction)
  }

  async function applyControl<T>(label: string, targetId: string | undefined, action: Pick<AgentAction, 'controlId' | 'expandCustomization' | 'inputValue'>, apply: () => T | Promise<T>, onAction = options.onAction): Promise<T> {
    if (options.onControl && manualOperations === 0) {
      const startedAt = performance.now()
      try {
        return await options.onControl({ label, targetId, ...action }, apply)
      }
      finally {
        uiExecutionDurationMs += performance.now() - startedAt
      }
    }
    await announce(label, targetId, action, onAction)
    return await apply()
  }

  async function closeMeal(itemId: string, onAction = options.onAction) {
    if (options.visibleItemId?.() && options.visibleItemId() !== itemId)
      throw new Error('STALE_REQUEST: A different meal is now visible.')
    await applyControl('關閉餐點設定', itemId, { controlId: closeItemControlId(itemId) }, () => {
      if (pendingNavigation?.itemId === itemId)
        pendingNavigation = undefined
      if (pendingConfiguration?.plan.slots.itemId === itemId)
        pendingConfiguration = undefined
      const proposal = mealClarification.progress(currentFastPathContext())
      if (proposal?.itemId === itemId)
        mealClarification.clear()
      issuedFastPathContext = undefined
      machine.clearSelection(itemId)
      options.onMenuSelection(undefined)
    }, onAction)
  }

  async function leaveReview(onAction = options.onAction) {
    if (options.onControl && options.screen?.() === 'cart_review')
      await applyControl('繼續點餐', 'cart', { controlId: 'order:back' }, () => options.onMenuRequested?.(), onAction)
    else
      await options.onMenuRequested?.()
  }

  async function setSelectionQuantity(quantity: number, onAction = options.onAction) {
    let selection = machine.getSelection()
    if (!selection || !Number.isInteger(quantity) || quantity < 1 || quantity > 20)
      throw new Error('A selected meal and a quantity from 1 to 20 are required.')
    while (selection.quantity !== quantity) {
      const previous = selection
      const delta: 1 | -1 = quantity > selection.quantity ? 1 : -1
      selection = await applyControl(`設定數量為 ${selection.quantity + delta}`, selection.itemId, { controlId: quantityStepControlId(selection.itemId, delta > 0 ? 'increase' : 'decrease') }, () => {
        if (machine.getSelection()?.itemId !== previous.itemId || machine.getSelection()?.quantity !== previous.quantity)
          throw new Error('STALE_PLAN: The selected quantity changed before the click.')
        const next = machine.setQuantity(previous.quantity + delta)
        options.onSelectionChange?.(next)
        return next
      }, onAction)
    }
    return selection
  }

  async function revealReview(onAction: MenuToolRuntimeOptions['onAction']) {
    const screen = options.screen?.()
    // Reading an order must preserve the active checkout surface.
    if (screen === 'checkout')
      return
    if (screen !== 'cart_review')
      await applyControl('查看訂單', 'cart', { controlId: 'order:view' }, () => options.onReviewRequested?.(), onAction)
    const context = options.serviceContext?.()
    if (context?.serviceMode === 'table-service' && context.table && context.directSubmissionSupported) {
      const cart = cartFingerprint(machine.getCart())
      if (tableOrderReview?.contextId !== context.id || tableOrderReview.cart !== cart)
        tableOrderReview = { contextId: context.id, cart }
    }
  }

  async function invoke(name: MenuToolName, input: Record<string, unknown> = {}, onAction = options.onAction, queryTask?: typeof agentTask): Promise<unknown> {
    const uiDurationBefore = uiExecutionDurationMs
    if (name === 'order_set_fulfillment') {
      // Validate capabilities before opening a draft-navigation question. A
      // table-bound round cannot acquire a takeaway choice through that detour.
      if (!policy().choosesFulfillment)
        throw new Error('Fulfillment changes are unavailable for table service.')
      const mode = requiredFulfillmentMode(input)
      if (!fulfillmentModes.some(choice => choice.id === mode))
        throw new Error('This fulfillment mode is not offered by the POS.')
    }
    const visibleItemId = options.visibleItemId?.()
    if (manualOperations === 0 && visibleItemId && ((name === 'cart_get' && input.display !== false) || (name === 'order_set_fulfillment' && machine.getCart().fulfillmentMode !== input.mode))) {
      if (!navigationSnapshot(currentFastPathContext()))
        pendingNavigation = { id: crypto.randomUUID(), itemId: visibleItemId, name, input: { ...input }, revisions: currentFastPathRevisions(), state: 'choice', taskId: agentTask?.taskId }
      const snapshot = navigationSnapshot(currentFastPathContext())!
      return { cart: machine.getCart(), customerMessage: snapshot.waitingFor.question, pendingCustomerChoice: snapshot.waitingFor }
    }
    if ((tableSubmissionPending || tableSubmissionUncertain) && !isKioskHostOnlyToolName(name) && toolDefinitions.find(tool => tool.name === name)?.readOnly !== true)
      throw new Error('隨桌訂單尚待確認，請勿修改或重送。')
    if (name === 'menu_recommend' && input.more === true && recommendationBatch?.queries.length)
      recommendationBatch = { ...recommendationBatch, queries: [], exhausted: false }
    if (name === 'menu_get' && input.scope === 'catalog') {
      if (currentFastPathContext().phase !== 'ordering')
        throw new Error('Menu exploration is unavailable in the current phase.')
      clearQueryScope()
      if (input.query !== undefined || input.queries !== undefined || input.category !== undefined)
        throw new Error('Catalog scope cannot carry a precise meal or category query.')
      const filters = ingredientFilters(input)
      const previousFilters = recommendationBatch?.filters
      input = {
        ...input,
        display: true,
        excludeIngredients: [...new Set([...(previousFilters?.excludeIngredients ?? []), ...filters.excludeIngredients])],
        // Full-catalog browsing releases positive tastes (e.g. fish), while
        // exclusions/dietary restrictions above remain safety constraints.
        includeIngredients: filters.includeIngredients,
        ...(previousFilters?.dietary || filters.dietary ? { dietary: previousFilters?.dietary ?? filters.dietary } : {}),
        excludeItemIds: [...new Set([...(recommendationBatch?.excludedItemIds ?? []), ...menuExclusions(input, machine.getMenu())])],
      }
      if (recommendationBatch) {
        // Showing the catalog releases browsing scope, not dietary restrictions
        // or the record of dishes already recommended. All items remain visible.
        recommendationBatch = { ...recommendationBatch, category: '', queries: [], needs: [], prices: {}, filters: ingredientFilters(input), strategy: undefined, scope: undefined, exhausted: false }
      }
    }
    if (name === 'menu_get' || name === 'menu_recommend') {
      menuExclusions(input, machine.getMenu())
      const { category } = getMenuQuery(input)
      const categories = [...new Set(machine.getMenu().map(item => item.category))]
      // An invented label is an invalid query, not evidence of unavailable food.
      // Validate before replacing the customer's visible recommendation batch.
      if (category && !categories.includes(category))
        throw new Error(`UNKNOWN_CATEGORY: Use an exact POS category from ${JSON.stringify(categories)}; do not infer availability from this rejected query.`)
    }
    if ((name === 'menu_get' || name === 'menu_recommend') && input.scope !== 'catalog' && input.more !== true) {
      const { category, queries } = getMenuQuery(input)
      const prices = priceConditions(input)
      const filters = ingredientFilters(input)
      const hasConditions = Object.keys(prices).length > 0 || filters.dietary || filters.includeIngredients.length || filters.excludeIngredients.length
      // A fresh constrained broad read after recommendations has no declared
      // scope. Ask once rather than treating the prior batch as the catalog.
      const keepsKnownScope = input.action === 'update' && Boolean(recommendationBatch?.scope || recommendationBatch?.category)
      if (input.action !== 'reset' && !keepsKnownScope && !category && !queries.length && hasConditions && recommendationBatch?.menuRevision === machine.getRevisions().menu && presentationItemIds?.length && currentFastPathContext().phase === 'ordering') {
        if (!queryScope) {
          issuedFastPathContext = undefined
          pendingReadContinuation = undefined
          queryScope = createQueryScope({ questionId: crypto.randomUUID(), expiresAt: Date.now() + 120_000, revisions: { menu: machine.getRevisions().menu, recommendation: recommendationRevision }, shownItemIds: presentationItemIds, conditions: { ...prices, ...filters } })
          queryScopeInput = { name, input: { ...input, ...prices, ...filters, excludeItemIds: menuExclusions(input, machine.getMenu()), ...(input.needs ? { needs: recommendationNeeds(input) } : {}) } }
        }
        options.onQueryScopeChange?.(queryScope.question)
        return { customerMessage: queryScope.question.question, pendingCustomerChoice: queryScope.question }
      }
    }
    if (name === 'menu_get' && input.scope !== 'catalog' && input.display === true && input.verifyClaim !== true) {
      const { category, queries } = getMenuQuery(input)
      const filters = ingredientFilters(input)
      if (!category && !queries.length && !filters.dietary && !filters.excludeIngredients.length && !filters.includeIngredients.length && !menuExclusions(input, machine.getMenu()).length && !Object.keys(priceConditions(input)).length) {
        if (!['ordering', 'customer_entry'].includes(currentFastPathContext().phase))
          throw new Error('Menu exploration is unavailable in the current phase.')
        // Customer-facing broad browsing shares the same batches as semantic
        // exploration. Explicit data-only reads still return the catalog.
        name = 'menu_recommend'
        input = recommendationBatch && recommendationBatch.menuRevision === machine.getRevisions().menu ? { more: true } : {}
      }
    }
    let result: unknown
    try {
      result = await invokeOperation(name, input, onAction, undefined, queryTask)
    }
    catch (error) {
      if (error instanceof QuantityLimitError)
        return invocationFailure(name, error)
      if (error instanceof ItemSelectionError)
        options.onMenuChanged?.(machine.getMenu())
      throw error
    }
    if (pendingNavigation?.state === 'completing' && ['order_add_item', 'cart_add_item'].includes(name) && result && typeof result === 'object' && 'line' in result) {
      const line = result.line as { itemId: string }
      if (line.itemId === pendingNavigation.itemId) {
        // Consume before awaiting the switch. Failure cannot replay the accepted add.
        const navigation = pendingNavigation
        pendingNavigation = undefined
        const next = await invoke(navigation.name, navigation.input, onAction)
        return { ...result, ...(next && typeof next === 'object' ? next : {}), customerMessage: [Reflect.get(result, 'customerMessage'), next && typeof next === 'object' ? Reflect.get(next, 'customerMessage') : undefined].filter(Boolean).join('') }
      }
    }
    if (queryScope && !isKioskHostOnlyToolName(name) && !menuBrowsingToolNames.has(name) && !['cart_get', 'seating_get'].includes(name))
      clearQueryScope()
    if (name === 'kiosk_fast_path_context' && result && typeof result === 'object') {
      const context = currentFastPathContext(typeof input.transcript === 'string' ? input.transcript : '')
      const snapshot = result as { candidates?: Array<{ id: string }> }
      const hasQuantityAnswer = snapshot.candidates?.some(choice => choice.id.startsWith('configure:') && choice.id.includes(':quantity:'))
      const configuringItemId = typeof pendingConfiguration?.plan.slots.itemId === 'string' ? pendingConfiguration.plan.slots.itemId : undefined
      const currentNamedItem = context.productResolution.references[0]?.refId === `item:${configuringItemId}`
      const proposal = mealClarification.offer(context, configuringItemId, !hasQuantityAnswer || !currentNamedItem)
      if (proposal)
        return { ...result, clarificationOffer: proposal }
    }
    if (!isKioskHostOnlyToolName(name) && result && typeof result === 'object') {
      const payload = result as Record<string, unknown>
      if (options.onControl && uiExecutionDurationMs > uiDurationBefore)
        payload.executionTiming = { uiDurationMs: Math.round(uiExecutionDurationMs - uiDurationBefore) }
      const order = payload.order as SubmittedOrder | undefined
      if (name === 'checkout_start' && (payload.ok === false || (order && order.receipt.status !== 'accepted'))) {
        tableOrderReview = undefined
        finishQuestion('superseded')
        offeredQuestion = undefined
        delete payload.pendingCustomerChoice
        return result
      }

      if ((result as Record<string, unknown>).presentation)
        presentationFocus = { menuRevision: currentFastPathRevisions().menu }
      if (name === 'order_ask_question')
        return result
      const asksNext = ['order_add_item', 'cart_add_item', 'cart_get', 'cart_remove_item', 'cart_set_line_quantity', 'cart_set_line_option', 'order_set_fulfillment', 'order_set_party_size', 'seating_reserve', 'checkout_start', 'checkout_skip_membership', 'checkout_choose_invoice', 'checkout_request_tax_id', 'checkout_set_tax_id', 'checkout_confirm_tax_id', 'checkout_confirm_invoice', 'checkout_cancel'].includes(name)
      if (asksNext) {
        const reviewCurrent = tableOrderReview?.contextId === options.serviceContext?.()?.id && tableOrderReview?.cart === cartFingerprint(machine.getCart())
        // Adding food does not mean the cart has been reviewed. Table checkout
        // questions become available only on the actual review surface.
        offeredQuestion = !policy().requiresPayment && !reviewCurrent ? undefined : createQuestion(currentFastPathContext(), crypto.randomUUID(), Date.now())
        if (offeredQuestion) {
          rememberQuestion(offeredQuestion, 'offered')
          if (tableOrderReview && reviewCurrent && 'cart' in (result as Record<string, unknown>))
            tableOrderReview.questionId = offeredQuestion.questionId
        }
        // A cart read/edit or reaffirmed fulfillment does not answer an
        // unrelated question. Actual domain progress retires it in context.
        const payload = result as Record<string, unknown>
        delete payload.pendingCustomerChoice
        if (offeredQuestion)
          payload.pendingCustomerChoice = offeredQuestion
      }
    }
    return result
  }

  async function invokeOperation(name: MenuToolName, input: Record<string, unknown>, onAction: MenuToolRuntimeOptions['onAction'], scopeSelection?: SelectedQueryScope, queryTask?: typeof agentTask): Promise<unknown> {
    const scopeLabel = scopeSelection ? scopeSelection.scope === 'SHOWN' ? mealMessages.queryScope.shown : mealMessages.queryScope.catalog : undefined
    if (policy().requiresPayment && options.orderingReady?.() === false && !isKioskHostOnlyToolName(name) && name !== 'customer_skip_phone' && (name !== 'order_ask_question' || input.purpose !== 'customer-entry'))
      throw new Error('請在開始畫面輸入手機號碼或選擇略過，再開始點餐。')
    const presentationToolName = menuPresentationToolFor(name, input)
    if (presentationToolName)
      await options.onMenuPresentationActivity?.({ state: 'loading', toolName: presentationToolName })

    try {
      switch (name) {
        case 'kiosk_test_menu': {
          if (!options.testing)
            throw new Error('Menu simulation is disabled.')
          if (input.itemId !== undefined || input.state !== undefined) {
            if (!['ordering', 'customer_entry'].includes(currentFastPathContext().phase) || typeof input.itemId !== 'string' || !menuPageStates.includes(input.state as MenuPageState))
              throw new Error('Choose a real item and page state before checkout.')
            machine.setItemPageState(input.itemId, input.state as MenuPageState)
            options.onMenuChanged?.(machine.getMenu())
          }
          return { items: machine.getMenu().map(item => ({ id: item.id, name: item.name, state: menuPageState(item) })) }
        }
        case 'kiosk_customer_entry_start': {
          if (!options.onCustomerEntryRequested)
            throw new Error('此服務未提供 Host 電話登記。')
          options.onCustomerEntryRequested()
          return { phase: policy().requiresPayment && options.orderingReady?.() === false ? 'customer_entry' : 'ordering' }
        }
        case 'kiosk_customer_phone': {
          if (!options.onCustomerPhoneProvided || options.orderingReady?.() !== false || typeof input.phone !== 'string' || !/^09\d{8}$/.test(input.phone))
            throw new Error('只能在電話頁提交顧客手動輸入的 10 碼手機號碼。')
          options.onCustomerPhoneProvided(input.phone)
          return { customerMessage: '已完成手機登記，現在可以開始點餐。' }
        }
        case 'customer_skip_phone': {
          if (input.confirmedByUser !== true || !options.onCustomerEntrySkipped || options.orderingReady?.() !== false)
            throw new Error('只能在電話頁依顧客明確選擇略過。')
          options.onCustomerEntrySkipped()
          return { customerMessage: '已略過手機登記，現在可以直接點餐。' }
        }
        case 'menu_open': {
          if (!options.onMenuRequested || currentFastPathContext().phase !== 'ordering')
            throw new Error('Returning to the menu is unavailable in this phase.')
          const itemId = options.visibleItemId?.()
          if (itemId)
            await closeMeal(itemId, onAction)
          await leaveReview(onAction)
          const catalog = await applyControl('查看全部菜單', undefined, { controlId: 'menu:all' }, () => invoke('menu_get', { scope: 'catalog', display: true }, onAction, queryTask), onAction) as Record<string, unknown>
          return { ...catalog, customerMessage: '已回到全部菜單，接下來想看哪一道餐點？', cart: machine.getCart() }
        }
        case 'menu_scroll': {
          if (input.direction !== 'UP' && input.direction !== 'DOWN')
            throw new Error('direction must be UP or DOWN.')
          if (!options.onMenuScroll || currentFastPathContext().phase !== 'ordering')
            throw new Error('Menu scrolling is unavailable in the current phase.')
          const result = options.onMenuScroll(input.direction)
          return { ...result, customerMessage: result.status === 'BOUNDARY' ? '已經到菜單邊界。' : result.status === 'MOVED' ? '已移動菜單畫面。' : '目前無法移動菜單畫面。' }
        }
        case 'kiosk_dialogue_presented': {
          requiredString(input, 'content')
          if (input.interruptsQuestion === true && !input.questionId) {
            // The host marks a plain Main Agent reply, not ordinary tool status
            // prose. Retain the transaction while revoking its former answer and
            // execution tickets; a later acknowledgement cannot revive them.
            finishQuestion('superseded')
            if (offeredQuestion)
              questionHistory.set(offeredQuestion.questionId, { question: offeredQuestion, status: 'superseded' })
            offeredQuestion = undefined
            pendingFastPathConfirmation = undefined
            issuedFastPathContext = undefined
          }
          if (typeof input.questionId === 'string')
            mealClarification.markPresented(input.questionId, currentFastPathContext())
          if (pendingNavigation && navigationSnapshot(currentFastPathContext())?.waitingFor.questionId === input.questionId)
            pendingNavigation.presented = true
          if (pendingFastPathConfirmation && input.questionId === pendingFastPathConfirmation.record.confirmationId && confirmationIsValid(pendingFastPathConfirmation, currentFastPathContext()))
            pendingFastPathConfirmation.presented = true
          if (offeredQuestion && offeredQuestion.phase === currentFastPathContext().phase && questionIsCurrent(offeredQuestion, currentFastPathRevisions(), Date.now()) && input.questionId === offeredQuestion.questionId) {
            finishQuestion('superseded')
            waitingFor = rememberQuestion({ ...offeredQuestion }, 'pending')
            offeredQuestion = undefined
          }
          // Plain read/acknowledgement prose is not a question transition.
          // It neither activates an unpresented offer nor forgets a pending one.
          return { recorded: true }
        }
        case 'kiosk_question_validate': {
          if (queryScope && queryScope.question.questionId === input.questionId) {
            const probe = queryScope.resolve({ questionId: input.questionId as string, choice: 'ASK' }, { menu: machine.getRevisions().menu, recommendation: recommendationRevision })
            return probe.status === 'WAITING' ? { pendingCustomerChoice: probe.question } : {}
          }

          const current = currentFastPathContext()
          const navigation = navigationSnapshot(current)
          if (navigation && navigation.waitingFor.questionId === input.questionId)
            return { pendingCustomerChoice: navigation.waitingFor }
          const confirmation = confirmationSnapshot(current)
          if (confirmation && confirmation.waitingFor.questionId === input.questionId && confirmation.waitingFor.expiresAt > Date.now() && pendingFastPathConfirmation && confirmationIsValid(pendingFastPathConfirmation, current))
            return { pendingCustomerChoice: confirmation.waitingFor }
          const mealQuestion = mealClarification.question(current)
          if (mealQuestion?.questionId === input.questionId)
            return { pendingCustomerChoice: mealQuestion }
          const configuration = configurationSnapshot(current)
          if (configuration?.waitingFor?.questionId === input.questionId)
            return { pendingCustomerChoice: configuration?.waitingFor }
          return offeredQuestion && offeredQuestion.questionId === input.questionId && offeredQuestion.phase === current.phase && questionIsCurrent(offeredQuestion, current.revisions, Date.now())
            ? { pendingCustomerChoice: describeQuestion(offeredQuestion) }
            : {}
        }
        case 'menu_confirm_item': {
          if (!agentTask || agentTask.readOnly || agentTask.expiresAt <= Date.now() || agentTask.menuRevision !== machine.getRevisions().menu)
            throw new Error('A current ordering task is required to propose a meal.')
          const source = deriveDecisionContext({ ...currentFastPathContext(), transcript: agentTask.transcript })
          source.constraints = { ...source.constraints, exclude: agentTask.filters.excludeIngredients, include: agentTask.filters.includeIngredients, dietary: agentTask.filters.dietary, price: agentTask.prices, unresolvedPrice: agentTask.unresolvedPrice }
          if (input.originalRecipe === true && !hasPreparationRequest(source))
            throw new Error('Original recipe confirmation requires a preparation request in this turn.')
          const question = mealClarification.propose(source, requiredString(input, 'itemId'), typeof input.replaceLineId === 'string' ? input.replaceLineId : undefined, input.originalRecipe === true, agentTask.taskId)
          options.onClarificationChange?.(question)
          return { pendingCustomerChoice: question, outcome: { status: 'needs-confirmation', intent: input.replaceLineId ? 'REPLACE_ITEM' : 'ADD_ITEM', itemIds: [input.itemId], taskId: agentTask.taskId } }
        }
        case 'order_ask_question': {
          if (input.purpose === 'checkout-entry' && !policy().requiresPayment)
            await revealReview(onAction)
          const offered = createQuestion(currentFastPathContext(), crypto.randomUUID(), Date.now())
          if (!offered || offered.purpose !== input.purpose)
            throw new Error('This question is not legal in the current phase.')
          if ('question' in input)
            throw new Error('Question wording is application-owned; supply only purpose.')
          offeredQuestion = offered
          if (offered.purpose === 'checkout-entry' && tableOrderReview)
            tableOrderReview.questionId = offered.questionId
          rememberQuestion(offered, 'offered')
          return { pendingCustomerChoice: offeredQuestion }
        }
        case 'order_cancel_request': {
          const requestId = requiredString(input, 'requestId')
          const active = pendingConfiguration?.id === requestId
          const suspended = suspendedConfigurations.findIndex(request => request.id === requestId)
          if (!active && suspended < 0)
            return { ok: false, executed: false, error: 'STALE_REQUEST', customerMessage: '這項未完成需求已不存在，購物車仍保留。' }
          if (active) {
            await closeMeal(String(pendingConfiguration!.plan.slots.itemId), onAction)
            pendingConfiguration = undefined
          }
          else {
            suspendedConfigurations.splice(suspended, 1)
          }
          // Revoke this draft's issued speech ticket without touching cart lines
          // or resurrecting a different suspended meal as the current question.
          issuedFastPathContext = undefined
          options.onClarificationChange?.(undefined)
          return { cancelledRequestId: requestId, cart: machine.getCart(), customerMessage: '已撤回這項尚未加入的餐點需求，購物車仍保留。' }
        }
        case 'order_defer_question': {
          if (currentFastPathContext().waitingFor?.questionId !== input.questionId)
            throw new Error('STALE_PLAN: the question is no longer current.')
          rememberQuestion(waitingFor!, 'deferred')
          return { customerMessage: '好的，保留目前訂單，你可以繼續提出需求。' }
        }
        case 'menu_get':
        {
          const { category, queries } = getMenuQuery(input)
          const prices = priceConditions(input)
          // Price-qualified customer reads share the recommendation batch owner:
          // ranking precedes the three-item cap and later alternatives keep scope.
          if (input.scope !== 'catalog' && Object.keys(prices).length && input.display !== false) {
            if (scopeSelection)
              return await invokeOperation('menu_recommend', { ...input, ...prices }, onAction, scopeSelection)
            return await invoke('menu_recommend', { ...input, ...prices })
          }
          const categories = [...new Set(machine.getMenu().map(item => item.category))]
          const appliedFilters = ingredientFilters(input)
          const excludedItemIds = menuExclusions(input, machine.getMenu())
          const scope = machine.getMenu(category || undefined).filter(item => (!scopeSelection?.itemIds || scopeSelection.itemIds.includes(item.id)) && !excludedItemIds.includes(item.id) && (queries.length === 0 || queries.some(query => itemMatchesQuery(item, query))))
          // Literal absence is not semantic absence. Return discovery evidence
          // separately; it cannot become items or authorize a purchase.
          const candidateMenu = filterIngredients(filterPrices(machine.getMenu(category || undefined).filter(item => !excludedItemIds.includes(item.id)), prices), appliedFilters).matches
          const possibleItems = queries.length && !scope.length && input.verifyClaim !== true
            ? [...new Map(queries.flatMap(query => findMenuCandidates(candidateMenu, query)).map(item => [item.id, item])).values()].slice(0, 3)
            : []
          const itemStatuses = queries.length ? scope.map(itemAvailability) : []
          if (input.verifyClaim === true && !queries.length)
            throw new Error('Specify the meal names being verified with query or queries.')
          let queryMessage = itemStatuses.map(item => item.customerMessage).join('')
          let nextQuestion: string | undefined
          const pricedItemIds: string[] = []
          // Host speaks this receipt rather than generated Main prose. Retain
          // the item's own description too, so portion/content questions do not
          // lose their answer when reduced to availability and price.
          if (scope.length === 1) {
            const item = scope[0]!
            queryMessage += describeOrderingDetails(item.price, item.description === item.name ? '' : item.description)
            pricedItemIds.push(item.id)
            // Guidance is not consent and creates no order or confirmation.
            if (queries.length && itemAvailability(item).status === 'available')
              nextQuestion = orderingMessages['zh-Hant'].singleItemGuide
          }
          if (queries.length && !scope.length) {
            queryMessage = possibleItems.length
              ? mealMessages.possibleMenu.replace('{items}', possibleItems.map(item => item.name).join('、'))
              : mealMessages.queryNotFound.replace('{items}', queries.join('、'))
          }
          const verificationMessage = input.verifyClaim === true
            ? `${scope.length ? mealMessages.verifiedMenuClaim : mealMessages.correctedMenuClaim}${queryMessage}`
            : undefined
          const filtered = filterIngredients(filterPrices(scope, prices), appliedFilters)
          const hasIngredientFilters = appliedFilters.excludeIngredients.length > 0 || appliedFilters.includeIngredients.length > 0
          const filterDescription = ingredientFilterDescription(appliedFilters)
          const searchScope = filtered.matches
          const subjects: QueryPresentationSubject[] = queries.length > 0
            ? queries.map(query => ({
                id: `query:${query}`,
                itemIds: searchScope.filter(item => itemMatchesQuery(item, query)).map(item => item.id),
                label: query,
              })).filter(subject => subject.itemIds.length > 0)
            : category
              ? [{ id: `category:${category}`, itemIds: searchScope.map(item => item.id), label: category }]
              : []
          const matchedItemIds = new Set(subjects.flatMap(subject => subject.itemIds))
          const items = searchScope
            .filter(item => queries.length === 0 || matchedItemIds.has(item.id))
            .map(menuItemForAgent)

          // A filtered lookup reflects what the customer is discussing. Keep
          // the visible menu synchronized with that result without depending
          // on the model to remember a second presentation-only tool call.
          const proposedItems = !items.length && possibleItems.length > 0
          const visibleSubjects = subjects.length ? subjects : categories.map(category => ({ id: `category:${category}`, label: category, itemIds: items.filter(item => item.category === category).map(item => item.id) }))
          const presentation = (category || queries.length > 0 || input.display === true || hasIngredientFilters || (excludedItemIds.length > 0 && input.display !== false))
            ? {
                kind: 'query-results' as const,
                itemIds: proposedItems ? possibleItems.map(item => item.id) : input.scope === 'catalog' ? items.map(item => item.id) : coverageItemIds(visibleSubjects),
                subjects: proposedItems ? [] : visibleSubjects,
                ...(proposedItems ? { proposedAlternatives: true } : {}),
                title: hasIngredientFilters ? `成分篩選：${filterDescription}` : queries.length === 1 ? `與「${queries[0]}」相關的餐點` : queries.length > 1 ? '顧客提到的餐點' : category ? `${category}餐點` : '目前販售餐點',
              }
            : undefined
          if (presentation && input.display !== false) {
            if (scopeLabel)
              presentation.title = `${scopeLabel} · ${presentation.title}`
            // Main may split one inquiry into sequential or parallel lookups.
            // Retain their subjects within this read-only task; a repeated
            // subject replaces its old matches, while a new task starts fresh.
            if (queryTask?.readOnly && queryTask === agentTask && input.display !== false && queries.length && !proposedItems) {
              const retained = new Map(queryTask.querySubjects?.map(subject => [subject.id, subject]))
              for (const query of queries)
                retained.delete(`query:${query}`)
              for (const subject of subjects)
                retained.set(subject.id, subject)
              queryTask.querySubjects = [...retained.values()]
              presentation.subjects = queryTask.querySubjects
              presentation.itemIds = coverageItemIds(presentation.subjects)
              if (presentation.subjects.length > 1 || (subjects.length === 0 && presentation.subjects.length > 0))
                presentation.title = '顧客提到的餐點'
            }
            // Cursor/paint work can yield to a successor task. An old response
            // still returns its data, but cannot replace the successor's grid.
            if (!queryTask || (queryTask === agentTask && queryTask.expiresAt > Date.now())) {
              presentationItemIds = presentation.itemIds
              recommendationRevision++
              if (input.scope === 'catalog')
                options.onQueryStateChange?.(getQueryState())
              await options.onRecommendationsChange?.(presentation)
            }
          }
          const literalDetails = queries.length > 0 && !hasIngredientFilters && !appliedFilters.dietary && !Object.keys(prices).length
          let facts = queryMessage
          if (verificationMessage !== undefined)
            facts = verificationMessage
          else if (!literalDetails)
            facts = `${hasIngredientFilters ? `${filterDescription}：` : ''}${items.length ? `我找到：${items.map(item => item.name).join('、')}。` : emptyFilterMessage(filterAvailability(filtered, items.length))}${items.length && filtered.customizable.length ? '另有餐點需要客製，尚未修改或加入。' : ''}${items.length && filtered.unknown.length ? '部分餐點資料不足，未列為符合。' : ''}`
          const displayReply = category || queries.length > 0 || input.display === true || hasIngredientFilters || (excludedItemIds.length > 0 && input.display !== false)
          // Display invitations are separate from factual evidence and never grant consent.
          const customerReply = displayReply
            ? {
                facts: possibleItems.length ? '' : facts,
                nextQuestion: possibleItems.length ? facts : nextQuestion ?? orderingMessages['zh-Hant'].browseQuestion,
                pricedItemIds: literalDetails || verificationMessage ? pricedItemIds : [],
                queryKey: JSON.stringify({ category, queries, prices, appliedFilters, excludedItemIds }),
              }
            : undefined
          return {
            // Host replies must not narrate this internal catalog as a second
            // recommendation before the Agent has applied the customer's scope.
            dataOnly: input.display === false,
            ...(recommendationBatch?.menuRevision === machine.getRevisions().menu ? { queryState: { category: recommendationBatch.category, queries: recommendationBatch.queries, prices: recommendationBatch.prices, filters: recommendationBatch.filters, exhausted: recommendationBatch.exhausted } } : {}),
            catalog: catalogInfo,
            categories,
            ingredientDefinitions,
            fulfillmentModes,
            items,
            matchKind: scope.length ? 'literal' : possibleItems.length ? 'possible' : 'none',
            ...(possibleItems.length ? { possibleItems: possibleItems.map(menuItemForAgent), candidateSearch: 'fuzzy', guidance: { reason: 'possible', itemIds: possibleItems.map(item => item.id) } } : {}),
            itemStatuses,
            requestedQueries: queries,
            excludedItemIds,
            appliedFilters,
            appliedPriceConditions: prices,
            availability: filterAvailability(filtered, items.length),
            customizable: filtered.customizable.map(({ item, requiredOptions }) => ({ item: menuItemForAgent(item), requiredOptions })),
            unknownCompositionItems: filtered.unknown.map(menuItemForAgent),
            ...(customerReply ? { customerReply, customerMessage: renderCustomerReply(customerReply) } : {}),
            ...(presentation && input.display !== false ? { presentation } : {}),
          }
        }
        case 'menu_recommend': {
          const previous = input.more === true ? recommendationBatch : undefined
          // More keeps the confirmed universe without turning that universe
          // into food exclusions which could leak into a later fresh query.
          const suppliedScope = getMenuQuery(input)
          const retainsSubject = recommendationBatch?.category === suppliedScope.category && JSON.stringify(recommendationBatch?.queries) === JSON.stringify(suppliedScope.queries)
          let actionScope: SelectedQueryScope | undefined
          if (input.action === 'reset' || (input.action === 'update' && !recommendationBatch))
            actionScope = { scope: 'CATALOG' }
          else if (input.action === 'update' && retainsSubject)
            actionScope = recommendationBatch?.scope
          // An owned scope reply takes precedence; continuation retains its
          // confirmed universe, while explicit reset starts from the catalog.
          const selectedScope = scopeSelection ?? previous?.scope ?? actionScope
          const selectedScopeLabel = selectedScope ? selectedScope.scope === 'SHOWN' ? mealMessages.queryScope.shown : mealMessages.queryScope.catalog : undefined
          if (input.more === true && (previous ? previous.menuRevision !== machine.getRevisions().menu : !presentationItemIds?.length || presentationFocus?.menuRevision !== machine.getRevisions().menu))
            throw new Error('Recommendation context is absent or the catalog changed; start a new recommendation.')
          const excludedItemIds = [...new Set([...(previous?.excludedItemIds ?? []), ...menuExclusions(input, machine.getMenu())])]
          const needs = input.needs === undefined && previous ? previous.needs : recommendationNeeds(input)
          const strategy = input.strategy === undefined ? previous?.strategy : input.strategy
          if (strategy !== undefined && strategy !== 'POPULAR' && strategy !== 'NEW_ARRIVAL' && strategy !== 'CHEF_SPECIAL')
            throw new Error('Unsupported recommendation strategy.')
          if (previous && input.strategy !== undefined && strategy !== previous.strategy)
            throw new Error('Strategy changed; start a new recommendation without more.')
          const now = Date.now()
          if (strategy && !machine.getMenu().some(item => item.available !== false && currentRecommendationSignal(item.recommendationSignals, strategy, now)))
            throw new Error('Unsupported recommendation strategy: POS ranking evidence is absent or expired.')
          const suppliedPrices = priceConditions(input)
          if (previous && Object.entries(suppliedPrices).some(([key, value]) => previous.prices[key as keyof PriceConditions] !== value))
            throw new Error('Price conditions changed; start a new recommendation without more.')
          const prices = previous?.prices ?? suppliedPrices
          if (previous && ((suppliedScope.category && suppliedScope.category !== previous.category) || (suppliedScope.queries.length && JSON.stringify(suppliedScope.queries) !== JSON.stringify(previous.queries))))
            throw new Error('Menu scope changed; start a new recommendation without more.')
          const { category, queries } = previous ?? suppliedScope
          const limit = input.limit === undefined ? 3 : requiredNumber(input, 'limit')
          if (!Number.isInteger(limit) || limit < 1 || limit > 3)
            throw new Error('limit must be an integer from 1 to 3.')

          const filters = ingredientFilters(input)
          const appliedFilters = previous
            ? {
                excludeIngredients: [...new Set([...previous.filters.excludeIngredients, ...filters.excludeIngredients])],
                includeIngredients: [...new Set([...previous.filters.includeIngredients, ...filters.includeIngredients])],
                ...(filters.dietary || previous.filters.dietary ? { dietary: filters.dietary ?? previous.filters.dietary } : {}),
              }
            : filters
          // Budget refers to one dish's base price, not the whole order or
          // customized price. Scope all result classes before composition
          // checks so an over-budget unknown dish cannot mask a known absence.
          const scope = machine.getMenu(category || undefined).filter(item => (!selectedScope?.itemIds || selectedScope.itemIds.includes(item.id)) && !excludedItemIds.includes(item.id) && (!queries.length || queries.some(query => itemMatchesQuery(item, query))) && needs.every(need => item.recommendationTags.includes(need)) && (!strategy || currentRecommendationSignal(item.recommendationSignals, strategy, now)))
          const filtered = filterIngredients(filterPrices(scope, prices), appliedFilters)
          const hasIngredientFilters = appliedFilters.excludeIngredients.length > 0 || appliedFilters.includeIngredients.length > 0
          const ranked = strategy && !prices.priceOrder
            ? filtered.matches.filter(item => currentRecommendationSignal(item.recommendationSignals, strategy, now)).sort((a, b) => currentRecommendationSignal(a.recommendationSignals, strategy, now)!.rank - currentRecommendationSignal(b.recommendationSignals, strategy, now)!.rank)
            : filtered.matches
          let historyIds = previous?.seenIds
          if (!historyIds) {
            if (input.more === true && !recommendationBatch) {
              // A precise lookup can precede the first recommendation batch.
              // Exclude its displayed meal when the customer asks for others.
              historyIds = new Set(presentationItemIds)
            }
            else if (input.action === 'update' || input.action === 'reset') {
              // A changed scope retains history for future continuations;
              // excludeShown below decides whether to hide it in this batch.
              historyIds = recommendationBatch?.seenIds
            }
          }
          const seenIds = input.more === true || input.action === 'reset' || input.excludeShown === true ? historyIds : undefined
          const eligible = ranked
            .filter(item => item.available !== false)
            .filter(item => needs.every(need => item.recommendationTags.includes(need)))
            .filter(item => !seenIds?.has(item.id))
          if (input.more === true && eligible.length === 0 && filterAvailability(filtered, 0) === 'NONE') {
            return { ...await queryGuidance('exhausted', input.display !== false), needs, appliedPriceConditions: prices, appliedFilters, excludedItemIds, ...(prices.maxPrice !== undefined ? { maxPrice: prices.maxPrice } : {}), availability: 'NONE' }
          }
          const items = eligible.slice(0, limit)
            .map(menuItemForAgent)
          recommendationBatch = { ...(selectedScope ? { scope: selectedScope } : {}), seenIds: new Set([...(historyIds ?? []), ...items.map(item => item.id)]), exhausted: eligible.length <= items.length, hadMatches: ranked.length > 0, filters: appliedFilters, excludedItemIds, needs, prices, category, queries, ...(strategy ? { strategy } : {}), menuRevision: machine.getRevisions().menu }
          recommendationRevision++
          options.onQueryStateChange?.(getQueryState())
          const title = [category, ...queries, ingredientFilterDescription(appliedFilters), priceDescription(prices)].filter(Boolean).join('、')
          const presentation = items.length > 0 || hasIngredientFilters || excludedItemIds.length > 0 || Object.keys(prices).length > 0 || input.more === true || Boolean(category) || queries.length > 0
            ? {
                kind: 'recommendation' as const,
                itemIds: items.map(item => item.id),
                ...(title
                  ? { title }
                  : needs.length === 0
                    ? { reason: '從目前供應的餐點中提供幾個選擇。', title: '為你推薦' }
                    : { title: '為你推薦' }),
              }
            : undefined
          if (presentation) {
            if (selectedScopeLabel)
              presentation.title = `${selectedScopeLabel} · ${presentation.title}`
            presentationItemIds = presentation.itemIds
            await options.onRecommendationsChange?.(presentation)
          }
          const guidance = !items.length && filterAvailability(filtered, 0) === 'NONE' ? await queryGuidance('empty', input.display !== false) : undefined
          return {
            customerMessage: `${hasIngredientFilters ? `${ingredientFilterDescription(appliedFilters)}：` : ''}${items.length > 0
              ? `推薦${items.length === 1 ? '一項' : `${items.length} 項`}：${items.map(item => item.name).join('、')}。`
              : input.more === true && filterAvailability(filtered, items.length) === 'NONE' ? '目前沒有其他符合原條件且尚未推薦的餐點。' : emptyFilterMessage(filterAvailability(filtered, items.length))}${items.length && filtered.customizable.length ? '另有餐點需要客製，尚未修改或加入。' : ''}${items.length && filtered.unknown.length ? '部分餐點資料不足，未列為符合。' : ''}`,
            items,
            ...(input.action ? { queryAction: input.action } : {}),
            queryState: { category, queries, prices, filters: appliedFilters, exhausted: recommendationBatch.exhausted },
            needs,
            excludedItemIds,
            ...(prices.maxPrice !== undefined ? { maxPrice: prices.maxPrice } : {}),
            appliedPriceConditions: prices,
            ...(strategy ? { strategy } : {}),
            appliedFilters,
            availability: filterAvailability(filtered, items.length),
            customizable: filtered.customizable.map(({ item, requiredOptions }) => ({ item: menuItemForAgent(item), requiredOptions })),
            unknownCompositionItems: filtered.unknown.map(menuItemForAgent),
            ...(presentation && input.display !== false ? { presentation } : {}),
            ...guidance,
          }
        }
        case 'menu_show_recommendations': {
          const presentation = recommendationPresentation(input)
          const items = presentation.itemIds.map((itemId) => {
            const item = machine.getMenu().find(candidate => candidate.id === itemId)
            if (!item)
              throw new Error(`Menu item ${itemId} was not found.`)
            return item
          })

          presentationItemIds = presentation.itemIds
          await options.onRecommendationsChange?.(presentation)
          return {
            customerMessage: `我推薦：${items.map(item => item.name).join('、')}。`,
            items: items.map(menuItemForAgent),
            presentation,
          }
        }
        case 'menu_select_item': {
          const itemId = requiredString(input, 'itemId')
          const item = machine.getMenu().find(candidate => candidate.id === itemId) as MenuItem | undefined
          await revealItem(itemId, onAction)
          const selection = machine.getSelection()
          if (!selection || selection.itemId !== itemId)
            throw new Error('The visible meal did not establish its selection.')
          return {
            item: item ? menuItemForAgent(item) : undefined,
            selection,
            // Only dishes with actual options need a configuration receipt.
            ...(item?.optionGroups.length ? { customerMessage: `已選擇${item.name}，請確認需要的餐點設定。` } : {}),
          }
        }
        case 'menu_set_item_option': {
          const groupId = requiredString(input, 'groupId')
          const valueId = requiredString(input, 'valueId')
          const selection = machine.getSelection()
          const item = selection && machine.getMenu().find(candidate => candidate.id === selection.itemId)
          const value = item?.optionGroups.find(group => group.id === groupId)?.values.find(candidate => candidate.id === valueId)
          const nextSelection = await applyControl(`設定為${value?.label ?? '指定選項'}`, item?.id, {
            controlId: item ? optionControlId(item.id, groupId, valueId) : undefined,
            expandCustomization: true,
          }, () => {
            const next = machine.setItemOption(groupId, valueId)
            options.onSelectionChange?.(next)
            return next
          }, onAction)
          return { customerMessage: `已設定為${value?.label ?? '指定選項'}。`, selection: nextSelection }
        }
        case 'menu_set_quantity': {
          const quantity = requiredNumber(input, 'quantity')
          const nextSelection = await setSelectionQuantity(quantity, onAction)
          return { customerMessage: `已設定為 ${quantity} 份。`, selection: nextSelection }
        }
        case 'order_add_item': {
          const itemId = requiredString(input, 'itemId')
          const replaceLineId = input.replaceLineId === undefined ? undefined : requiredString(input, 'replaceLineId')
          const originalRevisions = currentFastPathRevisions()
          const original = replaceLineId === undefined ? undefined : machine.getCart().lines.find(line => line.id === replaceLineId)
          if (replaceLineId !== undefined && !original)
            throw new Error(`Unknown cart line: ${replaceLineId}`)
          const item = machine.getMenu().find(candidate => candidate.id === itemId)
          if (!item)
            throw new Error(`Menu item ${itemId} was not found.`)

          const itemOptions = itemOptionInputs(input)
          const optionGroupIds = new Set(itemOptions.map(option => option.groupId))
          const missingRequiredGroup = item.optionGroups.find(group => group.required && !optionGroupIds.has(group.id))
          if (missingRequiredGroup)
            throw new Error(`A required option for ${missingRequiredGroup.label} is missing.`)

          for (const option of itemOptions) {
            const group = item.optionGroups.find(candidate => candidate.id === option.groupId)
            if (!group)
              throw new Error(`Option group ${option.groupId} is not available for ${item.name}.`)
            if (!group.values.some(value => value.id === option.valueId))
              throw new Error(`Option ${option.valueId} is not available for ${group.label}.`)
          }

          const quantity = input.quantity === undefined ? original?.quantity : requiredNumber(input, 'quantity')
          if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1 || quantity > 20))
            throw new Error('quantity must be an integer from 1 to 20.')

          await revealItem(item.id, onAction)
          let selection = machine.getSelection()
          if (!selection || selection.itemId !== item.id)
            throw new Error('The visible meal did not establish its selection.')

          for (const option of itemOptions) {
            const value = item.optionGroups.find(group => group.id === option.groupId)?.values.find(candidate => candidate.id === option.valueId)
            selection = await applyControl(`設定為${value?.label ?? '指定選項'}`, item.id, {
              controlId: optionControlId(item.id, option.groupId, option.valueId),
              expandCustomization: true,
            }, () => {
              const next = machine.setItemOption(option.groupId, option.valueId)
              options.onSelectionChange?.(next)
              return next
            }, onAction)
          }

          if (quantity !== undefined)
            selection = await setSelectionQuantity(quantity, onAction)

          const { cart, line, replacedLine } = await applyControl('加入購物車', item.id, { controlId: addItemControlId(item.id) }, () => {
            if (replaceLineId !== undefined) {
            // Cursor/customization awaits can overlap touch or checkout. Only
            // this selection may change before commit; revalidate both cart
            // targets, catalog and payment/phase against the original revision.
              const authorization = authorize({
                intent: 'ADD_ITEM',
                expectedRevisions: { cart: originalRevisions.cart, menu: originalRevisions.menu, checkout: originalRevisions.checkout },
                input,
                slots: { itemId, quantity: quantity ?? 1 },
                targetRef: `item:${itemId}`,
                toolName: 'order_add_item',
              }, currentFastPathContext())
              if (authorization.kind !== 'EXECUTE')
                throw new Error('STALE_PLAN: Replacement state changed before commit.')
            }
            const result = machine.addToCart(replaceLineId)
            options.onCartChange(result.cart)
            options.onMenuSelection(undefined)
            return result
          }, onAction)
          return {
            item: menuItemForAgent(item),
            line,
            cart,
            ...(replacedLine ? { replacedLine } : {}),
            customerMessage: replacedLine ? mealMessages.replaced.replace('{original}', replacedLine.name).replace('{item}', line.name).replace('{quantity}', String(quantity)) : `已將${line.name}加入購物車，共 ${line.quantity} 份。`,
            nextStep: cartNextStep(cart, options.serviceContext?.()),
          }
        }
        case 'cart_add_item': {
          const itemId = machine.getSelection()?.itemId
          const result = await applyControl('加入購物車', itemId, { controlId: itemId ? addItemControlId(itemId) : undefined }, () => {
            const added = machine.addToCart()
            options.onCartChange(added.cart)
            options.onMenuSelection(undefined)
            return added
          }, onAction)
          return {
            ...result,
            customerMessage: `已將${result.line.name}加入購物車，共 ${result.line.quantity} 份。`,
            nextStep: cartNextStep(result.cart, options.serviceContext?.()),
          }
        }
        case 'cart_remove_item': {
          const lineId = requiredString(input, 'lineId')
          const line = machine.getCart().lines.find(candidate => candidate.id === lineId)
          if (!line)
            throw new Error('TARGET_MISSING: The cart line no longer exists.')
          const cartRevision = machine.getRevisions().cart
          // Touch removal stays in review. Agent/voice operations first reveal
          // the real line, then commit through that line’s actual remove control.
          const present = manualOperations === 0
          if (present)
            await revealReview(onAction)
          const cart = await applyControl('從購物車移除餐點', 'cart', { controlId: cartRemovalControlId(lineId) }, () => {
            if (machine.getRevisions().cart !== cartRevision)
              throw new Error('STALE_PLAN: The cart changed while presenting removal.')
            const next = machine.removeFromCart(lineId)
            options.onCartChange(next)
            return next
          }, onAction)
          let presentationFailed = false
          if (present && currentFastPathContext().phase === 'ordering') {
            if (agentTask) {
              agentTask.returnToMenu = true
            }
            else {
              try {
                await leaveReview(onAction)
              }
              catch {
                presentationFailed = true
              }
            }
          }
          return {
            cart,
            customerMessage: `已從購物車移除${line.name}。${presentationFailed ? mealMessages.returnFailed : ''}`,
            outcome: { status: 'completed', intent: 'REMOVE_ITEM', itemIds: [line.itemId], lineIds: [lineId], ...(agentTask ? { taskId: agentTask.taskId } : {}) },
            ...(presentationFailed ? { presentationFailed: true } : {}),
            nextStep: cartNextStep(cart, options.serviceContext?.()),
          }
        }
        case 'cart_set_line_quantity': {
          const lineId = requiredString(input, 'lineId')
          const quantity = requiredNumber(input, 'quantity')
          const line = machine.getCart().lines.find(candidate => candidate.id === lineId)
          if (!line || !Number.isInteger(quantity) || quantity < 1 || quantity > 20)
            throw new Error('A current cart line and quantity from 1 to 20 are required.')
          if (manualOperations === 0)
            await revealReview(onAction)
          let cart = machine.getCart()
          while (cart.lines.find(current => current.id === lineId)!.quantity !== quantity) {
            const before = cart.lines.find(current => current.id === lineId)!
            const delta = quantity > before.quantity ? 1 : -1
            const revision = machine.getRevisions().cart
            cart = await applyControl(`調整${line.name}份數`, 'cart', { controlId: quantityStepControlId(lineId, delta > 0 ? 'increase' : 'decrease', true) }, () => {
              if (revision !== machine.getRevisions().cart)
                throw new Error('STALE_PLAN: The cart changed before the quantity click.')
              const next = machine.setCartLineQuantity(lineId, before.quantity + delta)
              options.onCartChange(next)
              return next
            }, onAction)
          }
          return {
            cart,
            customerMessage: line ? `已將${line.name}調整為 ${quantity} 份。` : '已更新餐點數量。',
            nextStep: cartNextStep(cart, options.serviceContext?.()),
          }
        }
        case 'cart_set_line_option': {
          const lineId = requiredString(input, 'lineId')
          const groupId = requiredString(input, 'groupId')
          const valueId = requiredString(input, 'valueId')
          const line = machine.getCart().lines.find(candidate => candidate.id === lineId)
          const item = line && machine.getMenu().find(candidate => candidate.id === line.itemId)
          const value = item?.optionGroups.find(group => group.id === groupId)?.values.find(candidate => candidate.id === valueId)
          if (manualOperations === 0)
            await revealReview(onAction)
          const result = await applyControl(`設定購物車餐點為${value?.label ?? '指定選項'}`, 'cart', { controlId: cartOptionControlId(lineId, groupId, valueId) }, () => {
            const next = machine.setCartLineOption(lineId, groupId, valueId)
            options.onCartChange(next.cart)
            return next
          }, onAction)
          return {
            cart: result.cart,
            line: result.line,
            customerMessage: `已將${result.line.name}設定為${value?.label ?? '指定選項'}。`,
            nextStep: cartNextStep(result.cart, options.serviceContext?.()),
          }
        }
        case 'cart_clear': {
          if (input.confirmedByUser !== true)
            throw new Error('Clearing the cart requires confirmedByUser: true.')
          options.checkout?.assertCanRestart()
          if (manualOperations === 0)
            await revealReview(onAction)
          const cart = await applyControl('清空購物車', 'cart', { controlId: 'cart:clear' }, async () => {
            await options.seating?.reset()
            const next = machine.clearCart()
            clearMealProgress()
            options.checkout?.restart()
            options.onCartChange(next)
            options.onMenuSelection(undefined)
            options.onFulfillmentChange?.(undefined)
            return next
          }, onAction)
          return {
            cart,
            customerMessage: '已清空購物車。',
            nextStep: 'The customer can now begin a new order.',
          }
        }
        case 'cart_get': {
          if (input.display !== false) {
            await revealReview(onAction)
          }
          const cart = machine.getCart()
          return {
            cart,
            nextStep: cartNextStep(cart, options.serviceContext?.()),
          }
        }
        case 'order_set_fulfillment': {
          const mode = requiredFulfillmentMode(input)
          if (!fulfillmentModes.some(choice => choice.id === mode))
            throw new Error('This fulfillment mode is not offered by the POS.')
          if (machine.getCart().fulfillmentMode === mode) {
            // Reaffirmation is not a mode change: do not release seats, edit
            // cart revisions or discard the unanswered party/table question.
            return { cart: machine.getCart(), fulfillmentMode: mode, customerMessage: `目前已是${fulfillmentModes.find(choice => choice.id === mode)!.label}，保留原訂單設定。` }
          }
          const revisions = currentFastPathRevisions()
          const label = fulfillmentModes.find(choice => choice.id === mode)!.label
          await revealReview(onAction)
          const cart = await applyControl(`設定為${label}`, 'cart', { controlId: fulfillmentControlId(mode) }, async () => {
            if (!revisionsMatch(revisions, currentFastPathRevisions()))
              throw new Error('STALE_PLAN: The order changed during fulfillment presentation.')
            if (mode === 'takeout')
              await options.seating?.reset()
            else
              await options.seating?.refresh()
            const next = machine.setFulfillmentMode(mode)
            options.onFulfillmentChange?.(mode)
            options.onCartChange(next)
            return next
          }, onAction)
          return {
            cart,
            customerMessage: `已設為${label}。`,
            fulfillmentMode: mode,
            nextStep: mode === 'dine-in' && options.seating ? 'Ask party size, then present real available table choices; do not start checkout without a table hold.' : cartNextStep(cart, options.serviceContext?.()),
          }
        }
        case 'seating_get': {
          if (!options.seating)
            throw new Error('This venue does not provide table selection.')
          await options.seating.refresh()
          return { seating: options.seating.context() }
        }
        case 'order_set_party_size': {
          if (!options.seating || machine.getCart().fulfillmentMode !== 'dine-in' || options.checkout?.snapshot())
            throw new Error('Choose dine-in before setting party size, outside checkout.')
          const partySize = requiredNumber(input, 'partySize')
          if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20)
            throw new Error('Party size must be an integer from 1 to 20.')
          await revealReview(onAction)
          await announce(`設定內用人數為 ${partySize} 位`, 'cart', { controlId: 'seating:party-size' }, onAction)
          await options.seating.setPartySize(partySize)
          const seating = options.seating.context()
          const question = seating.choices.length === 0 ? '目前沒有足夠空桌，請洽門市人員或改為自取。' : seating.choices.some(choice => choice.splitRequired) ? `需要分桌；你同意分桌並選擇哪組桌位？${seating.choices.map(choice => choice.label).join('；')}。` : `請選擇桌位：${seating.choices.map(choice => choice.label).join('、')}。`
          return { seating, customerMessage: `已設為 ${seating.partySize} 位內用。${seating.choices.length ? '' : question}` }
        }
        case 'seating_reserve': {
          if (!options.seating || machine.getCart().fulfillmentMode !== 'dine-in' || options.checkout?.snapshot())
            throw new Error('Table selection is only allowed before dine-in checkout.')
          if (typeof input.splitApproved !== 'boolean')
            throw new Error('Explicit split approval is required.')
          await options.seating.reserve(requiredString(input, 'choiceId'), input.splitApproved, requiredNumber(input, 'expectedRevision'))
          return { seating: options.seating.context(), customerMessage: '已暫留選定桌位 10 分鐘，尚未付款；你可以繼續點餐或進入結帳。' }
        }
        case 'checkout_start': {
          if (input.confirmedByUser !== true)
            throw new Error('Starting checkout requires confirmedByUser: true.')
          if (!policy().requiresPayment) {
            // Refresh even on the confirming turn: a Bridge restart must lead
            // to a new review, never a send using a retired table context.
            try {
              await revealReview(onAction)
            }
            catch {
              return { ok: false, customerMessage: '無法取得最新訂單資訊，請稍後再試。' }
            }
            const context = options.serviceContext?.()
            const reviewed = tableOrderReview
            const confirmed = context?.directSubmissionSupported && reviewed && reviewed.contextId === context.id && reviewed.cart === cartFingerprint(machine.getCart())
              && reviewed.questionId === waitingFor?.questionId && waitingFor && questionIsCurrent(waitingFor, currentFastPathRevisions(), Date.now())
            if (confirmed)
              return await applyControl('送出訂單', undefined, { controlId: 'checkout:start' }, () => confirmTableOrder(), onAction)
            const fresh = options.serviceContext?.()
            if (!fresh?.table || !fresh.directSubmissionSupported)
              return { ok: false, customerMessage: '這份訂單無法直接送出。' }
            const cart = machine.getCart()
            if (!cart.lines.length)
              return { ok: false, customerMessage: '訂單還沒有餐點，請先選擇餐點。' }
            tableOrderReview = { contextId: fresh.id, cart: cartFingerprint(cart) }
            return { cart, customerMessage: `桌號 ${fresh.table.label.toUpperCase()}。目前訂單：${cart.lines.map(line => `${line.name} ${line.quantity} 份`).join('、')}。合計 ${cart.total}元。` }
          }
          await revealReview(onAction)
          const checkout = await applyControl('進入結帳', undefined, { controlId: 'checkout:start' }, () => checkoutControllerOrThrow(options.checkout).start(), onAction)
          const mode = fulfillmentModes.find(mode => mode.id === machine.getCart().fulfillmentMode)?.label
          const modeMessage = mode ? orderingMessages['zh-Hant'].checkout.retainedFulfillment.replace('{mode}', mode) : ''
          clearMealProgress()
          return {
            checkout,
            customerMessage: `${modeMessage}${checkout.stage === 'invoice' ? '已進入結帳，請選擇發票方式。' : '已進入結帳，請顧客掃描會員條碼或選擇略過。'}`,
            nextStep: checkout.stage === 'invoice' ? 'Ask for invoice handling. Membership entry was already completed before ordering.' : 'Wait for the customer to scan their membership barcode, or call checkout_skip_membership only when the customer asks to skip it.',
          }
        }
        case 'checkout_skip_membership': {
          if (input.confirmedByUser !== true)
            throw new Error('Skipping membership requires confirmedByUser: true.')
          const checkout = await applyControl('略過會員', undefined, { controlId: 'checkout:membership:skip' }, () => checkoutControllerOrThrow(options.checkout).skipMembership(), onAction)
          return { checkout, customerMessage: '已略過會員，請選擇發票方式。' }
        }
        case 'checkout_choose_invoice': {
          const method = requiredInvoiceMethod(input)
          const label = { carrier: '手機載具', citizen: '自然人憑證', donation: '捐贈發票' }[method]
          const checkout = await applyControl(`選擇${label}`, undefined, { controlId: `checkout:invoice:${method}` }, () => checkoutControllerOrThrow(options.checkout).chooseInvoice(method), onAction)
          let customerMessage: string
          if (method === 'donation')
            customerMessage = '已選擇捐贈發票，請選擇付款方式。'
          else if (checkout.stage === 'invoice')
            customerMessage = `已選擇${label}，請在畫面輸入並確認資料。`
          else
            customerMessage = `已確認${label}資料。`
          return {
            checkout,
            customerMessage,
          }
        }
        case 'checkout_request_tax_id': {
          const checkout = await applyControl('輸入統編', undefined, { controlId: 'checkout:tax-id:request' }, () => checkoutControllerOrThrow(options.checkout).requestTaxId(), onAction)
          return { checkout, customerMessage: '已開啟統編輸入畫面。' }
        }
        case 'checkout_set_tax_id': {
          const taxId = requiredString(input, 'taxId')
          if (!/^\d{8}$/.test(taxId))
            throw new Error('taxId must contain exactly eight digits.')
          const checkout = await applyControl('帶入統編', undefined, { controlId: 'checkout:tax-id:value', inputValue: taxId }, () => checkoutControllerOrThrow(options.checkout).setTaxId(taxId), onAction)
          return {
            checkout,
            customerMessage: `已帶入統編 ${taxId.split('').join(' ')}，請顧客確認畫面。`,
            nextStep: 'Do not confirm automatically. Call checkout_confirm_tax_id only after the customer says the displayed number is correct.',
          }
        }
        case 'checkout_confirm_invoice': {
          if (input.confirmedByUser !== true || options.checkout?.snapshot()?.stage !== 'invoice' || !invoiceDraftReady(options.checkout?.snapshot()))
            throw new Error(orderingMessages['zh-Hant'].checkout.invoiceDraftRequired)
          const checkout = await applyControl('確認發票資料', undefined, { controlId: 'checkout:invoice:confirm' }, () => checkoutControllerOrThrow(options.checkout).confirmInvoice(), onAction)
          return { checkout, customerMessage: orderingMessages['zh-Hant'].checkout.invoiceConfirmed }
        }
        case 'checkout_confirm_tax_id': {
          if (input.confirmedByUser !== true)
            throw new Error('Confirming a tax ID requires confirmedByUser: true.')
          if (options.checkout?.snapshot()?.stage !== 'tax-id' || !invoiceDraftReady(options.checkout.snapshot()))
            throw new Error(orderingMessages['zh-Hant'].checkout.invoiceDraftRequired)
          const checkout = await applyControl('確認統編', undefined, { controlId: 'checkout:tax-id:confirm' }, () => checkoutControllerOrThrow(options.checkout).confirmTaxId(), onAction)
          return { checkout, customerMessage: '已確認統編，請選擇付款方式。' }
        }
        case 'checkout_select_payment': {
          const method = requiredPaymentMethod(input)
          const payment = await applyControl(`選擇${paymentLabels[method]}`, undefined, { controlId: `checkout:payment:${method}` }, () => checkoutControllerOrThrow(options.checkout).selectPayment(method), onAction)
          // Selection answers the method question and opens the scan step.
          // Actual authorization still requires customer payment completion.
          if (waitingFor?.purpose === 'payment-method')
            finishQuestion('answered')
          if (offeredQuestion?.purpose === 'payment-method')
            offeredQuestion = undefined
          return {
            customerMessage: payment.customerMessage,
            payment: { method, status: payment.status },
            nextStep: 'The test QR screen is open. It automatically requests simulated payment completion after a five-second countdown; no scan, confirmation or button press is needed. Wait for the actual simulator and order result before claiming payment or order success.',
          }
        }
        case 'checkout_cancel': {
          if (input.confirmedByUser !== true)
            throw new Error('Cancelling checkout requires confirmedByUser: true.')
          await applyControl('取消結帳', undefined, { controlId: 'checkout:cancel' }, () => checkoutControllerOrThrow(options.checkout).cancel(), onAction)
          return {
            cart: machine.getCart(),
            customerMessage: '已返回訂單內容，購物車仍保留。',
          }
        }
        case 'kiosk_query_scope': {
          if (!queryScope)
            throw new Error('STALE_PLAN: Query scope question is no longer active.')
          const questionId = requiredString(input, 'questionId')
          const choice = input.choice as ScopeChoice
          const result = queryScope.resolve({ questionId, choice, ...(typeof input.transcript === 'string' ? { transcript: input.transcript } : {}) }, { menu: machine.getRevisions().menu, recommendation: recommendationRevision })
          if (result.status === 'STALE') {
            clearQueryScope()
            throw new Error('STALE_PLAN: Query scope expired or recommendation changed.')
          }
          if (result.status === 'WAITING')
            return { customerMessage: result.question.question, pendingCustomerChoice: result.question }
          if (result.status === 'IGNORE')
            return { status: 'IGNORE' }
          const original = queryScopeInput
          clearQueryScope()
          if (result.status === 'NEW_REQUEST')
            return result
          // Admission stays on this internal call chain, not a global bypass
          // that another concurrent read could accidentally inherit.
          const receipt = await invokeOperation(original?.name ?? 'menu_get', { ...original?.input, ...result.conditions, display: true }, onAction, result)
          if (receipt && typeof receipt === 'object') {
            if ('presentation' in receipt)
              presentationFocus = { menuRevision: machine.getRevisions().menu }
            const label = result.scope === 'SHOWN' ? mealMessages.queryScope.shown : mealMessages.queryScope.catalog
            return { ...receipt, queryScope: result.scope, ...('customerMessage' in receipt && typeof receipt.customerMessage === 'string' ? { customerMessage: `${label}：${receipt.customerMessage}` } : {}) }
          }
          return receipt
        }
        case 'kiosk_agent_task': {
          const taskId = requiredString(input, 'taskId')
          if (input.action === 'END') {
            if (agentTask?.taskId === taskId) {
              const returnToMenu = agentTask.returnToMenu && currentFastPathContext().phase === 'ordering'
              agentTask = undefined
              options.onAgentControlChange?.(false)
              if (returnToMenu) {
                try {
                  await leaveReview(onAction)
                }
                catch {
                  // Release succeeded and the cart receipt remains authoritative.
                  // A failed screen transition must never invite another deletion.
                  return { ok: true, presentationFailed: true, customerMessage: mealMessages.returnFailed }
                }
              }
            }
            return { ok: true }
          }
          if (input.action !== 'BEGIN')
            throw new Error('Invalid Agent task transition.')
          if (manualOperations > 0)
            throw new Error('MANUAL_CONTROL: A customer operation is still settling.')
          const revision = machine.getRevisions().menu
          if (input.expectedMenuRevision !== revision)
            throw new Error('STALE_PLAN: Agent task menu changed before handoff.')
          const constraints = input.constraints
          if (!constraints || typeof constraints !== 'object' || Array.isArray(constraints))
            throw new Error('Agent task requires explicit bounded constraints.')
          const bounded = constraints as Record<string, unknown>
          if (issuedFastPathContext?.interruptedQuestion) {
            // A foreground topic change is not cancellation. Keep its draft
            // suspended, but do not publish its old question as Main's task.
            suspendMeal()
            pendingFastPathClarification = undefined
            issuedFastPathContext = undefined
          }
          const source = deriveDecisionContext({ ...currentFastPathContext(), transcript: requiredString(input, 'transcript') })
          let targetItemIds: string[] = []
          if (source.productResolution.status === 'exact') {
            targetItemIds = source.productResolution.references.map(reference => reference.refId.slice('item:'.length))
          }
          else if (source.catalogEvidence.products.length || source.catalogEvidence.categories.length || source.productResolution.status === 'overflow') {
            targetItemIds = []
          }
          else {
            // Freeze only a target the domain can already resolve from the
            // pre-task presentation and an explicit quantity. A later Agent lookup cannot
            // manufacture a referent for an otherwise unbound request.
            const addition = source.candidates.find(candidate => candidate.intent === 'ADD_ITEM')
            const resolved = addition && resolveIntent(addition, source)
            if (resolved?.kind === 'PLAN' && resolved.plan.targetRef && source.referenceOrigins[resolved.plan.targetRef] === 'presentation' && typeof resolved.plan.slots.quantity === 'number' && typeof resolved.plan.slots.itemId === 'string')
              targetItemIds = [resolved.plan.slots.itemId]
          }
          agentTask = { taskId, transcript: requiredString(input, 'transcript'), ...(input.handoff ? { handoff: parse(handoffSchema, input.handoff) } : {}), targetItemIds, broadMenuQuery: source.catalogEvidence.products.length === 0 && source.catalogEvidence.categories.length === 0, readOnly: input.readOnly === true, filters: ingredientFilters(bounded), prices: priceConditions(bounded), unresolvedPrice: bounded.unresolvedPrice === true, unresolvedMenu: false, menuRevision: revision, expiresAt: Date.now() + 300_000 }
          options.onAgentControlChange?.(true)
          return { ok: true }
        }
        case 'kiosk_fast_path_clarify': {
          const response = mealClarification.request(requiredString(input, 'questionId'), currentFastPathContext())
          if (response.repeatCurrent) {
            const question = configurationSnapshot(currentFastPathContext(), '', true)?.waitingFor
            if (!question || !pendingConfiguration)
              throw new Error('STALE_PLAN: The meal question is no longer pending.')
            pendingConfiguration.clarificationAttempts = (pendingConfiguration.clarificationAttempts ?? 0) + 1
            const speak = pendingConfiguration.clarificationAttempts <= 2
            return { customerMessage: speak ? question.question : '', pendingCustomerChoice: question, silent: !speak }
          }
          const { question, speak } = response
          options.onClarificationChange?.(question)
          return { customerMessage: speak ? question.question : '', pendingCustomerChoice: question, silent: !speak }
        }
        case 'kiosk_conversation_context': {
          if (machine.getCart().fulfillmentMode === 'dine-in')
            await options.seating?.refresh()
          const context = currentFastPathContext()
          const checkout = options.checkout?.snapshot()
          const confirmation = confirmationSnapshot(context)
          const navigation = navigationSnapshot(context)
          const active = navigation ?? confirmation ?? mealConfirmationSnapshot(context) ?? configurationSnapshot(context)
          const phase = active?.phase ?? context.phase
          const question = active?.waitingFor ?? (context.waitingFor ? describeQuestion(context.waitingFor) : undefined)
          // A known target needs its original operation, not a second alias
          // confirmation that discards quantities or option combinations.
          const names = availableToolDefinitions().map(tool => tool.name).filter(name => !isKioskHostOnlyToolName(name) && name !== 'customer_skip_phone')
          const reads = ['menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get', 'seating_get', 'menu_open', 'menu_scroll', 'order_ask_question']
          let allowedToolNames = names
          if (navigation && !agentTask?.readOnly) {
            allowedToolNames = names.filter(name => reads.includes(name) || ['order_answer_confirmation', 'order_cancel_request', 'order_add_item', 'menu_confirm_item'].includes(name))
          }
          else if (phase === 'customer_entry') {
            allowedToolNames = []
          }
          else if (confirmation && !agentTask?.readOnly) {
            const pending = pendingFastPathConfirmation
            const valid = pending && confirmationIsValid(pending, context)
            const confirmationTools = ['cart_get', 'seating_get']
            if (valid && pending.presented && pending.taskId !== agentTask?.taskId)
              confirmationTools.push('order_answer_confirmation')
            // Expiry does not grant invoice choices. A new explicit request may
            // instead propose a fresh return or mode change, with its own ticket.
            if (!valid)
              confirmationTools.push('order_set_fulfillment', 'checkout_cancel')
            allowedToolNames = names.filter(name => confirmationTools.includes(name))
          }
          else if (agentTask?.readOnly || ['configuration', 'clarification', 'meal_confirmation', 'pending_confirmation'].includes(phase)) {
            // Read-only recovery does not reopen menu browsing during checkout.
            // Its phase still owns which facts can be read.
            allowedToolNames = names.filter(name => reads.includes(name) && (!checkout || ['cart_get', 'seating_get'].includes(name)))
          }
          else if (phase !== 'ordering') {
            const checkoutTools: Record<string, string[]> = {
              checkout_membership: ['checkout_skip_membership', 'checkout_cancel', 'order_set_fulfillment'],
              checkout_invoice: [...(invoiceDraftReady(checkout) ? ['checkout_confirm_invoice'] : []), 'checkout_choose_invoice', 'checkout_request_tax_id', 'checkout_cancel', 'order_set_fulfillment'],
              checkout_tax_id: ['checkout_set_tax_id', ...(invoiceDraftReady(checkout) ? ['checkout_confirm_tax_id'] : []), 'checkout_cancel', 'order_set_fulfillment'],
              checkout_payment_select: ['checkout_select_payment', 'checkout_cancel', 'order_set_fulfillment'],
            }
            allowedToolNames = names.filter(name => ['cart_get', 'seating_get'].includes(name) || checkoutTools[phase]?.includes(name))
          }
          else {
            allowedToolNames = names.filter(name => !name.startsWith('checkout_') || name === 'checkout_start')
          }
          if (!agentTask?.readOnly && !confirmation && (pendingConfiguration || suspendedConfigurations.length)) {
            if (!allowedToolNames.includes('order_cancel_request'))
              allowedToolNames.push('order_cancel_request')
          }
          else {
            allowedToolNames = allowedToolNames.filter(name => name !== 'order_cancel_request')
          }
          // The phase alone is insufficient: cart/fulfillment/seating must
          // satisfy the same Menu-owned checkout effect offered to the Host.
          if (phase === 'ordering' && !context.candidates.some(candidate => candidate.intent === 'START_CHECKOUT'))
            allowedToolNames = allowedToolNames.filter(name => name !== 'checkout_start')
          // A meal operation does not choose fulfillment. Only the POS-owned
          // mode named this turn, or a resolved fulfillment handoff, offers that
          // write. A lingering fulfillment question is not an answered choice.
          const fulfillmentRequested = agentTask?.handoff?.intent === 'SET_FULFILLMENT'
            || fulfillmentModes.some(mode => agentTask?.transcript.includes(mode.label))
          if (agentTask && !fulfillmentRequested)
            allowedToolNames = allowedToolNames.filter(name => name !== 'order_set_fulfillment')
          // Offered questions are not customer answers. A question created by
          // this tool loop becomes deferrable only after Host presentation.
          if (!context.waitingFor)
            allowedToolNames = allowedToolNames.filter(name => name !== 'order_defer_question')
          // Cart-line effects have no legal target while the cart is empty.
          if (!context.cart.lines.length)
            allowedToolNames = allowedToolNames.filter(name => name !== 'cart_clear' && !cartLineToolNames.has(name))
          const selection = machine.getSelection()
          // Atomic additions clear selection. Keep staged edit/add tools out
          // until a real selection belonging to this task exists again.
          if (!selection?.itemId || (agentTask?.targetItemIds && !agentTask.targetItemIds.includes(selection.itemId)))
            allowedToolNames = allowedToolNames.filter(name => !selectionToolNames.has(name))
          if (agentTask?.targetItemIds?.length === 0)
            allowedToolNames = allowedToolNames.filter(name => !itemTargetToolNames.has(name))
          // Advertise exactly the write scope enforced by invokeForAgent.
          // Offering unrelated cart edits caused Main to propose a forbidden
          // change after completing its additions, turning success into error.
          const expected = agentTask?.handoff && intentTools[agentTask.handoff.intent]
          if (expected) {
            allowedToolNames = allowedToolNames.filter(name => (reads.includes(name) && (agentTask?.handoff?.intent !== 'REMOVE_ITEM' || !menuBrowsingToolNames.has(name))) || expected.includes(name))
            // A finite operation handoff may read evidence, but does not ask
            // for a new recommendation. General mixed-purpose tasks keep their
            // independently qualified browsing scope.
            allowedToolNames = allowedToolNames.filter(name => !['menu_recommend', 'menu_show_recommendations'].includes(name))
          }
          const canAnswerNavigation = navigation && pendingNavigation?.presented && pendingNavigation.taskId !== agentTask?.taskId
          if (!confirmation && !canAnswerNavigation)
            allowedToolNames = allowedToolNames.filter(name => name !== 'order_answer_confirmation')
          if (!agentTask?.readOnly && mealClarification.canAnswer(context, agentTask?.taskId))
            allowedToolNames.push('order_answer_confirmation')
          if (!agentTask?.readOnly && phase === 'configuration' && pendingConfiguration && agentTask && mentionedUnavailableConditions(agentTask.transcript).length && machine.getMenu().some(item => item.id === pendingConfiguration!.plan.slots.itemId && !item.optionGroups.length))
            allowedToolNames.push('menu_confirm_item')
          const taskSpeech = agentTask?.transcript ?? ''
          const preparationSpeech = deriveDecisionContext({ ...context, transcript: taskSpeech }).catalogEvidence.products.reduce((text, product) => text.replaceAll(product.matchedText, ''), taskSpeech)
          const preparationOnly = agentTask && mentionedUnavailableConditions(preparationSpeech).some(reference => ['spice', 'preparation'].includes(reference.id))
            && machine.getMenu().some(item => !item.optionGroups.length && (agentTask!.targetItemIds?.includes(item.id) || pendingConfiguration?.plan.slots.itemId === item.id))
          // A named preparation request is not a recommendation-scope question.
          // Factual lookup remains available; no purchase is granted by this filter.
          if (preparationOnly)
            allowedToolNames = allowedToolNames.filter(name => !['menu_recommend', 'menu_show_recommendations'].includes(name))
          else if (agentTask?.targetItemIds?.length)
            allowedToolNames = allowedToolNames.filter(name => name !== 'menu_confirm_item')

          allowedToolNames = allowedToolNames.filter(name => !agentToolRestriction(name))

          const optionsFor = (values: Record<string, string>) => Object.entries(values).map(([groupId, valueId]) => ({ groupId, valueId }))
          const cart = context.cart
          const snapshot: ConversationContext = {
            serviceMode: options.serviceContext?.()?.serviceMode,
            ...(options.serviceContext?.()?.table ? { serviceTable: options.serviceContext!()!.table } : {}),
            quantityPolicy: { maximum: 20, mentionedCounts: mentionedServingCounts(agentTask?.transcript ?? ''), message: orderingMessages['zh-Hant'].quantityLimit },
            contextId: crypto.randomUUID(),
            capturedAt: Date.now(),
            phase,
            entryComplete: context.phase !== 'customer_entry',
            readOnly: agentTask?.readOnly === true,
            constraints: { excludeIngredients: agentTask?.filters.excludeIngredients ?? [], includeIngredients: agentTask?.filters.includeIngredients ?? [], ...(agentTask?.filters.dietary ? { dietary: agentTask.filters.dietary } : {}), ...agentTask?.prices },
            ...(agentTask ? { unavailableConditions: mentionedUnavailableConditions(agentTask.transcript) } : {}),
            ...(options.screen ? { screen: options.screen() } : {}),
            ...(recommendationBatch && recommendationBatch.menuRevision === context.revisions.menu ? { queryState: { category: recommendationBatch.category, queries: recommendationBatch.queries, exhausted: recommendationBatch.exhausted, prices: recommendationBatch.prices, filters: recommendationBatch.filters } } : {}),
            presentation: { itemIds: options.visibleItemIds?.() ?? presentationItemIds ?? [], category: recommendationBatch?.category ?? '', queries: recommendationBatch?.queries ?? [] },
            revisions: { ...context.revisions, menu: context.revisions.menu ?? 0, recommendation: recommendationRevision },
            ...(agentTask ? { taskId: agentTask.taskId, sourceUtterance: agentTask.transcript, ...(agentTask.handoff ? { handoff: agentTask.handoff } : {}) } : {}),
            ...(context.phase !== 'customer_entry' && input.includeCatalog !== false
              ? { catalog: { complete: true, itemCount: context.menu.length, items: context.menu.map(item => ({
                  id: item.id,
                  name: item.name,
                  aliases: item.aliases ?? [],
                  category: item.category,
                  price: item.price,
                  ...(item.description.length <= 120 ? { description: item.description } : {}),
                  availability: menuPageState(item),
                  optionGroups: item.optionGroups,
                  ...(item.composition ? { composition: { ingredients: item.composition.ingredients, complete: item.composition.complete, dietary: item.composition.dietaryLabels } } : {}),
                })) } }
              : {}),
            cart: { itemCount: cart.itemCount, total: cart.total, fulfillmentMode: cart.fulfillmentMode, lines: cart.lines.map(line => ({ id: line.id, itemId: line.itemId, name: line.name, quantity: line.quantity, unitPrice: line.unitPrice, options: optionsFor(line.options) })) },
            ...(selection?.itemId ? { selection: { itemId: selection.itemId, quantity: selection.quantity, options: optionsFor(selection.options) } } : {}),
            paymentState: options.checkout?.paymentStatus() ?? 'idle',
            allowedPaymentMethods: context.allowedPaymentMethods,
            ...(options.merchant ? { merchant: options.merchant } : {}),
            paymentMethods: (options.checkout?.paymentMethods ?? []).map(id => ({ id, label: paymentLabels[id] })),
            fulfillmentModes: [...fulfillmentModes],
            ...(checkout ? { checkout: { stage: checkout.stage, invoiceMethod: checkout.invoiceMethod, ...(context.phase === 'checkout_tax_id' ? { taxId: checkout.taxId } : {}), invoiceDraftReady: invoiceDraftReady(checkout), carrierRegistered: Boolean(checkout.carrierCode), citizenRegistered: Boolean(checkout.citizenCode) } } : {}),
            ...(context.seating ? { seating: { partySize: context.seating.partySize, ready: context.seating.ready, revision: context.seating.revision } } : {}),
            ...(question && (confirmation || question.expiresAt > Date.now()) ? { waitingFor: question } : {}),
            retainedRequests: retainedRequests(context),
            ...(intentRecovery(context) ? { intentRecovery: intentRecovery(context) } : {}),
            ...(active?.intentRecovery ? { intentRecovery: active.intentRecovery } : {}),
            allowedToolNames,
          }
          // Parse creates a detached explicit projection: no live cart objects,
          // hidden phone fields or vendor metadata can leak into model history.
          const projection = safeParse(conversationContextSchema, snapshot)
          if (!projection.success) {
            // Record schema locations only: never expose cart values, utterances
            // or provider metadata through an exception's default issue message.
            const paths = projection.issues.slice(0, 6).map(issue => issue.path?.map(part => String(part.key).replace(/[^\w-]/giu, '').slice(0, 48)).join('.') || 'root')
            throw new Error(`CONTEXT_INVALID:${paths.join(',').slice(0, 384)}`)
          }
          const detached = projection.output
          if (agentTask) {
            agentTask.expectedRevisions = { ...context.revisions }
            agentTask.allowedToolNames = [...allowedToolNames]
          }
          return detached
        }
        case 'kiosk_interaction_state': {
          if (queryScope && currentFastPathContext().phase !== 'ordering') {
            clearQueryScope()
          }
          if (queryScope) {
            const probe = queryScope.resolve({ questionId: queryScope.question.questionId, choice: 'ASK' }, { menu: machine.getRevisions().menu, recommendation: recommendationRevision })
            if (probe.status === 'WAITING')
              return { retainedRequests: retainedRequests(currentFastPathContext()), phase: 'query_scope', candidates: [], menuRevision: machine.getRevisions().menu, constraints: { exclude: queryScope.conditions.excludeIngredients, include: queryScope.conditions.includeIngredients, dietary: queryScope.conditions.dietary, price: priceConditions({ ...queryScope.conditions }) }, waitingFor: probe.question }
            clearQueryScope()
          }

          const context = currentFastPathContext()
          const navigation = navigationSnapshot(context)
          if (navigation)
            return navigation
          const operationConfirmation = confirmationSnapshot(context)
          if (operationConfirmation)
            return operationConfirmation
          const confirmation = mealConfirmationSnapshot(context)
          if (confirmation)
            return confirmation
          const configuration = configurationSnapshot(context)
          if (configuration)
            return { questionHistory: [...questionHistory.values()], ...configuration }
          const clarification = clarificationSnapshot(context)
          if (clarification)
            return clarification
          const pendingConfirmationValid = pendingFastPathConfirmation && confirmationIsValid(pendingFastPathConfirmation, context)
          const pendingClarificationValid = pendingFastPathClarification
            && pendingFastPathClarification.context.phase === context.phase
            && revisionsMatch(pendingFastPathClarification.expectedRevisions, context.revisions)
          // Reading host state keeps the presented question visible, even when
          // its last answer ticket expired; only a decision turn renews it.
          const presentedQuestion = waitingFor?.phase === context.phase ? waitingFor : undefined
          return {
            menuRevision: context.revisions.menu,
            revisions: context.revisions,
            questionHistory: [...questionHistory.values()],
            retainedRequests: retainedRequests(context),
            ...(intentRecovery(context) ? { intentRecovery: intentRecovery(context) } : {}),
            productResolution: { ...context.productResolution, references: publicReferences(context.productResolution.references) },
            fulfillmentModes,
            ...(presentedQuestion ? { waitingFor: describeQuestion(presentedQuestion) } : {}),
            phase: pendingConfirmationValid ? 'pending_confirmation' : pendingClarificationValid ? 'clarification' : context.phase,
            paymentState: options.checkout?.paymentStatus() ?? 'idle',
            allowedPaymentMethods: context.allowedPaymentMethods,
            interactionState: {
              ...context.interactionState,
              ...(pendingConfirmationValid ? { pendingAction: pendingFastPathConfirmation!.record.action } : {}),
              ...(pendingClarificationValid ? { pendingIntent: pendingFastPathClarification!.candidate.intent } : {}),
            },
          }
        }
        case 'kiosk_fast_path_context': {
          if (queryScope && currentFastPathContext().phase !== 'ordering') {
            clearQueryScope()
          }
          if (queryScope) {
            const probe = queryScope.resolve({ questionId: queryScope.question.questionId, choice: 'ASK' }, { menu: machine.getRevisions().menu, recommendation: recommendationRevision })
            if (probe.status === 'WAITING')
              return { retainedRequests: retainedRequests(currentFastPathContext()), phase: 'query_scope', candidates: [], menuRevision: machine.getRevisions().menu, constraints: { exclude: queryScope.conditions.excludeIngredients, include: queryScope.conditions.includeIngredients, dietary: queryScope.conditions.dietary, price: priceConditions({ ...queryScope.conditions }) }, waitingFor: probe.question }
            clearQueryScope()
          }

          if (machine.getCart().fulfillmentMode === 'dine-in')
            await options.seating?.refresh()
          // A new utterance supersedes any unclaimed read continuation from
          // the previous turn, even if the cart revisions did not change.
          pendingReadContinuation = undefined
          const transcript = typeof input.transcript === 'string' ? input.transcript : ''
          let context = currentFastPathContext(transcript, typeof input.previousTranscript === 'string' ? input.previousTranscript : undefined, true)
          issuedFastPathContext = undefined
          const navigation = navigationSnapshot(context)
          if (navigation) {
            const foreignMeal = context.productResolution.status === 'exact' && context.productResolution.count === 1 && !context.targetConstraints.itemIds.includes(pendingNavigation!.itemId)
            if (!foreignMeal && input.newRequestQuestionId !== navigation.waitingFor.questionId)
              return navigationSnapshot(context, true)!
            pendingNavigation = undefined
            // A new request has no authority to execute the deferred switch.
            if (input.newRequestQuestionId === navigation.waitingFor.questionId)
              input = { ...input, newRequestQuestionId: undefined }
          }
          let interruptedQuestion: IssuedFastPathContext['interruptedQuestion']
          const confirmation = mealConfirmationSnapshot(context, input.newRequestQuestionId === undefined)
          const confirmedMeal = confirmation?.retainedRequests.find(request => request.status === 'confirming')
          const foreignMeal = context.productResolution.status === 'exact' && context.productResolution.count === 1
            && confirmedMeal && !context.targetConstraints.itemIds.includes(confirmedMeal.itemId)
          const mealRerouted = confirmation && (input.newRequestQuestionId === confirmation.waitingFor.questionId || foreignMeal)
          if (mealRerouted) {
            if (!foreignMeal && clarificationTranscript !== transcript)
              throw new Error('STALE_PLAN: This topic change belongs to a different utterance.')
            mealClarification.clear()
            options.onClarificationChange?.(undefined)
            if (pendingConfiguration)
              interruptedQuestion = { kind: 'configuration', id: pendingConfiguration.id }
            context = deriveDecisionContext({ ...context, waitingFor: undefined, previousTranscript: undefined, selectedItem: undefined, recentAddedLineId: undefined, presentationItemIds: undefined })
          }
          else if (confirmation) {
            clarificationTranscript = transcript
            return confirmation
          }
          if (input.newRequestQuestionId !== undefined && !mealRerouted) {
            // Only the host may reroute the same utterance after the finite
            // topic-change route. This read neither cancels nor authorizes a meal.
            const configuration = pendingConfiguration
            const clarification = pendingFastPathClarification
            if (configuration?.issued?.id === input.newRequestQuestionId && configuration.issued.expiresAt > Date.now() && configuration.issued.transcript === transcript && context.phase === 'ordering' && revisionsMatch(configuration.plan.expectedRevisions, context.revisions)) {
              interruptedQuestion = { kind: 'configuration', id: configuration.id }
              configuration.issued = undefined
            }
            else if (clarification?.issued?.id === input.newRequestQuestionId && clarification.issued.expiresAt > Date.now() && clarification.issued.transcript === transcript && clarification.context.phase === context.phase && revisionsMatch(clarification.expectedRevisions, context.revisions)) {
              interruptedQuestion = { kind: 'clarification', id: clarification.id }
              clarification.issued = undefined
            }
            else {
              throw new Error('STALE_PLAN: The new request does not match the current question turn.')
            }
            // A topic change cannot inherit a draft's target, quantity or slots.
            const fresh = deriveDecisionContext({ ...context, waitingFor: undefined, previousTranscript: undefined, selectedItem: undefined, recentAddedLineId: undefined, presentationItemIds: undefined })
            context = { ...fresh, interactionState: { ...fresh.interactionState, ...(options.screen ? { screen: options.screen() } : {}) } }
          }
          // A new explicitly named product cannot answer a different draft's
          // quantity/options question. Route its own intent, while the old
          // draft remains retained until the new request actually progresses.
          if (!interruptedQuestion && pendingConfiguration && context.productResolution.status === 'exact'
            && context.productResolution.count === 1 && !context.targetConstraints.itemIds.includes(String(pendingConfiguration.plan.slots.itemId))) {
            interruptedQuestion = { kind: 'configuration', id: pendingConfiguration.id }
            pendingConfiguration.issued = undefined
            context = deriveDecisionContext({ ...context, waitingFor: undefined, previousTranscript: undefined, selectedItem: undefined, recentAddedLineId: undefined, presentationItemIds: undefined })
          }
          const configuration = interruptedQuestion || mealRerouted ? undefined : configurationSnapshot(context, transcript, true)
          if (configuration)
            return configuration
          const operationConfirmation = confirmationSnapshot(context)
          if (operationConfirmation)
            return operationConfirmation
          if (!interruptedQuestion && pendingFastPathClarification) {
            const pending = pendingFastPathClarification
            if (pending.context.phase !== context.phase || !revisionsMatch(pending.expectedRevisions, context.revisions)) {
              pendingFastPathClarification = undefined
            }
            else {
              const issued = { id: crypto.randomUUID(), expiresAt: Date.now() + 15_000, transcript }
              pending.issued = issued
              return clarificationSnapshot(context, transcript)
            }
          }
          issuedFastPathContext = {
            candidates: new Map(context.candidates.map(candidate => [candidate.id, candidate])),
            context,
            // This is an ordinary intent lease, not customer confirmation.
            // Staged SLM inference may exceed one checkpoint's 15s window.
            // The full-turn limit still bounds it; authorization below checks
            // live phase/revisions, while confirmation/answer expiry is separate.
            expiresAt: Date.now() + serviceRecoveryLimits.turnMs,
            interruptedQuestion,
          }
          return {
            retainedRequests: retainedRequests(context),
            ...(intentRecovery(context) ? { intentRecovery: intentRecovery(context) } : {}),
            candidates: context.candidates.map(candidate => ({ description: candidate.description, id: candidate.id, requiresHighConfidence: !['RECOMMEND', 'SEARCH_MENU', 'SELECT_ITEM', 'SHOW_RECOMMENDATIONS', 'VIEW_CART'].includes(candidate.intent) })),
            revisions: context.revisions,
            fulfillmentModes,
            ...(context.waitingFor ? { waitingFor: describeQuestion(context.waitingFor, context.candidates) } : {}),
            checkoutSnapshot: context.checkout,
            menuRevision: context.revisions.menu,
            productResolution: { ...context.productResolution, references: publicReferences(context.productResolution.references) },
            catalogEvidence: context.catalogEvidence,
            ...(context.priceEvidence ? { priceEvidence: context.priceEvidence } : {}),
            constraints: context.constraints,
            ingredientReferences: context.ingredientReferences,
            dietaryReferences: context.dietaryReferences,
            unavailableConditionReferences: context.unavailableConditionReferences,
            interactionState: context.interactionState,
            phase: context.phase,
            paymentState: options.checkout?.paymentStatus() ?? 'idle',
            allowedPaymentMethods: context.allowedPaymentMethods,
            references: publicReferences(context.modelReferences),
          }
        }
        case 'kiosk_fast_path_execute': {
          if (queryScope)
            throw new Error('STALE_PLAN: Resolve the pending query scope before executing another Kiosk plan.')
          if (machine.getCart().fulfillmentMode === 'dine-in')
            await options.seating?.refresh()
          const candidateId = requiredString(input, 'candidateId')
          const currentContext = currentFastPathContext()
          if (candidateId.startsWith('navigate:'))
            return await answerNavigation(candidateId, onAction)
          if (candidateId.startsWith('inquire-meal:')) {
            const item = mealClarification.inquire(candidateId.slice('inquire-meal:'.length), currentContext)
            options.onClarificationChange?.(undefined)
            return await invoke('menu_get', { query: item.name, display: true }, onAction)
          }
          if (candidateId.startsWith('confirm-meal:')) {
            const proposedItemId = mealClarification.progress(currentContext)?.itemId
            const plan = mealClarification.consume(candidateId, currentContext)
            options.onClarificationChange?.(undefined)
            if (plan && 'kind' in plan) {
              options.onClarificationChange?.(plan.question)
              return { customerMessage: plan.question.question, pendingCustomerChoice: plan.question }
            }
            if (plan)
              return await beginMeal(plan, onAction)
            // Rejecting the original recipe also retires that same unadded
            // draft; it must not reopen the quantity question just declined.
            if (pendingConfiguration?.plan.slots.itemId === proposedItemId) {
              pendingConfiguration = undefined
              options.onMenuSelection(undefined)
            }
            const question = configurationSnapshot(currentContext, '', true)?.waitingFor
            return { customerMessage: `${mealMessages.declined}${question?.question ?? ''}`, ...(question ? { pendingCustomerChoice: question } : {}) }
          }
          if (candidateId.startsWith('configure:')) {
            const pending = pendingConfiguration
            if (!pending || currentContext.phase !== 'ordering' || !revisionsMatch(pending.plan.expectedRevisions, currentContext.revisions)) {
              pendingConfiguration = undefined
              throw new Error('STALE_PLAN: The pending meal configuration is no longer valid.')
            }
            const issued = pending.issued
            if (!issued || issued.expiresAt <= Date.now() || !candidateId.startsWith(`configure:${issued.id}:`))
              throw new Error('STALE_PLAN: The configuration answer has expired or belongs to an earlier turn.')
            const configuringItem = machine.getMenu().find(item => item.id === pending.plan.slots.itemId)
            if (candidateId.includes(':quantity:') && configuringItem && !configuringItem.optionGroups.length && (mentionedUnavailableConditions(issued.transcript).length || mentionedIngredients(issued.transcript.replaceAll(configuringItem.name, '')).length))
              return { needsAssistant: true, handoff: { intent: 'ADD_ITEM', status: 'unrepresentable', itemIds: [configuringItem.id], lineIds: [] } }
            if (candidateId === `configure:${issued.id}:unit-guidance`) {
              if (issued.unitGuidanceId !== candidateId)
                throw new Error('STALE_PLAN: quantity guidance is not available for this draft.')
              const item = machine.getMenu().find(item => item.id === pending.plan.slots.itemId)!
              // No guessed serving count and no draft cancellation. Rotate the
              // answer ticket while retaining this same request and chosen options.
              const question = configurationSnapshot(currentContext, '', true)!.waitingFor
              return { customerMessage: `${item.name}，${describeOrderingDetails(item.price, item.description === item.name ? '' : item.description)}${orderingMessages['zh-Hant'].orderingUnitsGuide}${question.question}`, pendingCustomerChoice: question }
            }
            if (candidateId === `configure:${issued.id}:inquiry`) {
              const item = machine.getMenu().find(item => item.id === pending.plan.slots.itemId)!
              // The customer corrects a mistaken draft, not an existing cart
              // line. Consume this answer ticket before the read; never resume
              // the quantity question that the customer just disowned.
              pendingConfiguration = undefined
              mealClarification.clear()
              options.onClarificationChange?.(undefined)
              const result = await invoke('menu_get', { query: item.name, display: true }, onAction) as Record<string, unknown>
              const readReply = parse(customerReplySchema, result.customerReply)
              const reply = { facts: `${mealMessages.inquiryCorrection}${readReply.facts}`, nextQuestion: orderingMessages['zh-Hant'].browseQuestion }
              return { ...result, customerReply: reply, customerMessage: `${reply.facts} ${reply.nextQuestion}` }
            }
            if (candidateId === `configure:${issued.id}:cancel`) {
              pendingConfiguration = undefined
              mealClarification.clear()
              options.onClarificationChange?.(undefined)
              await closeMeal(String(pending.plan.slots.itemId), onAction)
              return { customerMessage: '已取消這筆尚未加入的餐點需求，還想點什麼？' }
            }
            const choice = issued.choices.get(candidateId)
            if (!choice?.slots)
              throw new Error('The configuration answer was not offered by this session.')
            pending.issued = undefined
            const answerRejection = rejectQuantity('order_add_item', choice.slots.quantity)
            if (answerRejection)
              return answerRejection
            pending.plan = { ...pending.plan, slots: { ...choice.slots } }
            const question = configurationQuestion(pending.plan, currentContext.menu, pending.id)
            if (question) {
              await revealItem(String(pending.plan.slots.itemId), onAction)
              pending.plan.expectedRevisions.selectedItem = machine.getRevisions().selectedItem
              return { customerMessage: question.prompt, pendingConfiguration: { id: pending.id }, decisionTrace: { resolveIntent: { kind: 'CONFIGURATION', plan: pending.plan }, operationPlan: null, authorize: null } }
            }
            const operation = compileOperationPlan(pending.plan)
            const quantityRejection = rejectQuantity(operation.toolName, operation.input.quantity ?? operation.slots.quantity)
            if (quantityRejection)
              return quantityRejection
            const authorization = authorize(operation, currentContext)
            pendingConfiguration = undefined
            if (authorization.kind !== 'EXECUTE')
              throw new Error('The completed meal configuration is not authorized.')
            const result = await invoke(operation.toolName, operation.input, onAction)
            return { ...(result && typeof result === 'object' ? result : { result }), decisionTrace: { resolveIntent: { kind: 'PLAN', plan: pending.plan }, operationPlan: operation, authorize: authorization } }
          }
          if (pendingFastPathConfirmation) {
            const confirmation = pendingFastPathConfirmation
            const confirmId = `intent:confirm:${confirmation.record.confirmationId}`
            const cancelId = `intent:cancel-confirmation:${confirmation.record.confirmationId}`
            if (candidateId === cancelId) {
              pendingFastPathConfirmation = undefined
              // A side conversation revokes this authorization without clearing
              // checkout. A later acknowledgement cannot answer the old question.
              finishQuestion('superseded')
              offeredQuestion = undefined
              return { customerMessage: '已取消剛才的確認，結帳進度保留；繼續操作前請重新確認。' }
            }
            if (candidateId !== confirmId)
              throw new Error('The confirmation does not match the pending action.')
            if (!confirmationIsValid(confirmation, currentContext)) {
              pendingFastPathConfirmation = undefined
              throw new Error('The confirmation has expired or the cart changed.')
            }
            confirmation.record.consumedAt = Date.now()
            pendingFastPathConfirmation = undefined
            // The one-use ticket binds both the return from checkout and the
            // requested mode. Cancel first so the visible review owns controls.
            if (confirmation.operation.intent === 'SET_FULFILLMENT' && currentContext.checkout)
              await invoke('checkout_cancel', { confirmedByUser: true }, onAction)
            const result = await invoke(confirmation.operation.toolName, confirmation.operation.input, onAction)
            return {
              ...(result && typeof result === 'object' ? result : { result }),
              decisionTrace: { authorize: { kind: 'EXECUTE', confirmationId: confirmation.record.confirmationId }, operationPlan: confirmation.operation },
            }
          }
          let decision: IntentCandidate | undefined
          let resolutionContext: DecisionContext | undefined
          let chosenRef: string | undefined
          if (candidateId.startsWith('clarify:') && pendingFastPathClarification) {
            const pending = pendingFastPathClarification
            if (pending.context.phase !== currentContext.phase || !revisionsMatch(pending.expectedRevisions, currentContext.revisions)) {
              pendingFastPathClarification = undefined
              throw new Error('The clarification is stale or no longer matches the available targets.')
            }
            const issued = pending.issued
            if (!issued || issued.expiresAt <= Date.now())
              throw new Error('The clarification answer is stale. Resolve the retained demand again.')
            if (!candidateId.startsWith(`clarify:${issued.id}:`))
              throw new Error('The clarification belongs to an earlier turn.')
            // A provider-selected index cannot add target evidence to bare assent.
            // Keep the pending demand so a later explicit choice can still answer it.
            if (pending.candidateRefs.length > 1 && isTargetAcknowledgement(issued.transcript))
              throw new Error('The acknowledgement does not identify one clarification target.')
            if (candidateId === `clarify:${issued.id}:cancel`) {
              pendingFastPathClarification = undefined
              return { customerMessage: '已取消這次待釐清的需求，購物車仍保留。' }
            }
            const index = Number(candidateId.slice(`clarify:${issued.id}:`.length))
            if (!Number.isInteger(index) || !pending.candidateRefs[index]) {
              throw new Error('The clarification is stale or no longer matches the available targets.')
            }
            decision = pending.candidate
            resolutionContext = pending.context
            chosenRef = pending.candidateRefs[index]
            pendingFastPathClarification = undefined
          }
          else {
            decision = issuedFastPathContext?.candidates.get(candidateId)
            resolutionContext = issuedFastPathContext?.context
          }
          if (!decision || !resolutionContext || (!chosenRef && (!issuedFastPathContext || Date.now() >= issuedFastPathContext.expiresAt)))
            throw new Error('The selected Kiosk intent has expired. Resolve the latest customer state again.')
          const interrupted = issuedFastPathContext?.interruptedQuestion
          if (interrupted && (interrupted.kind === 'configuration' ? pendingConfiguration?.id : pendingFastPathClarification?.id) !== interrupted.id)
            throw new Error('STALE_PLAN: The interrupted question was replaced before this decision.')
          issuedFastPathContext = undefined
          if (!chosenRef && resolutionContext.priceEvidence) {
            const choice = resolutionContext.priceEvidence.choices.find(choice => choice.id === input.priceChoiceId)
            if (!choice || choice.kind === 'unsupported')
              throw new Error('Price evidence requires an issued, resolved price choice.')
            if (!['SEARCH_MENU', 'RECOMMEND'].includes(decision.intent) && choice.kind !== 'none')
              throw new Error('A price request cannot authorize a partial mutation.')
            resolutionContext = { ...resolutionContext, constraints: { ...resolutionContext.constraints, unresolvedPrice: false, ...(choice.conditions ? { price: choice.conditions } : {}) } }
          }
          if (!chosenRef && decision.intent === 'SEARCH_MENU' && input.searchInterpretation !== undefined) {
            if (input.searchInterpretation !== 'product' && input.searchInterpretation !== 'filter')
              throw new Error('Invalid bounded search interpretation.')
            if (input.searchInterpretation === 'product' && (!resolutionContext.productResolution.references.length || resolutionContext.productResolution.status === 'overflow'))
              throw new Error('Product interpretation requires issued finite catalog evidence.')
            resolutionContext = {
              ...resolutionContext,
              searchInterpretation: input.searchInterpretation,
              references: [...new Map([...resolutionContext.references, ...(input.searchInterpretation === 'product' ? resolutionContext.productResolution.references : [])].map(reference => [reference.refId, reference])).values()],
            }
          }
          if (!chosenRef && ['SEARCH_MENU', 'RECOMMEND'].includes(decision.intent) && (resolutionContext.ingredientReferences.length || resolutionContext.dietaryReferences.length)) {
            if (!input.ingredientFilters || typeof input.ingredientFilters !== 'object')
              throw new Error('Ingredient references require a bounded condition decision.')
            const filters = ingredientFilters(input.ingredientFilters as Record<string, unknown>)
            if (filters.dietary && !resolutionContext.dietaryReferences.some(reference => reference.id === filters.dietary))
              throw new Error('The dietary decision contains an unoffered reference.')
            const offeredIngredientIds = new Set([...resolutionContext.ingredientReferences.map(reference => reference.id), ...(filters.dietary ? vegetarianIngredients : [])])
            if ([...filters.excludeIngredients, ...filters.includeIngredients].some(id => !offeredIngredientIds.has(id)))
              throw new Error('The ingredient decision contains an unoffered reference.')
            resolutionContext = { ...resolutionContext, constraints: { ...resolutionContext.constraints, exclude: filters.excludeIngredients, include: filters.includeIngredients, ...(filters.dietary ? { dietary: filters.dietary } : {}) } }
          }
          const resolution = resolveIntent(decision, resolutionContext, chosenRef)
          // Only an effect that answers the old question inherits its expiry.
          // An independent new order may still be valid after that question's
          // answer window closes, within this intent lease and live revisions.
          const answersQuestion = resolution.kind === 'PLAN' && (resolution.plan.questionId || decision.intent === 'DEFER_QUESTION')
          if (answersQuestion && resolutionContext.waitingFor && resolutionContext.waitingFor.expiresAt <= Date.now())
            throw new Error('The issued question answer has expired. Resolve the retained question again.')
          if (decision.intent === 'REMOVE_ITEM' && resolution.kind === 'NEEDS_ASSISTANT' && resolutionContext.productResolution.status === 'exact' && resolutionContext.targetConstraints.itemIds.length && !currentContext.cart.lines.some(line => resolutionContext.targetConstraints.itemIds.includes(line.itemId))) {
            const itemIds = resolutionContext.targetConstraints.itemIds
            const labels = currentContext.menu.filter(item => itemIds.includes(item.id)).map(item => item.name)
            return { customerMessage: mealMessages.alreadyAbsent.replace('{items}', labels.join('、')), outcome: { status: 'already-absent', intent: 'REMOVE_ITEM', itemIds }, cart: machine.getCart(), decisionTrace: { resolveIntent: resolution, operationPlan: null, authorize: null } }
          }
          if (resolution.kind === 'CONFIGURATION') {
            const quantityRejection = rejectQuantity('order_add_item', resolution.plan.slots.quantity)
            if (quantityRejection)
              return quantityRejection
            if (!revisionsMatch(resolution.plan.expectedRevisions, currentContext.revisions) || currentContext.phase !== 'ordering')
              throw new Error('STALE_PLAN: The meal changed before requesting its options.')
            // Explicit new orders also preserve unfinished meals. Jev only sees
            // the new foreground question; the rest of the queue stays browser-owned.
            pendingFastPathClarification = undefined
            const result = await beginMeal(resolution.plan, onAction)
            return { ...(result && typeof result === 'object' ? result : {}), decisionTrace: { resolveIntent: resolution, operationPlan: null, authorize: null } }
          }
          if (resolution.kind === 'CLARIFICATION') {
            const expectedRevisions = clarificationRevisions(resolution.candidateRefs, resolutionContext)
            if (!revisionsMatch(expectedRevisions, currentContext.revisions))
              throw new Error('The selected Kiosk intent is stale. Resolve the latest customer state again.')
            pendingFastPathClarification = {
              id: crypto.randomUUID(),
              candidate: decision,
              candidateRefs: resolution.candidateRefs,
              context: resolutionContext,
              expectedRevisions,
            }
            if (decision.intent === 'ADD_ITEM' || decision.intent === 'SELECT_ITEM')
              pendingConfiguration = undefined
            const itemIds = resolution.candidateRefs.filter(ref => ref.startsWith('item:')).map(ref => ref.slice(5))
            if (itemIds.length) {
              // Show exactly the eligible, revision-bound targets in this question,
              // not the previous search or an arbitrarily selected first meal.
              const presentation: RecommendationPresentation = { kind: 'query-results', itemIds, title: '請選擇餐點' }
              presentationItemIds = itemIds
              await options.onRecommendationsChange?.(presentation)
            }
            return { customerMessage: resolution.prompt, decisionTrace: { authorize: null, operationPlan: null, resolveIntent: resolution }, pendingClarification: { candidateRefs: resolution.candidateRefs, intent: resolution.intent } }
          }
          if (resolution.kind !== 'PLAN') {
            const handoff: ConversationHandoff = { intent: decision.intent, status: resolution.kind === 'NEEDS_ASSISTANT' && resolution.targetResolution?.eligible.length ? 'unrepresentable' : 'unmatched', itemIds: resolutionContext.targetConstraints.itemIds, lineIds: resolutionContext.cart.lines.filter(line => resolutionContext.targetConstraints.itemIds.includes(line.itemId)).map(line => line.id) }
            return { decisionTrace: { authorize: null, operationPlan: null, resolveIntent: resolution }, handoff, needsAssistant: true }
          }
          const operation = compileOperationPlan(resolution.plan)
          const quantityRejection = rejectQuantity(operation.toolName, operation.input.quantity ?? operation.slots.quantity)
          if (quantityRejection)
            return quantityRejection
          const authorization = authorize(operation, currentContext)
          if (authorization.kind === 'BLOCKED')
            throw new Error(`The selected Kiosk intent is blocked: ${authorization.reason}.`)
          if (authorization.kind === 'REQUIRE_CONFIRMATION') {
            const confirmationId = crypto.randomUUID()
            const createdAt = Date.now()
            pendingFastPathConfirmation = {
              taskId: agentTask?.taskId,
              cart: cartFingerprint(machine.getCart()),
              operation: { ...operation, questionId: undefined },
              record: createConfirmation({
                action: operation.intent as PendingConfirmation['action'],
                cartRevision: operation.expectedRevisions.cart,
                checkoutRevision: operation.expectedRevisions.checkout,
                confirmationId,
                createdAt,
                expiresAt: createdAt + 15_000,
                payload: operation.slots,
                selectedItemRevision: operation.expectedRevisions.selectedItem,
              }),
            }
            // The ordinary question has been answered. The new one-use
            // confirmation record now owns authority for the exact operation.
            finishQuestion('answered')
            offeredQuestion = undefined
            return { customerMessage: confirmationMessage(operation, fulfillmentModes), decisionTrace: { authorize: authorization, operationPlan: operation, resolveIntent: resolution }, pendingConfirmation: { action: operation.intent, confirmationId }, pendingCustomerChoice: confirmationSnapshot(currentContext)!.waitingFor }
          }
          if (interrupted && (operation.intent === 'ADD_ITEM' || operation.intent === 'SELECT_ITEM')) {
            if (operation.intent === 'ADD_ITEM')
              suspendMeal()
            pendingFastPathClarification = undefined
          }
          const result = await invoke(operation.toolName, operation.input, onAction)
          const payload = result && typeof result === 'object' ? result as Record<string, unknown> : { result }
          if (operation.toolName === 'menu_get' && operation.intent === 'SEARCH_MENU' && operation.input.scope !== 'catalog' && resolution.plan.slots.scope === 'all' && Array.isArray(payload.items) && payload.items.length > 0) {
            const recommend = compileOperationPlan({ intent: 'RECOMMEND', slots: { ...resolution.plan.slots }, expectedRevisions: { ...operation.expectedRevisions, checkout: currentContext.revisions.checkout } })
            const candidateId = `continuation:recommend:${crypto.randomUUID()}`
            pendingReadContinuation = { candidateId, expiresAt: Date.now() + 15_000, operation: recommend, result: payload }
            const items = Array.isArray(payload.items) ? payload.items : []
            // Full results stay on screen. Review sees a labelled preview, not
            // a truncated catalog presented as the complete available set.
            const observation = JSON.stringify({ categories: payload.categories, itemCount: items.length, previewOnly: items.length > targetReferenceLimit, itemsPreview: items.slice(0, targetReferenceLimit).map(item => ({ name: item.name, price: item.price })) }).slice(0, 4_000)
            return { ...payload, continuation: { answer: String(payload.customerMessage ?? ''), candidates: [{ id: candidateId, description: '顧客同時要求推薦，從已查得的菜單補充簡單推薦；只查詢展示，不新增訂單。' }], observation }, decisionTrace: { authorize: authorization, operationPlan: operation, resolveIntent: resolution } }
          }
          return { ...payload, decisionTrace: { authorize: authorization, operationPlan: operation, resolveIntent: resolution } }
        }
        case 'kiosk_fast_path_continue': {
          const pending = pendingReadContinuation
          pendingReadContinuation = undefined
          if (!pending || pending.candidateId !== input.candidateId || pending.expiresAt <= Date.now())
            throw new Error('The read continuation has expired or was already consumed.')
          const authorization = authorize(pending.operation, currentFastPathContext())
          if (authorization.kind !== 'EXECUTE')
            throw new Error('The read continuation no longer matches the current state.')
          const result = await invoke(pending.operation.toolName, pending.operation.input, onAction)
          const payload = result && typeof result === 'object' ? result as Record<string, unknown> : {}
          return { ...payload, customerMessage: `${pending.result.customerMessage ?? ''} ${payload.customerMessage ?? ''}`.trim(), decisionTrace: { authorize: authorization, operationPlan: pending.operation } }
        }
      }
    }
    finally {
      if (presentationToolName)
        await options.onMenuPresentationActivity?.({ state: 'idle', toolName: presentationToolName })
    }
  }

  // Preserve rejection precedence: intent, read authority, unresolved menu,
  // active meal confirmation, then unresolved price.
  function agentToolRestriction(name: MenuToolName) {
    const expected = agentTask?.handoff && intentTools[agentTask.handoff.intent]
    const mutation = !menuBrowsingToolNames.has(name) && !['cart_get', 'seating_get', 'menu_open', 'menu_scroll', 'order_ask_question'].includes(name)
    if (expected && ((mutation && !expected.includes(name)) || (agentTask?.handoff?.intent === 'REMOVE_ITEM' && menuBrowsingToolNames.has(name))))
      return 'intent'
    if (agentTask?.readOnly && !menuBrowsingToolNames.has(name) && !['cart_get', 'seating_get', 'order_ask_question'].includes(name))
      return 'read-only'
    // Confirmation answers have their own presented-ticket validation before menu locks.
    if (name === 'order_answer_confirmation')
      return
    if (agentTask?.unresolvedMenu && !menuBrowsingToolNames.has(name) && !['cart_get', 'seating_get', 'order_ask_question', 'order_defer_question', 'menu_confirm_item'].includes(name))
      return 'unresolved-menu'
    if (mealClarification.question(currentFastPathContext()) && !['menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get', 'seating_get'].includes(name))
      return 'meal-confirmation'
    if (agentTask?.unresolvedPrice && !['cart_get', 'seating_get'].includes(name))
      return 'unresolved-price'
  }

  /** Applies the browser-owned state policy before a conversational Agent's tool call. */
  async function invokeForAgent(name: MenuToolName, input: Record<string, unknown> = {}) {
    const task = agentTask
    const mutation = !menuBrowsingToolNames.has(name) && !['cart_get', 'seating_get', 'menu_open', 'menu_scroll', 'order_ask_question'].includes(name)
    const expected = task?.handoff && intentTools[task.handoff.intent]
    if (agentToolRestriction(name) === 'intent')
      throw new Error('The proposed tool does not address this task\'s requested effect.')
    if (expected && name.startsWith('cart_') && typeof input.lineId === 'string' && !task?.handoff?.lineIds.includes(input.lineId))
      throw new Error('The cart line does not belong to this task\'s resolved targets.')
    if (task?.allowedToolNames && !isKioskHostOnlyToolName(name) && !task.allowedToolNames.includes(name))
      throw new Error('This tool is not available in the current task context.')
    if (task?.expectedRevisions && mutation && !revisionsMatch(task.expectedRevisions, currentFastPathRevisions()))
      throw new Error('STALE_PLAN: The order changed after Main received its context.')
    // These failures are proven before executeAgentOperation can reveal a
    // control, change selection/cart, or publish a recommendation. The Host
    // may request one corrected proposal, never replay an attempted effect.
    if (name === 'menu_get' && currentFastPathContext().phase === 'ordering' && input.scope !== 'catalog' && input.display !== false && input.verifyClaim !== true) {
      const { queries } = getMenuQuery(input)
      if (!queries.length)
        return { ok: false, executed: false, toolName: name, error: 'MENU_QUERY_ACTION_REQUIRED', message: '這次查詢未執行。沒有具體品名的分類／價格／飲食條件查詢，使用menu_recommend並明確傳action:update及本句條件；已有查詢只換其他用action:continue。menu_get僅查具體品名或明確scope:catalog。不要重做本輪已成功的操作。' }
    }
    if (name === 'order_add_item' && Array.isArray(input.options)) {
      const groups = input.options.map(option => option && typeof option === 'object' && !Array.isArray(option) ? option.groupId : undefined)
      if (groups.some(group => typeof group === 'string') && new Set(groups).size !== groups.length)
        return { ok: false, executed: false, toolName: name, error: 'INVALID_OPTION_COMBINATION', message: '這次加購未執行。每筆order_add_item的每個groupId只能選一個valueId。同一道餐不同規格須分別呼叫，每筆使用顧客指定的各自份數；例如一份大辣和一份小辣是兩個呼叫各quantity:1，不能quantity:2加兩個spice。不要重做本輪已成功的操作。' }
    }
    const quantityRejection = rejectQuantity(name, input.quantity)
    if (quantityRejection)
      return quantityRejection
    const result = await executeAgentOperation(name, input)
    // Only this task's accepted write may advance a same-batch plan. Reads
    // never rebase an external cart change or revive a confirmation ticket.
    if (task && task === agentTask && mutation && (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== false))
      task.expectedRevisions = { ...currentFastPathRevisions() }
    return result
  }

  async function executeAgentOperation(name: MenuToolName, input: Record<string, unknown> = {}) {
    const restriction = agentToolRestriction(name)
    if (isKioskHostOnlyToolName(name))
      throw new Error('Kiosk host decision tools are unavailable to the Agent.')
    // A host-qualified inquiry has read authority only for this task. Guard
    // even a successful lookup: finding a real dish is not permission to buy,
    // answer fulfillment, or replace a pending question. New tasks reset this.
    if (restriction === 'read-only')
      throw new Error('This task only authorizes menu reads; order changes require a new customer request.')
    if (name === 'order_answer_confirmation') {
      const context = currentFastPathContext()
      const navigation = navigationSnapshot(context)
      if (navigation && pendingNavigation?.presented && pendingNavigation.taskId !== agentTask?.taskId && navigation.waitingFor.questionId === input.confirmationId && typeof input.confirmedByUser === 'boolean') {
        const answer = navigationSnapshot(context, true)!
        return await answerNavigation(answer.candidates[input.confirmedByUser ? 0 : 1]!.id)
      }
      const meal = mealClarification.question(context)
      if (mealClarification.canAnswer(context, agentTask?.taskId) && meal?.questionId === input.confirmationId && typeof input.confirmedByUser === 'boolean') {
        const answerContext = deriveDecisionContext({ ...context, transcript: agentTask!.transcript })
        const answer = mealClarification.issueAnswer(answerContext)!
        return await invoke('kiosk_fast_path_execute', { candidateId: answer.choices[input.confirmedByUser ? 0 : 1]!.id })
      }
      const pending = pendingFastPathConfirmation
      if (!pending || !pending.presented || (agentTask && pending.taskId === agentTask.taskId) || input.confirmationId !== pending.record.confirmationId || typeof input.confirmedByUser !== 'boolean' || !confirmationIsValid(pending, currentFastPathContext()))
        throw new Error('STALE_PLAN: This confirmation is not a current presented action for this customer turn.')
      return await invoke('kiosk_fast_path_execute', { candidateId: `intent:${input.confirmedByUser ? 'confirm' : 'cancel-confirmation'}:${pending.record.confirmationId}` })
    }
    // cart_get normally offers a fresh fulfillment question even for data-only
    // reads. Return a current snapshot without an offer or screen transition.
    if (agentTask?.readOnly && name === 'cart_get') {
      if (input.display === true)
        await revealReview(options.onAction)
      return { cart: machine.getCart() }
    }
    // A failed named lookup leaves this customer's request unresolved. Do not
    // execute a partial removal or silently substitute another meal. This latch
    // belongs to the host-bound task; only a new task/customer turn resets it.
    if (restriction === 'unresolved-menu' && agentTask) {
      if (agentTask.expiresAt <= Date.now() || agentTask.menuRevision !== machine.getRevisions().menu)
        throw new Error('STALE_PLAN: Agent task constraints expired or catalog changed.')
      return { ok: false, customerMessage: mealMessages.unresolvedMenu }
    }
    if (restriction === 'meal-confirmation')
      throw new Error('Answer the active meal confirmation before changing the order.')
    // Missing price semantics cannot be bypassed by guessing a known item ID
    // and going straight to an order/cart tool without a qualified menu read.
    if (restriction === 'unresolved-price' && agentTask) {
      if (agentTask.expiresAt <= Date.now() || agentTask.menuRevision !== machine.getRevisions().menu)
        throw new Error('STALE_PLAN: Agent task constraints expired or catalog changed.')
      // The host stops on ok:false. This is a clarification boundary, not an
      // empty search result that the Agent may retry with guessed amounts.
      return { ok: false, items: [], customerMessage: priceClarification }
    }
    if (name === 'menu_confirm_item')
      return await invoke(name, input)
    if (agentTask?.targetItemIds && itemTargetToolNames.has(name)) {
      if (agentTask.expiresAt <= Date.now() || agentTask.menuRevision !== machine.getRevisions().menu)
        throw new Error('STALE_PLAN: Agent product evidence expired or catalog changed.')
      const itemId = selectionToolNames.has(name) ? machine.getSelection()?.itemId : input.itemId
      // Reading an alternative (or the whole catalog) cannot turn it into the
      // requested dish. A new customer choice must begin a new host-bound task.
      if (typeof itemId !== 'string' || !agentTask.targetItemIds.includes(itemId))
        return { ok: false, executed: false, toolName: name, error: 'UNCONFIRMED_ITEM', message: '這次新增未執行。顧客尚未指定唯一餐點，不能從幾道展示品項猜選一項。請回覆clarification詢問要哪一道，沒有真實選擇前不要新增、替代或重送。', customerMessage: mealMessages.unconfirmedItem }
    }
    if (agentTask && ['order_add_item', 'cart_add_item'].includes(name)) {
      const itemId = name === 'cart_add_item' ? machine.getSelection()?.itemId : input.itemId
      const item = machine.getMenu().find(item => item.id === itemId)
      const source = deriveDecisionContext({ ...currentFastPathContext(), transcript: agentTask.transcript })
      const addition = source.candidates.find(candidate => candidate.intent === 'ADD_ITEM')
      const resolved = addition && resolveIntent(addition, source)
      // Tool quantities are model output, not customer evidence. A named dish
      // without a serving count uses the same existing draft as the Jev route.
      const replacing = name === 'order_add_item' && typeof input.replaceLineId === 'string' ? machine.getCart().lines.find(line => line.id === input.replaceLineId) : undefined
      if (resolved?.kind === 'CONFIGURATION' && resolved.plan.slots.quantity === undefined && pendingConfiguration?.plan.slots.quantity === undefined) {
        // Replacing a real line preserves its known count. Treating it as a
        // fresh add loses replaceLineId and leaves subsequent turns in a draft.
        if (!replacing)
          return await beginMeal(resolved.plan, options.onAction)
        if (input.quantity !== undefined && input.quantity !== replacing.quantity)
          throw new Error('Replacement without a new serving count must retain the original quantity.')
      }
      const remaining = source.catalogEvidence.products.reduce((text, product) => text.replaceAll(product.matchedText, ''), agentTask.transcript)
      if (item && (unsupportedPreparation(item, remaining).length || (!item.optionGroups.length && (mentionedIngredients(remaining).length || mentionedUnavailableConditions(remaining).length))))
        return await invoke('menu_confirm_item', { itemId: item.id, originalRecipe: true, ...(input.replaceLineId ? { replaceLineId: input.replaceLineId } : {}) })
    }
    if (menuBrowsingToolNames.has(name) && agentTask && (agentTask.expiresAt <= Date.now() || agentTask.menuRevision !== machine.getRevisions().menu))
      throw new Error('STALE_PLAN: Agent task constraints expired or catalog changed.')
    if (name === 'menu_recommend' && !['ordering', 'customer_entry'].includes(currentFastPathContext().phase))
      throw new Error('Menu exploration is unavailable in the current phase.')
    if (name === 'menu_recommend') {
      const action = requiredString(input, 'action')
      if (!['continue', 'update', 'reset', 'clarify'].includes(action))
        throw new Error('Invalid query action.')
      const { action: _action, clear, ...patch } = input
      if ('more' in patch)
        throw new Error('Use an explicit action instead of more.')
      if (action === 'continue') {
        // Repeated price fields are expectations, never a condition update.
        // Main can restate the active bound when requesting another batch;
        // verify every supplied value before removing it from the update patch.
        // A changed/new bound still fails without consuming the next batch.
        const expectedPrices = priceConditions(patch)
        for (const key of Object.keys(expectedPrices) as Array<keyof PriceConditions>) {
          if (!recommendationBatch || expectedPrices[key] !== recommendationBatch.prices[key])
            throw new Error('continue cannot change query conditions.')
          delete patch[key]
        }
        // Restating a saved condition is an expectation, not an update. Compare
        // sets without order and reject any widened or newly introduced value.
        for (const key of ['category', 'dietary', 'excludeIngredients', 'includeIngredients'] as const) {
          if (!(key in patch))
            continue
          const expected = key === 'category' ? recommendationBatch?.category : recommendationBatch?.filters[key]
          const supplied = key === 'excludeIngredients' || key === 'includeIngredients'
            ? ingredientFilters({ ...patch, dietary: patch.dietary ?? recommendationBatch?.filters.dietary })[key]
            : patch[key]
          const same = Array.isArray(supplied) && Array.isArray(expected)
            ? JSON.stringify([...supplied].sort()) === JSON.stringify([...expected].sort())
            : supplied === expected
          if (!recommendationBatch || !same)
            throw new Error(`continue cannot change query conditions: ${key}.`)
          delete patch[key]
        }
      }
      if ((action === 'continue' || action === 'clarify') && (clear !== undefined || Object.keys(patch).some(key => key !== 'limit')))
        throw new Error(`${action} cannot change query conditions.`)
      if (action === 'continue' && recommendationBatch && recommendationBatch.menuRevision !== machine.getRevisions().menu)
        throw new Error('STALE_PLAN: Query conditions belong to an older menu.')
      if (action === 'continue' && recommendationBatch?.queries.length)
        recommendationBatch = { ...recommendationBatch, queries: [], exhausted: false }
      // No preceding batch/presentation is an unresolved reference, not a
      // transport error. Ask through the existing scope-clarification reply;
      // never invent a first batch or relax stale-catalog checks above.
      const missingContinuation = action === 'continue' && !recommendationBatch && !presentationItemIds?.length
      if (action === 'clarify' || missingContinuation || (action === 'continue' && recommendationBatch?.exhausted))
        return await queryGuidance(recommendationBatch?.exhausted ? 'exhausted' : 'unclear', input.display !== false)
      if (action === 'continue') {
        input = { ...patch, action, more: true }
      }
      else {
        if (action === 'reset' && clear !== undefined)
          throw new Error('reset retains dietary conditions; use update to explicitly clear conditions.')
        const groups = ['price', 'category', 'query', 'needs', 'strategy', 'dietary', 'ingredients', 'includeIngredients', 'excludedItems']
        if (clear !== undefined && (!Array.isArray(clear) || clear.some(value => typeof value !== 'string' || !groups.includes(value))))
          throw new Error('Invalid query condition group.')
        const cleared = new Set<string>(Array.isArray(clear) ? clear : [])
        const previous = recommendationBatch
        if (previous && previous.menuRevision !== machine.getRevisions().menu)
          throw new Error('STALE_PLAN: Query conditions belong to an older menu.')
        // A supplied price group replaces its old bounds. Other groups retain
        // browser-owned values unless explicitly changed or cleared; reset
        // only releases browsing scope, never dietary restrictions or history.
        const prices = action === 'update' && !cleared.has('price') && patch.minPrice === undefined && patch.maxPrice === undefined ? previous?.prices : undefined
        const category = action === 'update' && !cleared.has('category') ? previous?.category : undefined
        const queries = action === 'update' && !cleared.has('query') && patch.query === undefined && patch.queries === undefined ? previous?.queries : undefined
        const needs = action === 'update' && !cleared.has('needs') ? previous?.needs : undefined
        const strategy = action === 'update' && !cleared.has('strategy') ? previous?.strategy : undefined
        const filters = previous?.filters
        input = {
          ...prices,
          ...(category ? { category } : {}),
          ...(queries?.length ? { queries } : {}),
          ...(needs?.length ? { needs } : {}),
          ...(strategy ? { strategy } : {}),
          ...(!cleared.has('dietary') && filters?.dietary ? { dietary: filters.dietary } : {}),
          ...(!cleared.has('ingredients') && filters ? { excludeIngredients: filters.excludeIngredients, includeIngredients: cleared.has('includeIngredients') ? [] : filters.includeIngredients } : {}),
          ...(!cleared.has('excludedItems') && previous ? { excludeItemIds: previous.excludedItemIds } : {}),
          ...patch,
          action,
        }
        // New exclusions add to confirmed food constraints. Removing a group
        // requires an explicit clear; updating a price cannot release it.
        if (previous && !cleared.has('excludedItems'))
          input.excludeItemIds = [...new Set([...previous.excludedItemIds, ...menuExclusions(patch, machine.getMenu())])]
        if (filters && !cleared.has('ingredients')) {
          const supplied = ingredientFilters(patch)
          input.excludeIngredients = [...new Set([...filters.excludeIngredients, ...supplied.excludeIngredients])]
          // An explicit new exclusion revokes the same previous preference.
          // Existing exclusions remain additive: wanting egg cannot release
          // an egg allergy; simultaneous include/exclude stays contradictory.
          // Withdrawing a positive preference never clears exclusions/allergies.
          const retainedIncludes = cleared.has('includeIngredients') ? [] : filters.includeIngredients
          input.includeIngredients = [...new Set([...retainedIncludes.filter(id => !supplied.excludeIngredients.includes(id)), ...supplied.includeIngredients])]
        }
      }
    }
    if (name === 'menu_get' && currentFastPathContext().phase === 'ordering' && input.scope !== 'catalog' && input.display !== false) {
      const { category, queries } = getMenuQuery(input)
      if (!category && !queries.length && !['ordering', 'customer_entry'].includes(currentFastPathContext().phase))
        throw new Error('Menu exploration is unavailable in the current phase.')
      if (!queries.length && input.verifyClaim === true)
        throw new Error('Specify the meal names being verified with query or queries.')
      if (!queries.length)
        throw new Error('Menu browsing presentation requires menu_recommend with an explicit action.')
    }
    if (agentTask && menuBrowsingToolNames.has(name)) {
      // Tool arguments cannot turn a customer-wide price/filter query into a
      // named lookup of the previous recommendation. The source utterance owns
      // subject evidence, independently from the model's chosen arguments.
      if (name === 'menu_get' && agentTask.readOnly && agentTask.broadMenuQuery && (Object.keys(agentTask.prices).length || agentTask.filters.dietary || agentTask.filters.excludeIngredients.length || agentTask.filters.includeIngredients.length)) {
        const { query: _query, queries: _queries, category: _category, more: _more, ...conditions } = input
        input = conditions
      }
      if (agentTask.expiresAt <= Date.now() || agentTask.menuRevision !== machine.getRevisions().menu)
        throw new Error('STALE_PLAN: Agent task constraints expired or catalog changed.')
      const prices = intersectPrices(agentTask.prices, priceConditions(input))
      const supplied = ingredientFilters(input)
      const filters: IngredientFilters = {
        excludeIngredients: [...new Set([...agentTask.filters.excludeIngredients, ...supplied.excludeIngredients])],
        includeIngredients: [...new Set([...agentTask.filters.includeIngredients, ...supplied.includeIngredients])],
        ...(agentTask.filters.dietary || supplied.dietary ? { dietary: agentTask.filters.dietary ?? supplied.dietary } : {}),
      }
      if (filters.includeIngredients.some(id => filters.excludeIngredients.includes(id)))
        throw new Error('Task constraint conflict: start a new customer task to change conditions.')
      if (name === 'menu_show_recommendations') {
        const presentation = recommendationPresentation(input)
        const validIds = new Set(filterIngredients(filterPrices(machine.getMenu(), prices), filters).matches.map(item => item.id))
        if (presentation.itemIds.some(id => !validIds.has(id)))
          throw new Error('Recommendations violate the current task constraints.')
      }
      else {
        input = { ...input, ...filters, ...prices }
      }
    }
    // Agent menu browsing uses the same venue policy unless it explicitly
    // requests a data-only read for its own lookup work.
    if (name === 'menu_get') {
      const lookupTask = agentTask
      const result = await invoke(name, { ...input, display: input.display ?? true }, options.onAction, lookupTask)
      // Presentation can await cursor work. An older task's lookup must never
      // latch a successor after the host has ended/replaced that task.
      if (lookupTask && agentTask === lookupTask && result && typeof result === 'object' && 'items' in result && Array.isArray(result.items)) {
        const { category, queries } = getMenuQuery(input)
        const selectable = machine.getMenu(category || undefined).filter(item => itemAvailability(item).status === 'available')
        if (queries.some(query => !selectable.some(item => itemMatchesQuery(item, query))) || (queries.length > 0 && result.items.length === 0))
          lookupTask.unresolvedMenu = true
      }
      return result
    }
    if (name === 'cart_get' || name === 'seating_get' || name === 'order_ask_question' || name === 'order_defer_question' || name === 'order_cancel_request')
      return await invoke(name, input)
    if (machine.getCart().fulfillmentMode === 'dine-in')
      await options.seating?.refresh()

    const context = currentFastPathContext()
    if (agentTask && Object.keys(agentTask.prices).length && ['menu_select_item', 'order_add_item', 'cart_add_item'].includes(name)) {
      const itemId = name === 'cart_add_item' ? machine.getSelection()?.itemId : input.itemId
      const item = machine.getMenu().find(item => item.id === itemId)
      if (!item || !filterPrices([item], agentTask.prices).length)
        throw new Error('Selected item violates the current task price conditions.')
    }
    // Reaffirming an already selected mode has no checkout side effect. Use
    // the same no-op receipt as touch/Fast Path before asking change consent.
    if (name === 'order_set_fulfillment' && input.mode === context.cart.fulfillmentMode)
      return await invoke(name, input)
    if (name === 'checkout_start' && context.cart.lines.length > 0 && !context.cart.fulfillmentMode)
      throw new Error('Choose dine-in or self-pickup before starting checkout.')
    if (cartLineToolNames.has(name) && context.phase === 'ordering') {
      const lineId = requiredString(input, 'lineId')
      const line = context.cart.lines.find(candidate => candidate.id === lineId)
      const sameItemLines = context.cart.lines.filter(candidate => candidate.itemId === line?.itemId)
      if (line && sameItemLines.length > 1) {
        if (pendingFastPathConfirmation || pendingFastPathClarification)
          throw new Error('Another customer clarification or confirmation is already pending.')
        const intent = name === 'cart_remove_item' ? 'REMOVE_ITEM' : name === 'cart_set_line_quantity' ? 'SET_QUANTITY' : 'SET_OPTION'
        const slots: Record<string, string | number> = {}
        if (name === 'cart_set_line_quantity')
          slots.quantity = requiredNumber(input, 'quantity')
        if (name === 'cart_set_line_option') {
          slots.groupId = requiredString(input, 'groupId')
          slots.valueId = requiredString(input, 'valueId')
        }
        const originalCandidate = context.candidates.find(candidate => candidate.intent === intent)!
        const candidate = { ...originalCandidate, slots }
        const resolutionContext = { ...context, candidates: context.candidates.map(existing => existing.id === candidate.id ? candidate : existing) }
        const candidateRefs = sameItemLines.map(candidate => `cart:${candidate.id}`)
        const references = context.references.filter(reference => candidateRefs.includes(reference.refId))
        pendingFastPathClarification = {
          id: crypto.randomUUID(),
          candidate,
          candidateRefs,
          context: resolutionContext,
          expectedRevisions: clarificationRevisions(candidateRefs, context),
        }
        return { customerMessage: buildClarificationPrompt(references), pendingClarification: { candidateRefs, intent } }
      }
    }
    if (name === 'order_add_item' && input.replaceLineId !== undefined && input.quantity === undefined) {
      const original = context.cart.lines.find(line => line.id === input.replaceLineId)
      if (original)
        input = { ...input, quantity: original.quantity }
    }
    const selected = context.selectedItem
    const slots: OperationPlan['slots'] = {}
    let targetRef: string | undefined
    let intent: OperationPlan['intent']
    switch (name) {
      case 'menu_open':
        intent = 'RETURN_MENU'
        break
      case 'menu_scroll':
        intent = 'SCROLL_MENU'
        slots.direction = requiredString(input, 'direction')
        break
      case 'menu_recommend':
        intent = 'RECOMMEND'
        break
      case 'menu_show_recommendations':
        intent = 'SHOW_RECOMMENDATIONS'
        break
      case 'menu_select_item':
        intent = 'SELECT_ITEM'
        slots.itemId = requiredString(input, 'itemId')
        targetRef = `item:${slots.itemId}`
        break
      case 'menu_set_item_option':
        intent = 'SET_OPTION'
        targetRef = `selected:${selected?.itemId ?? ''}`
        slots.groupId = String(input.groupId ?? '')
        slots.valueId = String(input.valueId ?? '')
        break
      case 'menu_set_quantity':
        intent = 'SET_QUANTITY'
        targetRef = `selected:${selected?.itemId ?? ''}`
        slots.quantity = Number(input.quantity)
        break
      case 'order_add_item':
        intent = 'ADD_ITEM'
        slots.itemId = String(input.itemId ?? '')
        slots.quantity = Number(input.quantity ?? 1)
        targetRef = `item:${slots.itemId}`
        break
      case 'cart_add_item':
        intent = 'ADD_ITEM'
        slots.itemId = selected?.itemId ?? ''
        slots.quantity = selected?.quantity ?? 0
        targetRef = `selected:${slots.itemId}`
        break
      case 'cart_remove_item':
        intent = 'REMOVE_ITEM'
        targetRef = `cart:${String(input.lineId ?? '')}`
        break
      case 'cart_set_line_quantity':
        intent = 'SET_QUANTITY'
        targetRef = `cart:${String(input.lineId ?? '')}`
        slots.quantity = Number(input.quantity)
        break
      case 'cart_set_line_option':
        intent = 'SET_OPTION'
        targetRef = `cart:${String(input.lineId ?? '')}`
        slots.groupId = String(input.groupId ?? '')
        slots.valueId = String(input.valueId ?? '')
        break
      case 'cart_clear':
        intent = 'CLEAR_CART'
        break
      case 'order_set_fulfillment':
        intent = 'SET_FULFILLMENT'
        slots.mode = String(input.mode ?? '')
        break
      case 'order_set_party_size':
        intent = 'SET_PARTY_SIZE'
        slots.partySize = requiredNumber(input, 'partySize')
        break
      case 'seating_reserve':
        intent = 'RESERVE_TABLES'
        slots.choiceId = requiredString(input, 'choiceId')
        slots.splitApproved = input.splitApproved === true ? 'yes' : 'no'
        targetRef = `table:${slots.choiceId}`
        break
      case 'checkout_start':
        intent = 'START_CHECKOUT'
        break
      case 'checkout_skip_membership':
        intent = 'SKIP_MEMBERSHIP'
        break
      case 'customer_skip_phone':
        intent = 'SKIP_CUSTOMER_ENTRY'
        break
      case 'checkout_choose_invoice':
        intent = 'CHOOSE_INVOICE'
        slots.method = String(input.method ?? '')
        break
      case 'checkout_request_tax_id':
        intent = 'REQUEST_TAX_ID'
        break
      case 'checkout_set_tax_id':
        intent = 'SET_TAX_ID'
        slots.taxId = String(input.taxId ?? '')
        break
      case 'checkout_confirm_invoice':
        intent = 'CONFIRM_INVOICE'
        break
      case 'checkout_confirm_tax_id':
        intent = 'CONFIRM_TAX_ID'
        slots.taxId = context.checkout?.taxId ?? ''
        break
      case 'checkout_select_payment':
        intent = 'SELECT_PAYMENT'
        slots.method = String(input.method ?? '')
        break
      case 'checkout_cancel':
        intent = 'CANCEL_CHECKOUT'
        break
    }
    const operation: OperationPlan = {
      expectedRevisions: { ...context.revisions, ...(intent === 'RESERVE_TABLES' ? { seating: requiredNumber(input, 'expectedRevision') } : {}) },
      input: { ...input, ...(['customer_skip_phone', 'cart_clear', 'checkout_start', 'checkout_skip_membership', 'checkout_confirm_tax_id', 'checkout_confirm_invoice', 'checkout_cancel'].includes(name) ? { confirmedByUser: true } : {}) },
      intent,
      slots,
      ...(targetRef ? { targetRef } : {}),
      toolName: name,
    }
    const authorization = authorize(operation, context)
    if (authorization.kind === 'BLOCKED')
      throw new Error(`The Agent WebMCP operation is blocked: ${authorization.reason}.`)
    if (authorization.kind === 'REQUIRE_CONFIRMATION') {
      if (pendingFastPathConfirmation && confirmationIsValid(pendingFastPathConfirmation, context))
        throw new Error('Another customer confirmation is already pending.')
      const createdAt = Date.now()
      const confirmationId = crypto.randomUUID()
      pendingFastPathConfirmation = {
        taskId: agentTask?.taskId,
        cart: cartFingerprint(context.cart),
        operation,
        record: createConfirmation({
          action: operation.intent as PendingConfirmation['action'],
          cartRevision: context.revisions.cart,
          checkoutRevision: context.revisions.checkout,
          confirmationId,
          createdAt,
          expiresAt: createdAt + 15_000,
          payload: slots,
          selectedItemRevision: context.revisions.selectedItem,
        }),
      }
      return { customerMessage: confirmationMessage(operation, fulfillmentModes), pendingConfirmation: { action: operation.intent, confirmationId }, pendingCustomerChoice: confirmationSnapshot(context)!.waitingFor }
    }
    if (authorize(operation, currentFastPathContext()).kind !== 'EXECUTE')
      throw new Error('The Agent WebMCP operation became stale before execution.')
    return await invoke(name, operation.input)
  }

  async function reset() {
    options.checkout?.assertCanRestart()
    if (tableSubmissionPending || tableSubmissionUncertain)
      throw new Error('隨桌訂單尚待確認，請勿重新開始。')
    // Resolve the next round before clearing local state; a failed context
    // refresh or uncertain order must leave the current cart/question intact.
    await options.onSessionReset?.()
    await options.seating?.reset()
    tableOrderReview = undefined
    recommendationBatch = undefined
    options.onQueryStateChange?.(undefined)
    agentTask = undefined
    options.onAgentControlChange?.(false)
    recommendationRevision++
    pendingFastPathConfirmation = undefined
    pendingFastPathClarification = undefined
    clearMealProgress()
    waitingFor = undefined
    offeredQuestion = undefined
    questionHistory.clear()
    pendingReadContinuation = undefined
    issuedFastPathContext = undefined
    clearQueryScope()
    let cart = machine.reset()
    fulfillmentModes = policy().requiresPayment ? configuredFulfillmentModes : [{ id: 'dine-in', label: '隨桌供餐' }]
    options.onFulfillmentChange?.(undefined)
    if (!policy().requiresPayment) {
      cart = machine.setFulfillmentMode('dine-in')
      options.onFulfillmentChange?.('dine-in')
    }
    completedOrderId = undefined
    presentationItemIds = undefined
    presentationFocus = undefined
    options.onCartChange(cart)
    options.onMenuSelection(undefined)
    options.onFulfillmentChange?.(cart.fulfillmentMode)
    return { cart }
  }

  /** Direct table submission is separate from the payment-authorized Kiosk entry. */
  async function confirmTableOrder() {
    if (tableSubmissionPending || tableSubmissionUncertain)
      throw new Error('隨桌訂單尚待確認，請勿重送。')
    const context = options.serviceContext?.()
    if (policy().requiresPayment || !context?.table || !context.directSubmissionSupported)
      throw new Error('目前無法直接送出隨桌訂單。')
    // Both voice and touch consume review authority before awaiting POS. A
    // failed result cannot leave an earlier send question available for reuse.
    tableOrderReview = undefined
    finishQuestion('answered')
    offeredQuestion = undefined
    tableSubmissionPending = true
    try {
      const order = await machine.confirmOrder().catch((error) => {
        // Without a receipt we cannot prove the POS rejected the request.
        // Observer failures after a received result must not erase that result.
        tableSubmissionUncertain = true
        throw error
      })
      tableSubmissionUncertain = order.receipt.status === 'uncertain'
      options.onOrderSubmission?.(order)
      if (order.receipt.status === 'accepted' && completedOrderId !== order.id) {
        completedOrderId = order.id
        options.onOrderConfirmed?.(order)
      }
      return { order, customerMessage: order.receipt.customerMessage }
    }
    finally { tableSubmissionPending = false }
  }

  /** Submits only after the customer-facing payment terminal returns its verified transaction ID. */
  async function confirmPaidOrder(paymentId: string) {
    if (!policy().requiresPayment)
      throw new Error('隨桌模式不使用付款送單。')
    machine.setPaymentId(paymentId)
    const order = await machine.confirmOrder()
    const { receipt } = order
    options.onOrderSubmission?.(order)
    if (receipt.status === 'accepted' && completedOrderId !== order.id) {
      completedOrderId = order.id
      options.onOrderConfirmed?.(order)
    }
    return order
  }

  return {
    confirmPaidOrder,
    confirmTableOrder,
    getQueryState,
    /** Manual close revokes the rendered draft, never a later meal or a cart line. */
    closeSelection(itemId: string) {
      if (options.visibleItemId?.() !== itemId || agentTask)
        return false
      if (pendingConfiguration?.plan.slots.itemId === itemId)
        pendingConfiguration = undefined
      if (pendingNavigation?.itemId === itemId)
        pendingNavigation = undefined
      const proposal = mealClarification.progress(currentFastPathContext())
      if (proposal?.itemId === itemId)
        mealClarification.clear()
      machine.clearSelection(itemId)
      issuedFastPathContext = undefined
      options.onClarificationChange?.(undefined)
      options.onMenuSelection(undefined)
      return true
    },
    /** Touch-only removal binds to the rendered query revision, never model prose. */
    removeQueryCondition: async (condition: QueryCondition, revision: number) => {
      if (manualOperations)
        throw new Error('MANUAL_CONTROL: Wait for the current touch operation to settle.')
      if (agentTask)
        throw new Error('AGENT_CONTROL: Wait for the active operation to settle.')
      const state = getQueryState()
      if (!state || state.revision !== revision || !recommendationBatch || !state.conditions.some(current => current.group === condition.group && current.value === condition.value && current.removable))
        throw new Error('STALE_QUERY: The displayed condition is no longer current.')
      manualOperations++
      try {
        return await invokeForAgent('menu_recommend', removeCondition(recommendationBatch, condition))
      }
      finally {
        manualOperations--
      }
    },
    invoke,
    invokeForAgent,
    /** Approved iframe transport entry; domain refusals remain structured tool receipts. */
    executeTool: async (name: MenuToolName, input: Record<string, unknown>) => {
      const quantityRejection = rejectQuantity(name, input.quantity)
      if (quantityRejection)
        return quantityRejection
      try {
        return isKioskHostOnlyToolName(name) ? await invoke(name, input) : await invokeForAgent(name, input)
      }
      catch (error) {
        return invocationFailure(name, error)
      }
    },
    /** Customer admission is separate from host/Agent execution, including animated writes. */
    invokeManual: async (name: MenuToolName, input: Record<string, unknown> = {}, onAction = options.onAction) => {
      // Expiry invalidates model conditions; it cannot prove an in-flight write settled.
      // Only a matching END or an explicit host reset releases customer control.
      if (agentTask)
        throw new Error('AGENT_CONTROL: Wait for the active operation to settle.')
      manualOperations++
      try {
        return await invoke(name, input, onAction)
      }
      finally {
        manualOperations--
      }
    },
    reset,
    setMenu: (items: MenuItem[], revision?: string) => {
      if (!machine.getCart().itemCount && pendingConfiguration && machine.getSelection()?.itemId === pendingConfiguration.plan.slots.itemId) {
        // A catalog replacement invalidates an unadded draft, not a committed
        // order. Retire its old option/price authority before loading the catalog.
        machine.clearSelection(String(pendingConfiguration.plan.slots.itemId))
        clearMealProgress()
        options.onMenuSelection(undefined)
      }
      machine.setMenu(items, revision)
      options.onQueryStateChange?.(getQueryState())
    },
    setFulfillmentModes: (modes: typeof fulfillmentModes) => {
      configuredFulfillmentModes = modes
      if (!policy().requiresPayment) {
        modes = [{ id: 'dine-in', label: '隨桌供餐' }]
        if (!machine.getCart().fulfillmentMode) {
          const cart = machine.setFulfillmentMode('dine-in')
          options.onFulfillmentChange?.('dine-in')
          options.onCartChange(cart)
        }
      }
      fulfillmentModes = [...modes]
      // Updated capabilities invalidate issued plans, not retained needs.
      // The next decision derives fresh choices from the current POS modes.
      if (waitingFor)
        waitingFor = { ...waitingFor, expiresAt: 0 }
      if (offeredQuestion)
        offeredQuestion = { ...offeredQuestion, expiresAt: 0 }
      issuedFastPathContext = undefined
    },
    get toolDefinitions() { return availableToolDefinitions() },
  }
}

function confirmationMessage(operation: OperationPlan, modes: readonly { id: FulfillmentMode, label: string }[]) {
  switch (operation.intent) {
    case 'CLEAR_CART': return '要清空目前購物車嗎？'
    case 'CANCEL_CHECKOUT': return '要取消目前結帳並回到訂單嗎？'
    case 'SET_FULFILLMENT': return `需要先返回訂單才能改為${modes.find(mode => mode.id === operation.slots.mode)!.label}，要返回並更改嗎？`
    default: return '請確認這項操作。'
  }
}

function cartFingerprint(cart: CartSnapshot) {
  return JSON.stringify({ fulfillmentMode: cart.fulfillmentMode, lines: cart.lines, paymentId: cart.paymentId })
}
