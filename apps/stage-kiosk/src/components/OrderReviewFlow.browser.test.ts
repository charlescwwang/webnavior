import type { ComponentPublicInstance } from 'vue'

import type { CartSnapshot, FulfillmentMode } from '../../../order-menu/src/domain/order-machine'
import type { SeatingContext } from '../../../order-menu/src/domain/seating'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import DineInSeating from '../../../order-menu/src/components/DineInSeating.vue'
import OrderReview from '../../../order-menu/src/components/OrderReview.vue'

import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'

describe('fulfillment controls before Agent animation', () => {
  it('registers the visible party-size select before animation and commits the spoken answer only once', async () => {
    const open = shallowRef(false)
    const partySize = shallowRef<number>()
    const controls = new Map<string, HTMLElement>()
    let state: SeatingContext = { revision: 0, choices: [], ready: false }
    let updates = 0
    let nativeChanges = 0
    let releaseAnimation!: () => void
    let announceStarted!: () => void
    const animation = new Promise<void>((resolve) => {
      releaseAnimation = resolve
    })
    const started = new Promise<void>((resolve) => {
      announceStarted = resolve
    })
    const runtime = createMenuToolRuntime({
      onCartChange: () => {},
      onMenuSelection: () => {},
      onReviewRequested: async () => {
        open.value = true
        await nextTick()
      },
      onAction: async (action) => {
        if (action.controlId !== 'seating:party-size')
          return
        const target = controls.get(action.controlId)
        expect(target).toBeInstanceOf(HTMLSelectElement)
        expect(target!.isConnected).toBe(true)
        expect((target as HTMLSelectElement).value).toBe('')
        target!.addEventListener('change', () => nativeChanges++)
        announceStarted()
        await animation
      },
      seating: {
        context: () => state,
        refresh: async () => {},
        release: async () => {},
        reset: async () => {},
        reserve: async () => {},
        setPartySize: async (value) => {
          updates++
          partySize.value = value
          state = { ...state, revision: state.revision + 1, partySize: value }
        },
      },
    })
    const screen = render(defineComponent({ setup: () => () => open.value
      ? h(DineInSeating, {
          snapshot: { revision: 0, tables: [] },
          partySize: partySize.value,
          choices: [],
          busy: false,
          locked: false,
          onRegisterControl: (id: string, element: Element | ComponentPublicInstance | null) => {
            if (element instanceof HTMLElement)
              controls.set(id, element)
            else
              controls.delete(id)
          },
        })
      : h('p', '菜單') }))
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('order_set_fulfillment', { mode: 'dine-in' })
    open.value = false
    await nextTick()
    await runtime.invoke('kiosk_fast_path_context', { transcript: '一位' })
    const execution = runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:set-party-size' })
    await started
    expect(updates).toBe(0)
    await expect.element(screen.getByRole('combobox', { name: '用餐人數' })).toBeVisible()
    releaseAnimation()
    await execution
    await nextTick()
    expect(updates).toBe(1)
    expect(nativeChanges).toBe(0)
    expect((controls.get('seating:party-size') as HTMLSelectElement).value).toBe('1')
  })
  it('returns from the visible cart to the menu without losing its lines', async () => {
    const open = shallowRef(true)
    const runtime = createMenuToolRuntime({
      onCartChange: () => {},
      onAction: () => {},
      onMenuSelection: () => {},
      onMenuRequested: async () => {
        open.value = false
        await nextTick()
      },
    })
    const screen = render(defineComponent({ setup: () => () => h('p', open.value ? '購物車畫面' : '菜單畫面') }))
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    const before = await runtime.invoke('cart_get', { display: false }) as { cart: CartSnapshot }
    await expect.element(screen.getByText('購物車畫面')).toBeVisible()
    const result = await runtime.invoke('menu_open', {})
    await expect.element(screen.getByText('菜單畫面')).toBeVisible()
    expect(result).toMatchObject({ customerMessage: '已回到全部菜單，接下來想看哪一道餐點？' })
    const after = await runtime.invoke('cart_get', { display: false }) as { cart: CartSnapshot }
    expect(after.cart).toEqual(before.cart)
  })
  for (const mode of ['takeout', 'dine-in'] as const) {
    it(`reveals and selects the actual ${mode} control`, async () => {
      const open = shallowRef(false)
      const fulfillment = shallowRef<FulfillmentMode>()
      const cart = shallowRef<CartSnapshot>({ fulfillmentMode: undefined, lines: [], itemCount: 0, total: 0 })
      const controls = new Map<string, HTMLElement>()
      const visibleTargets: string[] = []
      const runtime = createMenuToolRuntime({
        fulfillmentModes: [{ id: 'dine-in', label: '店內用餐' }, { id: 'takeout', label: '門市自取' }],
        onCartChange: (value) => { cart.value = value },
        onMenuSelection: () => {},
        onFulfillmentChange: (value) => { fulfillment.value = value },
        onReviewRequested: async () => {
          open.value = true
          await nextTick()
        },
        onAction: (action) => {
          if (!action.controlId?.startsWith('order:fulfillment:'))
            return
          const target = controls.get(action.controlId)
          expect(target).toBeDefined()
          expect(target!.isConnected).toBe(true)
          expect(target!.classList.contains('is-selected')).toBe(false)
          visibleTargets.push(target!.textContent!.trim())
        },
      })
      const screen = render(defineComponent({
        setup: () => () => open.value
          ? h(OrderReview, {
              fulfillmentMode: fulfillment.value,
              fulfillmentModes: [{ id: 'dine-in', label: '店內用餐' }, { id: 'takeout', label: '門市自取' }],
              completed: false,
              completedLabel: '訂單已確認',
              orderStatus: undefined,
              submissionStatus: undefined,
              seatingReady: true,
              total: String(cart.value.total),
              lines: cart.value.lines.map(line => ({ id: line.id, name: line.name, quantity: line.quantity, options: '', total: '' })),
              onRegisterControl: (id: string, element: Element | ComponentPublicInstance | null) => {
                if (element instanceof HTMLElement)
                  controls.set(id, element)
                else
                  controls.delete(id)
              },
            })
          : h('p', '菜單'),
      }))
      await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
      expect(screen.container.querySelector('.review-fulfillment')).toBeNull()
      await runtime.invoke('order_set_fulfillment', { mode })
      await nextTick()
      expect(visibleTargets).toEqual([mode === 'takeout' ? '門市自取' : '店內用餐'])
      await expect.element(screen.getByRole('button', { name: mode === 'takeout' ? '門市自取' : '店內用餐', exact: true })).toHaveClass('is-selected')
    })
  }
})
