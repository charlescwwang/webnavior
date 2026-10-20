import { beforeEach, describe, expect, it, vi } from 'vitest'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

// Report: this chat, session IRWWpQr2aQ0m67i1M_0yi, 2026-10-19.
describe('explicit conversational query actions', () => {
  let runtime: ReturnType<typeof createMenuToolRuntime>
  const present = vi.fn()
  beforeEach(async () => {
    present.mockClear()
    runtime = createMenuToolRuntime({ menu: [130, 135, 140, 125, 145, 80, 150].map((price, index) => ({ ...menu[0]!, id: `dish-${index}`, name: `餐點${index}`, price, category: index < 5 ? '便當' : '點心', aliases: [], optionGroups: [], recommendationTags: [], composition: { ingredients: ['vegetables'], complete: true, source: 'merchant', revision: '1', removals: [], dietaryLabels: ['vegetarian'] } })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: present })
    await runtime.invoke('menu_recommend', { category: '便當', minPrice: 130, maxPrice: 140, dietary: 'vegetarian' })
  })

  it('clarifies without consuming a batch, presenting dishes or changing the cart', async () => {
    const context = await runtime.invoke('kiosk_fast_path_context')
    const result = await runtime.invokeForAgent('menu_recommend', { action: 'clarify' })
    expect(result).toMatchObject({ queryAction: 'clarify', customerMessage: expect.stringContaining('價位'), items: [] })
    expect(result).not.toHaveProperty('pendingCustomerChoice')
    expect(await runtime.invoke('kiosk_fast_path_context')).toMatchObject({ revisions: (context as { revisions: unknown }).revisions })
    expect(present).toHaveBeenCalledTimes(1)
    expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  })

  it('replaces this price group and retains category, dietary limits and shown history', async () => {
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'update', maxPrice: 150, excludeShown: true })).toMatchObject({ appliedPriceConditions: { maxPrice: 150 }, appliedFilters: { dietary: 'vegetarian' }, items: [{ id: 'dish-3' }, { id: 'dish-4' }] })
  })

  it('includes already displayed matches in a plain condition update and keeps bounds explicit', async () => {
    const result = await runtime.invokeForAgent('menu_recommend', { action: 'update', maxPrice: 150 })
    expect(result).toMatchObject({ appliedPriceConditions: { maxPrice: 150 }, items: [{ id: 'dish-0' }, { id: 'dish-1' }, { id: 'dish-2' }] })
    expect(result).not.toHaveProperty('queryState.prices.minPrice')
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'continue' })).toMatchObject({ items: [{ id: 'dish-3' }, { id: 'dish-4' }] })
  })

  it('clears only the requested price group', async () => {
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'update', clear: ['price'], excludeShown: true })).toMatchObject({ appliedPriceConditions: {}, appliedFilters: { dietary: 'vegetarian' }, items: [{ id: 'dish-3' }, { id: 'dish-4' }] })
  })

  it('resets browsing bounds while retaining dietary limits, shown history and the cart', async () => {
    await runtime.invokeForAgent('order_add_item', { itemId: 'dish-0', quantity: 1 })
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'reset' })).toMatchObject({ appliedPriceConditions: {}, appliedFilters: { dietary: 'vegetarian' }, items: [{ id: 'dish-3' }, { id: 'dish-4' }, { id: 'dish-5' }] })
    expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 1)
  })

  it('asks about exhausted conditions without replacing the last presentation', async () => {
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'continue' })).toMatchObject({ queryAction: 'clarify', items: [] })
    expect(present).toHaveBeenCalledTimes(1)
  })

  it('does not accept changed conditions as continuation or an implicit action', async () => {
    await expect(runtime.invokeForAgent('menu_recommend', { action: 'continue', maxPrice: 200 })).rejects.toThrow('continue')
    await expect(runtime.invokeForAgent('menu_recommend', {})).rejects.toThrow('action')
    await expect(runtime.invokeForAgent('menu_get', { display: true })).rejects.toThrow('action')
  })

  it('keeps a real unmatched named lookup distinct from a generic request', async () => {
    expect(await runtime.invokeForAgent('menu_get', { query: '韭菜盒', display: false })).toMatchObject({ requestedQueries: ['韭菜盒'], items: [], availability: 'NONE' })
  })
})
