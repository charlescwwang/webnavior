import type { MenuItem } from './domain/order-machine'

import { expect, it } from 'vitest'

import { createMenuToolRuntime } from './webmcp'

const catalog: MenuItem[] = [
  { id: 'fish', name: '檸檬蒸魚飯', price: 130, ingredient: 'fish' },
  { id: 'chicken', name: '香烤雞腿飯', price: 140, ingredient: 'chicken' },
  { id: 'pork', name: '薑汁燒肉飯', price: 110, ingredient: 'pork' },
].map(({ ingredient, ...item }) => ({ ...item, category: '主餐', description: '', imageUrl: '', recommendationTags: [], optionGroups: [], composition: { ingredients: [ingredient, 'rice'], complete: true, source: 'merchant', revision: '1', removals: [] } }))

// Report: this chat Nov7; exhausted guidance must offer real dishes without unsolicited prices.
it('regression K1107-GUIDE names actual alternatives and synchronizes the cards without changing filters or cart', async () => {
  const presentations: Array<{ itemIds: string[] }> = []
  const runtime = createMenuToolRuntime({ menu: catalog, onAction: () => {}, onMenuSelection: () => {}, onCartChange: () => {}, onRecommendationsChange: value => presentations.push(value) })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['fish'], excludeIngredients: ['pork'] })
  const before = await runtime.invoke('kiosk_conversation_context')
  const result = await runtime.invokeForAgent('menu_recommend', { action: 'continue' }) as { customerMessage: string, items: MenuItem[] }
  expect(result.customerMessage).toContain('香烤雞腿飯')
  expect(result.customerMessage).not.toMatch(/價位|預算|元|別類|種類|其他魚/)
  expect(result.customerMessage).not.toContain('薑汁燒肉飯')
  expect(result.items).toEqual([])
  expect(presentations.at(-1)?.itemIds).toEqual(['chicken'])
  const after = await runtime.invoke('kiosk_conversation_context')
  expect(after).toMatchObject({ cart: { itemCount: 0 }, queryState: { filters: { includeIngredients: ['fish'], excludeIngredients: ['pork'] } } })
  expect(before).toMatchObject({ queryState: { filters: { includeIngredients: ['fish'] } } })
})

it('regression K1107-GUIDE asks for a concrete meal and never introduces money when the request is unclear', async () => {
  const runtime = createMenuToolRuntime({ menu: catalog, onAction: () => {}, onMenuSelection: () => {}, onCartChange: () => {} })
  const result = await runtime.invokeForAgent('menu_recommend', { action: 'clarify' }) as { customerMessage: string }
  expect(result.customerMessage).toContain('餐點名稱')
  expect(result.customerMessage).not.toMatch(/價位|預算|元|種類|別類/)
})

it('regression K1107-GUIDE does not invent a second fish or repeat sold-out or unverified alternatives', async () => {
  const runtime = createMenuToolRuntime({ menu: [catalog[0]!, { ...catalog[1]!, available: false }, { ...catalog[2]!, composition: undefined }], onAction: () => {}, onMenuSelection: () => {}, onCartChange: () => {} })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['fish'], excludeIngredients: ['pork'] })
  const result = await runtime.invokeForAgent('menu_recommend', { action: 'continue' }) as { customerMessage: string }
  expect(result.customerMessage).not.toMatch(/香烤雞腿飯|薑汁燒肉飯|其他魚|價位|預算/)
  expect(result.customerMessage).toContain('畫面')
})

// The public touch boundary must share Menu's actual condition state, not reconstruct prose.
it('regression K1107-FILTER removes only a chosen condition and rejects an obsolete touch', async () => {
  const runtime = createMenuToolRuntime({ menu: catalog, onAction: () => {}, onMenuSelection: () => {}, onCartChange: () => {} })
  await runtime.invoke('order_add_item', { itemId: 'fish', quantity: 1 })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['fish'], excludeIngredients: ['pork'], maxPrice: 150 })
  const before = runtime.getQueryState()!
  expect(before.conditions.map(condition => condition.label)).toEqual(expect.arrayContaining(['想吃：魚', '不含：豬肉', '不超過 150元']))
  await runtime.removeQueryCondition({ group: 'includeIngredients', value: 'fish' }, before.revision)
  const after = await runtime.invoke('kiosk_conversation_context')
  expect(after).toMatchObject({ cart: { itemCount: 1 }, queryState: { filters: { includeIngredients: [], excludeIngredients: ['pork'] }, prices: { maxPrice: 150 } } })
  await expect(runtime.removeQueryCondition({ group: 'price' }, before.revision)).rejects.toThrow('STALE')
  await runtime.reset()
  expect(runtime.getQueryState()).toBeUndefined()
})

it('regression K1107-FILTER reuses explicit positive-scope replacement while keeping exclusions and budget', async () => {
  const runtime = createMenuToolRuntime({ menu: catalog, onAction: () => {}, onMenuSelection: () => {}, onCartChange: () => {} })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['fish'], excludeIngredients: ['pork'], maxPrice: 150 })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', clear: ['includeIngredients'], includeIngredients: ['chicken'] })
  const result = await runtime.invokeForAgent('menu_recommend', { action: 'update', maxPrice: 145 })
  expect(result).toMatchObject({ queryState: { filters: { includeIngredients: ['chicken'], excludeIngredients: ['pork'] }, prices: { maxPrice: 145 } } })
})

// Report: this chat Nov7; zero matches and a consumed result batch are different outcomes.
it('regression K1107-GUIDE distinguishes no matches from already-shown results and keeps the supplied budget', async () => {
  const runtime = createMenuToolRuntime({ menu: catalog, onAction: () => {}, onMenuSelection: () => {}, onCartChange: () => {} })
  const none = await runtime.invokeForAgent('menu_recommend', { action: 'update', maxPrice: 10 }) as { customerMessage: string }
  expect(none.customerMessage).toContain('找不到符合條件')
  expect(none.customerMessage).not.toMatch(/介紹過|價位|預算/)
  const more = await runtime.invokeForAgent('menu_recommend', { action: 'continue' }) as { customerMessage: string }
  expect(more.customerMessage).toContain('找不到符合條件')
  expect(await runtime.invoke('kiosk_conversation_context')).toMatchObject({ queryState: { prices: { maxPrice: 10 } }, cart: { itemCount: 0 } })
})

it('regression K1107-FILTER removes one exclusion and retains all other restrictions', async () => {
  const runtime = createMenuToolRuntime({ menu: catalog, onAction: () => {}, onMenuSelection: () => {}, onCartChange: () => {} })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', excludeIngredients: ['pork', 'egg'], maxPrice: 150 })
  await runtime.removeQueryCondition({ group: 'excludeIngredients', value: 'egg' }, runtime.getQueryState()!.revision)
  expect(await runtime.invoke('kiosk_conversation_context')).toMatchObject({ queryState: { prices: { maxPrice: 150 }, filters: { excludeIngredients: ['pork'] } } })
  runtime.setMenu([catalog[1]!], 'new-catalog')
  expect(runtime.getQueryState()).toBeUndefined()
  await expect(runtime.removeQueryCondition({ group: 'price' }, 0)).rejects.toThrow('STALE')
})

it('regression K1107-FILTER protects an active Agent task from touch condition changes', async () => {
  const runtime = createMenuToolRuntime({ menu: catalog, onAction: () => {}, onMenuSelection: () => {}, onCartChange: () => {} })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', maxPrice: 150 })
  const revision = runtime.getQueryState()!.revision
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'active', transcript: '看餐點', expectedMenuRevision: 0, constraints: {}, readOnly: true })
  await expect(runtime.removeQueryCondition({ group: 'price' }, revision)).rejects.toThrow('AGENT_CONTROL')
  expect(await runtime.invoke('kiosk_conversation_context')).toMatchObject({ queryState: { prices: { maxPrice: 150 } } })
})

it('regression K1107-GUIDE keeps data-only continuation off the customer screen', async () => {
  const presentations: unknown[] = []
  const runtime = createMenuToolRuntime({ menu: catalog, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: value => presentations.push(value) })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['fish'] })
  const count = presentations.length
  expect(await runtime.invoke('menu_recommend', { more: true, display: false })).toMatchObject({ dataOnly: true, queryAction: 'clarify' })
  expect(presentations).toHaveLength(count)
})
