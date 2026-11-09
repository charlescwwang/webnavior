import { expect, it, vi } from 'vitest'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

// Report: this chat, Nov8 — absent dish -> full menu -> invite a fresh recommendation.
it('returns through the menu control and offers recommendations without counting the catalog as introduced dishes', async () => {
  const onAction = vi.fn()
  const onMenuRequested = vi.fn()
  const runtime = createMenuToolRuntime({ menu, onAction, onMenuRequested, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invokeForAgent('menu_get', { query: '炸雞腿' })
  const result = await runtime.executeTool('menu_open', {})
  expect(onMenuRequested).toHaveBeenCalledOnce()
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ controlId: 'menu:all' }))
  expect(result).toHaveProperty('customerReply.nextQuestion', '需要我幫您推薦餐點嗎？')
  expect(result).toHaveProperty('customerMessage', '已回到全部菜單。 需要我幫您推薦餐點嗎？')
  expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '好' })).toHaveProperty('candidates', expect.arrayContaining([expect.objectContaining({ id: 'intent:recommend' })]))
  expect(runtime.getQueryState()?.conditions.some(condition => condition.group === 'query')).toBe(false)
  expect(await runtime.executeTool('menu_recommend', { action: 'continue' })).toHaveProperty('items', expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })]))
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

// Report: this chat Nov8 — fish → absent milkfish → all menu → pork must not ask about the old recommendation.
it.each(['pork', 'chicken', 'beef'] as const)('uses the returned full catalog for a new %s condition', async (ingredient) => {
  const onMenuRequested = vi.fn()
  const runtime = createMenuToolRuntime({ menu: ['fish', 'pork', 'chicken', 'beef'].map((ingredient, index) => ({ ...menu[0]!, id: ingredient, name: ['魚便當', '豬肉便當', '雞肉便當', '牛肉便當'][index]!, aliases: [], composition: { ingredients: [ingredient], complete: true, source: 'merchant', revision: '1', removals: [] } })), onAction: () => {}, onMenuRequested, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['fish'] })
  expect(await runtime.invokeForAgent('menu_get', { query: '蝨目魚' })).toHaveProperty('requestedQueries', ['蝨目魚'])
  expect(await runtime.executeTool('menu_open', {})).toHaveProperty('pendingCustomerChoice.purpose', 'recommendation-invitation')
  const result = await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: [ingredient] })
  expect(result).not.toHaveProperty('pendingCustomerChoice.purpose', 'menu-query-scope')
  expect(result).toHaveProperty('items', expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })]))
  expect(result).toHaveProperty('appliedFilters.includeIngredients', [ingredient])
  expect(runtime.getQueryState()?.conditions.some(condition => condition.group === 'includeIngredients' && condition.value === 'fish')).toBe(false)
  expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '水餃一份' })).not.toHaveProperty('phase', 'query_scope')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

// Report: this chat, Nov8 — session GZoe-FQFz572mVtAE5gqL, tool call85.
it('offers one input correction for stale continuation filters without executing or reviving them', async () => {
  const present = vi.fn()
  const runtime = createMenuToolRuntime({ menu, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: present })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['fish'] })
  await runtime.invokeForAgent('menu_get', { query: '炸雞腿' })
  const before = runtime.getQueryState()
  const calls = present.mock.calls.length
  const rejected = await runtime.executeTool('menu_recommend', { action: 'continue', includeIngredients: ['fish'] })
  expect(rejected).toMatchObject({ ok: false, executed: false, toolName: 'menu_recommend', error: 'INVALID_TOOL_INPUT' })
  expect(rejected).toHaveProperty('message', expect.stringContaining('includeIngredients'))
  expect(runtime.getQueryState()).toEqual(before)
  expect(present).toHaveBeenCalledTimes(calls)
  expect(await runtime.executeTool('menu_recommend', { action: 'continue' })).toHaveProperty('items', expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })]))
  expect(runtime.getQueryState()?.conditions.some(condition => condition.group === 'query')).toBe(false)
  expect(runtime.getQueryState()?.conditions.some(condition => condition.group === 'includeIngredients')).toBe(false)
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

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
  expect(await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['chicken'] })).toMatchObject({ appliedFilters: { includeIngredients: ['chicken'], excludeIngredients: ['egg'] }, appliedPriceConditions: {} })
})

// Report: DEV-810280 Nov8 — old recommendation exclusions must not hide a newly named dish.
it('keeps a newly requested fish dish visible despite stale model-supplied recommendation exclusions', async () => {
  const item = { ...menu[0]!, id: 'fish', name: '泰式酸辣魚便當', aliases: [], optionGroups: [] }
  const runtime = createMenuToolRuntime({ menu: [item], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invokeForAgent('menu_recommend', { action: 'update' })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'fish-name', transcript: '我要泰式酸辣魚', expectedMenuRevision: 0, readOnly: true, constraints: {} })
  const result = await runtime.invokeForAgent('menu_recommend', { action: 'update', query: '泰式酸辣魚', excludeItemIds: ['fish'] })
  expect(result).toHaveProperty('items', [expect.objectContaining({ id: 'fish' })])
  expect(runtime.getQueryState()?.conditions.some(condition => condition.group === 'excludedItems' && condition.value === 'fish')).not.toBe(true)
})

it.each(['泰式酸辣魚', '香辣雞肉', '麻辣牛肉麵'])('can propose the verified spicy dish %s without inventing customization', async (name) => {
  const item = { ...menu[0]!, id: 'fish', name: `${name}餐`, aliases: [], optionGroups: [] }
  const runtime = createMenuToolRuntime({ menu: [item], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'fish-proposal', transcript: `我要${name}`, expectedMenuRevision: 0, readOnly: false, constraints: {} })
  await runtime.invokeForAgent('menu_get', { query: name })
  expect(await runtime.invoke('kiosk_conversation_context')).toHaveProperty('unavailableConditions', [])
  expect(await runtime.invokeForAgent('menu_confirm_item', { itemId: 'fish' })).toHaveProperty('pendingCustomerChoice')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

// Report: DEV-810280 replay — an added fish dish was proposed as a replacement for existing dumplings.
it('cannot turn a qualified new-item request into a cart replacement', async () => {
  const fish = { ...menu[0]!, id: 'fish', name: '泰式酸辣魚便當', aliases: [], optionGroups: [] }
  const dumplings = { ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], optionGroups: [] }
  const runtime = createMenuToolRuntime({ menu: [fish, dumplings], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 5 })
  const before = await runtime.invoke('cart_get', { display: false }) as { cart: { lines: Array<{ id: string }> } }
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'add-only', transcript: '我要泰式酸辣魚一份', expectedMenuRevision: 0, readOnly: false, constraints: {}, handoff: { intent: 'ADD_ONLY', status: 'ambiguous', itemIds: [], lineIds: [] } })
  await runtime.invokeForAgent('menu_get', { query: '泰式酸辣魚' })
  await expect(runtime.invokeForAgent('menu_confirm_item', { itemId: 'fish', quantity: 1, replaceLineId: before.cart.lines[0]!.id })).rejects.toThrow('cannot replace')
  expect(await runtime.invokeForAgent('menu_confirm_item', { itemId: 'fish', quantity: 1 })).toHaveProperty('pendingCustomerChoice.question', expect.stringContaining('新增'))
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 5)
})

// Report: DEV-810280; operator authorized adding available items and naming missing ones in the same reply.
it('checks mixed named subjects and keeps authorized additions when another meal is absent', async () => {
  const item = { ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], optionGroups: [] }
  const runtime = createMenuToolRuntime({ menu: [item], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onMenuRequested: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'mixed-add', transcript: '水餃十份，再來一瓶酒', expectedMenuRevision: 0, readOnly: false, constraints: {}, handoff: { intent: 'ADD_ONLY', subjects: ['水餃', '酒'], status: 'ambiguous', itemIds: [], lineIds: [] } })
  expect(await runtime.invokeForAgent('order_add_item', { itemId: 'dumplings', quantity: 10 })).toHaveProperty('ok', false)
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  // Finding the missing sibling first must not pause before checking/adding the available meal.
  expect(await runtime.invokeForAgent('menu_get', { query: '酒' })).not.toHaveProperty('pendingCustomerChoice')
  const found = await runtime.invokeForAgent('menu_get', { queries: ['水餃', '酒'] })
  expect(found).toHaveProperty('missingQueries', ['酒'])
  expect(found).toHaveProperty('customerReply.facts', expect.stringContaining('菜單沒有「酒」'))
  expect(await runtime.invokeForAgent('order_add_item', { itemId: 'dumplings', quantity: 10 })).toHaveProperty('cart.itemCount', 10)
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.lines', [expect.objectContaining({ itemId: 'dumplings', quantity: 10 })])
})
