import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it } from 'vitest'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct30 addition.
it.each(['unique', 'none', 'multiple', 'late-read', 'different-item', 'acknowledgement'] as const)('binds only a unique pre-task domain target: %s', async (scenario) => {
  const runtime = createMenuToolRuntime({ menu: [
    { ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], category: '點心', optionGroups: [] },
    { ...menu[0]!, id: 'noodles', name: '牛肉麵', aliases: [], category: '麵食', optionGroups: [] },
  ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  if (scenario === 'unique' || scenario === 'different-item' || scenario === 'acknowledgement')
    await runtime.invoke('menu_get', { query: '水餃' })
  if (scenario === 'multiple')
    await runtime.invoke('menu_get', { queries: ['水餃', '牛肉麵'] })
  const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'reference', transcript: scenario === 'acknowledgement' ? '對' : '那我要三份', expectedMenuRevision: before.revisions.menu, constraints: {} })
  await runtime.invoke('kiosk_conversation_context')
  if (scenario === 'late-read')
    await runtime.invokeForAgent('menu_get', { query: '水餃' })
  if (scenario === 'different-item')
    await runtime.invokeForAgent('menu_get', { query: '牛肉麵' })
  await runtime.invoke('kiosk_conversation_context')
  if (!['unique', 'different-item'].includes(scenario)) {
    await expect(runtime.invokeForAgent('order_add_item', { itemId: 'dumplings', quantity: 3 })).rejects.toThrow('not available')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    return
  }
  const result = await runtime.invokeForAgent('order_add_item', { itemId: scenario === 'different-item' ? 'noodles' : 'dumplings', quantity: 3 })
  if (scenario === 'unique') {
    expect(result).not.toHaveProperty('ok', false)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 3, lines: [{ itemId: 'dumplings', quantity: 3 }] } })
  }
  else {
    expect(result).toMatchObject({ ok: false })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  }
})

// Report: live112 M01; Main received an edit tool that the same task would reject.
it('advertises the same effect scope that the Menu execution boundary enforces', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'meal', name: '測試餐', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'addition', transcript: '測試餐一份', expectedMenuRevision: 0, constraints: {}, handoff: { intent: 'ADD_ITEM', status: 'resolved', itemIds: ['meal'], lineIds: [] } })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(context.allowedToolNames).toContain('order_add_item')
  expect(context.allowedToolNames).toContain('cart_get')
  expect(context.allowedToolNames).toContain('menu_get')
  expect(context.allowedToolNames).not.toContain('menu_recommend')
  expect(context.allowedToolNames).not.toContain('menu_show_recommendations')
  expect(context.allowedToolNames).not.toContain('cart_set_line_quantity')
  expect(context.allowedToolNames).not.toContain('cart_remove_item')
})

// Report: live112 M12/C11-F1; an ordinal with quantity was not bound before Main.
it('binds the second visible item with quantity before any subsequent model lookup', async () => {
  const runtime = createMenuToolRuntime({ menu: ['first', 'second', 'third'].map((id, index) => ({ ...menu[0]!, id, name: `餐點${index + 1}`, aliases: [], optionGroups: [] })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('menu_get', { scope: 'catalog', display: true })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'ordinal', transcript: '第二項一份', expectedMenuRevision: 0, constraints: {} })
  await runtime.invoke('kiosk_conversation_context')
  expect(await runtime.invokeForAgent('order_add_item', { itemId: 'first', quantity: 1 })).toMatchObject({ ok: false })
  const result = await runtime.invokeForAgent('order_add_item', { itemId: 'second', quantity: 1 })
  expect(result).not.toHaveProperty('ok', false)
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { lines: [{ itemId: 'second', quantity: 1 }] } })
})

// Report: live112 C12-F3; Main invented dine-in after replacing a meal.
it('offers fulfillment only for a current POS mode reference or its resolved handoff', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'meal', name: '測試餐', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('order_add_item', { itemId: 'meal', quantity: 1 })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'meal-change', transcript: '測試餐一份', expectedMenuRevision: 0, constraints: { excludeIngredients: [], includeIngredients: [] } })
  const context = await runtime.invoke('kiosk_conversation_context') as { allowedToolNames: string[] }
  expect(context.allowedToolNames).not.toContain('order_set_fulfillment')
  await expect(runtime.invokeForAgent('order_set_fulfillment', { mode: 'dine-in' })).rejects.toThrow('not available')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.fulfillmentMode', undefined)
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'meal-change' })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'fulfillment', transcript: '改內用', expectedMenuRevision: 0, constraints: { excludeIngredients: [], includeIngredients: [] } })
  expect(await runtime.invoke('kiosk_conversation_context')).toHaveProperty('allowedToolNames', expect.arrayContaining(['order_set_fulfillment']))
})

// Report: frozen live112 C02-A2, attempt613; Main retried menu_select_item
// for an unconfirmed alias even though the task would reject that target.
it('offers confirmation instead of item effects when the task has no confirmed target', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'bento', name: '炸排骨便當', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'alias', transcript: '我要排骨飯一份', expectedMenuRevision: 0, constraints: {} })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(context.allowedToolNames).toContain('menu_confirm_item')
  expect(context.allowedToolNames).not.toContain('menu_select_item')
  expect(context.allowedToolNames).not.toContain('order_add_item')
  expect(context.allowedToolNames).not.toContain('cart_add_item')
  expect(context.allowedToolNames).not.toContain('menu_set_quantity')
  expect(context.allowedToolNames).not.toContain('menu_set_item_option')
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

// Report: frozen live112 C10-A2, attempt697; completed atomic additions
// were followed by cart_add_item despite having no current selection.
it('offers selection effects only while a real selection exists', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'meal', name: '測試餐', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'addition', transcript: '測試餐一份', expectedMenuRevision: 0, constraints: {} })
  const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(before.allowedToolNames).toContain('order_add_item')
  expect(before.allowedToolNames).not.toContain('cart_add_item')
  expect(before.allowedToolNames).not.toContain('menu_set_quantity')
  expect(before.allowedToolNames).not.toContain('menu_set_item_option')
  await runtime.invokeForAgent('menu_select_item', { itemId: 'meal' })
  const selected = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(selected.allowedToolNames).toContain('cart_add_item')
  expect(selected.allowedToolNames).toContain('menu_set_quantity')
  await runtime.invokeForAgent('order_add_item', { itemId: 'meal', quantity: 1 })
  const after = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(after.selection).toBeUndefined()
  expect(after.allowedToolNames).not.toContain('cart_add_item')
  expect(after.cart.lines).toMatchObject([{ itemId: 'meal', quantity: 1 }])
})

// Report: live112 C11-A2, attempt707; a missing referent must not offer
// edits to an empty cart and end with TARGET_MISSING after an unrelated read.
it('offers cart-line effects only while cart lines exist', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'meal', name: '測試餐', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const empty = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(empty.allowedToolNames).not.toContain('cart_remove_item')
  expect(empty.allowedToolNames).not.toContain('cart_set_line_quantity')
  expect(empty.allowedToolNames).not.toContain('cart_set_line_option')
  expect(empty.allowedToolNames).not.toContain('cart_clear')
  await runtime.invoke('order_add_item', { itemId: 'meal' })
  const filled = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(filled.allowedToolNames).toContain('cart_remove_item')
  expect(filled.allowedToolNames).toContain('cart_set_line_quantity')
  expect(filled.allowedToolNames).toContain('cart_clear')
})
