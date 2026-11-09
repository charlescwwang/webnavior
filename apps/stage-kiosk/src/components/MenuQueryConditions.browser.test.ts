import type { QueryView } from '../../../order-menu/src/domain/browsing'

import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'

import MenuItemCard from '../../../order-menu/src/components/menuItemCard.vue'
import MenuQueryConditions from '../../../order-menu/src/components/menuQueryConditions.vue'

import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { createMenuReplyWindow } from '../services/questionPresentation'

// Report: this chat Nov7; visible filters must remove only the chosen real condition.
it('regression K1107-FILTER keeps the visible conditions and actual Menu state synchronized', async () => {
  const state = shallowRef<QueryView>()
  const runtime = createMenuToolRuntime({ menu: [
    { id: 'fish', name: '檸檬蒸魚飯', price: 130, ingredient: 'fish' },
    { id: 'chicken', name: '香烤雞腿飯', price: 140, ingredient: 'chicken' },
  ].map(({ ingredient, ...item }) => ({ ...item, category: '主餐', description: '', imageUrl: '', recommendationTags: [], optionGroups: [], composition: { ingredients: [ingredient], complete: true, source: 'merchant', revision: '1', removals: [] } })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onQueryStateChange: value => state.value = value })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['fish'], excludeIngredients: ['pork'], maxPrice: 150 })
  const Harness = defineComponent({ setup: () => () => h(MenuQueryConditions, { state: state.value, locked: false, onRemove: (condition, revision) => runtime.removeQueryCondition(condition, revision) }) })
  const screen = render(Harness)
  try {
    await expect.element(screen.getByText('想吃：魚', { exact: true })).toBeVisible()
    await screen.getByRole('button', { name: '移除條件：想吃：魚', exact: true }).click()
    await expect.element(screen.getByText('想吃：魚', { exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByText('不含：豬肉', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('不超過 150元', { exact: true })).toBeVisible()
    await runtime.reset()
    await expect.element(screen.getByRole('region', { name: '已選條件' })).not.toBeInTheDocument()
  }
  finally {
    screen.unmount()
  }
})

// Report: this chat Nov7; fuzzy candidates are displayed and spoken as unconfirmed choices.
it('regression K1107-FUZZY shows the same actual candidate in the cards and verified reply', async () => {
  const menu = [
    { id: 'pork', name: '打拋豬便當' },
    { id: 'chicken', name: '椒麻雞便當' },
  ].map(item => ({ ...item, price: 100, category: '主餐', description: '', imageUrl: '', optionGroups: [], recommendationTags: [] }))
  const shown = shallowRef<string[]>([])
  const replies = createMenuReplyWindow()
  const runtime = createMenuToolRuntime({ menu, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: presentation => shown.value = presentation.itemIds })
  const receipt = await runtime.invokeForAgent('menu_get', { query: '打拋牛便當' })
  replies.record('menu_get', receipt)
  const Harness = defineComponent({ setup: () => () => h('section', [h('p', { role: 'status' }, replies.reply()), ...menu.filter(item => shown.value.includes(item.id)).map(item => h(MenuItemCard, { key: item.id, item, isTargeted: false }))]) })
  const screen = render(Harness)
  try {
    await expect.element(screen.getByRole('status')).toHaveTextContent('您想找的是打拋豬便當嗎？')
    await expect.element(screen.getByRole('heading', { name: '打拋豬便當', exact: true })).toBeVisible()
    expect(replies.needsClarification()).toBe(true)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  }
  finally {
    screen.unmount()
  }
})

// Report: this chat, Nov09 — the grid changed while the condition strip kept the earlier query.
it('renders fresh category and ingredient conditions from the same runtime as the menu result', async () => {
  const state = shallowRef<QueryView>()
  const runtime = createMenuToolRuntime({ menu: [
    { id: 'fish', name: '魚飯', category: '飯', ingredient: 'fish' },
    { id: 'pork', name: '豬肉麵', category: '麵', ingredient: 'pork' },
  ].map(({ ingredient, ...item }) => ({ ...item, description: '', imageUrl: '', price: 100, aliases: [], optionGroups: [], recommendationTags: [], composition: { ingredients: [ingredient], complete: true, source: 'merchant', revision: '1', removals: [] } })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: () => {}, onQueryStateChange: value => state.value = value })
  const Harness = defineComponent({ setup: () => () => h(MenuQueryConditions, { state: state.value, locked: false }) })
  const screen = render(Harness)
  try {
    await runtime.invoke('menu_recommend', { action: 'update', includeIngredients: ['fish'] })
    await expect.element(screen.getByText('想吃：魚', { exact: true })).toBeVisible()
    expect(await runtime.invoke('menu_get', { category: '麵', display: true })).toHaveProperty('items', [expect.objectContaining({ id: 'pork' })])
    await expect.element(screen.getByText('麵', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('想吃：魚', { exact: true })).not.toBeInTheDocument()
    expect(runtime.getQueryState()?.conditions).toHaveLength(1)
    await runtime.invoke('menu_get', { includeIngredients: ['pork'], display: true })
    await expect.element(screen.getByText('想吃：豬肉', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('麵', { exact: true })).not.toBeInTheDocument()
    expect(runtime.getQueryState()?.conditions).toHaveLength(1)
  }
  finally {
    screen.unmount()
  }
})
