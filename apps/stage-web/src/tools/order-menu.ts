import type { Tool } from '@xsai/shared-chat'

import { tool } from '@xsai/tool'
import { z } from 'zod'

import { orderMenuBridge } from '../services/order-menu-bridge'

const toolDescription = '操作獨立點餐菜單。每個動作會在使用者可見的菜單畫面高亮並顯示 AIRI 指標。訂單確認前必須先取得使用者明確同意。'

/** Creates structured ordering tools backed by the independent menu WebMCP service. */
export async function createOrderMenuTools(): Promise<Tool[]> {
  return await Promise.all([
    tool({ name: 'menu_get', description: `${toolDescription} 取得菜單。`, parameters: z.object({ category: z.string().optional() }).strict(), execute: async args => await orderMenuBridge.call('menu_get', args) }),
    tool({ name: 'menu_select_item', description: `${toolDescription} 選擇餐點。`, parameters: z.object({ itemId: z.string() }).strict(), execute: async args => await orderMenuBridge.call('menu_select_item', args) }),
    tool({ name: 'menu_set_item_option', description: `${toolDescription} 設定目前餐點的選項。`, parameters: z.object({ groupId: z.string(), valueId: z.string() }).strict(), execute: async args => await orderMenuBridge.call('menu_set_item_option', args) }),
    tool({ name: 'menu_set_quantity', description: `${toolDescription} 設定目前餐點數量。`, parameters: z.object({ quantity: z.number().int().min(1).max(20) }).strict(), execute: async args => await orderMenuBridge.call('menu_set_quantity', args) }),
    tool({ name: 'cart_add_item', description: `${toolDescription} 將目前設定的餐點加入購物車。`, parameters: z.object({}).strict(), execute: async args => await orderMenuBridge.call('cart_add_item', args) }),
    tool({ name: 'cart_remove_item', description: `${toolDescription} 移除購物車品項。`, parameters: z.object({ lineId: z.string() }).strict(), execute: async args => await orderMenuBridge.call('cart_remove_item', args) }),
    tool({ name: 'cart_get', description: `${toolDescription} 取得目前購物車。`, parameters: z.object({}).strict(), execute: async args => await orderMenuBridge.call('cart_get', args) }),
    tool({ name: 'order_confirm', description: `${toolDescription} 僅能在使用者已明確說要送出後呼叫；MVP 不會送往 POS。`, parameters: z.object({ confirmedByUser: z.literal(true) }).strict(), execute: async args => await orderMenuBridge.call('order_confirm', args) }),
  ])
}

export const orderMenuToolsetPrompt = `點餐時先使用 menu_get 取得可用 itemId，再依序呼叫 menu_select_item、menu_set_item_option、menu_set_quantity、cart_add_item。每個餐點都必須先完成 cart_add_item 才能選擇下一項。每次 cart_add_item 成功後，必須立刻以面向顧客的自然繁體中文確認已加入的餐點與規格；若還有下一項，再繼續處理。完成所有餐點後，呼叫 cart_get 並以文字或語音向使用者展示購物車摘要和詢問是否送出訂單。呼叫 order_confirm 前，必須取得明確同意。工具成功後不得只停止在工具結果，必須繼續回覆顧客。`
