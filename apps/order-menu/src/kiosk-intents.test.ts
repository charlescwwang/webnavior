import type { MenuItem } from './domain/order-machine'

import { describe, expect, it } from 'vitest'

import { authorize, compileOperationPlan, createConfirmation, createQuestion, deriveDecisionContext, intentRecovery, questionIsCurrent, resolveClarificationReference, resolveIntent, validateConfirmation } from './kiosk-intents'

const shrimpRoll: MenuItem = { available: true, category: '小吃', description: '現炸蝦捲', id: 'shrimp-roll', imageUrl: '', name: '蝦捲', optionGroups: [{ id: 'ginger', label: '嫩薑', required: false, values: [{ id: 'with', label: '要薑', priceDelta: 0 }] }], price: 75, recommendationTags: ['fried'] }
const base = { cart: { fulfillmentMode: undefined, itemCount: 0, lines: [], total: 0 }, menu: [shrimpRoll], revisions: { cart: 0, checkout: 0, selectedItem: 0 } }

// Report: attachment b0b98800, 2026-10-21; category-only evidence substituted three beef noodles for eel noodles.
it('does not turn an unmatched dish into the sole member of a matching category', () => {
  const menu = [{ ...shrimpRoll, id: 'beef', name: '紅燒牛肉麵', aliases: ['牛肉麵'], category: '麵食', optionGroups: [] }]
  const context = deriveDecisionContext({ ...base, menu, transcript: '鱔魚意麵3份，不要蔥花，一份大辣兩份小辣' })
  expect(context.productResolution.status).toBe('none')
  expect(resolveIntent(context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!, context)).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
})

// Report: this chat, attachment b0b98800; the prior product must not identify a new category-only request.
it('does not let a previous product name bypass the category identity guard', () => {
  const menu = [{ ...shrimpRoll, id: 'beef', name: '紅燒牛肉麵', aliases: ['牛肉麵'], category: '麵食', optionGroups: [] }]
  const context = deriveDecisionContext({ ...base, menu, previousTranscript: '牛肉麵', transcript: '鱔魚意麵三份' })
  expect(context.productResolution.status).toBe('none')
  expect(resolveIntent(context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!, context)).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
})

it('does not collapse two spice values into one option for three servings', () => {
  const menu = [{ ...shrimpRoll, id: 'beef', name: '紅燒牛肉麵', aliases: ['牛肉麵'], category: '麵食', optionGroups: [{ id: 'spice', label: '辣度', required: true, values: [{ id: 'hot', label: '大辣', priceDelta: 0 }, { id: 'mild', label: '小辣', priceDelta: 0 }] }] }]
  const context = deriveDecisionContext({ ...base, menu, transcript: '牛肉麵3份，一份大辣兩份小辣' })
  expect(resolveIntent(context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!, context)).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
})

describe('kiosk intent routing', () => {
  // Report: this chat, Nov2; typed carrier /PTGRJP2 + 確認／送出 had no operation.
  it('offers confirmation only for the current valid invoice draft', () => {
    const checkout = { stage: 'invoice' as const, invoiceMethod: 'carrier' as const, invoiceDraft: { method: 'carrier' as const, code: '/PTGRJP2' } }
    const context = deriveDecisionContext({ ...base, checkout, transcript: '確認' })
    const confirm = context.candidates.find(candidate => candidate.intent === 'CONFIRM_INVOICE')
    expect(confirm).toMatchObject({ id: 'intent:confirm-invoice' })
    expect(intentRecovery(context)).toEqual({ kind: 'request', candidateIds: ['intent:confirm-invoice'] })
    expect(createQuestion(context, 'invoice-draft', Date.now())?.question).toContain('請確認畫面上的發票資料')
    const invalid = deriveDecisionContext({ ...base, checkout: { ...checkout, invoiceDraft: { method: 'carrier', code: '/PT' } }, transcript: '送出' })
    expect(invalid.candidates.some(candidate => candidate.id === 'intent:confirm-invoice')).toBe(false)
    expect(intentRecovery(invalid)).toBeUndefined()
  })

  it('issues one tax-ID confirmation effect without a second confirmation question', () => {
    const context = deriveDecisionContext({ ...base, checkout: { stage: 'tax-id', invoiceMethod: 'tax-id', taxId: '12345678' }, transcript: '資料沒問題' })
    expect(intentRecovery(context)).toEqual({ kind: 'request', candidateIds: ['intent:confirm-tax-id'] })
    const choice = context.candidates.find(candidate => candidate.id === 'intent:confirm-tax-id')!
    const result = resolveIntent(choice, context)
    if (result.kind !== 'PLAN')
      throw new Error('A valid invoice confirmation must compile one plan')
    expect(authorize(compileOperationPlan(result.plan), context)).toEqual({ kind: 'EXECUTE' })
  })

  it('offers only LINE Pay and 街口支付 when those are the deployed payment choices', () => {
    const cart = { ...base.cart, fulfillmentMode: 'dine-in' as const, lines: [{ id: 'L1', itemId: shrimpRoll.id, name: shrimpRoll.name, quantity: 1, options: {}, unitPrice: 75 }], total: 75, itemCount: 1 }
    const context = deriveDecisionContext({ ...base, cart, checkout: { stage: 'payment' }, paymentMethods: ['linepay', 'jkopay'], transcript: '街口' })
    expect(context.allowedPaymentMethods).toEqual(['linepay', 'jkopay'])
    expect(createQuestion(context, 'payment-question', Date.now())?.question).toBe('請選擇LINE Pay或街口支付。')
    expect(context.candidates.find(choice => choice.id === 'intent:select-payment:jkopay')?.description).toContain('街口支付')
    expect(context.candidates.some(choice => choice.id === 'intent:select-payment:card')).toBe(false)
  })
  it('keeps explicit legal operations available while an unrelated party-size question is pending', () => {
    const cart = { ...base.cart, fulfillmentMode: 'dine-in' as const, lines: [{ id: 'L1', itemId: shrimpRoll.id, name: shrimpRoll.name, quantity: 1, options: {}, unitPrice: 75 }], total: 75, itemCount: 1 }
    const context = deriveDecisionContext({ ...base, cart, transcript: '清空購物車', waitingFor: { questionId: 'Q1', phase: 'ordering', purpose: 'party-size', question: '幾位？', choices: [], expectedRevisions: { cart: 0 }, expiresAt: Date.now() + 30000 } })
    expect(context.candidates.some(choice => choice.intent === 'CLEAR_CART')).toBe(true)
    expect(context.waitingFor?.questionId).toBe('Q1')
  })
  it('does not let a bare acknowledgment reorder or edit the implicit cart target', () => {
    const cart = { ...base.cart, lines: [{ id: 'L1', itemId: shrimpRoll.id, name: shrimpRoll.name, quantity: 1, options: {}, unitPrice: 75 }], total: 75, itemCount: 1 }
    const context = deriveDecisionContext({ ...base, cart, selectedItem: { itemId: shrimpRoll.id, options: {}, quantity: 1 }, transcript: '好', waitingFor: { questionId: 'Q1', phase: 'ordering', purpose: 'fulfillment', question: '內用還是自取？', choices: [], expectedRevisions: { cart: 0 }, expiresAt: Date.now() + 30000 } })
    expect(context.candidates.some(choice => ['ADD_ITEM', 'SET_QUANTITY', 'SET_OPTION', 'REMOVE_ITEM'].includes(choice.intent))).toBe(false)
    expect(context.candidates.some(choice => choice.intent === 'SET_FULFILLMENT')).toBe(true)
  })
  it('distinguishes category preference from a named order even with one category member', () => {
    const menu = [{ ...shrimpRoll, id: 'beef', name: '紅燒牛肉麵', aliases: ['牛肉麵'], category: '麵食' }]
    const preference = deriveDecisionContext({ ...base, menu, transcript: '我想吃麵' })
    expect(preference.productResolution.status).toBe('none')
    expect(preference.catalogEvidence).toEqual({ products: [], categories: [{ label: '麵食', matchedText: '麵', itemCount: 1 }] })
    expect(preference.candidates.some(candidate => candidate.intent === 'ADD_ITEM')).toBe(false)
    expect(preference.candidates.some(candidate => candidate.intent === 'RECOMMEND')).toBe(true)
    expect(resolveIntent(preference.candidates.find(candidate => candidate.intent === 'RECOMMEND')!, preference)).toMatchObject({ kind: 'PLAN', plan: { slots: { category: '麵食' } } })
    const order = deriveDecisionContext({ ...base, menu, transcript: '我要吃麵，一碗' })
    expect(resolveIntent(order.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!, order)).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
    const alias = deriveDecisionContext({ ...base, menu, transcript: '我要牛肉麵' })
    expect(alias.catalogEvidence.products).toEqual([{ label: '紅燒牛肉麵', matchedText: '牛肉麵', source: 'alias' }])
    expect(alias.candidates.some(candidate => candidate.intent === 'ADD_ITEM')).toBe(true)
  })

  it('does not treat a unique inferred name suffix as a merchant alias', () => {
    const menu = [{ ...shrimpRoll, id: 'beef', name: '紅燒牛肉麵', aliases: [], category: '麵食' }]
    const context = deriveDecisionContext({ ...base, menu, transcript: '我要牛肉麵' })
    expect(context.productResolution.status).toBe('possible')
    expect(context.targetConstraints.itemIds).toEqual([])
    expect(context.catalogEvidence.products).toEqual([{ label: '紅燒牛肉麵', matchedText: '牛肉麵', source: 'fragment' }])
    expect(context.candidates.some(candidate => candidate.intent === 'ADD_ITEM')).toBe(false)
    const focused = deriveDecisionContext({ ...base, menu: [...menu, shrimpRoll], selectedItem: { itemId: shrimpRoll.id, quantity: 1, options: {} }, transcript: '牛肉麵改兩份' })
    expect(focused.candidates.some(candidate => ['ADD_ITEM', 'SELECT_ITEM', 'SET_OPTION', 'SET_QUANTITY', 'REMOVE_ITEM'].includes(candidate.intent))).toBe(false)
  })
  it('does not expose an entire category to the model or clarify more than five targets', () => {
    for (const size of [7, 50, 200]) {
      const menu = Array.from({ length: size }, (_, index) => ({ ...shrimpRoll, id: `bento-${index}`, name: `餐點${index}便當`, category: '便當' }))
      const context = deriveDecisionContext({ ...base, menu, transcript: '我要兩份便當' })
      expect(context.modelReferences.filter(reference => reference.refId.startsWith('item:')).length).toBeLessThanOrEqual(5)
      expect(resolveIntent(context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!, context)).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
      expect(context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!.description.length).toBeLessThan(200)
    }
  })

  it('retains a possible product interpretation separately from ingredient mentions', () => {
    const menu = [{ ...shrimpRoll, id: 'signature', name: '蝦捲招牌便當', aliases: [], category: '便當' }]
    const context = deriveDecisionContext({ ...base, menu, transcript: '有蝦蝦捲嗎？' })
    expect(context.productResolution).toMatchObject({ status: 'possible', count: 1, references: [{ label: '蝦捲招牌便當' }] })
    expect(context.ingredientReferences).toContainEqual({ id: 'shrimp', label: '蝦' })
    expect(context.targetConstraints.itemIds).toEqual([])
    expect(resolveIntent(context.candidates.find(candidate => candidate.intent === 'SEARCH_MENU')!, { ...context, searchInterpretation: 'product' })).toMatchObject({ kind: 'PLAN', plan: { slots: { query: '蝦捲招牌便當' } } })
  })
  it('resolves quantity and target from separate related speech fragments', () => {
    const context = deriveDecisionContext({ ...base, previousTranscript: '我要兩份', transcript: '蝦捲' })
    const resolution = resolveIntent(context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!, context)
    expect(resolution).toMatchObject({ kind: 'PLAN', plan: { targetRef: 'item:shrimp-roll', slots: { quantity: 2 } } })
    expect(context.transcript).toBe('蝦捲')
  })
  it('can return from cart review without clearing the cart, but cannot leave a payment lock', () => {
    const context = deriveDecisionContext({ ...base, menuReturnSupported: true })
    const choice = context.candidates.find(candidate => candidate.intent === 'RETURN_MENU')!
    const resolution = resolveIntent(choice, context)
    expect(resolution.kind).toBe('PLAN')
    if (resolution.kind !== 'PLAN')
      throw new Error('Expected navigation plan')
    const operation = compileOperationPlan(resolution.plan)
    expect(operation.toolName).toBe('menu_open')
    expect(authorize(operation, context)).toEqual({ kind: 'EXECUTE' })
    expect(authorize(operation, { ...context, phase: 'payment_locked', paymentStatus: 'pending' })).toEqual({ kind: 'BLOCKED', reason: 'PAYMENT_IN_PROGRESS' })
  })
  it('exposes person-count and real table choices without a hold token, and rejects stale seat plans', () => {
    const input = { ...base, cart: { ...base.cart, fulfillmentMode: 'dine-in' as const }, seating: { revision: 4, partySize: undefined, ready: false, choices: [] }, revisions: { ...base.revisions, seating: 4 }, transcript: '兩位' }
    const count = deriveDecisionContext(input)
    expect(count.interactionState.seating).toMatchObject({ ready: false, question: '請問幾位用餐？' })
    const resolution = resolveIntent(count.candidates.find(candidate => candidate.intent === 'SET_PARTY_SIZE')!, count)
    expect(resolution).toMatchObject({ kind: 'PLAN', plan: { slots: { partySize: 2 }, expectedRevisions: { seating: 4 } } })
    if (resolution.kind !== 'PLAN')
      throw new Error('Expected a person-count plan')
    expect(authorize(compileOperationPlan(resolution.plan), count)).toEqual({ kind: 'EXECUTE' })
    expect(authorize(compileOperationPlan(resolution.plan), { ...count, revisions: { ...count.revisions, seating: 5 } })).toEqual({ kind: 'BLOCKED', reason: 'STALE_PLAN' })
    const choice = { id: 'TABLE_CHOICE_1', label: '1 號桌、2 號桌', tableIds: ['T1', 'T2'], splitRequired: true }
    const tables = deriveDecisionContext({ ...input, transcript: '同意分桌選第一組', seating: { revision: 4, partySize: 5, ready: false, choices: [choice] } })
    const selection = resolveIntent(tables.candidates.find(candidate => candidate.intent === 'RESERVE_TABLES')!, tables)
    expect(selection).toMatchObject({ kind: 'PLAN', plan: { targetRef: 'table:TABLE_CHOICE_1' } })
    if (selection.kind !== 'PLAN')
      throw new Error('Expected table selection')
    const operation = compileOperationPlan(selection.plan)
    expect(operation).toMatchObject({ toolName: 'seating_reserve', input: { splitApproved: true } })
    expect(authorize({ ...operation, input: { ...operation.input, splitApproved: false } }, tables)).toEqual({ kind: 'BLOCKED', reason: 'INVALID_SLOTS' })
    expect(authorize(operation, { ...tables, seating: { ...tables.seating!, choices: [] } })).toEqual({ kind: 'BLOCKED', reason: 'TARGET_MISSING' })
  })

  it('does not offer checkout before dine-in seating or seat mutations while payment is pending', () => {
    const cart = { ...base.cart, fulfillmentMode: 'dine-in' as const, lines: [{ id: 'L1', itemId: shrimpRoll.id, name: shrimpRoll.name, options: {}, quantity: 1, unitPrice: 75 }], total: 75, itemCount: 1 }
    const context = deriveDecisionContext({ ...base, cart, seating: { revision: 0, ready: false, choices: [] }, transcript: '內用' })
    expect(context.candidates.some(candidate => candidate.intent === 'START_CHECKOUT')).toBe(false)
    expect(context.candidates.some(candidate => candidate.intent === 'SET_FULFILLMENT' && candidate.slots?.mode === 'takeout')).toBe(true)
    const ready = deriveDecisionContext({ ...context, seating: { revision: 1, ready: true, partySize: 2, choices: [] } })
    expect(ready.candidates.some(candidate => candidate.intent === 'START_CHECKOUT')).toBe(true)
    const locked = deriveDecisionContext({ ...ready, checkout: { stage: 'payment', invoiceMethod: 'donation' }, paymentStatus: 'pending' })
    expect(locked.candidates).toEqual([])
  })
  it('compiles whole-menu browsing into an explicit complete catalog presentation', () => {
    const context = deriveDecisionContext({ ...base, transcript: '有賣什麼' })
    const resolution = resolveIntent(context.candidates.find(candidate => candidate.intent === 'SEARCH_MENU')!, context)
    expect(resolution).toMatchObject({ kind: 'PLAN', plan: { slots: { scope: 'all' } } })
    if (resolution.kind !== 'PLAN')
      throw new Error('Expected a menu exploration plan')
    expect(compileOperationPlan(resolution.plan)).toMatchObject({ intent: 'SEARCH_MENU', toolName: 'menu_get', input: { scope: 'catalog', display: true } })
  })

  it('keeps a discussed dish separate from an unanswered question, with expiry and revision checks', () => {
    const context = deriveDecisionContext({ ...base, presentationItemIds: [shrimpRoll.id], transcript: '就這個' })
    expect(context.waitingFor).toBeUndefined()
    expect(resolveIntent(context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!, context)).toMatchObject({ kind: 'CONFIGURATION', plan: { targetRef: 'item:shrimp-roll' } })
    const browse = deriveDecisionContext({ ...base, presentationItemIds: [shrimpRoll.id], transcript: '有賣什麼' })
    expect(resolveIntent(browse.candidates.find(candidate => candidate.intent === 'SEARCH_MENU')!, browse)).toMatchObject({ kind: 'PLAN', plan: { slots: { scope: 'all' } } })
    const question = { questionId: 'Q1', purpose: 'fulfillment' as const, phase: 'ordering' as const, choices: [], question: '內用還是自取？', expiresAt: 100, expectedRevisions: { cart: 0 } }
    expect(questionIsCurrent(question, base.revisions, 99)).toBe(true)
    expect(questionIsCurrent(question, base.revisions, 100)).toBe(false)
    expect(questionIsCurrent(question, { ...base.revisions, cart: 1 }, 99)).toBe(false)
  })
  it('bounds a full menu to semantic intents and resolves a specific alias before its category', () => {
    const menu = [
      { ...shrimpRoll, id: 'signature', name: '蝦捲招牌便當', aliases: ['招牌便當'], category: '便當' },
      ...Array.from({ length: 25 }, (_, index) => ({ ...shrimpRoll, id: `bento-${index}`, name: `便當${index}`, category: '便當' })),
    ]
    const context = deriveDecisionContext({ ...base, menu, transcript: '我想要吃招牌便當' })
    expect(context.phase).toBe('ordering')
    expect(context.candidates.length).toBeLessThan(15)
    expect(context.references).toEqual([{ label: '蝦捲招牌便當', refId: 'item:signature' }])
    const add = context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!
    expect(resolveIntent(add, context)).toMatchObject({ kind: 'CONFIGURATION', plan: { targetRef: 'item:signature' } })
    const inferred = deriveDecisionContext({ ...base, menu: menu.map(item => ({ ...item, aliases: [] })), transcript: '招牌便當有嗎' })
    expect(inferred.productResolution).toMatchObject({ status: 'possible', references: [{ label: '蝦捲招牌便當', refId: 'item:signature' }] })
    expect(inferred.targetConstraints.itemIds).toEqual([])
  })

  it('does not turn a generic hunger or background utterance into a menu operation', () => {
    for (const transcript of ['我好餓', '走走走 去那邊']) {
      const context = deriveDecisionContext({ ...base, transcript })
      expect(context.references).toEqual([])
      expect(context.candidates.map(candidate => candidate.intent)).toEqual(['SEARCH_MENU', 'RECOMMEND'])
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
    expect(context.references).toEqual([{ label: '麵食分類', refId: expect.stringContaining('category:') }, { label: '蝦捲', refId: 'item:shrimp-roll' }])
    const search = context.candidates.find(candidate => candidate.intent === 'SEARCH_MENU')!
    const resolution = resolveIntent(search, context)
    if (resolution.kind !== 'PLAN')
      throw new Error('Expected category search plan.')
    expect(compileOperationPlan(resolution.plan).input).toEqual({ category: '麵食' })
  })

  it('clarifies a new category purchase instead of binding the previously displayed dish', () => {
    const menu = [
      { ...shrimpRoll, id: 'noodle', name: '牛肉麵', category: '麵食' },
      { ...shrimpRoll, id: 'bento-a', name: '雞腿便當', category: '便當' },
      { ...shrimpRoll, id: 'bento-b', name: '排骨便當', category: '便當' },
    ]
    const context = deriveDecisionContext({ ...base, menu, presentationItemIds: ['noodle'], transcript: '我要兩份便當' })
    const add = context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!
    expect(resolveIntent(add, context)).toMatchObject({ kind: 'CLARIFICATION', intent: 'ADD_ITEM', candidateRefs: ['item:bento-a', 'item:bento-b'] })
    expect(context.references.some(reference => reference.refId === 'item:noodle')).toBe(false)
    expect(context.referenceOrigins['item:bento-a']).toBe('category')
    expect(resolveIntent(add, context, 'item:bento-a')).toMatchObject({ kind: 'PLAN', plan: { targetRef: 'item:bento-a' } })
    expect(resolveIntent(add, context, 'item:noodle')).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
  })

  it('rejects an incompatible selected target instead of relaxing verified ingredient constraints', () => {
    const menu: MenuItem[] = [{ ...shrimpRoll, composition: { complete: true, ingredients: ['shrimp'], removals: [], source: 'merchant', revision: '1' } }]
    const context = deriveDecisionContext({ ...base, menu, selectedItem: { itemId: shrimpRoll.id, options: {}, quantity: 1 }, ingredientFilters: { excludeIngredients: ['shrimp'], includeIngredients: [] }, transcript: '再一份' })
    expect(resolveIntent(context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!, context)).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
  })

  it('rejects stale selected and cart targets outside the newly named category', () => {
    const menu = [{ ...shrimpRoll, category: '點心' }, { ...shrimpRoll, id: 'bento', name: '雞腿便當', category: '便當' }]
    const cart = { ...base.cart, lines: [{ id: 'L1', itemId: shrimpRoll.id, name: shrimpRoll.name, options: {}, quantity: 1, unitPrice: 75 }], itemCount: 1, total: 75 }
    const context = deriveDecisionContext({ ...base, menu, cart, selectedItem: { itemId: shrimpRoll.id, options: {}, quantity: 1 }, transcript: '便當改兩份' })
    const resolution = resolveIntent(context.candidates.find(candidate => candidate.intent === 'SET_QUANTITY')!, context)
    expect(resolution).toMatchObject({ kind: 'NEEDS_ASSISTANT', targetResolution: { eligible: [], rejected: [{ refId: 'selected:shrimp-roll', reason: 'CATEGORY_MISMATCH' }, { refId: 'cart:L1', reason: 'CATEGORY_MISMATCH' }] } })
  })

  it('lets a specific new item override presentation and selection history', () => {
    const menu = [shrimpRoll, { ...shrimpRoll, id: 'bento', name: '雞腿便當', category: '便當' }]
    const context = deriveDecisionContext({ ...base, menu, presentationItemIds: [shrimpRoll.id], selectedItem: { itemId: shrimpRoll.id, options: {}, quantity: 1 }, transcript: '我要雞腿便當' })
    expect(resolveIntent(context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!, context)).toMatchObject({ kind: 'CONFIGURATION', plan: { targetRef: 'item:bento' } })
  })

  it('keeps multiple presentation targets ambiguous instead of ranking one into a purchase', () => {
    const menu = [shrimpRoll, { ...shrimpRoll, id: 'bento', name: '雞腿便當', category: '便當' }]
    const context = deriveDecisionContext({ ...base, menu, presentationItemIds: menu.map(item => item.id), transcript: '這個一份' })
    expect(resolveIntent(context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!, context)).toMatchObject({ kind: 'CLARIFICATION', candidateRefs: ['item:shrimp-roll', 'item:bento'] })
  })

  it('browses the sole real category match instead of ordering a conflicting continuation item', () => {
    const menu = [shrimpRoll, { ...shrimpRoll, id: 'bento', name: '雞腿便當', category: '便當' }]
    const context = deriveDecisionContext({ ...base, menu, previousTranscript: '蝦捲', transcript: '我想吃便當' })
    expect(context.candidates.some(candidate => candidate.intent === 'ADD_ITEM')).toBe(false)
    expect(resolveIntent(context.candidates.find(candidate => candidate.intent === 'SEARCH_MENU')!, context)).toMatchObject({ kind: 'PLAN', plan: { slots: { category: '便當' } } })
  })

  it('does not interpret missing composition as satisfying a verified food exclusion', () => {
    const context = deriveDecisionContext({ ...base, presentationItemIds: [shrimpRoll.id], ingredientFilters: { excludeIngredients: ['pork'], includeIngredients: [] }, transcript: '這個一份' })
    expect(resolveIntent(context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!, context)).toMatchObject({ kind: 'NEEDS_ASSISTANT', targetResolution: { constraints: { exclude: ['pork'] }, rejected: [{ refId: 'item:shrimp-roll', reason: 'UNVERIFIED_OR_CONFLICTING_COMPOSITION' }] } })
  })

  it('preserves two separately named items instead of silently choosing the longer name', () => {
    const context = deriveDecisionContext({
      ...base,
      menu: [shrimpRoll, { ...shrimpRoll, id: 'beef-noodle', name: '牛肉麵' }],
      transcript: '我要蝦捲和牛肉麵',
    })
    expect(context.references.map(reference => reference.refId)).toEqual(['item:shrimp-roll', 'item:beef-noodle'])
    const add = context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!
    expect(resolveIntent(add, context)).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
    expect(resolveIntent(add, context, 'item:shrimp-roll')).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
  })

  it('still clarifies one merchant alias shared by two dishes rather than treating it as two requests', () => {
    const menu = [
      { ...shrimpRoll, aliases: ['招牌餐'] },
      { ...shrimpRoll, id: 'beef-noodle', name: '牛肉麵', aliases: ['招牌餐'] },
    ]
    const context = deriveDecisionContext({ ...base, menu, transcript: '招牌餐一份' })
    const add = context.candidates.find(candidate => candidate.intent === 'ADD_ITEM')!
    expect(resolveIntent(add, context)).toMatchObject({ kind: 'CLARIFICATION', candidateRefs: ['item:shrimp-roll', 'item:beef-noodle'] })
    expect(resolveIntent(add, context, 'item:beef-noodle')).toMatchObject({ kind: 'PLAN', plan: { targetRef: 'item:beef-noodle', slots: { quantity: 1 } } })
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
    expect(resolveClarificationReference('有第一筆嗎？', references)).toBeUndefined()
    expect(resolveClarificationReference('第二筆不要了', references)).toBeUndefined()
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

  it('retains dietary exclusion as a finite ingredient slot, even when no dish matches', () => {
    const context = deriveDecisionContext({ ...base, transcript: '我不要豬肉', ingredientFilters: { excludeIngredients: ['pork'], includeIngredients: [] } })
    const decision = context.candidates.find(candidate => candidate.id === 'intent:recommend')!
    const resolution = resolveIntent(decision, context)

    if (resolution.kind !== 'PLAN')
      throw new Error('Expected a recommendation plan.')
    expect(compileOperationPlan(resolution.plan)).toMatchObject({
      input: { excludeIngredients: ['pork'] },
      toolName: 'menu_recommend',
    })
    const unsupported = deriveDecisionContext({ ...base, transcript: '我不要豬肉', ingredientFilters: { excludeIngredients: ['pork'], includeIngredients: [] } })
    expect(resolveIntent(unsupported.candidates.find(candidate => candidate.intent === 'RECOMMEND')!, unsupported)).toMatchObject({ kind: 'PLAN', plan: { slots: { excludeIngredients: '["pork"]' } } })
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
    expect(validateConfirmation(confirmation, { action: 'CANCEL_CHECKOUT', cartRevision: 3, now: 2_000 })).toEqual({ kind: 'INVALID', reason: 'MISMATCH' })
    expect(validateConfirmation({ ...confirmation, consumedAt: 2_000 }, { cartRevision: 3, now: 2_001 })).toEqual({ kind: 'INVALID', reason: 'CONSUMED' })

    const payment = deriveDecisionContext({ ...base, checkout: { stage: 'payment' } })
    const paymentDecision = payment.candidates.find(candidate => candidate.id === 'intent:select-payment:card')!
    const paymentResult = resolveIntent(paymentDecision, payment)
    if (paymentResult.kind !== 'PLAN')
      throw new Error('Expected payment plan.')
    expect(authorize(compileOperationPlan(paymentResult.plan), payment)).toEqual({ kind: 'EXECUTE' })
    expect(deriveDecisionContext({ ...base, checkout: { stage: 'payment' }, paymentStatus: 'pending' }).candidates.some(candidate => candidate.intent === 'SELECT_PAYMENT')).toBe(false)
  })
})

// Plan: Nov1 common intent handoff. Eligibility moved out of Server into Menu.
it('never issues new-meal recovery for entry, payment, category-only or multiple targets', () => {
  expect(intentRecovery(deriveDecisionContext({ ...base, transcript: '我要蝦捲', customerEntryPending: true }))).toBeUndefined()
  expect(intentRecovery(deriveDecisionContext({ ...base, transcript: '我要蝦捲', checkout: { stage: 'payment' }, paymentMethods: ['linepay'] }))).toBeUndefined()
  expect(intentRecovery(deriveDecisionContext({ ...base, transcript: '我要小吃' }))).toBeUndefined()
  expect(intentRecovery(deriveDecisionContext({ ...base, menu: [shrimpRoll, { ...shrimpRoll, id: 'other', name: '水餃' }], transcript: '蝦捲和水餃' }))).toBeUndefined()
})

it('keeps new meal recovery independent of an unanswered fulfillment question', () => {
  const waitingFor = { questionId: 'fulfillment', phase: 'ordering' as const, purpose: 'fulfillment' as const, question: '內用還是自取？', choices: [], expectedRevisions: { cart: 0 }, expiresAt: Date.now() + 30000 }
  const context = deriveDecisionContext({ ...base, transcript: '我要蝦捲一份', waitingFor })
  const scope = intentRecovery(context)
  expect(scope?.kind).toBe('request')
  expect(scope?.candidateIds).toContain('intent:add-item')
  expect(scope).not.toHaveProperty('questionId')
})
