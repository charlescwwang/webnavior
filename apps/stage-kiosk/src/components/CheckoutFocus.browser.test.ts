import type { CheckoutSnapshot } from '../../../order-menu/src/domain/checkout-flow'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import CheckoutInvoice from '../../../order-menu/src/components/CheckoutInvoice.vue'
import CheckoutTaxId from '../../../order-menu/src/components/CheckoutTaxId.vue'

import { chooseInvoiceMethod } from '../../../order-menu/src/domain/checkout-flow'

describe('checkout scanner focus', () => {
  // Report: this chat, 2026-10-19 — scanners need a focused field without a preliminary touch.
  it('receives keyboard-wedge scans on entry and after switching or reselecting an invoice option', async () => {
    const checkout = shallowRef<CheckoutSnapshot>({ stage: 'invoice' })
    const view = render(defineComponent({ setup: () => () => h(CheckoutInvoice, {
      checkout: checkout.value,
      total: '$130',
      onChoose: method => checkout.value = chooseInvoiceMethod(checkout.value, method),
    }) }))
    await nextTick()
    const carrier = view.getByRole('textbox', { name: '手機條碼', exact: true })
    expect(document.activeElement).toBe(carrier.element())
    await userEvent.keyboard('/ABC1234')
    await expect.element(carrier).toHaveValue('/ABC1234')
    await view.getByRole('button', { name: '自然人憑證', exact: true }).click()
    const citizen = view.getByRole('textbox', { name: '自然人憑證條碼', exact: true })
    expect(document.activeElement).toBe(citizen.element())
    await userEvent.keyboard('AB12345678901234')
    await expect.element(citizen).toHaveValue('AB12345678901234')
    await view.getByRole('button', { name: '手機載具', exact: true }).click()
    expect(document.activeElement).toBe(carrier.element())
    await view.getByRole('button', { name: '手機載具', exact: true }).click()
    expect(document.activeElement).toBe(carrier.element())
  })

  it('waits for Agent control to end before focusing the newly selected invoice field', async () => {
    const locked = shallowRef(true)
    const checkout = shallowRef<CheckoutSnapshot>({ stage: 'invoice' })
    const view = render(defineComponent({ setup: () => () => h('div', [
      h('button', '其他控制項'),
      h('main', { inert: locked.value }, [h(CheckoutInvoice, { checkout: checkout.value, locked: locked.value, total: '$130' })]),
    ]) }))
    await view.getByRole('button', { name: '其他控制項' }).click()
    const previous = document.activeElement
    checkout.value = { stage: 'invoice', invoiceMethod: 'citizen' }
    await nextTick()
    expect(document.activeElement).toBe(previous)
    locked.value = false
    await nextTick()
    const field = view.getByRole('textbox', { name: '自然人憑證條碼', exact: true })
    expect(document.activeElement).toBe(field.element())
    await userEvent.keyboard('AB12345678901234')
    await expect.element(field).toHaveValue('AB12345678901234')
    locked.value = true
    await nextTick()
    locked.value = false
    await nextTick()
    expect(document.activeElement).toBe(field.element())
    await expect.element(field).toHaveValue('AB12345678901234')
  })

  it('accepts a tax-ID scan, retains keypad editing, and restores focus after unlock', async () => {
    const taxId = shallowRef('')
    const locked = shallowRef(false)
    let confirmations = 0
    const view = render(defineComponent({ setup: () => () => h('main', { inert: locked.value }, [h(CheckoutTaxId, {
      taxId: taxId.value,
      locked: locked.value,
      onUpdateTaxId: value => taxId.value = value,
      onConfirm: () => confirmations++,
    })]) }))
    await nextTick()
    const field = view.getByRole('textbox', { name: '統一編號', exact: true })
    expect(document.activeElement).toBe(field.element())
    await userEvent.keyboard('12345678{Enter}')
    expect(taxId.value).toBe('12345678')
    await expect.element(field).toHaveValue('12345678')
    expect(confirmations).toBe(0)
    await view.getByRole('button', { name: '清除', exact: true }).click()
    expect(taxId.value).toBe('')
    expect(document.activeElement).toBe(field.element())
    await view.getByRole('button', { name: '1', exact: true }).click()
    expect(taxId.value).toBe('1')
    expect(document.activeElement).toBe(field.element())
    locked.value = true
    await nextTick()
    taxId.value = '87654321'
    await nextTick()
    expect(document.activeElement).not.toBe(field.element())
    locked.value = false
    await nextTick()
    expect(document.activeElement).toBe(field.element())
    await expect.element(field).toHaveValue('87654321')
    await view.getByRole('button', { name: '確認統編', exact: true }).click()
    expect(confirmations).toBe(1)
  })
})
