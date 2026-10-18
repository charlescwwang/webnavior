import type { PaymentMethod } from '../../order-menu-server/src/domain/contracts'
import type { CatalogMentionEvidence } from '../../server/src/services/domain/kiosk-interaction-decision/contracts'
import type { PriceConditions, PriceEvidence } from '../../server/src/services/domain/kiosk-interaction-decision/priceContracts'
import type { CheckoutSnapshot } from './domain/checkout-flow'
import type { IngredientFilters } from './domain/composition'
import type { CartLine, CartSnapshot, MenuItem, Selection } from './domain/order-machine'
import type { SeatingContext } from './domain/seating'

import { filterIngredients, mentionedDietaryReferences, mentionedIngredients, mentionedUnavailableConditions } from './domain/composition'
import { priceEvidence } from './domain/pricing'
import { partySizeSlot } from './domain/seating'
import { paymentLabels } from './pos-bridge'

/** Customer intent vocabulary. These names deliberately never expose WebMCP. */
export type KioskIntent
  = | 'ADD_ITEM' | 'CANCEL_CHECKOUT' | 'CHOOSE_INVOICE' | 'CLEAR_CART'
    | 'CONFIRM_TAX_ID' | 'RECOMMEND' | 'REMOVE_ITEM' | 'REQUEST_TAX_ID'
    | 'SEARCH_MENU' | 'SCROLL_MENU' | 'SELECT_ITEM' | 'SELECT_PAYMENT' | 'SET_FULFILLMENT'
    | 'SET_OPTION' | 'SET_QUANTITY' | 'SET_TAX_ID' | 'SHOW_RECOMMENDATIONS'
    | 'SKIP_CUSTOMER_ENTRY' | 'SKIP_MEMBERSHIP' | 'START_CHECKOUT' | 'VIEW_CART' | 'SET_PARTY_SIZE' | 'RESERVE_TABLES' | 'DEFER_QUESTION' | 'RETURN_MENU'

export interface KioskRevisions { cart: number, checkout: number, menu?: number, selectedItem: number, seating?: number, recommendation?: number }
export interface DomainReference { label: string, refId: string }
/** Catalog growth must not enlarge or silently truncate model target choices. */
export const targetReferenceLimit = 5
export type KioskPhase = 'customer_entry' | 'ordering' | 'checkout_membership' | 'checkout_invoice' | 'checkout_tax_id' | 'checkout_payment_select' | 'payment_locked' | 'checkout_complete'

export interface KioskIntentContext {
  customerEntryPending?: boolean
  customerEntrySkipSupported?: boolean
  menuReturnSupported?: boolean
  menuScrollSupported?: boolean
  ingredientFilters?: IngredientFilters
  fulfillmentModes?: readonly { id: 'dine-in' | 'takeout', label: string }[]
  waitingFor?: PendingQuestion
  cart: CartSnapshot
  checkout?: CheckoutSnapshot
  menu: readonly MenuItem[]
  paymentMethods?: readonly PaymentMethod[]
  paymentStatus?: 'pending' | 'uncertain'
  presentationItemIds?: readonly string[]
  /** Only present while a revision-bound recommendation batch can be continued. */
  recommendationConditions?: string
  recentAddedLineId?: string
  revisions: KioskRevisions
  selectedItem?: Selection
  seating?: SeatingContext
  transcript?: string
  /** Jev-established continuation; keep fragments separate when resolving facts. */
  previousTranscript?: string
}

export interface IntentCandidate {
  description: string
  id: string
  intent: KioskIntent
  slots?: Record<string, string | number>
  targetRef?: string
}

export interface DecisionContext extends KioskIntentContext {
  priceEvidence?: PriceEvidence
  catalogEvidence: CatalogMentionEvidence
  modelReferences: DomainReference[]
  /** Possible lexical matches do not grant mutation authority. */
  productResolution: { status: 'exact' | 'possible' | 'none' | 'overflow', count: number, references: DomainReference[] }
  searchInterpretation?: 'product' | 'filter'
  /** Provenance never grants authority: current catalog constraints qualify every mutation target. */
  referenceOrigins: Record<string, 'utterance' | 'continuation' | 'confirmation' | 'category' | 'presentation' | 'selection' | 'cart' | 'seating'>
  targetConstraints: { itemIds: string[], categories: string[] }
  allowedPaymentMethods: PaymentMethod[]
  candidates: IntentCandidate[]
  /** Dietary constraints and slots are catalog-grounded application data, not model-generated arguments. */
  constraints: { exclude: string[], include: string[], dietary?: 'vegetarian', price?: PriceConditions, unresolvedPrice?: boolean }
  ingredientReferences: Array<{ id: string, label: string }>
  dietaryReferences: Array<{ id: 'vegetarian', label: string }>
  unavailableConditionReferences: Array<{ id: string, label: string }>
  interactionState: { lastAddedItemName?: string, matchingCartLines: number, selectedItemName?: string, seating?: { partySize?: number, ready: boolean, question: string } }
  phase: KioskPhase
  references: DomainReference[]
}

export interface DomainPlan {
  questionId?: string
  expectedRevisions: Partial<KioskRevisions>
  intent: KioskIntent
  slots: Record<string, string | number>
  targetRef?: string
}

/** A question actually presented by the application, independent from recent subject focus. */
export interface PendingQuestion {
  questionId: string
  purpose: 'customer-entry' | 'fulfillment' | 'party-size' | 'tables' | 'checkout-entry' | 'membership' | 'invoice' | 'tax-id' | 'payment-method'
  phase: KioskPhase
  choices: IntentCandidate[]
  expectedRevisions: Partial<KioskRevisions>
  expiresAt: number
  question: string
}

/** Only relevant state changes invalidate a question; silence never authorizes an action. */
export function questionIsCurrent(question: PendingQuestion, revisions: KioskRevisions, now: number) {
  return question.expiresAt > now && Object.entries(question.expectedRevisions).every(([key, value]) => revisions[key as keyof KioskRevisions] === value)
}

export type KioskOperationToolName
  = | 'cart_add_item' | 'cart_clear' | 'cart_get' | 'cart_remove_item' | 'cart_set_line_option' | 'cart_set_line_quantity'
    | 'customer_skip_phone' | 'checkout_cancel' | 'checkout_choose_invoice' | 'checkout_confirm_tax_id' | 'checkout_request_tax_id' | 'checkout_select_payment' | 'checkout_set_tax_id' | 'checkout_skip_membership' | 'checkout_start'
    | 'menu_get' | 'menu_open' | 'menu_scroll' | 'menu_recommend' | 'menu_select_item' | 'menu_set_item_option' | 'menu_set_quantity' | 'menu_show_recommendations'
    | 'order_add_item' | 'order_set_fulfillment' | 'order_set_party_size' | 'seating_reserve' | 'order_defer_question'

export interface OperationPlan {
  questionId?: string
  expectedRevisions: DomainPlan['expectedRevisions']
  input: Record<string, unknown>
  intent: KioskIntent
  slots: DomainPlan['slots']
  targetRef?: string
  toolName: KioskOperationToolName
}

/** Resolution retains target eligibility evidence for the execution trace, not model-generated data. */
export type Resolution = ResolutionResult & { targetResolution?: { constraints: DecisionContext['targetConstraints'] & DecisionContext['constraints'], candidates: string[], eligible: string[], rejected: Array<{ refId: string, reason: 'MISSING_OR_UNAVAILABLE' | 'ITEM_MISMATCH' | 'CATEGORY_MISMATCH' | 'UNVERIFIED_OR_CONFLICTING_COMPOSITION' }>, origins: DecisionContext['referenceOrigins'] } }

type ResolutionResult
  = | { kind: 'PLAN', plan: DomainPlan }
    | { kind: 'CONFIGURATION', plan: DomainPlan }
    | { candidateRefs: string[], intent: KioskIntent, kind: 'CLARIFICATION', prompt: string }
    | { kind: 'INCOMPLETE' }
    | { kind: 'NEEDS_ASSISTANT' }
    | { kind: 'IGNORE' }

/** A one-use authorization for a high-risk customer action. */
export interface PendingConfirmation {
  action: 'CANCEL_CHECKOUT' | 'CLEAR_CART' | 'CONFIRM_TAX_ID'
  cartRevision?: number
  checkoutRevision?: number
  confirmationId: string
  consumedAt?: number
  createdAt: number
  expiresAt: number
  payload: Record<string, string | number>
  selectedItemRevision?: number
}

export function createConfirmation(input: Omit<PendingConfirmation, 'consumedAt'>): PendingConfirmation {
  return input
}

export function validateConfirmation(confirmation: PendingConfirmation, input: { action?: PendingConfirmation['action'], cartRevision?: number, checkoutRevision?: number, now: number, payload?: PendingConfirmation['payload'], selectedItemRevision?: number }) {
  if (confirmation.consumedAt !== undefined)
    return { kind: 'INVALID' as const, reason: 'CONSUMED' as const }
  if (input.now > confirmation.expiresAt)
    return { kind: 'INVALID' as const, reason: 'EXPIRED' as const }
  if (confirmation.cartRevision !== undefined && confirmation.cartRevision !== input.cartRevision)
    return { kind: 'INVALID' as const, reason: 'STALE' as const }
  if (confirmation.checkoutRevision !== undefined && confirmation.checkoutRevision !== input.checkoutRevision)
    return { kind: 'INVALID' as const, reason: 'STALE' as const }
  if (confirmation.selectedItemRevision !== undefined && confirmation.selectedItemRevision !== input.selectedItemRevision)
    return { kind: 'INVALID' as const, reason: 'STALE' as const }
  if (input.action !== undefined && confirmation.action !== input.action)
    return { kind: 'INVALID' as const, reason: 'MISMATCH' as const }
  if (input.payload !== undefined && JSON.stringify(confirmation.payload) !== JSON.stringify(input.payload))
    return { kind: 'INVALID' as const, reason: 'MISMATCH' as const }
  return { kind: 'VALID' as const }
}

function candidate(intent: KioskIntent, id: string, description: string, targetRef?: string, slots?: Record<string, string | number>): IntentCandidate {
  return { description, id, intent, ...(targetRef ? { targetRef } : {}), ...(slots ? { slots } : {}) }
}
function lineRef(line: CartLine) {
  return `cart:${line.id}`
}
function itemRef(item: MenuItem) {
  return `item:${item.id}`
}

/** Produces a small phase-legal intent set; catalog size never multiplies choices. */
export function deriveDecisionContext(input: KioskIntentContext): DecisionContext {
  const transcript = input.transcript?.trim() ?? ''
  // Unselectable dishes remain valid lookup targets. Mutation candidates and
  // final authorization still require current availability independently.
  const menuItems = input.menu
  const currentItems = resolveMenuItems(menuItems, transcript)
  const possibleItems = !currentItems.length ? possibleMenuItems(menuItems, transcript) : []
  const currentCategories = currentItems.length || possibleItems.length ? [] : resolveCategories(menuItems, transcript)
  const normalized = transcript.toLocaleLowerCase().replace(/\s/g, '')
  const catalogEvidence: CatalogMentionEvidence = {
    products: [...currentItems, ...possibleItems].slice(0, targetReferenceLimit).map((item) => {
      const name = item.name.toLocaleLowerCase().replace(/\s/g, '')
      const alias = item.aliases?.filter(alias => normalized.includes(alias.toLocaleLowerCase().replace(/\s/g, ''))).sort((left, right) => right.length - left.length)[0]
      if (normalized.includes(name))
        return { label: item.name, matchedText: item.name, source: 'name' }
      if (alias)
        return { label: item.name, matchedText: alias, source: 'alias' }
      return { label: item.name, matchedText: productFragment(item, menuItems, transcript)!, source: 'fragment' }
    }),
    categories: currentCategories.slice(0, targetReferenceLimit).map(category => ({ label: category, matchedText: normalized.includes(category.toLocaleLowerCase()) ? category : category.slice(0, -1), itemCount: menuItems.filter(item => item.category === category).length })),
  }
  // A new category is a real restriction, not a reason to reuse the product
  // from an earlier fragment or display. Specific names still outrank categories.
  const matchingItems = currentItems.length ? currentItems : currentCategories.length || possibleItems.length ? [] : resolveMenuItems(menuItems, input.previousTranscript ?? '')
  const matchingCategories = matchingItems.length ? [] : currentCategories.length ? currentCategories : resolveCategories(menuItems, input.previousTranscript ?? '')
  const selected = input.selectedItem && menuItems.find(item => item.id === input.selectedItem?.itemId)
  const recentAddedLine = input.cart.lines.find(line => line.id === input.recentAddedLineId)
  const selectedRef = selected ? { label: `目前選的${selected.name}`, refId: `selected:${selected.id}` } : undefined
  const cartRefs = input.cart.lines.map((line, index) => ({ label: `購物車第${index + 1}筆${line.name}${line.id === recentAddedLine?.id ? '（最近加入）' : ''}`, refId: lineRef(line) }))
  const itemRefs = matchingItems.map(item => ({ label: item.name, refId: itemRef(item) }))
  const focusRefs = !matchingItems.length && !matchingCategories.length && !selected
    ? menuItems.filter(item => input.presentationItemIds?.includes(item.id)).map(item => ({ label: `剛展示的${item.name}`, refId: itemRef(item) }))
    : []
  const categoryRefs = matchingCategories.map(category => ({ label: `${category}分類`, refId: `category:${encodeURIComponent(category)}` }))
  const categoryItemRefs = matchingCategories.length
    ? menuItems.filter(item => item.available !== false && matchingCategories.includes(item.category)).map(item => ({ label: item.name, refId: itemRef(item) }))
    : []
  const references = [...itemRefs, ...categoryRefs, ...categoryItemRefs, ...focusRefs, ...(selectedRef ? [selectedRef] : []), ...cartRefs]
  const productItems = currentItems.length ? currentItems : possibleItems
  const productResolution: DecisionContext['productResolution'] = {
    status: productItems.length > targetReferenceLimit ? 'overflow' : currentItems.length ? 'exact' : possibleItems.length ? 'possible' : 'none',
    count: productItems.length,
    references: productItems.length <= targetReferenceLimit ? productItems.map(item => ({ label: item.name, refId: itemRef(item) })) : [],
  }
  const referenceOrigins: DecisionContext['referenceOrigins'] = {}
  for (const reference of itemRefs)
    referenceOrigins[reference.refId] = currentItems.length ? 'utterance' : 'continuation'
  for (const reference of [...categoryRefs, ...categoryItemRefs])
    referenceOrigins[reference.refId] = 'category'
  for (const reference of focusRefs)
    referenceOrigins[reference.refId] = 'presentation'
  if (selectedRef)
    referenceOrigins[selectedRef.refId] = 'selection'
  for (const reference of cartRefs)
    referenceOrigins[reference.refId] = 'cart'
  const matchingCartLines = input.cart.lines.filter(line => matchingItems.some(item => item.id === line.itemId)).length
  const interactionState = { matchingCartLines, ...(selected ? { selectedItemName: selected.name } : {}), ...(recentAddedLine ? { lastAddedItemName: recentAddedLine.name } : {}) }
  const seating = input.cart.fulfillmentMode === 'dine-in' ? input.seating : undefined
  if (seating) {
    references.push(...seating.choices.map(choice => ({ refId: `table:${choice.id}`, label: choice.label })))
    for (const choice of seating.choices)
      referenceOrigins[`table:${choice.id}`] = 'seating'
  }
  const constraints = { exclude: input.ingredientFilters?.excludeIngredients ?? [], include: input.ingredientFilters?.includeIngredients ?? [], ...(input.ingredientFilters?.dietary ? { dietary: input.ingredientFilters.dietary } : {}) }
  // Only a relation-qualified fragment reaches this boundary. Keep the two
  // sources separate while collecting finite catalog/food references.
  const ingredientReferences = [...new Map([...mentionedIngredients(input.previousTranscript ?? ''), ...mentionedIngredients(transcript)].map(reference => [reference.id, reference])).values()]
  const dietaryReferences = [...new Map([...mentionedDietaryReferences(input.previousTranscript ?? ''), ...mentionedDietaryReferences(transcript)].map(reference => [reference.id, reference])).values()]
  const unavailableConditionReferences = [...new Map([...mentionedUnavailableConditions(input.previousTranscript ?? ''), ...mentionedUnavailableConditions(transcript)].map(reference => [reference.id, reference])).values()]
  const candidates: IntentCandidate[] = []
  const checkout = input.checkout
  let phase: KioskPhase = 'ordering'
  const allowedPaymentMethods: PaymentMethod[] = []

  if (input.customerEntryPending) {
    phase = 'customer_entry'
    if (input.customerEntrySkipSupported)
      candidates.push(candidate('SKIP_CUSTOMER_ENTRY', 'intent:skip-customer-entry', '顧客明確表示略過、不留電話、不要會員或直接開始點餐；略過自願的電話登記，進入菜單，不新增餐點、不代表登入會員。'))
  }
  else if (!checkout) {
    if (input.menuReturnSupported)
      candidates.push(candidate('RETURN_MENU', 'intent:return-menu', '回到菜單繼續點餐，關閉購物車或餐點設定畫面；保留購物車，不開始結帳、不清空訂單。'))
    // Target resolution is independent of intent selection: Jev receives one
    // candidate per operation, never one per product or cart line.
    candidates.push(candidate('SEARCH_MENU', 'intent:search-menu', '查詢餐點／分類的種類、款式、有哪些選擇、有幾種、有沒有，以及價格、成分／飲食條件。詢問已知品名有哪些款式也是查詢，商品唯一也不等於訂購。只說想吃某分類而未指定數量，是瀏覽分類，即使分類只有一道菜也不等於訂購。泛問販售內容或看全部每次最多展示三項推薦；指定品名、分類及食材／單份價格條件仍精確查詢，不新增訂單。'))
    if (input.menuScrollSupported) {
      candidates.push(candidate('SCROLL_MENU', 'intent:scroll-menu:up', '把菜單畫面向上移動一頁；不是換推薦、搜尋或選餐點。', undefined, { direction: 'UP' }))
      candidates.push(candidate('SCROLL_MENU', 'intent:scroll-menu:down', '把菜單畫面向下移動一頁；不是換推薦、搜尋或選餐點。', undefined, { direction: 'DOWN' }))
    }
    if (matchingItems.some(item => item.available !== false))
      candidates.push(candidate('SELECT_ITEM', 'intent:select-item', '查看或編輯已解析的餐點，但不建立訂購項目。'))
    const categoryPreference = matchingCategories.length > 0 && quantityFromTranscript(transcript) === undefined && quantityFromTranscript(input.previousTranscript ?? '') === undefined
    if (!possibleItems.length && !categoryPreference && (matchingItems.some(item => item.available !== false) || categoryItemRefs.length || focusRefs.length || selected || recentAddedLine))
      candidates.push(candidate('ADD_ITEM', 'intent:add-item', '顧客要求購買或加點餐點，才建立訂購項目。匹配品名／別名只提供查詢對象，不是購買授權；詢問種類、款式、有哪些或有沒有都選查詢，不選新增。明確要點餐點但缺份數／選項仍可新增，由程式補問；分類須有明確份數才建立待選品項訂購。品項歧義由程式釐清，不自行挑選。'))
    if (!itemRefs.length && (!categoryRefs.length || priceEvidence(transcript)) && !possibleItems.length)
      candidates.push(candidate('RECOMMEND', 'intent:recommend', '顧客請系統挑選值得吃的餐點：開始一輪簡單推薦，最多三項；可套用已知分類、單份價格及飲食限制。不是列出整份菜單，也不是換掉剛推薦的一批。'))
    if (!itemRefs.length && !categoryRefs.length && !possibleItems.length && input.recommendationConditions !== undefined)
      candidates.push(candidate('RECOMMEND', 'intent:recommend-more', `顧客追問其他選擇、要求換一批或在已展示後要求看全部；依店家政策每次最多三項，排除已推薦餐點，沿用${input.recommendationConditions}，不展開整份菜單或重顯上一批。`, undefined, { more: 1 }))
    if (input.cart.lines.length)
      candidates.push(candidate('VIEW_CART', 'intent:view-cart', '查看目前購物車。'))
    if (selected || input.cart.lines.length) {
      candidates.push(candidate('SET_QUANTITY', 'intent:set-quantity', '修改已選或購物車現有餐點數量，不新增品項。'))
      candidates.push(candidate('SET_OPTION', 'intent:set-option', '修改已選或購物車現有餐點客製選項。'))
    }
    if (input.cart.lines.length) {
      const modes = input.fulfillmentModes ?? [{ id: 'dine-in', label: '內用' }, { id: 'takeout', label: '自取' }]
      candidates.push(candidate('REMOVE_ITEM', 'intent:remove-item', matchingCartLines > 1 ? '移除購物車中的餐點；若有多筆同名品項，程式會詢問是哪一筆。' : '移除購物車中的特定一筆餐點。'))
      candidates.push(candidate('CLEAR_CART', 'intent:clear-cart', '明確要求清空整個購物車。'))
      if ((input.cart.fulfillmentMode !== 'dine-in' || input.waitingFor) && (!input.fulfillmentModes || input.fulfillmentModes.some(mode => mode.id === 'dine-in')))
        candidates.push(candidate('SET_FULFILLMENT', 'intent:set-fulfillment:dine-in', input.cart.fulfillmentMode === 'dine-in' ? `顧客重申本次${modes.find(mode => mode.id === 'dine-in')!.label}；維持原設定與未回答問題，不表示暫緩或拒絕。` : `這筆訂單設為${modes.find(mode => mode.id === 'dine-in')!.label}，接著詢問用餐人數與選桌。`, undefined, { mode: 'dine-in' }))
      if ((input.cart.fulfillmentMode !== 'takeout' || input.waitingFor) && (!input.fulfillmentModes || input.fulfillmentModes.some(mode => mode.id === 'takeout')))
        candidates.push(candidate('SET_FULFILLMENT', 'intent:set-fulfillment:takeout', input.cart.fulfillmentMode === 'takeout' ? `顧客重申本次${modes.find(mode => mode.id === 'takeout')!.label}；維持原設定與未回答問題，不表示暫緩或拒絕。` : `這筆訂單設為${modes.find(mode => mode.id === 'takeout')!.label}，釋放尚未付款的暫留桌位。`, undefined, { mode: 'takeout' }))
      if (input.cart.fulfillmentMode) {
        if (!seating || seating.ready)
          candidates.push(candidate('START_CHECKOUT', 'intent:start-checkout', '開始結帳，進入會員與發票步驟。'))
      }
    }
    if (seating) {
      const partySize = partySizeSlot(transcript, input.waitingFor?.purpose === 'party-size')
      if (partySize)
        candidates.push(candidate('SET_PARTY_SIZE', 'intent:set-party-size', `設定本次內用為 ${partySize} 位，不是餐點數量；修改人數會釋放原保留桌位。`, undefined, { partySize }))
      if (!seating.ready) {
        for (const choice of seating.choices)
          candidates.push(candidate('RESERVE_TABLES', `intent:reserve-tables:${choice.id}`, choice.splitRequired ? `明確同意分桌，並選擇 ${choice.label} 暫留 10 分鐘。` : `選擇 ${choice.label} 暫留 10 分鐘。`, `table:${choice.id}`, { choiceId: choice.id, splitApproved: choice.splitRequired ? 'yes' : 'no' }))
      }
    }
    if (input.presentationItemIds?.length)
      candidates.push(candidate('SHOW_RECOMMENDATIONS', 'intent:show-recommendations', '再次顯示目前的推薦餐點。', undefined, { itemIds: input.presentationItemIds.join(',') }))
  }
  else if (input.paymentStatus === 'pending' || input.paymentStatus === 'uncertain') {
    phase = 'payment_locked'
  }
  else if (checkout.stage === 'membership') {
    phase = 'checkout_membership'
    candidates.push(candidate('SKIP_MEMBERSHIP', 'intent:skip-membership', '略過會員。'))
    candidates.push(candidate('CANCEL_CHECKOUT', 'intent:cancel-checkout', '取消結帳並回到訂單。'))
  }
  else if (checkout.stage === 'invoice') {
    phase = 'checkout_invoice'
    candidates.push(candidate('CHOOSE_INVOICE', 'intent:choose-invoice:donation', '顧客選擇「略過」或「捐贈發票」：記錄捐贈選擇，直接進入付款方式，不輸入捐贈碼，也不執行付款。', undefined, { method: 'donation' }))
    candidates.push(candidate('CHOOSE_INVOICE', 'intent:choose-invoice:carrier', '選擇手機載具；資料未確認前停留在輸入畫面。', undefined, { method: 'carrier' }))
    candidates.push(candidate('CHOOSE_INVOICE', 'intent:choose-invoice:citizen', '選擇自然人憑證條碼；資料未確認前停留在輸入畫面。', undefined, { method: 'citizen' }))
    candidates.push(candidate('REQUEST_TAX_ID', 'intent:request-tax-id', '輸入統編。'))
    candidates.push(candidate('CANCEL_CHECKOUT', 'intent:cancel-checkout', '取消結帳並回到訂單。'))
  }
  else if (checkout.stage === 'tax-id') {
    phase = 'checkout_tax_id'
    const taxId = extractTaxId(transcript)
    if (taxId)
      candidates.push(candidate('SET_TAX_ID', 'intent:set-tax-id', '將顧客說出的八位統編帶入畫面。', undefined, { taxId }))
    if (/^\d{8}$/.test(checkout.taxId ?? ''))
      candidates.push(candidate('CONFIRM_TAX_ID', 'intent:confirm-tax-id', '確認畫面上的統編正確。', undefined, { taxId: checkout.taxId! }))
    candidates.push(candidate('CANCEL_CHECKOUT', 'intent:cancel-checkout', '取消結帳並回到訂單。'))
  }
  else if (checkout.stage === 'payment') {
    phase = 'checkout_payment_select'
    allowedPaymentMethods.push(...(input.paymentMethods ?? ['card', 'mobile']))
    for (const method of allowedPaymentMethods)
      candidates.push(candidate('SELECT_PAYMENT', `intent:select-payment:${method}`, `選擇${paymentLabels[method]}${method === 'jkopay' ? '（也稱街口）' : ''}後直接顯示測試 QR Code，倒數5秒自動模擬付款，不另問確認、不需實際掃碼；倒數時可更換方式，選擇當下不代表付款成功。`, undefined, { method }))
    candidates.push(candidate('CANCEL_CHECKOUT', 'intent:cancel-checkout', '取消尚未啟動付款的結帳並回到訂單；執行前須再次確認。'))
  }
  else {
    phase = 'checkout_complete'
  }

  if (possibleItems.length) {
    // Discovery fragments cannot redirect edits/removals to the selected item
    // or cart just because there is no verified target in this utterance.
    const targetedMutations: KioskIntent[] = ['ADD_ITEM', 'SELECT_ITEM', 'SET_OPTION', 'SET_QUANTITY', 'REMOVE_ITEM']
    candidates.splice(0, candidates.length, ...candidates.filter(choice => !targetedMutations.includes(choice.intent)))
  }
  const waiting = input.waitingFor?.phase === phase ? input.waitingFor : undefined
  if (waiting) {
    // Keep explicit new targets available, but do not turn a bare acknowledgment
    // into a repeat purchase or draft edit simply because a cart exists.
    const hasNewTarget = itemRefs.length > 0 || categoryRefs.length > 0
    const hasMealQuantity = quantityFromTranscript(transcript) !== undefined
    const hasOptionSlot = menuItems.some(item => (item.id === selected?.id || input.cart.lines.some(line => line.itemId === item.id)) && optionSlotsFromTranscript(item, transcript).length > 0)
    // Only implicit meal mutations need utterance evidence here: a bare reply
    // must not reorder the selected dish. An unrelated pending question cannot
    // remove explicit state-legal intents such as checkout or clear-cart.
    const implicitMealIntents: KioskIntent[] = ['ADD_ITEM', 'SET_QUANTITY', 'SET_OPTION', 'REMOVE_ITEM']
    const bounded = candidates.filter(choice => !implicitMealIntents.includes(choice.intent)
      || waiting.choices.some(answer => answer.id === choice.id) || hasNewTarget
      || (hasMealQuantity && ['ADD_ITEM', 'SET_QUANTITY'].includes(choice.intent))
      || (hasOptionSlot && choice.intent === 'SET_OPTION'))
    for (const choice of waiting.choices) {
      const current = bounded.find(candidate => candidate.id === choice.id)
      if (current)
        current.description = choice.description
    }
    bounded.push(candidate('DEFER_QUESTION', 'intent:defer-question', '顧客只拒絕或暫緩目前問題，沒有提出其他需求；保留訂單與設定。', undefined, { questionId: waiting.questionId }))
    candidates.splice(0, candidates.length, ...bounded)
  }
  const targetRefs = references.filter(reference => !reference.refId.startsWith('category:'))
  const modelReferences = possibleItems.length ? [] : targetRefs.length > targetReferenceLimit ? categoryRefs : references
  const prices = priceEvidence(transcript)
  return { ...input, ...(prices ? { priceEvidence: prices } : {}), catalogEvidence, productResolution, modelReferences, referenceOrigins, targetConstraints: { itemIds: matchingItems.map(item => item.id), categories: matchingCategories }, waitingFor: waiting, allowedPaymentMethods, candidates, constraints: { ...constraints, ...(prices ? { unresolvedPrice: true } : {}) }, ingredientReferences, dietaryReferences, unavailableConditionReferences, interactionState: { ...interactionState, ...(seating ? { seating: { partySize: seating.partySize, ready: seating.ready, question: !seating.partySize ? '請問幾位用餐？' : seating.ready ? '桌位已暫留。' : seating.choices.some(choice => choice.splitRequired) ? '需要分桌；是否同意並選擇顯示的桌位組合？' : '請選擇可用桌位。' } } : {}) }, phase, references }
}

/** Builds operational questions only from currently legal domain choices. */
export function createQuestion(context: DecisionContext, questionId: string, now: number): PendingQuestion | undefined {
  let purpose: PendingQuestion['purpose']
  let question: string
  let intents: KioskIntent[]
  if (context.phase === 'ordering') {
    if (!context.cart.lines.length)
      return undefined
    if (!context.cart.fulfillmentMode) {
      purpose = 'fulfillment'
      question = `請問要${(context.fulfillmentModes ?? [{ id: 'dine-in', label: '內用' }, { id: 'takeout', label: '自取' }]).map(mode => mode.label).join('還是')}？`
      intents = ['SET_FULFILLMENT']
    }
    else if (context.seating && context.cart.fulfillmentMode === 'dine-in' && !context.seating.ready) {
      purpose = context.seating.partySize ? 'tables' : 'party-size'
      question = purpose === 'party-size' ? '請問幾位用餐？' : context.seating.choices.length ? `請${context.seating.choices.some(choice => choice.splitRequired) ? '明確同意分桌並' : ''}選擇桌位：${context.seating.choices.map(choice => choice.label).join('、')}。` : ''
      intents = purpose === 'party-size' ? ['SET_PARTY_SIZE'] : ['RESERVE_TABLES']
      if (!question)
        return undefined
    }
    else {
      purpose = 'checkout-entry'
      question = '要進入結帳流程嗎？'
      intents = ['START_CHECKOUT']
    }
  }
  else {
    const definitions = {
      customer_entry: { purpose: 'customer-entry', question: '手機號碼可自願填寫，也可以選擇略過，直接開始點餐。', intents: ['SKIP_CUSTOMER_ENTRY'] },
      checkout_membership: { purpose: 'membership', question: '請掃描會員條碼，或選擇略過會員。', intents: ['SKIP_MEMBERSHIP'] },
      checkout_invoice: { purpose: 'invoice', question: '請選擇手機載具、自然人憑證、公司統編，或略過並捐贈發票。', intents: ['CHOOSE_INVOICE', 'REQUEST_TAX_ID'] },
      checkout_tax_id: { purpose: 'tax-id', question: context.checkout?.taxId ? `請確認畫面上的統編 ${context.checkout.taxId.split('').join(' ')} 是否正確。` : '請提供八位統編。', intents: ['SET_TAX_ID', 'CONFIRM_TAX_ID'] },
      checkout_payment_select: { purpose: 'payment-method', question: `請選擇${context.allowedPaymentMethods.map(method => paymentLabels[method]).join('或')}。`, intents: ['SELECT_PAYMENT'] },
    } as const
    if (!(context.phase in definitions))
      return undefined
    const definition = definitions[context.phase as keyof typeof definitions]
    purpose = definition.purpose
    question = definition.question
    intents = [...definition.intents]
  }
  const choices = context.candidates.filter(choice => intents.includes(choice.intent)).map(choice => ({ ...choice }))
  if (purpose === 'invoice')
    question = `請選擇發票方式：${choices.map(choice => choice.description).join(' ')} `.trim()
  if (purpose === 'checkout-entry') {
    for (const choice of choices)
      choice.description = '顧客同意開始結帳；進入會員與發票步驟。'
  }
  // Party size and tax ID are finite validated slots supplied on the next
  // utterance; an unanswered question does not manufacture a slot value.
  if (!choices.length && purpose !== 'party-size' && purpose !== 'tax-id')
    return undefined
  return { questionId, purpose, phase: context.phase, question, choices, expectedRevisions: { cart: context.revisions.cart, checkout: context.revisions.checkout, ...(purpose === 'party-size' || purpose === 'tables' || context.cart.fulfillmentMode === 'dine-in' ? { seating: context.revisions.seating } : {}) }, expiresAt: now + 30_000 }
}

/** Resolves a finite System One choice to a domain plan, never to a tool. */
export function resolveIntent(decision: IntentCandidate, context: DecisionContext, chosenTargetRef?: string): Resolution {
  const resolved = context.candidates.find(candidate => candidate.id === decision.id)
  if (!resolved)
    return { kind: 'IGNORE' }
  const transcript = context.transcript?.trim() ?? ''
  if (resolved.intent === 'SEARCH_MENU' && ['possible', 'overflow'].includes(context.productResolution.status) && !context.searchInterpretation)
    return { kind: 'NEEDS_ASSISTANT' }
  const menuRefs = context.references.filter(reference => reference.refId.startsWith('item:'))
  const categoryRefs = context.references.filter(reference => reference.refId.startsWith('category:'))
  const namedNow = resolveMenuItems(context.menu, transcript)
  const namedItemIds = new Set((namedNow.length ? namedNow : resolveMenuItems(context.menu, context.previousTranscript ?? '')).map(item => item.id))
  const explicitMenuRefs = menuRefs.filter(reference => namedItemIds.has(reference.refId.slice(5)))
  const hasNamedItem = namedItemIds.size > 0
  const selectedRefs = context.references.filter(reference => reference.refId.startsWith('selected:') && (!hasNamedItem || namedItemIds.has(reference.refId.slice(9))))
  const cartRefs = context.references.filter(reference => reference.refId.startsWith('cart:') && (!hasNamedItem || namedItemIds.has(context.cart.lines.find(line => lineRef(line) === reference.refId)?.itemId ?? '')))
  const recentAddedRefs = cartRefs.filter(reference => reference.refId === `cart:${context.recentAddedLineId}`)
  const selectedItemIds = new Set(selectedRefs.map(reference => reference.refId.slice('selected:'.length)))
  const distinctRecentAddedRefs = recentAddedRefs.filter((reference) => {
    const line = context.cart.lines.find(line => lineRef(line) === reference.refId)
    return !line || !selectedItemIds.has(line.itemId) || JSON.stringify(line.options) !== JSON.stringify(context.selectedItem?.options)
  })
  let targetRefs: DomainReference[] = []
  const slots: Record<string, string | number> = { ...resolved.slots }
  if (resolved.intent === 'RECOMMEND' && context.targetConstraints.categories.length === 1)
    slots.category = context.targetConstraints.categories[0]!

  switch (resolved.intent) {
    case 'SEARCH_MENU':
      // Recent conversational focus can resolve a repeat purchase, but must
      // not silently narrow a fresh request to browse the complete menu.
      targetRefs = context.searchInterpretation === 'filter' ? categoryRefs : context.searchInterpretation === 'product' ? context.productResolution.references : explicitMenuRefs.length ? explicitMenuRefs : categoryRefs
      break
    case 'SELECT_ITEM':
      targetRefs = menuRefs
      break
    case 'ADD_ITEM':
      // A selected draft and the last cart addition are both plausible for a
      // bare repeat request. Never silently prefer one when they differ.
      targetRefs = menuRefs.length ? menuRefs : [...selectedRefs, ...distinctRecentAddedRefs]
      break
    case 'SET_OPTION':
    case 'SET_QUANTITY':
      targetRefs = [...selectedRefs, ...cartRefs]
      break
    case 'REMOVE_ITEM':
      targetRefs = cartRefs
      break
    case 'RESERVE_TABLES':
      targetRefs = context.references.filter(reference => reference.refId === resolved.targetRef && context.seating?.choices.some(choice => `table:${choice.id}` === reference.refId))
      break
  }
  const targetResolution: NonNullable<Resolution['targetResolution']> = {
    constraints: { ...context.targetConstraints, ...context.constraints },
    candidates: targetRefs.map(reference => reference.refId),
    eligible: [],
    rejected: [],
    origins: context.referenceOrigins,
  }
  if (['ADD_ITEM', 'SELECT_ITEM', 'REMOVE_ITEM', 'SET_QUANTITY', 'SET_OPTION'].includes(resolved.intent)) {
    const composition = filterIngredients(context.menu, {
      excludeIngredients: context.constraints.exclude,
      includeIngredients: context.constraints.include,
      ...(context.constraints.dietary ? { dietary: context.constraints.dietary } : {}),
    })
    const verifiedIds = new Set(composition.matches.map(item => item.id))
    targetRefs = targetRefs.filter((reference) => {
      const itemId = reference.refId.startsWith('cart:')
        ? context.cart.lines.find(line => lineRef(line) === reference.refId)?.itemId
        : reference.refId.slice(reference.refId.indexOf(':') + 1)
      const item = context.menu.find(item => item.id === itemId)
      let reason: typeof targetResolution.rejected[number]['reason'] | undefined
      if (!item || (['ADD_ITEM', 'SELECT_ITEM'].includes(resolved.intent) && item.available === false))
        reason = 'MISSING_OR_UNAVAILABLE'
      else if (context.targetConstraints.itemIds.length && !context.targetConstraints.itemIds.includes(item.id))
        reason = 'ITEM_MISMATCH'
      else if (context.targetConstraints.categories.length && !context.targetConstraints.categories.includes(item.category))
        reason = 'CATEGORY_MISMATCH'
      // Food filters qualify purchases/viewing, not removal or an option edit
      // that may itself be intended to change the dish's composition.
      else if (['ADD_ITEM', 'SELECT_ITEM'].includes(resolved.intent) && !verifiedIds.has(item.id))
        reason = 'UNVERIFIED_OR_CONFLICTING_COMPOSITION'
      if (reason)
        targetResolution.rejected.push({ refId: reference.refId, reason })
      return !reason
    })
  }
  if (chosenTargetRef)
    targetRefs = targetRefs.filter(reference => reference.refId === chosenTargetRef)
  targetResolution.eligible = targetRefs.map(reference => reference.refId)
  if (targetRefs.length > targetReferenceLimit)
    return { kind: 'NEEDS_ASSISTANT', targetResolution }
  if (resolved.intent === 'SEARCH_MENU' && context.searchInterpretation === 'product' && !chosenTargetRef && targetRefs.length > 1) {
    return { kind: 'CLARIFICATION', intent: resolved.intent, candidateRefs: targetRefs.map(reference => reference.refId), prompt: buildClarificationPrompt(targetRefs), targetResolution }
  }
  // Searching can return several real dishes. Only mutations need a unique
  // target; a shared alias must not choose whichever dish happens to be first.
  if (resolved.intent === 'SEARCH_MENU' && targetRefs.length > 1) {
    if (targetRefs.length > 4)
      return { kind: 'NEEDS_ASSISTANT' }
    slots.queries = JSON.stringify(targetRefs.map(reference => reference.refId.startsWith('item:') ? context.menu.find(item => item.id === reference.refId.slice(5))!.name : decodeURIComponent(reference.refId.slice(9))))
    targetRefs = []
  }
  const targetRequired = ['SELECT_ITEM', 'ADD_ITEM', 'SET_OPTION', 'SET_QUANTITY', 'REMOVE_ITEM', 'RESERVE_TABLES'].includes(resolved.intent)
  if (targetRequired && targetRefs.length === 0)
    return { kind: 'NEEDS_ASSISTANT', targetResolution }
  if (targetRefs.length > 1) {
    return {
      candidateRefs: targetRefs.map(reference => reference.refId),
      intent: resolved.intent,
      kind: 'CLARIFICATION',
      prompt: buildClarificationPrompt(targetRefs),
      targetResolution,
    }
  }

  const targetRef = targetRefs[0]?.refId
  if (resolved.intent === 'SEARCH_MENU') {
    if (targetRef?.startsWith('item:'))
      slots.query = context.menu.find(item => item.id === targetRef.slice(5))?.name ?? ''
    else if (targetRef?.startsWith('category:'))
      slots.category = decodeURIComponent(targetRef.slice(9))
    else if (!slots.queries)
      slots.scope = 'all'
  }
  if (resolved.intent === 'ADD_ITEM' || resolved.intent === 'SELECT_ITEM') {
    if (targetRef?.startsWith('item:'))
      slots.itemId = targetRef.slice(5)
    else if (resolved.intent === 'ADD_ITEM' && targetRef?.startsWith('selected:'))
      slots.itemId = targetRef.slice(9)
  }
  if (resolved.intent === 'ADD_ITEM' && targetRef?.startsWith('selected:')) {
    const selectedItem = context.selectedItem!
    slots.selectedQuantity = selectedItem.quantity
    slots.quantity = quantityFromTranscript(transcript) ?? quantityFromTranscript(context.previousTranscript ?? '') ?? selectedItem.quantity
    slots.options = JSON.stringify(Object.entries(selectedItem.options).map(([groupId, valueId]) => ({ groupId, valueId })))
  }
  if (resolved.intent === 'ADD_ITEM' && targetRef?.startsWith('item:')) {
    const item = context.menu.find(item => item.id === targetRef.slice(5))!
    const currentOptions = optionSlotsFromTranscript(item, transcript)
    const previousOptions = optionSlotsFromTranscript(item, context.previousTranscript ?? '')
    // A correction replaces only the same POS option group. Other previously
    // stated groups survive a relation-qualified continuation.
    const options = [...new Map([...previousOptions, ...currentOptions].map(option => [option.groupId, option])).values()]
    const quantity = quantityFromTranscript(transcript) ?? quantityFromTranscript(context.previousTranscript ?? '')
    if (quantity !== undefined)
      slots.quantity = quantity
    if (options.length)
      slots.options = JSON.stringify(options)
  }
  if (resolved.intent === 'ADD_ITEM' && targetRef?.startsWith('cart:')) {
    const line = context.cart.lines.find(candidate => lineRef(candidate) === targetRef)!
    slots.itemId = line.itemId
    const quantity = quantityFromTranscript(transcript) ?? quantityFromTranscript(context.previousTranscript ?? '')
    if (quantity !== undefined)
      slots.quantity = quantity
    slots.options = JSON.stringify(Object.entries(line.options).map(([groupId, valueId]) => ({ groupId, valueId })))
  }
  if (resolved.intent === 'SET_QUANTITY') {
    const quantity = quantityFromTranscript(transcript) ?? quantityFromTranscript(context.previousTranscript ?? '') ?? (typeof slots.quantity === 'number' ? slots.quantity : undefined)
    if (!quantity)
      return { kind: 'NEEDS_ASSISTANT' }
    slots.quantity = quantity
  }
  if (resolved.intent === 'SET_OPTION') {
    const itemId = targetRef?.startsWith('selected:') ? targetRef.slice(9) : context.cart.lines.find(line => lineRef(line) === targetRef)?.itemId
    const item = context.menu.find(item => item.id === itemId)
    const currentOptions = item ? optionSlotsFromTranscript(item, transcript) : []
    const options = currentOptions.length || !item ? currentOptions : optionSlotsFromTranscript(item, context.previousTranscript ?? '')
    if (options.length !== 1 && (typeof slots.groupId !== 'string' || typeof slots.valueId !== 'string'))
      return { kind: 'NEEDS_ASSISTANT' }
    slots.groupId = options[0]?.groupId ?? slots.groupId
    slots.valueId = options[0]?.valueId ?? slots.valueId
  }
  if (['SEARCH_MENU', 'RECOMMEND'].includes(resolved.intent)) {
    if (context.constraints.price)
      slots.priceConditions = JSON.stringify(context.constraints.price)
    if (context.constraints.dietary)
      slots.dietary = context.constraints.dietary
    if (context.constraints.exclude.length)
      slots.excludeIngredients = JSON.stringify(context.constraints.exclude)
    if (context.constraints.include.length)
      slots.includeIngredients = JSON.stringify(context.constraints.include)
  }
  // Broad catalog exploration uses the current recommendation batch. Named
  // products, categories and newly requested food conditions remain searches.
  if (resolved.intent === 'SEARCH_MENU' && slots.scope === 'all' && !slots.priceConditions && !slots.dietary && !slots.excludeIngredients && !slots.includeIngredients && context.recommendationConditions !== undefined)
    slots.more = 1
  if (resolved.intent === 'SET_TAX_ID' && !slots.taxId)
    return { kind: 'NEEDS_ASSISTANT' }
  if (resolved.intent === 'SET_PARTY_SIZE' && (!Number.isInteger(slots.partySize) || Number(slots.partySize) < 1 || Number(slots.partySize) > 20))
    return { kind: 'NEEDS_ASSISTANT' }
  const expectedRevisions = revisionsFor({ ...resolved, targetRef, slots }, context)
  const waiting = context.waitingFor
  const questionId = waiting && (waiting.choices.some(choice => choice.id === resolved.id) || resolved.intent === 'DEFER_QUESTION' || (waiting.purpose === 'party-size' && resolved.intent === 'SET_PARTY_SIZE') || (waiting.purpose === 'tax-id' && resolved.intent === 'SET_TAX_ID')) ? waiting.questionId : undefined
  const plan = { expectedRevisions, intent: resolved.intent, slots, ...(questionId ? { questionId } : {}), ...(targetRef ? { targetRef } : {}) }
  return { kind: configurationQuestion(plan, context.menu, 'check') ? 'CONFIGURATION' : 'PLAN', plan, targetResolution }
}

/** Builds missing-slot choices solely from the resolved item and its POS options. */
export function configurationQuestion(plan: DomainPlan, menu: readonly MenuItem[], sessionId: string, transcript = '') {
  if (plan.intent !== 'ADD_ITEM')
    return undefined
  const item = menu.find(item => item.id === plan.slots.itemId)
  if (!item)
    return undefined
  const options: Array<{ groupId: string, valueId: string }> = typeof plan.slots.options === 'string' ? JSON.parse(plan.slots.options) : []
  const group = item.optionGroups.find(group => group.required && !options.some(option => option.groupId === group.id))
  if (group) {
    const quantity = plan.slots.quantity ?? quantityFromTranscript(transcript, true)
    const slots = { ...plan.slots, ...(quantity !== undefined ? { quantity } : {}) }
    return {
      prompt: `請問${item.name}的${group.label}要選${group.values.map(value => value.label).join('、')}？`,
      choices: group.values.map(value => candidate('ADD_ITEM', `configure:${sessionId}:${group.id}:${value.id}`, `將這筆${item.name}的${group.label}設為${value.label}${quantity !== undefined ? `、${quantity}份` : ''}，保留原訂購需求。`, plan.targetRef, { ...slots, options: JSON.stringify([...options, { groupId: group.id, valueId: value.id }]) })),
    }
  }
  if (plan.slots.quantity === undefined) {
    const quantity = quantityFromTranscript(transcript, true)
    return { prompt: `請問${item.name}要幾份？`, choices: quantity === undefined ? [] : [candidate('ADD_ITEM', `configure:${sessionId}:quantity:${quantity}`, `這筆${item.name}要 ${quantity} 份，保留已選客製設定。`, plan.targetRef, { ...plan.slots, quantity })] }
  }
  return undefined
}

/** Only known catalog names and merchant-provided aliases can identify items. */
function resolveMenuItems(menu: readonly MenuItem[], transcript: string) {
  const normalized = transcript.toLocaleLowerCase().replace(/\s/g, '')
  const occurrences = menu.flatMap((item) => {
    return [item.name, ...(item.aliases ?? [])].flatMap((name) => {
      const token = name.toLocaleLowerCase().replace(/\s/g, '')
      if (!token)
        return []
      const matches: Array<{ end: number, item: MenuItem, start: number }> = []
      for (let start = normalized.indexOf(token); start >= 0; start = normalized.indexOf(token, start + 1)) matches.push({ end: start + token.length, item, start })
      return matches
    })
  })
  // Prefer the longest real catalog name at an overlapping location, while
  // retaining separately spoken products elsewhere in the same utterance.
  const chosen: typeof occurrences = []
  for (const match of occurrences.sort((left, right) => (right.end - right.start) - (left.end - left.start))) {
    if (chosen.some(existing => existing.item.id === match.item.id))
      continue
    if (chosen.some(existing => match.start < existing.end && existing.start < match.end && (match.start !== existing.start || match.end !== existing.end)))
      continue
    chosen.push(match)
  }
  return menu.filter(item => chosen.some(match => match.item.id === item.id))
}

/** Proposes literal catalog fragments, never a fuzzy match accepted as an item ID. */
function possibleMenuItems(menu: readonly MenuItem[], transcript: string) {
  return menu.filter(item => productFragment(item, menu, transcript) !== undefined)
}

/** Longest literal fragment is discovery evidence only, never a configured alias. */
function productFragment(item: MenuItem, menu: readonly MenuItem[], transcript: string) {
  const normalized = transcript.toLocaleLowerCase().replace(/\s/g, '')
  const categories = new Set(menu.flatMap(item => [item.category.toLocaleLowerCase(), ...(item.category.endsWith('食') ? [item.category.slice(0, -1).toLocaleLowerCase()] : [])]))
  const fragments = [item.name, ...(item.aliases ?? [])].flatMap((name) => {
    const token = name.toLocaleLowerCase().replace(/\s/g, '')
    const matches: string[] = []
    for (let length = token.length; length >= 2; length--) {
      for (let start = 0; start <= token.length - length; start++) {
        const fragment = token.slice(start, start + length)
        if (!categories.has(fragment) && normalized.includes(fragment))
          matches.push(fragment)
      }
    }
    return matches
  })
  return fragments.sort((left, right) => right.length - left.length)[0]
}

function resolveCategories(menu: readonly MenuItem[], transcript: string) {
  const normalized = transcript.toLocaleLowerCase().replace(/\s/g, '')
  const matches = [...new Set(menu.map(item => item.category))].filter((category) => {
    const name = category.toLocaleLowerCase()
    return normalized.includes(name) || (name.endsWith('食') && normalized.includes(name.slice(0, -1)))
  })
  const best = Math.max(0, ...matches.map(category => category.length))
  return matches.filter(category => category.length === best)
}

/** The question is assembled exclusively from the revision-bound real refs. */
export function buildClarificationPrompt(references: readonly DomainReference[]) {
  return `您指的是${references.map(reference => reference.label).join('、')}？`
}

/** Resolves only a spoken choice among the already-bound clarification refs. */
export function resolveClarificationReference(transcript: string, references: readonly DomainReference[]) {
  const normalized = transcript.replace(/\s/g, '')
  const chineseOrdinals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  const matches = references.filter((reference, index) => {
    const position = index + 1
    // A label embedded in a query or another demand is not an answer shortcut.
    // Only a complete bare reference can bypass semantic relation selection.
    return normalized === reference.label.replace(/\s/g, '')
      || normalized === `第${position}筆`
      || normalized === `第${chineseOrdinals[index]}筆`
      || normalized === `第${position}個`
      || normalized === `第${chineseOrdinals[index]}個`
  })
  return matches.length === 1 ? matches[0]!.refId : undefined
}

/** Compiles an already-resolved domain plan to one concrete WebMCP operation. */
export function compileOperationPlan(plan: DomainPlan): OperationPlan {
  const base = { expectedRevisions: plan.expectedRevisions, intent: plan.intent, slots: plan.slots, ...(plan.questionId ? { questionId: plan.questionId } : {}), ...(plan.targetRef ? { targetRef: plan.targetRef } : {}) }
  const targetId = plan.targetRef?.replace(/^cart:|^selected:|^item:/, '')
  const filters = {
    ...(plan.slots.priceConditions ? JSON.parse(String(plan.slots.priceConditions)) as PriceConditions : {}),
    ...(plan.slots.excludeIngredients ? { excludeIngredients: JSON.parse(String(plan.slots.excludeIngredients)) as string[] } : {}),
    ...(plan.slots.dietary ? { dietary: plan.slots.dietary } : {}),
    ...(plan.slots.includeIngredients ? { includeIngredients: JSON.parse(String(plan.slots.includeIngredients)) as string[] } : {}),
  }
  switch (plan.intent) {
    case 'RETURN_MENU': return { ...base, input: {}, toolName: 'menu_open' }
    case 'SCROLL_MENU': return { ...base, input: { direction: plan.slots.direction }, toolName: 'menu_scroll' }
    case 'SEARCH_MENU':
      // Keep the customer's search intent in the trace while applying the
      // venue's bounded presentation policy through the recommendation tool.
      if (plan.slots.scope === 'all' && !filters.dietary && !filters.excludeIngredients?.length && !filters.includeIngredients?.length)
        return { ...base, input: { ...(plan.slots.more ? { more: true } : {}), ...filters }, toolName: 'menu_recommend' }
      return { ...base, input: { ...(plan.slots.queries ? { queries: JSON.parse(String(plan.slots.queries)) as string[] } : plan.slots.scope === 'all' ? { display: true } : plan.slots.category ? { category: plan.slots.category } : { query: plan.slots.query }), ...filters }, toolName: 'menu_get' }
    case 'RECOMMEND': return { ...base, input: { ...(plan.slots.more ? { more: true } : {}), ...(plan.slots.category ? { category: plan.slots.category } : {}), ...(plan.slots.needs ? { needs: [plan.slots.needs] } : {}), ...filters }, toolName: 'menu_recommend' }
    case 'SHOW_RECOMMENDATIONS': return { ...base, input: { itemIds: String(plan.slots.itemIds).split(',') }, toolName: 'menu_show_recommendations' }
    case 'SELECT_ITEM': return { ...base, input: { itemId: plan.slots.itemId ?? targetId }, toolName: 'menu_select_item' }
    case 'SET_OPTION': return plan.targetRef?.startsWith('cart:') ? { ...base, input: { groupId: plan.slots.groupId, lineId: targetId, valueId: plan.slots.valueId }, toolName: 'cart_set_line_option' } : { ...base, input: { groupId: plan.slots.groupId, valueId: plan.slots.valueId }, toolName: 'menu_set_item_option' }
    case 'SET_QUANTITY': return plan.targetRef?.startsWith('cart:') ? { ...base, input: { lineId: targetId, quantity: plan.slots.quantity }, toolName: 'cart_set_line_quantity' } : { ...base, input: { quantity: plan.slots.quantity }, toolName: 'menu_set_quantity' }
    case 'ADD_ITEM': return plan.targetRef?.startsWith('selected:') && plan.slots.quantity === plan.slots.selectedQuantity
      ? { ...base, input: {}, toolName: 'cart_add_item' }
      : {
          ...base,
          input: {
            itemId: plan.slots.itemId ?? targetId,
            ...(plan.slots.options ? { options: JSON.parse(String(plan.slots.options)) as Array<{ groupId: string, valueId: string }> } : {}),
            quantity: plan.slots.quantity,
          },
          toolName: 'order_add_item',
        }
    case 'VIEW_CART': return { ...base, input: {}, toolName: 'cart_get' }
    case 'REMOVE_ITEM': return { ...base, input: { lineId: targetId }, toolName: 'cart_remove_item' }
    case 'CLEAR_CART': return { ...base, input: { confirmedByUser: true }, toolName: 'cart_clear' }
    case 'SET_FULFILLMENT': return { ...base, input: { mode: plan.slots.mode }, toolName: 'order_set_fulfillment' }
    case 'SET_PARTY_SIZE': return { ...base, input: { partySize: plan.slots.partySize }, toolName: 'order_set_party_size' }
    case 'RESERVE_TABLES': return { ...base, input: { choiceId: plan.slots.choiceId, splitApproved: plan.slots.splitApproved === 'yes', expectedRevision: plan.expectedRevisions.seating }, toolName: 'seating_reserve' }
    case 'START_CHECKOUT': return { ...base, input: { confirmedByUser: true }, toolName: 'checkout_start' }
    case 'SKIP_CUSTOMER_ENTRY': return { ...base, input: { confirmedByUser: true }, toolName: 'customer_skip_phone' }
    case 'SKIP_MEMBERSHIP': return { ...base, input: { confirmedByUser: true }, toolName: 'checkout_skip_membership' }
    case 'CHOOSE_INVOICE': return { ...base, input: { method: plan.slots.method }, toolName: 'checkout_choose_invoice' }
    case 'REQUEST_TAX_ID': return { ...base, input: {}, toolName: 'checkout_request_tax_id' }
    case 'SET_TAX_ID': return { ...base, input: { taxId: plan.slots.taxId }, toolName: 'checkout_set_tax_id' }
    case 'CONFIRM_TAX_ID': return { ...base, input: { confirmedByUser: true }, toolName: 'checkout_confirm_tax_id' }
    case 'SELECT_PAYMENT': return { ...base, input: { method: plan.slots.method }, toolName: 'checkout_select_payment' }
    case 'CANCEL_CHECKOUT': return { ...base, input: { confirmedByUser: true }, toolName: 'checkout_cancel' }
    case 'DEFER_QUESTION': return { ...base, input: { questionId: plan.slots.questionId }, toolName: 'order_defer_question' }
  }
}

/** Mechanical authorization only: no transcript parsing or model interpretation. */
export function authorize(plan: OperationPlan, context: DecisionContext) {
  if (plan.questionId && plan.questionId !== context.waitingFor?.questionId)
    return { kind: 'BLOCKED' as const, reason: 'STALE_PLAN' as const }
  for (const key of ['cart', 'checkout', 'menu', 'selectedItem', 'seating', 'recommendation'] as const) {
    if (plan.expectedRevisions[key] !== undefined && plan.expectedRevisions[key] !== context.revisions[key])
      return { kind: 'BLOCKED' as const, reason: 'STALE_PLAN' as const }
  }
  if (context.paymentStatus === 'pending' || context.paymentStatus === 'uncertain')
    return { kind: 'BLOCKED' as const, reason: 'PAYMENT_IN_PROGRESS' as const }
  if (plan.intent === 'DEFER_QUESTION')
    return context.waitingFor?.questionId === plan.slots.questionId ? { kind: 'EXECUTE' as const } : { kind: 'BLOCKED' as const, reason: 'STALE_PLAN' as const }
  const allowedByPhase: Record<KioskPhase, readonly KioskIntent[]> = {
    customer_entry: ['SKIP_CUSTOMER_ENTRY', 'SEARCH_MENU', 'RECOMMEND', 'SHOW_RECOMMENDATIONS'],
    ordering: ['ADD_ITEM', 'CLEAR_CART', 'RECOMMEND', 'REMOVE_ITEM', 'SEARCH_MENU', 'SCROLL_MENU', 'SELECT_ITEM', 'SET_FULFILLMENT', 'SET_OPTION', 'SET_QUANTITY', 'SHOW_RECOMMENDATIONS', 'START_CHECKOUT', 'VIEW_CART', 'SET_PARTY_SIZE', 'RESERVE_TABLES', 'RETURN_MENU'],
    checkout_membership: ['SKIP_MEMBERSHIP', 'CANCEL_CHECKOUT'],
    checkout_invoice: ['CHOOSE_INVOICE', 'REQUEST_TAX_ID', 'CANCEL_CHECKOUT'],
    checkout_tax_id: ['SET_TAX_ID', 'CONFIRM_TAX_ID', 'CANCEL_CHECKOUT'],
    checkout_payment_select: ['SELECT_PAYMENT', 'CANCEL_CHECKOUT'],
    payment_locked: [],
    checkout_complete: [],
  }
  if (!allowedByPhase[context.phase].includes(plan.intent))
    return { kind: 'BLOCKED' as const, reason: 'INVALID_PHASE' as const }
  if (plan.intent === 'RETURN_MENU' && !context.menuReturnSupported)
    return { kind: 'BLOCKED' as const, reason: 'INVALID_PHASE' as const }
  if (plan.intent === 'SCROLL_MENU' && (!context.menuScrollSupported || !['UP', 'DOWN'].includes(String(plan.slots.direction)) || plan.input.direction !== plan.slots.direction))
    return { kind: 'BLOCKED' as const, reason: 'INVALID_SLOTS' as const }
  if (plan.intent === 'START_CHECKOUT' && (!context.cart.lines.length || !context.cart.fulfillmentMode))
    return { kind: 'BLOCKED' as const, reason: 'INVALID_PHASE' as const }
  if (plan.intent === 'SET_FULFILLMENT' && context.fulfillmentModes && !context.fulfillmentModes.some(mode => mode.id === plan.slots.mode))
    return { kind: 'BLOCKED' as const, reason: 'INVALID_SLOTS' as const }
  if (['START_CHECKOUT', 'SELECT_PAYMENT'].includes(plan.intent) && context.fulfillmentModes && !context.fulfillmentModes.some(mode => mode.id === context.cart.fulfillmentMode))
    return { kind: 'BLOCKED' as const, reason: 'INVALID_PHASE' as const }
  if ((plan.intent === 'START_CHECKOUT' || plan.intent === 'SELECT_PAYMENT') && context.cart.fulfillmentMode === 'dine-in' && context.seating && !context.seating.ready)
    return { kind: 'BLOCKED' as const, reason: 'TARGET_MISSING' as const }
  if (plan.intent === 'SET_PARTY_SIZE' || plan.intent === 'RESERVE_TABLES') {
    if (context.cart.fulfillmentMode !== 'dine-in' || !context.seating)
      return { kind: 'BLOCKED' as const, reason: 'INVALID_PHASE' as const }
    if (plan.intent === 'SET_PARTY_SIZE' && (!Number.isInteger(plan.slots.partySize) || Number(plan.slots.partySize) < 1 || Number(plan.slots.partySize) > 20))
      return { kind: 'BLOCKED' as const, reason: 'INVALID_SLOTS' as const }
    if (plan.intent === 'RESERVE_TABLES') {
      const choice = context.seating.choices.find(choice => choice.id === plan.slots.choiceId)
      if (!choice || context.seating.ready || plan.targetRef !== `table:${choice.id}`)
        return { kind: 'BLOCKED' as const, reason: 'TARGET_MISSING' as const }
      if (choice.splitRequired && plan.input.splitApproved !== true)
        return { kind: 'BLOCKED' as const, reason: 'INVALID_SLOTS' as const }
    }
  }
  if (plan.targetRef?.startsWith('cart:') && !context.cart.lines.some(line => lineRef(line) === plan.targetRef))
    return { kind: 'BLOCKED' as const, reason: 'TARGET_MISSING' as const }
  if (plan.intent === 'ADD_ITEM' && plan.input.replaceLineId !== undefined) {
    const original = context.cart.lines.find(line => line.id === plan.input.replaceLineId)
    // The compact addition tool can replace a whole real cart line. It must
    // validate the removal target as well as the new item; a stale opaque ID
    // can never degrade into a normal addition. Ambiguous variants stay intact.
    if (typeof plan.input.replaceLineId !== 'string' || !original || context.cart.lines.filter(line => line.itemId === original.itemId).length > 1)
      return { kind: 'BLOCKED' as const, reason: 'TARGET_MISSING' as const }
  }
  if (plan.intent === 'ADD_ITEM' && !context.menu.some(item => item.id === plan.slots.itemId && item.available !== false))
    return { kind: 'BLOCKED' as const, reason: 'TARGET_MISSING' as const }
  if (plan.targetRef?.startsWith('selected:') && context.selectedItem?.itemId !== plan.targetRef.slice(9))
    return { kind: 'BLOCKED' as const, reason: 'TARGET_MISSING' as const }
  // An unavailable item is still a valid lookup subject. Selection/mutation
  // must retain the availability gate even when discovery exposes its name.
  if (plan.targetRef?.startsWith('item:') && !context.menu.some(item => itemRef(item) === plan.targetRef && (plan.intent === 'SEARCH_MENU' || item.available !== false)))
    return { kind: 'BLOCKED' as const, reason: 'TARGET_MISSING' as const }
  if ((plan.intent === 'SET_QUANTITY' || plan.intent === 'ADD_ITEM') && (!Number.isInteger(Number(plan.slots.quantity ?? 1)) || Number(plan.slots.quantity ?? 1) < 1 || Number(plan.slots.quantity ?? 1) > 20))
    return { kind: 'BLOCKED' as const, reason: 'INVALID_SLOTS' as const }
  if (plan.intent === 'CONFIRM_TAX_ID' && plan.slots.taxId !== context.checkout?.taxId)
    return { kind: 'BLOCKED' as const, reason: 'STALE_PLAN' as const }
  if (plan.intent === 'SET_TAX_ID' && !/^\d{8}$/.test(String(plan.slots.taxId ?? '')))
    return { kind: 'BLOCKED' as const, reason: 'INVALID_SLOTS' as const }
  if (plan.intent === 'SET_OPTION') {
    const itemId = plan.targetRef?.startsWith('cart:') ? context.cart.lines.find(line => lineRef(line) === plan.targetRef)?.itemId : context.selectedItem?.itemId
    const item = context.menu.find(item => item.id === itemId)
    if (!item?.optionGroups.some(group => group.id === plan.slots.groupId && group.values.some(value => value.id === plan.slots.valueId)))
      return { kind: 'BLOCKED' as const, reason: 'INVALID_SLOTS' as const }
  }
  if (plan.intent === 'SELECT_PAYMENT' && !context.allowedPaymentMethods.includes(plan.input.method as PaymentMethod))
    return { kind: 'BLOCKED' as const, reason: 'INVALID_PHASE' as const }
  return requiresConfirmation(plan, context) ? { kind: 'REQUIRE_CONFIRMATION' as const } : { kind: 'EXECUTE' as const }
}

export function requiresConfirmation(plan: OperationPlan, context: DecisionContext) {
  // Selecting a method opens the test scan step and remains reversible during
  // its countdown. Only the simulator's result proves payment authorization.
  if (plan.intent === 'CLEAR_CART' || plan.intent === 'CONFIRM_TAX_ID')
    return true
  return plan.intent === 'CANCEL_CHECKOUT' && (context.checkout?.stage === 'payment' || Boolean(context.checkout?.carrierCode || context.checkout?.taxId))
}

function revisionsFor(candidate: IntentCandidate, context: DecisionContext): Partial<KioskRevisions> {
  if (['SET_PARTY_SIZE', 'RESERVE_TABLES', 'START_CHECKOUT', 'SET_FULFILLMENT', 'SELECT_PAYMENT'].includes(candidate.intent) && context.seating)
    return { cart: context.revisions.cart, checkout: context.revisions.checkout, seating: context.revisions.seating }
  if (candidate.intent === 'VIEW_CART')
    return {}
  if (candidate.intent === 'SEARCH_MENU' || candidate.intent === 'RECOMMEND')
    return { menu: context.revisions.menu, ...(candidate.slots?.more ? { recommendation: context.revisions.recommendation } : {}) }
  if (candidate.targetRef?.startsWith('selected:'))
    return { selectedItem: context.revisions.selectedItem, cart: context.revisions.cart, menu: context.revisions.menu }
  if (candidate.intent === 'SELECT_ITEM')
    return { selectedItem: context.revisions.selectedItem, menu: context.revisions.menu }
  if (candidate.targetRef?.startsWith('cart:') || ['ADD_ITEM', 'CLEAR_CART', 'REMOVE_ITEM', 'SET_FULFILLMENT', 'START_CHECKOUT'].includes(candidate.intent))
    return { cart: context.revisions.cart, ...(candidate.intent === 'ADD_ITEM' ? { selectedItem: context.revisions.selectedItem } : {}), ...(candidate.intent === 'ADD_ITEM' || candidate.intent === 'SET_OPTION' ? { menu: context.revisions.menu } : {}) }
  return { checkout: context.revisions.checkout }
}

function extractTaxId(transcript: string) {
  const spokenDigits: Record<string, string> = { '○': '0', '〇': '0', '一': '1', '七': '7', '三': '3', '九': '9', '二': '2', '五': '5', '八': '8', '六': '6', '四': '4', '零': '0' }
  const digits = transcript
    .replace(/[○〇一七三九二五八六四零]/g, digit => spokenDigits[digit]!)
    .replace(/[^0-9\uFF10-\uFF19]/g, '')
    .replace(/[\uFF10-\uFF19]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
  return /^\d{8}$/.test(digits) ? digits : undefined
}

function quantityFromTranscript(transcript: string, allowBare = false) {
  const normalized = normalizeSlotNumbers(transcript)
  const matched = /(?:^|\D)(20|1\d|[1-9])\s*[份個碗杯]/.exec(normalized)
    ?? (allowBare ? /^(?:要|改成|[改再])?\s*(20|1\d|[1-9])\s*$/.exec(normalized) : null)
  return matched ? Number(matched[1]) : undefined
}

function optionSlotsFromTranscript(item: MenuItem, transcript: string) {
  const normalizedTranscript = normalizeSlotNumbers(transcript).replace(/要/g, '').replace(/\s/g, '')
  return item.optionGroups.flatMap(group => group.values
    .filter(value => normalizedTranscript.includes(value.label.replace(/要/g, '')))
    .map(value => ({ groupId: group.id, valueId: value.id })))
}

// Normalize only local numeric slots, never the ASR text used for item names.
// A 顆 value is an option; it must not become the number of servings.
function normalizeSlotNumbers(transcript: string) {
  const digits: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  return transcript.replace(/[\uFF10-\uFF19]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
    .replace(/二十|十[一二三四五六七八九]?|[一二兩三四五六七八九]/g, token => String(token === '二十' ? 20 : token.startsWith('十') ? 10 + (digits[token.slice(1)] ?? 0) : digits[token]))
}
