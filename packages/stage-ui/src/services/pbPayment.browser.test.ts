import { readPbJourney } from '@proj-airi/stage-shared/pb-journey'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { installPaymentPolicy } from './pbPayment'

const initialUrl = location.href
let policy: ReturnType<typeof installPaymentPolicy> | undefined
afterEach(() => {
  policy?.dispose()
  history.replaceState({}, '', initialUrl)
  document.body.replaceChildren()
})
function setup() {
  const approved = readPbJourney('https://app.esgpb.com/order/store/1kgJeql/internal_use/menu')!
  // The fixture runs at Vitest's browser origin; the same journey paths and
  // provider URLs remain bound to that explicit origin, without real payments.
  const journey = { ...approved, origin: location.origin }
  history.replaceState({}, '', `${journey.basePath}orders/TEST/choosePayment`)
  document.body.innerHTML = `<section class="order-pay"><div class="pay-method"><a class="el-button btn-LinePay" href="/order/linepay/redirect/TEST/LinePay">LINE Pay</a><a class="el-button btn-Credit" href="/order/ecpay/redirect/TEST/Credit"><span>信用卡</span></a></div><button>放棄付款</button></section>`
  const line = vi.fn((event: Event) => event.preventDefault())
  const credit = vi.fn((event: Event) => event.preventDefault())
  const cancel = vi.fn()
  document.querySelector('.btn-LinePay')!.addEventListener('click', line)
  document.querySelector('.btn-Credit')!.addEventListener('click', credit)
  document.querySelector('button')!.addEventListener('click', cancel)
  policy = installPaymentPolicy(journey)
  return { line, credit, cancel }
}

// Report: this chat, Nov19 — kiosk payment must allow LINE Pay only, without a menu cover.
it('blocks credit activation and new-tab links while retaining LINE Pay and native cancellation', async () => {
  const { line, credit, cancel } = setup()
  const card = document.querySelector<HTMLAnchorElement>('.btn-Credit')!
  expect(card.hasAttribute('href')).toBe(false)
  expect(card.getAttribute('aria-disabled')).toBe('true')
  expect(document.querySelector('[data-webnavior-payment-policy]')?.textContent).toContain('暫不支援信用卡')
  card.click()
  card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  card.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))
  expect(credit).not.toHaveBeenCalled()
  await page.getByRole('link', { name: 'LINE Pay', exact: true }).click()
  expect(line).toHaveBeenCalledOnce()
  await page.getByRole('button', { name: '放棄付款', exact: true }).click()
  expect(cancel).toHaveBeenCalledOnce()
})

it('restricts asynchronously inserted providers and restores the native control on disposal', async () => {
  setup()
  const region = document.querySelector('.pay-method')!
  region.insertAdjacentHTML('beforeend', '<a id="other" href="/order/linepay/redirect/OTHER/LinePay">別張訂單</a>')
  await expect.poll(() => document.querySelector('#other')!.hasAttribute('href')).toBe(false)
  policy!.dispose()
  expect(document.querySelector('.btn-Credit')!.getAttribute('href')).toBe('/order/ecpay/redirect/TEST/Credit')
  expect(document.querySelector('.btn-Credit')!.hasAttribute('aria-disabled')).toBe(false)
  expect(document.querySelector('[data-webnavior-payment-policy]')).toBeNull()
})

it('removes the restriction when SPA navigation leaves payment selection', async () => {
  setup()
  history.replaceState({}, '', '/order/store/1kgJeql/internal_use/orders/TEST')
  document.body.append(document.createElement('p'))
  await expect.poll(() => document.querySelector('[data-webnavior-payment-policy]')).toBeNull()
  expect(document.querySelector('.btn-Credit')!.getAttribute('href')).toBe('/order/ecpay/redirect/TEST/Credit')
})
