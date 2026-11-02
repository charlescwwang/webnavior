import type { CheckoutSnapshot } from './domain/checkout-flow'

import { describe, expect, it } from 'vitest'

import { menu } from './domain/order-machine'
import { authorize, compileOperationPlan, createQuestion, deriveDecisionContext, resolveIntent } from './kiosk-intents'
import { createMenuToolRuntime } from './webmcp'

const dishes = [
  { ...menu[0]!, id: 'pork', name: '排骨便當', aliases: [], optionGroups: [] },
  { ...menu[0]!, id: 'chicken', name: '椒麻雞便當', aliases: [], optionGroups: [] },
]

// Report: docs/plans/2026-10-22-kiosk-field-investigation.md, seq186–221.
describe('historical field regressions', () => {
  // Reports: Oct2 ingredient continuity and Oct19 query updates in
  // docs/codex-handoff.md; Oct22 full-catalog contract in the investigation.
  it('retains food exclusions through price edits and full-menu browsing, then clears them for the next customer', async () => {
    const catalog = [
      { ...dishes[0]!, price: 90, composition: { ingredients: ['pork'], complete: true, source: 'merchant' as const, revision: '1', removals: [] } },
      { ...dishes[1]!, price: 100, composition: { ingredients: ['chicken'], complete: true, source: 'merchant' as const, revision: '1', removals: [] } },
      { ...dishes[1]!, id: 'chicken-premium', name: '雞腿便當', price: 150, composition: { ingredients: ['chicken'], complete: true, source: 'merchant' as const, revision: '1', removals: [] } },
    ]
    const shown: string[][] = []
    const runtime = createMenuToolRuntime({ menu: catalog, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: result => shown.push(result.itemIds) })
    await runtime.invokeForAgent('order_add_item', { itemId: 'chicken', quantity: 2 })
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'update', excludeIngredients: ['pork'], maxPrice: 100 })).toMatchObject({ items: [{ id: 'chicken' }] })
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'update', maxPrice: 160, excludeShown: true })).toMatchObject({ items: [{ id: 'chicken-premium' }], appliedFilters: { excludeIngredients: ['pork'] } })
    await runtime.invokeForAgent('order_set_fulfillment', { mode: 'takeout' })
    await runtime.invokeForAgent('menu_get', { scope: 'catalog', display: true })
    expect(shown.at(-1)).toEqual(['chicken', 'chicken-premium'])
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2, lines: [{ itemId: 'chicken', quantity: 2 }] } })

    await runtime.reset()
    await runtime.invokeForAgent('menu_get', { scope: 'catalog', display: true })
    expect(shown.at(-1)).toEqual(['pork', 'chicken', 'chicken-premium'])
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0, lines: [], fulfillmentMode: undefined } })
  })

  // Reports: Sep29 revision-bound plans and Oct7 session reset isolation,
  // recorded in docs/codex-handoff.md. Reusing the same runtime is deliberate.
  it('rejects an earlier customer confirmation after reset even when the new cart has the same dish', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invokeForAgent('order_add_item', { itemId: 'pork', quantity: 1 })
    const proposal = await runtime.invokeForAgent('cart_clear', { confirmedByUser: true }) as { pendingConfirmation: { confirmationId: string } }
    const candidateId = `intent:confirm:${proposal.pendingConfirmation.confirmationId}`
    await runtime.invoke('kiosk_fast_path_context', { transcript: '確認' })
    await runtime.reset()
    await runtime.invokeForAgent('order_add_item', { itemId: 'pork', quantity: 2 })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '確認' })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId })).rejects.toThrow()
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2, lines: [{ itemId: 'pork', quantity: 2 }] } })
  })

  // Reports: the investigation above and the Oct21 quantity case recorded in
  // docs/codex-handoff.md. Exercise both orders to catch shared-state leakage.
  it.each(['browse-first', 'fulfillment-first'] as const)('preserves accepted quantities across browsing and fulfillment changes: %s', async (order) => {
    const shown: string[][] = []
    const runtime = createMenuToolRuntime({
      menu: dishes,
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      onRecommendationsChange: result => shown.push(result.itemIds),
    })
    await runtime.invokeForAgent('order_add_item', { itemId: 'pork', quantity: 1 })
    await runtime.invokeForAgent('order_add_item', { itemId: 'pork', quantity: 2 })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 3, lines: [{ itemId: 'pork', quantity: 3 }] } })

    for (const step of order === 'browse-first' ? ['browse', 'fulfillment'] : ['fulfillment', 'browse']) {
      if (step === 'browse') {
        await runtime.invokeForAgent('menu_get', { query: '排骨便當', display: true })
        expect(shown.at(-1)).toEqual(['pork'])
        await runtime.invokeForAgent('menu_recommend', { action: 'continue' })
        expect(shown.at(-1)).toEqual(['chicken'])
        await runtime.invokeForAgent('menu_get', { scope: 'catalog', display: true })
        expect(shown.at(-1)).toEqual(['pork', 'chicken'])
      }
      else {
        for (const mode of ['takeout', 'dine-in', 'takeout'] as const) {
          await runtime.invokeForAgent('order_set_fulfillment', { mode })
          expect(await runtime.invoke('kiosk_conversation_context')).toMatchObject({ cart: { fulfillmentMode: mode, itemCount: 3, lines: [{ itemId: 'pork', quantity: 3 }] } })
        }
      }
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 3, lines: [{ itemId: 'pork', quantity: 3 }] } })
    }

    // A later explicit add must still execute once after the unrelated changes.
    await runtime.invokeForAgent('order_add_item', { itemId: 'chicken', quantity: 1 })
    expect(await runtime.invoke('kiosk_conversation_context')).toMatchObject({
      cart: { fulfillmentMode: 'takeout', itemCount: 4, lines: [{ itemId: 'pork', quantity: 3 }, { itemId: 'chicken', quantity: 1 }] },
    })
  })

  it('returns from checkout and changes mode exactly once after consuming the bound confirmation', async () => {
    let checkout: CheckoutSnapshot | undefined
    let revision = 0
    let cancels = 0
    const runtime = createMenuToolRuntime({
      menu: dishes,
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      checkout: {
        snapshot: () => checkout,
        revision: () => revision,
        paymentStatus: () => undefined,
        assertCanRestart: () => {},
        restart: () => {},
        start: () => ({ stage: 'invoice' }),
        skipMembership: () => ({ stage: 'invoice' }),
        chooseInvoice: () => ({ stage: 'payment' }),
        requestTaxId: () => ({ stage: 'tax-id' }),
        setTaxId: () => ({ stage: 'tax-id' }),
        confirmInvoice: () => { throw new Error('Unexpected invoice confirmation in this fixture') },
        confirmTaxId: () => ({ stage: 'payment' }),
        cancel: () => {
          checkout = undefined
          revision++
          cancels++
        },
        selectPayment: async () => { throw new Error('This scenario must not initiate payment') },
      },
    })
    await runtime.invoke('order_add_item', { itemId: 'pork' })
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
    checkout = { stage: 'invoice' }
    revision++
    const proposal = await runtime.invokeForAgent('order_set_fulfillment', { mode: 'dine-in' }) as { pendingConfirmation: { confirmationId: string } }
    expect(cancels).toBe(0)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { fulfillmentMode: 'takeout' } })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '確認' })
    const id = `intent:confirm:${proposal.pendingConfirmation.confirmationId}`
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: id })).toMatchObject({ cart: { fulfillmentMode: 'dine-in', itemCount: 1 } })
    expect(cancels).toBe(1)
    expect(checkout).toBeUndefined()
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: id })).rejects.toThrow()
    expect(cancels).toBe(1)
  })

  it('does not write fulfillment when the exact control animation fails', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: (action) => {
      if (action.controlId?.startsWith('order:fulfillment:'))
        throw new Error('Missing visible fulfillment control')
    }, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'pork' })
    await expect(runtime.invokeForAgent('order_set_fulfillment', { mode: 'dine-in' })).rejects.toThrow('Missing visible')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { fulfillmentMode: undefined, itemCount: 1 } })
  })
  it('offers other dishes after a precise lookup rather than requiring a recommendation batch', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invokeForAgent('menu_get', { query: '排骨便當', display: true })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '有沒有其他推薦' }) as { candidates: Array<{ id: string }> }
    expect(context.candidates.some(candidate => candidate.id === 'intent:recommend-more')).toBe(true)
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:recommend-more' })).toMatchObject({ items: [{ id: 'chicken' }] })
  })
  it('requires confirmation to return from invoice and change fulfillment, and never offers it during payment', () => {
    const cart = { fulfillmentMode: 'takeout' as const, lines: [{ id: 'line', itemId: 'pork', name: '排骨便當', quantity: 1, options: {}, unitPrice: 130 }], itemCount: 1, total: 130 }
    const context = deriveDecisionContext({ cart, menu: dishes, revisions: { cart: 1, checkout: 1, selectedItem: 0 }, checkout: { stage: 'invoice' }, transcript: '等等我要改成內用' })
    const candidate = context.candidates.find(candidate => candidate.id === 'intent:set-fulfillment:dine-in')
    expect(candidate).toBeDefined()
    const resolution = resolveIntent(candidate!, context)
    expect(resolution.kind).toBe('PLAN')
    if (resolution.kind !== 'PLAN')
      throw new Error('Expected a fulfillment plan')
    expect(authorize(compileOperationPlan(resolution.plan), context)).toEqual({ kind: 'REQUIRE_CONFIRMATION' })
    expect(createQuestion(context, 'invoice', Date.now())?.question).not.toContain('不執行付款')
    const locked = deriveDecisionContext({ ...context, paymentStatus: 'pending' })
    expect(locked.candidates.some(candidate => candidate.intent === 'SET_FULFILLMENT')).toBe(false)
  })
  it('presents the full catalog including previously seen dishes without changing the cart', async () => {
    const shown: string[][] = []
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: result => shown.push(result.itemIds) })
    await runtime.invokeForAgent('menu_recommend', { action: 'update', query: '排骨便當' })
    const result = await runtime.invokeForAgent('menu_get', { scope: 'catalog', display: true })
    expect(result).toMatchObject({ dataOnly: false, presentation: { kind: 'query-results', itemIds: ['pork', 'chicken'] } })
    expect(shown.at(-1)).toEqual(['pork', 'chicken'])
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('keeps a data-only named lookup from replacing the visible meal', async () => {
    const shown: string[][] = []
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: result => shown.push(result.itemIds) })
    await runtime.invokeForAgent('menu_get', { query: '排骨便當', display: true })
    await runtime.invokeForAgent('menu_get', { query: '椒麻雞便當', display: false })
    expect(shown).toEqual([['pork']])
  })

  it('releases a precise dish subject when continuing with other recommendations', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invokeForAgent('menu_recommend', { action: 'update', query: '排骨便當' })
    expect(await runtime.invokeForAgent('menu_recommend', { action: 'continue' })).toMatchObject({ items: [{ id: 'chicken' }], queryState: { queries: [] } })
  })
})
