import { describe, expect, it } from 'vitest'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

const dishes = [
  { ...menu[0]!, id: 'beef', name: '紅燒牛肉麵', aliases: ['牛肉麵'], category: '麵食', optionGroups: [] },
  { ...menu[0]!, id: 'pork', name: '滷肉飯', aliases: [], category: '飯食', optionGroups: [] },
  { ...menu[0]!, id: 'fish', name: '泰式酸辣魚便當', aliases: [], category: '便當', optionGroups: [] },
]

describe('customer-owned product identity at the Agent boundary', () => {
  // Report: this chat, attachment b0b98800: 鱔魚意麵 was replaced by beef noodles.
  it.each([
    { transcript: '鱔魚意麵3份，不要蔥花，一份大辣兩份小辣', itemId: 'beef', lookup: 'none' },
    { transcript: '鱔魚意麵三份', itemId: 'beef', lookup: 'catalog' },
    { transcript: '鱔魚意麵三份', itemId: 'beef', lookup: 'substitute' },
    { transcript: '雞肉飯一份', itemId: 'pork', lookup: 'substitute' },
    { transcript: '酸辣魚便當一份', itemId: 'fish', lookup: 'substitute' },
    { transcript: '水餃便當一份', itemId: 'fish', lookup: 'catalog' },
    { transcript: '我要牛肉麵一碗', itemId: 'pork', lookup: 'substitute' },
  ])('does not add $itemId for $transcript after $lookup lookup', async ({ transcript, itemId, lookup }) => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'purchase', transcript, expectedMenuRevision: 0, constraints: {} })
    if (lookup !== 'none')
      await runtime.invokeForAgent('menu_get', { display: false, ...(lookup === 'substitute' ? { query: dishes.find(item => item.id === itemId)!.name } : {}) })
    expect(await runtime.invokeForAgent('order_add_item', { itemId, quantity: 3 })).toMatchObject({ ok: false })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it.each(['menu_select_item', 'cart_add_item', 'order_add_item'] as const)('does not let %s reuse a selected dish for an unresolved category request', async (tool) => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('menu_select_item', { itemId: 'beef' })
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'purchase', transcript: '雞肉飯一份', expectedMenuRevision: 0, constraints: {} })
    expect(await runtime.invokeForAgent(tool, tool === 'cart_add_item' ? {} : { itemId: 'beef', quantity: 1 })).toMatchObject({ ok: false })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '' })).toMatchObject({ interactionState: { selectedItemName: '紅燒牛肉麵' } })
  })

  it('preserves an existing line when the replacement dish is not confirmed', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'pork', quantity: 2 })
    const before = await runtime.invoke('cart_get', { display: false }) as { cart: { lines: Array<{ id: string }> } }
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'replace', transcript: '剛才那份改鱔魚意麵', expectedMenuRevision: 0, constraints: {} })
    expect(await runtime.invokeForAgent('order_add_item', { itemId: 'beef', replaceLineId: before.cart.lines[0]!.id })).toMatchObject({ ok: false })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: before.cart })
  })

  it('does not choose a category member when the category has several dishes', async () => {
    const runtime = createMenuToolRuntime({ menu: [...dishes, { ...dishes[0]!, id: 'pork-noodles', name: '肉燥乾麵', aliases: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'category', transcript: '鱔魚意麵一份', expectedMenuRevision: 0, constraints: {} })
    expect(await runtime.invokeForAgent('order_add_item', { itemId: 'pork-noodles' })).toMatchObject({ ok: false })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('retains both explicitly named products for a compound Main request', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'compound', transcript: '牛肉麵一碗，再加滷肉飯兩份', expectedMenuRevision: 0, constraints: {} })
    await runtime.invokeForAgent('order_add_item', { itemId: 'beef', quantity: 1 })
    await runtime.invokeForAgent('order_add_item', { itemId: 'pork', quantity: 2 })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 3, lines: [{ itemId: 'beef', quantity: 1 }, { itemId: 'pork', quantity: 2 }] } })
  })

  it('rejects a named target after the catalog revision changes', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'old-catalog', transcript: '牛肉麵一碗', expectedMenuRevision: 0, constraints: {} })
    runtime.setMenu(dishes, 'new-catalog')
    await expect(runtime.invokeForAgent('order_add_item', { itemId: 'beef' })).rejects.toThrow('STALE_PLAN')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('allows a new explicit product choice without reusing the previous task restriction', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'category', transcript: '麵一碗', expectedMenuRevision: 0, constraints: {} })
    expect(await runtime.invokeForAgent('order_add_item', { itemId: 'beef' })).toMatchObject({ ok: false })
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'confirmed', transcript: '那就牛肉麵一碗', expectedMenuRevision: 0, constraints: {} })
    await runtime.invokeForAgent('order_add_item', { itemId: 'beef', quantity: 1 })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'beef' }] } })
  })
})
