import { describe, expect, it, vi } from 'vitest'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

const dishes = [120, 80, 100, 90, 180, 70, 60].map((price, index) => ({ ...menu[0]!, id: `dish-${index}`, name: `便當${index}`, category: '便當', price, optionGroups: [] }))
const runtimeOptions = { menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} }

describe('price-qualified menu reads', () => {
  it.each([
    { transcript: '130以下的餐點', choice: 'UPPER_INCLUSIVE', conditions: { maxPrice: 130 }, ids: ['dish-1', 'dish-2', 'dish-3'] },
    { transcript: '不到130的餐點', choice: 'UPPER_EXCLUSIVE', conditions: { maxPrice: 130, maxPriceExclusive: true }, ids: ['dish-2', 'dish-3', 'dish-4'] },
    { transcript: '130以上的餐點', choice: 'LOWER_INCLUSIVE', conditions: { minPrice: 130 }, ids: ['dish-0', 'dish-1'] },
    { transcript: '超過130的餐點', choice: 'LOWER_EXCLUSIVE', conditions: { minPrice: 130, minPriceExclusive: true }, ids: ['dish-0'] },
    { transcript: '剛好130的餐點', choice: 'EXACT', conditions: { minPrice: 130, maxPrice: 130 }, ids: ['dish-1'] },
    { transcript: '100以上不到130的餐點', choice: 'RANGE_MAX_EXCLUSIVE', conditions: { minPrice: 100, maxPrice: 130, maxPriceExclusive: true }, ids: ['dish-2', 'dish-3', 'dish-4'] },
    { transcript: '超過100但不超過130的餐點', choice: 'RANGE_MIN_EXCLUSIVE', conditions: { minPrice: 100, minPriceExclusive: true, maxPrice: 130 }, ids: ['dish-1', 'dish-2', 'dish-3'] },
    { transcript: '超過100、不到130的餐點', choice: 'RANGE_EXCLUSIVE', conditions: { minPrice: 100, minPriceExclusive: true, maxPrice: 130, maxPriceExclusive: true }, ids: ['dish-2', 'dish-3'] },
  ])('keeps the validated boundary semantics in the visible batch: $transcript', async ({ transcript, choice, conditions, ids }) => {
    const display = vi.fn()
    const boundedDishes = [131, 130, 120, 110, 100, 99].map((price, index) => ({ ...dishes[index]!, price }))
    const runtime = createMenuToolRuntime({ ...runtimeOptions, menu: boundedDishes, onRecommendationsChange: display })
    await runtime.invoke('kiosk_fast_path_context', { transcript })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', priceChoiceId: choice })).toMatchObject({ appliedPriceConditions: conditions, presentation: { itemIds: ids } })
    expect(display.mock.calls[0]?.[0].itemIds).toEqual(ids)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('answers the stated unitless upper bound instead of asking for the price again', async () => {
    const display = vi.fn()
    const boundedDishes = [131, 130, 129, 150, 80, 60].map((price, index) => ({ ...dishes[index]!, price }))
    const runtime = createMenuToolRuntime({ ...runtimeOptions, menu: boundedDishes, onRecommendationsChange: display })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '有價格130以下的嗎？' })
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', priceChoiceId: 'UPPER_INCLUSIVE' })
    expect(result).toMatchObject({ appliedPriceConditions: { maxPrice: 130 }, items: [{ id: 'dish-1', price: 130 }, { id: 'dish-2', price: 129 }, { id: 'dish-4', price: 80 }], presentation: { itemIds: ['dish-1', 'dish-2', 'dish-4'] } })
    expect(display.mock.calls[0]?.[0].itemIds).toEqual(['dish-1', 'dish-2', 'dish-4'])
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('keeps the displayed dishes and spoken results within the unitless price range', async () => {
    const display = vi.fn()
    const rangedDishes = [99, 100, 110, 120, 130, 131].map((price, index) => ({ ...dishes[index]!, price }))
    const runtime = createMenuToolRuntime({ ...runtimeOptions, menu: rangedDishes, onRecommendationsChange: display })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '有100~130之間的嗎？' })
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', priceChoiceId: 'RANGE' })
    expect(result).toMatchObject({ appliedPriceConditions: { minPrice: 100, maxPrice: 130 }, items: [{ id: 'dish-1', price: 100 }, { id: 'dish-2', price: 110 }, { id: 'dish-3', price: 120 }] })
    expect(display).toHaveBeenCalledOnce()
    expect(display.mock.calls[0]?.[0].itemIds).toEqual(['dish-1', 'dish-2', 'dish-3'])
    expect(result).toMatchObject({ presentation: display.mock.calls[0]?.[0] })
    expect(await runtime.invoke('menu_recommend', { more: true })).toMatchObject({ appliedPriceConditions: { minPrice: 100, maxPrice: 130 }, items: [{ id: 'dish-4', price: 130 }], presentation: { itemIds: ['dish-4'] } })
    expect(display.mock.calls[1]?.[0].itemIds).toEqual(['dish-4'])
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('intersects category and price range, sorts before limiting, and displays the actual prices', async () => {
    const runtime = createMenuToolRuntime({ ...runtimeOptions, menu: [...dishes, { ...dishes[1]!, id: 'soup', name: '湯', category: '湯品', price: 85 }] })
    const result = await runtime.invoke('menu_get', { category: '便當', minPrice: 80, maxPrice: 120, priceOrder: 'ASC' })
    expect(result).toMatchObject({ items: [{ id: 'dish-1', price: 80 }, { id: 'dish-3', price: 90 }, { id: 'dish-2', price: 100 }] })
    expect(result).toMatchObject({ presentation: { title: expect.stringContaining('80'), itemIds: ['dish-1', 'dish-3', 'dish-2'] } })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('retains exclusive bounds, category and ordering across alternative batches without recycling', async () => {
    const runtime = createMenuToolRuntime(runtimeOptions)
    const first = await runtime.invoke('menu_recommend', { category: '便當', maxPrice: 100, maxPriceExclusive: true, priceOrder: 'ASC' })
    expect(first).toMatchObject({ items: [{ id: 'dish-6' }, { id: 'dish-5' }, { id: 'dish-1' }] })
    expect(await runtime.invoke('menu_recommend', { more: true })).toMatchObject({ items: [{ id: 'dish-3' }] })
    expect(await runtime.invoke('menu_recommend', { more: true })).toMatchObject({ items: [], availability: 'NONE' })
    await expect(runtime.invoke('menu_recommend', { more: true, maxPrice: 120 })).rejects.toThrow('start a new recommendation')
  })

  it('rejects invalid ranges and does not relax an empty price filter', async () => {
    const display = vi.fn()
    const runtime = createMenuToolRuntime({ ...runtimeOptions, onRecommendationsChange: display })
    await runtime.invoke('menu_recommend', { maxPrice: 130 })
    await expect(runtime.invoke('menu_get', { minPrice: 120, maxPrice: 80 })).rejects.toThrow('price')
    const offer = await runtime.invoke('menu_recommend', { maxPrice: 50 }) as { pendingCustomerChoice: { questionId: string } }
    expect(await runtime.invoke('kiosk_query_scope', { questionId: offer.pendingCustomerChoice.questionId, choice: 'CATALOG' })).toMatchObject({ items: [], availability: 'NONE', presentation: { itemIds: [] } })
    expect(display.mock.lastCall?.[0].itemIds).toEqual([])
    expect(await runtime.invoke('menu_recommend', { minPrice: 150 })).toMatchObject({ appliedPriceConditions: { minPrice: 150 }, items: [{ id: 'dish-4', price: 180 }], presentation: { itemIds: ['dish-4'] } })
  })

  it('executes only browser-issued price interpretations and carries category into the plan', async () => {
    const runtime = createMenuToolRuntime(runtimeOptions)
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '推薦100元以下的便當' })
    expect(context).toMatchObject({ priceEvidence: { amounts: [{ amount: 100 }] } })
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:recommend', priceChoiceId: 'UPPER_INCLUSIVE' })
    expect(result).toMatchObject({ appliedPriceConditions: { maxPrice: 100 }, decisionTrace: { operationPlan: { input: { category: '便當', maxPrice: 100 } } } })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '不到100元的便當有哪些' })
    const strict = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', priceChoiceId: 'UPPER_EXCLUSIVE' })
    expect(strict).toMatchObject({ appliedPriceConditions: { maxPrice: 100, maxPriceExclusive: true } })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '100元以下' })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', priceChoiceId: 'fabricated', maxPrice: 1000 })).rejects.toThrow('issued')
    await runtime.invoke('kiosk_fast_path_context', { transcript: '100元以下' })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu' })).rejects.toThrow('issued')
  })

  it('guards Agent handoffs against widened prices, hallucinated recommendations and partial mutations', async () => {
    const runtime = createMenuToolRuntime(runtimeOptions)
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '100元以下' })
    if (!context || typeof context !== 'object' || !('menuRevision' in context))
      throw new Error('Expected a runtime-issued catalog revision')
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', transcript: '便當0一份', taskId: 'price-1', expectedMenuRevision: context.menuRevision, constraints: { maxPrice: 100, maxPriceExclusive: true, priceOrder: 'ASC' } })
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'update', maxPrice: 1000 })).toMatchObject({ items: [{ price: 60 }, { price: 70 }, { price: 80 }], appliedPriceConditions: { maxPrice: 100, maxPriceExclusive: true } })
    await expect(runtime.invokeForAgent('menu_show_recommendations', { itemIds: ['dish-0'] })).rejects.toThrow('constraints')
    await expect(runtime.invokeForAgent('order_add_item', { itemId: 'dish-0', quantity: 1 })).rejects.toThrow('price conditions')
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', transcript: '查詢餐點', taskId: 'price-2', expectedMenuRevision: context.menuRevision, constraints: { unresolvedPrice: true } })
    expect(await runtime.invokeForAgent('menu_recommend')).toMatchObject({ ok: false, items: [], customerMessage: expect.stringContaining('單份') })
    expect(await runtime.invokeForAgent('order_add_item', { itemId: 'dish-0', quantity: 2 })).toMatchObject({ customerMessage: expect.stringContaining('單份') })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })
})

// Report: this chat, Nov09 — Main changed an inclusive 130 boundary to exclusive after admission.
it.each([
  { label: 'inclusive maximum', verified: { maxPrice: 130 }, proposed: { maxPrice: 130, maxPriceExclusive: true }, ids: ['below', 'equal'] },
  { label: 'exclusive maximum', verified: { maxPrice: 130, maxPriceExclusive: true }, proposed: { maxPrice: 130, maxPriceExclusive: false }, ids: ['below'] },
  { label: 'inclusive minimum', verified: { minPrice: 130 }, proposed: { minPrice: 130, minPriceExclusive: true }, ids: ['equal', 'above'] },
  { label: 'exclusive minimum', verified: { minPrice: 130, minPriceExclusive: true }, proposed: { minPrice: 130, minPriceExclusive: false }, ids: ['above'] },
  { label: 'smaller invented maximum', verified: { maxPrice: 130 }, proposed: { maxPrice: 129 }, ids: ['below', 'equal'] },
  { label: 'invented lower bound', verified: { maxPrice: 130 }, proposed: { minPrice: 130, maxPrice: 130 }, ids: ['below', 'equal'] },
])('retains the verified price group through Main: $label', async ({ verified, proposed, ids }) => {
  const runtime = createMenuToolRuntime({ ...runtimeOptions, menu: ['below', 'equal', 'above'].map((id, index) => ({ ...dishes[0]!, id, name: `餐點${index}`, aliases: [], price: 129 + index })) })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'boundary', transcript: '依價格找餐點', expectedMenuRevision: 0, readOnly: true, constraints: verified })
  const result = await runtime.invokeForAgent('menu_recommend', { action: 'update', ...proposed })
  expect(result).toMatchObject({ appliedPriceConditions: verified, items: ids.map(id => ({ id })) })
  expect(runtime.getQueryState()?.conditions).toHaveLength(1)
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})
