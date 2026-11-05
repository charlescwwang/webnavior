import type { KioskActionCandidate, KioskDecisionState } from '../../server/src/services/domain/kiosk-interaction-decision'
import type { SystemOneQuestion } from '../../server/src/services/domain/kiosk-system-one'

import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '../../server/src/services/domain/kiosk-interaction-decision'
import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

const dishes = Array.from({ length: 7 }, (_, index) => ({
  ...menu[0]!,
  id: `dish-${index}`,
  name: `餐點${index}`,
  optionGroups: [],
  composition: { ingredients: index === 0 ? ['pork'] : ['chicken'], complete: true, source: 'merchant' as const, revision: '1', removals: [] },
}))

describe('recommendation batches', () => {
  it('retains the recommendation conditions and seen history when ordering a different dish', async () => {
    const shown: string[][] = []
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: presentation => shown.push(presentation.itemIds) })
    await runtime.invoke('menu_recommend', { excludeIngredients: ['pork'], limit: 1 })
    expect(shown.at(-1)).toEqual(['dish-1'])
    await runtime.invokeForAgent('order_add_item', { itemId: 'dish-6', quantity: 1 })
    expect(shown.at(-1)).toEqual(['dish-1'])
    expect(await runtime.invoke('menu_recommend', { more: true, limit: 1 })).toMatchObject({ appliedFilters: { excludeIngredients: ['pork'] }, items: [{ id: 'dish-2' }] })
  })

  it.skipIf(!process.env.KIOSK_RECOMMENDATION_DIAGNOSIS)('does not repeat recommendations when replaying the reported high-confidence route', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const first = await runtime.invoke('menu_recommend') as { customerMessage: string, items: Array<{ id: string }> }
    const transcript = '還有其他推薦嗎？'
    const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
    expect(snapshot.candidates.some(candidate => candidate.id === 'intent:recommend-more')).toBe(true)
    // Replay only the observed provider choices against an artificial runtime.
    // The customer's dialogue, session IDs and attached trace never leave disk.
    const invoke = vi.fn(async (_state: string, _questions: Record<string, SystemOneQuestion>) => ({ answers: {
      route: { type: 'choice', choice: 'intent:recommend', confidence: 0.942 },
      // NOTICE: Recipient validation was added after this report. This synthetic
      // answer completes today's contract; it is not part of the captured trace.
      recipient: { type: 'choice', choice: 'KIOSK', confidence: 0.95 },
      filterRequirement: { type: 'choice', choice: 'COVERED', confidence: 0.9895 },
      filterPresence: { type: 'choice', choice: 'NO_FILTER', confidence: 0.9594 },
    } }))
    const decision = await decideInteraction({ candidates: snapshot.candidates, decisionState: snapshot, conversation: { messages: [{ role: 'user', content: '推薦幾樣餐點' }, { role: 'assistant', content: first.customerMessage }] }, transcript, invoke, includeTrace: true, policy: { decisionInstruction: '', storeInstruction: '' } })
    expect(decision.kind).toBe('FAST_ACTION')
    if (decision.kind !== 'FAST_ACTION')
      throw new Error(JSON.stringify(decision))
    const next = await runtime.invoke('kiosk_fast_path_execute', { candidateId: decision.actionId }) as { items: Array<{ id: string }> }
    for (const item of next.items)
      expect(first.items.map(item => item.id)).not.toContain(item.id)
  })

  // Report: docs/plans/2026-10-22-kiosk-field-investigation.md; full menu is not the next three-item batch.
  it('shows the full catalog on repeated whole-menu requests including previously seen items', async () => {
    const presentations: string[][] = []
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: result => presentations.push(result.itemIds) })
    for (const transcript of ['有賣什麼？', '我要看全部', '再看全部']) {
      await runtime.invoke('kiosk_fast_path_context', { transcript })
      const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu' })
      expect(result).toMatchObject({ items: dishes.map(item => ({ id: item.id })), presentation: { kind: 'query-results', itemIds: dishes.map(item => item.id) }, decisionTrace: { operationPlan: { toolName: 'menu_get', input: { scope: 'catalog', display: true } } } })
    }
    expect(presentations).toHaveLength(3)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('retains dietary exclusions when a customer requests the whole menu', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('menu_recommend', { excludeIngredients: ['pork'], maxPrice: 400 })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要看全部' })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-all-menu' })).toMatchObject({ items: dishes.slice(1).map(item => ({ id: item.id })), appliedFilters: { excludeIngredients: ['pork'] }, decisionTrace: { operationPlan: { input: { scope: 'catalog', display: true } } } })
  })

  it('rejects a broad browse plan when its recommendation batch has changed', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('menu_recommend')
    await runtime.invoke('kiosk_fast_path_context', { transcript: '看全部' })
    await runtime.invoke('menu_recommend', { excludeIngredients: ['pork'] })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu' })).rejects.toThrow('STALE_PLAN')
  })

  it('keeps named products, categories and explicit food queries as searches', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    for (const scenario of [
      { transcript: '有餐點4嗎？', filters: {}, ids: ['dish-4'] },
      { transcript: '超值套餐有哪些？', filters: {}, ids: dishes.map(item => item.id) },
      { transcript: '不要豬肉的有哪些？', filters: { excludeIngredients: ['pork'] }, ids: dishes.slice(1).map(item => item.id) },
    ]) {
      await runtime.invoke('kiosk_fast_path_context', { transcript: scenario.transcript })
      expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', ingredientFilters: scenario.filters })).toMatchObject({ items: scenario.ids.map(id => ({ id })), decisionTrace: { operationPlan: { toolName: 'menu_get' } } })
    }
  })

  it('bounds Agent and explicit display lookups while retaining a data-only catalog read', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'update' })).toMatchObject({ items: [{ id: 'dish-0' }, { id: 'dish-1' }, { id: 'dish-2' }], presentation: { kind: 'recommendation' } })
    expect(await runtime.invoke('menu_get', { display: true })).toMatchObject({ items: [{ id: 'dish-3' }, { id: 'dish-4' }, { id: 'dish-5' }], presentation: { kind: 'recommendation' } })
    expect(await runtime.invokeForAgent('menu_get', { query: '餐點0' })).toMatchObject({ items: [{ id: 'dish-0' }], presentation: { kind: 'query-results' } })
    const catalog = await runtime.invokeForAgent('menu_get', { display: false })
    expect(catalog).toMatchObject({ items: dishes.map(item => ({ id: item.id })) })
    expect(catalog).not.toHaveProperty('presentation')
  })

  it('ranks only dishes with current POS evidence and never invents a popular ordering', async () => {
    const now = Date.now()
    const rankedDishes = dishes.map((dish, index) => ({ ...dish, recommendationSignals: index === 0 ? [] : [{ strategy: 'POPULAR' as const, rank: 8 - index, source: 'pos' as const, asOf: new Date(now - 1_000).toISOString(), expiresAt: new Date(now + 60_000).toISOString() }] }))
    const runtime = createMenuToolRuntime({ menu: rankedDishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    expect(await runtime.invoke('menu_recommend', { strategy: 'POPULAR' })).toMatchObject({ strategy: 'POPULAR', items: [{ id: 'dish-6' }, { id: 'dish-5' }, { id: 'dish-4' }] })
    expect(await runtime.invoke('menu_recommend', { more: true })).toMatchObject({ strategy: 'POPULAR', items: [{ id: 'dish-3' }, { id: 'dish-2' }, { id: 'dish-1' }] })
    await expect(runtime.invoke('menu_recommend', { strategy: 'NEW_ARRIVAL' })).rejects.toThrow('Unsupported recommendation strategy')
    const noEvidence = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await expect(noEvidence.invoke('menu_recommend', { strategy: 'POPULAR' })).rejects.toThrow('Unsupported recommendation strategy')
  })
  it('applies a single-dish base-price budget and keeps it across later batches', async () => {
    const pricedDishes = dishes.map((dish, index) => ({ ...dish, price: index === 0 ? 200 : 80 }))
    const runtime = createMenuToolRuntime({ menu: pricedDishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const first = await runtime.invoke('menu_recommend', { maxPrice: 100 })
    expect(first).toMatchObject({ maxPrice: 100, items: [{ id: 'dish-1' }, { id: 'dish-2' }, { id: 'dish-3' }] })
    expect(await runtime.invoke('menu_recommend', { more: true })).toMatchObject({ maxPrice: 100, items: [{ id: 'dish-4' }, { id: 'dish-5' }, { id: 'dish-6' }] })
    await expect(runtime.invoke('menu_recommend', { more: true, maxPrice: 300 })).rejects.toThrow('start a new recommendation')
    const offer = await runtime.invoke('menu_recommend', { maxPrice: 50 }) as { pendingCustomerChoice: { questionId: string } }
    expect(await runtime.invoke('kiosk_query_scope', { questionId: offer.pendingCustomerChoice.questionId, choice: 'CATALOG' })).toMatchObject({ items: [], availability: 'NONE' })
  })
  it('rejects an old more plan after another recommendation has changed the batch', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('menu_recommend')
    await runtime.invoke('kiosk_fast_path_context', { transcript: '換一批推薦' })
    await runtime.invoke('menu_recommend', { excludeIngredients: ['pork'] })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:recommend-more' })).rejects.toThrow('STALE_PLAN')
    expect(await runtime.invoke('menu_recommend')).toMatchObject({ appliedFilters: { excludeIngredients: [] }, items: [{ id: 'dish-0' }, { id: 'dish-1' }, { id: 'dish-2' }] })
  })

  it('retains recommendation conditions and seen dishes across idle until a new order', async () => {
    vi.useFakeTimers()
    try {
      const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.invoke('menu_recommend', { excludeIngredients: ['pork'] })
      vi.advanceTimersByTime(300_000)
      const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '有其他的嗎' }) as { candidates: Array<{ id: string }> }
      expect(context.candidates.some(candidate => candidate.id === 'intent:recommend-more')).toBe(true)
      expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:recommend-more' })).toMatchObject({ items: [{ id: 'dish-4' }, { id: 'dish-5' }, { id: 'dish-6' }], appliedFilters: { excludeIngredients: ['pork'] }, decisionTrace: { operationPlan: { toolName: 'menu_recommend', input: { more: true } } } })
      await runtime.reset()
      expect(await runtime.invoke('menu_recommend')).toMatchObject({ items: [{ id: 'dish-0' }, { id: 'dish-1' }, { id: 'dish-2' }], appliedFilters: { excludeIngredients: [] } })
    }
    finally {
      vi.useRealTimers()
    }
  })
  it('returns three real dishes instead of only the first default item', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    expect(await runtime.invoke('menu_recommend')).toMatchObject({ items: [{ id: 'dish-0' }, { id: 'dish-1' }, { id: 'dish-2' }] })
  })

  it('preserves filters across more batches and never recycles exhausted recommendations', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    expect(await runtime.invoke('menu_recommend', { excludeIngredients: ['pork'] })).toMatchObject({ items: [{ id: 'dish-1' }, { id: 'dish-2' }, { id: 'dish-3' }] })
    expect(await runtime.invoke('menu_recommend', { more: true })).toMatchObject({ appliedFilters: { excludeIngredients: ['pork'] }, items: [{ id: 'dish-4' }, { id: 'dish-5' }, { id: 'dish-6' }] })
    expect(await runtime.invoke('menu_recommend', { more: true })).toMatchObject({ items: [], customerMessage: expect.stringContaining('沒有其他') })
    await runtime.reset()
    expect(await runtime.invoke('menu_recommend')).toMatchObject({ items: [{ id: 'dish-0' }, { id: 'dish-1' }, { id: 'dish-2' }] })
  })

  it('offers a bounded alternative recommendation choice and compiles it without listing the menu', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('menu_recommend', { excludeIngredients: ['pork'] })
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '有其他的嗎？' })).toMatchObject({ candidates: expect.arrayContaining([{ id: 'intent:recommend-more', description: expect.any(String), requiresHighConfidence: false }]) })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:recommend-more' })).toMatchObject({ items: [{ id: 'dish-4' }, { id: 'dish-5' }, { id: 'dish-6' }] })
  })
})

describe('order review presentation', () => {
  it('opens the review before animating a fulfillment selection for either POS mode', async () => {
    const events: string[] = []
    const runtime = createMenuToolRuntime({
      menu: dishes,
      onReviewRequested: () => { events.push('review') },
      onAction: (action) => { events.push(action.controlId ?? action.label) },
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    await runtime.invoke('order_add_item', { itemId: 'dish-1', quantity: 1 })
    events.length = 0
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
    expect(events).toEqual(['order:view', 'review', 'order:fulfillment:takeout'])
    events.length = 0
    await runtime.invoke('order_set_fulfillment', { mode: 'dine-in' })
    expect(events).toEqual(['order:view', 'review', 'order:fulfillment:dine-in'])
  })

  it('shows the cart on request but permits a read without changing the screen', async () => {
    const onReviewRequested = vi.fn()
    const runtime = createMenuToolRuntime({ menu: dishes, onReviewRequested, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('cart_get')
    expect(onReviewRequested).toHaveBeenCalledOnce()
    await runtime.invoke('cart_get', { display: false })
    expect(onReviewRequested).toHaveBeenCalledOnce()
  })
})
