import type { PaymentStatus } from '../../../order-menu-server/src/domain/contracts'

import { invoiceCode } from '@proj-airi/stage-shared/invoice-input'

export type CheckoutStage = 'invoice' | 'membership' | 'payment' | 'tax-id'
export type InvoiceMethod = 'carrier' | 'citizen' | 'donation' | 'tax-id'

export interface CheckoutSnapshot {
  carrierCode?: string
  citizenCode?: string
  donationCode?: string
  invoiceMethod?: InvoiceMethod
  /** Customer-facing membership number; never store the raw scanned barcode here. */
  membershipNumber?: string
  stage: CheckoutStage
  taxId?: string
}

/**
 * Keeps customer checkout progress separate from the cart and POS order.
 * A payment-terminal adapter will later advance a verified payment to the
 * existing order-submission boundary; it must not be represented as an Agent action.
 */
export function beginCheckout(membership: 'scan' | 'collected' = 'scan'): CheckoutSnapshot {
  if (membership === 'collected')
    return { stage: 'invoice' }
  return { stage: 'membership' }
}

/** Records an explicit customer choice not to identify a membership account. */
export function skipMembership(checkout: CheckoutSnapshot): CheckoutSnapshot {
  if (checkout.stage !== 'membership')
    throw new Error('Membership can only be skipped while waiting for a membership scan.')

  return { stage: 'invoice' }
}

/** Records a physical scanner result and advances to invoice confirmation. */
export function identifyMembership(checkout: CheckoutSnapshot, membershipNumber: string, carrierCode?: string): CheckoutSnapshot {
  if (checkout.stage !== 'membership')
    throw new Error('Membership can only be identified while waiting for a membership scan.')

  const visibleMembershipNumber = membershipNumber.trim()
  if (!visibleMembershipNumber)
    throw new Error('A customer-facing membership number is required.')

  return {
    carrierCode,
    membershipNumber: visibleMembershipNumber,
    stage: 'invoice',
  }
}

export function chooseInvoiceMethod(checkout: CheckoutSnapshot, method: Exclude<InvoiceMethod, 'tax-id'>): CheckoutSnapshot {
  if (checkout.stage !== 'invoice' && (checkout.stage !== 'tax-id' || method !== 'donation'))
    throw new Error('Invoice method can only be selected during invoice confirmation.')
  if (method === 'donation') {
    // This is the customer's explicit choice to skip personal invoice data.
    // The eventual invoice integration owns the recipient; no code is invented
    // and no invoice is issued by this test checkout transition.
    return { ...checkout, invoiceMethod: method, carrierCode: undefined, citizenCode: undefined, donationCode: undefined, taxId: undefined, stage: 'payment' }
  }
  if ((method === 'carrier' && !checkout.carrierCode) || (method === 'citizen' && !checkout.citizenCode))
    return { ...checkout, invoiceMethod: method, stage: 'invoice' }
  return { ...checkout, invoiceMethod: method, stage: 'payment' }
}

export function requestTaxId(checkout: CheckoutSnapshot): CheckoutSnapshot {
  if (checkout.stage !== 'invoice')
    throw new Error('A tax ID can only be entered during invoice confirmation.')
  return { ...checkout, invoiceMethod: 'tax-id', stage: 'tax-id', taxId: checkout.taxId ?? '' }
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

/** Returns one editable page, retaining identifiers; undefined means the cart review. */
export function returnToPreviousStep(checkout: CheckoutSnapshot, paymentStatus?: PaymentStatus): CheckoutSnapshot | undefined {
  // Authorization already may have charged the customer even while the POS
  // submission is still running. Returning must never release that attempt.
  if (paymentStatus === 'pending' || paymentStatus === 'authorized' || paymentStatus === 'uncertain')
    throw new Error('付款處理中或結果待確認，暫時無法返回。')
  if (checkout.stage === 'payment')
    return { ...checkout, stage: checkout.invoiceMethod === 'tax-id' ? 'tax-id' : 'invoice' }
  if (checkout.stage === 'tax-id')
    return { ...checkout, invoiceMethod: undefined, stage: 'invoice' }
  return undefined
}

/** Validates customer-entered invoice identifiers before advancing to payment selection. */
export function confirmInvoiceDetails(checkout: CheckoutSnapshot, method: 'carrier' | 'citizen' | 'donation', value: string): CheckoutSnapshot {
  if (checkout.stage !== 'invoice')
    throw new Error('請返回發票資料再選擇。')
  const code = value.trim().toUpperCase()
  if (method === 'carrier' && !invoiceCode(method, code))
    throw new Error('手機條碼需為 / 開頭，共 8 碼。')
  if (method === 'citizen' && !invoiceCode(method, code))
    throw new Error('自然人憑證條碼需為 2 碼英文字母及 14 碼數字。')
  if (method === 'donation' && !/^\d{3,7}$/.test(code))
    throw new Error('請輸入 3 至 7 碼捐贈碼。')
  return { ...checkout, invoiceMethod: method, carrierCode: method === 'carrier' ? code : undefined, citizenCode: method === 'citizen' ? code : undefined, donationCode: method === 'donation' ? code : undefined, stage: 'payment' }
}
