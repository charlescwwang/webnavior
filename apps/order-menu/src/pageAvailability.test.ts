import type { MenuItem } from './domain/order-machine'

import { describe, expect, it } from 'vitest'

import { createMenuToolRuntime } from './webmcp'

const menu: MenuItem[] = [
  { id: 'fish', name: '泰式酸辣魚便當', category: '便當', description: '測試餐點', price: 130, imageUrl: '', recommendationTags: [], optionGroups: [] },
  { id: 'dumplings', name: '水餃', category: '點心', description: '測試餐點', price: 80, imageUrl: '', recommendationTags: [], optionGroups: [] },
]
const options = { menu, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} }

describe('observable menu availability for acceptance trials', () => {
  it.each([
    { state: 'available', status: 'available', message: '目前可以點' },
    { state: 'sold-out', status: 'sold-out', message: '目前售完' },
    { state: 'unknown', status: 'unknown', message: '目前無法確認' },
  ])('keeps $state visible to queries without inventing stock counts', async ({ state, status, message }) => {
    const runtime = createMenuToolRuntime({ ...options, testing: true })
    await runtime.invoke('kiosk_test_menu', { itemId: 'fish', state })
    const receipt = await runtime.invoke('menu_get', { query: '泰式酸辣魚便當', display: true })
    expect(receipt).toMatchObject({ itemStatuses: [{ id: 'fish', status }], customerMessage: expect.stringContaining(message) })
    expect(JSON.stringify(receipt)).not.toContain('remainingQuantity')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('answers an availability question about the proposed dish without buying it or repeating confirmation', async () => {
    const runtime = createMenuToolRuntime(options)
    const offer = await runtime.invoke('kiosk_fast_path_context', { transcript: '酸辣魚便當' }) as { clarificationOffer: { id: string } }
    await runtime.invoke('kiosk_fast_path_clarify', { questionId: offer.clarificationOffer.id })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '我想問還有沒有' }) as { waitingFor: { questionId: string }, candidates: Array<{ id: string }> }
    const candidateId = `inquire-meal:${context.waitingFor.questionId}`
    expect(context.candidates).toContainEqual(expect.objectContaining({ id: candidateId }))
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId })
    expect(result).toMatchObject({ customerMessage: expect.stringContaining('泰式酸辣魚便當目前可以點') })
    expect(result).not.toHaveProperty('pendingCustomerChoice')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'ordering' })
  })

  it.each(['sold-out', 'unknown'])('can still resolve and query a named $state dish through the voice path', async (state) => {
    const runtime = createMenuToolRuntime({ ...options, testing: true })
    await runtime.invoke('kiosk_test_menu', { itemId: 'fish', state })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '泰式酸辣魚便當還有沒有' }) as { candidates: Array<{ id: string }> }
    expect(context.candidates).not.toContainEqual(expect.objectContaining({ id: 'intent:add-item' }))
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', ingredientFilters: { includeIngredients: [], excludeIngredients: [] } })
    expect(result).toMatchObject({ itemStatuses: [{ id: 'fish', status: state }] })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it.each(['水餃還有沒有', '有沒有便當', '一百元以下的還有嗎', '這個可以不要魚嗎'])('does not replace %s with a lookup of the proposed dish', async (transcript) => {
    const runtime = createMenuToolRuntime(options)
    const offer = await runtime.invoke('kiosk_fast_path_context', { transcript: '酸辣魚便當' }) as { clarificationOffer: { id: string } }
    await runtime.invoke('kiosk_fast_path_clarify', { questionId: offer.clarificationOffer.id })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript }) as { candidates: Array<{ id: string }> }
    expect(context.candidates.some(candidate => candidate.id.startsWith('inquire-meal:'))).toBe(false)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('rejects an inquiry from an earlier meal question without consuming the new one', async () => {
    const runtime = createMenuToolRuntime(options)
    const offer = await runtime.invoke('kiosk_fast_path_context', { transcript: '酸辣魚便當' }) as { clarificationOffer: { id: string } }
    await runtime.invoke('kiosk_fast_path_clarify', { questionId: offer.clarificationOffer.id })
    const candidateId = `inquire-meal:${offer.clarificationOffer.id}`
    await runtime.invoke('kiosk_fast_path_execute', { candidateId })
    const next = await runtime.invoke('kiosk_fast_path_context', { transcript: '酸辣魚便當' }) as { clarificationOffer: { id: string } }
    await runtime.invoke('kiosk_fast_path_clarify', { questionId: next.clarificationOffer.id })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId })).rejects.toThrow('STALE_PLAN')
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'meal_confirmation', waitingFor: { questionId: next.clarificationOffer.id } })
  })

  it('keeps other cart lines when a selectable-looking dish fails on selection', async () => {
    const runtime = createMenuToolRuntime({ ...options, testing: true })
    await runtime.invokeManual('order_add_item', { itemId: 'dumplings', quantity: 1 })
    await runtime.invoke('kiosk_test_menu', { itemId: 'fish', state: 'selection-failure' })
    await expect(runtime.invokeManual('menu_select_item', { itemId: 'fish' })).rejects.toThrow('目前無法選取')
    expect(await runtime.invoke('menu_get', { query: '泰式酸辣魚便當' })).toMatchObject({ itemStatuses: [{ id: 'fish', status: 'unknown' }] })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'dumplings' }] } })
  })

  it('does not expose simulation controls outside the test page or to the Agent', async () => {
    const runtime = createMenuToolRuntime(options)
    expect(runtime.toolDefinitions.some(tool => tool.name === 'kiosk_test_menu')).toBe(false)
    await expect(runtime.invoke('kiosk_test_menu', { itemId: 'fish', state: 'sold-out' })).rejects.toThrow()
    const testing = createMenuToolRuntime({ ...options, testing: true })
    await expect(testing.invokeForAgent('kiosk_test_menu', { itemId: 'fish', state: 'sold-out' })).rejects.toThrow('unavailable to the Agent')
  })
})
