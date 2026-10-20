import { describe, expect, it } from 'vitest'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

const items = ['bento-a', 'bento-b', 'noodles', 'veg-a', 'veg-b', 'veg-c', 'unlabelled'].map((id, index) => ({
  ...menu[0]!,
  id,
  name: id,
  category: index < 2 ? '便當' : index === 2 ? '麵食' : '點心',
  composition: { ingredients: ['vegetables'], complete: true, source: 'merchant' as const, revision: '1', removals: [], ...(id !== 'unlabelled' ? { dietaryLabels: ['vegetarian' as const] } : {}) },
}))

function createRuntime() {
  return createMenuToolRuntime({ menu: items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
}

describe('catalog-grounded preference queries', () => {
  // Report: this chat, 2026-10-19 — exclusions must compose with diet and survive another batch.
  it('combines exclusions with verified dietary data and preserves them across batches without changing the cart', async () => {
    const runtime = createRuntime()
    await runtime.invoke('order_add_item', { itemId: 'bento-a' })
    const before = await runtime.invoke('cart_get', { display: false }) as { cart: unknown }
    const excludeItemIds = ['bento-a', 'bento-b', 'noodles']
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'update', excludeItemIds, dietary: 'vegetarian', limit: 1 })).toMatchObject({ items: [{ id: 'veg-a' }], excludedItemIds: excludeItemIds, unknownCompositionItems: [{ id: 'unlabelled' }] })
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'continue', limit: 1 })).toMatchObject({ items: [{ id: 'veg-b' }], excludedItemIds: excludeItemIds, appliedFilters: { dietary: 'vegetarian' } })
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'update', limit: 1, excludeShown: true, excludeItemIds: ['bento-a', 'bento-b', 'noodles', 'veg-c'] })).toMatchObject({ items: [], excludedItemIds: [...excludeItemIds, 'veg-c'] })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: before.cart })
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'update', clear: ['dietary', 'excludedItems'], limit: 1 })).toMatchObject({ items: [{ id: 'bento-a' }], excludedItemIds: [] })
  })

  it.each(['menu_get', 'menu_recommend'] as const)('validates exclusions before display through %s', async (name) => {
    const runtime = createRuntime()
    await expect(runtime.invokeForAgent(name, { ...(name === 'menu_recommend' ? { action: 'update' } : { display: false }), excludeItemIds: ['made-up'] })).rejects.toThrow('UNKNOWN_MENU_EXCLUSION')
    await expect(runtime.invokeForAgent(name, { ...(name === 'menu_recommend' ? { action: 'update' } : { display: false }), excludeItemIds: 'bento-a' })).rejects.toThrow('excludeItemIds')
    expect(await runtime.invokeForAgent(name, { ...(name === 'menu_recommend' ? { action: 'update' } : { display: false }), excludeItemIds: ['bento-a', 'bento-a', 'bento-b', 'noodles'], dietary: 'vegetarian' })).toMatchObject({ items: [{ id: 'veg-a' }, { id: 'veg-b' }, { id: 'veg-c' }], excludedItemIds: ['bento-a', 'bento-b', 'noodles'] })
  })

  it('retains exclusions through the actual next-batch semantic action', async () => {
    const runtime = createRuntime()
    await runtime.invokeForAgent('menu_recommend', { action: 'update', excludeItemIds: ['bento-a', 'bento-b', 'noodles'], dietary: 'vegetarian', limit: 1 })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '還有呢' })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:recommend-more' })).toMatchObject({ items: [{ id: 'veg-b' }, { id: 'veg-c' }], excludedItemIds: ['bento-a', 'bento-b', 'noodles'], appliedFilters: { dietary: 'vegetarian' } })
  })

  it('clears the previous cards when every catalog item is excluded', async () => {
    const shown: string[][] = []
    const runtime = createMenuToolRuntime({ menu: items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: presentation => shown.push(presentation.itemIds) })
    await runtime.invokeForAgent('menu_recommend', { action: 'update', limit: 1 })
    expect(shown.at(-1)).toEqual(['bento-a'])
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'update', excludeItemIds: items.map(item => item.id) })).toMatchObject({ items: [], availability: 'NONE' })
    expect(shown.at(-1)).toEqual([])
  })
})
