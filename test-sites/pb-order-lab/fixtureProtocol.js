import { basePath, products, revision } from './catalog.js'

/** Submitted records now retain business identity, preparation and invoice data. */
export const sessionSchemaVersion = 2

// PB serializes local wall-clock strings without an offset. Keep that protocol
// distinct from the fixture's ISO timestamps and never reinterpret it as UTC.
function vendorTime(value) {
  return new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei', hour12: false })
}

function submittedPage(order, url, origin) {
  const choosing = new URL(url, origin).pathname.endsWith('/choosePayment')
  const methods = { none: 5, citizen: 2, carrier: 3, tax: 4, donation: 6 }
  const labels = { 20: '待付款', 50: '接單製作中', 79: '未付款取消' }
  const created = vendorTime(order.createdAt)
  const updated = vendorTime(order.updatedAt)
  const record = {
    id: order.vendorId,
    hash: order.orderId,
    number: order.number,
    organization_id: 1,
    user_coupon_id: null,
    line_user_id: null,
    buyer_type: 'cookie',
    buyer_id: 1,
    type: 'order',
    flow_type: 'internal_use',
    dining_table_id: 1,
    dining_table: { id: 1, name: order.table },
    pick_up_date: created.slice(0, 10),
    pick_up_time: created.slice(11, 16),
    payment: order.payment.status === 'succeeded' ? order.payment.method === 'linepay' ? 'LinePay' : 'Credit' : null,
    payment_label: order.payment.status === 'succeeded' ? order.payment.method === 'linepay' ? 'LINE Pay' : '信用卡' : '未付款',
    subtotal: order.total,
    discount: 0,
    tax: 0,
    delivery_fee: 0,
    other_costs: 0,
    totalmoney: order.total,
    CarrierType: methods[order.invoice.type],
    CarrierNum: ['citizen', 'carrier'].includes(order.invoice.type) ? order.invoice.code : null,
    CustomerIdentifier: order.invoice.type === 'tax' ? order.invoice.code : null,
    LoveCode: order.invoice.type === 'donation' ? order.invoice.code : null,
    CustomerPhone: order.invoice.phone || null,
    CustomerEmail: order.invoice.email || null,
    status: order.vendorStatus,
    order_status_label: labels[order.vendorStatus],
    cancel_enabled: true,
    cancel_after_accept: false,
    cancel_deadline_at: null,
    note: order.note,
    execute_refund_times: 0,
    refunded_at: null,
    approve_note: null,
    approved_at: null,
    created_at: created,
    updated_at: updated,
    deleted_at: null,
    has_refunded_payment: order.hasRefundedPayment,
    user_coupon: null,
    invoices: order.invoices.map(invoice => ({ ...invoice, date: vendorTime(invoice.date), created_at: vendorTime(invoice.created_at), updated_at: vendorTime(invoice.updated_at) })),
    times: order.times.map((time, index) => ({ ...time, id: index + 1, order_id: order.vendorId, created_at: vendorTime(time.created_at), updated_at: vendorTime(time.updated_at) })),
    actions: order.actions,
  }
  const details = order.items.map((line, index) => {
    const product = products.find(product => product.id === line.productId)
    return { id: index + 1, order_id: order.vendorId, from_id: null, item_type: 'product', item_id: product.vendorId, buyer_name: null, add_from: 'test', ai_conversation_id: null, amount: line.quantity, unit_price: line.unitPrice, price: line.subtotal, other_costs: 0, change_logs: [], status: 10, note: line.note, created_at: created, updated_at: updated, item: { id: product.vendorId, name: product.name }, product_prices: [{ item_type: 'product', item_id: product.vendorId, parent_id: null, product_attrs: line.extra ? [{ attr_id: 774, amount: line.extra, unit_price: 8, attr: { name: '水餃1顆' } }] : [] }] }
  })
  return { component: choosing ? 'Order/ChoosePayment' : 'Order/Show', url, version: revision, props: {
    storeHash: '1kgJeql',
    flowType: 'internal_use',
    buyer: { type: 'cookie' },
    order: record,
    ...(choosing ? { payMethods: [{ title: 'LINE Pay', url: `${origin}/order/linepay/redirect/${order.orderId}/LinePay` }, { title: '信用卡', url: `${origin}/order/ecpay/redirect/${order.orderId}/Credit` }] } : { details, canCancel: false, searchInvoiceUrl: '/test/invoice' }),
  } }
}

/** PB's published route declaration, consumed by the existing finite resolver. */
export function routeRegistry(origin) {
  const routes = {}
  for (const [name, suffix, method, tail] of [
    ['shopping.menu.categories', 'menu-categories', 'GET', []],
    ['shopping.getAttrByProduct', 'getAttrByProduct/{product}', 'GET', ['product']],
    ['shopping.orders.details.store', 'orders/{order}/details/store', 'POST', ['order']],
    ['shopping.orders.details.destroy', 'orders/{order}/details/{detail}', 'DELETE', ['order', 'detail']],
    ['shopping.orders.details.update', 'orders/{order}/details/{detail}', 'PUT', ['order', 'detail']],
  ]) {
    routes[name] = { uri: `store/{store}/{flow_type}/${suffix}`, methods: [method], parameters: ['store', 'flow_type', ...tail] }
  }
  return { url: `${origin}/order`, routes }
}

/** Projects the test draft into the vendor page protocol; no real buyer data. */
export function pageSnapshot(state, url) {
  const requested = new URL(url, 'http://127.0.0.1:5188')
  const path = requested.pathname
  const submittedOrder = state.orders.find(order => path === `${basePath}/orders/${order.orderId}` || path === `${basePath}/orders/${order.orderId}/choosePayment`)
  if (submittedOrder)
    return submittedPage(submittedOrder, url, requested.origin)
  const table = path.endsWith('/select-table')
  const menu = path.endsWith('/menu')
  // PB retains its draft identity after the last row is deleted. Dropping it
  // here would look like a different customer's cart during write verification.
  // Submission retires that draft. Advertising its old hash in an empty new
  // cart would make the next legitimate add look like an unexpected order swap.
  const submitted = state.orders.some(order => order.checkoutKey === state.checkoutKey)
  const order = !submitted && (state.draftStarted || state.cart.length) ? { hash: `TEST-DRAFT-${state.checkoutKey}`, pick_up_date: '2026-11-13', pick_up_time: '12:00' } : null
  const details = state.cart.map((line) => {
    const product = products.find(product => product.id === line.productId)
    return {
      id: line.vendorLineId,
      amount: line.quantity,
      unit_price: line.unitPrice,
      note: line.note,
      item_type: 'product',
      item: { id: product.vendorId, name: product.name },
      product_prices: [{ item_type: 'product', item_id: product.vendorId, parent_id: null, product_attrs: line.extra ? [{ attr_id: 774, amount: line.extra, unit_price: 8, attr: { name: '水餃1顆' } }] : [] }],
    }
  })
  return {
    component: table ? 'Menu/SelectTable' : menu ? 'Menu/Show' : 'Order/Create',
    url,
    version: revision,
    props: {
      storeHash: '1kgJeql',
      flowType: 'internal_use',
      buyer: { type: 'cookie' },
      diningTables: state.tables.map(name => ({ name })),
      // The selection page starts a new selection and does not publish cart context.
      ...(!table
        ? {
            diningTable: state.table || null,
            defaultPickUpDate: '2026-11-13',
            defaultPickUpTime: '12:00',
            order,
            details,
            subtotal: state.cart.reduce((total, line) => total + line.subtotal, 0),
          }
        : {}),
    },
  }
}
