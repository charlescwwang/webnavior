import type { CatalogSnapshot } from '../../order-menu-server/src/domain/contracts'

import { describe, expect, it } from 'vitest'

import { createPosSimulator } from '../../order-menu-server/src/simulator'
import { createOrderMachine } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

describe('current POS menu without customization options', () => {
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
    { transcript: '我想吃麵，一碗', itemId: 'beef-noodle-soup', price: 150 },
    { transcript: '我要吃麵，一碗', itemId: 'beef-noodle-soup', price: 150 },
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
