import { products, revision, tables } from './catalog.js'

/** Validated fixture selection; prices always come from the frozen catalog. */
export function selection(productId, quantity, extra = 0, note = '') {
  const product = products.find(item => item.id === productId)
  if (!product || !Number.isSafeInteger(quantity) || quantity < 1)
    throw new Error('請選擇品項並填寫正整數份數。')
  if (!Number.isInteger(extra) || extra < 0 || extra > (product.extraMax ?? 0))
    throw new Error('加量數量不正確。')
  const unitPrice = product.price + (product.extraPrice ?? 0) * extra
  if (!Number.isSafeInteger(unitPrice * quantity))
    throw new Error('餐點金額超出可精確計算的範圍。')
  return { productId, name: product.name, basePrice: product.price, extra, extraPrice: product.extraPrice ?? 0, unitPrice, quantity, note: String(note), subtotal: unitPrice * quantity }
}

/** Cart zero removes one row; positive changes preserve its configuration and identity. */
export function setCartQuantity(state, lineId, quantity) {
  const line = state.cart.find(item => item.lineId === lineId)
  if (!line || !Number.isSafeInteger(quantity) || quantity < 0)
    throw new Error('請確認購物車餐點與份數。')
  if (quantity === 0)
    state.cart = state.cart.filter(item => item.lineId !== lineId)
  else
    Object.assign(line, selection(line.productId, quantity, line.extra, line.note))
}

/** Local format checks only: this site never validates or issues an invoice. */
export function invoiceError(invoice) {
  const formats = { none: null, citizen: /^[A-Z]{2}\d{14}$/, carrier: /^\/[A-Z0-9+.-]{7}$/, tax: /^\d{8}$/, donation: /^\d{3,7}$/ }
  if (!(invoice.type in formats))
    return '請選擇發票方式。'
  if (formats[invoice.type] && !formats[invoice.type].test(invoice.code))
    return '請檢查發票編號格式。'
  if (!invoice.phone && !invoice.email)
    return '發票通知：手機號碼或 E-mail 請擇一填寫。'
  if (invoice.phone && !/^09\d{8}$/.test(invoice.phone))
    return '手機號碼須為 09 開頭的 10 碼數字。'
  if (invoice.email && !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(invoice.email))
    return '請輸入有效的 E-mail。'
}

/**
 * Creates a test-only immutable checkout snapshot. A checkout key owns exactly
 * one order: retries return that order, even after the mutable cart is cleared.
 * Storage is browser-local; no merchant, payment, or invoice API is contacted.
 */
export function submit(state, { id, now }) {
  const existing = state.orders.find(order => order.checkoutKey === state.checkoutKey)
  if (existing)
    return existing
  if (!tables.includes(state.table) || !state.cart.length)
    throw new Error('請選擇桌號並加入餐點。')
  const error = invoiceError(state.invoice)
  if (error)
    throw new Error(error)
  const items = state.cart.map(line => ({ ...selection(line.productId, line.quantity, line.extra, line.note), lineId: line.lineId }))
  const order = {
    schemaVersion: 1,
    environment: 'test',
    catalogRevision: revision,
    orderId: `TEST-${id}`,
    checkoutKey: state.checkoutKey,
    createdAt: now,
    vendorId: state.orders.length + 1,
    number: `TEST-${String(state.orders.length + 1).padStart(4, '0')}`,
    updatedAt: now,
    vendorStatus: 20,
    invoices: [],
    hasRefundedPayment: false,
    times: [{ order_status: 20, created_at: now, updated_at: now }],
    actions: [],
    table: state.table,
    currency: 'TWD',
    items,
    total: items.reduce((total, item) => total + item.subtotal, 0),
    invoice: { ...state.invoice },
    note: String(state.note).slice(0, 500),
    status: 'awaiting-payment',
    payment: { method: null, status: 'unpaid', amount: 0, paidAt: null, attemptId: null },
  }
  state.orders.unshift(order)
  state.cart = []
  return order
}

/** Terminal simulated outcomes may be replayed, but never changed or charged. */
export function pay(order, method, outcome, { id, now }) {
  if (order.status === 'cancelled' || order.payment.status === 'succeeded' || order.payment.status === 'uncertain')
    return order
  if (!['linepay', 'card'].includes(method) || !['succeeded', 'failed', 'cancelled', 'uncertain'].includes(outcome))
    throw new Error('無效的模擬付款選項。')
  order.payment = { method, status: outcome, amount: outcome === 'succeeded' ? order.total : 0, paidAt: outcome === 'succeeded' ? now : null, attemptId: `SIM-${id}` }
  order.status = outcome === 'succeeded' ? 'preparing' : outcome === 'uncertain' ? 'payment-uncertain' : 'awaiting-payment'
  order.updatedAt = now
  if (outcome === 'succeeded') {
    // Observed PB payment reached preparation50; fulfillment70 is a later event.
    // TEST invoice identities cannot be confused with the captured real invoice.
    order.vendorStatus = 50
    order.invoices = [{ id: order.vendorId, order_id: order.vendorId, hash: `TEST-INVOICE-${id}`, service: 'test', no: `TEST${String(order.vendorId).padStart(6, '0')}`, date: now, random_number: '0000', status: 20, created_at: now, updated_at: now }]
  }
  return order
}

/** Abandoning an unpaid order is distinct from canceling a payment attempt or refunding a paid order. */
export function abandonPayment(order, { now }) {
  if (order.payment.status === 'succeeded' || order.payment.status === 'uncertain')
    throw new Error('付款已成功或結果不明，不能當成未付款訂單取消。')
  if (order.status === 'cancelled')
    return order
  order.status = 'cancelled'
  order.vendorStatus = 79
  order.updatedAt = now
  order.payment.status = 'abandoned'
  return order
}
