import { expect, it } from 'vitest'

import { readCartPage } from '../../packages/stage-ui/src/services/pbCart'
import { readCatalog } from '../../packages/stage-ui/src/services/pbCatalog'
import { resolveRoute } from '../../packages/stage-ui/src/services/pbRoutes'
import { categories, products, tables } from './catalog.js'
import { pageSnapshot, routeRegistry } from './fixtureProtocol.js'
import { selection, submit } from './order.js'

it('passes the captured menu and attributes through the actual PB catalog parser', async () => {
  const result = await readCatalog({
    menu: async () => ({ menuCategories: categories.map(category => ({ ...category, id: Number(category.id) })), defaultPickUpDate: '2026-11-13', defaultPickUpTime: '12:00' }),
    category: async ({ categoryId }) => ({ products: products.filter(product => product.categoryId === String(categoryId)).map(product => ({ ...product, id: product.vendorId })), productGroups: [] }),
    attributes: async id => products.find(product => product.vendorId === id).attributes,
  }, { scope: 'http://127.0.0.1:5188' })
  expect(result.complete).toBe(true)
  expect(result.products).toHaveLength(13)
  expect(result.products.find(product => product.ref === 'p-2596').price).toBe(136)
  expect(result.products.find(product => product.ref === 'p-2589').configurations[0].groups[0].choices[0]).toMatchObject({ ref: 'a-774', unitPrice: 8 })
})

// Report: this chat, 2026-11-13; deleting the final fixture row lost its order
// context and made the real PB executor classify a verified removal as unknown.
it('retains PB draft context when its final line is removed', () => {
  const state = { table: 'A1 桌', tables, orders: [], checkoutKey: 'cart-1', draftStarted: true, cart: [{ ...selection('dumplings', 2, 2), lineId: 'one', vendorLineId: 1 }] }
  const before = readCartPage(pageSnapshot(state, '/orders/create').props, { date: '', time: '' }, 0)
  state.cart = []
  const after = readCartPage(pageSnapshot(state, '/orders/create').props, { date: '', time: '' }, 0)
  expect(after.context).toEqual(before.context)
  expect(after.lines).toEqual([])
  expect(after.subtotal).toBe(0)
})

// Report: this chat, Nov15: a new visitor must not inherit the submitted order as a mutable draft.
it('does not advertise a submitted order as the next empty cart draft', () => {
  const state = { table: 'A1 桌', tables, checkoutKey: 'submitted', draftStarted: true, cart: [{ ...selection('dumplings', 1), lineId: 'one', vendorLineId: 1 }], orders: [], invoice: { type: 'none', code: '', phone: '0912345678', email: '' }, note: '' }
  const order = submit(state, { id: 'one', now: '2026-11-15T06:00:00Z' })
  const after = readCartPage(pageSnapshot(state, '/order/store/1kgJeql/internal_use/menu').props, { date: '2026-11-13', time: '12:00' }, 0)
  expect(after.lines).toEqual([])
  expect(after.context.orderRef).toBeUndefined()
  expect(state.orders).toEqual([order])
  expect(order.status).toBe('awaiting-payment')
})

it('resolves only the same local vendor routes with the existing route parser', () => {
  const origin = 'http://127.0.0.1:5188'
  const script = `const Ziggy=${JSON.stringify(routeRegistry(origin))};`
  const expected = new URL(`${origin}/order/store/1kgJeql/internal_use/getAttrByProduct/2589`)
  expect(resolveRoute('shopping.getAttrByProduct', ['1kgJeql', 'internal_use', '2589'], expected, [script]).href).toBe(expected.href)
  expect(() => resolveRoute('shopping.getAttrByProduct', ['other', 'internal_use', '2589'], expected, [script])).toThrow()
})

// Report: this chat, Nov14 live Menu/SelectTable props omit the previous draft.
it('does not expose old table or cart props on the table selection page', () => {
  const state = { table: 'B3 吧檯', tables, orders: [], checkoutKey: 'cart-1', draftStarted: true, cart: [{ ...selection('dumplings', 1), vendorLineId: 1 }] }
  const page = pageSnapshot(state, '/order/store/1kgJeql/internal_use/menu/select-table')
  expect(page.component).toBe('Menu/SelectTable')
  expect(page.props.diningTables).toHaveLength(11)
  expect(page.props).not.toHaveProperty('diningTable')
  expect(page.props).not.toHaveProperty('order')
  expect(page.props).not.toHaveProperty('details')
})
