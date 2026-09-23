export type CheckoutStage = 'invoice' | 'membership' | 'payment' | 'tax-id'
export type InvoiceMethod = 'carrier' | 'donation' | 'tax-id'

export interface CheckoutSnapshot {
  carrierCode?: string
  invoiceMethod?: InvoiceMethod
  stage: CheckoutStage
  taxId?: string
}

/**
 * Keeps customer checkout progress separate from the cart and POS order.
 * A payment-terminal adapter will later advance a verified payment to the
 * existing order-submission boundary; it must not be represented as an Agent action.
 */
export function beginCheckout(): CheckoutSnapshot {
  return { stage: 'membership' }
}

/** Records an explicit customer choice not to identify a membership account. */
export function skipMembership(checkout: CheckoutSnapshot): CheckoutSnapshot {
  if (checkout.stage !== 'membership')
    throw new Error('Membership can only be skipped while waiting for a membership scan.')

  return { stage: 'invoice' }
}

export function chooseInvoiceMethod(checkout: CheckoutSnapshot, method: Exclude<InvoiceMethod, 'tax-id'>): CheckoutSnapshot {
  if (checkout.stage !== 'invoice' && (checkout.stage !== 'tax-id' || method !== 'donation'))
    throw new Error('Invoice method can only be selected during invoice confirmation.')
  if (method === 'carrier' && !checkout.carrierCode)
    throw new Error('A carrier can only be selected after the customer scans or confirms one.')
  return { ...checkout, invoiceMethod: method, stage: 'payment' }
}

export function requestTaxId(checkout: CheckoutSnapshot): CheckoutSnapshot {
  if (checkout.stage !== 'invoice')
    throw new Error('A tax ID can only be entered during invoice confirmation.')
  return { ...checkout, invoiceMethod: 'tax-id', stage: 'tax-id', taxId: '' }
}

/** Updates the visible tax-ID draft without advancing checkout. */
export function setTaxIdDraft(checkout: CheckoutSnapshot, taxId: string): CheckoutSnapshot {
  if (checkout.stage !== 'tax-id' || !/^\d{0,8}$/.test(taxId))
    throw new Error('A tax ID draft must contain at most eight digits.')
  return { ...checkout, taxId }
}

/** Advances only after the customer has seen and semantically confirmed all eight digits. */
export function confirmTaxId(checkout: CheckoutSnapshot): CheckoutSnapshot {
  if (checkout.stage !== 'tax-id' || !checkout.taxId || !/^\d{8}$/.test(checkout.taxId))
    throw new Error('A valid eight-digit tax ID is required.')
  return { ...checkout, invoiceMethod: 'tax-id', stage: 'payment' }
}

export function returnToInvoice(checkout: CheckoutSnapshot): CheckoutSnapshot {
  if (checkout.stage !== 'tax-id')
    throw new Error('Only tax ID entry can return to invoice confirmation.')
  const { taxId: _, ...invoice } = checkout
  return { ...invoice, invoiceMethod: undefined, stage: 'invoice' }
}
