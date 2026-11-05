import { describe, expect, it } from 'vitest'

import { beginCheckout, chooseInvoiceMethod, confirmInvoiceDetails, confirmInvoiceDraft, confirmTaxId, identifyMembership, invoiceDraftReady, requestTaxId, returnToPreviousStep, setInvoiceDraft, setTaxIdDraft, skipMembership } from './checkout-flow'

describe('checkout flow', () => {
  // Report: this chat, Nov2; entered carrier + 確認／送出 did not advance.
  it('keeps input as a draft until explicit confirmation and rejects partial input', () => {
    const draft = setInvoiceDraft(beginCheckout('collected'), 'carrier', '/PTGRJP2')
    expect(draft.stage).toBe('invoice')
    expect(draft.carrierCode).toBeUndefined()
    expect(invoiceDraftReady(draft)).toBe(true)
    expect(confirmInvoiceDraft(draft)).toMatchObject({ stage: 'payment', carrierCode: '/PTGRJP2' })
    const partial = setInvoiceDraft(draft, 'carrier', '/PT')
    expect(invoiceDraftReady(partial)).toBe(false)
    expect(() => confirmInvoiceDraft(partial)).toThrow('手機條碼')
    expect(chooseInvoiceMethod(partial, 'carrier').stage).toBe('invoice')
    expect(invoiceDraftReady(chooseInvoiceMethod(draft, 'citizen'))).toBe(false)
    expect(invoiceDraftReady(chooseInvoiceMethod(draft, 'donation'))).toBe(false)
  })

  it('moves a customer who skips membership from scanning to payment', () => {
    const checkout = skipMembership(beginCheckout())

    expect(checkout).toEqual({ stage: 'invoice' })
  })

  it('does not allow membership to be skipped after payment begins', () => {
    expect(() => skipMembership({ stage: 'payment' }))
      .toThrow('Membership can only be skipped')
  })

  it('keeps the customer-facing membership number visible after a physical scan', () => {
    const checkout = identifyMembership(beginCheckout(), ' M-102938 ', '/ABCD12')

    expect(checkout).toEqual({
      carrierCode: '/ABCD12',
      membershipNumber: 'M-102938',
      stage: 'invoice',
    })
  })

  it('rejects a membership scan without a customer-facing number', () => {
    expect(() => identifyMembership(beginCheckout(), '  '))
      .toThrow('customer-facing membership number')
  })

  it('requires a valid tax ID before entering payment', () => {
    const invoice = skipMembership(beginCheckout())
    const taxId = requestTaxId(invoice)
    expect(() => confirmTaxId(setTaxIdDraft(taxId, '123'))).toThrow('valid eight-digit')
    expect(confirmTaxId(setTaxIdDraft(taxId, '12345678'))).toMatchObject({ invoiceMethod: 'tax-id', stage: 'payment', taxId: '12345678' })
  })

  it('skips invoice identifiers and enters payment when the customer chooses donation', () => {
    const checkout = chooseInvoiceMethod(beginCheckout('collected'), 'donation')
    expect(checkout.stage).toBe('payment')
    expect(checkout.invoiceMethod).toBe('donation')
    expect(checkout.donationCode).toBeUndefined()
  })

  it('clears previously entered personal invoice details when switching to donation', () => {
    const carrier = confirmInvoiceDetails(beginCheckout('collected'), 'carrier', '/ABC1234')
    const taxId = setTaxIdDraft(requestTaxId(returnToPreviousStep(carrier)!), '12345678')
    const donation = chooseInvoiceMethod(taxId, 'donation')
    expect(donation.stage).toBe('payment')
    expect(donation.invoiceMethod).toBe('donation')
    expect(donation.carrierCode).toBeUndefined()
    expect(donation.citizenCode).toBeUndefined()
    expect(donation.taxId).toBeUndefined()
    expect(donation.donationCode).toBeUndefined()
  })

  it('does not allow an Agent to select a carrier that was never physically scanned', () => {
    expect(chooseInvoiceMethod(skipMembership(beginCheckout()), 'carrier')).toMatchObject({ invoiceMethod: 'carrier', stage: 'invoice' })
  })

  it('supports citizen and mobile carriers only after validating the visible input', () => {
    const draft = beginCheckout('collected')
    expect(() => confirmInvoiceDetails(draft, 'carrier', '/123')).toThrow('手機條碼')
    expect(() => confirmInvoiceDetails(draft, 'citizen', 'AB123')).toThrow('自然人憑證')
    expect(confirmInvoiceDetails(draft, 'carrier', '/ABC1234')).toMatchObject({ carrierCode: '/ABC1234', stage: 'payment' })
    expect(confirmInvoiceDetails(draft, 'citizen', 'AB12345678901234')).toMatchObject({ citizenCode: 'AB12345678901234', stage: 'payment' })
  })

  it('returns from tax ID entry to invoice selection without losing the draft', () => {
    const taxId = setTaxIdDraft(requestTaxId(skipMembership(beginCheckout())), '12345678')

    expect(taxId).toMatchObject({ invoiceMethod: 'tax-id', stage: 'tax-id', taxId: '12345678' })
    const invoice = returnToPreviousStep(taxId)!
    expect(invoice).toEqual({ invoiceMethod: undefined, stage: 'invoice', taxId: '12345678' })
    expect(requestTaxId(invoice).taxId).toBe('12345678')
  })

  it('returns from payment to the confirmed invoice details for editing', () => {
    const payment = confirmInvoiceDetails(beginCheckout('collected'), 'carrier', '/ABC1234')
    const invoice = returnToPreviousStep(payment)!

    expect(invoice.stage).toBe('invoice')
    expect(invoice.carrierCode).toBe('/ABC1234')
    expect(confirmInvoiceDetails(invoice, 'carrier', '/NEW1234').carrierCode).toBe('/NEW1234')
    expect(returnToPreviousStep(invoice)).toBeUndefined()
  })

  it('returns from payment to the tax ID step when that was the previous page', () => {
    const payment = confirmTaxId(setTaxIdDraft(requestTaxId(beginCheckout('collected')), '12345678'))
    const taxId = returnToPreviousStep(payment)!

    expect(taxId.stage).toBe('tax-id')
    expect(taxId.taxId).toBe('12345678')
    expect(confirmTaxId(setTaxIdDraft(taxId, '87654321')).taxId).toBe('87654321')
  })

  it('blocks backward navigation once a payment may have taken effect', () => {
    const payment = confirmInvoiceDetails(beginCheckout('collected'), 'donation', '12345')

    expect(returnToPreviousStep(payment, 'rejected')?.stage).toBe('invoice')
    expect(() => returnToPreviousStep(payment, 'pending')).toThrow('付款')
    expect(() => returnToPreviousStep(payment, 'authorized')).toThrow('付款')
    expect(() => returnToPreviousStep(payment, 'uncertain')).toThrow('付款')
  })
})
