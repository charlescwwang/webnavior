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
    expect(result).toMatchObject({ queryAction: 'clarify', customerMessage: expect.stringContaining('餐點名稱'), items: [] })
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

  // Report: Nov1 C05-A2/C06-F3: Main restates the retained restriction.
  it('checks restated category and ingredient conditions before continuing', async () => {
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'continue', category: '便當', dietary: 'vegetarian', excludeIngredients: [] })).toMatchObject({ queryAction: 'clarify' })
    await expect(runtime.invokeForAgent('menu_recommend', { action: 'continue', category: '點心' })).rejects.toThrow('continue cannot change')
    await expect(runtime.invokeForAgent('menu_recommend', { action: 'continue', excludeIngredients: ['egg'] })).rejects.toThrow('continue cannot change')
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

  // Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct31 live replay.
  it('checks repeated continuation prices against retained conditions without changing them', async () => {
    await runtime.invokeForAgent('menu_recommend', { action: 'update', maxPrice: 150 })
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'continue', maxPrice: 150, limit: 3 })).toMatchObject({ queryAction: 'continue', appliedPriceConditions: { maxPrice: 150 }, items: [{ id: 'dish-3' }, { id: 'dish-4' }] })
    await expect(runtime.invokeForAgent('menu_recommend', { action: 'continue', maxPrice: 151 })).rejects.toThrow('continue')
    await expect(runtime.invokeForAgent('menu_recommend', { action: 'continue', minPrice: 0 })).rejects.toThrow('continue')
    await expect(runtime.invokeForAgent('menu_recommend', { action: 'continue', maxPrice: '150' })).rejects.toThrow()
    expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  })

  it('does not accept changed conditions as continuation or an implicit action', async () => {
    await expect(runtime.invokeForAgent('menu_recommend', { action: 'continue', maxPrice: 200 })).rejects.toThrow('continue')
    await expect(runtime.invokeForAgent('menu_recommend', {})).rejects.toThrow('action')
    await expect(runtime.invokeForAgent('menu_get', { display: true })).resolves.toMatchObject({ ok: false, executed: false, error: 'MENU_QUERY_ACTION_REQUIRED' })
  })

  it('keeps a real unmatched named lookup distinct from a generic request', async () => {
    expect(await runtime.invokeForAgent('menu_get', { query: '韭菜盒', display: false })).toMatchObject({ requestedQueries: ['韭菜盒'], items: [], availability: 'NONE' })
  })
})

// Report: Nov1 authorized refactor acceptance, budget turn2 selected SEARCH_MENU
// with slots.more=1, but the compiler called menu_get and silently lost budget.
it('preserves retained query conditions when the finite search choice continues browsing', async () => {
  const runtime = createMenuToolRuntime({ menu: [
    { ...menu[0]!, id: 'cheap', name: '入門餐', aliases: [], optionGroups: [], price: 80 },
    { ...menu[0]!, id: 'dear', name: '特選餐', aliases: [], optionGroups: [], price: 150 },
  ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('menu_recommend', { action: 'update', maxPrice: 100 })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '有其他的嗎' })
  const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu' }) as { items: Array<{ price: number }>, customerMessage: string, decisionTrace: { operationPlan: { toolName: string, input: unknown } } }
  expect(result.decisionTrace.operationPlan).toMatchObject({ toolName: 'menu_recommend', input: { more: true } })
  expect(result.items.every(item => item.price <= 100)).toBe(true)
  expect(result.customerMessage).toMatch(/沒有|找不到|調整|條件/)
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

it('keeps an explicit full-catalog request separate from continuing retained budget browsing', async () => {
  const runtime = createMenuToolRuntime({ menu: [
    { ...menu[0]!, id: 'cheap', name: '入門餐', aliases: [], optionGroups: [], price: 80 },
    { ...menu[0]!, id: 'dear', name: '特選餐', aliases: [], optionGroups: [], price: 150 },
  ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('menu_recommend', { action: 'update', maxPrice: 100 })
  const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '我想看全部菜單' }) as { candidates: Array<{ id: string }> }
  expect(context.candidates.some(choice => choice.id === 'intent:search-all-menu')).toBe(true)
  const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-all-menu' }) as { items: Array<{ id: string }> }
  expect(result.items.map(item => item.id)).toEqual(['cheap', 'dear'])
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

// Report: semantic3 B04-J-A1; no preceding recommendation is a missing reference, not a transport failure.
it('clarifies a continuation without usable presentation instead of inventing a recommendation or throwing', async () => {
  const presented = vi.fn()
  const runtime = createMenuToolRuntime({ menu, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: presented })
  const before = await runtime.invoke('kiosk_fast_path_context') as { revisions: unknown }
  const result = await runtime.invokeForAgent('menu_recommend', { action: 'continue' })
  expect(result).toMatchObject({ queryAction: 'clarify', items: [] })
  expect(presented).not.toHaveBeenCalled()
  expect(await runtime.invoke('kiosk_fast_path_context')).toMatchObject({ revisions: before.revisions })
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

// Report: this chat, 2026-11-07, session yTDlWLScWAaHVqoxI1q9j.
it('reverses a previous fish preference without clearing other exclusions or the cart', async () => {
  const runtime = createMenuToolRuntime({ menu: [
    { ...menu[0]!, id: 'fish', name: '魚便當', price: 100, composition: { ingredients: ['fish'], complete: true, source: 'merchant', revision: '1', removals: [] } },
    { ...menu[0]!, id: 'chicken', name: '雞便當', price: 100, composition: { ingredients: ['chicken'], complete: true, source: 'merchant', revision: '1', removals: [] } },
    { ...menu[0]!, id: 'egg', name: '蛋便當', price: 100, composition: { ingredients: ['egg'], complete: true, source: 'merchant', revision: '1', removals: [] } },
  ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['fish'], excludeIngredients: ['egg'], maxPrice: 200 })
  const result = await runtime.invokeForAgent('menu_recommend', { action: 'update', excludeIngredients: ['fish'] })
  expect(result).toMatchObject({ appliedFilters: { includeIngredients: [], excludeIngredients: ['egg', 'fish'] }, appliedPriceConditions: { maxPrice: 200 }, items: [{ id: 'chicken' }] })
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  // A fresh include must never silently release a prior allergy/exclusion.
  const conflict = await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['egg'] })
  expect(conflict).toMatchObject({ appliedFilters: { excludeIngredients: ['egg', 'fish'] }, items: [] })
})

// Report: this chat, 2026-11-07, session ggUmSdBBOnjiRPKu06-uR.
it('can explicitly withdraw an inclusion preference while retaining allergy exclusions, prices and the cart', async () => {
  const presentations: string[][] = []
  const runtime = createMenuToolRuntime({ menu: [
    { ...menu[0]!, id: 'fish', name: '魚便當', price: 140, category: '便當', composition: { ingredients: ['fish'], complete: true, source: 'merchant', revision: '1', removals: [] } },
    { ...menu[0]!, id: 'chicken', name: '雞便當', price: 135, category: '便當', composition: { ingredients: ['chicken'], complete: true, source: 'merchant', revision: '1', removals: [] } },
    { ...menu[0]!, id: 'egg', name: '蛋便當', price: 130, category: '便當', composition: { ingredients: ['egg'], complete: true, source: 'merchant', revision: '1', removals: [] } },
  ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: p => presentations.push(p.itemIds) })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['fish'], excludeIngredients: ['egg'], maxPrice: 150 })
  const result = await runtime.invokeForAgent('menu_recommend', { action: 'update', clear: ['includeIngredients'], category: '便當' })
  expect(result).toMatchObject({ appliedFilters: { includeIngredients: [], excludeIngredients: ['egg'] }, appliedPriceConditions: { maxPrice: 150 }, items: [{ id: 'fish' }, { id: 'chicken' }] })
  expect(presentations.at(-1)).toEqual(['fish', 'chicken'])
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

// Report: this chat, Nov7 — a named meal introduction gave no ordering guidance.
it('guides quantity entry only for one available exact meal without adding it', async () => {
  const runtime = createMenuToolRuntime({ menu: [
    { ...menu[0]!, id: 'available', name: '可點餐點', available: true, aliases: [] },
    { ...menu[0]!, id: 'sold-out', name: '售完餐點', available: false, aliases: [] },
  ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  expect(await runtime.invoke('menu_get', { query: '可點餐點', display: false })).toHaveProperty('customerMessage', expect.stringContaining('要點幾份'))
  expect(await runtime.invoke('menu_get', { query: '售完餐點', display: false })).toHaveProperty('customerMessage', expect.not.stringContaining('要點幾份'))
  expect(await runtime.invoke('menu_get', { queries: ['可點餐點', '售完餐點'], display: false })).toHaveProperty('customerMessage', expect.not.stringContaining('要點幾份'))
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})
