import { describe, expect, it } from 'vitest'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

async function setup() {
  const runtime = createMenuToolRuntime({ menu: [{ id: 'dumpling', name: '水餃', price: 80 }, { id: 'beef', name: '牛肉麵', price: 130 }, { id: 'soup', name: '蔬菜湯', price: 110 }, { id: 'greens', name: '燙青菜', price: 120 }].map(item => ({ ...menu[0]!, ...item, aliases: [], optionGroups: [] })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('menu_recommend', { limit: 2 })
  return runtime
}

describe('real menu query scope flow', () => {
  // Report: this chat, 2026-10-19: a previous recommendation cannot silently pick query scope.
  it.each([{ choice: 'SHOWN', ids: ['dumpling'] }, { choice: 'CATALOG', ids: ['dumpling', 'soup', 'greens'] }])('asks before querying and executes $choice only once', async ({ choice, ids }) => {
    const runtime = await setup()
    const offered = await runtime.invoke('menu_get', { maxPrice: 120, display: true }) as { pendingCustomerChoice: { questionId: string } }
    expect(offered).toHaveProperty('pendingCustomerChoice.purpose', 'menu-query-scope')
    expect(offered).not.toHaveProperty('items')
    const questionId = offered.pendingCustomerChoice.questionId
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '好' })).toMatchObject({ phase: 'query_scope', waitingFor: { questionId } })
    expect(await runtime.invoke('kiosk_query_scope', { questionId, choice: 'ASK', transcript: '好' })).toHaveProperty('pendingCustomerChoice.questionId', questionId)
    expect(await runtime.invoke('kiosk_query_scope', { questionId, choice, transcript: choice === 'SHOWN' ? '剛才那幾個' : '全部' })).toMatchObject({ appliedPriceConditions: { maxPrice: 120 }, items: ids.map(id => ({ id })) })
    await expect(runtime.invoke('kiosk_query_scope', { questionId, choice })).rejects.toThrow('STALE')
  })

  it('hands off changed-price input without using the previous price or answering the old question', async () => {
    const runtime = await setup()
    const offered = await runtime.invoke('menu_get', { maxPrice: 120 }) as { pendingCustomerChoice: { questionId: string } }
    expect(await runtime.invoke('kiosk_query_scope', { questionId: offered.pendingCustomerChoice.questionId, choice: 'CATALOG', transcript: '整份菜單，不過改成100以下' })).toMatchObject({ status: 'NEW_REQUEST', transcript: '整份菜單，不過改成100以下' })
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '整份菜單，不過改成100以下' })).toMatchObject({ phase: 'ordering', priceEvidence: { amounts: [{ amount: 100 }] } })
  })
  it('does not let an Agent invent a named scope for a customer-wide price query', async () => {
    const runtime = await setup()
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'broad-price', transcript: '120以下有什麼', expectedMenuRevision: 0, readOnly: true, constraints: { maxPrice: 120 } })
    const offer = await runtime.invokeForAgent('menu_get', { query: '水餃', maxPrice: 120 }) as { pendingCustomerChoice: { questionId: string } }
    expect(offer).toHaveProperty('pendingCustomerChoice.purpose', 'menu-query-scope')
    expect(await runtime.invoke('kiosk_query_scope', { questionId: offer.pendingCustomerChoice.questionId, choice: 'CATALOG' })).toMatchObject({ items: [{ id: 'dumpling' }, { id: 'soup' }, { id: 'greens' }] })
  })
  it('retires the question after a successful customer order change', async () => {
    const runtime = await setup()
    const offer = await runtime.invoke('menu_get', { maxPrice: 120 }) as { pendingCustomerChoice: { questionId: string } }
    await runtime.invokeManual('order_add_item', { itemId: 'dumpling', quantity: 1 })
    await expect(runtime.invoke('kiosk_query_scope', { questionId: offer.pendingCustomerChoice.questionId, choice: 'CATALOG' })).rejects.toThrow('STALE')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1 } })
  })

  it('keeps genuine customer-named lookups scoped to that named dish', async () => {
    const runtime = await setup()
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'named-price', transcript: '水餃有120以下的嗎', expectedMenuRevision: 0, readOnly: true, constraints: { maxPrice: 120 } })
    expect(await runtime.invokeForAgent('menu_get', { query: '水餃', maxPrice: 120 })).toMatchObject({ items: [{ id: 'dumpling' }] })
  })

  it('retains shown scope for more but permits a fresh full-catalog selection', async () => {
    const runtime = await setup()
    const offer = await runtime.invoke('menu_get', { maxPrice: 120 }) as { pendingCustomerChoice: { questionId: string } }
    expect(await runtime.invoke('kiosk_query_scope', { questionId: offer.pendingCustomerChoice.questionId, choice: 'SHOWN' })).toMatchObject({ excludedItemIds: [], presentation: { title: expect.stringContaining('剛才推薦的') } })
    expect(await runtime.invoke('menu_recommend', { more: true })).toMatchObject({ items: [], queryAction: 'clarify' })
    // Exhausting the narrowed batch does not permanently exclude other dishes.
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'reset', maxPrice: 120 })).toMatchObject({ items: [{ id: 'soup' }, { id: 'greens' }] })
    // A condition query includes previously displayed matches when alternatives were not requested.
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'update', maxPrice: 120 })).toMatchObject({ items: [{ id: 'dumpling' }, { id: 'soup' }, { id: 'greens' }] })
  })
})
