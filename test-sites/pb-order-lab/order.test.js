import { describe, expect, it } from 'vitest'
import { invoiceError, pay, selection, setCartQuantity, submit } from './order.js'

const clock = { id: 'fixture-1', now: '2026-11-13T15:59:00.000Z' }
const draft = () => ({ table: 'A1 桌', cart: [{ ...selection('dumplings', 2, 2, '不要醬'), lineId: 'line-1' }, { ...selection('egg-soup', 1), lineId: 'line-2' }], invoice: { type: 'none', code: '', phone: '0912345678', email: '' }, note: '一起出餐', orders: [], checkoutKey: 'checkout-1' })

describe('frozen PB menu checkout', () => {
  // Report: this chat, Nov14 live PB cart: setting a configured row to 0 removes it.
  it('removes only the zero-quantity row and keeps the other row and invoice', () => {
    const state = draft()
    const invoice = structuredClone(state.invoice)
    setCartQuantity(state, 'line-1', 0)
    expect(state.cart).toHaveLength(1)
    expect(state.cart[0].lineId).toBe('line-2')
    expect(state.cart[0].subtotal).toBe(40)
    expect(state.invoice).toEqual(invoice)
  })

  it('recalculates a configured row without changing its identity or notes', () => {
    const state = draft()
    setCartQuantity(state, 'line-1', 3)
    expect(state.cart[0].lineId).toBe('line-1')
    expect(state.cart[0].unitPrice).toBe(80)
    expect(state.cart[0].quantity).toBe(3)
    expect(state.cart[0].subtotal).toBe(240)
    expect(state.cart[0].note).toBe('不要醬')
    expect(state.cart[1].quantity).toBe(1)
    expect(() => setCartQuantity(state, 'line-1', -1)).toThrow()
    expect(state.cart[0].quantity).toBe(3)
  })

  // Report: Nov14 live product/cart inputs have MAX_SAFE_INTEGER, not 99, as max.
  it('does not introduce a fixture-only 99-serving cap or silently truncate product notes', () => {
    const note = '一致性核對'.repeat(45)
    const line = selection('dumplings', 100, 0, note)
    expect(line.quantity).toBe(100)
    expect(line.subtotal).toBe(6400)
    expect(line.note).toBe(note)
  })
  it('prices extra dumplings per serving and preserves notes', () => {
    const line = selection('dumplings', 2, 2, '不要醬')
    expect(line.unitPrice).toBe(80)
    expect(line.subtotal).toBe(160)
    expect(line.note).toBe('不要醬')
    expect(selection('combo-a', 1).subtotal).toBe(136)
  })

  it('rejects invalid quantities, unknown items, and extras on fixed items', () => {
    expect(() => selection('dumplings', 0)).toThrow()
    expect(() => selection('dumplings', 1.5)).toThrow()
    expect(() => selection('dumplings', 1, 101)).toThrow()
    expect(() => selection('egg-soup', 1, 1)).toThrow()
    expect(() => selection('unknown', 1)).toThrow()
  })

  it('requires notification and checks all five invoice branches', () => {
    const invoice = { type: 'none', code: '', phone: '', email: '' }
    expect(invoiceError(invoice)).toContain('擇一')
    invoice.email = 'tester@example.test'
    expect(invoiceError(invoice)).toBeUndefined()
    for (const [type, code] of [['carrier', '/ABC+123'], ['citizen', 'AB12345678901234'], ['tax', '12345678'], ['donation', '123']]) {
      expect(invoiceError({ ...invoice, type, code })).toBeUndefined()
      expect(invoiceError({ ...invoice, type, code: '<script>' })).toBeDefined()
    }
    expect(invoiceError({ ...invoice, phone: '123' })).toBeDefined()
    expect(invoiceError({ ...invoice, email: 'invalid' })).toBeDefined()
  })

  it('submits at any hour, reprices cart facts and returns the same receipt on replay', () => {
    const state = draft()
    state.cart[0].subtotal = 1
    const order = submit(state, clock)
    expect(order.total).toBe(200)
    expect(order.items[0].quantity).toBe(2)
    expect(order.createdAt).toBe(clock.now)
    expect(order.environment).toBe('test')
    expect(order.orderId).toBe('TEST-fixture-1')
    expect(state.cart).toEqual([])
    expect(submit(state, { ...clock, id: 'second' })).toBe(order)
    expect(state.orders).toHaveLength(1)
    state.invoice.phone = '0999999999'
    expect(order.invoice.phone).toBe('0912345678')
  })

  it('rejects empty carts, missing tables and incomplete invoice data', () => {
    expect(() => submit({ ...draft(), cart: [] }, clock)).toThrow()
    expect(() => submit({ ...draft(), table: '' }, clock)).toThrow()
    const state = draft()
    state.invoice.phone = ''
    expect(() => submit(state, clock)).toThrow()
    expect(state.orders).toHaveLength(0)
  })

  it.each(['linepay', 'card'])('simulates %s success once and freezes the paid amount', (method) => {
    const order = submit(draft(), clock)
    pay(order, method, 'succeeded', clock)
    expect(order.status).toBe('completed')
    expect(order.payment.method).toBe(method)
    expect(order.payment.amount).toBe(200)
    expect(order.payment.paidAt).toBe(clock.now)
    const payment = structuredClone(order.payment)
    pay(order, method, 'failed', { ...clock, id: 'second' })
    expect(order.payment).toEqual(payment)
  })

  it('permits retry after a simulated failure or cancellation', () => {
    const order = submit(draft(), clock)
    pay(order, 'linepay', 'failed', clock)
    expect(order.payment.amount).toBe(0)
    expect(order.status).toBe('awaiting-payment')
    pay(order, 'card', 'cancelled', clock)
    expect(order.payment.status).toBe('cancelled')
    pay(order, 'card', 'succeeded', clock)
    expect(order.status).toBe('completed')
  })

  it('locks an uncertain outcome instead of claiming failure or retrying', () => {
    const order = submit(draft(), clock)
    pay(order, 'linepay', 'uncertain', clock)
    expect(order.status).toBe('payment-uncertain')
    const payment = structuredClone(order.payment)
    pay(order, 'card', 'succeeded', clock)
    expect(order.payment).toEqual(payment)
  })
})
