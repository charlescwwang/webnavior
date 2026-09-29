import type { MenuItem } from './domain/order-machine'

import { describe, expect, it } from 'vitest'

import { authorize, compileOperationPlan, createConfirmation, deriveDecisionContext, resolveClarificationReference, resolveIntent, validateConfirmation } from './kiosk-intents'

const shrimpRoll: MenuItem = { available: true, category: '小吃', description: '現炸蝦捲', id: 'shrimp-roll', imageUrl: '', name: '蝦捲', optionGroups: [{ id: 'ginger', label: '嫩薑', required: false, values: [{ id: 'with', label: '要薑', priceDelta: 0 }] }], price: 75, recommendationTags: ['fried'] }
const base = { cart: { fulfillmentMode: undefined, itemCount: 0, lines: [], total: 0 }, menu: [shrimpRoll], revisions: { cart: 0, checkout: 0, selectedItem: 0 } }

describe('kiosk intent routing', () => {
  it('bounds a full menu to semantic intents and resolves a specific alias before its category', () => {
    const menu = [
      { ...shrimpRoll, id: 'signature', name: '周氏蝦捲招牌便當', aliases: ['招牌便當'], category: '便當' },
      ...Array.from({ length: 25 }, (_, index) => ({ ...shrimpRoll, id: `bento-${index}`, name: `便當${index}`, category: '便當' })),
    ]
    const context = deriveDecisionContext({ ...base, menu, transcript: '我想要吃招牌便當' })
    expect(context.phase).toBe('ordering')
    expect(context.candidates.length).toBeLessThan(15)
    expect(context.references).toEqual([{ label: '周氏蝦捲招牌便當', refId: 'item:signature' }])
    const add = context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!
    expect(resolveIntent(add, context)).toMatchObject({ kind: 'PLAN', plan: { targetRef: 'item:signature' } })
    const inferred = deriveDecisionContext({ ...base, menu: menu.map(item => ({ ...item, aliases: [] })), transcript: '招牌便當有嗎' })
    expect(inferred.references).toEqual([{ label: '周氏蝦捲招牌便當', refId: 'item:signature' }])
  })

  it('does not turn a generic hunger or background utterance into a menu operation', () => {
    for (const transcript of ['我好餓', '走走走 去那邊']) {
      const context = deriveDecisionContext({ ...base, transcript })
      expect(context.references).toEqual([])
      expect(context.candidates.map(candidate => candidate.intent)).toEqual(['RECOMMEND'])
    }
  })

  it('uses a configured selected item as the implicit target of another serving', () => {
    const context = deriveDecisionContext({ ...base, selectedItem: { itemId: shrimpRoll.id, options: {}, quantity: 1 }, transcript: '再一份' })
    const add = context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!
    const resolution = resolveIntent(add, context)
    expect(resolution).toMatchObject({ kind: 'PLAN', plan: { targetRef: 'selected:shrimp-roll' } })
    if (resolution.kind !== 'PLAN')
      throw new Error('Expected selected-item add plan.')
    expect(compileOperationPlan(resolution.plan).toolName).toBe('cart_add_item')
    expect(authorize(compileOperationPlan(resolution.plan), context)).toEqual({ kind: 'EXECUTE' })
  })

  it('adds the spoken quantity rather than reusing a different selected draft quantity', () => {
    const context = deriveDecisionContext({ ...base, selectedItem: { itemId: shrimpRoll.id, options: { ginger: 'with' }, quantity: 3 }, transcript: '再一份' })
    const add = context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!
    const resolution = resolveIntent(add, context)
    if (resolution.kind !== 'PLAN')
      throw new Error('Expected a repeat-item plan.')
    const operation = compileOperationPlan(resolution.plan)
    expect(operation).toMatchObject({ toolName: 'order_add_item', input: { itemId: 'shrimp-roll', options: [{ groupId: 'ginger', valueId: 'with' }], quantity: 1 } })
    expect(authorize(operation, context)).toEqual({ kind: 'EXECUTE' })
  })

  it('clarifies a repeat request when the current selection differs from the last added item', () => {
    const cart = { fulfillmentMode: undefined, itemCount: 1, lines: [{ id: 'L1', itemId: 'shrimp-roll', name: '蝦捲', options: {}, quantity: 1, unitPrice: 75 }], total: 75 }
    const menu = [shrimpRoll, { ...shrimpRoll, id: 'beef-noodle', name: '牛肉麵' }]
    const context = deriveDecisionContext({ ...base, cart, menu, recentAddedLineId: 'L1', selectedItem: { itemId: 'beef-noodle', options: {}, quantity: 1 }, transcript: '再一份' })
    const add = context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!
    expect(resolveIntent(add, context)).toMatchObject({ kind: 'CLARIFICATION', intent: 'ADD_ITEM', candidateRefs: ['selected:beef-noodle', 'cart:L1'] })
  })

  it('maps a category stem to its real category without inventing an item', () => {
    const context = deriveDecisionContext({ ...base, menu: [{ ...shrimpRoll, category: '麵食' }], transcript: '有麵嗎' })
    expect(context.references).toEqual([{ label: '麵食分類', refId: expect.stringContaining('category:') }])
    const search = context.candidates.find(candidate => candidate.intent === 'SEARCH_MENU')!
    const resolution = resolveIntent(search, context)
    if (resolution.kind !== 'PLAN')
      throw new Error('Expected category search plan.')
    expect(compileOperationPlan(resolution.plan).input).toEqual({ category: '麵食' })
  })

  it('preserves two separately named items instead of silently choosing the longer name', () => {
    const context = deriveDecisionContext({
      ...base,
      menu: [shrimpRoll, { ...shrimpRoll, id: 'beef-noodle', name: '牛肉麵' }],
      transcript: '我要蝦捲和牛肉麵',
    })
    expect(context.references.map(reference => reference.refId)).toEqual(['item:shrimp-roll', 'item:beef-noodle'])
    expect(resolveIntent(context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!, context)).toMatchObject({ kind: 'CLARIFICATION', candidateRefs: ['item:shrimp-roll', 'item:beef-noodle'] })
  })

  it('keeps two matching cart lines as a bound clarification for the original remove intent', () => {
    const lines = ['L1', 'L2'].map(id => ({ id, itemId: 'shrimp-roll', name: '蝦捲', options: {}, quantity: 1, unitPrice: 75 }))
    const context = deriveDecisionContext({ ...base, cart: { fulfillmentMode: 'takeout', itemCount: 2, lines, total: 150 }, revisions: { cart: 7, checkout: 0, selectedItem: 0 }, transcript: '蝦捲不要了' })
    const remove = context.candidates.find(candidate => candidate.intent === 'REMOVE_ITEM')!
    expect(resolveIntent(remove, context)).toMatchObject({ kind: 'CLARIFICATION', intent: 'REMOVE_ITEM', candidateRefs: ['cart:L1', 'cart:L2'] })
  })

  it('resolves only a unique ordinal inside the bound clarification references', () => {
    const references = [{ label: '購物車第1筆水餃', refId: 'cart:L1' }, { label: '購物車第2筆水餃', refId: 'cart:L2' }]
    expect(resolveClarificationReference('第二筆', references)).toBe('cart:L2')
    expect(resolveClarificationReference('第一筆和第二筆', references)).toBeUndefined()
    expect(resolveClarificationReference('牛肉麵', references)).toBeUndefined()
  })

  it('exposes payment phase and a finite method set without menu choices', () => {
    const context = deriveDecisionContext({ ...base, checkout: { stage: 'payment' }, transcript: '信用卡' })
    expect(context.phase).toBe('checkout_payment_select')
    expect(context.allowedPaymentMethods).toEqual(['card', 'mobile'])
    expect(context.candidates.map(candidate => candidate.id)).toEqual(['intent:select-payment:card', 'intent:select-payment:mobile', 'intent:cancel-checkout'])
    const cancel = resolveIntent(context.candidates.find(candidate => candidate.intent === 'CANCEL_CHECKOUT')!, context)
    if (cancel.kind !== 'PLAN')
      throw new Error('Expected a cancellation plan.')
    expect(authorize(compileOperationPlan(cancel.plan), context)).toEqual({ kind: 'REQUIRE_CONFIRMATION' })
  })
  it('keeps all exposed System One decisions semantic and compiles direct add only after resolution', () => {
    const context = deriveDecisionContext({ ...base, transcript: '我要一份蝦捲' })
    const decision = context.candidates.find(candidate => candidate.id === 'intent:add-item')!
    expect(JSON.stringify(decision)).not.toContain('order_add_item')
    const resolved = resolveIntent(decision, context)
    expect(resolved).toMatchObject({ kind: 'PLAN', plan: { intent: 'ADD_ITEM' } })
    if (resolved.kind !== 'PLAN')
      throw new Error('Expected a domain plan.')
    expect(compileOperationPlan(resolved.plan)).toMatchObject({ input: { itemId: 'shrimp-roll', quantity: 1 }, toolName: 'order_add_item' })
  })

  it('covers search, recommendations, cart option edits, and checkout intents without exposing raw tool names', () => {
    const browsing = deriveDecisionContext({ ...base, cart: { fulfillmentMode: 'takeout', itemCount: 1, lines: [{ id: 'L2', itemId: 'shrimp-roll', name: '蝦捲', options: {}, quantity: 1, unitPrice: 75 }], total: 75 }, transcript: '蝦捲要薑' })
    expect(browsing.candidates.map(candidate => candidate.intent)).toEqual(expect.arrayContaining(['SEARCH_MENU', 'SET_OPTION', 'START_CHECKOUT']))
    expect(browsing.candidates.some(candidate => candidate.intent === 'RECOMMEND')).toBe(false)
    const payment = deriveDecisionContext({ ...base, checkout: { stage: 'payment' } })
    expect(payment.candidates.map(candidate => candidate.intent)).toEqual(expect.arrayContaining(['SELECT_PAYMENT']))
    expect(payment.candidates.some(candidate => candidate.intent === 'ADD_ITEM' || candidate.intent === 'SEARCH_MENU')).toBe(false)
  })

  it('uses ASCII-only System One IDs when a category label is localized', () => {
    const context = deriveDecisionContext({
      ...base,
      menu: [{ ...shrimpRoll, category: '點心' }],
      transcript: '有點心嗎',
    })
    const categoryCandidate = context.candidates.find(candidate => candidate.intent === 'SEARCH_MENU')!

    expect(categoryCandidate.id).toMatch(/^[\w:-]+$/)
    const resolution = resolveIntent(categoryCandidate, context)
    if (resolution.kind !== 'PLAN')
      throw new Error('Expected a category search plan.')
    expect(compileOperationPlan(resolution.plan)).toMatchObject({
      input: { category: '點心' },
      toolName: 'menu_get',
    })
  })

  it('keeps an explicitly ordered quantity and option inside one ADD_ITEM plan', () => {
    const dumplings: MenuItem = {
      ...shrimpRoll,
      id: 'dumplings',
      name: '水餃',
      optionGroups: [{ id: 'spicy', label: '辣度', required: true, values: [{ id: 'none', label: '不辣', priceDelta: 0 }, { id: 'medium', label: '中辣', priceDelta: 0 }] }],
    }
    const context = deriveDecisionContext({ ...base, menu: [dumplings], transcript: '我要兩份水餃不要辣' })
    const decision = context.candidates.find(candidate => candidate.id === 'intent:add-item')!
    const resolution = resolveIntent(decision, context)

    if (resolution.kind !== 'PLAN')
      throw new Error('Expected an add-item plan.')
    expect(compileOperationPlan(resolution.plan)).toMatchObject({
      input: { itemId: 'dumplings', options: [{ groupId: 'spicy', valueId: 'none' }], quantity: 2 },
      toolName: 'order_add_item',
    })
  })

  it('treats an option phrase as SET_OPTION only for an existing unique target', () => {
    const dumplings: MenuItem = {
      ...shrimpRoll,
      id: 'dumplings',
      name: '水餃',
      optionGroups: [{ id: 'spicy', label: '辣度', required: false, values: [{ id: 'none', label: '不辣', priceDelta: 0 }] }],
    }
    const context = deriveDecisionContext({ ...base, menu: [dumplings], selectedItem: { itemId: 'dumplings', options: {}, quantity: 1 }, transcript: '不要辣' })
    const decision = context.candidates.find(candidate => candidate.id === 'intent:set-option')!
    const resolution = resolveIntent(decision, context)

    if (resolution.kind !== 'PLAN')
      throw new Error('Expected a set-option plan.')
    expect(compileOperationPlan(resolution.plan)).toMatchObject({
      input: { groupId: 'spicy', valueId: 'none' },
      toolName: 'menu_set_item_option',
    })
  })

  it('uses the existing pork-free recommendation capability for a direct dietary exclusion', () => {
    const context = deriveDecisionContext({ ...base, menu: [{ ...shrimpRoll, recommendationTags: ['pork-free'] }], transcript: '我不要豬肉' })
    const decision = context.candidates.find(candidate => candidate.id === 'intent:recommend')!
    const resolution = resolveIntent(decision, context)

    if (resolution.kind !== 'PLAN')
      throw new Error('Expected a recommendation plan.')
    expect(compileOperationPlan(resolution.plan)).toMatchObject({
      input: { needs: ['pork-free'] },
      toolName: 'menu_recommend',
    })
    const unsupported = deriveDecisionContext({ ...base, transcript: '我不要豬肉' })
    expect(resolveIntent(unsupported.candidates.find(candidate => candidate.intent === 'RECOMMEND')!, unsupported)).toEqual({ kind: 'NEEDS_ASSISTANT' })
  })

  it('compiles every checkout stage from semantic plans instead of exposing checkout WebMCP names', () => {
    const compile = (context: ReturnType<typeof deriveDecisionContext>, id: string) => {
      const decision = context.candidates.find(candidate => candidate.id === id)!
      const resolved = resolveIntent(decision, context)
      if (resolved.kind !== 'PLAN')
        throw new Error(`Expected plan for ${id}`)
      return compileOperationPlan(resolved.plan)
    }
    const membership = deriveDecisionContext({ ...base, checkout: { stage: 'membership' } })
    expect(compile(membership, 'intent:skip-membership').toolName).toBe('checkout_skip_membership')
    expect(compile(membership, 'intent:cancel-checkout').toolName).toBe('checkout_cancel')

    const invoice = deriveDecisionContext({ ...base, checkout: { carrierCode: '/ABC', stage: 'invoice' } })
    expect(compile(invoice, 'intent:choose-invoice:carrier').toolName).toBe('checkout_choose_invoice')
    expect(compile(invoice, 'intent:request-tax-id').toolName).toBe('checkout_request_tax_id')

    const taxId = deriveDecisionContext({ ...base, checkout: { stage: 'tax-id', taxId: '12345678' }, transcript: '確認' })
    expect(compile(taxId, 'intent:confirm-tax-id').toolName).toBe('checkout_confirm_tax_id')
    const payment = deriveDecisionContext({ ...base, checkout: { stage: 'payment' } })
    expect(compile(payment, 'intent:select-payment:card').toolName).toBe('checkout_select_payment')
  })

  it('rejects a stale operation plan instead of recompiling it', () => {
    const context = deriveDecisionContext({ ...base, cart: { fulfillmentMode: undefined, itemCount: 1, lines: [{ id: 'L2', itemId: 'shrimp-roll', name: '蝦捲', options: {}, quantity: 1, unitPrice: 75 }], total: 75 }, revisions: { cart: 1, checkout: 0, selectedItem: 0 }, transcript: '蝦捲改成兩份' })
    const decision = context.candidates.find(candidate => candidate.id === 'intent:set-quantity')!
    const resolved = resolveIntent(decision, context)
    if (resolved.kind !== 'PLAN')
      throw new Error('Expected a domain plan.')
    expect(authorize(compileOperationPlan(resolved.plan), { ...context, revisions: { ...context.revisions, cart: 2 } })).toEqual({ kind: 'BLOCKED', reason: 'STALE_PLAN' })
  })

  it('requires one-use confirmation for high-risk plans while ordinary checkout start is directly authorized', () => {
    const clear = deriveDecisionContext({ ...base, cart: { fulfillmentMode: undefined, itemCount: 1, lines: [{ id: 'L2', itemId: 'shrimp-roll', name: '蝦捲', options: {}, quantity: 1, unitPrice: 75 }], total: 75 } })
    const clearDecision = clear.candidates.find(candidate => candidate.intent === 'CLEAR_CART')!
    const clearResult = resolveIntent(clearDecision, clear)
    if (clearResult.kind !== 'PLAN')
      throw new Error('Expected a domain plan.')
    expect(authorize(compileOperationPlan(clearResult.plan), clear)).toEqual({ kind: 'REQUIRE_CONFIRMATION' })
    const confirmation = createConfirmation({ action: 'CLEAR_CART', cartRevision: 3, confirmationId: 'confirm-1', createdAt: 1_000, expiresAt: 4_000, payload: {} })
    expect(validateConfirmation(confirmation, { cartRevision: 3, now: 2_000 })).toEqual({ kind: 'VALID' })
    expect(validateConfirmation(confirmation, { action: 'SELECT_PAYMENT', cartRevision: 3, now: 2_000 })).toEqual({ kind: 'INVALID', reason: 'MISMATCH' })
    expect(validateConfirmation({ ...confirmation, consumedAt: 2_000 }, { cartRevision: 3, now: 2_001 })).toEqual({ kind: 'INVALID', reason: 'CONSUMED' })

    const payment = deriveDecisionContext({ ...base, checkout: { stage: 'payment' } })
    const paymentDecision = payment.candidates.find(candidate => candidate.id === 'intent:select-payment:card')!
    const paymentResult = resolveIntent(paymentDecision, payment)
    if (paymentResult.kind !== 'PLAN')
      throw new Error('Expected payment plan.')
    expect(authorize(compileOperationPlan(paymentResult.plan), payment)).toEqual({ kind: 'REQUIRE_CONFIRMATION' })
    expect(deriveDecisionContext({ ...base, checkout: { stage: 'payment' }, paymentStatus: 'pending' }).candidates.some(candidate => candidate.intent === 'SELECT_PAYMENT')).toBe(false)
  })
})
