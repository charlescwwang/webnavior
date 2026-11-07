import type { CatalogSnapshot } from '../../order-menu-server/src/domain/contracts'

import { describe, expect, it } from 'vitest'

import { createPosSimulator } from '../../order-menu-server/src/simulator'
import { createOrderMachine } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

describe('current POS menu without customization options', () => {
  // Report: this chat, 2026-10-20: 「有水餃或牛肉麵嗎？」 displays only one dish.
  it.each([false, true])('keeps both dishes visible when Main splits one inquiry into lookups (parallel: %s)', async (parallel) => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const shown: string[][] = []
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: presentation => shown.push(presentation.itemIds) })
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'two-dishes', transcript: '有水餃或牛肉麵嗎？', expectedMenuRevision: 0, readOnly: true, constraints: {} })
    if (parallel) {
      await Promise.all(['水餃', '牛肉麵'].map(query => runtime.invokeForAgent('menu_get', { query })))
    }
    else {
      await runtime.invokeForAgent('menu_get', { query: '水餃' })
      const result = await runtime.invokeForAgent('menu_get', { query: '牛肉麵' })
      expect(result).toMatchObject({ items: [{ id: 'beef-noodle-soup' }] })
    }
    expect(shown.at(-1)).toEqual(expect.arrayContaining(['dumplings', 'beef-noodle-soup']))
    await runtime.invokeForAgent('menu_get', { query: '水餃' })
    expect(shown.at(-1)).toHaveLength(2)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'next-inquiry', transcript: '水餃呢？', expectedMenuRevision: 0, readOnly: true, constraints: {} })
    await runtime.invokeForAgent('menu_get', { query: '水餃' })
    expect(shown.at(-1)).toEqual(['dumplings'])
  })

  // Report: this chat, 2026-10-20: 「有水餃或牛肉麵嗎？」 displays only one dish.
  it('shows both named dishes for an availability inquiry without adding an order', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '有水餃或牛肉麵嗎？' })
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', ingredientFilters: { includeIngredients: [], excludeIngredients: [] } })
    expect(result).toMatchObject({ presentation: { itemIds: expect.arrayContaining(['dumplings', 'beef-noodle-soup']) } })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('checks disputed meal names and explicitly corrects a nonexistent recommendation', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const result = await runtime.invokeForAgent('menu_get', { queries: ['香菜肉絲乾麵', '韭菜盒', '甜不辣'], verifyClaim: true })
    expect(result).toMatchObject({ items: [], customerMessage: '您說得對，剛才的介紹有誤。目前菜單查不到「香菜肉絲乾麵、韭菜盒、甜不辣」。' })
    const actual = await runtime.invokeForAgent('menu_get', { query: '水餃', verifyClaim: true })
    expect(actual).toMatchObject({ items: [{ id: 'dumplings' }], customerMessage: '已核對目前菜單：水餃目前可以點。每份10顆，80元，現點現煮。' })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    await expect(runtime.invokeForAgent('menu_get', { verifyClaim: true })).rejects.toThrow('Specify the meal names')
  })

  it('retains an abbreviated fish-bento name as discovery evidence without authorizing a purchase', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('menu_recommend')
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '我要酸辣魚便當' }) as { candidates: Array<{ id: string }> }
    expect(context).toMatchObject({
      productResolution: { status: 'possible', count: 1, references: [{ label: '泰式酸辣魚便當' }] },
      catalogEvidence: { products: [{ label: '泰式酸辣魚便當', matchedText: '酸辣魚便當', source: 'fragment' }] },
    })
    expect(context.candidates.some(candidate => candidate.id === 'intent:add-item')).toBe(false)
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })).rejects.toThrow()
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    const exact = await runtime.invoke('kiosk_fast_path_context', { transcript: '我要泰式酸辣魚便當' }) as { candidates: Array<{ id: string }> }
    expect(exact.candidates.some(candidate => candidate.id === 'intent:add-item')).toBe(true)
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })).toMatchObject({ customerMessage: '請問泰式酸辣魚便當要幾份？' })
  })
  it('recognizes 排骨便當 as a declared alias and adds one serving', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '排骨便當來一份。' }) as { candidates: Array<{ id: string }> }
    expect(context).toMatchObject({
      productResolution: { status: 'exact', count: 1 },
      catalogEvidence: { products: [{ label: '炸排骨便當', matchedText: '排骨便當', source: 'alias' }] },
    })
    expect(context.candidates.some(candidate => candidate.id === 'intent:add-item')).toBe(true)
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })).toMatchObject({
      cart: { itemCount: 1, total: 130, lines: [{ itemId: 'fried-pork-chop-bento', name: '炸排骨便當', quantity: 1, options: {} }] },
    })
  })

  it.each([
    { transcript: '我想吃牛肉麵，一碗', itemId: 'beef-noodle-soup', price: 150 },
    { transcript: '我要吃牛肉麵，一碗', itemId: 'beef-noodle-soup', price: 150 },
    { transcript: '我要水餃，一份', itemId: 'dumplings', price: 80 },
  ])('adds $transcript without an option question', async ({ transcript, itemId, price }) => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript })
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    expect(result).toMatchObject({ cart: { itemCount: 1, total: price, lines: [{ itemId, quantity: 1, options: {} }] } })
    expect(result).not.toHaveProperty('pendingConfiguration')
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'ordering' })
  })

  // A category quantity does not authorize choosing its sole member as a named dish.
  it.each(['我想吃麵，一碗', '我要吃麵，一碗'])('hands %s to Main without substituting beef noodles', async (transcript) => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })).toMatchObject({ needsAssistant: true, decisionTrace: { operationPlan: null, authorize: null } })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('keeps quantity questions and category browsing without supplying customization choices', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const browse = await runtime.invoke('kiosk_fast_path_context', { transcript: '我想吃麵' }) as { candidates: Array<{ intent: string }> }
    expect(browse.candidates.some(candidate => candidate.intent === 'ADD_ITEM')).toBe(false)
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要水餃' })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })).toMatchObject({ customerMessage: '請問水餃要幾份？' })
    const quantity = await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' }) as { candidates: Array<{ id: string, description: string }> }
    const choice = quantity.candidates.find(candidate => candidate.description.includes('2 份'))!
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: choice.id })).toMatchObject({ cart: { itemCount: 2, total: 160, lines: [{ options: {}, quantity: 2 }] } })
  })

  it('gives the Agent no menu options and rejects invented option settings without changing its cart', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const lookup = await runtime.invokeForAgent('menu_get', { display: false }) as { items: CatalogSnapshot['items'] }
    for (const item of lookup.items)
      expect(item.optionGroups).toEqual([])
    await runtime.invokeForAgent('order_add_item', { itemId: 'beef-noodle-soup', quantity: 1 })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '改微辣' }) as { candidates: Array<{ intent: string }> }
    expect(context.candidates.some(candidate => candidate.intent === 'SET_OPTION')).toBe(false)
    await expect(runtime.invokeForAgent('order_add_item', { itemId: 'beef-noodle-soup', quantity: 1, options: { spice: 'light' } })).rejects.toThrow()
    await expect(runtime.invokeForAgent('order_add_item', { itemId: 'dumplings', quantity: 1, options: { pieces: '15' } })).rejects.toThrow()
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, total: 150 } })
  })

  it('lets the touch ordering machine add fixed servings with no required options', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const machine = createOrderMachine({ menu: catalog.items })
    machine.selectMenuItem('beef-noodle-soup')
    machine.addToCart()
    machine.selectMenuItem('dumplings')
    machine.setQuantity(2)
    machine.addToCart()
    expect(machine.getCart()).toMatchObject({ itemCount: 3, total: 310, lines: [{ options: {}, quantity: 1 }, { options: {}, quantity: 2 }] })
  })
})

// Report: live112 C02-F1; successful price read was spoken as availability only.
it('includes authoritative price in a single named-item lookup reply', async () => {
  const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const receipt = await runtime.invokeForAgent('menu_get', { query: '水餃' })
  expect(receipt).toMatchObject({ customerMessage: expect.stringContaining('80') })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})
