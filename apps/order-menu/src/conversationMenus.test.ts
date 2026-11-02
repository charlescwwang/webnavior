import type { MenuItem } from './domain/order-machine'

import { expect, it } from 'vitest'

import { historyData } from './evaluation/historyData'
import { createMenuToolRuntime } from './webmcp'

// Plan: docs/plans/2026-10-28-kiosk-conversation-repair.md, catalog-data changes.
// These are domain/contract replays with explicit semantic choices, not claims
// that a real model recognized the fixture's names or customer intent.
const menus: Array<{ label: string, menu: MenuItem[], target: string, utterance: string, answers: Array<{ transcript: string, groupId: string, valueId: string }>, unitPrice: number, total: number }> = [
  { label: 'retained field catalog', menu: historyData.catalog, target: 'dumplings', utterance: '有水餃嗎', answers: [], unitPrice: 80, total: 160 },
  { label: 'different identity/category/price and two required groups', menu: [{ id: 'taro-plate', name: '芋香雙拼盤', aliases: [], recommendationTags: [], category: '雙拼主食', description: '', imageUrl: '', available: true, price: 153, optionGroups: [
    { id: 'portion', label: '配菜', required: true, values: [{ id: 'roast', label: '烤蔬菜', priceDelta: 9 }] },
    { id: 'dressing', label: '醬汁', required: true, values: [{ id: 'sesame', label: '芝麻醬', priceDelta: 0 }] },
  ] }], target: 'taro-plate', utterance: '有芋香雙拼盤嗎', answers: [{ transcript: '烤蔬菜', groupId: 'portion', valueId: 'roast' }, { transcript: '芝麻醬', groupId: 'dressing', valueId: 'sesame' }], unitPrice: 162, total: 324 },
  { label: 'different required option schema', menu: [{ id: 'mushroom-rice', name: '香菇野菜炊飯', aliases: [], recommendationTags: [], category: '季節料理', description: '', imageUrl: '', available: true, price: 116, optionGroups: [
    { id: 'grain', label: '米飯', required: true, values: [{ id: 'millet', label: '小米飯', priceDelta: 15 }] },
  ] }], target: 'mushroom-rice', utterance: '有香菇野菜炊飯嗎', answers: [{ transcript: '小米飯', groupId: 'grain', valueId: 'millet' }], unitPrice: 131, total: 262 },
  // This fixture is reserved for offline verification and is not used to tune
  // provider instructions or select a model.
  { label: 'held-out identity and option discount', menu: [{ id: 'lemon-cod-wrap', name: '檸香鱈魚捲', aliases: [], recommendationTags: [], category: '輕食捲類', description: '', imageUrl: '', available: true, price: 92, optionGroups: [
    { id: 'vegetables', label: '蔬菜', required: true, values: [{ id: 'greens', label: '生菜', priceDelta: -3 }] },
  ] }], target: 'lemon-cod-wrap', utterance: '有檸香鱈魚捲嗎', answers: [{ transcript: '生菜', groupId: 'vegetables', valueId: 'greens' }], unitPrice: 89, total: 178 },
]

it.each(menus)('keeps lookup, omitted-name purchase and required options grounded in $label', async (fixture) => {
  const runtime = createMenuToolRuntime({ menu: fixture.menu, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: fixture.utterance })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', searchInterpretation: 'product', ingredientFilters: { excludeIngredients: [], includeIngredients: [] } })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  const request = await runtime.invoke('kiosk_fast_path_context', { transcript: '那我要兩份' }) as { intentRecovery?: { candidateIds: string[] } }
  expect(request.intentRecovery?.candidateIds).toContain('intent:add-item')
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  for (const answer of fixture.answers) {
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    const current = await runtime.invoke('kiosk_fast_path_context', { transcript: answer.transcript }) as { candidates: Array<{ id: string }>, retainedRequests: Array<{ quantity?: number }> }
    expect(current.retainedRequests[0]!.quantity).toBe(2)
    const choice = current.candidates.find(candidate => candidate.id.endsWith(`:${answer.groupId}:${answer.valueId}`))
    expect(choice).toBeDefined()
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: choice!.id })
  }
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2, total: fixture.total, lines: [{ itemId: fixture.target, quantity: 2, unitPrice: fixture.unitPrice, options: Object.fromEntries(fixture.answers.map(answer => [answer.groupId, answer.valueId])) }] } })
  expect(await runtime.invoke('kiosk_conversation_context')).toMatchObject({ retainedRequests: [] })
})

it('rejects old draft answers after catalog price/options change and rebuilds from current data', async () => {
  const fixture = menus[1]!
  const runtime = createMenuToolRuntime({ menu: fixture.menu, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '芋香雙拼盤兩份' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const old = await runtime.invoke('kiosk_fast_path_context', { transcript: '烤蔬菜' }) as { candidates: Array<{ id: string }> }
  const oldChoice = old.candidates.find(candidate => candidate.id.endsWith(':portion:roast'))!.id
  runtime.setMenu([{ ...fixture.menu[0]!, price: 167, optionGroups: [] }])
  await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: oldChoice })).rejects.toThrow('STALE')
  expect(await runtime.invoke('kiosk_conversation_context')).toMatchObject({ retainedRequests: [], cart: { itemCount: 0 } })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '芋香雙拼盤兩份' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { total: 334, lines: [{ itemId: 'taro-plate', quantity: 2, unitPrice: 167, options: {} }] } })
})
