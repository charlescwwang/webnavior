import { expect, it } from 'vitest'

import { historicalSupplierCatalog as supplierCatalog } from '../../order-menu-server/src/fixtures/historicalSupplierCatalog'
import { applySupplierOrdering } from './supplierOrdering'
import { createMenuToolRuntime } from './webmcp'

function setup() {
  return createMenuToolRuntime({ menu: applySupplierOrdering(supplierCatalog.items), merchant: { id: 'shalun-simulation', operatorName: '周氏蝦捲', paymentPolicy: 'cashless' }, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: () => {} })
}

// Report: this chat Nov09, field02:52–02:55 — true short names did not select the displayed meal.
it.each([
  ['焢肉飯', 'supplier-item-03'],
  ['紅燒牛肉麵', 'supplier-item-09'],
  ['麻辣牛肉麵', 'supplier-item-10'],
])('uses a merchant-page alias for %s without inventing a different preparation', async (query, id) => {
  const runtime = setup()
  expect(await runtime.invoke('menu_get', { query })).toMatchObject({ matchKind: 'literal', items: [{ id }] })
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

// Report: field02:57–02:58 — unavailable braised chicken was worded as the same fried/roast dish.
it('offers alternatives to an absent preparation without a collective yes/no question', async () => {
  const runtime = setup()
  const result = await runtime.invoke('menu_get', { query: '滷雞腿' })
  expect(result).toHaveProperty('customerMessage', expect.stringContaining('菜單沒有「滷雞腿」'))
  expect(result).toHaveProperty('customerMessage', expect.stringContaining('其他可選'))
  expect(result).toHaveProperty('customerMessage', expect.not.stringContaining('您想找的是'))
  expect(result).toHaveProperty('customerMessage', expect.stringContaining('哪一道'))
})

it('asks one explicit alternative-consent question after the purchase lookup', async () => {
  const runtime = setup()
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'alternative', transcript: '滷雞腿便當一份', expectedMenuRevision: 0, constraints: {} })
  await runtime.invoke('kiosk_conversation_context')
  const lookup = await runtime.invokeForAgent('menu_get', { query: '滷雞腿便當' })
  expect(lookup).not.toHaveProperty('customerReply.nextQuestion')
  await runtime.invoke('kiosk_conversation_context')
  const proposed = await runtime.invokeForAgent('menu_confirm_item', { itemId: 'supplier-item-01' })
  expect(proposed).toHaveProperty('pendingCustomerChoice.question', expect.stringContaining('要改點炸雞腿便當嗎'))
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

// Report: field03:02 — asking ordered dumpling pieces returned only the base catalog description.
it('reports ordered dumpling pieces even when the Host invokes a menu lookup', async () => {
  const runtime = setup()
  await runtime.invoke('order_add_item', { itemId: 'supplier-item-08', quantity: 1, options: [{ groupId: 'extra-pieces', valueId: 'extra-1' }] })
  const before = await runtime.invoke('cart_get', { display: false })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'pieces', transcript: '我水餃是幾顆啊', readOnly: true, expectedMenuRevision: 0, constraints: {} })
  const lookup = await runtime.invokeForAgent('menu_get', { query: '水餃' })
  expect(lookup).toHaveProperty('customerMessage', expect.stringContaining('每份9顆'))
  expect(lookup).toHaveProperty('customerMessage', expect.stringContaining('共9顆'))
  expect(lookup).not.toHaveProperty('pendingCustomerChoice')
  expect(await runtime.invokeForAgent('cart_get', { display: true })).toHaveProperty('customerMessage', expect.stringContaining('每份9顆'))
  expect(await runtime.invoke('cart_get', { display: false })).toEqual(before)
})

it('keeps two different dumpling add-on specifications in separate lines', async () => {
  const runtime = setup()
  for (const extra of [3, 10])
    await runtime.invoke('order_add_item', { itemId: 'supplier-item-08', quantity: 1, options: [{ groupId: 'extra-pieces', valueId: `extra-${extra}` }] })
  const result = await runtime.invoke('cart_get', { display: true })
  expect(result).toMatchObject({ cart: { itemCount: 2, total: 232, lines: [{ quantity: 1, unitPrice: 88 }, { quantity: 1, unitPrice: 144 }] } })
  expect(result).toHaveProperty('customerMessage', expect.stringContaining('每份11顆'))
  expect(result).toHaveProperty('customerMessage', expect.stringContaining('每份18顆'))
})

it('retains other subjects when adding cart-piece facts to a multi-dish inquiry', async () => {
  const runtime = setup()
  await runtime.invoke('order_add_item', { itemId: 'supplier-item-08', quantity: 1, options: [{ groupId: 'extra-pieces', valueId: 'extra-1' }] })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'multiple', transcript: '水餃和控肉飯有嗎', readOnly: true, expectedMenuRevision: 0, constraints: {} })
  const result = await runtime.invokeForAgent('menu_get', { queries: ['水餃', '控肉飯'] })
  expect(result).toHaveProperty('customerMessage', expect.stringContaining('控肉飯'))
  expect(result).toHaveProperty('customerMessage', expect.stringContaining('每份9顆'))
})
