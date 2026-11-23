import { expect, it } from 'vitest'

import { createPaymentNavigation } from './paymentNavigation'

const root = 'https://app.esgpb.com/order/store/1kgJeql/internal_use/'
const choose = `${root}orders/ORDER/choosePayment`
const redirect = 'https://app.esgpb.com/order/linepay/redirect/ORDER/LinePay'

// Report: this chat, 2026-11-23 — manual LINE Pay selection was blocked by the
// host's same-origin guard even though PB's payment selector worked normally.
it('follows one manually selected order through LINE Pay and back without granting automation', () => {
  const navigation = createPaymentNavigation(`${root}menu/select-table`)
  expect(navigation.allow(choose, 'https://web-pay.line.me/web/payment/wait?transactionId=test')).toBe(false)
  expect(navigation.allow(choose, redirect)).toBe(true)
  // HTTP redirect happens before Chromium commits the merchant wrapper URL.
  expect(navigation.allow(choose, 'https://web-pay.line.me/web/payment/wait?transactionId=test')).toBe(true)
  expect(navigation.allow('https://web-pay.line.me/web/payment/wait', 'https://access.line.me/oauth2/v2.1/authorize?state=test')).toBe(true)
  expect(navigation.allow('https://access.line.me/oauth2/v2.1/authorize', `${root}orders/ORDER`)).toBe(true)
  expect(navigation.allow(`${root}orders/ORDER`, 'https://web-pay.line.me/web/payment/wait')).toBe(false)
})

it('rejects unrelated providers, insecure links and a different order', () => {
  const navigation = createPaymentNavigation(`${root}menu/select-table`)
  expect(navigation.allow(choose, 'https://app.esgpb.com/order/linepay/redirect/OTHER/LinePay')).toBe(false)
  expect(navigation.allow(choose, redirect)).toBe(true)
  expect(navigation.allow(choose, 'https://example.com/payment')).toBe(false)
  expect(navigation.allow(choose, 'http://web-pay.line.me/web/payment/wait')).toBe(false)
  expect(navigation.allow(choose, 'https://web-pay.line.me.evil.example/payment')).toBe(false)
  expect(navigation.allow(choose, 'https://web-pay.line.me:444/payment')).toBe(false)
  expect(navigation.allow(choose, 'https://user@web-pay.line.me/payment')).toBe(false)
  expect(navigation.allow(choose, 'https://web-pay.line.me/web/payment/wait')).toBe(true)
  expect(navigation.allow('https://web-pay.line.me/web/payment/wait', `${root}orders/OTHER`)).toBe(false)
})

it('retains manual credit checkout and the provider authentication redirects', () => {
  const navigation = createPaymentNavigation(`${root}menu/select-table`)
  const credit = 'https://app.esgpb.com/order/ecpay/redirect/ORDER/Credit'
  expect(navigation.allow(choose, credit)).toBe(true)
  expect(navigation.allow(choose, 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5')).toBe(true)
  expect(navigation.isManualPage('https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5')).toBe(true)
  expect(navigation.allow('https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5', 'https://bank-auth.example/3ds')).toBe(true)
  expect(navigation.isManualPage('https://bank-auth.example/3ds')).toBe(true)
  expect(navigation.allow('https://bank-auth.example/3ds', `${root}orders/ORDER`)).toBe(true)
})

it('keeps intermediate merchant callbacks manual until the order page returns', () => {
  const navigation = createPaymentNavigation(`${root}menu/select-table`)
  expect(navigation.allow(choose, redirect)).toBe(true)
  expect(navigation.allow(choose, 'https://web-pay.line.me/web/payment/wait')).toBe(true)
  const callback = 'https://app.esgpb.com/order/linepay/callback?transactionId=test'
  expect(navigation.allow('https://web-pay.line.me/web/payment/wait', callback)).toBe(true)
  expect(navigation.isManualPage(callback)).toBe(true)
  expect(navigation.allow(callback, `${root}orders/ORDER`)).toBe(true)
  expect(navigation.isManualPage(`${root}orders/ORDER`)).toBe(false)
})
