import { afterEach, expect, it, vi } from 'vitest'

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
