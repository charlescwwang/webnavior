import { expect, it } from 'vitest'

import { historicalSupplierCatalog as supplierCatalog } from '../../order-menu-server/src/fixtures/historicalSupplierCatalog'
import { applySupplierOrdering } from './supplierOrdering'
import { createMenuToolRuntime } from './webmcp'

// Report: this chat Nov09 — ask dumpling add-on pieces before asking serving count.
it.each(['extra-0', 'extra-2'])('confirms %s before servings without adding a cart line early', async (valueId) => {
  const runtime = createMenuToolRuntime({ menu: applySupplierOrdering(supplierCatalog.items), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const first = await runtime.invoke('menu_get', { query: '周氏水餃' }) as { customerMessage: string, pendingCustomerChoice: { question: string, questionId: string } }
  expect(first.pendingCustomerChoice.question).toBe('要點這道餐點嗎？')
  await runtime.invoke('kiosk_dialogue_presented', { content: first.customerMessage, questionId: first.pendingCustomerChoice.questionId })
  expect(first).not.toHaveProperty('cart')
  await runtime.invoke('kiosk_fast_path_context', { transcript: '好' })
  const consent = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' }) as { customerMessage: string, pendingCustomerChoice: { questionId: string } }
  await runtime.invoke('kiosk_dialogue_presented', { content: consent.customerMessage, questionId: consent.pendingCustomerChoice.questionId })
  const context = await runtime.invoke('kiosk_fast_path_context', { transcript: valueId === 'extra-0' ? '不加量' : '加2顆' }) as { candidates: Array<{ id: string }> }
  const choice = context.candidates.find(choice => choice.id.endsWith(`:extra-pieces:${valueId}`))!
  expect(choice).toBeDefined()
  const second = await runtime.invoke('kiosk_fast_path_execute', { candidateId: choice.id })
  expect(second).toMatchObject({ pendingCustomerChoice: { question: '請問周氏水餃(最低8顆)要幾份？' } })
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  const quantity = await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' }) as { candidates: Array<{ id: string }> }
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: quantity.candidates.find(choice => choice.id.includes(':quantity:2'))!.id })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2, total: valueId === 'extra-0' ? 128 : 160, lines: [{ quantity: 2, options: { 'extra-pieces': valueId } }] } })
})

it('uses adjacent piece controls for Agent selection and cart edits', async () => {
  const controls: Array<string | undefined> = []
  const runtime = createMenuToolRuntime({ menu: applySupplierOrdering(supplierCatalog.items), onAction: (action) => {
    controls.push(action.controlId)
  }, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('order_add_item', { itemId: 'supplier-item-08', quantity: 2, options: [{ groupId: 'extra-pieces', valueId: 'extra-3' }] })
  expect(controls.filter(id => id?.includes('extra-pieces'))).toEqual([
    'supplier-item-08:option:extra-pieces:extra-1',
    'supplier-item-08:option:extra-pieces:extra-2',
    'supplier-item-08:option:extra-pieces:extra-3',
  ])
  const cart = await runtime.invoke('cart_get', { display: false }) as { cart: { lines: Array<{ id: string }> } }
  controls.length = 0
  const result = await runtime.invoke('cart_set_line_option', { lineId: cart.cart.lines[0]!.id, groupId: 'extra-pieces', valueId: 'extra-1' })
  expect(result).toHaveProperty('cart.total', 144)
  expect(controls.filter(id => id?.includes('extra-pieces')).map(id => id?.split(':').at(-1))).toEqual(['extra-2', 'extra-1'])
})

// Report: this chat Nov09 — price inquiry entered add-on configuration before purchase consent.
it('keeps a dumpling inquiry outside configuration until the customer accepts ordering', async () => {
  const runtime = createMenuToolRuntime({ menu: applySupplierOrdering(supplierCatalog.items), merchant: { id: 'shalun-simulation', paymentPolicy: 'cashless' }, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const receipt = await runtime.invoke('menu_get', { query: '周氏水餃' }) as { customerMessage: string, pendingCustomerChoice: { questionId: string, question: string } }
  expect(receipt.pendingCustomerChoice.question).toBe('要點這道餐點嗎？')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '好' })).toHaveProperty('phase', 'ordering')
  await runtime.invoke('kiosk_dialogue_presented', { content: receipt.customerMessage, questionId: receipt.pendingCustomerChoice.questionId })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '好' })
  const ordered = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  expect(ordered).toHaveProperty('pendingCustomerChoice.question', '水餃每份基本8顆，要加量嗎？不加量也可以；若要加量，請說每份加幾顆（最多100顆，每顆8元）。')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

it('explains the actual dumpling line price on a fast-path inquiry and guides back to order review', async () => {
  const runtime = createMenuToolRuntime({ menu: applySupplierOrdering(supplierCatalog.items), merchant: { id: 'shalun-simulation', paymentPolicy: 'cashless' }, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const added = await runtime.invoke('order_add_item', { itemId: 'supplier-item-08', quantity: 3, options: [{ groupId: 'extra-pieces', valueId: 'extra-3' }] }) as { customerMessage: string, pendingCustomerChoice: { questionId: string } }
  await runtime.invoke('kiosk_dialogue_presented', { content: added.customerMessage, questionId: added.pendingCustomerChoice.questionId })
  const receipt = await runtime.invoke('menu_get', { query: '周氏水餃' }) as { customerMessage: string }
  expect(receipt.customerMessage).toContain('每份88元')
  expect(receipt.customerMessage).toContain('3份共264元')
  expect(receipt.customerMessage).toContain('請問要內用還是自取？')
  expect(receipt.customerMessage).not.toContain('您想點哪一道')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.total', 264)
})
