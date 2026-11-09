import type { CatalogSnapshot } from '../../order-menu-server/src/domain/contracts'
import type { CartSnapshot } from './domain/order-machine'

import { describe, expect, it, vi } from 'vitest'

import { createPosSimulator } from '../../order-menu-server/src/simulator'
import { createOrderMachine } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

// The current store menu has no customization options. Explicit test-only POS
// declarations keep coverage for the retained configuration capability.
async function configuredCatalog(): Promise<CatalogSnapshot> {
  const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  const groups: Record<string, CatalogSnapshot['items'][number]['optionGroups']> = {
    'beef-noodle-soup': [{ id: 'spice', label: '辣度', required: true, values: [{ id: 'hot', label: '大辣', priceDelta: 0 }, { id: 'mild', label: '小辣', priceDelta: 0 }, { id: 'light', label: '微辣', priceDelta: 0 }] }],
    'dumplings': [{ id: 'pieces', label: '每份顆數', required: true, values: [{ id: '10', label: '10顆', priceDelta: 0 }, { id: '15', label: '15顆', priceDelta: 40 }, { id: '20', label: '20顆', priceDelta: 80 }] }],
  }
  return { ...catalog, items: catalog.items.map(item => ({ ...item, optionGroups: groups[item.id] ?? item.optionGroups })) }
}

describe('required order configuration', () => {
  // Report: this chat Nov09, s6ma-FTAYX9AQsBuN4NSo — fish lookup followed by
  // 就這一道 resumed beef noodles and even offered incompatible-unit guidance.
  it.each([
    ['beef-noodle-soup', '紅燒牛肉麵', 'thai-sour-spicy-fish-bento', '泰式酸辣魚便當'],
    ['dumplings', '水餃', 'fried-pork-chop-bento', '炸排骨便當'],
  ])('binds the presented lookup question from %s (%s) to %s (%s)', async (oldId, oldName, nextId, nextName) => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    // Use actual catalog identities while varying the two roles across cases.
    expect(catalog.items.some(item => item.id === nextId)).toBe(true)
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: `我要${oldName}` })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const oldAnswer = await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' }) as { candidates: Array<{ id: string }> }
    const staleQuantity = oldAnswer.candidates.find(choice => choice.id.includes(':quantity:2'))!
    expect(staleQuantity).toBeDefined()
    const read = await runtime.invoke('menu_get', { query: nextName, display: true }) as { pendingCustomerChoice?: { questionId: string, question: string } }
    expect(read.pendingCustomerChoice).toBeDefined()
    expect(await runtime.invoke('kiosk_interaction_state')).toHaveProperty('retainedRequests', expect.arrayContaining([expect.objectContaining({ itemId: oldId })]))
    const question = read.pendingCustomerChoice!
    await runtime.invoke('kiosk_dialogue_presented', { questionId: question.questionId, content: question.question })
    expect(await runtime.invoke('kiosk_interaction_state')).toHaveProperty('retainedRequests', expect.arrayContaining([expect.objectContaining({ itemId: oldId, status: 'suspended' })]))
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: staleQuantity.id })).rejects.toThrow('STALE_PLAN')
    const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '就這一道' }) as { phase: string, waitingFor?: { purpose: string }, candidates: Array<{ id: string }> }
    expect(answer.phase).toBe('ordering')
    expect(answer.waitingFor?.purpose).toBe('item-order')
    expect(answer.candidates.some(choice => choice.id.endsWith(':unit-guidance'))).toBe(false)
    expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
    const draft = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    expect(draft).toHaveProperty('customerMessage', expect.stringContaining(nextName))
    const quantity = await runtime.invoke('kiosk_fast_path_context', { transcript: '一份' }) as { candidates: Array<{ id: string }> }
    const one = quantity.candidates.find(choice => choice.id.includes(':quantity:1'))!
    expect(one).toBeDefined()
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: one.id })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: nextId, quantity: 1 }] } })
    expect(await runtime.invoke('kiosk_interaction_state')).not.toHaveProperty('interactionState.selectedItemName', oldName)
  })

  it.each(['就這一道', '先不要了，我看有沒有魚', '我是說泰式酸辣魚'])('does not offer a quantity-unit correction for an unrelated answer: %s', async (transcript) => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要牛肉麵' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript }) as { candidates: Array<{ id: string }> }
    expect(context.candidates.some(choice => choice.id.endsWith(':unit-guidance'))).toBe(false)
  })

  // Report: this chat,2026-11-05 — saying 不要了 while asked 幾份 leaves the dialog open.
  it('closes the quantity dialog when cancelling the unadded meal and preserves the cart', async () => {
    const catalog = await configuredCatalog()
    let visibleItemId: string | undefined
    const runtime = createMenuToolRuntime({
      menu: catalog.items.map(item => ({ ...item, optionGroups: [] })),
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: (id) => { visibleItemId = id },
    })
    await runtime.invokeForAgent('order_add_item', { itemId: 'dumplings', quantity: 2 })
    const before = await runtime.invoke('cart_get', { display: false }) as { cart: CartSnapshot }
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要牛肉麵' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    expect(visibleItemId).toBe('beef-noodle-soup')
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '不要了' }) as { candidates: Array<{ id: string }> }
    const cancel = context.candidates.find(choice => choice.id.endsWith(':cancel'))!
    expect(cancel).toBeDefined()
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: cancel.id })
    expect(visibleItemId).toBeUndefined()
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'ordering' })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: before.cart })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: cancel.id })).rejects.toThrow('STALE_PLAN')
  })

  it.each(['agent', 'touch'] as const)('retires the completed draft when %s finishes a voice-started meal', async (source) => {
    const catalog = await configuredCatalog()
    const runtime = createMenuToolRuntime({ menu: catalog.items.map(item => ({ ...item, optionGroups: [] })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要牛肉麵' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    if (source === 'agent') {
      await runtime.invokeForAgent('order_add_item', { itemId: 'beef-noodle-soup', quantity: 2 })
    }
    else {
      await runtime.invokeManual('menu_select_item', { itemId: 'beef-noodle-soup' })
      await runtime.invokeManual('menu_set_quantity', { quantity: 2 })
      await runtime.invokeManual('cart_add_item')
    }
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'ordering' })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2 } })
  })

  // Report: this chat, 2026-10-21 — close the completed dialog and keep browsing.
  it('does not restore an old quantity question after another meal is added', async () => {
    const catalog = await configuredCatalog()
    let visibleItemId: string | undefined
    const runtime = createMenuToolRuntime({ menu: catalog.items.map(item => ({ ...item, optionGroups: [] })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: id => visibleItemId = id })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要牛肉麵' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const interrupted = await runtime.invoke('kiosk_fast_path_context', { transcript: '我要一份水餃' })
    expect(interrupted).toMatchObject({ phase: 'ordering' })
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    expect(result).toMatchObject({ cart: { itemCount: 1 }, pendingCustomerChoice: { purpose: 'fulfillment' } })
    expect(visibleItemId).toBeUndefined()
    const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' }) as { candidates: Array<{ id: string, description: string }> }
    expect(answer.candidates.some(candidate => candidate.id.startsWith('configure:'))).toBe(false)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1 } })
  })

  it('corrects an unadded meal into an availability inquiry without reviving its quantity question', async () => {
    const catalog = await configuredCatalog()
    const runtime = createMenuToolRuntime({ menu: catalog.items.map(item => ({ ...item, optionGroups: [] })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invokeForAgent('order_add_item', { itemId: 'beef-noodle-soup', quantity: 1 })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要水餃' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '我沒有要水餃，我是問有沒有' }) as { candidates: Array<{ id: string }> }
    const inquiry = context.candidates.find(candidate => candidate.id.endsWith(':inquiry'))
    expect(inquiry).toBeDefined()
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: inquiry!.id })
    expect(result).toMatchObject({ customerMessage: expect.stringContaining('您是在詢問'), itemStatuses: [{ name: '水餃', status: 'available' }] })
    expect(result).not.toHaveProperty('pendingCustomerChoice')
    expect(result).toMatchObject({ customerMessage: expect.not.stringContaining('要點幾份') })
    const after = await runtime.invoke('kiosk_interaction_state')
    expect(after).toMatchObject({ phase: 'ordering' })
    expect(after).not.toHaveProperty('waitingFor')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'beef-noodle-soup' }] } })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: inquiry!.id })).rejects.toThrow('STALE_PLAN')
  })

  it('moves to the requested noodle before opening its quantity question', async () => {
    const catalog = await configuredCatalog()
    const events: string[] = []
    let visibleItemId: string | undefined
    const runtime = createMenuToolRuntime({
      menu: catalog.items.map(item => ({ ...item, optionGroups: [] })),
      screen: () => visibleItemId ? 'item_configuration' : 'menu',
      visibleItemId: () => visibleItemId,
      onAction: (action) => { events.push(`cursor:${action.controlId ?? action.targetId}`) },
      onMenuSelection: (itemId) => {
        visibleItemId = itemId
        events.push(`show:${itemId}`)
      },
      onCartChange: () => {},
    })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要牛肉麵' })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })).toMatchObject({ customerMessage: '請問紅燒牛肉麵要幾份？' })
    expect(events).toEqual(['cursor:beef-noodle-soup', 'show:beef-noodle-soup'])
    const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '一份' }) as { candidates: Array<{ id: string, description: string }> }
    const quantity = answer.candidates.find(choice => choice.description.includes('1 份'))!
    expect(quantity).toBeDefined()
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: quantity.id })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'beef-noodle-soup', quantity: 1 }] } })
    expect(events.filter(event => event === 'cursor:beef-noodle-soup')).toHaveLength(1)
    expect(events.filter(event => event === 'show:beef-noodle-soup')).toHaveLength(1)
  })

  it('continues the same noodle dialog across option and quantity answers, restoring it after a lookup', async () => {
    const catalog = await configuredCatalog()
    let visibleItemId: string | undefined
    const select = vi.fn((itemId: string | undefined) => {
      visibleItemId = itemId
    })
    const action = vi.fn()
    const runtime = createMenuToolRuntime({
      menu: catalog.items,
      screen: () => visibleItemId ? 'item_configuration' : 'menu',
      visibleItemId: () => visibleItemId,
      onAction: action,
      onMenuSelection: select,
      onCartChange: () => {},
      onRecommendationsChange: () => { visibleItemId = undefined },
    })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要牛肉麵' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const spice = await runtime.invoke('kiosk_fast_path_context', { transcript: '微辣' }) as { candidates: Array<{ id: string, description: string }> }
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: spice.candidates.find(choice => choice.description.includes('微辣'))!.id })
    expect(select.mock.calls).toEqual([['beef-noodle-soup']])
    expect(action.mock.calls).toHaveLength(1)
    await runtime.invoke('menu_get', { query: '水餃', display: true })
    expect(visibleItemId).toBeUndefined()
    const quantity = await runtime.invoke('kiosk_fast_path_context', { transcript: '一份' }) as typeof spice
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: quantity.candidates.find(choice => choice.description.includes('1 份'))!.id })).toMatchObject({ cart: { lines: [{ itemId: 'beef-noodle-soup', quantity: 1, options: { spice: 'light' } }] } })
    expect(select.mock.calls).toEqual([['beef-noodle-soup'], ['beef-noodle-soup'], [undefined]])
    expect(action.mock.calls.filter(([entry]) => entry.targetId === 'beef-noodle-soup' && !entry.controlId)).toHaveLength(2)
  })
  it('answers a separate ambiguous lookup before resuming the retained meal configuration', async () => {
    const catalog = await configuredCatalog()
    const bentos = catalog.items.filter(item => item.category === '便當').slice(0, 2).map(item => ({ ...item, name: `招牌${item.name}`, aliases: [] }))
    const runtime = createMenuToolRuntime({ menu: [...catalog.items.filter(item => item.category !== '便當'), ...bentos], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要兩份牛肉麵' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const pending = await runtime.invoke('kiosk_fast_path_context', { transcript: '有招牌嗎？' }) as { waitingFor: { questionId: string } }
    await runtime.invoke('kiosk_fast_path_context', { transcript: '有招牌嗎？', newRequestQuestionId: pending.waitingFor.questionId })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', searchInterpretation: 'product' })).toMatchObject({ pendingClarification: { intent: 'SEARCH_MENU' } })
    const lookup = await runtime.invoke('kiosk_fast_path_context', { transcript: '第一個' }) as { resolvedCandidateId: string }
    expect(lookup).toMatchObject({ phase: 'clarification', interactionState: { pendingIntent: 'SEARCH_MENU' } })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: lookup.resolvedCandidateId })).toMatchObject({ items: [{ id: bentos[0].id }] })
    const meal = await runtime.invoke('kiosk_fast_path_context', { transcript: '微辣' }) as { candidates: Array<{ id: string, description: string }> }
    expect(meal).toMatchObject({ phase: 'configuration' })
    const spice = meal.candidates.find(choice => choice.description.includes('微辣'))!
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: spice.id })).toMatchObject({ cart: { itemCount: 2, lines: [{ itemId: 'beef-noodle-soup', quantity: 2 }] } })
  })
  it('rejects an expired, replayed or different-utterance new-request ticket without cancelling a meal', async () => {
    vi.useFakeTimers()
    try {
      const catalog = await configuredCatalog()
      const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.invoke('kiosk_fast_path_context', { transcript: '我要兩份牛肉麵' })
      await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
      const old = await runtime.invoke('kiosk_fast_path_context', { transcript: '有便當嗎？' }) as { waitingFor: { questionId: string } }
      await expect(runtime.invoke('kiosk_fast_path_context', { transcript: '我要水餃', newRequestQuestionId: old.waitingFor.questionId })).rejects.toThrow('STALE_PLAN')
      vi.setSystemTime(Date.now() + 31_000)
      await expect(runtime.invoke('kiosk_fast_path_context', { transcript: '有便當嗎？', newRequestQuestionId: old.waitingFor.questionId })).rejects.toThrow('STALE_PLAN')
      const fresh = await runtime.invoke('kiosk_fast_path_context', { transcript: '有便當嗎？' }) as typeof old
      await runtime.invoke('kiosk_fast_path_context', { transcript: '有便當嗎？', newRequestQuestionId: fresh.waitingFor.questionId })
      await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu' })
      await expect(runtime.invoke('kiosk_fast_path_context', { transcript: '有便當嗎？', newRequestQuestionId: fresh.waitingFor.questionId })).rejects.toThrow('STALE_PLAN')
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'configuration', references: [{ label: '紅燒牛肉麵' }] })
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    }
    finally { vi.useRealTimers() }
  })

  it('does not turn a question about a clarification target into choosing that target', async () => {
    const catalog = await configuredCatalog()
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要兩份便當' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const question = await runtime.invoke('kiosk_fast_path_context', { transcript: '有椒麻雞便當嗎？' }) as { waitingFor: { questionId: string } }
    expect(question).not.toHaveProperty('resolvedCandidateId')
    await runtime.invoke('kiosk_fast_path_context', { transcript: '有椒麻雞便當嗎？', newRequestQuestionId: question.waitingFor.questionId })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu' })
    const resumed = await runtime.invoke('kiosk_fast_path_context', { transcript: '第二個' }) as { resolvedCandidateId: string }
    expect(resumed.resolvedCandidateId).toMatch(/^clarify:/)
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: resumed.resolvedCandidateId })).toMatchObject({ cart: { itemCount: 2, lines: [{ itemId: 'spicy-chicken-bento', quantity: 2 }] } })
  })
  it('presents eligible category targets before asking which meal, without selecting or adding one', async () => {
    const catalog = await configuredCatalog()
    const display = vi.fn()
    const select = vi.fn()
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: select, onRecommendationsChange: display })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要兩份便當' })
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' }) as { customerMessage: string }
    expect(result.customerMessage).not.toContain('操作')
    expect(display).toHaveBeenCalledWith(expect.objectContaining({ kind: 'query-results', itemIds: catalog.items.filter(item => item.category === '便當' && item.available !== false).map(item => item.id) }))
    expect(select).not.toHaveBeenCalled()
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('keeps an unadded meal through a separate query but replaces it on an explicit new order', async () => {
    const catalog = await configuredCatalog()
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要兩份牛肉麵' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const pending = await runtime.invoke('kiosk_fast_path_context', { transcript: '有水餃嗎？' }) as { waitingFor: { questionId: string }, candidates: Array<{ id: string }> }
    expect(pending).toMatchObject({ phase: 'ordering' })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu' })).toMatchObject({ items: [{ id: 'dumplings' }] })
    const resumed = await runtime.invoke('kiosk_fast_path_context', { transcript: '微辣' }) as { candidates: Array<{ id: string, description: string }> }
    expect(resumed.candidates.some(choice => choice.description.includes('微辣'))).toBe(true)
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: pending.candidates[0].id })).rejects.toThrow(/STALE_PLAN|expired/)
    const changed = await runtime.invoke('kiosk_fast_path_context', { transcript: '我要水餃' })
    expect(changed).toMatchObject({ phase: 'ordering' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const dumplings = await runtime.invoke('kiosk_fast_path_context', { transcript: '十五顆' }) as { waitingFor: { question: string }, candidates: Array<{ id: string, description: string }> }
    expect(dumplings.waitingFor.question).toContain('水餃')
    const pieces = dumplings.candidates.find(choice => choice.description.includes('15'))!
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: pieces.id })
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '一份' })).toMatchObject({ waitingFor: { question: '請問水餃要幾份？' } })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })
  it('queries a possible product only after bounded interpretation, without broadening it into an ingredient search', async () => {
    const catalog = await configuredCatalog()
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '有蝦蝦捲嗎？' })).toMatchObject({ productResolution: { status: 'possible', count: 1 } })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', searchInterpretation: 'product', ingredientFilters: { includeIngredients: [], excludeIngredients: [] } })).toMatchObject({
      items: [{ id: 'signature-shrimp-roll-bento' }],
      decisionTrace: { operationPlan: { input: { query: '周氏蝦捲招牌便當' } } },
    })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })
  it('resolves a category purchase after a noodle lookup without carrying the noodle into the order', async () => {
    const catalog = await configuredCatalog()
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('menu_get', { category: '麵食', display: true })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要兩份便當' })
    const bentoRefs = catalog.items.filter(item => item.category === '便當' && item.available !== false).map(item => `item:${item.id}`)
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })).toMatchObject({
      pendingClarification: { intent: 'ADD_ITEM', candidateRefs: bentoRefs },
      decisionTrace: { resolveIntent: { kind: 'CLARIFICATION', targetResolution: { eligible: bentoRefs } }, operationPlan: null, authorize: null },
    })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    const bento = catalog.items.find(item => item.category === '便當')!
    const clarification = await runtime.invoke('kiosk_fast_path_context', { transcript: bento.name }) as { candidates: Array<{ id: string, description: string }> }
    const choice = clarification.candidates.find(candidate => candidate.description.includes(bento.name))!
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: choice.id })).toMatchObject({
      decisionTrace: { resolveIntent: { kind: 'PLAN', plan: { targetRef: `item:${bento.id}` } } },
    })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2, lines: [{ itemId: bento.id }] } })
  })

  it('retains quantity supplied together with the missing spice and prevents replay', async () => {
    const catalog = await configuredCatalog()
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要牛肉麵' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份微辣' }) as { candidates: Array<{ id: string, description: string }> }
    const choice = context.candidates.find(candidate => candidate.description.includes('微辣'))!
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: choice.id })).toMatchObject({ cart: { itemCount: 2, total: 300 } })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: choice.id })).rejects.toThrow('STALE_PLAN')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2 } })
  })
  it('rejects a missing-slot answer after a touch changes the selected-item revision', async () => {
    const catalog = await configuredCatalog()
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要兩份牛肉麵' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '小辣' }) as { candidates: Array<{ id: string, description: string }> }
    const choice = context.candidates.find(candidate => candidate.description.includes('小辣'))!
    await runtime.invoke('menu_select_item', { itemId: 'dumplings' })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: choice.id })).rejects.toThrow('STALE_PLAN')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('expires an issued answer without losing the unfinished meal in the same session', async () => {
    vi.useFakeTimers()
    try {
      const catalog = await configuredCatalog()
      const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.invoke('kiosk_fast_path_context', { transcript: '我要兩份牛肉麵' })
      await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
      const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '小辣' }) as { candidates: Array<{ id: string, description: string }> }
      const choice = context.candidates.find(candidate => candidate.description.includes('小辣'))!
      vi.setSystemTime(Date.now() + 30_001)
      await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: choice.id })).rejects.toThrow('STALE_PLAN')
      const resumed = await runtime.invoke('kiosk_fast_path_context', { transcript: '微辣' }) as { candidates: Array<{ id: string, description: string }> }
      expect(resumed).toMatchObject({ phase: 'configuration', references: [{ label: '紅燒牛肉麵' }] })
      const freshChoice = resumed.candidates.find(candidate => candidate.description.includes('微辣'))!
      expect(freshChoice.id).not.toBe(choice.id)
      expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: freshChoice.id })).toMatchObject({ cart: { itemCount: 2, lines: [{ quantity: 2, options: { spice: 'light' } }] } })
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('retains known options across idle, but resets the unfinished meal for a new order', async () => {
    vi.useFakeTimers()
    try {
      const catalog = await configuredCatalog()
      const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.invoke('kiosk_fast_path_context', { transcript: '我要十五顆水餃' })
      await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
      vi.setSystemTime(Date.now() + 55_000)
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'configuration', waitingFor: { question: expect.stringContaining('幾份') } })
      const resumed = await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' }) as { candidates: Array<{ id: string, description: string }> }
      const choice = resumed.candidates.find(candidate => candidate.description.includes('2 份'))!
      expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: choice.id })).toMatchObject({ cart: { itemCount: 2, total: 240, lines: [{ quantity: 2, options: { pieces: '15' } }] } })
      await runtime.invoke('kiosk_fast_path_context', { transcript: '我要兩份牛肉麵' })
      await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
      const next = await runtime.invoke('kiosk_fast_path_context', { transcript: '微辣' }) as { candidates: Array<{ id: string, description: string }> }
      const cancelledChoice = next.candidates.find(candidate => candidate.description.includes('微辣'))!
      await runtime.reset()
      expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' })).not.toMatchObject({ phase: 'configuration' })
      await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: cancelledChoice.id })).rejects.toThrow('STALE_PLAN')
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    }
    finally { vi.useRealTimers() }
  })

  it('reissues choices for each utterance and does not let an old answer cancel the latest draft', async () => {
    const catalog = await configuredCatalog()
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要兩份牛肉麵' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const old = await runtime.invoke('kiosk_fast_path_context', { transcript: '微辣' }) as { candidates: Array<{ id: string, description: string }> }
    const fresh = await runtime.invoke('kiosk_fast_path_context', { transcript: '小辣' }) as { candidates: Array<{ id: string, description: string }> }
    const staleCancel = old.candidates.find(candidate => candidate.id.endsWith(':cancel'))!
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: staleCancel.id })).rejects.toThrow('STALE_PLAN')
    await runtime.invoke('kiosk_interaction_state')
    const choice = fresh.candidates.find(candidate => candidate.description.includes('小辣'))!
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: choice.id })).toMatchObject({ cart: { itemCount: 2, lines: [{ options: { spice: 'mild' } }] } })
  })

  it('retains the original category clarification across idle and only accepts newly issued answers', async () => {
    vi.useFakeTimers()
    try {
      const catalog = await configuredCatalog()
      const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.invoke('kiosk_fast_path_context', { transcript: '我要兩份便當' })
      await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
      const old = await runtime.invoke('kiosk_fast_path_context', { transcript: '第一個' }) as { candidates: Array<{ id: string }> }
      vi.setSystemTime(Date.now() + 55_000)
      await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: old.candidates[0].id })).rejects.toThrow('stale')
      const fresh = await runtime.invoke('kiosk_fast_path_context', { transcript: '第一個' }) as { candidates: Array<{ id: string }> }
      expect(fresh).toMatchObject({ phase: 'clarification', interactionState: { pendingIntent: 'ADD_ITEM' } })
      expect(fresh.candidates[0].id).not.toBe(old.candidates[0].id)
      await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: old.candidates[0].id })).rejects.toThrow()
      expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: fresh.candidates[0].id })).toMatchObject({ decisionTrace: { resolveIntent: { kind: 'PLAN', plan: { slots: { quantity: 2 } } } }, cart: { itemCount: 2 } })
    }
    finally { vi.useRealTimers() }
  })
  it('does not default required options or mutate the cart before they are selected', async () => {
    const catalog = await configuredCatalog()
    const machine = createOrderMachine({ menu: catalog.items })
    machine.selectMenuItem('dumplings')
    expect(machine.getSelection()?.options).toEqual({})
    const revisions = machine.getRevisions()
    expect(() => machine.addToCart()).toThrow('Required option')
    expect(machine.getRevisions()).toEqual(revisions)
    expect(machine.getCart().itemCount).toBe(0)
    machine.setItemOption('pieces', '20')
    machine.addToCart()
    expect(machine.getCart().total).toBe(160)
  })
  it('asks real noodle spice choices without adding food, then resumes the original quantity', async () => {
    const catalog = await configuredCatalog()
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要兩份牛肉麵' })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })).toMatchObject({ customerMessage: expect.stringContaining('辣度') })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    const next = await runtime.invoke('kiosk_fast_path_context', { transcript: '小辣' }) as { phase: string, candidates: Array<{ id: string, description: string }> }
    expect(next.phase).toBe('configuration')
    const choice = next.candidates.find(candidate => candidate.description.includes('小辣'))!
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: choice.id })).toMatchObject({ cart: { itemCount: 2, total: 300, lines: [{ name: '紅燒牛肉麵', quantity: 2, options: { spice: 'mild' } }] } })
  })

  it.each([
    { itemId: 'beef-noodle-soup', question: '辣度', transcript: '我要吃牛肉麵，一碗' },
    { itemId: 'beef-noodle-soup', question: '辣度', transcript: '我想吃牛肉麵，一碗' },
    { itemId: 'dumplings', question: '每份顆數', transcript: '我要水餃，一份' },
  ])('shows $itemId before asking for its required configuration', async ({ itemId, question, transcript }) => {
    const catalog = await configuredCatalog()
    const onMenuSelection = vi.fn()
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection })

    await runtime.invoke('kiosk_fast_path_context', { transcript })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })).resolves.toMatchObject({
      customerMessage: expect.stringContaining(question),
    })
    expect(onMenuSelection).toHaveBeenCalledWith(itemId)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    if (itemId === 'beef-noodle-soup') {
      const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '微辣' }) as { candidates: Array<{ id: string, description: string }> }
      const spice = answer.candidates.find(choice => choice.description.includes('微辣'))!
      expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: spice.id })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId, quantity: 1, options: { spice: 'light' } }] } })
    }
  })

  it('does not confuse fifteen dumpling pieces with fifteen servings and asks for missing servings', async () => {
    const catalog = await configuredCatalog()
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要十五顆水餃' })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })).toMatchObject({ customerMessage: expect.stringContaining('幾份') })
    const next = await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' }) as { candidates: Array<{ id: string, description: string }> }
    const choice = next.candidates.find(candidate => candidate.description.includes('2 份'))!
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: choice.id })).toMatchObject({ cart: { total: 240, itemCount: 2, lines: [{ quantity: 2, unitPrice: 120, options: { pieces: '15' } }] } })
  })
})

// Report: this chat, Nov7, recorded NYBro5...: 水餃30顆 → 幾份 → 30顆 wrongly cancelled as inquiry.
it.each(['30顆', '三十顆', '500克'])('keeps an unsupported quantity unit as a retained ordering request: %s', async (transcript) => {
  const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '我想點水餃30顆' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const context = await runtime.invoke('kiosk_fast_path_context', { transcript }) as { candidates: Array<{ id: string }> }
  const guidance = context.candidates.find(candidate => candidate.id.endsWith(':unit-guidance'))
  expect(guidance).toBeDefined()
  const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: guidance!.id })
  expect(result).toHaveProperty('customerMessage', expect.stringContaining('不代為換算'))
  expect(result).toHaveProperty('customerMessage', expect.stringContaining('每份10顆'))
  expect(result).toHaveProperty('pendingCustomerChoice.requestId')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: guidance!.id })).rejects.toThrow('STALE_PLAN')
  const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '三份' }) as { candidates: Array<{ id: string }> }
  expect(answer.candidates.some(candidate => candidate.id.endsWith(':unit-guidance'))).toBe(false)
  const quantity = answer.candidates.find(candidate => candidate.id.includes(':quantity:3'))!
  expect(quantity).toBeDefined()
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: quantity.id })
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 3)
})
