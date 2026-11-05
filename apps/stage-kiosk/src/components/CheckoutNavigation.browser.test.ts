import type { ComponentPublicInstance } from 'vue'

import type { CheckoutSnapshot } from '../../../order-menu/src/domain/checkout-flow'
import type { CartSnapshot } from '../../../order-menu/src/domain/order-machine'

import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import CheckoutInvoice from '../../../order-menu/src/components/CheckoutInvoice.vue'
import OrderReview from '../../../order-menu/src/components/OrderReview.vue'

import { beginCheckout, chooseInvoiceMethod, confirmInvoiceDraft, confirmTaxId, requestTaxId, setTaxIdDraft, skipMembership } from '../../../order-menu/src/domain/checkout-flow'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'

// Report: this chat, Nov2 14:56–14:58; open-cart and change-to-takeout confirmation.
// This fixture owns the same checkout > review > menu precedence as App.vue;
// the actual Invoice/Review components own control registration and rendering.
it.each(['confirm', 'cancel', 'return', 'cart'] as const)('updates the visible order surface for %s without selecting invoice or losing meals', async (action) => {
  const checkout = shallowRef<CheckoutSnapshot>()
  const review = shallowRef(false)
  const cart = shallowRef<CartSnapshot>({ fulfillmentMode: undefined, lines: [], total: 0, itemCount: 0 })
  const controls = new Map<string, HTMLElement>()
  const modes = [{ id: 'dine-in' as const, label: '內用' }, { id: 'takeout' as const, label: '自取' }]
  let revision = 0
  let checking = false
  const animated: string[] = []
  const update = (next: CheckoutSnapshot) => {
    checkout.value = next
    revision++
    return next
  }
  const register = (id: string, element: Element | ComponentPublicInstance | null) => {
    if (element instanceof HTMLElement)
      controls.set(id, element)
    else
      controls.delete(id)
  }
  const runtime = createMenuToolRuntime({
    screen: () => checkout.value ? 'checkout' : review.value ? 'cart_review' : 'menu',
    onMenuSelection: () => {},
    onCartChange: value => cart.value = value,
    onReviewRequested: async () => {
      if (!checkout.value)
        review.value = true
      await nextTick()
    },
    onAction: async ({ controlId }) => {
      if (!checking || !controlId)
        return
      animated.push(controlId)
      const target = controls.get(controlId)
      expect(target).toBeInstanceOf(HTMLElement)
      expect(target!.isConnected).toBe(true)
      expect(target!.getBoundingClientRect().height).toBeGreaterThan(0)
    },
    checkout: {
      snapshot: () => checkout.value,
      revision: () => revision,
      paymentStatus: () => undefined,
      assertCanRestart: () => {},
      restart: () => { checkout.value = undefined },
      cancel: async () => {
        checkout.value = undefined
        revision++
        review.value = true
        await nextTick()
      },
      start: () => update(beginCheckout('collected')),
      skipMembership: () => update(skipMembership(checkout.value!)),
      chooseInvoice: method => update(chooseInvoiceMethod(checkout.value!, method)),
      confirmInvoice: () => update(confirmInvoiceDraft(checkout.value!)),
      requestTaxId: () => update(requestTaxId(checkout.value!)),
      setTaxId: code => update(setTaxIdDraft(checkout.value!, code)),
      confirmTaxId: () => update(confirmTaxId(checkout.value!)),
      selectPayment: async () => { throw new Error('Navigation never selects payment') },
    },
  })
  const view = render(defineComponent({ setup: () => () => checkout.value
    ? h(CheckoutInvoice, { checkout: checkout.value, total: '$145', onRegisterControl: register })
    : review.value
      ? h(OrderReview, { completed: false, completedLabel: '', fulfillmentMode: cart.value.fulfillmentMode, fulfillmentModes: modes, seatingReady: true, lines: cart.value.lines.map(line => ({ id: line.id, name: line.name, options: '', quantity: line.quantity, total: '$145' })), orderStatus: undefined, submissionStatus: undefined, total: '$145', onRegisterControl: register })
      : h('button', { ref: element => register('order:view', element) }, '查看訂單') }))
  try {
    await runtime.invokeManual('order_add_item', { itemId: 'chous-shrimp-roll', quantity: 1 })
    await runtime.invokeManual('order_set_fulfillment', { mode: 'dine-in' })
    if (action !== 'cart')
      await runtime.invokeManual('checkout_start', { confirmedByUser: true })
    else
      review.value = false
    await nextTick()
    checking = true
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'navigation-1', transcript: action === 'cart' ? '幫我打開購物車' : action === 'return' ? '回到訂單頁面' : '我要自取', expectedMenuRevision: 0, readOnly: action === 'cart', constraints: {} })
    await runtime.invoke('kiosk_conversation_context')
    if (action === 'cart') {
      await runtime.invokeForAgent('cart_get', { display: true })
    }
    else if (action === 'return') {
      await runtime.invokeForAgent('checkout_cancel', { confirmedByUser: true })
    }
    else {
      const result = await runtime.invokeForAgent('order_set_fulfillment', { mode: 'takeout' }) as { customerMessage: string, pendingConfirmation: { confirmationId: string }, pendingCustomerChoice: { questionId: string } }
      expect(checkout.value?.stage).toBe('invoice')
      expect(cart.value.fulfillmentMode).toBe('dine-in')
      await runtime.invoke('kiosk_dialogue_presented', { content: result.customerMessage, questionId: result.pendingCustomerChoice.questionId, interruptsQuestion: true })
      await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'navigation-1' })
      await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'navigation-2', transcript: action === 'confirm' ? '確認' : '取消', expectedMenuRevision: 0, constraints: {} })
      const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
      expect(context.allowedToolNames).not.toContain('checkout_choose_invoice')
      await runtime.invokeForAgent('order_answer_confirmation', { confirmationId: result.pendingConfirmation.confirmationId, confirmedByUser: action === 'confirm' })
    }
    await nextTick()
    expect(cart.value.itemCount).toBe(1)
    expect(cart.value.fulfillmentMode).toBe(action === 'confirm' ? 'takeout' : 'dine-in')
    if (action === 'cancel') {
      expect(checkout.value?.stage).toBe('invoice')
      expect(checkout.value?.invoiceMethod).toBeUndefined()
      expect(animated).toEqual([])
      await expect.element(view.getByRole('textbox', { name: '手機條碼' })).toBeVisible()
    }
    else {
      expect(checkout.value).toBeUndefined()
      await expect.element(view.getByRole('heading', { name: '訂單內容' })).toBeVisible()
      expect(animated).toEqual(action === 'confirm' ? ['checkout:cancel', 'order:fulfillment:takeout'] : action === 'return' ? ['checkout:cancel'] : ['order:view'])
    }
  }
  finally { view.unmount() }
})
