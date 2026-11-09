import type { QueryView } from './domain/browsing'

import { expect, it } from 'vitest'

import { supplierCatalog } from '../../order-menu-server/src/supplierSimulation'
import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

function setup(onQueryStateChange?: (state: QueryView | undefined) => void) {
  return createMenuToolRuntime({ menu: [
    { id: 'fish-rice', name: '魚飯', category: '飯', price: 130, ingredient: 'fish' },
    { id: 'fish-noodle', name: '魚麵', category: '麵', price: 150, ingredient: 'fish' },
    { id: 'pork-rice', name: '豬肉飯', category: '飯', price: 100, ingredient: 'pork' },
    { id: 'pork-noodle', name: '豬肉麵', category: '麵', price: 160, ingredient: 'pork' },
  ].map(({ ingredient, ...item }) => ({ ...menu[0]!, ...item, aliases: [], optionGroups: [], composition: { ingredients: [ingredient], complete: true, source: 'merchant' as const, revision: '1', removals: [] } })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: () => {}, onMenuRequested: () => {}, onQueryStateChange })
}

// Report: this chat, Nov09 — new utterances replace positive preferences; one utterance combines them.
it('replaces old category, price and ingredient preferences while keeping exclusions', async () => {
  const runtime = setup()
  await runtime.invokeForAgent('menu_recommend', { action: 'update', category: '飯', includeIngredients: ['fish'], maxPrice: 140, excludeIngredients: ['egg'] })
  const result = await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['pork'] })
  expect(result).toMatchObject({ appliedFilters: { includeIngredients: ['pork'], excludeIngredients: ['egg'] }, appliedPriceConditions: {}, items: [{ id: 'pork-rice' }, { id: 'pork-noodle' }], queryState: { category: '' } })
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

it('combines conditions supplied together and retains only that set for more results', async () => {
  const runtime = setup()
  await runtime.invokeForAgent('menu_recommend', { action: 'update', category: '飯', includeIngredients: ['fish'], maxPrice: 140 })
  expect(await runtime.invokeForAgent('menu_recommend', { action: 'update', category: '麵', includeIngredients: ['pork'], maxPrice: 170 })).toMatchObject({ appliedFilters: { includeIngredients: ['pork'] }, appliedPriceConditions: { maxPrice: 170 }, items: [{ id: 'pork-noodle' }] })
  const before = runtime.getQueryState()
  await runtime.invokeForAgent('menu_recommend', { action: 'continue' })
  expect(runtime.getQueryState()?.conditions).toEqual(before?.conditions)
})

it('preserves exclusions through the direct Host recommendation path as positives change', async () => {
  const runtime = setup()
  await runtime.invoke('menu_recommend', { action: 'update', includeIngredients: ['fish'], excludeIngredients: ['egg'], maxPrice: 140 })
  expect(await runtime.invoke('menu_recommend', { action: 'update', includeIngredients: ['pork'] })).toMatchObject({ appliedFilters: { includeIngredients: ['pork'], excludeIngredients: ['egg'] }, appliedPriceConditions: {}, items: [{ id: 'pork-rice' }, { id: 'pork-noodle' }] })
})

// Report: this chat, Nov09 — the grid changed through menu_get but the condition strip kept the previous batch.
it('publishes the same replacement conditions for displayed category and ingredient reads', async () => {
  const states: unknown[] = []
  const runtime = setup(state => states.push(state))
  await runtime.invoke('menu_recommend', { action: 'update', includeIngredients: ['fish'] })
  await runtime.invoke('menu_get', { category: '麵', display: true })
  expect(states.at(-1)).toMatchObject({ conditions: [{ group: 'category', label: '麵' }] })
  expect(runtime.getQueryState()).toEqual(states.at(-1))
  await runtime.invoke('menu_get', { includeIngredients: ['pork'], display: true })
  expect(states.at(-1)).toMatchObject({ conditions: [{ group: 'includeIngredients', value: 'pork' }] })
})

// Report: this chat, Nov09 — an unknown requested food cannot be replaced by unrelated clarification cards.
it.each(['麵包', '飲料', '湯', '壽司'])('looks up the qualified original subject %s before suggesting anything else', async (subject) => {
  const runtime = setup()
  await runtime.invoke('menu_recommend', { action: 'update', category: '飯' })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'unknown-food', transcript: `有${subject}嗎`, expectedMenuRevision: 0, readOnly: true, constraints: {}, handoff: { intent: 'SEARCH_MENU', subjects: [subject], status: 'ambiguous', itemIds: [], lineIds: [] } })
  const result = await runtime.invokeForAgent('menu_recommend', { action: 'clarify' })
  expect(result).toMatchObject({ items: [], requestedQueries: [subject], matchKind: 'none', pendingCustomerChoice: { purpose: 'menu-return-invitation' } })
  expect(result).toHaveProperty('customerMessage', expect.stringContaining(`查不到「${subject}」`))
  expect(result).not.toHaveProperty('guidance.itemIds')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

// Report: this chat, Nov09 — a category result must invite ordering rather than another viewing step.
it('invites a meal choice after displaying a category result', async () => {
  const runtime = setup()
  const result = await runtime.invoke('menu_get', { category: '麵', display: true })
  expect(result).toHaveProperty('customerReply.nextQuestion', '您想點哪一道？')
})

// Report: this chat, Nov09 — selecting a displayed dish lost its next quantity question.
it('offers and consumes a quantity question after selecting a dish without adding by default', async () => {
  const runtime = setup()
  await runtime.invoke('menu_get', { category: '麵', display: true })
  const selected = await runtime.invoke('menu_select_item', { itemId: 'pork-noodle' }) as { pendingCustomerChoice: { questionId: string, question: string } }
  expect(selected).toHaveProperty('pendingCustomerChoice.purpose', 'item-order')
  expect(selected).toHaveProperty('customerMessage', expect.stringContaining('幾份'))
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  await runtime.invoke('kiosk_dialogue_presented', { questionId: selected.pendingCustomerChoice.questionId, content: selected.pendingCustomerChoice.question })
  expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' })).toHaveProperty('waitingFor.purpose', 'item-order')
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.lines', [expect.objectContaining({ itemId: 'pork-noodle', quantity: 2 })])
})

// Report: this chat Nov09 — a qualified named inquiry must not continue an older recommendation.
it.each(['update', 'continue', 'reset', 'clarify'])('keeps a qualified unknown name through a proposed %s recommendation', async (action) => {
  const runtime = setup()
  await runtime.invoke('menu_recommend', { action: 'update', includeIngredients: ['pork'] })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: `named:${action}`, transcript: '炸雞排便當有沒有', expectedMenuRevision: 0, readOnly: true, constraints: {}, handoff: { intent: 'SEARCH_MENU', subjects: ['炸雞排便當'], status: 'ambiguous', itemIds: [], lineIds: [] } })
  const result = await runtime.invokeForAgent('menu_recommend', { action })
  expect(result).toHaveProperty('requestedQueries', ['炸雞排便當'])
  expect(result).toHaveProperty('customerMessage', expect.stringContaining('炸雞排便當'))
  expect(result).not.toHaveProperty('customerMessage', expect.stringContaining('推薦3'))
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: `named:${action}` })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'normal-recommendation', transcript: '有其他推薦嗎', expectedMenuRevision: 0, readOnly: true, constraints: {} })
  expect(await runtime.invokeForAgent('menu_recommend', { action: 'update' })).not.toHaveProperty('requestedQueries', ['炸雞排便當'])
})

// Confirmed subject policy generalizes across catalogs and does not depend on a food keyword list.
it.each(['original', 'supplier'])('keeps all qualified named lookups on their original subjects in the %s catalog', async (catalog) => {
  const runtime = createMenuToolRuntime({ menu: catalog === 'supplier' ? supplierCatalog.items : menu, merchant: { id: catalog === 'supplier' ? 'shalun-simulation' : 'original', paymentPolicy: 'cashless' }, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: () => {}, onMenuRequested: () => {} })
  for (const subject of ['炸雞排便當', '鮭魚麵包', '打拋牛便當']) {
    for (const action of ['continue', 'update', 'clarify']) {
      const taskId = `${subject}:${action}`
      await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId, transcript: `請問有${subject}嗎`, expectedMenuRevision: 0, readOnly: true, constraints: {}, handoff: { intent: 'SEARCH_MENU', subjects: [subject], status: 'ambiguous', itemIds: [], lineIds: [] } })
      const result = await runtime.invokeForAgent('menu_recommend', { action })
      expect(result).toHaveProperty('requestedQueries', [subject])
      expect(result).toHaveProperty('matchKind', expect.stringMatching(/none|possible/))
      expect(result).toHaveProperty('customerMessage', expect.stringContaining(subject))
      expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
      await runtime.invoke('kiosk_agent_task', { action: 'END', taskId })
    }
  }
})
