import type { ComponentPublicInstance } from 'vue'

import type { CheckoutSnapshot } from '../../../order-menu/src/domain/checkout-flow'
import type { PaymentMethod } from '../../../order-menu/src/pos-bridge'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import CheckoutInvoice from '../../../order-menu/src/components/CheckoutInvoice.vue'
import CheckoutPayment from '../../../order-menu/src/components/CheckoutPayment.vue'
import CheckoutTaxId from '../../../order-menu/src/components/CheckoutTaxId.vue'
import OrderReview from '../../../order-menu/src/components/OrderReview.vue'

import { beginCheckout, chooseInvoiceMethod, confirmInvoiceDetails, confirmInvoiceDraft, confirmTaxId, requestTaxId, setInvoiceDraft, setTaxIdDraft, skipMembership } from '../../../order-menu/src/domain/checkout-flow'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'

describe('visible checkout actions', () => {
  // Report: this chat, 2026-10-19 — checkout voice actions change state without visible button animation.
  it.each(['carrier', 'citizen', 'donation', 'tax-id', 'tax-id-skip'] as const)('targets connected controls before committing the %s flow once', async (flow) => {
    const checkout = shallowRef<CheckoutSnapshot>()
    const review = shallowRef(false)
    const paymentMethod = shallowRef<PaymentMethod>()
    const controls = new Map<string, HTMLElement>()
    const events: string[] = []
    let checking = false
    let writes = 0
    let nativeClicks = 0
    let revision = 0
    const update = (next: CheckoutSnapshot) => {
      writes++
      revision++
      checkout.value = next
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
      onCartChange: () => {},
      onReviewRequested: async () => {
        events.push('review')
        review.value = true
        await nextTick()
      },
      onAction: async (action) => {
        if (!checking)
          return
        events.push(action.controlId ?? 'missing target')
        const target = controls.get(action.controlId ?? '')
        expect(target).toBeInstanceOf(HTMLElement)
        expect(target!.isConnected).toBe(true)
        expect(target!.getBoundingClientRect().height).toBeGreaterThan(0)
        if (target instanceof HTMLButtonElement)
          expect(target.disabled).toBe(false)
        target!.addEventListener('click', () => nativeClicks++)
        const before = writes
        const previous = checkout.value
        // Yield across an actual browser frame, as the production cursor does.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        expect(writes).toBe(before)
        expect(checkout.value).toBe(previous)
      },
      checkout: {
        snapshot: () => checkout.value,
        revision: () => revision,
        paymentStatus: () => undefined,
        assertCanRestart: () => {},
        restart: () => { checkout.value = undefined },
        start: () => update(beginCheckout('collected')),
        skipMembership: () => update(skipMembership(checkout.value!)),
        chooseInvoice: method => update(chooseInvoiceMethod(checkout.value!, method)),
        requestTaxId: () => update(requestTaxId(checkout.value!)),
        setTaxId: taxId => update(setTaxIdDraft(checkout.value!, taxId)),
        confirmInvoice: () => update(confirmInvoiceDraft(checkout.value!)),
        confirmTaxId: () => update(confirmTaxId(checkout.value!)),
        selectPayment: async (method: PaymentMethod) => {
          // Exercise the local QR surface without a payment gateway.
          paymentMethod.value = method
          writes++
          return { status: 'selected', customerMessage: 'test only' }
        },
        cancel: () => {
          writes++
          checkout.value = undefined
        },
      },
    })
    const view = render(defineComponent({ setup: () => () => {
      const shared = { onRegisterControl: register }
      if (checkout.value?.stage === 'invoice')
        return h(CheckoutInvoice, { ...shared, checkout: checkout.value, total: '$130', onDraft: (method, code) => update(setInvoiceDraft(checkout.value!, method, code)), onDetails: (method, code) => update(confirmInvoiceDetails(checkout.value!, method, code)) })
      if (checkout.value?.stage === 'tax-id')
        return h(CheckoutTaxId, { ...shared, taxId: checkout.value.taxId ?? '', onUpdateTaxId: value => update(setTaxIdDraft(checkout.value!, value)) })
      if (checkout.value?.stage === 'payment')
        return h(CheckoutPayment, { ...shared, method: paymentMethod.value, total: '$130' })
      if (review.value)
        return h(OrderReview, { ...shared, completed: false, completedLabel: '', fulfillmentMode: 'takeout', fulfillmentModes: [], seatingReady: true, lines: [{ id: 'line', name: '餐點', options: '', quantity: 1, total: '$130' }], orderStatus: undefined, submissionStatus: undefined, total: '$130' })
      return h('button', { ref: element => register('order:view', element) }, '查看訂單')
    } }))
    await runtime.invokeManual('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invokeManual('order_set_fulfillment', { mode: 'takeout' })
    review.value = false
    await nextTick()
    events.length = 0
    checking = true
    await runtime.invoke('checkout_start', { confirmedByUser: true })
    await nextTick()
    expect(events).toEqual(['order:view', 'review', 'checkout:start'])
    expect(writes).toBe(1)
    if (flow === 'carrier' || flow === 'citizen') {
      if (flow === 'citizen') {
        await runtime.invoke('checkout_choose_invoice', { method: 'citizen' })
        await nextTick()
      }
      const code = flow === 'carrier' ? '/PTGRJP2' : 'AB12345678901234'
      await view.getByRole('textbox', { name: flow === 'carrier' ? '手機條碼' : '自然人憑證條碼' }).fill(code)
      expect(checkout.value?.stage).toBe('invoice')
      await runtime.invoke('kiosk_fast_path_context', { transcript: '資料沒問題' })
      await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:confirm-invoice' })
      expect(flow === 'carrier' ? checkout.value?.carrierCode : checkout.value?.citizenCode).toBe(code)
      expect(checkout.value?.stage).toBe('payment')
      expect(writes).toBe(flow === 'carrier' ? 3 : 4)
    }
    else if (flow === 'donation') {
      await runtime.invoke('checkout_choose_invoice', { method: 'carrier' })
      await nextTick()
      await runtime.invoke('checkout_choose_invoice', { method: 'citizen' })
      await nextTick()
      await runtime.invoke('checkout_choose_invoice', { method: 'donation' })
      expect(writes).toBe(4)
    }
    else {
      await runtime.invoke('checkout_request_tax_id')
      await nextTick()
      await view.getByRole('textbox', { name: '統一編號' }).fill('12345678')
      await nextTick()
      expect((controls.get('checkout:tax-id:value') as HTMLInputElement).value).toBe('12345678')
      if (flow === 'tax-id-skip') {
        await runtime.invoke('checkout_choose_invoice', { method: 'donation' })
      }
      else {
        await runtime.invoke('kiosk_fast_path_context', { transcript: '送出' })
        await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:confirm-tax-id' })
      }
      expect(writes).toBe(4)
    }
    await nextTick()
    await runtime.invoke('checkout_select_payment', { method: 'linepay' })
    await nextTick()
    await runtime.invoke('checkout_select_payment', { method: 'jkopay' })
    await nextTick()
    expect(paymentMethod.value).toBe('jkopay')
    expect(writes).toBe(flow === 'carrier' ? 5 : 6)
    await runtime.invoke('checkout_cancel', { confirmedByUser: true })
    await nextTick()
    expect(writes).toBe(flow === 'carrier' ? 6 : 7)
    expect(nativeClicks).toBe(0)
    expect(checkout.value).toBeUndefined()
    expect(controls.has('checkout:payment:linepay')).toBe(false)
    view.unmount()
  })
  it('keeps tax-ID skip, return-to-order and previous-page touch actions distinct', async () => {
    const actions: string[] = []
    const view = render(defineComponent({ setup: () => () => h(CheckoutTaxId, {
      taxId: '12345678',
      onDonation: () => actions.push('donation'),
      onCancel: () => actions.push('cancel'),
      onBack: () => actions.push('back'),
    }) }))
    await view.getByRole('button', { name: '略過，捐贈發票' }).click()
    expect(actions).toEqual(['donation'])
    await view.getByRole('button', { name: '返回訂單內容，保留餐點' }).click()
    expect(actions).toEqual(['donation', 'cancel'])
    await view.getByRole('button', { name: '返回上一頁' }).click()
    expect(actions).toEqual(['donation', 'cancel', 'back'])
  })

  it.each(['pending', 'uncertain', 'authorized'] as const)('locks cancellation and hides payment choices while %s', async (status) => {
    const controls = new Map<string, Element | ComponentPublicInstance | null>()
    const view = render(defineComponent({ setup: () => () => h(CheckoutPayment, {
      total: '$130',
      status,
      onRegisterControl: (id: string, element: Element | ComponentPublicInstance | null) => controls.set(id, element),
    }) }))
    await expect.element(view.getByRole('button', { name: '返回訂單內容，保留餐點' })).toBeDisabled()
    await expect.element(view.getByRole('button', { name: '返回上一頁' })).toBeDisabled()
    expect(controls.get('checkout:cancel')).toBeInstanceOf(HTMLButtonElement)
    expect(controls.has('checkout:payment:linepay')).toBe(false)
    expect(controls.has('checkout:payment:jkopay')).toBe(false)
  })
})
