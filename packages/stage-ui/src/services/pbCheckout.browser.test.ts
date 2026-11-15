import type { CartSnapshot } from './pbCart'

import { afterEach, expect, it, vi } from 'vitest'

import { createCheckout } from './pbCheckout'
import { createControls } from './pbControls'
import { createOperation } from './pbOperation'

const initialUrl = location.href
afterEach(() => {
  history.replaceState({}, '', initialUrl)
  document.body.replaceChildren()
})

function setup(result = { hash: 'TEST-123', number: 'TEST-0001', status: 20, totalmoney: 64 }) {
  history.replaceState({}, '', '/order/store/1kgJeql/internal_use/orders/create')
  document.body.innerHTML = `<section class="order-create"><label><input type="radio" name="invoice" value="5" checked>無載具</label><label><input type="radio" name="invoice" value="3">手機載具</label><input placeholder="請輸入共8碼編號"><div class="el-form-item"><label>手機號碼</label><input type="email"></div><div class="el-form-item"><label>E-mail</label><input type="email"></div></section><p>總金額<span>$64</span></p><button>送出訂單</button>`
  const clicked = vi.fn()
  document.querySelector('button')!.addEventListener('click', () => {
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-label="確認訂單"><div class="el-message-box__message">訂單送出後將無法修改，請確認所有資訊是否正確。</div><button>取消</button><button>確定</button></div>')
    document.querySelectorAll('[role="dialog"] button')[1].addEventListener('click', () => {
      clicked()
      document.body.innerHTML = '<p>取餐編號：TEST-0001</p>'
      history.replaceState({}, '', '/order/store/1kgJeql/internal_use/orders/TEST-123/choosePayment')
      const root = document.createElement('div')
      root.setAttribute('data-page', JSON.stringify({ component: 'Order/ChoosePayment', url: location.pathname, props: { storeHash: '1kgJeql', flowType: 'internal_use', order: result } }))
      document.body.append(root)
    })
  })
  const cart: CartSnapshot = { lines: [{ ref: '1', productRef: 'p-2589', name: '周氏水餃(最低8顆)', quantity: 1, unitPrice: 64, configuration: '', options: [] }], subtotal: 64, context: { date: '2026-11-15', time: '12:00', manualRevision: 0, tableName: 'A3' } }
  let revision = 0
  const dispatched = vi.fn()
  const accepted = vi.fn()
  const checkout = createCheckout(async () => structuredClone(cart), () => revision, dispatched, accepted, true)
  const controller = new AbortController()
  const operation = createOperation({ documentId: 'document', operationId: 'checkout', signal: controller.signal, follow: async (target, _label, dispatch) => {
    target.scrollIntoView({ block: 'center' })
    await dispatch()
    return true
  } })
  const controls = createControls(operation, controller.signal)
  return { checkout, controls, cart, clicked, dispatched, accepted, touch: () => revision++ }
}

// Report: this chat, Nov15: cart confirmation never advanced to invoice or submission.
it('fills the labeled notification phone, preserves email, and dispatches a confirmed order only once', async () => {
  const { checkout, controls, clicked, dispatched, accepted } = setup()
  const email = document.querySelectorAll<HTMLInputElement>('.el-form-item input')[1]
  email.value = 'test@example.test'
  await checkout.phone('0912345678', controls)
  expect(email.value).toBe('test@example.test')
  expect(checkout.read()?.fields.find(field => field.kind === 'phone')?.value).toBe('0912345678')
  expect(clicked).not.toHaveBeenCalled()
  const prepared = await checkout.prepare()
  expect(prepared.ready).toBe(true)
  expect(prepared.confirmationToken).toBeTypeOf('string')
  const result = await checkout.submit(prepared.confirmationToken!, controls)
  expect(result).toMatchObject({ status: 'accepted', effect: 'applied', order: { hash: 'TEST-123', number: 'TEST-0001' } })
  expect(result).not.toHaveProperty('confirmationToken')
  expect(clicked).toHaveBeenCalledOnce()
  expect(dispatched).toHaveBeenCalledOnce()
  expect(accepted).toHaveBeenCalledOnce()
  await expect(checkout.submit(prepared.confirmationToken!, controls)).rejects.toThrow('核對')
  expect(clicked).toHaveBeenCalledOnce()
})

// Report: this chat, Nov15 actual result identifies hash and display number separately.
it.each([{ hash: 'OTHER', number: 'TEST-0001', status: 20, totalmoney: 64 }, { hash: 'TEST-123', number: 'TEST-0001', status: 10, totalmoney: 64 }])('does not acknowledge an unrelated, draft or wrong-total result: %o', async (result) => {
  const { checkout, controls, accepted, dispatched } = setup(result)
  await checkout.phone('0912345678', controls)
  const prepared = await checkout.prepare()
  await checkout.submit(prepared.confirmationToken!, controls)
  expect(dispatched).toHaveBeenCalledOnce()
  expect(accepted).not.toHaveBeenCalled()
})

// Report: this chat, Nov15; recording defects must not erase an established order.
it('reports merchant acceptance with an amount conflict rather than returning pending or replaying', async () => {
  const { checkout, controls, accepted, clicked } = setup({ hash: 'TEST-123', number: 'TEST-0001', status: 20, totalmoney: 1 })
  await checkout.phone('0912345678', controls)
  const prepared = await checkout.prepare()
  expect(await checkout.submit(prepared.confirmationToken!, controls)).toMatchObject({ status: 'accepted', consistency: 'conflict', reason: 'amount-mismatch', order: { total: 1 } })
  expect(accepted).toHaveBeenCalledOnce()
  expect(clicked).toHaveBeenCalledOnce()
})

it('selects the actual carrier radio and requires its code and notification information', async () => {
  const { checkout, controls, clicked } = setup()
  const selected = await checkout.choose('carrier', controls)
  expect(selected.methods.find(method => method.method === 'carrier')?.selected).toBe(true)
  expect(selected.missing.join(' ')).toContain('手機載具')
  expect(selected.missing.join(' ')).toContain('通知手機')
  expect((await checkout.prepare()).confirmationToken).toBeUndefined()
  expect(clicked).not.toHaveBeenCalled()
})

it.each(['cart', 'field', 'touch'] as const)('rejects confirmation after a %s change without clicking submit', async (change) => {
  const { checkout, controls, cart, clicked, touch } = setup()
  await checkout.phone('0912345678', controls)
  const prepared = await checkout.prepare()
  if (change === 'cart')
    cart.lines[0].quantity = 2
  else if (change === 'field')
    document.querySelector<HTMLInputElement>('.el-form-item input')!.value = '0987654321'
  else
    touch()
  await expect(checkout.submit(prepared.confirmationToken!, controls)).rejects.toThrow('已變更')
  expect(clicked).not.toHaveBeenCalled()
})

it('invalidates a prepared submission on reception reset', async () => {
  const { checkout, controls, clicked } = setup()
  await checkout.phone('0912345678', controls)
  const prepared = await checkout.prepare()
  checkout.reset()
  await expect(checkout.submit(prepared.confirmationToken!, controls)).rejects.toThrow('核對')
  expect(clicked).not.toHaveBeenCalled()
})

it('keeps a collapsed order note in the final facts', async () => {
  const { checkout, controls } = setup()
  const note = document.createElement('textarea')
  note.value = '請分開包裝'
  note.hidden = true
  document.querySelector('.order-create')!.append(note)
  await checkout.phone('0912345678', controls)
  expect((await checkout.prepare()).orderNote).toBe('請分開包裝')
})

it('does not enable vendor submission before its result flow has been verified', async () => {
  const { controls, cart, clicked } = setup()
  const checkout = createCheckout(async () => cart, () => 0, vi.fn(), vi.fn(), false)
  await checkout.phone('0912345678', controls)
  const prepared = await checkout.prepare()
  expect(prepared.ready).toBe(false)
  expect(prepared.confirmationToken).toBeUndefined()
  await expect(checkout.submit('invented', controls)).rejects.toThrow('核對')
  expect(clicked).not.toHaveBeenCalled()
})

// Report: this chat, Nov15 actual PB has a second confirmation before POST.
it('rechecks the cart after opening confirmation and before the actual submission click', async () => {
  const { checkout, controls, cart, clicked, dispatched } = setup()
  await checkout.phone('0912345678', controls)
  const prepared = await checkout.prepare()
  document.querySelector('button')!.addEventListener('click', () => cart.lines[0].quantity = 2)
  await expect(checkout.submit(prepared.confirmationToken!, controls)).rejects.toThrow('已變更')
  expect(clicked).not.toHaveBeenCalled()
  expect(dispatched).not.toHaveBeenCalled()
})
