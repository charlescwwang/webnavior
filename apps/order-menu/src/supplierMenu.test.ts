import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it } from 'vitest'

import { createPosBridgeApp } from '../../order-menu-server/src/app'
import { historicalSupplierCatalog } from '../../order-menu-server/src/fixtures/historicalSupplierCatalog'
import { createInMemorySimulatorGateway } from '../../order-menu-server/src/simulator'
import { supplierCatalog } from '../../order-menu-server/src/supplierSimulation'
import { createMenuToolRuntime } from './webmcp'

// Report: this chat Nov09 — supplier.html still loaded the runtime from before the original page's fixes.
it.each(['A套餐', 'B 套餐'])('uses the shared presented quantity invitation for the new menu: %s', async (name) => {
  const runtime = createMenuToolRuntime({ menu: supplierCatalog.items, merchant: { id: 'shalun-simulation', paymentPolicy: 'cashless', operatorName: '周氏蝦捲' }, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: () => {} })
  const item = supplierCatalog.items.find(item => item.name === name)!
  const receipt = await runtime.invoke('menu_get', { query: name }) as { customerMessage: string, pendingCustomerChoice: { questionId: string, purpose: string } }
  expect(receipt.pendingCustomerChoice.purpose).toBe('item-order')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  await runtime.invoke('kiosk_dialogue_presented', { content: receipt.customerMessage, questionId: receipt.pendingCustomerChoice.questionId })
  expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '一份' })).toHaveProperty('waitingFor.questionId', receipt.pendingCustomerChoice.questionId)
  expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })).not.toHaveProperty('ok', false)
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, total: item.price, lines: [{ itemId: item.id, quantity: 1, unitPrice: item.price }] } })
})

it('keeps the new merchant catalog and confirmed prices separate from the original', async () => {
  const original = createInMemorySimulatorGateway()
  const supplier = createInMemorySimulatorGateway('accepted', 'authorized', Date.now, 'after-order', supplierCatalog)
  const first = await original.getCatalog()
  const next = await supplier.getCatalog()
  expect(next.items).toHaveLength(15)
  expect(new Set(next.items.map(item => item.category))).toEqual(new Set(['飯區', '麵區']))
  expect(next.items.find(item => item.name === '炸排骨便當')?.price).toBe(130)
  expect(next.items.find(item => item.name === '椒香麻辣牛肉麵')?.price).toBe(230)
  expect(next.items.find(item => item.name === 'A套餐')?.price).toBe(130)
  expect(next.items.find(item => item.name === 'B 套餐')?.price).toBe(145)
  expect(next.items.every(item => !first.items.some(previous => previous.id === item.id))).toBe(true)
  expect(next.items.filter(item => item.imageUrl)).toHaveLength(3)
  expect(next.items.every(item => !item.composition.complete)).toBe(true)
  const app = createPosBridgeApp({ allowedOrigin: 'http://menu.test', authenticate: async () => 'device', gateway: supplier, tableAssignment: 'after-order' })
  const response = await app.request('/v1/catalog')
  expect(response.status).toBe(200)
  expect((await response.json()).catalog.revision).toBe(supplierCatalog.revision)
})

it('keeps historical dumpling servings separate from the 0–100 per-serving add-on', async () => {
  const runtime = createMenuToolRuntime({ menu: historicalSupplierCatalog.items, merchant: { id: 'shalun-simulation', paymentPolicy: 'cashless', operatorName: '周氏蝦捲' }, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const item = historicalSupplierCatalog.items.find(item => item.name.includes('周氏水餃'))!
  expect(item.price).toBe(64)
  expect(item.optionGroups[0]?.values).toHaveLength(101)
  const result = await runtime.invoke('order_add_item', { itemId: item.id, quantity: 2, options: [{ groupId: 'extra-pieces', valueId: 'extra-2' }] })
  expect(result).toMatchObject({ cart: { itemCount: 2, total: 160, lines: [{ quantity: 2, unitPrice: 80 }] } })
  const context = await runtime.invoke('kiosk_conversation_context')
  expect(context).toMatchObject({ merchant: { id: 'shalun-simulation', paymentPolicy: 'cashless' } })
  await expect(runtime.invoke('order_add_item', { itemId: item.id, quantity: 1, options: [{ groupId: 'extra-pieces', valueId: 'extra-101' }] })).rejects.toThrow()
  expect(await runtime.invoke('cart_get')).toMatchObject({ cart: { itemCount: 2, total: 160 } })
  const snapshot = parse(conversationContextSchema, context)
  const lineId = snapshot.cart.lines[0]!.id
  expect(await runtime.invoke('cart_set_line_option', { lineId, groupId: 'extra-pieces', valueId: 'extra-100' })).toMatchObject({ cart: { total: 1728 } })
  expect(await runtime.invoke('cart_set_line_option', { lineId, groupId: 'extra-pieces', valueId: 'extra-0' })).toMatchObject({ cart: { total: 128 } })
})

// Report: this chat Nov09 — removal must apply to tool targets as well as cards.
it('removes supplier dumplings from lookup and rejects attempts to add the retired ID', async () => {
  const runtime = createMenuToolRuntime({ menu: supplierCatalog.items, merchant: { id: 'shalun-simulation', operatorName: '周氏蝦捲', paymentPolicy: 'cashless' }, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: () => {}, onMenuRequested: () => {} })
  const result = await runtime.invoke('menu_get', { query: '周氏水餃' }) as { items: unknown[], customerMessage: string }
  expect(result.items).toEqual([])
  expect(result.customerMessage).toContain('查不到')
  await expect(runtime.invoke('order_add_item', { itemId: 'supplier-item-08', quantity: 1 })).rejects.toThrow()
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})
