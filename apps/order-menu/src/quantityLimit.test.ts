import { conversationContextSchema, quantityLimitRejectionSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it } from 'vitest'

import { createOrderMachine } from './domain/order-machine'
import { mentionedServingCounts, QuantityLimitError } from './domain/quantityPolicy'
import { createMenuToolRuntime } from './webmcp'

const options = { onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} }

// Report: this chat, Nov2 15:51; 200 signature and 200 pork-chop bentos became an unfinished reply.
it.each([21, 100, 200])('returns an authoritative %s quantity rejection and preserves the existing cart', async (quantity) => {
  const runtime = createMenuToolRuntime(options)
  await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll', quantity: 1 })
  const before = await runtime.invoke('cart_get', { display: false }) as { cart: object }
  const result = await runtime.executeTool('order_add_item', { itemId: 'chous-shrimp-roll', quantity })
  expect(parse(quantityLimitRejectionSchema, result)).toMatchObject({ ok: false, executed: false, error: 'QUANTITY_LIMIT', maximum: 20, requestedQuantity: quantity })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: before.cart })
})

it.each(['我要21份周氏蝦捲', '我要200份周氏蝦捲', '我要兩百份周氏蝦捲'])('does not turn the explicit oversized request %s into a missing-quantity question or one serving', async (transcript) => {
  const runtime = createMenuToolRuntime(options)
  await runtime.invoke('kiosk_fast_path_context', { transcript })
  const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  expect(parse(quantityLimitRejectionSchema, result).maximum).toBe(20)
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

it('keeps 20 servings valid and publishes the same current quantity policy to Main', async () => {
  const runtime = createMenuToolRuntime(options)
  await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll', quantity: 20 })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(context.cart.itemCount).toBe(20)
  expect(context.quantityPolicy?.maximum).toBe(20)
  expect(context.quantityPolicy?.message).toContain('20')
})

it('rejects an oversized answer without corrupting the retained missing-quantity draft', async () => {
  const runtime = createMenuToolRuntime(options)
  await runtime.invoke('kiosk_fast_path_context', { transcript: '周氏蝦捲' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '兩百份' }) as { candidates: Array<{ id: string }> }
  const answer = context.candidates.find(choice => choice.id.includes(':quantity:'))
  expect(answer).toBeDefined()
  const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: answer!.id })
  expect(parse(quantityLimitRejectionSchema, result).requestedQuantity).toBe(200)
  const after = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(after.cart.itemCount).toBe(0)
  expect(after.retainedRequests.every(request => request.quantity === undefined || request.quantity <= 20)).toBe(true)
})

it('rejects merging another serving into20 without changing the existing cart', async () => {
  const runtime = createMenuToolRuntime(options)
  await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll', quantity: 20 })
  const result = await runtime.executeTool('order_add_item', { itemId: 'chous-shrimp-roll', quantity: 1 })
  expect(parse(quantityLimitRejectionSchema, result).maximum).toBe(20)
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 20, lines: [{ quantity: 20 }] } })
})

// Report: this chat, Nov2; quantity refusal must preserve the original cart variants.
it('rejects an option change that would merge more than20 servings without changing either line', () => {
  const machine = createOrderMachine()
  machine.selectMenuItem('chous-shrimp-roll')
  machine.setQuantity(20)
  machine.addToCart()
  machine.selectMenuItem('chous-shrimp-roll')
  machine.setItemOption('ginger', 'without-ginger')
  const { line } = machine.addToCart()
  const before = machine.getCart()
  const revisions = machine.getRevisions()
  expect(() => machine.setCartLineOption(line.id, 'ginger', 'with-ginger')).toThrow(QuantityLimitError)
  expect(machine.getCart()).toEqual(before)
  expect(machine.getRevisions()).toEqual(revisions)
})

// Report: Q01-J-B3 acceptance; first-count parsing rejected the negated200 instead of preserving the correction.
it('hands multiple explicit counts to Main instead of compiling the first count', async () => {
  const runtime = createMenuToolRuntime(options)
  await runtime.invoke('kiosk_fast_path_context', { transcript: '不要200份周氏蝦捲，改成一份周氏蝦捲就好' })
  expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })).toMatchObject({ needsAssistant: true })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

it.each([
  ['排骨便當200份，招牌便當100份', [200, 100]],
  ['兩百份招牌便當、一百份排骨便當', [200, 100]],
  ['不要200份排骨便當，改成一份', [200, 1]],
  ['200元以內，排骨便當一份', [1]],
])('extracts raw count evidence without treating budgets as portions: %s', (transcript, expected) => {
  expect(mentionedServingCounts(transcript)).toEqual(expected)
})
