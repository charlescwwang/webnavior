import type { CheckoutSnapshot } from './domain/checkout-flow'

import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it, vi } from 'vitest'

import { beginCheckout, chooseInvoiceMethod, confirmInvoiceDraft, confirmTaxId, requestTaxId, setInvoiceDraft, setTaxIdDraft, skipMembership } from './domain/checkout-flow'
import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

async function setup(code: string, method: 'carrier' | 'citizen' | 'tax-id' = 'carrier') {
  let checkout: CheckoutSnapshot | undefined
  let revision = 0
  const update = (next: CheckoutSnapshot) => {
    revision++
    checkout = next
    return next
  }
  const payment = vi.fn(async () => {
    throw new Error('Invoice confirmation must not select payment')
  })
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'meal', optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, checkout: {
    snapshot: () => checkout,
    revision: () => revision,
    paymentStatus: () => undefined,
    assertCanRestart: () => {},
    restart: () => { checkout = undefined },
    cancel: () => { checkout = undefined },
    start: () => update(beginCheckout('collected')),
    skipMembership: () => update(skipMembership(checkout!)),
    chooseInvoice: method => update(chooseInvoiceMethod(checkout!, method)),
    confirmInvoice: () => update(confirmInvoiceDraft(checkout!)),
    requestTaxId: () => update(requestTaxId(checkout!)),
    setTaxId: value => update(setTaxIdDraft(checkout!, value)),
    confirmTaxId: () => update(confirmTaxId(checkout!)),
    selectPayment: payment,
  } })
  await runtime.invoke('order_add_item', { itemId: 'meal', quantity: 1 })
  await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
  await runtime.invoke('checkout_start', { confirmedByUser: true })
  if (method === 'tax-id')
    await runtime.invoke('checkout_request_tax_id')
  const edit = (code: string) => update(method === 'tax-id' ? setTaxIdDraft(checkout!, code) : setInvoiceDraft(checkout!, method, code))
  edit(code)
  return { runtime, edit, payment, snapshot: () => checkout }
}

const invoiceCases = [
  { method: 'carrier', code: '/PTGRJP2', invalid: '/PT', candidate: 'intent:confirm-invoice', tool: 'checkout_confirm_invoice', field: 'carrierCode' },
  { method: 'citizen', code: 'AB12345678901234', invalid: 'AB123', candidate: 'intent:confirm-invoice', tool: 'checkout_confirm_invoice', field: 'citizenCode' },
  { method: 'tax-id', code: '12345678', invalid: '123', candidate: 'intent:confirm-tax-id', tool: 'checkout_confirm_tax_id', field: 'taxId' },
] as const

// Report: this chat, Nov2; all entered invoice kinds should accept semantic confirmation once.
it.each(invoiceCases.flatMap(entry => ['確認', '送出', '輸入完成', '好了，繼續', '資料沒問題', '就用這個'].map(text => ({ ...entry, text }))))('confirms $method once for $text without selecting payment', async ({ method, code, candidate, tool, field, text }) => {
  const fixture = await setup(code, method)
  const context = await fixture.runtime.invoke('kiosk_fast_path_context', { transcript: text }) as { candidates: Array<{ id: string }> }
  expect(context.candidates.some(choice => choice.id === candidate)).toBe(true)
  const state = parse(conversationContextSchema, await fixture.runtime.invoke('kiosk_conversation_context'))
  expect(state.checkout?.invoiceDraftReady).toBe(true)
  expect(state.allowedToolNames).toContain(tool)
  if (method !== 'tax-id')
    expect(JSON.stringify(state)).not.toContain(code)
  await fixture.runtime.invoke('kiosk_fast_path_execute', { candidateId: candidate })
  expect(fixture.snapshot()).toMatchObject({ stage: 'payment', [field]: code })
  expect(fixture.payment).not.toHaveBeenCalled()
})

it.each(invoiceCases)('does not offer confirmation for invalid $method input', async ({ method, invalid, tool }) => {
  const fixture = await setup(invalid, method)
  const context = parse(conversationContextSchema, await fixture.runtime.invoke('kiosk_conversation_context'))
  expect(context.checkout?.invoiceDraftReady).toBe(false)
  expect(context.allowedToolNames).not.toContain(tool)
})

it.each(invoiceCases)('rejects $method confirmation after edit-and-undo', async ({ method, code, candidate }) => {
  const fixture = await setup(code, method)
  await fixture.runtime.invoke('kiosk_fast_path_context', { transcript: '確認' })
  fixture.edit(method === 'tax-id' ? '87654321' : method === 'citizen' ? 'CD12345678901234' : '/ABC1234')
  fixture.edit(code)
  await expect(fixture.runtime.invoke('kiosk_fast_path_execute', { candidateId: candidate })).rejects.toThrow('STALE_PLAN')
  expect(fixture.snapshot()?.stage).toBe(method === 'tax-id' ? 'tax-id' : 'invoice')
  expect(fixture.payment).not.toHaveBeenCalled()
})

it('does not advertise or execute invoice confirmation with an invalid draft', async () => {
  const fixture = await setup('/PT')
  const state = parse(conversationContextSchema, await fixture.runtime.invoke('kiosk_conversation_context'))
  expect(state.checkout?.invoiceDraftReady).toBe(false)
  expect(state.allowedToolNames).not.toContain('checkout_confirm_invoice')
  await expect(fixture.runtime.invoke('checkout_confirm_invoice', { confirmedByUser: true })).rejects.toThrow('有效發票')
  expect(fixture.snapshot()?.stage).toBe('invoice')
})

// Report: Nov2 live P02-A1; read-only recovery exposed a menu tool rejected by checkout.
it('keeps read-only recovery inside checkout fact tools without reopening recommendations', async () => {
  const fixture = await setup('/PT')
  await fixture.runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'invoice-read', transcript: '確認', expectedMenuRevision: 0, readOnly: true, constraints: {} })
  const state = parse(conversationContextSchema, await fixture.runtime.invoke('kiosk_conversation_context'))
  expect(state.allowedToolNames).toContain('cart_get')
  expect(state.allowedToolNames).not.toContain('menu_recommend')
  expect(state.allowedToolNames).not.toContain('menu_get')
  expect(state.allowedToolNames).not.toContain('checkout_confirm_invoice')
  expect(fixture.snapshot()?.stage).toBe('invoice')
})

// Report: purchase2 I03-C-A3/I04-C-A2/I04-N-A2; edit requests lost uncommitted invoice drafts.
it.each(invoiceCases)('requires a separate return confirmation before discarding a $method draft', async ({ method, code }) => {
  const f = await setup(code, method)
  const before = f.snapshot()
  await f.runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'invoice-edit', transcript: '我要先修改資料', expectedMenuRevision: 0, readOnly: false, constraints: {} })
  const result = await f.runtime.invokeForAgent('checkout_cancel', { confirmedByUser: true })
  expect(result).toMatchObject({ pendingCustomerChoice: { purpose: 'operation-confirmation' } })
  expect(f.snapshot()).toEqual(before)
  expect(await f.runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1 } })
  expect(f.payment).not.toHaveBeenCalled()
})
