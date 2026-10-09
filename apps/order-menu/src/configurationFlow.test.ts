import type { CatalogSnapshot } from '../../order-menu-server/src/domain/contracts'

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
      const old = await runtime.invoke('kiosk_fast_path_context', { transcript: '有水餃嗎？' }) as { waitingFor: { questionId: string } }
      await expect(runtime.invoke('kiosk_fast_path_context', { transcript: '我要水餃', newRequestQuestionId: old.waitingFor.questionId })).rejects.toThrow('STALE_PLAN')
      vi.setSystemTime(Date.now() + 31_000)
      await expect(runtime.invoke('kiosk_fast_path_context', { transcript: '有水餃嗎？', newRequestQuestionId: old.waitingFor.questionId })).rejects.toThrow('STALE_PLAN')
      const fresh = await runtime.invoke('kiosk_fast_path_context', { transcript: '有水餃嗎？' }) as typeof old
      await runtime.invoke('kiosk_fast_path_context', { transcript: '有水餃嗎？', newRequestQuestionId: fresh.waitingFor.questionId })
      await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu' })
      await expect(runtime.invoke('kiosk_fast_path_context', { transcript: '有水餃嗎？', newRequestQuestionId: fresh.waitingFor.questionId })).rejects.toThrow('STALE_PLAN')
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
    await runtime.invoke('kiosk_fast_path_context', { transcript: '有水餃嗎？', newRequestQuestionId: pending.waitingFor.questionId })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu' })).toMatchObject({ items: [{ id: 'dumplings' }] })
    const resumed = await runtime.invoke('kiosk_fast_path_context', { transcript: '微辣' }) as { candidates: Array<{ id: string, description: string }> }
    expect(resumed.candidates.some(choice => choice.description.includes('微辣'))).toBe(true)
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: pending.candidates[0].id })).rejects.toThrow('STALE_PLAN')
    const changed = await runtime.invoke('kiosk_fast_path_context', { transcript: '我要水餃' }) as { waitingFor: { questionId: string } }
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要水餃', newRequestQuestionId: changed.waitingFor.questionId })
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
    { itemId: 'beef-noodle-soup', question: '辣度', transcript: '我要吃麵，一碗' },
    { itemId: 'beef-noodle-soup', question: '辣度', transcript: '我想吃麵，一碗' },
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
