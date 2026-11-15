import { describe, expect, it } from 'vitest'

import { compactToolResultForModel, createInteractionInstructions, defaultKioskAgentInteractionState, hasMenuReply, queryClarification, recordCustomerInput, recordToolResults, requiresPresentedReply, selectBoundedConversationText } from '.'

// Report: this chat, Nov12; ok:true/proposal_rejected and overloaded choices confuse the planner.
it('gives Main one actionable outcome without leaking Host diagnostics or confirmation authority', () => {
  const receipt = { ok: true, source: 'browser', status: 'clarification', effect: 'none', pendingCustomerChoice: { questionId: 'private', expiresAt: 123, purpose: 'browser-confirm-add', question: '要加入嗎？', choices: [{ id: 'confirm', description: '確認' }] }, semanticDecision: { checks: ['private check'] }, execution: { operationId: 'private-operation' }, customerMessage: '要加入嗎？' }
  const result = JSON.parse(compactToolResultForModel('browser_order_draft', JSON.stringify(receipt)))
  expect(result.outcome).toBe('awaiting_customer_answer')
  expect(result.cartEffect).toBe('none')
  expect(result.currentQuestion).toEqual({ question: '要加入嗎？', answerOptions: [{ id: 'confirm', description: '確認' }] })
  expect(result).not.toHaveProperty('ok')
  expect(result).not.toHaveProperty('status')
  expect(result).not.toHaveProperty('source')
  expect(result).not.toHaveProperty('execution')
  expect(JSON.stringify(result)).not.toContain('private')
  const rejected = JSON.parse(compactToolResultForModel('browser_cart_add', JSON.stringify({ ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', explanation: '份數未知，請先詢問' })))
  expect(rejected.outcome).toBe('proposal_needs_correction')
  expect(rejected.reason).toBe('份數未知，請先詢問')
})

it('retains partial and unknown cart effects without presenting them as success or an empty cart', () => {
  const partial = JSON.parse(compactToolResultForModel('browser_confirm_add', JSON.stringify({ ok: false, source: 'browser', status: 'rejected', effect: 'partial', customerMessage: '已加入一項，其餘未完成。' })))
  expect(partial.outcome).toBe('action_result_requires_review')
  expect(partial.cartEffect).toBe('partial')
  expect(partial.customerMessage).toBe('已加入一項，其餘未完成。')
  expect(partial).not.toHaveProperty('cart')
  const unknown = JSON.parse(compactToolResultForModel('browser_cart_add', JSON.stringify({ ok: false, source: 'browser', status: 'unknown' })))
  expect(unknown.outcome).toBe('action_result_requires_review')
  expect(unknown.cartEffect).toBe('unknown')
  const host = JSON.parse(compactToolResultForModel('browser_respond', JSON.stringify({ ok: false, source: 'host', status: 'rejected', effect: 'none' })))
  expect(host.outcome).toBe('action_blocked')
  expect(host.cartEffect).toBe('none')
  expect(host).not.toHaveProperty('status')
})

// Report: this chat, 2026-10-30; daily catalog growth must not prune PB configuration versions or cart references.
it('preserves complete Host question context when a large PB catalog is compacted', () => {
  const confirmedAddition = { productRef: 'new', productName: '每日新品', quantity: 1, unitPrice: 20, note: '', selection: { version: 'configuration', variantRef: '', choices: [] } }
  const payload = { source: 'browser', dataOnly: true, cart: { version: 'cart', lines: [] }, requestedQuantity: 1, confirmedAddition, selectedProduct: { productRef: 'new', name: '每日新品' }, explanation: '只允許確認的完整設定', products: Array.from({ length: 30 }, (_, index) => ({ ref: `p-${index}`, name: `每日品項${index}`, price: index, configurations: [{ description: '規格'.repeat(1000) }] })) }
  const result = JSON.parse(compactToolResultForModel('browser_cart_get', JSON.stringify(payload), undefined))
  expect(result.additionConfirmed).toBe(true)
  expect(result).not.toHaveProperty('confirmedAddition')
  expect(result.requestedQuantity).toBe(1)
  expect(result.selectedItem).toEqual(payload.selectedProduct)
  expect(result.reason).toBe(payload.explanation)
  expect(result.products[0].customizationAvailability).toBe('not_verified')
  expect(JSON.stringify(result)).not.toContain('規格規格')
})

it('preserves PB cart identities and the whole product index when the current catalog requires configuration lookup', () => {
  const products = Array.from({ length: 30 }, (_, index) => ({ ref: `p-${index}`, name: `每日餐點${index}`, price: 20 + index, priceType: 1, configurations: [{ version: `configuration-${index}`, variantRef: '', groups: Array.from({ length: 4 }, (_, group) => ({ name: `選項群組${group}`, choices: Array.from({ length: 8 }, (_, choice) => ({ ref: `a-${group}-${choice}`, name: `可選配餐${choice}`, unitPrice: 5, maximum: 1 })) })) }] }))
  const cart = { version: 'observed-cart', subtotal: 30, lines: [{ ref: 'first-line', productRef: 'existing', name: '同名餐', description: '小份', quantity: 1, unitPrice: 10 }, { ref: 'second-line', productRef: 'existing', name: '同名餐', description: '大份', quantity: 2, unitPrice: 10 }] }
  const result = JSON.parse(compactToolResultForModel('browser_cart_get', JSON.stringify({ source: 'browser', ok: true, dataOnly: true, cart, products })))
  expect(result.cart.version).toBe('observed-cart')
  expect(result.cart.lines.map((line: { ref: string }) => line.ref)).toEqual(['first-line', 'second-line'])
  expect(result.products.map((product: { ref: string }) => product.ref)).toEqual(products.map(product => product.ref))
  expect(result.configurationLookupRequired).toBe(true)
  expect(result.products[0]).not.toHaveProperty('configurations')
  expect(result.products[0]).not.toHaveProperty('orderSpecifications')
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(8_000)
})

it('never applies owned Menu cart compaction to a browser receipt with leftover Menu catalog context', () => {
  const result = JSON.parse(compactToolResultForModel('browser_cart_get', JSON.stringify({ ok: true, source: 'browser', cart: { version: 'pb-cart', lines: [{ ref: 'pb-line' }] } }), new Set(['owned-menu-item'])))
  expect(result.cart.version).toBe('pb-cart')
  expect(result.cart.lines).toEqual([{ ref: 'pb-line' }])
})

it('keeps read presentation while removing repeated complete catalog details', () => {
  const original = JSON.stringify({ catalog: { items: [{ id: 'dish', name: '水餃' }] }, categories: ['主食'], ingredientDefinitions: [{ id: 'pork' }], items: [{ id: 'dish', name: '水餃', description: '長介紹' }], possibleItems: [{ id: 'dish', name: '水餃' }], presentation: { itemIds: ['dish'] }, matchKind: 'possible' })
  const compacted = JSON.parse(compactToolResultForModel('menu_get', original, new Set(['dish'])))
  expect(compacted.items).toEqual([{ id: 'dish' }])
  expect(compacted.possibleItems).toEqual([{ id: 'dish' }])
  expect(compacted.presentation).toEqual({ itemIds: ['dish'] })
  expect(compacted.matchKind).toBe('possible')
  expect(compacted).not.toHaveProperty('catalog')
  expect(compacted).not.toHaveProperty('ingredientDefinitions')
  expect(JSON.parse(original).items[0].name).toBe('水餃')
})

it('retains accepted line outcomes without repeating an older full cart snapshot', () => {
  const content = JSON.stringify({ cart: { lines: [{ id: 'old-line' }], total: 100 }, selection: { itemId: 'dish' }, line: { id: 'new-line', itemId: 'dish', quantity: 1 }, customerMessage: '已加入餐點。' })
  const compacted = JSON.parse(compactToolResultForModel('order_add_item', content, new Set(['dish'])))
  expect(compacted.line).toEqual({ id: 'new-line', itemId: 'dish', quantity: 1 })
  expect(compacted.customerMessage).toBe('已加入餐點。')
  expect(compacted).not.toHaveProperty('cart')
  expect(compacted).not.toHaveProperty('selection')
  expect(JSON.parse(compactToolResultForModel('cart_get', content))).toHaveProperty('cart')
})

// Report: this chat, query-action voice clarification, 2026-10-19.
it('settles only a single non-presenting query clarification receipt', () => {
  const payload = { queryAction: 'clarify', items: [], customerMessage: '你想調整價位，還是換餐點種類？' }
  expect(queryClarification([{ name: 'menu_recommend', content: JSON.stringify(payload) }])).toBe(payload.customerMessage)
  expect(queryClarification([{ name: 'menu_get', content: JSON.stringify(payload) }])).toBeUndefined()
  expect(queryClarification([{ name: 'menu_recommend', content: JSON.stringify({ ...payload, items: [{ id: 'dish' }] }) }])).toBeUndefined()
  expect(queryClarification([{ name: 'menu_recommend', content: JSON.stringify({ ...payload, presentation: { itemIds: [] } }) }])).toBeUndefined()
  expect(queryClarification([{ name: 'menu_recommend', content: 'not JSON' }])).toBeUndefined()
  expect(queryClarification([{ name: 'menu_recommend', content: JSON.stringify(payload) }, { name: 'order_add_item', content: '{}' }])).toBeUndefined()
})

it('isolates checkout language from earlier ordering chat without altering the durable entries', () => {
  const entries = [
    { kind: 'user_text' as const, content: '剛才聊的故事' },
    { kind: 'assistant_text' as const, content: '先前推薦的餐點' },
    { kind: 'user_text' as const, content: '我要街口支付' },
  ]
  expect(selectBoundedConversationText(entries, 'checkout')).toEqual([{ role: 'user', content: '我要街口支付' }])
  expect(entries).toHaveLength(3)
})

describe('kiosk Agent interaction', () => {
  // Report: this chat, 2026-10-20; live retraction replay read an empty cart
  // and falsely said the dumplings had been removed.
  it('distinguishes reading an empty cart from successfully removing an order', () => {
    const instructions = createInteractionInstructions(defaultKioskAgentInteractionState)
    expect(instructions).toContain('cart_get 是唯讀查詢')
    expect(instructions).toContain('只有本輪成功的修改工具回執')
    expect(instructions).toContain('購物車為空只代表目前沒有餐點')
  })

  // Report: this chat, 2026-10-20; session pNjTf7VrgOG7-0Gxp7lRZ, entries 19–26.
  it('routes category presentation through an explicit query update before any tool rejection', () => {
    const instructions = createInteractionInstructions(defaultKioskAgentInteractionState)
    expect(instructions).toContain('分類瀏覽不是具體品名查證')
    expect(instructions).toContain('menu_recommend({action:"update",category:')
    expect(instructions).toContain('menu_get 的 category 只限 display:false')
  })

  it('waits for the customer after repeated reads without redirecting speech to touch', () => {
    const instructions = createInteractionInstructions({ ...defaultKioskAgentInteractionState, mode: 'touch_preferred', noProgressCount: 3 })
    expect(instructions).toContain('等待顧客')
    expect(instructions).toContain('語音')
    expect(instructions).not.toContain('畫面點選目前優先')
    expect(instructions).not.toContain('優先引導他直接使用畫面')
  })
  it('keeps competing model operation prose out of customer history but retains general answers', () => {
    expect(requiresPresentedReply([{ name: 'order_ask_question', content: JSON.stringify({ pendingCustomerChoice: { questionId: 'Q1' } }) }])).toBe(true)
    expect(requiresPresentedReply([{ name: 'checkout_select_payment', content: JSON.stringify({ customerMessage: '付款尚未完成。' }) }])).toBe(true)
    expect(requiresPresentedReply([{ name: 'menu_get', content: JSON.stringify({ customerMessage: '找到水餃。' }) }])).toBe(true)
    expect(requiresPresentedReply([{ name: 'menu_get', content: JSON.stringify({ items: [], availability: 'NONE' }) }])).toBe(true)
    expect(requiresPresentedReply([{ name: 'order_add_item', content: 'invalid tool result' }])).toBe(true)
    expect(requiresPresentedReply([])).toBe(false)
    expect(requiresPresentedReply([{ name: 'kiosk_session_history', content: 'older dialogue' }])).toBe(false)
  })
  it('keeps environment metadata out of model dialogue while preserving uncertain payment status', () => {
    const original = JSON.stringify({ environment: 'test', receipt: { environment: 'test', status: 'uncertain', customerMessage: '付款狀態尚未確認。' }, items: [{ id: 'dish', composition: { source: 'simulation', complete: true, ingredients: ['pork'], revision: '1' } }] })
    const modelContent = compactToolResultForModel('checkout_select_payment', original)
    expect(modelContent).not.toContain('simulation')
    expect(modelContent).not.toContain('environment')
    expect(JSON.parse(modelContent)).toMatchObject({ receipt: { status: 'uncertain', customerMessage: '付款狀態尚未確認。' }, items: [{ composition: { complete: true, ingredients: ['pork'] } }] })
    const instructions = createInteractionInstructions({ ...defaultKioskAgentInteractionState, cartSummary: { fulfillmentMode: 'takeout', itemCount: 0, lines: [], total: 0 } })
    expect(instructions).not.toContain('外帶')
    expect(instructions).toContain('takeout')
  })
  it('treats an alternative request as exploration and excludes the prior batch', () => {
    const shown = recordToolResults(defaultKioskAgentInteractionState, [{
      content: JSON.stringify({ presentation: { itemIds: ['shrimp-roll', 'minced-pork-rice'] } }),
      name: 'menu_show_recommendations',
    }])

    expect(recordCustomerInput(shown, '有沒有其他推薦的？')).toMatchObject({
      dismissedSubjectIds: ['shrimp-roll', 'minced-pork-rice'],
      recentUserIntent: 'request_alternatives',
      suggestedSubjectIds: [],
    })
  })

  it('records recommendations that the menu rendered as part of the recommendation tool', () => {
    const shown = recordToolResults(defaultKioskAgentInteractionState, [{
      content: JSON.stringify({ presentation: { itemIds: ['shrimp-roll', 'minced-pork-rice'] } }),
      name: 'menu_recommend',
    }])

    expect(shown).toMatchObject({
      recentAgentAction: { name: 'menu_recommend', subjectIds: ['shrimp-roll', 'minced-pork-rice'] },
      suggestedSubjectIds: ['shrimp-roll', 'minced-pork-rice'],
    })
  })

  it('retains every subject behind a compact multi-subject menu preview', () => {
    const shown = recordToolResults(defaultKioskAgentInteractionState, [{
      content: JSON.stringify({
        presentation: {
          itemIds: ['bento-1', 'beef-noodles', 'bento-2', 'bento-3'],
          subjects: [
            { id: 'query:便當', itemIds: ['bento-1', 'bento-2', 'bento-3', 'bento-4', 'bento-5'] },
            { id: 'query:麵', itemIds: ['beef-noodles'] },
          ],
        },
      }),
      name: 'menu_get',
    }])

    expect(shown.recentAgentAction).toMatchObject({
      name: 'menu_get',
      subjectIds: ['bento-1', 'beef-noodles', 'bento-2', 'bento-3', 'bento-4', 'bento-5'],
    })
  })

  it('keeps a compact menu and cart working state without copying the full tool payload', () => {
    const state = recordToolResults(defaultKioskAgentInteractionState, [{
      name: 'order_add_item',
      content: JSON.stringify({
        item: { id: 'beef-noodles', name: '牛肉麵', description: '不應進入工作狀態的完整介紹' },
        cart: {
          fulfillmentMode: 'takeout',
          itemCount: 2,
          lines: [{ id: 'line-1', itemId: 'beef-noodles', name: '牛肉麵', options: { spice: 'mild' }, quantity: 2, unitPrice: 150 }],
          total: 300,
        },
      }),
    }])

    expect(state).toMatchObject({
      cartSummary: {
        fulfillmentMode: 'takeout',
        itemCount: 2,
        lines: [{ itemId: 'beef-noodles', lineId: 'line-1', name: '牛肉麵', options: { spice: 'mild' }, quantity: 2 }],
        total: 300,
      },
      recentMenuSubjects: [{ id: 'beef-noodles', name: '牛肉麵' }],
    })
    const instructions = createInteractionInstructions(state)
    expect(instructions).toContain('牛肉麵（beef-noodles）')
    expect(instructions).toContain('lineId=line-1')
    expect(instructions).not.toContain('不應進入工作狀態的完整介紹')
  })

  it('does not treat an unfiltered catalog response as recent customer context', () => {
    const state = recordToolResults(defaultKioskAgentInteractionState, [{
      name: 'menu_get',
      content: JSON.stringify({ items: [
        { id: 'beef-noodles', name: '牛肉麵' },
        { id: 'dumplings', name: '水餃' },
      ] }),
    }])

    expect(state.recentMenuSubjects).toEqual([])
  })

  it('keeps recent conversation text within a total character budget', () => {
    const entries = Array.from({ length: 30 }, (_, index) => ({
      content: `${index}:`.padEnd(1_000, String(index % 10)),
      kind: index % 2 === 0 ? 'user_text' as const : 'assistant_text' as const,
    }))

    const messages = selectBoundedConversationText(entries)

    expect(messages.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(16_000)
    expect(messages.at(-1)?.content).toContain('29:')
    expect(messages.some(message => message.content.startsWith('0:'))).toBe(false)
  })

  it('compacts an oversized tool result for the model while retaining ordering identifiers', () => {
    const original = JSON.stringify({
      customerMessage: '我找到牛肉麵。',
      items: [{
        available: true,
        category: '麵食',
        composition: { complete: true, ingredients: ['beef', 'noodles'], dietaryLabels: [], revision: '1' },
        description: '完整介紹'.repeat(3_000),
        id: 'beef-noodles',
        name: '牛肉麵',
        optionGroups: [{ id: 'spice', label: '辣度', values: [{ id: 'mild', label: '小辣' }] }],
        price: 150,
      }],
      presentation: { itemIds: ['beef-noodles'], kind: 'query-results' },
    })

    const modelContent = compactToolResultForModel('menu_get', original)
    const payload = JSON.parse(modelContent)

    expect(modelContent.length).toBeLessThanOrEqual(8_000)
    expect(payload).toMatchObject({
      customerMessage: '我找到牛肉麵。',
      items: [{ id: 'beef-noodles', name: '牛肉麵', composition: { complete: true, ingredients: ['beef', 'noodles'], dietaryLabels: [] }, optionGroups: [{ id: 'spice' }] }],
      modelContextCompacted: true,
      originalCharacterCount: original.length,
      presentation: { itemIds: ['beef-noodles'] },
      toolName: 'menu_get',
    })
    expect(modelContent).not.toContain('完整介紹'.repeat(100))
  })

  it('enters decision guidance only after repeated unchanged rendered recommendations', () => {
    const shown = recordToolResults(defaultKioskAgentInteractionState, [{
      content: JSON.stringify({ presentation: { itemIds: ['shrimp-roll'] } }),
      name: 'menu_show_recommendations',
    }])
    const onceRepeated = recordToolResults(shown, [{
      content: JSON.stringify({ presentation: { itemIds: ['shrimp-roll'] } }),
      name: 'menu_show_recommendations',
    }])
    const twiceRepeated = recordToolResults(onceRepeated, [{
      content: JSON.stringify({ presentation: { itemIds: ['shrimp-roll'] } }),
      name: 'menu_show_recommendations',
    }])

    expect(onceRepeated.mode).toBe('active')
    expect(twiceRepeated.mode).toBe('decision_guidance')
    expect(createInteractionInstructions(twiceRepeated)).toContain('2 至 3 個')
  })

  it('returns to active exploration when the Agent actually presents unseen choices', () => {
    const stagnant = {
      ...defaultKioskAgentInteractionState,
      mode: 'decision_guidance' as const,
      noProgressCount: 2,
      suggestedSubjectIds: ['shrimp-roll'],
    }

    expect(recordToolResults(stagnant, [{
      content: JSON.stringify({ presentation: { itemIds: ['fish-floss-rice'] } }),
      name: 'menu_show_recommendations',
    }])).toMatchObject({ mode: 'active', noProgressCount: 0, suggestedSubjectIds: ['shrimp-roll', 'fish-floss-rice'] })
  })
})

// Report: this chat, 2026-10-21; phone-page menu lookup stopped after display:false.
it('requires a presented menu receipt rather than internal data or a failed lookup', () => {
  expect(hasMenuReply([{ name: 'menu_get', content: JSON.stringify({ dataOnly: true, items: [{ id: 'dumplings' }] }) }])).toBe(false)
  expect(hasMenuReply([{ name: 'menu_get', content: JSON.stringify({ ok: false, items: [] }) }])).toBe(false)
  expect(hasMenuReply([{ name: 'menu_get', content: 'invalid' }])).toBe(false)
  expect(hasMenuReply([{ name: 'cart_get', content: JSON.stringify({ items: [] }) }])).toBe(false)
  expect(hasMenuReply([{ name: 'menu_recommend', content: JSON.stringify({ items: [] }) }])).toBe(true)
  expect(hasMenuReply([{ name: 'menu_get', content: JSON.stringify({ items: [{ id: 'dumplings' }] }) }])).toBe(true)
})

it('projects public PB receipts without native references while retaining verified cart facts', () => {
  const receipt = JSON.parse(compactToolResultForModel('list_cart_items', JSON.stringify({ ok: true, source: 'browser', dataOnly: true, cart: { version: 'private-version', subtotal: 200, lines: [{ ref: 'private-line', productRef: 'private-product', name: '雞腿飯', quantity: 2, unitPrice: 100 }] } })))
  expect(receipt.cart).toMatchObject({ subtotal: 200, lines: [{ name: '雞腿飯', quantity: 2, unitPrice: 100 }] })
  expect(JSON.stringify(receipt)).not.toContain('private-')
})

// Report: this chat, Nov14 — compaction must not instruct Main to call a private native tool.
it('keeps oversized public menu receipts actionable with published names only', () => {
  const result = JSON.parse(compactToolResultForModel('list_menu_items', JSON.stringify({ ok: true, source: 'browser', dataOnly: true, products: Array.from({ length: 30 }, (_, index) => ({ name: `餐點${index}`, configurations: [{ version: `v${index}`, variantRef: '', groups: [{ name: '加料', choices: [{ name: '蛋'.repeat(500), quantity: 1 }] }] }] })) })))
  expect(result.configurationLookupRequired).toBe(true)
  expect(result.nextStep).toContain('get_menu_item_details')
  expect(JSON.stringify(result)).not.toContain('browser_product_get')
})

// Report: this chat; correction must survive the real model-result projection.
it('keeps current allowed tool names in an undispatched-call correction receipt', () => {
  const result = JSON.parse(compactToolResultForModel('browser_cart_get', JSON.stringify({ ok: false, source: 'host', status: 'proposal_rejected', effect: 'none', dataOnly: true, code: 'TOOL_NOT_AVAILABLE', availableTools: ['list_cart_items', 'reply_to_customer'] })))
  expect(result.outcome).toBe('proposal_needs_correction')
  expect(result.cartEffect).toBe('none')
  expect(result.availableTools).toEqual(['list_cart_items', 'reply_to_customer'])
  expect(result.reason).toContain('本次提供的工具名稱')
})
