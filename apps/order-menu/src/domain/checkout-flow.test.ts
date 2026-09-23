import { describe, expect, it } from 'vitest'

import { beginCheckout, chooseInvoiceMethod, confirmTaxId, requestTaxId, returnToInvoice, setTaxIdDraft, skipMembership } from './checkout-flow'

describe('checkout flow', () => {
  it('moves a customer who skips membership from scanning to payment', () => {
    const checkout = skipMembership(beginCheckout())

    expect(checkout).toEqual({ stage: 'invoice' })
  })

  it('does not allow membership to be skipped after payment begins', () => {
    expect(() => skipMembership({ stage: 'payment' }))
      .toThrow('Membership can only be skipped')
  })

  it('requires a valid tax ID before entering payment', () => {
    const invoice = skipMembership(beginCheckout())
    const taxId = requestTaxId(invoice)
    expect(() => confirmTaxId(setTaxIdDraft(taxId, '123'))).toThrow('valid eight-digit')
    expect(confirmTaxId(setTaxIdDraft(taxId, '12345678'))).toMatchObject({ invoiceMethod: 'tax-id', stage: 'payment', taxId: '12345678' })
  })

  it('can donate an invoice without a carrier', () => {
    expect(chooseInvoiceMethod(skipMembership(beginCheckout()), 'donation')).toMatchObject({ invoiceMethod: 'donation', stage: 'payment' })
  })

  it('does not allow an Agent to select a carrier that was never physically scanned', () => {
    expect(() => chooseInvoiceMethod(skipMembership(beginCheckout()), 'carrier')).toThrow('after the customer scans')
  })

  it('keeps a tax ID draft visible until confirmation and clears it when returning', () => {
    const taxId = setTaxIdDraft(requestTaxId(skipMembership(beginCheckout())), '12345678')

    expect(taxId).toMatchObject({ invoiceMethod: 'tax-id', stage: 'tax-id', taxId: '12345678' })
    expect(returnToInvoice(taxId)).toEqual({ invoiceMethod: undefined, stage: 'invoice' })
  })
})
