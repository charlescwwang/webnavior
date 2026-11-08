import type { MenuItem } from './domain/order-machine'

import { expect, it } from 'vitest'

import { createMenuToolRuntime } from './webmcp'

const item = (id: string, name: string, meat = 'pork'): MenuItem => ({ id, name, price: 100, category: '主餐', description: '', imageUrl: '', optionGroups: [], recommendationTags: [], composition: { ingredients: [meat], complete: true, source: 'merchant', revision: '1', removals: [] } })
const menus = [
  [item('pork', '打拋豬便當'), item('chicken', '椒麻雞便當', 'chicken')],
  [item('soup', '番茄燉牛肉麵', 'beef'), item('rice', '香菇燉雞飯', 'chicken')],
]

// Report: this chat Nov7; fuzzy results are proposals, never accepted item identities.
it.each([
  { menu: menus[0]!, query: '打拋牛便當', expected: 'pork' },
  { menu: menus[0]!, query: '椒麻几便當', expected: 'chicken' },
  { menu: menus[1]!, query: '蕃茄燉牛肉麵', expected: 'soup' },
  { menu: menus[1]!, query: '香菇燉基飯', expected: 'rice' },
])('regression K1107-FUZZY proposes a current item across menus: $query', async ({ menu, query, expected }) => {
  const presentations: Array<{ itemIds: string[] }> = []
  const runtime = createMenuToolRuntime({ menu, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: value => presentations.push(value) })
  const result = await runtime.invokeForAgent('menu_get', { query }) as { possibleItems: MenuItem[] }
  expect(result).toMatchObject({ items: [], matchKind: 'possible', possibleItems: expect.arrayContaining([expect.objectContaining({ id: expected })]) })
  expect(result.possibleItems[0]?.id).toBe(expected)
  expect(presentations.at(-1)?.itemIds).toContain(expected)
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

it('regression K1107-FUZZY retains a literal exact match and reports no candidate for unrelated words', async () => {
  const runtime = createMenuToolRuntime({ menu: menus[0], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const exact = await runtime.invokeForAgent('menu_get', { query: '打拋豬便當' })
  expect(exact).toMatchObject({ matchKind: 'literal', items: [{ id: 'pork' }] })
  expect(exact).not.toHaveProperty('possibleItems')
  expect(await runtime.invokeForAgent('menu_get', { query: '火星望遠鏡便當' })).toMatchObject({ matchKind: 'none', items: [] })
})

it('regression K1107-FUZZY excludes sold-out and prohibited food and keeps data-only reads off screen', async () => {
  const presentations: unknown[] = []
  const runtime = createMenuToolRuntime({ menu: [item('pork', '打拋豬便當'), { ...item('beef', '打拋牛便當', 'beef'), available: false }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: value => presentations.push(value) })
  expect(await runtime.invokeForAgent('menu_get', { query: '打拋羊便當', excludeIngredients: ['pork'], display: false })).toMatchObject({ items: [], matchKind: 'none' })
  expect(presentations).toEqual([])
})

it('regression K1107-FUZZY requires a later owned confirmation and retains the requested quantity', async () => {
  const runtime = createMenuToolRuntime({ menu: menus[0], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'propose', transcript: '我要打拋牛便當兩份', expectedMenuRevision: 0, constraints: {} })
  await runtime.invoke('kiosk_conversation_context')
  await runtime.invokeForAgent('menu_get', { query: '打拋牛便當' })
  await expect(runtime.invokeForAgent('order_add_item', { itemId: 'pork', quantity: 2 })).rejects.toThrow('not available')
  await runtime.invoke('kiosk_conversation_context')
  const proposed = await runtime.invokeForAgent('menu_confirm_item', { itemId: 'pork' }) as { pendingCustomerChoice: { questionId: string } }
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'propose' })
  await runtime.invoke('kiosk_dialogue_presented', { questionId: proposed.pendingCustomerChoice.questionId, content: '您是要新增打拋豬便當嗎？' })
  const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '對' }) as { candidates: Array<{ id: string }> }
  const yes = answer.candidates.find(candidate => candidate.id.endsWith(':yes'))!
  expect(yes).toBeDefined()
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: yes.id })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2, lines: [{ itemId: 'pork', quantity: 2 }] } })
  await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: yes.id })).rejects.toThrow()
})

// Report: Nov7 actual-model replay sent originalRecipe:true for a fuzzy name.
it.each([
  { speech: '我要打拋牛便當兩份', allowed: false },
  { speech: '打拋豬便當一份不要辣', allowed: true },
])('keeps discovery stable while authorizing original-recipe confirmation from the request: $speech', async ({ speech, allowed }) => {
  const runtime = createMenuToolRuntime({ menu: menus[0], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const before = runtime.toolDefinitions
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'schema', transcript: speech, expectedMenuRevision: 0, constraints: {} })
  const definition = runtime.toolDefinitions.find(tool => tool.name === 'menu_confirm_item')!
  expect(runtime.toolDefinitions).toEqual(before)
  expect(Object.hasOwn(definition.inputSchema.properties as object, 'originalRecipe')).toBe(true)
  if (allowed)
    expect(await runtime.invokeForAgent('menu_confirm_item', { itemId: 'pork', originalRecipe: true })).toHaveProperty('pendingCustomerChoice')
  else
    await expect(runtime.invokeForAgent('menu_confirm_item', { itemId: 'pork', originalRecipe: true })).rejects.toThrow('preparation')
})

// Report: this chat, Nov08 actual Main asked for a dish outside the fuzzy lookup.
it.each([
  { asked: '打拋牛便當', offered: '打拋豬便當' },
  { asked: '椰香雞腿飯', offered: '椰香雞肉飯' },
])('binds proposals to verified candidates for $asked', async ({ asked, offered }) => {
  const runtime = createMenuToolRuntime({ menu: [item('candidate', offered), item('unrelated', '炸排骨便當')], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'bound-proposal', transcript: `我要${asked}兩份`, expectedMenuRevision: 0, constraints: {} })
  await runtime.invoke('kiosk_conversation_context')
  await expect(runtime.invokeForAgent('menu_confirm_item', { itemId: 'candidate' })).rejects.toThrow()
  expect(await runtime.invokeForAgent('menu_get', { query: asked })).toMatchObject({ possibleItems: [{ id: 'candidate' }] })
  await runtime.invoke('kiosk_conversation_context')
  await expect(runtime.invokeForAgent('menu_confirm_item', { itemId: 'unrelated' })).rejects.toThrow('verified candidates')
  expect(await runtime.invokeForAgent('menu_confirm_item', { itemId: 'candidate' })).toHaveProperty('pendingCustomerChoice')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})
