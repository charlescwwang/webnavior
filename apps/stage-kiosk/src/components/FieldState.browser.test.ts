import type { ComponentPublicInstance } from 'vue'

import type { CartSnapshot, FulfillmentMode, MenuItem } from '../../../order-menu/src/domain/order-machine'

import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import MenuItemCard from '../../../order-menu/src/components/menuItemCard.vue'
import OrderReview from '../../../order-menu/src/components/OrderReview.vue'

import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'

// Report: docs/plans/2026-10-22-kiosk-field-investigation.md, single meal → others → full menu.
it('replaces the real visible dish cards with the complete catalog and snapshots the rendered IDs', async () => {
  const dishes: MenuItem[] = Array.from({ length: 7 }, (_, index) => ({ id: `dish-${index}`, name: index === 0 ? '排骨便當' : `餐點${index}`, category: index < 4 ? '便當' : '點心', description: '測試餐點', price: 80, imageUrl: '', recommendationTags: [], optionGroups: [] }))
  const visible = shallowRef<string[]>([])
  const runtime = createMenuToolRuntime({
    menu: dishes,
    onAction: () => {},
    onCartChange: () => {},
    onMenuSelection: () => {},
    visibleItemIds: () => visible.value,
    onRecommendationsChange: async (result) => {
      visible.value = result.itemIds
      await nextTick()
    },
  })
  const screen = render(defineComponent({ setup: () => () => h('div', visible.value.map(id => h(MenuItemCard, { key: id, item: dishes.find(item => item.id === id)!, isTargeted: false }))) }))
  await runtime.invokeForAgent('menu_get', { query: '排骨便當', display: true })
  expect(screen.container.querySelectorAll('.menu-card')).toHaveLength(1)
  await runtime.invokeForAgent('menu_recommend', { action: 'continue' })
  await runtime.invokeForAgent('menu_get', { scope: 'catalog', display: true })
  for (const dish of dishes)
    await expect.element(screen.getByRole('button', { name: `查看${dish.name}`, exact: true })).toBeVisible()
  expect(await runtime.invoke('kiosk_conversation_context')).toMatchObject({ presentation: { itemIds: dishes.map(item => item.id), queries: [] }, cart: { itemCount: 0 } })
})

// Report: same investigation, seq137/349/371; check actual selected DOM after each change.
it('animates each exact fulfillment control and keeps repeated changes aligned with the cart and snapshot', async () => {
  const cart = shallowRef<CartSnapshot>({ fulfillmentMode: undefined, lines: [], itemCount: 0, total: 0 })
  const controls = new Map<string, HTMLElement>()
  const targets: string[] = []
  const modes = [{ id: 'dine-in' as const, label: '內用' }, { id: 'takeout' as const, label: '自取' }]
  const runtime = createMenuToolRuntime({
    onCartChange: value => cart.value = value,
    onMenuSelection: () => {},
    screen: () => 'cart_review',
    onReviewRequested: async () => { await nextTick() },
    onAction: (action) => {
      if (!action.controlId?.startsWith('order:fulfillment:'))
        return
      const target = controls.get(action.controlId)
      expect(target?.isConnected).toBe(true)
      targets.push(action.controlId)
    },
  })
  const screen = render(defineComponent({ setup: () => () => h(OrderReview, {
    lines: cart.value.lines.map(line => ({ id: line.id, name: line.name, quantity: line.quantity, options: '', total: '' })),
    fulfillmentModes: modes,
    fulfillmentMode: cart.value.fulfillmentMode,
    completed: false,
    completedLabel: '',
    orderStatus: undefined,
    submissionStatus: undefined,
    seatingReady: true,
    total: String(cart.value.total),
    onRegisterControl: (id: string, element: Element | ComponentPublicInstance | null) => {
      if (element instanceof HTMLElement)
        controls.set(id, element)
      else
        controls.delete(id)
    },
  }) }))
  await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
  for (const mode of ['dine-in', 'takeout', 'dine-in', 'takeout'] as FulfillmentMode[]) {
    await runtime.invokeForAgent('order_set_fulfillment', { mode })
    await nextTick()
    await expect.element(screen.getByRole('button', { name: modes.find(choice => choice.id === mode)!.label, exact: true })).toHaveClass('is-selected')
    expect(cart.value.fulfillmentMode).toBe(mode)
    expect(await runtime.invoke('kiosk_conversation_context')).toMatchObject({ cart: { fulfillmentMode: mode } })
  }
  expect(targets).toEqual(['order:fulfillment:dine-in', 'order:fulfillment:takeout', 'order:fulfillment:dine-in', 'order:fulfillment:takeout'])
})
