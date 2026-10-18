import type { MenuItem } from '../../../order-menu/src/domain/order-machine'

import { errorMessageFrom } from '@moeru/std'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, readonly, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import zhHant from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import MenuItemCard from '../../../order-menu/src/components/menuItemCard.vue'
import MenuSimulationPanel from './menuSimulationPanel.vue'

import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'

describe('operator-controlled page availability', () => {
  it('keeps operator state, customer cards and selection failure on the same runtime', async () => {
    const items = shallowRef<MenuItem[]>([
      { id: 'fish', name: '泰式酸辣魚便當', category: '便當', description: '測試餐點', price: 130, imageUrl: '', recommendationTags: [], optionGroups: [] },
      { id: 'dumplings', name: '水餃', category: '點心', description: '測試餐點', price: 80, imageUrl: '', recommendationTags: [], optionGroups: [] },
    ])
    const message = shallowRef('')
    const runtime = createMenuToolRuntime({ menu: items.value, testing: true, onMenuChanged: value => items.value = value, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invokeManual('order_add_item', { itemId: 'dumplings', quantity: 1 })
    const tools = readonly(shallowRef(runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' }))))
    const bridge = { tools, availability: shallowRef<'ready'>('ready'), execute: async (tool: { name: string }, input: Record<string, unknown>) => runtime.invoke(runtime.toolDefinitions.find(definition => definition.name === tool.name)!.name, input) }
    const screen = render(defineComponent({
      setup: () => () => h('div', [
        h(MenuSimulationPanel, { bridge }),
        h(MenuItemCard, { item: items.value[0]!, isTargeted: false, onSelect: async (itemId: string) => {
          try {
            await runtime.invokeManual('menu_select_item', { itemId })
          }
          catch (error) {
            message.value = errorMessageFrom(error) ?? ''
          }
        } }),
        h('p', { role: 'status' }, message.value),
      ]),
    }), { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
    try {
      await screen.getByRole('button', { name: '售完', exact: true }).click()
      await expect.element(screen.getByRole('button', { name: '泰式酸辣魚便當，今日售完', exact: true })).toBeDisabled()
      await screen.getByRole('button', { name: '狀態不明', exact: true }).click()
      await expect.element(screen.getByRole('button', { name: '泰式酸辣魚便當，暫時無法確認', exact: true })).toBeDisabled()
      await screen.getByRole('button', { name: '可點', exact: true }).click()
      await expect.element(screen.getByRole('button', { name: '查看泰式酸辣魚便當', exact: true })).toBeEnabled()
      await screen.getByRole('button', { name: '選取時失敗', exact: true }).click()
      await screen.getByRole('button', { name: '查看泰式酸辣魚便當', exact: true }).click()
      await expect.element(screen.getByRole('status')).toHaveTextContent('目前無法選取泰式酸辣魚便當')
      await expect.element(screen.getByRole('button', { name: '泰式酸辣魚便當，暫時無法確認', exact: true })).toBeDisabled()
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'dumplings' }] } })
    }
    finally {
      screen.unmount()
    }
  })
})
