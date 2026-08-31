import type { CartSnapshot, MenuItem } from './domain/order-machine'

import { catalogInfo, createOrderMachine } from './domain/order-machine'

export type MenuToolName
  = | 'menu_get'
    | 'menu_select_item'
    | 'menu_set_item_option'
    | 'menu_set_quantity'
    | 'cart_add_item'
    | 'cart_remove_item'
    | 'cart_get'
    | 'order_confirm'

export interface AgentAction {
  expandCustomization?: boolean
  label: string
  targetId?: string
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
  { name: 'menu_get', description: '取得可點餐的菜單與品項 ID。', inputSchema: { type: 'object', properties: { category: { type: 'string' } }, additionalProperties: false }, readOnly: true },
  { name: 'menu_select_item', description: '選擇一個餐點並建立可設定的選擇。', inputSchema: { type: 'object', properties: { itemId: { type: 'string' } }, required: ['itemId'], additionalProperties: false } },
  { name: 'menu_set_item_option', description: '設定目前餐點的口味、辣度、甜度或冰量。', inputSchema: { type: 'object', properties: { groupId: { type: 'string' }, valueId: { type: 'string' } }, required: ['groupId', 'valueId'], additionalProperties: false } },
  { name: 'menu_set_quantity', description: '設定目前餐點的數量。', inputSchema: { type: 'object', properties: { quantity: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['quantity'], additionalProperties: false } },
  { name: 'cart_add_item', description: '將目前已設定的餐點加入購物車。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cart_remove_item', description: '從購物車移除一個 cart line。', inputSchema: { type: 'object', properties: { lineId: { type: 'string' } }, required: ['lineId'], additionalProperties: false } },
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
 * Presents one domain interface to native WebMCP, the iframe bridge, and
 * human UI controls. Each mutation announces itself before updating state.
 */
export function createMenuToolRuntime(options: {
  onAction: (action: AgentAction) => Promise<void> | void
  onCartChange: (cart: CartSnapshot) => void
  onMenuSelection: (itemId: string | undefined) => void
}) {
  const machine = createOrderMachine()

  async function announce(label: string, targetId?: string, expandCustomization = false) {
    await options.onAction({
      label,
      targetId,
      ...(expandCustomization ? { expandCustomization: true } : {}),
    })
  }

  async function invoke(name: MenuToolName, input: Record<string, unknown> = {}) {
    switch (name) {
      case 'menu_get':
        return {
          catalog: catalogInfo,
          items: machine.getMenu(typeof input.category === 'string' ? input.category : undefined),
        }
      case 'menu_select_item': {
        const itemId = requiredString(input, 'itemId')
        const item = machine.getMenu().find(candidate => candidate.id === itemId) as MenuItem | undefined
        await announce(`正在選擇${item?.name ?? '餐點'}`, itemId)
        options.onMenuSelection(itemId)
        return { selection: machine.selectMenuItem(itemId) }
      }
      case 'menu_set_item_option': {
        const groupId = requiredString(input, 'groupId')
        const valueId = requiredString(input, 'valueId')
        const selection = machine.getSelection()
        const item = selection && machine.getMenu().find(candidate => candidate.id === selection.itemId)
        const value = item?.optionGroups.find(group => group.id === groupId)?.values.find(candidate => candidate.id === valueId)
        await announce(`設定為${value?.label ?? '指定選項'}`, item?.id, true)
        return { selection: machine.setItemOption(groupId, valueId) }
      }
      case 'menu_set_quantity': {
        const quantity = requiredNumber(input, 'quantity')
        await announce(`設定數量為 ${quantity}`, machine.getSelection()?.itemId)
        return { selection: machine.setQuantity(quantity) }
      }
      case 'cart_add_item': {
        await announce('加入購物車', 'cart')
        const result = machine.addToCart()
        options.onCartChange(result.cart)
        return result
      }
      case 'cart_remove_item': {
        const lineId = requiredString(input, 'lineId')
        await announce('從購物車移除餐點', 'cart')
        const cart = machine.removeFromCart(lineId)
        options.onCartChange(cart)
        return { cart }
      }
      case 'cart_get':
        return { cart: machine.getCart() }
      case 'order_confirm': {
        if (input.confirmedByUser !== true)
          throw new Error('Order confirmation requires confirmedByUser: true.')
        await announce('確認模擬訂單', 'cart')
        return { order: await machine.confirmOrder() }
      }
    }
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

  return { invoke, registerNativeWebMcp, toolDefinitions }
}

export interface MenuBridgeCall {
  args: Record<string, unknown>
  name: MenuToolName
  requestId: string
  source: 'airi-order-bridge'
  type: 'order:call'
}

export interface MenuBridgeResult {
  error?: string
  requestId: string
  result?: unknown
  source: 'airi-order-bridge'
  type: 'order:result'
}
