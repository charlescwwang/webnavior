import type { ComponentPublicInstance } from 'vue'

import type { CartSnapshot, MenuItem, Selection } from '../../../order-menu/src/domain/order-machine'

import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import MenuItemDialog from '../../../order-menu/src/components/MenuItemDialog.vue'
import OrderReview from '../../../order-menu/src/components/OrderReview.vue'

import { createControlExecution } from '../../../order-menu/src/controlExecution'
import { addItemControlId, cartRemovalControlId, closeItemControlId, createMenuToolRuntime, optionControlId, quantityStepControlId } from '../../../order-menu/src/webmcp'
import { createKioskUtteranceQueue } from '../services/kioskUtteranceQueue'

// Report: this chat, Nov08; visible cursor presses never dispatched UI clicks.
it.each([{ id: 'rice', name: '雞肉飯', category: '飯', price: 95 }, { id: 'noodles', name: '蔬菜麵', category: '麵', price: 120 }])('clicks actual controls once, including decreases and close, under the Agent lock: $name', async ({ id: itemId, name, category, price }) => {
  const menu: MenuItem[] = [{ id: itemId, name, category, description: '', imageUrl: '', price, optionGroups: [], recommendationTags: [] }]
  const controls = new Map<string, HTMLElement>()
  const clicks: string[] = []
  const visible = shallowRef<string>()
  const selection = shallowRef<Selection>()
  const cart = shallowRef<CartSnapshot>({ fulfillmentMode: undefined, itemCount: 0, total: 0, lines: [] })
  const review = shallowRef(false)
  const adapter = createControlExecution({ resolve: id => controls.get(id), animate: async () => {
    await nextTick()
  } })
  const runtime = createMenuToolRuntime({ menu, onAction: () => {}, onControl: adapter.execute, onCartChange: next => cart.value = next, onSelectionChange: next => selection.value = next, onMenuSelection: id => visible.value = id, onReviewRequested: () => {
    review.value = true
  }, onMenuRequested: () => {
    review.value = false
  }, screen: () => review.value ? 'cart_review' : visible.value ? 'item_configuration' : 'menu', visibleItemId: () => visible.value })
  function register(id: string, element: Element | ComponentPublicInstance | null) {
    if (element instanceof HTMLElement)
      controls.set(id, element)
    else
      controls.delete(id)
  }
  function act(id: string) {
    clicks.push(id)
    return adapter.handle(id, () => {
      throw new Error('An Agent click must not enter the manual write path.')
    })
  }
  const Harness = defineComponent({ setup: () => () => h('main', { inert: true }, [
    h('button', { ref: element => register(`item:${itemId}`, element), onClick: () => act(`item:${itemId}`) }, name),
    h('button', { ref: element => register('order:view', element), onClick: () => act('order:view') }, '查看訂單'),
    h(MenuItemDialog, { locked: true, item: visible.value ? menu[0] : undefined, quantity: selection.value?.quantity ?? 1, selectedOptions: selection.value?.options ?? {}, onRegisterControl: register, onClose: () => act(closeItemControlId(itemId)), onAdd: () => act(addItemControlId(itemId)), onUpdateQuantity: quantity => act(quantityStepControlId(itemId, quantity > (selection.value?.quantity ?? 1) ? 'increase' : 'decrease')), onUpdateOption: (group, value) => act(optionControlId(itemId, group, value)) }),
    review.value
      ? h(OrderReview, { fulfillmentModes: [], completed: false, fulfillmentMode: undefined, orderStatus: undefined, submissionStatus: undefined, total: String(cart.value.total), completedLabel: '', seatingReady: true, lines: cart.value.lines.map(line => ({ id: line.id, name: line.name, options: '', quantity: line.quantity, total: String(line.unitPrice * line.quantity) })), onRegisterControl: register, onBack: () => act('order:back'), onRemove: id => act(cartRemovalControlId(id)), onUpdateQuantity: (id, quantity) => act(quantityStepControlId(id, quantity > cart.value.lines.find(line => line.id === id)!.quantity ? 'increase' : 'decrease', true)) })
      : undefined,
  ]) })
  const view = render(Harness)
  try {
    await runtime.invoke('menu_select_item', { itemId })
    await runtime.invoke('menu_set_quantity', { quantity: 3 })
    await runtime.invoke('menu_set_quantity', { quantity: 1 })
    expect(selection.value?.quantity).toBe(1)
    expect(clicks.filter(id => id === quantityStepControlId(itemId, 'increase'))).toHaveLength(2)
    expect(clicks.filter(id => id === quantityStepControlId(itemId, 'decrease'))).toHaveLength(2)
    await runtime.invoke('cart_add_item')
    expect(cart.value.itemCount).toBe(1)
    expect(clicks.filter(id => id === addItemControlId(itemId))).toHaveLength(1)
    const id = cart.value.lines[0]!.id
    await runtime.invoke('cart_set_line_quantity', { lineId: id, quantity: 3 })
    await runtime.invoke('cart_set_line_quantity', { lineId: id, quantity: 1 })
    expect(cart.value.itemCount).toBe(1)
    expect(clicks.filter(control => control === quantityStepControlId(id, 'decrease', true))).toHaveLength(2)
    await runtime.invoke('cart_remove_item', { lineId: id })
    expect(cart.value.itemCount).toBe(0)
    await runtime.invoke('kiosk_fast_path_context', { transcript: name })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    // The real close handler consumes a draft cancellation, not a second cart write.
    const context = await runtime.invoke('kiosk_conversation_context') as { retainedRequests: Array<{ id: string }> }
    await runtime.invoke('order_cancel_request', { requestId: context.retainedRequests[0]!.id })
    expect(visible.value).toBeUndefined()
    expect(clicks).toContain(closeItemControlId(itemId))
  }
  finally {
    adapter.dispose()
    view.unmount()
  }
})

// Report: this chat, Nov09 — a queued third dish was absent from the previous two-dish grid and locked ordering.
it('reveals a queued new dish before its actual click after a two-dish addition', async () => {
  const menu: MenuItem[] = [
    { id: 'pork', name: '排骨便當' },
    { id: 'noodles', name: '牛肉麵' },
    { id: 'signature', name: '招牌便當' },
  ].map(item => ({ ...item, category: '主餐', description: '', imageUrl: '', price: 100, aliases: [], optionGroups: [], recommendationTags: [] }))
  const controls = new Map<string, HTMLElement>()
  const clicks: string[] = []
  const grid = shallowRef(menu.map(item => item.id))
  const visible = shallowRef<string>()
  const selection = shallowRef<Selection>()
  const adapter = createControlExecution({ resolve: id => controls.get(id), animate: async () => {
    await nextTick()
  } })
  const runtime = createMenuToolRuntime({ menu, onAction: () => {}, onControl: adapter.execute, onCartChange: () => {}, onSelectionChange: next => selection.value = next, onMenuSelection: id => visible.value = id, visibleItemId: () => visible.value, visibleItemIds: () => [...grid.value], screen: () => visible.value ? 'item_configuration' : 'menu', onRecommendationsChange: async (presentation) => {
    grid.value = presentation.itemIds
    await nextTick()
  } })
  function register(id: string, element: Element | ComponentPublicInstance | null) {
    if (element instanceof HTMLElement)
      controls.set(id, element)
    else
      controls.delete(id)
  }
  function act(id: string) {
    clicks.push(id)
    return adapter.handle(id, () => {
      throw new Error('Expected an authorized visible click')
    })
  }
  const Harness = defineComponent({ setup: () => () => h('main', [
    ...menu.filter(item => grid.value.includes(item.id)).map(item => h('button', { key: item.id, ref: element => register(`item:${item.id}`, element), onClick: () => act(`item:${item.id}`) }, item.name)),
    h(MenuItemDialog, { locked: true, item: menu.find(item => item.id === visible.value), quantity: selection.value?.quantity ?? 1, selectedOptions: {}, onRegisterControl: register, onClose: () => act(closeItemControlId(visible.value!)), onAdd: () => act(addItemControlId(visible.value!)) }),
  ]) })
  const view = render(Harness)
  try {
    let releaseFirst!: () => void
    let firstStarted!: () => void
    const waiting = new Promise<void>(resolve => releaseFirst = resolve)
    const started = new Promise<void>(resolve => firstStarted = resolve)
    const errors: unknown[] = []
    const queue = createKioskUtteranceQueue({ onError: (_utterance, error) => errors.push(error), process: async (utterance) => {
      if (utterance.id === 1) {
        await runtime.invoke('menu_get', { queries: ['排骨便當', '牛肉麵'], display: true })
        firstStarted()
        await waiting
        await runtime.invokeForAgent('order_add_item', { itemId: 'pork', quantity: 1 })
        await runtime.invokeForAgent('order_add_item', { itemId: 'noodles', quantity: 1 })
        expect(grid.value).toEqual(['pork', 'noodles'])
      }
      else {
        await runtime.invoke('kiosk_fast_path_context', { transcript: utterance.text })
        await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
      }
    } })
    queue.submit({ source: 'simulation', text: '一份排骨便當、一碗牛肉麵' })
    await started
    queue.submit({ source: 'simulation', text: '再一份招牌便當' })
    releaseFirst()
    await queue.idle()
    expect(errors).toEqual([])
    expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 3)
    expect(clicks.filter(id => id === 'item:signature')).toHaveLength(1)
    expect(clicks.filter(id => id === addItemControlId('signature'))).toHaveLength(1)
    expect(visible.value).toBeUndefined()
  }
  finally {
    adapter.dispose()
    view.unmount()
  }
})
