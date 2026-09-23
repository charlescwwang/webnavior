import type { CheckoutSnapshot, InvoiceMethod } from './domain/checkout-flow'
import type { CartSnapshot, FulfillmentMode, MenuItem, PosOrderGateway, RecommendationTag, Selection, SubmittedOrder } from './domain/order-machine'

import { errorMessageFrom } from '@moeru/std'

import { catalogInfo, createOrderMachine } from './domain/order-machine'

export type MenuToolName
  = | 'menu_get'
    | 'menu_recommend'
    | 'menu_show_recommendations'
    | 'menu_select_item'
    | 'menu_set_item_option'
    | 'menu_set_quantity'
    | 'order_add_item'
    | 'cart_add_item'
    | 'cart_remove_item'
    | 'cart_set_line_quantity'
    | 'cart_set_line_option'
    | 'cart_clear'
    | 'cart_get'
    | 'order_set_fulfillment'
    | 'checkout_start'
    | 'checkout_skip_membership'
    | 'checkout_choose_invoice'
    | 'checkout_request_tax_id'
    | 'checkout_set_tax_id'
    | 'checkout_confirm_tax_id'
    | 'checkout_select_payment'
    | 'checkout_cancel'

export interface AgentAction {
  controlId?: string
  expandCustomization?: boolean
  label: string
  targetId?: string
}

/** A customer-facing collection chosen from the current menu catalog. */
export interface RecommendationPresentation {
  itemIds: string[]
  reason?: string
  title?: string
}

/** Returns the DOM control identifier used to visually follow an AI option change. */
export function optionControlId(itemId: string, groupId: string, valueId: string) {
  return `${itemId}:option:${groupId}:${valueId}`
}

/** Returns the DOM control identifier used to visually follow an AI quantity change. */
export function quantityControlId(itemId: string) {
  return `${itemId}:quantity`
}

/** Returns the DOM control identifier used to visually follow a service-mode change. */
export function fulfillmentControlId(mode: FulfillmentMode) {
  return `order:fulfillment:${mode}`
}

interface MenuToolDefinition {
  description: string
  inputSchema: Record<string, unknown>
  name: MenuToolName
  readOnly?: boolean
}

export interface CheckoutToolController {
  assertCanRestart: () => void
  cancel: () => void
  chooseInvoice: (method: Exclude<InvoiceMethod, 'tax-id'>) => CheckoutSnapshot
  confirmTaxId: () => CheckoutSnapshot
  requestTaxId: () => CheckoutSnapshot
  restart: () => void
  selectPayment: (method: 'card' | 'mobile') => Promise<{ customerMessage: string, status: string }>
  setTaxId: (taxId: string) => CheckoutSnapshot
  skipMembership: () => CheckoutSnapshot
  start: () => CheckoutSnapshot
}

interface MenuToolRuntimeOptions {
  /** Routes Agent checkout actions through the same state transitions as visible controls. */
  checkout?: CheckoutToolController
  /** Submits confirmed carts to the current ordering environment. */
  gateway?: PosOrderGateway
  /** Initial POS catalog. The browser must not substitute a local menu on failure. */
  menu?: MenuItem[]
  /** Marks the beginning of a WebMCP-originated operation. */
  onAgentOperationStart?: () => void
  /** Marks the end of a WebMCP-originated operation. */
  onAgentOperationEnd?: () => void
  onAction: (action: AgentAction) => Promise<void> | void
  onCartChange: (cart: CartSnapshot) => void
  onMenuSelection: (itemId: string | undefined) => void
  /** Mirrors an order-level dine-in or take-out choice into the menu UI. */
  onFulfillmentChange?: (mode: FulfillmentMode | undefined) => void
  /** Mirrors the active tool selection into the menu UI. */
  onSelectionChange?: (selection: Selection) => void
  /** Notifies the embedding host after the first successfully confirmed order. */
  onOrderConfirmed?: (order: SubmittedOrder) => void
  /** Mirrors every final POS receipt into the visible customer flow. */
  onOrderSubmission?: (order: SubmittedOrder) => void
  /** Requests a non-blocking recommendation rail in the human menu UI. */
  onRecommendationsChange?: (presentation: RecommendationPresentation) => void
}

interface ModelContextLike {
  registerTool: (tool: {
    name: string
    description: string
    inputSchema: Record<string, unknown>
    annotations?: { readOnlyHint?: boolean }
    exposedTo?: string[]
    execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>
  }, options?: { exposedTo?: string[], signal?: AbortSignal }) => Promise<unknown>
}

const toolDefinitions: MenuToolDefinition[] = [
  { name: 'menu_get', description: '依分類或餐點名稱取得可點餐品項與 ID；未帶篩選時取得完整菜單。回傳合法的內用／外帶選項。顧客問某個分類有哪些品項時，先查詢後直接列出本次回傳、符合該分類的品項，不可只說「有幾種」後反問。後續選擇餐點必須使用本工具結果中的 item.id。', inputSchema: { type: 'object', properties: { category: { type: 'string', description: '要查詢的精確分類名稱；未知時省略。' }, query: { type: 'string', description: '顧客說出的餐點名稱或關鍵字；未知時省略。' } }, additionalProperties: false }, readOnly: true },
  { name: 'menu_recommend', description: '依顧客需求推薦最多三項餐點。每個 needs 標籤都必須符合：rice 為飯類、fried 為炸物、pork-free 為已確認不含豬肉。', inputSchema: { type: 'object', properties: { needs: { type: 'array', items: { type: 'string', enum: ['rice', 'fried', 'pork-free'] }, minItems: 1, uniqueItems: true }, limit: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['needs'], additionalProperties: false }, readOnly: true },
  { name: 'menu_show_recommendations', description: '在菜單中非阻斷地展示 1 至 4 項推薦。只可在顧客明確表示想看推薦後使用。itemIds 必須全部來自先前 menu_get 或 menu_recommend 的回傳結果；不得自行猜測品項。可附簡短標題與理由，但不得加入未提供的健康、過敏或供應資訊。', inputSchema: { type: 'object', properties: { itemIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4, uniqueItems: true, description: '必要。先前菜單工具回傳的 item.id。' }, reason: { type: 'string', maxLength: 90, description: '可選。給顧客看的簡短搭配理由。' }, title: { type: 'string', maxLength: 36, description: '可選。推薦列標題。' } }, required: ['itemIds'], additionalProperties: false } },
  { name: 'menu_select_item', description: '選擇一個餐點並建立可設定的選擇。呼叫前必須先使用 menu_get，並傳入其結果中完全相同的 item.id。', inputSchema: { type: 'object', properties: { itemId: { type: 'string', description: '必要。先前 menu_get 回傳的其中一個 item.id；不得猜測、翻譯或自行建立。' } }, required: ['itemId'], additionalProperties: false } },
  { name: 'menu_set_item_option', description: '設定目前餐點的口味、辣度、甜度或冰量。groupId 與 valueId 必須來自 menu_select_item 回傳的 item.optionGroups。', inputSchema: { type: 'object', properties: { groupId: { type: 'string', description: '必要。已選餐點 optionGroups 中的 group.id。' }, valueId: { type: 'string', description: '必要。該 group.values 中的 value.id。' } }, required: ['groupId', 'valueId'], additionalProperties: false } },
  { name: 'menu_set_quantity', description: '設定目前餐點的數量。只可在 menu_select_item 後、cart_add_item 前使用。', inputSchema: { type: 'object', properties: { quantity: { type: 'integer', minimum: 1, maximum: 20, description: '必要。顧客指定的整數數量；未指定時使用 1。' } }, required: ['quantity'], additionalProperties: false } },
  { name: 'order_add_item', description: '一次完成一個已確認餐點的選擇、已知客製化、數量與加入購物車。顧客指定品項與所有必要客製化後，優先使用此工具，避免逐步呼叫 menu_select_item、menu_set_item_option、menu_set_quantity、cart_add_item。itemId、options 的 groupId 與 valueId 必須來自 menu_get 的結果。', inputSchema: { type: 'object', properties: { itemId: { type: 'string', description: '必要。menu_get 回傳的其中一個 item.id。' }, options: { type: 'array', description: '顧客明確指定的客製化；未指定的選項保留該品項預設值。', items: { type: 'object', properties: { groupId: { type: 'string' }, valueId: { type: 'string' } }, required: ['groupId', 'valueId'], additionalProperties: false } }, quantity: { type: 'integer', minimum: 1, maximum: 20, description: '顧客指定的數量；省略時為 1。' } }, required: ['itemId'], additionalProperties: false } },
  { name: 'cart_add_item', description: '將目前已設定的餐點加入購物車。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cart_remove_item', description: '從購物車移除一個 cart line。先用 cart_get 取得正確的 lineId。顧客要求移除時，必須先執行本工具並確認成功，才能告知顧客已移除；不得只說會移除。', inputSchema: { type: 'object', properties: { lineId: { type: 'string', description: '必要。cart_get 回傳的其中一個 cart.lines[].id。' } }, required: ['lineId'], additionalProperties: false } },
  { name: 'cart_set_line_quantity', description: '直接調整購物車中一個餐點的數量，不要先移除再重新加入。先用 cart_get 取得正確的 lineId；成功後依回傳 cart 確認數量與總額。', inputSchema: { type: 'object', properties: { lineId: { type: 'string', description: '必要。cart_get 回傳的其中一個 cart.lines[].id。' }, quantity: { type: 'integer', minimum: 1, description: '必要。調整後的正整數數量。' } }, required: ['lineId', 'quantity'], additionalProperties: false } },
  { name: 'cart_set_line_option', description: '直接修改購物車中一個餐點的單一客製選項，不要先移除再重新加入。先用 cart_get 取得 lineId；groupId 和 valueId 必須來自該餐點先前由 menu_get 回傳的 optionGroups。若修改後與另一筆選項完全相同，系統會合併數量並回傳保留的 line。', inputSchema: { type: 'object', properties: { lineId: { type: 'string', description: '必要。cart_get 回傳的其中一個 cart.lines[].id。' }, groupId: { type: 'string', description: '必要。該餐點 optionGroups 中的 group.id。' }, valueId: { type: 'string', description: '必要。該 group.values 中的 value.id。' } }, required: ['lineId', 'groupId', 'valueId'], additionalProperties: false } },
  { name: 'cart_clear', description: '清空尚未送出的購物車。僅在顧客明確表示取消全部餐點、重新開始或等同語意時使用；先以 cart_get 確認目前內容。清空後原本的內用／外帶選擇也會移除。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true, description: '必要。只有顧客已明確要求清空時才可設為 true。' } }, required: ['confirmedByUser'], additionalProperties: false } },
  { name: 'cart_get', description: '取得目前購物車、品項數與總額。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, readOnly: true },
  { name: 'order_set_fulfillment', description: '設定整筆訂單為內用或外帶。若顧客尚未告知，先以自然語句詢問；必須在 checkout_start 前完成。', inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['dine-in', 'takeout'], description: '必要。dine-in 為內用；takeout 為外帶。' } }, required: ['mode'], additionalProperties: false } },
  { name: 'checkout_start', description: '顧客已明確同意目前購物車內容並表示要結帳時，開啟會員掃碼步驟。確認可以是自然語意，不要求固定字句。此工具只進入結帳，不會直接送 POS。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } },
  { name: 'checkout_skip_membership', description: '顧客明確表示略過、不使用會員或等同語意時，略過會員掃碼。不得代替顧客宣稱已掃描條碼。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } },
  { name: 'checkout_choose_invoice', description: '依顧客意思選擇已掃描的雲端發票載具或捐贈。未實際掃描或帶入載具時不可選 carrier；顧客要統編時改用 checkout_request_tax_id。', inputSchema: { type: 'object', properties: { method: { type: 'string', enum: ['carrier', 'donation'] } }, required: ['method'], additionalProperties: false } },
  { name: 'checkout_request_tax_id', description: '顧客表示要填統編時，開啟統編輸入畫面。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'checkout_set_tax_id', description: '把顧客口說的完整 8 碼統編帶入畫面供顧客查看。只負責顯示，不會直接確認或前進付款。', inputSchema: { type: 'object', properties: { taxId: { type: 'string', pattern: '^\\d{8}$' } }, required: ['taxId'], additionalProperties: false } },
  { name: 'checkout_confirm_tax_id', description: '顧客看過畫面上的 8 碼統編並以自然語意表示正確後確認；不要求逐字說出固定句子。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } },
  { name: 'checkout_select_payment', description: '依顧客選擇啟動信用卡或行動支付終端。這只選擇方式並等待終端；不得宣稱付款成功，實際刷卡、掃碼與授權必須由顧客及支付終端完成。', inputSchema: { type: 'object', properties: { method: { type: 'string', enum: ['card', 'mobile'] } }, required: ['method'], additionalProperties: false } },
  { name: 'checkout_cancel', description: '顧客明確表示取消本次結帳時返回訂單內容並保留購物車。付款等待中或付款結果不明時不可取消，以免重複扣款。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } },
]

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
  if (input.method !== 'carrier' && input.method !== 'donation')
    throw new Error('method must be carrier or donation.')
  return input.method
}

function requiredPaymentMethod(input: Record<string, unknown>) {
  if (input.method !== 'card' && input.method !== 'mobile')
    throw new Error('method must be card or mobile.')
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

function pendingCustomerChoice(cart: CartSnapshot) {
  if (cart.fulfillmentMode)
    return undefined

  return {
    id: 'fulfillment-mode',
    question: '請問要內用還是外帶？',
    canBeDeferred: true,
    options: [
      { id: 'dine-in', label: '內用' },
      { id: 'takeout', label: '外帶' },
    ],
  }
}

function cartNextStep(cart: CartSnapshot) {
  return cart.fulfillmentMode
    ? 'Confirm the cart with the customer. Call checkout_start only after explicit customer consent.'
    : 'The customer still needs to choose dine-in or take-out before order confirmation. Ask when appropriate, but continue adding requested items first.'
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

function getMenuQuery(input: Record<string, unknown>) {
  const category = typeof input.category === 'string' ? input.category.trim() : ''
  const query = typeof input.query === 'string' ? input.query.trim().toLocaleLowerCase() : ''
  return { category, query }
}

function recommendationNeeds(input: Record<string, unknown>): RecommendationTag[] {
  const needs = input.needs
  const validTags: RecommendationTag[] = ['rice', 'fried', 'pork-free']
  if (!Array.isArray(needs) || needs.length === 0 || !needs.every(tag => typeof tag === 'string' && validTags.includes(tag as RecommendationTag)))
    throw new Error('needs must contain one or more supported recommendation tags.')

  return [...new Set(needs)] as RecommendationTag[]
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
    itemIds: normalizedItemIds,
    ...(reason ? { reason } : {}),
    ...(title ? { title } : {}),
  }
}

/** Builds an LLM-readable retry result instead of allowing browser mediation to hide the validation error. */
function nativeInvocationFailure(name: MenuToolName, error: unknown) {
  const message = errorMessageFrom(error) ?? 'The requested menu operation could not be completed.'
  const recovery = name === 'menu_select_item' && message === 'itemId is required.'
    ? 'First call menu_get. Then call menu_select_item again with itemId set to exactly one item.id returned by menu_get.'
    : name === 'checkout_start' && message.includes('Choose dine-in or take-out before starting checkout.')
      ? 'Ask the customer whether this order is dine-in or take-out. Then call order_set_fulfillment before retrying checkout_start.'
      : 'Check this tool\'s required arguments and the latest menu or cart result, then retry only with valid values.'

  return { ok: false, error: message, recovery }
}

/**
 * Presents one domain interface to native WebMCP and human UI controls. Each
 * mutation announces itself before updating state.
 */
export function createMenuToolRuntime(options: MenuToolRuntimeOptions) {
  const machine = createOrderMachine({ gateway: options.gateway, menu: options.menu })
  let nativeRegistration: AbortController | undefined
  let completedOrderId: string | undefined

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

  async function invoke(name: MenuToolName, input: Record<string, unknown> = {}, onAction = options.onAction) {
    const isAgentOperation = onAction === options.onAction
    if (isAgentOperation)
      options.onAgentOperationStart?.()

    try {
      switch (name) {
        case 'menu_get':
        {
          const { category, query } = getMenuQuery(input)
          const categories = [...new Set(machine.getMenu().map(item => item.category))]

          const items = machine.getMenu(category || undefined)
            .filter((item) => {
              if (!query)
                return true
              return [item.id, item.name, item.description, item.category]
                .some(value => value.toLocaleLowerCase().includes(query))
            })
            .map(menuItemForAgent)
          return {
            catalog: catalogInfo,
            categories,
            fulfillmentModes: [
              { id: 'dine-in', label: '內用' },
              { id: 'takeout', label: '外帶' },
            ],
            items,
          }
        }
        case 'menu_recommend': {
          const needs = recommendationNeeds(input)
          const limit = input.limit === undefined ? 3 : requiredNumber(input, 'limit')
          if (!Number.isInteger(limit) || limit < 1 || limit > 3)
            throw new Error('limit must be an integer from 1 to 3.')

          return {
            items: machine.getMenu()
              .filter(item => needs.every(need => item.recommendationTags.includes(need)))
              .slice(0, limit)
              .map(menuItemForAgent),
            needs,
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

          options.onRecommendationsChange?.(presentation)
          return {
            customerMessage: '已在菜單上顯示推薦餐點。',
            items: items.map(menuItemForAgent),
            presentation,
          }
        }
        case 'menu_select_item': {
          const itemId = requiredString(input, 'itemId')
          const item = machine.getMenu().find(candidate => candidate.id === itemId) as MenuItem | undefined
          await announce(`正在選擇${item?.name ?? '餐點'}`, itemId, {}, onAction)
          options.onMenuSelection(itemId)
          const selection = machine.selectMenuItem(itemId)
          options.onSelectionChange?.(selection)
          return {
            item: item ? menuItemForAgent(item) : undefined,
            selection,
          }
        }
        case 'menu_set_item_option': {
          const groupId = requiredString(input, 'groupId')
          const valueId = requiredString(input, 'valueId')
          const selection = machine.getSelection()
          const item = selection && machine.getMenu().find(candidate => candidate.id === selection.itemId)
          const value = item?.optionGroups.find(group => group.id === groupId)?.values.find(candidate => candidate.id === valueId)
          await announce(`設定為${value?.label ?? '指定選項'}`, item?.id, {
            controlId: item ? optionControlId(item.id, groupId, valueId) : undefined,
            expandCustomization: true,
          }, onAction)
          const nextSelection = machine.setItemOption(groupId, valueId)
          options.onSelectionChange?.(nextSelection)
          return { selection: nextSelection }
        }
        case 'menu_set_quantity': {
          const quantity = requiredNumber(input, 'quantity')
          const itemId = machine.getSelection()?.itemId
          await announce(`設定數量為 ${quantity}`, itemId, {
            controlId: itemId ? quantityControlId(itemId) : undefined,
          }, onAction)
          const nextSelection = machine.setQuantity(quantity)
          options.onSelectionChange?.(nextSelection)
          return { selection: nextSelection }
        }
        case 'order_add_item': {
          const itemId = requiredString(input, 'itemId')
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

          const quantity = input.quantity === undefined ? undefined : requiredNumber(input, 'quantity')
          if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1 || quantity > 20))
            throw new Error('quantity must be an integer from 1 to 20.')

          await announce(`正在選擇${item.name}`, item.id, {}, onAction)
          options.onMenuSelection(item.id)
          let selection = machine.selectMenuItem(item.id)
          options.onSelectionChange?.(selection)

          for (const option of itemOptions) {
            const value = item.optionGroups.find(group => group.id === option.groupId)?.values.find(candidate => candidate.id === option.valueId)
            await announce(`設定為${value?.label ?? '指定選項'}`, item.id, {
              controlId: optionControlId(item.id, option.groupId, option.valueId),
              expandCustomization: true,
            }, onAction)
            selection = machine.setItemOption(option.groupId, option.valueId)
            options.onSelectionChange?.(selection)
          }

          if (quantity !== undefined) {
            await announce(`設定數量為 ${quantity}`, item.id, {
              controlId: quantityControlId(item.id),
            }, onAction)
            selection = machine.setQuantity(quantity)
            options.onSelectionChange?.(selection)
          }

          await announce('加入購物車', 'cart', {}, onAction)
          const { cart, line } = machine.addToCart()
          options.onCartChange(cart)
          return {
            item: menuItemForAgent(item),
            line,
            cart,
            customerMessage: `已將${line.name}加入購物車，共 ${line.quantity} 份。`,
            pendingCustomerChoice: pendingCustomerChoice(cart),
            nextStep: cartNextStep(cart),
          }
        }
        case 'cart_add_item': {
          await announce('加入購物車', 'cart', {}, onAction)
          const result = machine.addToCart()
          options.onCartChange(result.cart)
          return {
            ...result,
            customerMessage: `已將${result.line.name}加入購物車，共 ${result.line.quantity} 份。`,
            pendingCustomerChoice: pendingCustomerChoice(result.cart),
            nextStep: cartNextStep(result.cart),
          }
        }
        case 'cart_remove_item': {
          const lineId = requiredString(input, 'lineId')
          const line = machine.getCart().lines.find(candidate => candidate.id === lineId)
          await announce('從購物車移除餐點', 'cart', {}, onAction)
          const cart = machine.removeFromCart(lineId)
          options.onCartChange(cart)
          return {
            cart,
            customerMessage: line ? `已從購物車移除${line.name}。` : '已從購物車移除餐點。',
            pendingCustomerChoice: pendingCustomerChoice(cart),
            nextStep: cartNextStep(cart),
          }
        }
        case 'cart_set_line_quantity': {
          const lineId = requiredString(input, 'lineId')
          const quantity = requiredNumber(input, 'quantity')
          const line = machine.getCart().lines.find(candidate => candidate.id === lineId)
          await announce(`設定購物車數量為 ${quantity}`, 'cart', {}, onAction)
          const cart = machine.setCartLineQuantity(lineId, quantity)
          options.onCartChange(cart)
          return {
            cart,
            customerMessage: line ? `已將${line.name}調整為 ${quantity} 份。` : '已更新餐點數量。',
            pendingCustomerChoice: pendingCustomerChoice(cart),
            nextStep: cartNextStep(cart),
          }
        }
        case 'cart_set_line_option': {
          const lineId = requiredString(input, 'lineId')
          const groupId = requiredString(input, 'groupId')
          const valueId = requiredString(input, 'valueId')
          const line = machine.getCart().lines.find(candidate => candidate.id === lineId)
          const item = line && machine.getMenu().find(candidate => candidate.id === line.itemId)
          const value = item?.optionGroups.find(group => group.id === groupId)?.values.find(candidate => candidate.id === valueId)
          await announce(`設定購物車餐點為${value?.label ?? '指定選項'}`, 'cart', {}, onAction)
          const result = machine.setCartLineOption(lineId, groupId, valueId)
          options.onCartChange(result.cart)
          return {
            cart: result.cart,
            line: result.line,
            customerMessage: `已將${result.line.name}設定為${value?.label ?? '指定選項'}。`,
            pendingCustomerChoice: pendingCustomerChoice(result.cart),
            nextStep: cartNextStep(result.cart),
          }
        }
        case 'cart_clear': {
          if (input.confirmedByUser !== true)
            throw new Error('Clearing the cart requires confirmedByUser: true.')
          options.checkout?.assertCanRestart()
          await announce('清空購物車', 'cart', {}, onAction)
          const cart = machine.clearCart()
          options.checkout?.restart()
          options.onCartChange(cart)
          options.onMenuSelection(undefined)
          options.onFulfillmentChange?.(undefined)
          return {
            cart,
            customerMessage: '已清空購物車。',
            nextStep: 'The customer can now begin a new order.',
          }
        }
        case 'cart_get': {
          const cart = machine.getCart()
          return {
            cart,
            pendingCustomerChoice: pendingCustomerChoice(cart),
            nextStep: cartNextStep(cart),
          }
        }
        case 'order_set_fulfillment': {
          const mode = requiredFulfillmentMode(input)
          const label = mode === 'dine-in' ? '內用' : '外帶'
          await announce(`設定為${label}`, 'cart', {
            controlId: fulfillmentControlId(mode),
          }, onAction)
          const cart = machine.setFulfillmentMode(mode)
          options.onFulfillmentChange?.(mode)
          options.onCartChange(cart)
          return {
            cart,
            customerMessage: `已設為${label}。`,
            fulfillmentMode: mode,
            nextStep: cartNextStep(cart),
          }
        }
        case 'checkout_start': {
          if (input.confirmedByUser !== true)
            throw new Error('Starting checkout requires confirmedByUser: true.')
          await announce('進入結帳', 'cart', {}, onAction)
          const checkout = checkoutControllerOrThrow(options.checkout).start()
          return {
            checkout,
            customerMessage: '已進入結帳，請顧客掃描會員條碼或選擇略過。',
            nextStep: 'Wait for the customer to scan their membership barcode, or call checkout_skip_membership only when the customer asks to skip it.',
          }
        }
        case 'checkout_skip_membership': {
          if (input.confirmedByUser !== true)
            throw new Error('Skipping membership requires confirmedByUser: true.')
          await announce('略過會員', undefined, {}, onAction)
          const checkout = checkoutControllerOrThrow(options.checkout).skipMembership()
          return { checkout, customerMessage: '已略過會員，請選擇發票方式。' }
        }
        case 'checkout_choose_invoice': {
          const method = requiredInvoiceMethod(input)
          await announce(method === 'carrier' ? '使用雲端載具' : '捐贈發票', undefined, {}, onAction)
          const checkout = checkoutControllerOrThrow(options.checkout).chooseInvoice(method)
          return {
            checkout,
            customerMessage: method === 'carrier' ? '已選擇畫面上的雲端載具。' : '已選擇捐贈發票。',
          }
        }
        case 'checkout_request_tax_id': {
          await announce('輸入統編', undefined, {}, onAction)
          const checkout = checkoutControllerOrThrow(options.checkout).requestTaxId()
          return { checkout, customerMessage: '已開啟統編輸入畫面。' }
        }
        case 'checkout_set_tax_id': {
          const taxId = requiredString(input, 'taxId')
          if (!/^\d{8}$/.test(taxId))
            throw new Error('taxId must contain exactly eight digits.')
          await announce('帶入統編', undefined, {}, onAction)
          const checkout = checkoutControllerOrThrow(options.checkout).setTaxId(taxId)
          return {
            checkout,
            customerMessage: `已帶入統編 ${taxId.split('').join(' ')}，請顧客確認畫面。`,
            nextStep: 'Do not confirm automatically. Call checkout_confirm_tax_id only after the customer says the displayed number is correct.',
          }
        }
        case 'checkout_confirm_tax_id': {
          if (input.confirmedByUser !== true)
            throw new Error('Confirming a tax ID requires confirmedByUser: true.')
          await announce('確認統編', undefined, {}, onAction)
          const checkout = checkoutControllerOrThrow(options.checkout).confirmTaxId()
          return { checkout, customerMessage: '已確認統編，請選擇付款方式。' }
        }
        case 'checkout_select_payment': {
          const method = requiredPaymentMethod(input)
          await announce(method === 'card' ? '選擇信用卡' : '選擇行動支付', undefined, {}, onAction)
          const payment = await checkoutControllerOrThrow(options.checkout).selectPayment(method)
          return {
            customerMessage: payment.customerMessage,
            payment: { method, status: payment.status },
            nextStep: payment.status === 'uncertain'
              ? 'The transaction is locked for staff reconciliation. Do not select another payment method or claim success.'
              : payment.status === 'authorized'
                ? 'The verified payment has already advanced to automatic POS submission. Do not retry payment or submit the order again.'
                : payment.status === 'rejected'
                  ? 'Explain that payment was not completed and ask the customer whether to choose another method.'
                  : 'Wait for the physical payment terminal. Only its verified result may complete the order.',
          }
        }
        case 'checkout_cancel': {
          if (input.confirmedByUser !== true)
            throw new Error('Cancelling checkout requires confirmedByUser: true.')
          await announce('取消結帳', 'cart', {}, onAction)
          checkoutControllerOrThrow(options.checkout).cancel()
          return {
            cart: machine.getCart(),
            customerMessage: '已返回訂單內容，購物車仍保留。',
          }
        }
      }
    }
    finally {
      if (isAgentOperation)
        options.onAgentOperationEnd?.()
    }
  }

  function reset() {
    const cart = machine.reset()
    completedOrderId = undefined
    options.onCartChange(cart)
    options.onMenuSelection(undefined)
    options.onFulfillmentChange?.(undefined)
    return { cart }
  }

  /** Submits only after the customer-facing payment terminal returns its verified transaction ID. */
  async function confirmPaidOrder(paymentId: string) {
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

  /**
   * Registers the runtime's current tools and returns the matching cleanup.
   *
   * A menu page can be remounted by Vite HMR or by an embedding host. Each
   * registration owns an AbortController so stale tool names are removed before
   * a replacement runtime registers the same names.
   */
  async function registerNativeWebMcp(options: { exposedTo?: string[] } = {}) {
    const modelContext = (document as Document & { modelContext?: ModelContextLike }).modelContext
    if (!modelContext?.registerTool)
      return undefined

    nativeRegistration?.abort()
    const controller = new AbortController()
    nativeRegistration = controller

    try {
      await Promise.all(toolDefinitions.map(async (definition) => {
        const { readOnly, ...tool } = definition
        await modelContext.registerTool({
          ...tool,
          annotations: readOnly ? { readOnlyHint: true } : undefined,
          execute: async (input, { signal } = {}) => {
            if (signal?.aborted)
              throw signal.reason ?? new DOMException('Tool execution aborted.', 'AbortError')
            try {
              return await invoke(definition.name, input)
            }
            catch (error) {
              return nativeInvocationFailure(definition.name, error)
            }
          },
        }, { exposedTo: options.exposedTo, signal: controller.signal })
      }))
    }
    catch (error) {
      if (nativeRegistration === controller)
        nativeRegistration = undefined
      controller.abort()
      throw error
    }

    return () => {
      disposeNativeWebMcp(controller)
    }
  }

  /** Releases the active native registration when its document is unmounted. */
  function disposeNativeWebMcp(expectedRegistration = nativeRegistration) {
    if (!expectedRegistration)
      return

    if (nativeRegistration === expectedRegistration)
      nativeRegistration = undefined
    expectedRegistration.abort()
  }

  return { confirmPaidOrder, disposeNativeWebMcp, invoke, registerNativeWebMcp, reset, setMenu: machine.setMenu, toolDefinitions }
}
