import { expect, it, vi } from 'vitest'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

// Report: this chat, Nov8 — a named lookup after fish browsing left the fish condition strip behind.
it.each(['全家餐', '雙人套餐'])('replaces browsing preferences with the new named lookup: %s', async (name) => {
  const onQueryStateChange = vi.fn()
  const runtime = createMenuToolRuntime({ menu: [
    { ...menu[0]!, id: 'fish', name: '烤魚餐', aliases: [], composition: { ingredients: ['fish'], complete: true, source: 'merchant', revision: '1', removals: [] } },
    { ...menu[0]!, id: 'set', name, aliases: [], composition: { ingredients: ['chicken'], complete: true, source: 'merchant', revision: '1', removals: [] } },
  ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onQueryStateChange })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['fish'], excludeIngredients: ['egg'], maxPrice: 200 })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'new-name', transcript: `你有賣${name}嗎？`, expectedMenuRevision: 0, readOnly: true, constraints: { includeIngredients: ['fish'], excludeIngredients: ['egg'], maxPrice: 200 } })
  const result = await runtime.invokeForAgent('menu_get', { query: name })
  expect(result).toHaveProperty('items', expect.arrayContaining([expect.objectContaining({ id: 'set' })]))
  expect(runtime.getQueryState()?.conditions).toContainEqual(expect.objectContaining({ group: 'query', value: name }))
  expect(runtime.getQueryState()?.conditions.some(c => c.group === 'includeIngredients')).toBe(false)
  expect(runtime.getQueryState()?.conditions.some(c => c.group === 'price')).toBe(false)
  expect(runtime.getQueryState()?.conditions).toContainEqual(expect.objectContaining({ group: 'excludeIngredients', value: 'egg' }))
  expect(onQueryStateChange).toHaveBeenLastCalledWith(runtime.getQueryState())
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

it('keeps an explicit ingredient with a new named query, including an empty result', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['chicken'] })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'fish-set', transcript: '有魚的全家餐嗎？', expectedMenuRevision: 0, readOnly: true, constraints: { includeIngredients: ['fish'] } })
  await runtime.invokeForAgent('menu_get', { query: '全家餐', includeIngredients: ['fish'] })
  expect(runtime.getQueryState()?.conditions).toContainEqual(expect.objectContaining({ group: 'query', value: '全家餐' }))
  expect(runtime.getQueryState()?.conditions).toContainEqual(expect.objectContaining({ group: 'includeIngredients', value: 'fish' }))
  expect(runtime.getQueryState()?.conditions.some(c => c.value === 'chicken')).toBe(false)
})

it('replaces a positive preference without requiring a second clear command and retains exclusions', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['fish'], excludeIngredients: ['egg'], maxPrice: 200 })
  expect(await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['chicken'] })).toMatchObject({ appliedFilters: { includeIngredients: ['chicken'], excludeIngredients: ['egg'] }, appliedPriceConditions: { maxPrice: 200 } })
})
