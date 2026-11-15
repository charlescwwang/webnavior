import { products, revision } from './catalog.js'

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
  const path = new URL(url, 'http://127.0.0.1:5188').pathname
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
      product_prices: [{ item_type: 'product', item_id: product.vendorId, parent_id: null, product_attrs: line.extra ? [{ attr_id: 774, amount: line.extra, unit_price: 8, attr: { name: '水餃' } }] : [] }],
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
