import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'

describe('kiosk System One interaction decision', () => {
  const policy = { decisionInstruction: '', storeInstruction: '' }
  const candidates = [
    { description: 'Add one shrimp roll.', id: 'order:add:shrimp' },
    { description: 'Set the order to take out.', id: 'fulfillment:takeout' },
  ]

  it('accepts only an action ID from the finite browser-provided candidate set', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'order:add:shrimp', confidence: 0.94 } } }))

    await expect(decideInteraction({ candidates, invoke, policy, presenceState: 'ENGAGED', transcript: '我要一份蝦捲' })).resolves.toEqual({
      actionId: 'order:add:shrimp',
      confidence: 0.94,
      kind: 'FAST_ACTION',
    })
    expect(invoke).toHaveBeenCalledWith(
      expect.stringContaining('顧客語音：我要一份蝦捲'),
      expect.objectContaining({
        route: expect.objectContaining({
          criteria: expect.objectContaining({ 'order:add:shrimp': 'Add one shrimp roll.', 'IGNORE': expect.any(String) }),
          instructions: expect.stringContaining('不得因菜單上有招牌餐點而猜測顧客要點它'),
          type: 'choice',
        }),
      }),
    )
  })

  it('treats an available category lookup as a fast action, not an assistant request', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'intent:search-menu:category:0' } } }))

    await decideInteraction({
      candidates: [{ description: '查詢「便當」分類。', id: 'intent:search-menu:category:0' }],
      invoke,
      policy,
      transcript: '便當有嗎',
    })

    expect(invoke).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      route: expect.objectContaining({
        instructions: expect.stringContaining('SEARCH_MENU：找、查詢、確認是否存在、瀏覽餐點或分類'),
      }),
    }))
  })

  it('provides the visible checkout step without exposing scanned codes in the model state', async () => {
    let sentState = ''
    const invoke = vi.fn(async (state: string) => {
      sentState = state
      return { answers: { route: { choice: 'intent:confirm-tax-id' } } }
    })
    await decideInteraction({
      candidates: [{ description: '確認畫面上的統編。', id: 'intent:confirm-tax-id' }],
      decisionState: { checkoutSnapshot: { carrierCode: '/SECRET', invoiceMethod: 'tax-id', stage: 'tax-id', taxId: '12345678' }, paymentState: 'idle', phase: 'checkout_tax_id' },
      invoke,
      policy,
      transcript: '對',
    })

    expect(sentState).toContain('結帳畫面摘要：{"stage":"tax-id","invoiceMethod":"tax-id","hasCarrier":true,"hasTaxId":true}')
    expect(sentState).not.toContain('/SECRET')
    expect(sentState).not.toContain('12345678')
  })

  it('uses the benchmark contrastive intent boundary instead of inferring semantics from action names', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'intent:add-item:dumplings' } } }))

    await decideInteraction({
      candidates: [
        { description: '搜尋「水餃」。', id: 'intent:search-menu:dumplings' },
        { description: '選取「水餃」以編輯。', id: 'intent:select-item:dumplings' },
        { description: '新增兩份「水餃」。', id: 'intent:add-item:dumplings' },
        { description: '將目前目標改為兩份。', id: 'intent:set-quantity:current:2' },
      ],
      invoke,
      policy: { decisionInstruction: '', storeInstruction: '「鍋貼」是水餃的別名。' },
      transcript: '我要兩份水餃',
    })

    expect(invoke).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      route: expect.objectContaining({
        instructions: expect.stringContaining('「我要兩份水餃」、「幫我加兩份水餃」是 ADD_ITEM；「水餃改兩份」才是 SET_QUANTITY'),
      }),
    }))
  })

  it('treats a customer saying they want to eat an identified item as an order', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'intent:add-item:dumplings' } } }))

    await expect(decideInteraction({
      candidates: [
        { description: '選擇「水餃」以設定餐點。', id: 'intent:select-item:dumplings' },
        { description: '以預設選項加入一份「水餃」。', id: 'intent:add-item:dumplings' },
      ],
      invoke,
      policy,
      transcript: '我想吃水餃',
    })).resolves.toEqual({ actionId: 'intent:add-item:dumplings', kind: 'FAST_ACTION' })

    expect(invoke).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      route: expect.objectContaining({
        instructions: expect.stringContaining('「想吃水餃」或「想要水餃」在商品唯一可辨識時也選 ADD_ITEM'),
      }),
    }))
  })

  it('does not discard an unmatched food request as background speech', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'NEEDS_ASSISTANT' } } }))

    await decideInteraction({
      candidates: [{ description: '推薦不含豬肉的餐點。', id: 'intent:recommend:pork-free' }],
      invoke,
      policy,
      transcript: '我要豬肉',
    })

    expect(invoke).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      route: expect.objectContaining({
        instructions: expect.stringContaining('顧客表達餐點、食材或飲食偏好，但目前候選無法安全直接完成時，選 NEEDS_ASSISTANT，不是 IGNORE'),
      }),
    }))
  })

  it('rejects an unbounded candidate list instead of silently dropping a valid action', async () => {
    const candidates = [
      { description: 'First action.', id: 'intent:first' },
      { description: 'Second action.', id: 'intent:second' },
    ]
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'intent:second' } } }))

    await expect(decideInteraction({ candidates, invoke, maxActionCandidates: 1, policy, transcript: '第二個' })).resolves.toEqual({ kind: 'UNAVAILABLE' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('never uses lexical sorting to rescue menu-times-intent candidate expansion', async () => {
    const candidates = [
      { description: '查詢「周氏蝦捲招牌便當」分類。', id: 'intent:search-menu:shrimp' },
      { description: '查詢「椒麻雞便當」分類。', id: 'intent:search-menu:chicken' },
      { description: '查詢「牛肉麵」分類。', id: 'intent:search-menu:beef-noodles' },
    ]
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'intent:search-menu:beef-noodles' } } }))

    await expect(decideInteraction({ candidates, invoke, maxActionCandidates: 1, policy, transcript: '牛肉麵有什麼' })).resolves.toEqual({ kind: 'UNAVAILABLE' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not convert unexpected model output into an action', async () => {
    await expect(decideInteraction({
      candidates,
      invoke: async () => ({ answers: { route: { choice: 'checkout:pay-now' } } }),
      policy,
      transcript: '幫我直接結帳',
    })).resolves.toEqual({ kind: 'UNAVAILABLE' })
  })

  it('keeps an unfinished ordering utterance out of both WebMCP and the Main Agent', async () => {
    await expect(decideInteraction({
      candidates,
      invoke: async () => ({ answers: { route: { choice: 'INCOMPLETE' } } }),
      policy,
      transcript: '我要一份',
    })).resolves.toEqual({ kind: 'INCOMPLETE' })
  })

  it('does not offer a model-generated clarification outcome', async () => {
    await expect(decideInteraction({
      candidates,
      invoke: async () => ({ answers: { route: { choice: 'CLARIFICATION' } } }),
      policy,
      transcript: '幫我改成兩份',
    })).resolves.toEqual({ kind: 'UNAVAILABLE' })
  })

  it('replays the payment choice with an explicit phase and retains the raw answer in a trace', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'intent:select-payment:card', confidence: 0.89, probabilities: { 'intent:select-payment:card': 0.89 } } } }))
    const result = await decideInteraction({
      candidates: [
        { id: 'intent:select-payment:card', description: '使用信用卡付款。' },
        { id: 'intent:select-payment:mobile', description: '使用行動支付付款。' },
      ],
      decisionState: { allowedPaymentMethods: ['card', 'mobile'], checkoutSnapshot: { stage: 'payment' }, paymentState: 'idle', phase: 'checkout_payment_select', references: [] },
      includeTrace: true,
      invoke,
      policy,
      transcript: '信用卡',
    })
    expect(invoke).toHaveBeenCalledWith(expect.stringContaining('目前 phase：checkout_payment_select'), expect.any(Object))
    expect(result).toMatchObject({ actionId: 'intent:select-payment:card', kind: 'FAST_ACTION', trace: { rawAnswer: { choice: 'intent:select-payment:card', confidence: 0.89 } } })
  })

  it('does not send an untrusted low-confidence choice to Main Agent', async () => {
    const result = await decideInteraction({
      candidates: [{ description: '新增餐點。', id: 'intent:add-item', requiresHighConfidence: true }],
      decisionState: { phase: 'ordering' },
      includeTrace: true,
      invoke: async () => ({ answers: { route: { choice: 'intent:add-item', confidence: 0.39 } } }),
      policy,
      transcript: '我想要吃招牌便當',
    })
    expect(result).toMatchObject({ kind: 'UNAVAILABLE', trace: { rawAnswer: { choice: 'intent:add-item' } } })
  })

  it('offers one bounded follow-up choice while Main Agent is handling an earlier utterance', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'FOLLOW_UP_ACTIVE', confidence: 0.91 } } }))
    await expect(decideInteraction({
      candidates: [{ description: '修改目前餐點選項。', id: 'intent:set-option' }],
      decisionState: { activeRequest: { text: '我要招牌便當', stage: 'thinking' }, phase: 'ordering' },
      invoke,
      policy,
      transcript: '不要辣',
    })).resolves.toEqual({ confidence: 0.91, kind: 'FOLLOW_UP_ACTIVE' })
    expect(invoke).toHaveBeenCalledWith(expect.stringContaining('我要招牌便當'), expect.objectContaining({
      route: expect.objectContaining({ criteria: expect.objectContaining({ FOLLOW_UP_ACTIVE: expect.any(String) }) }),
    }))
  })

  it('uses a target-only question for an active clarification, not the full intent prompt', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'clarify:1' } } }))
    await expect(decideInteraction({
      candidates: [{ description: '購物車第1筆水餃。', id: 'clarify:0' }, { description: '購物車第2筆水餃。', id: 'clarify:1' }],
      decisionState: { interactionState: { matchingCartLines: 2, pendingIntent: 'REMOVE_ITEM' }, phase: 'clarification', references: [{ label: '購物車第1筆水餃', refId: 'cart:L1' }, { label: '購物車第2筆水餃', refId: 'cart:L2' }] },
      invoke,
      policy,
      transcript: '第二筆',
    })).resolves.toEqual({ actionId: 'clarify:1', kind: 'FAST_ACTION' })
    expect(invoke).toHaveBeenCalledWith(expect.stringContaining('目前 phase：clarification'), expect.objectContaining({
      route: expect.objectContaining({ criteria: expect.not.objectContaining({ INCOMPLETE: expect.any(String) }), instructions: expect.stringContaining('只能從列出的真實 target 候選中選擇') }),
    }))
  })

  it('preserves the explicit assistant route without invoking another model', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'NEEDS_ASSISTANT', confidence: 0.71 } } }))
    await expect(decideInteraction({
      candidates,
      invoke,
      policy: { decisionInstruction: '', storeInstruction: '顧客說套餐時先開啟套餐分類。' },
      transcript: '幫我挑兩個人吃、不要辣又沒有豬肉的搭配',
    })).resolves.toEqual({ confidence: 0.71, kind: 'NEEDS_ASSISTANT' })
    expect(invoke).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      route: expect.objectContaining({ instructions: expect.stringContaining('顧客說套餐時先開啟套餐分類。') }),
    }))
  })

  it('routes a multi-operation utterance to the Main Agent in the same bounded decision', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'MULTI_ACTION', confidence: 0.82 } } }))
    await expect(decideInteraction({
      candidates,
      includeTrace: true,
      invoke,
      policy,
      transcript: '幫我加一份蝦捲，然後改外帶',
    })).resolves.toMatchObject({ kind: 'NEEDS_ASSISTANT', trace: { rawAnswer: { choice: 'MULTI_ACTION' } } })
    expect(invoke).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      route: expect.objectContaining({ criteria: expect.objectContaining({ MULTI_ACTION: expect.any(String) }) }),
    }))
  })
})
