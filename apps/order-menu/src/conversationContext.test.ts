import type { CatalogSnapshot } from '../../order-menu-server/src/domain/contracts'

import { describe, expect, it } from 'vitest'

import { createPosSimulator } from '../../order-menu-server/src/simulator'
import { createMenuToolRuntime } from './webmcp'

describe('main conversation context', () => {
  // Report: attachment376eeb5a; repeated removal must retain its effect instead of looking up an old meal.
  it('finishes a repeated removal as already absent while preserving the other cart line', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
    await runtime.invoke('order_add_item', { itemId: 'beef-noodle-soup', quantity: 1 })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '水餃不要了' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:remove-item' })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '水餃不要了' })
    const repeated = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:remove-item' })
    expect(repeated).toMatchObject({ customerMessage: '目前購物車已沒有水餃。', outcome: { status: 'already-absent', intent: 'REMOVE_ITEM', itemIds: ['dumplings'] } })
    expect(repeated).not.toHaveProperty('needsAssistant', true)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { lines: [{ itemId: 'beef-noodle-soup' }], itemCount: 1 } })
  })

  it('uses declared aliases in Main menu lookups', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const dish = { ...catalog.items[0]!, aliases: ['店家專用別名'] }
    const runtime = createMenuToolRuntime({ menu: [dish], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    expect(await runtime.invokeForAgent('menu_get', { query: '店家專用別名' })).toMatchObject({ items: [{ id: dish.id }] })
  })

  it('returns possible names separately instead of declaring an unmatched nickname unavailable', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'nickname', transcript: '排骨飯一份', expectedMenuRevision: 0, constraints: {} })
    const result = await runtime.invokeForAgent('menu_get', { query: '排骨飯' })
    expect(result).toMatchObject({ items: [], matchKind: 'possible', possibleItems: [{ id: 'fried-pork-chop-bento' }] })
    expect(result).toHaveProperty('customerMessage', expect.stringContaining('您想找的是'))
    expect(await runtime.invokeForAgent('order_add_item', { itemId: 'fried-pork-chop-bento' })).toMatchObject({ ok: false })
    expect(await runtime.invokeForAgent('menu_confirm_item', { itemId: 'fried-pork-chop-bento' })).toHaveProperty('pendingCustomerChoice')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('reports an exact named removal as absent even when the whole cart is empty', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '水餃不要了' })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:remove-item' })).toMatchObject({ customerMessage: '目前購物車已沒有水餃。' })
  })

  it('provides the entire compact catalog and fresh cart without images or vendor metadata', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const before = await runtime.invoke('kiosk_conversation_context', {})
    expect(before).toMatchObject({ phase: 'ordering', entryComplete: true, catalog: { complete: true, itemCount: catalog.items.length }, cart: { itemCount: 0 } })
    expect(JSON.stringify(before)).not.toContain('imageUrl')
    expect(JSON.stringify(before)).not.toContain('sourceUrl')
    await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 2 })
    const after = await runtime.invoke('kiosk_conversation_context', {})
    expect(after).toMatchObject({ cart: { itemCount: 2, lines: [{ itemId: 'dumplings', quantity: 2 }] } })
    expect(after).not.toEqual(before)
    await expect(runtime.invokeForAgent('kiosk_conversation_context', {})).rejects.toThrow('host')
  })

  it('does not expose a catalog or commerce tools while entry is pending', async () => {
    const runtime = createMenuToolRuntime({ orderingReady: () => false, onCustomerEntrySkipped: () => {}, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const context = await runtime.invoke('kiosk_conversation_context', {})
    expect(context).toMatchObject({ phase: 'customer_entry', entryComplete: false, allowedToolNames: [] })
    expect(context).not.toHaveProperty('catalog')
  })

  it('confirms an inferred name before replacing a cart line, preserving its quantity', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const original = await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 2 }) as { line: { id: string } }
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'replace', transcript: '水餃改排骨飯', expectedMenuRevision: 0, constraints: {} })
    const proposed = await runtime.invokeForAgent('menu_confirm_item', { itemId: 'fried-pork-chop-bento', replaceLineId: original.line.id }) as { pendingCustomerChoice: { questionId: string, question: string } }
    expect(proposed.pendingCustomerChoice.question).toContain('將水餃更換為炸排骨便當')
    expect(await runtime.invoke('kiosk_question_validate', { questionId: proposed.pendingCustomerChoice.questionId })).toHaveProperty('pendingCustomerChoice.questionId', proposed.pendingCustomerChoice.questionId)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { lines: [{ itemId: 'dumplings', quantity: 2 }] } })
    await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'replace' })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: `confirm-meal:${proposed.pendingCustomerChoice.questionId}:yes` })).rejects.toThrow('STALE')
    const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '對' }) as { waitingFor: { questionId: string } }
    const confirmed = await runtime.invoke('kiosk_fast_path_execute', { candidateId: `confirm-meal:${answer.waitingFor.questionId}:yes` })
    expect(confirmed).toMatchObject({ replacedLine: { id: original.line.id }, cart: { lines: [{ itemId: 'fried-pork-chop-bento', quantity: 2 }] } })
  })

  it('rejects a write after the cart changes since Main received its snapshot', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'race', transcript: '水餃一份', expectedMenuRevision: 0, constraints: {} })
    await runtime.invoke('kiosk_conversation_context', {})
    await runtime.invoke('order_add_item', { itemId: 'beef-noodle-soup', quantity: 1 })
    await expect(runtime.invokeForAgent('order_add_item', { itemId: 'dumplings', quantity: 1 })).rejects.toThrow('STALE_PLAN')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'beef-noodle-soup' }] } })
  })

  it('keeps known removal effects and line ownership through Main handoff', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const original = await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 }) as { line: { id: string } }
    const other = await runtime.invoke('order_add_item', { itemId: 'beef-noodle-soup', quantity: 1 }) as { line: { id: string } }
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'remove', transcript: '水餃不要了', expectedMenuRevision: 0, constraints: {}, handoff: { intent: 'REMOVE_ITEM', status: 'resolved', itemIds: ['dumplings'], lineIds: [original.line.id] } })
    await runtime.invoke('kiosk_conversation_context', {})
    await expect(runtime.invokeForAgent('menu_get', { query: '排骨飯' })).rejects.toThrow('requested effect')
    await expect(runtime.invokeForAgent('cart_remove_item', { lineId: other.line.id })).rejects.toThrow('resolved targets')
    await runtime.invokeForAgent('cart_remove_item', { lineId: original.line.id })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { lines: [{ id: other.line.id }], itemCount: 1 } })
  })

  it('omits long marketing descriptions without dropping catalog items or options', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items.map(item => ({ ...item, description: '長介紹'.repeat(1000) })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const context = await runtime.invoke('kiosk_conversation_context', {}) as { catalog: { items: Array<{ id: string, optionGroups: unknown, description?: string }> } }
    expect(context.catalog.items.map(item => item.id)).toEqual(catalog.items.map(item => item.id))
    expect(context.catalog.items[0]!.optionGroups).toEqual(catalog.items[0]!.optionGroups)
    expect(context.catalog.items.every(item => item.description === undefined)).toBe(true)
  })

  it('rejects an oversized complete catalog instead of silently returning the first products', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: Array.from({ length: 201 }, (_, index) => ({ ...catalog.items[0]!, id: `dish-${index}` })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await expect(runtime.invoke('kiosk_conversation_context', {})).rejects.toThrow()
  })

  it('advances only its own accepted writes for an explicitly named multi-item task', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'compound', transcript: '水餃一份，再加牛肉麵一碗', expectedMenuRevision: 0, constraints: {} })
    await runtime.invoke('kiosk_conversation_context', {})
    await runtime.invokeForAgent('order_add_item', { itemId: 'dumplings', quantity: 1 })
    await runtime.invokeForAgent('order_add_item', { itemId: 'beef-noodle-soup', quantity: 1 })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2 } })
  })
})

// Report: attachment 6dfae2fd; continuation tools must reflect the unresolved-menu write lock.
it('removes mutation tools after a menu miss and resets the lock for the next customer task', async () => {
  const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'missing', transcript: '大腸臭臭鍋一碗', expectedMenuRevision: 0, constraints: {} })
  expect(await runtime.invokeForAgent('menu_get', { query: '大腸臭臭鍋' })).toMatchObject({ items: [], matchKind: 'none' })
  const locked = await runtime.invoke('kiosk_conversation_context') as { allowedToolNames: string[] }
  expect(locked.allowedToolNames).not.toContain('order_add_item')
  expect(locked.allowedToolNames).not.toContain('cart_remove_item')
  expect(locked.allowedToolNames).toContain('menu_get')
  expect(locked.allowedToolNames).toContain('menu_confirm_item')
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'next', transcript: '水餃一份', expectedMenuRevision: 0, constraints: {} })
  const next = await runtime.invoke('kiosk_conversation_context') as { allowedToolNames: string[] }
  expect(next.allowedToolNames).toContain('order_add_item')
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

// Report: this chat, 2026-11-06; tools offered to Main must obey the executor's handoff policy.
it.each([
  { intent: 'ADD_ITEM', allowed: 'order_add_item', blocked: 'cart_clear' },
  { intent: 'REMOVE_ITEM', allowed: 'cart_remove_item', blocked: 'menu_get' },
  { intent: 'SET_QUANTITY', allowed: 'cart_set_line_quantity', blocked: 'order_add_item' },
  { intent: 'SET_OPTION', allowed: 'cart_set_line_option', blocked: 'cart_clear' },
  { intent: 'CLEAR_CART', allowed: 'cart_clear', blocked: 'order_add_item' },
] as const)('omits tools rejected for a $intent handoff', async ({ intent, allowed, blocked }) => {
  const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
  const cart = await runtime.invoke('cart_get', { display: false }) as { cart: { lines: Array<{ id: string }> } }
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: intent, transcript: '水餃的本輪操作', expectedMenuRevision: 0, constraints: {}, handoff: { intent, status: 'resolved', itemIds: ['dumplings'], lineIds: [cart.cart.lines[0]!.id] } })
  const context = await runtime.invoke('kiosk_conversation_context') as { allowedToolNames: string[] }
  expect(context.allowedToolNames).toContain(allowed)
  expect(context.allowedToolNames).not.toContain(blocked)
  await expect(runtime.invokeForAgent(blocked)).rejects.toThrow('requested effect')
})

// Report: this chat, 2026-11-06; readonly navigation and unresolved price had executor-only restrictions.
it.each([false, true])('omits executor-rejected tools for task constraints (unresolvedPrice=%s)', async (unresolvedPrice) => {
  const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onMenuRequested: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'restricted', transcript: '查詢餐點', expectedMenuRevision: 0, readOnly: !unresolvedPrice, constraints: { unresolvedPrice } })
  const context = await runtime.invoke('kiosk_conversation_context') as { allowedToolNames: string[] }
  expect(context.allowedToolNames).not.toContain('menu_open')
  expect(context.allowedToolNames).not.toContain('order_add_item')
  expect(context.allowedToolNames).toContain('cart_get')
  if (unresolvedPrice)
    expect(context.allowedToolNames).not.toContain('menu_get')
})
