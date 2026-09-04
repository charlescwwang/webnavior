import type { CartSnapshot, MenuItem, RecommendationTag } from './domain/order-machine'

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

/** Host-only command. It deliberately is not registered as an agent-facing WebMCP tool. */
export type MenuBridgeCommand = MenuToolName | 'scenario_reset'

/** Portable manifest read by any AIRI-compatible scenario host. */
export interface ScenarioManifest {
  agentPrompt: string
  id: string
  session?: {
    reset?: { args?: Record<string, unknown>, name: string }
  }
  title: string
  tools: Array<{
    description: string
    inputSchema: Record<string, unknown>
    name: string
  }>
}

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

interface ModelContextLike {
  registerTool: (tool: {
    name: string
    description: string
    inputSchema: Record<string, unknown>
    annotations?: { readOnlyHint?: boolean }
    exposedTo?: string[]
    execute: (input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>
  }) => Promise<unknown>
}

const toolDefinitions: MenuToolDefinition[] = [
  { name: 'menu_get', description: '依分類或餐點名稱取得可點餐品項與 ID；未帶篩選時取得完整菜單。', inputSchema: { type: 'object', properties: { category: { type: 'string' }, query: { type: 'string' } }, additionalProperties: false }, readOnly: true },
  { name: 'menu_recommend', description: '依顧客需求推薦最多三項餐點。每個 needs 標籤都必須符合：rice 為飯類、fried 為炸物、pork-free 為已確認不含豬肉。', inputSchema: { type: 'object', properties: { needs: { type: 'array', items: { type: 'string', enum: ['rice', 'fried', 'pork-free'] }, minItems: 1, uniqueItems: true }, limit: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['needs'], additionalProperties: false }, readOnly: true },
  { name: 'menu_select_item', description: '選擇一個餐點並建立可設定的選擇。', inputSchema: { type: 'object', properties: { itemId: { type: 'string' } }, required: ['itemId'], additionalProperties: false } },
  { name: 'menu_set_item_option', description: '設定目前餐點的口味、辣度、甜度或冰量。', inputSchema: { type: 'object', properties: { groupId: { type: 'string' }, valueId: { type: 'string' } }, required: ['groupId', 'valueId'], additionalProperties: false } },
  { name: 'menu_set_quantity', description: '設定目前餐點的數量。', inputSchema: { type: 'object', properties: { quantity: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['quantity'], additionalProperties: false } },
  { name: 'cart_add_item', description: '將目前已設定的餐點加入購物車。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cart_remove_item', description: '從購物車移除一個 cart line。', inputSchema: { type: 'object', properties: { lineId: { type: 'string' } }, required: ['lineId'], additionalProperties: false } },
  { name: 'cart_set_line_quantity', description: '設定購物車中一個餐點的數量。', inputSchema: { type: 'object', properties: { lineId: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } }, required: ['lineId', 'quantity'], additionalProperties: false } },
  { name: 'cart_get', description: '取得目前購物車、品項數與總額。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, readOnly: true },
  { name: 'order_confirm', description: '確認目前訂單。MVP 僅建立模擬訂單，不會送至 POS。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } },
]

/**
 * Restaurant-specific configuration served to the generic kiosk host.
 *
 * Other interactive applications provide the same shape with their own tools
 * and prompt; AIRI does not need to import or understand their domain model.
 */
export const menuScenarioManifest: ScenarioManifest = {
  id: 'restaurant-ordering',
  title: '菜單與目前訂單',
  tools: toolDefinitions.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  session: { reset: { name: 'scenario_reset' } },
  agentPrompt: `你是餐飲點餐服務員。只在顧客詢問菜單、尋找餐點、點餐、修改購物車或確認訂單時使用菜單工具。

菜單呈現規則：
- 絕不可朗讀、列出或介紹完整菜單、所有分類或全部品項；不要主動報菜名清單。
- 顧客只說「想看菜單」時，簡短請對方說想看的類型或餐點；即使已取得完整菜單，也不可直接完整朗讀。
- 依餐點名稱時使用 menu_get 的 query；依類型時使用 category。只介紹與問題直接相關、最多三個品項。
- 不得虛構品項、價格、規格、優惠、庫存或訂單狀態。
- 顧客提出情境或飲食需求時，使用 menu_recommend；可組合 rice（飯類）、fried（炸物）與 pork-free（已確認不含豬肉）。每個條件皆須符合；若沒有結果，明確說明目前沒有可確認符合的餐點。

點餐規則：
- 先用 menu_get 取得正確 itemId，再使用 menu_select_item。
- 一次只處理一個餐點。選定後讀取該餐點的 optionGroups；顧客尚未說明的每個客製化選項，必須一次只問一題、等待回答，再設定 menu_set_item_option。不可擅自以預設值替顧客決定口味、辣度、甜度、冰量、醬料、配料或份量。
- 顧客已明確提供的客製化可直接設定；其餘選項全部確認後，數量未說明時以一份處理，然後呼叫 menu_set_quantity 與 cart_add_item。完成一項才可處理下一項。
- 每次 cart_add_item 成功後，立刻用自然繁體中文確認「已加入」的餐點、規格與數量，然後詢問是否還要加點；不可停在工具結果或只說正在處理。
- 全部餐點完成後，呼叫 cart_get，以精簡摘要說明購物車與總額，並詢問是否確認送出。只有顧客明確說「確認」、「送出訂單」或「可以下單」時，才可呼叫 order_confirm。
- order_confirm 是模擬訂單，需如實說明尚未送往 POS。

回覆規則：
- 每一次工具呼叫成功後都必須繼續以顧客看得懂的文字回覆。
- 不可提及 Tool、API、WebMCP、JSON、系統重新整理、重置、重啟或任何內部技術細節。`,
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

/**
 * Presents one domain interface to native WebMCP, the iframe bridge, and
 * human UI controls. Each mutation announces itself before updating state.
 */
export function createMenuToolRuntime(options: {
  onAction: (action: AgentAction) => Promise<void> | void
  onCartChange: (cart: CartSnapshot) => void
  onMenuSelection: (itemId: string | undefined) => void
}) {
  const machine = createOrderMachine()

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
        return {
          item: item ? menuItemForAgent(item) : undefined,
          selection: machine.selectMenuItem(itemId),
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
        return { selection: machine.setItemOption(groupId, valueId) }
      }
      case 'menu_set_quantity': {
        const quantity = requiredNumber(input, 'quantity')
        const itemId = machine.getSelection()?.itemId
        await announce(`設定數量為 ${quantity}`, itemId, {
          controlId: itemId ? quantityControlId(itemId) : undefined,
        }, onAction)
        return { selection: machine.setQuantity(quantity) }
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
        return { order: await machine.confirmOrder() }
      }
    }
  }

  function reset() {
    const cart = machine.reset()
    options.onCartChange(cart)
    options.onMenuSelection(undefined)
    return { cart }
  }

  async function registerNativeWebMcp(options: { exposedTo?: string[] } = {}) {
    const modelContext = (document as Document & { modelContext?: ModelContextLike }).modelContext
    if (!modelContext?.registerTool)
      return false

    await Promise.all(toolDefinitions.map(async (definition) => {
      const { readOnly, ...tool } = definition
      await modelContext.registerTool({
        ...tool,
        annotations: readOnly ? { readOnlyHint: true } : undefined,
        exposedTo: options.exposedTo,
        execute: async (input, signal) => {
          if (signal.aborted)
            throw signal.reason ?? new DOMException('Tool execution aborted.', 'AbortError')
          return await invoke(definition.name, input)
        },
      })
    }))
    return true
  }

  return { invoke, registerNativeWebMcp, reset, toolDefinitions }
}

export interface MenuBridgeCall {
  args: Record<string, unknown>
  name: MenuBridgeCommand
  requestId: string
  source: 'airi-scenario-bridge'
  type: 'scenario:call'
}

export interface MenuBridgeResult {
  error?: string
  requestId: string
  result?: unknown
  source: 'airi-scenario-bridge'
  type: 'scenario:result'
}

export interface MenuBridgeEvent {
  event: 'activity' | 'completed'
  source: 'airi-scenario-bridge'
  type: 'scenario:event'
}
