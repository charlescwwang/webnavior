import type { MenuItem } from '../../../order-menu/src/domain/order-machine'

import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'

import MenuItemDialog from '../../../order-menu/src/components/MenuItemDialog.vue'

it('requires an explicit customer option before enabling add', async () => {
  const item: MenuItem = { id: 'dumplings', name: '水餃', category: '點心', description: '', imageUrl: '', price: 80, recommendationTags: [], optionGroups: [{ id: 'pieces', label: '每份顆數', required: true, values: [{ id: '15', label: '15顆', priceDelta: 40 }] }] }
  const selectedOptions = shallowRef<Record<string, string>>({})
  const screen = render(defineComponent({ setup: () => () => h(MenuItemDialog, {
    item,
    quantity: 1,
    selectedOptions: selectedOptions.value,
    onUpdateOption: (group: string, value: string) => { selectedOptions.value = { [group]: value } },
  }) }))
  const add = screen.getByRole('button', { name: '加入購物車' })
  await expect.element(add).toBeDisabled()
  await screen.getByRole('button', { name: /15顆/ }).click()
  await expect.element(add).toBeEnabled()
})
