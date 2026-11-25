import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { installInvoiceInput } from './pbInvoiceInput'

const initialUrl = location.href
let input: ReturnType<typeof installInvoiceInput> | undefined
afterEach(() => {
  input?.dispose()
  history.replaceState({}, '', initialUrl)
  document.body.replaceChildren()
})

function setup(method: 'carrier' | 'citizen' = 'carrier') {
  history.replaceState({}, '', '/order/store/1kAMNok/internal_use/orders/create')
  document.body.innerHTML = `<form class="order-create"><label class="el-radio"><input type="radio" value="${method === 'carrier' ? 3 : 2}" checked><input id="scan" placeholder="${method === 'carrier' ? '請輸入共8碼編號' : '2碼英文字碼+14碼數字'}"></label><input id="phone" type="email"><input id="email" type="email"><button>送出訂單</button></form>`
  const submit = vi.fn((event: Event) => event.preventDefault())
  document.querySelector('form')!.addEventListener('submit', submit)
  input = installInvoiceInput()
  return { field: document.querySelector<HTMLInputElement>('#scan')!, submit }
}

it.each(['carrier', 'citizen'] as const)('focuses the selected %s field and consumes scanner Enter without submitting', (method) => {
  const { field, submit } = setup(method)
  expect(document.activeElement).toBe(field)
  const changed = vi.fn()
  field.addEventListener('change', changed)
  field.value = method === 'carrier' ? '/ab12345' : 'ab12345678901234'
  const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  field.dispatchEvent(enter)
  expect(enter.defaultPrevented).toBe(true)
  expect(field.value).toBe(method === 'carrier' ? '/AB12345' : 'AB12345678901234')
  expect(changed).toHaveBeenCalledOnce()
  expect(submit).not.toHaveBeenCalled()
  expect(document.activeElement).not.toBe(field)
})

it('rejects invalid input locally and leaves phone/email untouched', () => {
  const { field, submit } = setup()
  field.value = '0912345678'
  const changed = vi.fn()
  field.addEventListener('change', changed)
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  expect(field.validity.customError).toBe(true)
  expect(document.activeElement).toBe(field)
  expect(changed).not.toHaveBeenCalled()
  expect(submit).not.toHaveBeenCalled()
  expect(document.querySelector<HTMLInputElement>('#phone')!.value).toBe('')
  expect(document.querySelector<HTMLInputElement>('#email')!.value).toBe('')
})

// Report: this chat, Nov18 — selecting an invoice method must accept the next scan without an extra field click.
it.each([false, true])('moves from contact editing to the newly selected scanner field once (deferred render: %s)', async (deferred) => {
  const { field, submit } = setup()
  const radio = document.querySelector<HTMLInputElement>('input[type="radio"]')!
  radio.checked = false
  field.hidden = true
  const phone = document.querySelector<HTMLInputElement>('#phone')!
  phone.focus()
  radio.addEventListener('change', () => {
    if (deferred) {
      field.remove()
      queueMicrotask(() => {
        field.hidden = false
        radio.closest('label')!.append(field)
      })
    }
    else {
      field.hidden = false
    }
  })
  // PB selects through the label's native click; the previously edited contact
  // can retain DOM focus until the newly rendered invoice field takes ownership.
  radio.closest('label')!.click()
  await vi.waitFor(() => expect(document.activeElement).toBe(field))
  expect(input!.pending()).toBe(true)
  phone.focus()
  document.querySelector('form')!.insertAdjacentHTML('beforeend', '<span>其他更新</span>')
  await Promise.resolve()
  expect(document.activeElement).toBe(phone)
  expect(submit).not.toHaveBeenCalled()
})

it('revokes ownership on blur, reset or navigation without repeatedly stealing focus', async () => {
  const { field } = setup()
  field.value = '/AB12345'
  document.querySelector<HTMLInputElement>('#email')!.focus()
  document.querySelector('form')!.insertAdjacentHTML('beforeend', '<span>其他畫面更新</span>')
  await Promise.resolve()
  expect(document.activeElement).not.toBe(field)
  const other = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  field.dispatchEvent(other)
  expect(other.defaultPrevented).toBe(false)
  field.focus()
  input!.reset()
  const reset = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  field.dispatchEvent(reset)
  expect(reset.defaultPrevented).toBe(false)
  field.blur()
  field.focus()
  history.pushState({}, '', '/order/store/1kAMNok/internal_use/menu')
  const navigated = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  field.dispatchEvent(navigated)
  expect(navigated.defaultPrevented).toBe(false)
})

// Report: this chat, Nov13; changing meals must not require completing carrier input.
it('leaves carrier input before a meal change without erasing values or stealing focus back', async () => {
  const { field, submit } = setup()
  field.value = '/AB'
  expect(input!.pending()).toBe(true)
  input!.leave()
  expect(document.activeElement).not.toBe(field)
  expect(input!.pending()).toBe(false)
  expect(field.value).toBe('/AB')
  document.querySelector('form')!.insertAdjacentHTML('beforeend', '<span>餐點已修改</span>')
  await Promise.resolve()
  expect(document.activeElement).not.toBe(field)
  const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  field.dispatchEvent(enter)
  expect(enter.defaultPrevented).toBe(false)
  expect(submit).not.toHaveBeenCalled()
  field.focus()
  expect(input!.pending()).toBe(true)
})

// Report: this chat, Nov17 — touching/typing a phone invalidated checkout and no touch keyboard appeared.
it('owns phone editing from the first touch and fills the real field through a touch keypad without submitting', async () => {
  const { submit } = setup()
  const phone = document.querySelector<HTMLInputElement>('#phone')!
  const row = document.createElement('div')
  row.className = 'el-form-item'
  row.innerHTML = '<label for="phone">手機號碼</label>'
  phone.replaceWith(row)
  row.append(phone)
  await vi.waitFor(() => expect(page.getByRole('button', { name: '開啟數字鍵盤' }).query()).not.toBeNull())
  const formHeight = row.getBoundingClientRect().height
  expect(page.getByRole('group', { name: '通知手機數字鍵盤' }).query()).toBeNull()
  await page.getByRole('button', { name: '開啟數字鍵盤' }).click()
  const panel = page.getByRole('group', { name: '通知手機數字鍵盤' })
  await expect.element(panel).toBeVisible()
  expect(getComputedStyle(panel.element()).position).toBe('fixed')
  expect(row.getBoundingClientRect().height).toBe(formHeight)
  await page.screenshot({ path: '__screenshots__/floating-phone-keypad.png' })
  await panel.getByRole('button', { name: '關閉鍵盤' }).click()
  expect(panel.query()).toBeNull()
  await page.getByRole('button', { name: '開啟數字鍵盤' }).click()
  expect(input!.owns(new PointerEvent('pointerdown'))).toBe(false)
  const touch = new PointerEvent('pointerdown', { bubbles: true })
  let owned = false
  phone.addEventListener('pointerdown', event => owned = input!.owns(event), { once: true })
  phone.dispatchEvent(touch)
  expect(owned).toBe(true)
  const changed = vi.fn()
  phone.addEventListener('input', changed)
  const keypad = page.getByRole('group', { name: '通知手機數字鍵盤' })
  for (const digit of '0912345678')
    await keypad.getByRole('button', { name: digit, exact: true }).click()
  expect(phone.value).toBe('0912345678')
  expect(changed).toHaveBeenCalledTimes(10)
  expect(document.querySelector<HTMLInputElement>('#email')!.value).toBe('')
  // Report: this chat, Nov17 — the floating panel obscured the native submit control.
  input!.leave()
  expect(keypad.query()).toBeNull()
  expect(phone.value).toBe('0912345678')
  expect(submit).not.toHaveBeenCalled()
  phone.focus()
  expect(keypad.query()).toBeNull()
  await page.getByRole('button', { name: '開啟數字鍵盤' }).click()
  await keypad.getByRole('button', { name: '刪除一碼' }).click()
  expect(phone.value).toBe('091234567')
  await keypad.getByRole('button', { name: '清除' }).click()
  expect(phone.value).toBe('')
  expect(submit).not.toHaveBeenCalled()
  history.pushState({}, '', '/order/store/1kAMNok/internal_use/menu')
  row.append(document.createElement('span'))
  await vi.waitFor(() => expect(page.getByRole('group', { name: '通知手機數字鍵盤' }).query()).toBeNull())
})

it('opens the selected tax ID keypad, preserves leading zeroes and leaves the phone and order untouched', async () => {
  const { submit } = setup()
  const form = document.querySelector('form')!
  form.insertAdjacentHTML('beforeend', '<label class="el-radio"><input id="tax-radio" type="radio" value="4" checked><input id="tax" placeholder="請輸入統一編號"></label><div class="field"><label>手機號碼</label><input id="contact" value="0912345678"></div>')
  const tax = document.querySelector<HTMLInputElement>('#tax')!
  const open = page.getByRole('button', { name: '開啟統編數字鍵盤' })
  await open.click()
  const panel = page.getByRole('group', { name: '統一編號數字鍵盤' })
  for (const digit of '012345678')
    await panel.getByRole('button', { name: digit, exact: true }).click()
  expect(tax.value).toBe('01234567')
  await panel.getByRole('button', { name: '刪除一碼' }).click()
  expect(tax.value).toBe('0123456')
  await panel.getByRole('button', { name: '關閉鍵盤' }).click()
  await open.click()
  await page.getByRole('button', { name: '開啟數字鍵盤' }).click()
  expect(panel.query()).toBeNull()
  expect(tax.value).toBe('0123456')
  expect(document.querySelector<HTMLInputElement>('#contact')!.value).toBe('0912345678')
  document.querySelector<HTMLInputElement>('#tax-radio')!.checked = false
  form.dispatchEvent(new Event('input', { bubbles: true }))
  tax.remove()
  await vi.waitFor(() => expect(open.query()).toBeNull())
  expect(submit).not.toHaveBeenCalled()
})
