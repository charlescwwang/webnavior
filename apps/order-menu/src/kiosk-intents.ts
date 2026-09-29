import type { CheckoutSnapshot } from './domain/checkout-flow'
import type { CartLine, CartSnapshot, MenuItem, Selection } from './domain/order-machine'

/** Customer intent vocabulary. These names deliberately never expose WebMCP. */
export type KioskIntent
  = | 'ADD_ITEM' | 'CANCEL_CHECKOUT' | 'CHOOSE_INVOICE' | 'CLEAR_CART'
    | 'CONFIRM_TAX_ID' | 'RECOMMEND' | 'REMOVE_ITEM' | 'REQUEST_TAX_ID'
    | 'SEARCH_MENU' | 'SELECT_ITEM' | 'SELECT_PAYMENT' | 'SET_FULFILLMENT'
    | 'SET_OPTION' | 'SET_QUANTITY' | 'SET_TAX_ID' | 'SHOW_RECOMMENDATIONS'
    | 'SKIP_MEMBERSHIP' | 'START_CHECKOUT' | 'VIEW_CART'

export interface KioskRevisions { cart: number, checkout: number, menu?: number, selectedItem: number }
export interface DomainReference { label: string, refId: string }
export type KioskPhase = 'ordering' | 'checkout_membership' | 'checkout_invoice' | 'checkout_tax_id' | 'checkout_payment_select' | 'payment_locked' | 'checkout_complete'

export interface KioskIntentContext {
  cart: CartSnapshot
  checkout?: CheckoutSnapshot
  menu: readonly MenuItem[]
  paymentStatus?: 'pending' | 'uncertain'
  presentationItemIds?: readonly string[]
  recentAddedLineId?: string
  revisions: KioskRevisions
  selectedItem?: Selection
  transcript?: string
}

export interface IntentCandidate {
  description: string
  id: string
  intent: KioskIntent
  slots?: Record<string, string | number>
  targetRef?: string
}

export interface DecisionContext extends KioskIntentContext {
  allowedPaymentMethods: Array<'card' | 'mobile'>
  candidates: IntentCandidate[]
  /** Dietary constraints and slots are catalog-grounded application data, not model-generated arguments. */
  constraints: { exclude: string[] }
  interactionState: { lastAddedItemName?: string, matchingCartLines: number, selectedItemName?: string }
  phase: KioskPhase
  references: DomainReference[]
}

export interface DomainPlan {
  expectedRevisions: Partial<KioskRevisions>
  intent: KioskIntent
  slots: Record<string, string | number>
  targetRef?: string
}

export type KioskOperationToolName
  = | 'cart_add_item' | 'cart_clear' | 'cart_get' | 'cart_remove_item' | 'cart_set_line_option' | 'cart_set_line_quantity'
    | 'checkout_cancel' | 'checkout_choose_invoice' | 'checkout_confirm_tax_id' | 'checkout_request_tax_id' | 'checkout_select_payment' | 'checkout_set_tax_id' | 'checkout_skip_membership' | 'checkout_start'
    | 'menu_get' | 'menu_recommend' | 'menu_select_item' | 'menu_set_item_option' | 'menu_set_quantity' | 'menu_show_recommendations'
    | 'order_add_item' | 'order_set_fulfillment'

export interface OperationPlan {
  expectedRevisions: DomainPlan['expectedRevisions']
  input: Record<string, unknown>
  intent: KioskIntent
  slots: DomainPlan['slots']
  targetRef?: string
  toolName: KioskOperationToolName
}

export type Resolution
  = | { kind: 'PLAN', plan: DomainPlan }
    | { candidateRefs: string[], intent: KioskIntent, kind: 'CLARIFICATION', prompt: string }
    | { kind: 'INCOMPLETE' }
    | { kind: 'NEEDS_ASSISTANT' }
    | { kind: 'IGNORE' }

/** A one-use authorization for a high-risk customer action. */
export interface PendingConfirmation {
  action: 'CANCEL_CHECKOUT' | 'CLEAR_CART' | 'CONFIRM_TAX_ID' | 'SELECT_PAYMENT'
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
  const menuItems = input.menu.filter(item => item.available !== false)
  const matchingItems = resolveMenuItems(menuItems, transcript)
  const matchingCategories = matchingItems.length ? [] : resolveCategories(menuItems, transcript)
  const selected = input.selectedItem && menuItems.find(item => item.id === input.selectedItem?.itemId)
  const recentAddedLine = input.cart.lines.find(line => line.id === input.recentAddedLineId)
  const selectedRef = selected ? { label: `目前選的${selected.name}`, refId: `selected:${selected.id}` } : undefined
  const cartRefs = input.cart.lines.map((line, index) => ({ label: `購物車第${index + 1}筆${line.name}${line.id === recentAddedLine?.id ? '（最近加入）' : ''}`, refId: lineRef(line) }))
  const itemRefs = matchingItems.map(item => ({ label: item.name, refId: itemRef(item) }))
  const categoryRefs = matchingCategories.map(category => ({ label: `${category}分類`, refId: `category:${encodeURIComponent(category)}` }))
  const references = [...itemRefs, ...categoryRefs, ...(selectedRef ? [selectedRef] : []), ...cartRefs]
  const matchingCartLines = input.cart.lines.filter(line => matchingItems.some(item => item.id === line.itemId)).length
  const interactionState = { matchingCartLines, ...(selected ? { selectedItemName: selected.name } : {}), ...(recentAddedLine ? { lastAddedItemName: recentAddedLine.name } : {}) }
  const constraints = { exclude: porkFreeRequested(transcript) ? ['pork'] : [] }
  const candidates: IntentCandidate[] = []
  const checkout = input.checkout
  let phase: KioskPhase = 'ordering'
  const allowedPaymentMethods: Array<'card' | 'mobile'> = []

  if (!checkout) {
    // Target resolution is independent of intent selection: Jev receives one
    // candidate per operation, never one per product or cart line.
    if (itemRefs.length || categoryRefs.length)
      candidates.push(candidate('SEARCH_MENU', 'intent:search-menu', '查詢已解析的菜單品項是否存在，或瀏覽分類。'))
    if (itemRefs.length)
      candidates.push(candidate('SELECT_ITEM', 'intent:select-item', '查看或編輯已解析的餐點，但不建立訂購項目。'))
    if (itemRefs.length || selected || recentAddedLine)
      candidates.push(candidate('ADD_ITEM', 'intent:add-item', selected && !itemRefs.length ? `新增一份目前選取的${selected.name}至訂單。` : recentAddedLine && !itemRefs.length ? `新增一份最近加入的${recentAddedLine.name}至訂單。` : '明確建立一筆新的餐點訂購項目。'))
    if (!itemRefs.length)
      candidates.push(candidate('RECOMMEND', 'intent:recommend', '顧客明確要求簡單推薦或套用已知飲食限制。'))
    if (input.cart.lines.length)
      candidates.push(candidate('VIEW_CART', 'intent:view-cart', '查看目前購物車。'))
    if (selected || input.cart.lines.length) {
      candidates.push(candidate('SET_QUANTITY', 'intent:set-quantity', '修改已選或購物車現有餐點數量，不新增品項。'))
      candidates.push(candidate('SET_OPTION', 'intent:set-option', '修改已選或購物車現有餐點客製選項。'))
    }
    if (input.cart.lines.length) {
      candidates.push(candidate('REMOVE_ITEM', 'intent:remove-item', matchingCartLines > 1 ? '移除購物車中的餐點；若有多筆同名品項，程式會詢問是哪一筆。' : '移除購物車中的特定一筆餐點。'))
      candidates.push(candidate('CLEAR_CART', 'intent:clear-cart', '明確要求清空整個購物車。'))
      if (!input.cart.fulfillmentMode) {
        candidates.push(candidate('SET_FULFILLMENT', 'intent:set-fulfillment:dine-in', '這筆訂單設為內用。', undefined, { mode: 'dine-in' }))
        candidates.push(candidate('SET_FULFILLMENT', 'intent:set-fulfillment:takeout', '這筆訂單設為外帶。', undefined, { mode: 'takeout' }))
      }
      else {
        candidates.push(candidate('START_CHECKOUT', 'intent:start-checkout', '開始結帳。'))
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
    candidates.push(candidate('CHOOSE_INVOICE', 'intent:choose-invoice:donation', '選擇捐贈發票。', undefined, { method: 'donation' }))
    if (checkout.carrierCode)
      candidates.push(candidate('CHOOSE_INVOICE', 'intent:choose-invoice:carrier', '使用已掃描的雲端載具。', undefined, { method: 'carrier' }))
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
    allowedPaymentMethods.push('card', 'mobile')
    candidates.push(candidate('SELECT_PAYMENT', 'intent:select-payment:card', '使用信用卡付款。', undefined, { method: 'card' }))
    candidates.push(candidate('SELECT_PAYMENT', 'intent:select-payment:mobile', '使用行動支付付款。', undefined, { method: 'mobile' }))
    candidates.push(candidate('CANCEL_CHECKOUT', 'intent:cancel-checkout', '取消尚未啟動付款的結帳並回到訂單；執行前須再次確認。'))
  }
  else {
    phase = 'checkout_complete'
  }

  return { ...input, allowedPaymentMethods, candidates, constraints, interactionState, phase, references }
}

/** Resolves a finite System One choice to a domain plan, never to a tool. */
export function resolveIntent(decision: IntentCandidate, context: DecisionContext, chosenTargetRef?: string): Resolution {
  const resolved = context.candidates.find(candidate => candidate.id === decision.id)
  if (!resolved)
    return { kind: 'IGNORE' }
  const transcript = context.transcript?.trim() ?? ''
  const menuRefs = context.references.filter(reference => reference.refId.startsWith('item:'))
  const categoryRefs = context.references.filter(reference => reference.refId.startsWith('category:'))
  const namedItemIds = new Set(menuRefs.map(reference => reference.refId.slice(5)))
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

  switch (resolved.intent) {
    case 'SEARCH_MENU':
      targetRefs = menuRefs.length ? menuRefs : categoryRefs
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
  }
  if (chosenTargetRef)
    targetRefs = targetRefs.filter(reference => reference.refId === chosenTargetRef)
  const targetRequired = ['SEARCH_MENU', 'SELECT_ITEM', 'ADD_ITEM', 'SET_OPTION', 'SET_QUANTITY', 'REMOVE_ITEM'].includes(resolved.intent)
  if (targetRequired && targetRefs.length === 0)
    return { kind: 'NEEDS_ASSISTANT' }
  if (targetRefs.length > 1) {
    return {
      candidateRefs: targetRefs.map(reference => reference.refId),
      intent: resolved.intent,
      kind: 'CLARIFICATION',
      prompt: buildClarificationPrompt(targetRefs),
    }
  }

  const targetRef = targetRefs[0]?.refId
  if (resolved.intent === 'SEARCH_MENU') {
    if (targetRef?.startsWith('item:'))
      slots.query = context.menu.find(item => item.id === targetRef.slice(5))?.name ?? ''
    else if (targetRef?.startsWith('category:'))
      slots.category = decodeURIComponent(targetRef.slice(9))
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
    slots.quantity = quantityFromTranscript(transcript) ?? selectedItem.quantity
    slots.options = JSON.stringify(Object.entries(selectedItem.options).map(([groupId, valueId]) => ({ groupId, valueId })))
  }
  if (resolved.intent === 'ADD_ITEM' && targetRef?.startsWith('item:')) {
    const item = context.menu.find(item => item.id === targetRef.slice(5))!
    const options = optionSlotsFromTranscript(item, transcript)
    if (!item.optionGroups.every(group => !group.required || options.some(option => option.groupId === group.id)))
      return { kind: 'NEEDS_ASSISTANT' }
    slots.quantity = quantityFromTranscript(transcript) ?? 1
    if (options.length)
      slots.options = JSON.stringify(options)
  }
  if (resolved.intent === 'ADD_ITEM' && targetRef?.startsWith('cart:')) {
    const line = context.cart.lines.find(candidate => lineRef(candidate) === targetRef)!
    slots.itemId = line.itemId
    slots.quantity = quantityFromTranscript(transcript) ?? 1
    slots.options = JSON.stringify(Object.entries(line.options).map(([groupId, valueId]) => ({ groupId, valueId })))
  }
  if (resolved.intent === 'SET_QUANTITY') {
    const quantity = quantityFromTranscript(transcript) ?? (typeof slots.quantity === 'number' ? slots.quantity : undefined)
    if (!quantity)
      return { kind: 'NEEDS_ASSISTANT' }
    slots.quantity = quantity
  }
  if (resolved.intent === 'SET_OPTION') {
    const itemId = targetRef?.startsWith('selected:') ? targetRef.slice(9) : context.cart.lines.find(line => lineRef(line) === targetRef)?.itemId
    const item = context.menu.find(item => item.id === itemId)
    const options = item ? optionSlotsFromTranscript(item, transcript) : []
    if (options.length !== 1 && (typeof slots.groupId !== 'string' || typeof slots.valueId !== 'string'))
      return { kind: 'NEEDS_ASSISTANT' }
    slots.groupId = options[0]?.groupId ?? slots.groupId
    slots.valueId = options[0]?.valueId ?? slots.valueId
  }
  if (resolved.intent === 'RECOMMEND' && context.constraints.exclude.includes('pork')) {
    if (!context.menu.some(item => item.available !== false && item.recommendationTags.includes('pork-free')))
      return { kind: 'NEEDS_ASSISTANT' }
    slots.needs = 'pork-free'
  }
  if (resolved.intent === 'SET_TAX_ID' && !slots.taxId)
    return { kind: 'NEEDS_ASSISTANT' }
  const expectedRevisions = revisionsFor({ ...resolved, targetRef }, context)
  return { kind: 'PLAN', plan: { expectedRevisions, intent: resolved.intent, slots, ...(targetRef ? { targetRef } : {}) } }
}

/** Only known catalog names and merchant-provided aliases can identify items. */
function resolveMenuItems(menu: readonly MenuItem[], transcript: string) {
  const normalized = transcript.toLocaleLowerCase().replace(/\s/g, '')
  const names = menu.map(item => item.name.toLocaleLowerCase().replace(/\s/g, ''))
  const occurrences = menu.flatMap((item, itemIndex) => {
    const name = names[itemIndex]!
    const uniqueSuffixes = Array.from({ length: Math.max(0, name.length - 3) }, (_, index) => name.slice(-(index + 3)))
      .filter(suffix => names.every((other, otherIndex) => otherIndex === itemIndex || !other.endsWith(suffix)))
    return [item.name, ...(item.aliases ?? []), ...uniqueSuffixes].flatMap((name) => {
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
    if (chosen.some(existing => match.start < existing.end && existing.start < match.end))
      continue
    chosen.push(match)
  }
  return menu.filter(item => chosen.some(match => match.item.id === item.id))
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
  return `你是要操作${references.map(reference => reference.label).join('，還是')}？`
}

/** Resolves only a spoken choice among the already-bound clarification refs. */
export function resolveClarificationReference(transcript: string, references: readonly DomainReference[]) {
  const normalized = transcript.replace(/\s/g, '')
  const chineseOrdinals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  const matches = references.filter((reference, index) => {
    const position = index + 1
    return normalized.includes(reference.label)
      || normalized.includes(`第${position}筆`)
      || normalized.includes(`第${chineseOrdinals[index]}筆`)
      || normalized.includes(`第${position}個`)
      || normalized.includes(`第${chineseOrdinals[index]}個`)
  })
  return matches.length === 1 ? matches[0]!.refId : undefined
}

/** Compiles an already-resolved domain plan to one concrete WebMCP operation. */
export function compileOperationPlan(plan: DomainPlan): OperationPlan {
  const base = { expectedRevisions: plan.expectedRevisions, intent: plan.intent, slots: plan.slots, ...(plan.targetRef ? { targetRef: plan.targetRef } : {}) }
  const targetId = plan.targetRef?.replace(/^cart:|^selected:|^item:/, '')
  switch (plan.intent) {
    case 'SEARCH_MENU': return { ...base, input: plan.slots.category ? { category: plan.slots.category } : { query: plan.slots.query }, toolName: 'menu_get' }
    case 'RECOMMEND': return { ...base, input: plan.slots.needs ? { needs: [plan.slots.needs] } : {}, toolName: 'menu_recommend' }
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
    case 'START_CHECKOUT': return { ...base, input: { confirmedByUser: true }, toolName: 'checkout_start' }
    case 'SKIP_MEMBERSHIP': return { ...base, input: { confirmedByUser: true }, toolName: 'checkout_skip_membership' }
    case 'CHOOSE_INVOICE': return { ...base, input: { method: plan.slots.method }, toolName: 'checkout_choose_invoice' }
    case 'REQUEST_TAX_ID': return { ...base, input: {}, toolName: 'checkout_request_tax_id' }
    case 'SET_TAX_ID': return { ...base, input: { taxId: plan.slots.taxId }, toolName: 'checkout_set_tax_id' }
    case 'CONFIRM_TAX_ID': return { ...base, input: { confirmedByUser: true }, toolName: 'checkout_confirm_tax_id' }
    case 'SELECT_PAYMENT': return { ...base, input: { method: plan.slots.method }, toolName: 'checkout_select_payment' }
    case 'CANCEL_CHECKOUT': return { ...base, input: { confirmedByUser: true }, toolName: 'checkout_cancel' }
  }
}

/** Mechanical authorization only: no transcript parsing or model interpretation. */
export function authorize(plan: OperationPlan, context: DecisionContext) {
  for (const key of ['cart', 'checkout', 'menu', 'selectedItem'] as const) {
    if (plan.expectedRevisions[key] !== undefined && plan.expectedRevisions[key] !== context.revisions[key])
      return { kind: 'BLOCKED' as const, reason: 'STALE_PLAN' as const }
  }
  if (context.paymentStatus === 'pending' || context.paymentStatus === 'uncertain')
    return { kind: 'BLOCKED' as const, reason: 'PAYMENT_IN_PROGRESS' as const }
  const allowedByPhase: Record<KioskPhase, readonly KioskIntent[]> = {
    ordering: ['ADD_ITEM', 'CLEAR_CART', 'RECOMMEND', 'REMOVE_ITEM', 'SEARCH_MENU', 'SELECT_ITEM', 'SET_FULFILLMENT', 'SET_OPTION', 'SET_QUANTITY', 'SHOW_RECOMMENDATIONS', 'START_CHECKOUT', 'VIEW_CART'],
    checkout_membership: ['SKIP_MEMBERSHIP', 'CANCEL_CHECKOUT'],
    checkout_invoice: ['CHOOSE_INVOICE', 'REQUEST_TAX_ID', 'CANCEL_CHECKOUT'],
    checkout_tax_id: ['SET_TAX_ID', 'CONFIRM_TAX_ID', 'CANCEL_CHECKOUT'],
    checkout_payment_select: ['SELECT_PAYMENT', 'CANCEL_CHECKOUT'],
    payment_locked: [],
    checkout_complete: [],
  }
  if (!allowedByPhase[context.phase].includes(plan.intent))
    return { kind: 'BLOCKED' as const, reason: 'INVALID_PHASE' as const }
  if (plan.intent === 'START_CHECKOUT' && (!context.cart.lines.length || !context.cart.fulfillmentMode))
    return { kind: 'BLOCKED' as const, reason: 'INVALID_PHASE' as const }
  if (plan.targetRef?.startsWith('cart:') && !context.cart.lines.some(line => lineRef(line) === plan.targetRef))
    return { kind: 'BLOCKED' as const, reason: 'TARGET_MISSING' as const }
  if (plan.intent === 'ADD_ITEM' && !context.menu.some(item => item.id === plan.slots.itemId && item.available !== false))
    return { kind: 'BLOCKED' as const, reason: 'TARGET_MISSING' as const }
  if (plan.targetRef?.startsWith('selected:') && context.selectedItem?.itemId !== plan.targetRef.slice(9))
    return { kind: 'BLOCKED' as const, reason: 'TARGET_MISSING' as const }
  if (plan.targetRef?.startsWith('item:') && !context.menu.some(item => itemRef(item) === plan.targetRef && item.available !== false))
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
  if (plan.intent === 'SELECT_PAYMENT' && !context.allowedPaymentMethods.includes(plan.input.method as 'card' | 'mobile'))
    return { kind: 'BLOCKED' as const, reason: 'INVALID_PHASE' as const }
  return requiresConfirmation(plan, context) ? { kind: 'REQUIRE_CONFIRMATION' as const } : { kind: 'EXECUTE' as const }
}

export function requiresConfirmation(plan: OperationPlan, context: DecisionContext) {
  if (plan.intent === 'CLEAR_CART' || plan.intent === 'CONFIRM_TAX_ID' || plan.intent === 'SELECT_PAYMENT')
    return true
  return plan.intent === 'CANCEL_CHECKOUT' && (context.checkout?.stage === 'payment' || Boolean(context.checkout?.carrierCode || context.checkout?.taxId))
}

function revisionsFor(candidate: IntentCandidate, context: DecisionContext): Partial<KioskRevisions> {
  if (candidate.intent === 'VIEW_CART')
    return {}
  if (candidate.intent === 'SEARCH_MENU' || candidate.intent === 'RECOMMEND')
    return { menu: context.revisions.menu }
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

function quantityFromTranscript(transcript: string) {
  const normalized = transcript
    .replace(/[○〇一二三四五六七八九十兩]/g, digit => ({ '○': '0', '〇': '0', '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10', '兩': '2' })[digit]!)
    .replace(/[\uFF10-\uFF19]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
  const matched = /(?:^|\D)(20|1\d|[1-9])\s*(?:[份個碗杯]|份?)/.exec(normalized)
  return matched ? Number(matched[1]) : undefined
}

function optionSlotsFromTranscript(item: MenuItem, transcript: string) {
  const normalizedTranscript = transcript.replace(/要/g, '')
  return item.optionGroups.flatMap(group => group.values
    .filter(value => normalizedTranscript.includes(value.label.replace(/要/g, '')))
    .map(value => ({ groupId: group.id, valueId: value.id })))
}

function porkFreeRequested(transcript: string) {
  return /(?:不[要吃含]|不要有|無|沒有)豬肉/.test(transcript)
}
