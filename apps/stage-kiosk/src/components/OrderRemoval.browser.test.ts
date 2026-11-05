import type { ComponentPublicInstance } from 'vue'

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import OrderReview from '../../../order-menu/src/components/OrderReview.vue'

import { cartRemovalControlId, createMenuToolRuntime } from '../../../order-menu/src/webmcp'

describe('visible cart removal through the real Menu runtime', () => {
  it('targets the registered line control once and returns to the menu after removal', async () => {
    const review = shallowRef(false)
    const lines = shallowRef<Array<{ id: string, name: string, options: string, quantity: number, total: string }>>([])
    const controls = new Map<string, Element | ComponentPublicInstance>()
    const remove = vi.fn()
    const animated: string[] = []
    const runtime = createMenuToolRuntime({
      screen: () => review.value ? 'cart_review' : 'menu',
      onReviewRequested: async () => {
        review.value = true
        await nextTick()
      },
      onMenuRequested: () => { review.value = false },
      onMenuSelection: () => {},
      onCartChange: cart => lines.value = cart.lines.map(line => ({ id: line.id, name: line.name, quantity: line.quantity, options: '', total: String(line.unitPrice * line.quantity) })),
      onAction: async (action) => {
        if (!action.controlId?.startsWith('cart:remove:'))
          return
        const target = controls.get(action.controlId)
        expect(target).toBeInstanceOf(HTMLButtonElement)
        if (!(target instanceof HTMLButtonElement))
          throw new Error('Expected a registered removal button')
        expect(target.isConnected).toBe(true)
        expect(target.disabled).toBe(false)
        animated.push(action.controlId)
      },
    })
    const screen = render(defineComponent({ setup: () => () => review.value
      ? h(OrderReview, { lines: lines.value, total: '75', fulfillmentModes: [], fulfillmentMode: undefined, completed: false, seatingReady: false, completedLabel: '', orderStatus: undefined, submissionStatus: undefined, onRemove: remove, onRegisterControl: (id, element) => {
          if (element)
            controls.set(id, element)
          else
            controls.delete(id)
        } })
      : h('p', '菜單畫面') }))
    const added = await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' }) as { line: { id: string } }
    await runtime.invoke('cart_remove_item', { lineId: added.line.id })
    expect(animated).toEqual([cartRemovalControlId(added.line.id)])
    expect(remove).not.toHaveBeenCalled()
    await expect.element(screen.getByText('菜單畫面')).toBeVisible()
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })
})
