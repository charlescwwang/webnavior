import { expect, it } from 'vitest'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

// Report: this chat Nov09 — broad bento lookup spoke availability then prices for every dish.
it.each([4, 5, 8])('introduces %i matches three at a time while retaining the full grid', async (count) => {
  const dishes = Array.from({ length: count }, (_, index) => ({ ...menu[0]!, id: `dish-${index}`, name: `測試便當${index}`, aliases: [], category: '便當', price: 100 + index, optionGroups: [] }))
  const presentations: Array<{ itemIds: string[] }> = []
  const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onMenuRequested: () => {}, onRecommendationsChange: value => presentations.push(value) })
  const first = await runtime.invokeForAgent('menu_get', { query: '便當', display: true })
  expect(first).toHaveProperty('items', expect.arrayContaining(dishes.map(item => expect.objectContaining({ id: item.id }))))
  expect(presentations.at(-1)?.itemIds).toEqual(dishes.map(item => item.id))
  expect(first).toHaveProperty('customerMessage', expect.stringContaining(`有${count}道餐點`))
  expect(first).toHaveProperty('customerMessage', expect.stringContaining('測試便當0、測試便當1、測試便當2'))
  expect(first).toHaveProperty('customerMessage', expect.not.stringMatching(/目前可以點|單份|元|測試便當3/))
  const strip = runtime.getQueryState()?.conditions
  for (let start = 3; start < count; start += 3) {
    const result = await runtime.invokeForAgent('menu_recommend', { action: 'continue' })
    expect(result).toHaveProperty('items', dishes.slice(start, start + 3).map(item => expect.objectContaining({ id: item.id })))
    expect(result).toHaveProperty('customerMessage', expect.not.stringMatching(/目前可以點|單份|元|測試便當0/))
    expect(presentations).toHaveLength(1)
    expect(runtime.getQueryState()?.conditions).toEqual(strip)
  }
  expect(await runtime.invokeForAgent('menu_recommend', { action: 'continue' })).toHaveProperty('pendingCustomerChoice.purpose', 'menu-return-invitation')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  const selected = await runtime.invokeForAgent('menu_select_item', { itemId: dishes.at(-1)!.id })
  expect(selected).toHaveProperty('customerMessage', expect.stringContaining(`${dishes.at(-1)!.price}元`))
  expect(selected).toHaveProperty('customerReply.nextQuestion', '這道餐點要點幾份？')
})

it('preserves an explicit broad price inquiry instead of replacing it with a spoken batch', async () => {
  const dishes = [100, 110, 120, 130].map((price, index) => ({ ...menu[0]!, id: `dish-${index}`, name: `測試便當${index}`, aliases: [], price, optionGroups: [] }))
  const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'prices', transcript: '這些便當多少錢', expectedMenuRevision: 0, readOnly: true, constraints: {} })
  const result = await runtime.invokeForAgent('menu_get', { query: '便當', display: true })
  for (const price of [100, 110, 120, 130])
    expect(result).toHaveProperty('customerMessage', expect.stringContaining(`${price}元`))
})

it('replaces spoken progress on a fresh lookup and leaves data-only reads unspoken', async () => {
  const dishes = [0, 1, 2, 3].map(index => ({ ...menu[0]!, id: `dish-${index}`, name: `測試便當${index}`, aliases: [], optionGroups: [] }))
  const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invokeForAgent('menu_get', { query: '便當', display: true })
  const data = await runtime.invoke('menu_recommend', { more: true, display: false })
  expect(data).toHaveProperty('dataOnly', true)
  const next = await runtime.invokeForAgent('menu_recommend', { action: 'continue' })
  expect(next).toHaveProperty('items', [expect.objectContaining({ id: 'dish-3' })])
  const fresh = await runtime.invokeForAgent('menu_get', { query: '便當', display: true })
  expect(fresh).toHaveProperty('customerMessage', expect.stringContaining('測試便當0、測試便當1、測試便當2'))
})

it('keeps the fast-path price choice factual without starting a spoken introduction', async () => {
  const dishes = [100, 110, 120, 130].map((price, index) => ({ ...menu[0]!, id: `dish-${index}`, name: `測試便當${index}`, aliases: [], category: '便當', price, optionGroups: [] }))
  const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '便當多少錢' })
  const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', priceChoiceId: 'INFORMATION' })
  for (const price of [100, 110, 120, 130])
    expect(result).toHaveProperty('customerMessage', expect.stringContaining(`${price}元`))
  expect(result).toHaveProperty('customerMessage', expect.not.stringContaining('先介紹'))
})
