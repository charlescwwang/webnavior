import type { CatalogSnapshot } from '../../order-menu-server/src/domain/contracts'

import { describe, expect, it } from 'vitest'

import { createPosSimulator } from '../../order-menu-server/src/simulator'
import { menu } from './domain/order-machine'
import { deriveDecisionContext, resolveIntent } from './kiosk-intents'
import { createMenuToolRuntime } from './webmcp'

const dish = { ...menu[0]!, id: 'pepper-chicken', name: '椒麻雞便當', category: '便當', aliases: [], optionGroups: [] }
const context = { menu: [dish], cart: { itemCount: 0, lines: [], total: 0, fulfillmentMode: undefined }, revisions: { cart: 0, checkout: 0, selectedItem: 0 } }

describe('asr dish-name diagnosis', () => {
  it.each([false, true])('suppresses 排骨的一份 with presentation context %s', (presented) => {
    const pork = { ...dish, id: 'pork-bento', name: '炸排骨便當', aliases: ['排骨便當'] }
    const result = deriveDecisionContext({ ...context, menu: [pork], presentationItemIds: presented ? [pork.id] : [], transcript: '排骨的一份' })
    expect(result.productResolution).toMatchObject({ status: 'possible', count: 1 })
    expect(result.catalogEvidence.products).toEqual([{ label: pork.name, matchedText: '排骨', source: 'fragment' }])
    expect(result.candidates.some(choice => choice.intent === 'ADD_ITEM')).toBe(false)
  })
  it('parses one serving in 排骨的一份 when the merchant explicitly names 排骨 as an alias', () => {
    // Fixture-only contrast: an alias proves the gating boundary, not permission
    // to add every abbreviated or mistranscribed name to the real catalog.
    const pork = { ...dish, id: 'pork-bento', name: '炸排骨便當', aliases: ['排骨便當', '排骨'] }
    const result = deriveDecisionContext({ ...context, menu: [pork], transcript: '排骨的一份' })
    expect(result.productResolution.status).toBe('exact')
    const add = result.candidates.find(choice => choice.intent === 'ADD_ITEM')
    expect(add).toBeDefined()
    expect(resolveIntent(add!, result)).toMatchObject({ kind: 'PLAN', plan: { slots: { itemId: pork.id, quantity: 1 } } })
  })
  it.each([
    { label: 'presentation', extra: { presentationItemIds: [dish.id] } },
    { label: 'selection', extra: { selectedItem: { itemId: dish.id, quantity: 1, options: {} } } },
    { label: 'recent cart addition', extra: { cart: { itemCount: 1, total: dish.price, fulfillmentMode: undefined, lines: [{ id: 'L1', itemId: dish.id, name: dish.name, quantity: 1, options: {}, unitPrice: dish.price }] }, recentAddedLineId: 'L1' } },
  ])('does not restore the order candidate merely by supplying $label context', ({ extra }) => {
    const correct = deriveDecisionContext({ ...context, ...extra, transcript: '椒麻雞便當來一份' })
    const typo = deriveDecisionContext({ ...context, ...extra, transcript: '蕉麻雞便當來一份' })
    expect(correct.candidates.some(choice => choice.intent === 'ADD_ITEM')).toBe(true)
    expect(typo.productResolution).toMatchObject({ status: 'possible', count: 1 })
    expect(typo.candidates.some(choice => choice.intent === 'ADD_ITEM')).toBe(false)
  })
  it('distinguishes real names from typo fragments before any model invocation', () => {
    const correct = deriveDecisionContext({ ...context, transcript: '椒麻雞便當來一份' })
    const typo = deriveDecisionContext({ ...context, transcript: '蕉麻雞便當來一份' })
    expect(correct.productResolution.status).toBe('exact')
    expect(correct.candidates.some(choice => choice.intent === 'ADD_ITEM')).toBe(true)
    expect(typo.productResolution.status).toBe('possible')
    expect(typo.catalogEvidence.products).toEqual([{ label: dish.name, matchedText: '麻雞便當', source: 'fragment' }])
    expect(typo.candidates.some(choice => choice.intent === 'ADD_ITEM')).toBe(false)
  })
  it('changes the outcome only when a catalog alias is supplied, without correcting the transcript', () => {
    const withAlias = deriveDecisionContext({ ...context, menu: [{ ...dish, aliases: ['蕉麻雞便當'] }], transcript: '蕉麻雞便當來一份' })
    expect(withAlias.catalogEvidence.products).toEqual([{ label: dish.name, matchedText: '蕉麻雞便當', source: 'alias' }])
    expect(withAlias.productResolution.status).toBe('exact')
    expect(withAlias.candidates.some(choice => choice.intent === 'ADD_ITEM')).toBe(true)
    expect(withAlias.transcript).toBe('蕉麻雞便當來一份')
  })
  it('can discover multiple dishes from shared fragments, not prove a unique typo correction', () => {
    const result = deriveDecisionContext({ ...context, menu: [dish, { ...dish, id: 'curry-chicken', name: '咖哩雞便當' }], transcript: '蕉麻雞便當來一份' })
    expect(result.productResolution.count).toBe(2)
    expect(result.catalogEvidence.products.map(item => item.matchedText)).toEqual(['麻雞便當', '雞便當'])
    expect(result.candidates.some(choice => choice.intent === 'ADD_ITEM')).toBe(false)
  })
  it('reproduces the same boundary with the real simulator catalog and literal menu query', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const state = await runtime.invoke('kiosk_fast_path_context', { transcript: '蕉麻雞便當來一份' })
    expect(state).toMatchObject({ productResolution: { status: 'possible', references: [{ label: '椒麻雞便當' }] } })
    if (!state || typeof state !== 'object' || !('candidates' in state) || !Array.isArray(state.candidates))
      throw new Error('Expected finite runtime candidates')
    expect(state.candidates.some(choice => choice.id === 'intent:add-item')).toBe(false)
    expect(await runtime.invoke('menu_get', { query: '蕉麻雞便當' })).toMatchObject({ items: [] })
    expect(await runtime.invoke('menu_get', { query: '椒麻雞便當' })).toMatchObject({ items: [{ id: 'spicy-chicken-bento', name: '椒麻雞便當' }] })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })
  // Known-red diagnostic, not a production fix or authorization to silently
  // correct a dish. The report asks why the order intent cannot reach resolution.
  it.skipIf(process.env.KIOSK_ASR_NAME_DIAGNOSIS !== '1')('retains an order candidate for 排骨的一份 after presentation', () => {
    const pork = { ...dish, id: 'pork-bento', name: '炸排骨便當', aliases: ['排骨便當'] }
    const result = deriveDecisionContext({ ...context, menu: [pork], presentationItemIds: [pork.id], transcript: '排骨的一份' })
    expect(result.productResolution).toMatchObject({ status: 'possible', count: 1 })
    expect(result.catalogEvidence.products).toEqual([{ label: pork.name, matchedText: '排骨', source: 'fragment' }])
    expect(result.candidates.some(choice => choice.intent === 'ADD_ITEM')).toBe(true)
  })
  it.skipIf(process.env.KIOSK_ASR_NAME_DIAGNOSIS !== '1')('retains an order candidate for 蕉麻雞便當來一份', () => {
    const result = deriveDecisionContext({ ...context, transcript: '蕉麻雞便當來一份' })
    console.info(JSON.stringify({ productResolution: result.productResolution, evidence: result.catalogEvidence, candidates: result.candidates.map(choice => choice.id) }))
    expect(result.candidates.some(choice => choice.intent === 'ADD_ITEM')).toBe(true)
  })
})
