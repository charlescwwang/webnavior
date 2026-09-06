import type { CartSnapshot, MenuItem, RecommendationTag, Selection, SubmittedOrder } from './domain/order-machine'

import { errorMessageFrom } from '@moeru/std'

import { catalogInfo, createOrderMachine } from './domain/order-machine'

export type MenuToolName
  = | 'menu_get'
    | 'menu_recommend'
    | 'menu_select_item'
    | 'menu_set_item_option'
    | 'menu_set_quantity'
    | 'cart_add_item'
    | 'cart_remove_item'
    | 'cart_set_line_quantity'
    | 'cart_get'
    | 'order_confirm'

export interface AgentAction {
  controlId?: string
  expandCustomization?: boolean
  label: string
  targetId?: string
}

/** Returns the DOM control identifier used to visually follow an AI option change. */
export function optionControlId(itemId: string, groupId: string, valueId: string) {
  return `${itemId}:option:${groupId}:${valueId}`
}

/** Returns the DOM control identifier used to visually follow an AI quantity change. */
export function quantityControlId(itemId: string) {
  return `${itemId}:quantity`
}

interface MenuToolDefinition {
  description: string
  inputSchema: Record<string, unknown>
  name: MenuToolName
  readOnly?: boolean
}

interface MenuToolRuntimeOptions {
  /** Marks the beginning of a WebMCP-originated operation. */
  onAgentOperationStart?: () => void
  /** Marks the end of a WebMCP-originated operation. */
  onAgentOperationEnd?: () => void
  onAction: (action: AgentAction) => Promise<void> | void
  onCartChange: (cart: CartSnapshot) => void
  onMenuSelection: (itemId: string | undefined) => void
  /** Mirrors the active tool selection into the menu UI. */
  onSelectionChange?: (selection: Selection) => void
  /** Notifies the embedding host after the first successfully confirmed order. */
  onOrderConfirmed?: (order: SubmittedOrder) => void
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
  { name: 'menu_get', description: '依分類或餐點名稱取得可點餐品項與 ID；未帶篩選時取得完整菜單。後續選擇餐點必須使用本工具結果中的 item.id。', inputSchema: { type: 'object', properties: { category: { type: 'string', description: '要查詢的精確分類名稱；未知時省略。' }, query: { type: 'string', description: '顧客說出的餐點名稱或關鍵字；未知時省略。' } }, additionalProperties: false }, readOnly: true },
  { name: 'menu_recommend', description: '依顧客需求推薦最多三項餐點。每個 needs 標籤都必須符合：rice 為飯類、fried 為炸物、pork-free 為已確認不含豬肉。', inputSchema: { type: 'object', properties: { needs: { type: 'array', items: { type: 'string', enum: ['rice', 'fried', 'pork-free'] }, minItems: 1, uniqueItems: true }, limit: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['needs'], additionalProperties: false }, readOnly: true },
  { name: 'menu_select_item', description: '選擇一個餐點並建立可設定的選擇。呼叫前必須先使用 menu_get，並傳入其結果中完全相同的 item.id。', inputSchema: { type: 'object', properties: { itemId: { type: 'string', description: '必要。先前 menu_get 回傳的其中一個 item.id；不得猜測、翻譯或自行建立。' } }, required: ['itemId'], additionalProperties: false } },
  { name: 'menu_set_item_option', description: '設定目前餐點的口味、辣度、甜度或冰量。groupId 與 valueId 必須來自 menu_select_item 回傳的 item.optionGroups。', inputSchema: { type: 'object', properties: { groupId: { type: 'string', description: '必要。已選餐點 optionGroups 中的 group.id。' }, valueId: { type: 'string', description: '必要。該 group.values 中的 value.id。' } }, required: ['groupId', 'valueId'], additionalProperties: false } },
  { name: 'menu_set_quantity', description: '設定目前餐點的數量。只可在 menu_select_item 後、cart_add_item 前使用。', inputSchema: { type: 'object', properties: { quantity: { type: 'integer', minimum: 1, maximum: 20, description: '必要。顧客指定的整數數量；未指定時使用 1。' } }, required: ['quantity'], additionalProperties: false } },
  { name: 'cart_add_item', description: '將目前已設定的餐點加入購物車。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cart_remove_item', description: '從購物車移除一個 cart line。', inputSchema: { type: 'object', properties: { lineId: { type: 'string' } }, required: ['lineId'], additionalProperties: false } },
  { name: 'cart_set_line_quantity', description: '設定購物車中一個餐點的數量。', inputSchema: { type: 'object', properties: { lineId: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } }, required: ['lineId', 'quantity'], additionalProperties: false } },
  { name: 'cart_get', description: '取得目前購物車、品項數與總額。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, readOnly: true },
  { name: 'order_confirm', description: '確認目前訂單。MVP 僅建立模擬訂單，不會送至 POS。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } },
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

/** Builds an LLM-readable retry result instead of allowing browser mediation to hide the validation error. */
function nativeInvocationFailure(name: MenuToolName, error: unknown) {
  const message = errorMessageFrom(error) ?? 'The requested menu operation could not be completed.'
  const recovery = name === 'menu_select_item' && message === 'itemId is required.'
    ? 'First call menu_get. Then call menu_select_item again with itemId set to exactly one item.id returned by menu_get.'
    : 'Check this tool\'s required arguments and the latest menu or cart result, then retry only with valid values.'

  return { ok: false, error: message, recovery }
}

/**
 * Presents one domain interface to native WebMCP and human UI controls. Each
 * mutation announces itself before updating state.
 */
export function createMenuToolRuntime(options: MenuToolRuntimeOptions) {
  const machine = createOrderMachine()
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
        case 'cart_add_item': {
          await announce('加入購物車', 'cart', {}, onAction)
          const result = machine.addToCart()
          options.onCartChange(result.cart)
          return result
        }
        case 'cart_remove_item': {
          const lineId = requiredString(input, 'lineId')
          await announce('從購物車移除餐點', 'cart', {}, onAction)
          const cart = machine.removeFromCart(lineId)
          options.onCartChange(cart)
          return { cart }
        }
        case 'cart_set_line_quantity': {
          const lineId = requiredString(input, 'lineId')
          const quantity = requiredNumber(input, 'quantity')
          await announce(`設定購物車數量為 ${quantity}`, 'cart', {}, onAction)
          const cart = machine.setCartLineQuantity(lineId, quantity)
          options.onCartChange(cart)
          return { cart }
        }
        case 'cart_get':
          return { cart: machine.getCart() }
        case 'order_confirm': {
          if (input.confirmedByUser !== true)
            throw new Error('Order confirmation requires confirmedByUser: true.')
          await announce('確認模擬訂單', 'cart', {}, onAction)
          const order = await machine.confirmOrder()
          if (completedOrderId !== order.id) {
            completedOrderId = order.id
            options.onOrderConfirmed?.(order)
          }
          return {
            interaction: { status: 'completed' },
            order,
            nextStep: '訂單已確認，請勿再次呼叫 order_confirm。',
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
    return { cart }
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

  return { disposeNativeWebMcp, invoke, registerNativeWebMcp, reset, toolDefinitions }
}
