import type { ComponentPublicInstance } from 'vue'

import type { CartSnapshot, MenuItem, Selection } from '../../../order-menu/src/domain/order-machine'

import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import MenuItemDialog from '../../../order-menu/src/components/MenuItemDialog.vue'
import OrderReview from '../../../order-menu/src/components/OrderReview.vue'

import { createControlExecution } from '../../../order-menu/src/controlExecution'
import { addItemControlId, cartRemovalControlId, closeItemControlId, createMenuToolRuntime, optionControlId, quantityStepControlId } from '../../../order-menu/src/webmcp'

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
