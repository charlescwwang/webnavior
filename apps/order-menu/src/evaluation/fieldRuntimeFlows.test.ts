import type { CartSnapshot, MenuItem } from '../domain/order-machine'

import { expect, it, vi } from 'vitest'

import corpus from './fieldConversationFlows20261106.json'

import { createMenuToolRuntime } from '../webmcp'

// The fixture initializes the real runtime, never a second business engine.
// These are deterministic boundary chains; model routing is not scored here.
function fieldCase(id: string) {
  const value = corpus.cases.find(value => value.id === id)
  if (!value)
    throw new Error(`Missing field case ${id}`)
  return value
}

function catalog(): MenuItem[] {
  return corpus.catalog.items.map(item => ({ ...item, description: '', imageUrl: '', optionGroups: [], recommendationTags: [] }))
}

function runtimeFor(id: string) {
  const setup = fieldCase(id).setup
  const submit = vi.fn(async (cart: CartSnapshot) => ({ id: 'synthetic-order', cart, serviceMode: 'table-service' as const, receipt: { environment: 'test' as const, status: 'accepted' as const, retryable: false, customerMessage: '測試訂單已送出。' } }))
  const runtime = createMenuToolRuntime({ testing: true, menu: catalog(), gateway: { submit }, serviceContext: () => ({ id: 'synthetic-round', serviceMode: 'table-service', table: { id: 'a08', label: 'A08' }, directSubmissionSupported: true }), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  return { runtime, submit, setup }
}

// Report: docs/plans/2026-10-28-kiosk-conversation-repair.md, Nov06 case corpus.
it('regression K1106-STATE-01 rejects a different effect, then removes the actual line and accepts the next addition', async () => {
  const { runtime, setup } = runtimeFor('K1106-STATE-01')
  for (const line of setup.cart)
    await runtime.invoke('order_add_item', line)
  const before = await runtime.invoke('cart_get', { display: false }) as { cart: CartSnapshot }
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'first', transcript: '水餃先不要了', expectedMenuRevision: 0, constraints: {}, handoff: { intent: 'REMOVE_ITEM', status: 'resolved', itemIds: ['dumplings'], lineIds: [before.cart.lines[0]!.id] } })
  expect(await runtime.executeTool('order_set_fulfillment', { mode: 'takeout' })).toMatchObject({ ok: false })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: before.cart })
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'first' })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'correction', transcript: '我是說取消水餃，內用不變', expectedMenuRevision: 0, constraints: {}, handoff: { intent: 'REMOVE_ITEM', status: 'resolved', itemIds: ['dumplings'], lineIds: [before.cart.lines[0]!.id] } })
  await runtime.invokeForAgent('cart_remove_item', { lineId: before.cart.lines[0]!.id })
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'correction' })
  await runtime.invokeForAgent('order_add_item', { itemId: 'fried-pork-chop-bento', quantity: 1 })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { fulfillmentMode: 'dine-in', itemCount: 1, lines: [{ itemId: 'fried-pork-chop-bento', quantity: 1 }] } })
})

// Boundary control uses the full canonical name on the next turn; the corpus's
// abbreviated 「排骨」 remains a separate model/alias clarification acceptance.
it('regression K1106-STATE-02 corrects a successful wrong item without losing quantity or biasing the next addition', async () => {
  const { runtime, setup } = runtimeFor('K1106-STATE-02')
  for (const line of setup.cart)
    await runtime.invoke('order_add_item', line)
  const before = await runtime.invoke('cart_get', { display: false }) as { cart: CartSnapshot }
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'correction', transcript: '你點錯了，我要的是炸排骨便當，不是椒麻雞', expectedMenuRevision: 0, constraints: {} })
  expect(await runtime.invokeForAgent('order_add_item', { itemId: 'fried-pork-chop-bento', replaceLineId: before.cart.lines[0]!.id })).toHaveProperty('replacedLine.id', before.cart.lines[0]!.id)
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'correction' })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'next', transcript: '炸排骨便當再加一份', expectedMenuRevision: 0, constraints: {} })
  await runtime.invokeForAgent('order_add_item', { itemId: 'fried-pork-chop-bento', quantity: 1 })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2, lines: [{ itemId: 'fried-pork-chop-bento', quantity: 2 }] } })
})

it('regression K1106-STATE-04 isolates a new task from old END and old revision authority', async () => {
  const { runtime } = runtimeFor('K1106-STATE-04')
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'old', transcript: '水餃一份', expectedMenuRevision: 0, constraints: {} })
  await runtime.reset()
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'new', transcript: '我要炸排骨便當一份', expectedMenuRevision: 0, constraints: {} })
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'old' })
  await expect(runtime.invokeManual('order_add_item', { itemId: 'dumplings', quantity: 1 })).rejects.toThrow('AGENT_CONTROL')
  await runtime.invokeForAgent('order_add_item', { itemId: 'fried-pork-chop-bento', quantity: 1 })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { lines: [{ itemId: 'fried-pork-chop-bento' }], itemCount: 1 } })
})

it('regression K1106-STATE-05 never replays submission after losing its result', async () => {
  const { runtime, submit, setup } = runtimeFor('K1106-STATE-05')
  submit.mockRejectedValueOnce(new Error('Synthetic lost response'))
  for (const line of setup.cart)
    await runtime.invoke('order_add_item', line)
  const review = await runtime.invoke('checkout_start', { confirmedByUser: true }) as { pendingCustomerChoice: { questionId: string, question: string } }
  await runtime.invoke('kiosk_dialogue_presented', { content: review.pendingCustomerChoice.question, questionId: review.pendingCustomerChoice.questionId })
  await expect(runtime.invoke('checkout_start', { confirmedByUser: true })).rejects.toThrow()
  await expect(runtime.invoke('checkout_start', { confirmedByUser: true })).rejects.toThrow()
  await expect(runtime.confirmTableOrder()).rejects.toThrow('請勿重送')
  await expect(runtime.reset()).rejects.toThrow('請勿重新開始')
  expect(submit).toHaveBeenCalledTimes(1)
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 1)
})

it('regression K1106-MENU-01 derives the new name and merchant alias from the current catalog', async () => {
  const { runtime } = runtimeFor('K1106-MENU-01')
  runtime.setMenu(catalog().map(item => item.id === 'fried-pork-chop-bento' ? { ...item, name: '香酥排骨飯', aliases: ['排骨便當'] } : item), 'fixture-v2')
  await runtime.invoke('kiosk_fast_path_context', { transcript: '我要排骨便當一份' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { lines: [{ itemId: 'fried-pork-chop-bento', name: '香酥排骨飯', quantity: 1 }] } })
})

it('regression K1106-MENU-03 asks for the newly required option before accepting the dish', async () => {
  const { runtime } = runtimeFor('K1106-MENU-03')
  runtime.setMenu(catalog().map(item => item.id === 'beef-noodle-soup' ? { ...item, optionGroups: [{ id: 'noodle', label: '麵條', required: true, values: [{ id: 'thin', label: '細麵', priceDelta: 0 }, { id: 'wide', label: '寬麵', priceDelta: 0 }] }] } : item), 'fixture-v2')
  await runtime.invoke('kiosk_fast_path_context', { transcript: '我要牛肉麵一份' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '寬麵' }) as { candidates: Array<{ id: string }> }
  const answer = context.candidates.find(candidate => candidate.id.endsWith(':noodle:wide'))
  expect(answer).toBeDefined()
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: answer!.id })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'beef-noodle-soup', options: { noodle: 'wide' } }] } })
})

// Report: Nov06 MENU-02; availability changes advance menu, not cart revision.
it('regression K1106-MENU-02 invalidates a shown submission question after availability changes', async () => {
  const { runtime, submit } = runtimeFor('K1106-MENU-02')
  await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
  const reviewed = await runtime.invoke('checkout_start', { confirmedByUser: true }) as { pendingCustomerChoice: { questionId: string, question: string } }
  await runtime.invoke('kiosk_dialogue_presented', { content: reviewed.pendingCustomerChoice.question, questionId: reviewed.pendingCustomerChoice.questionId })
  await runtime.invoke('kiosk_test_menu', { itemId: 'dumplings', state: 'sold-out' })
  await runtime.invoke('checkout_start', { confirmedByUser: true })
  expect(submit).not.toHaveBeenCalled()
})

// Report: Nov06 MENU-01 alias-conflict variant; an exact string can name two products.
it('regression K1106-MENU-01 refuses to guess either product when a merchant alias is shared', async () => {
  const { runtime } = runtimeFor('K1106-MENU-01')
  runtime.setMenu(catalog().map(item => ['fried-pork-chop-bento', 'spicy-chicken-bento'].includes(item.id) ? { ...item, aliases: ['排骨便當'] } : item), 'fixture-v2')
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'alias-collision', transcript: '我要排骨便當一份', expectedMenuRevision: 1, constraints: {} })
  expect(await runtime.invokeForAgent('order_add_item', { itemId: 'fried-pork-chop-bento', quantity: 1 })).toMatchObject({ ok: false, executed: false })
  expect(await runtime.invokeForAgent('order_add_item', { itemId: 'spicy-chicken-bento', quantity: 1 })).toMatchObject({ ok: false, executed: false })
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})
