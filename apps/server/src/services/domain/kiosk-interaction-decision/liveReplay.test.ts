import type { KioskDecisionTrace } from '.'
import type { SystemOneQuestion } from '../kiosk-system-one'

import { describe, expect, it } from 'vitest'

import { decideInteraction } from '.'
import { createDecisionStages } from './stages'

const replayUrl = process.env.KIOSK_SYSTEM_ONE_REPLAY_URL
const policy = { decisionInstruction: '', storeInstruction: '' }

describe.skipIf(!replayUrl)('live voice clarification recovery', () => {
  it.each([
    { transcript: '我沒聽懂，你是說哪一筆？', expected: 'CLARIFICATION' },
    { transcript: '小陳，你是說哪一筆？', expected: 'SILENT' },
    { transcript: '不辣那一份', expected: 'FAST_ACTION' },
  ])('keeps the pending target for $transcript: $expected', async ({ transcript, expected }) => {
    const choices = [{ id: 'clarify:fixture:0', description: '顧客指的是小辣水餃一份。', requiresHighConfidence: true }, { id: 'clarify:fixture:1', description: '顧客指的是不辣水餃一份。', requiresHighConfidence: true }]
    const result = await decideInteraction({ transcript, candidates: choices, decisionState: { phase: 'clarification', references: [{ refId: 'CART_LINE_1', label: '小辣水餃一份' }, { refId: 'CART_LINE_2', label: '不辣水餃一份' }], waitingFor: { questionId: 'fixture', purpose: 'item-clarification', question: '您指的是小辣水餃一份，還是不辣水餃一份？', expiresAt: Date.now() + 30_000, choices } }, policy, invoke, includeTrace: true })
    console.info(JSON.stringify({ transcript, result }))
    if (expected === 'SILENT') {
      expect(['IGNORE', 'UNAVAILABLE']).toContain(result.kind)
      expect(result).not.toHaveProperty('answeredQuestionId')
    }
    else {
      expect(result.kind).toBe(expected)
      if (expected === 'FAST_ACTION')
        expect(result).toHaveProperty('actionId', 'clarify:fixture:1')
    }
  }, 40_000)
})

describe.skipIf(!replayUrl)('live optional phone entry', () => {
  it.each(['略過', '跳過', '不要留電話'])('accepts %s at the optional phone screen', async (transcript) => {
    const result = await decideInteraction({
      transcript,
      candidates: [{ id: 'intent:skip-customer-entry', description: '顧客明確表示略過、不留電話、不要會員或直接開始點餐；略過自願的電話登記，進入菜單，不新增餐點、不代表登入會員。', requiresHighConfidence: true }],
      decisionState: { phase: 'customer_entry', interactionState: { screen: 'customer_entry', matchingCartLines: 0 } },
      conversation: { messages: [{ role: 'assistant', content: '歡迎光臨！手機可以選填，也可以直接略過開始點餐。' }] },
      policy,
      invoke,
      includeTrace: true,
    })
    expect(result, JSON.stringify(result)).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:skip-customer-entry' })
  }, 40_000)
  it.each([
    { transcript: '略過', expected: 'FAST_ACTION' },
    { transcript: '我可以略過嗎？', expected: 'NEEDS_ASSISTANT' },
    { transcript: '不要略過，我要輸入電話', expected: 'NEEDS_ASSISTANT' },
    { transcript: '我想吃飯', expected: 'CUSTOMER_ENTRY_REQUIRED' },
    { transcript: '有賣什麼嗎？', expected: 'NEEDS_ASSISTANT' },
    { transcript: '你是誰？', expected: 'NEEDS_ASSISTANT' },
    { transcript: '還有其他的嗎？', expected: 'NEEDS_ASSISTANT' },
    { transcript: '菜單沒有你剛才說的韭菜盒吧', expected: 'NEEDS_ASSISTANT' },
    { transcript: '真的有甜不辣嗎？', expected: 'NEEDS_ASSISTANT' },
    { transcript: '小陳，這一頁先跳過，我們等下再討論。', expected: 'IGNORE' },
  ])('keeps the phone-question effect for $transcript as $expected', async ({ transcript, expected }) => {
    const choice = { id: 'intent:skip-customer-entry', description: '顧客明確表示略過、不留電話或直接開始點餐，略過自願電話登記。', requiresHighConfidence: true }
    const result = await decideInteraction({ transcript, candidates: [choice], decisionState: { phase: 'customer_entry', waitingFor: { questionId: 'phone-fixture', purpose: 'customer-entry', question: '手機可以選填，也可以略過，直接開始點餐。', expiresAt: Date.now() + 30_000, choices: [choice] } }, policy, invoke, includeTrace: true })
    expect(result, JSON.stringify(result)).toMatchObject({ kind: expected })
    if (['有賣什麼嗎？', '還有其他的嗎？', '菜單沒有你剛才說的韭菜盒吧', '真的有甜不辣嗎？'].includes(transcript))
      expect(result.reason, JSON.stringify(result)).toBe('MENU_QUERY')
    if (transcript === '你是誰？')
      expect(result.reason).toBeUndefined()
  }, 40_000)
})

describe.skipIf(!replayUrl)('live simple meal clarification', () => {
  it.each([
    { transcript: '我想問還有沒有', expected: 'inquire-meal:fixture' },
    { transcript: '還能點嗎', expected: 'inquire-meal:fixture' },
    { transcript: '沒有了嗎', expected: 'inquire-meal:fixture' },
    { transcript: '不是，我是想問還有沒有', expected: 'inquire-meal:fixture' },
    { transcript: '對', expected: 'confirm-meal:fixture:yes' },
    { transcript: '不是', expected: 'confirm-meal:fixture:no' },
    { transcript: '小陳，你問便當還有沒有？', expected: 'SILENT' },
  ])('treats elliptical availability $transcript as $expected', async ({ transcript, expected }) => {
    const choices = [{ id: 'confirm-meal:fixture:yes', description: '是，確認要點打拋豬便當。' }, { id: 'confirm-meal:fixture:no', description: '不是。' }]
    const result = await decideInteraction({ transcript, candidates: [...choices, { id: 'inquire-meal:fixture', description: '查詢目前確認的這款餐點現在是否可點，例如「我想問還有沒有」「還能點嗎」「沒有了嗎」；不是購買或否認購買，不新增餐點。', requiresHighConfidence: true }], decisionState: { phase: 'meal_confirmation', waitingFor: { questionId: 'fixture', purpose: 'confirm-meal', question: '您是要點打拋豬便當嗎？', expiresAt: Date.now() + 30_000, choices } }, policy, invoke, includeTrace: true })
    if (expected === 'SILENT') {
      expect(['IGNORE', 'UNAVAILABLE'], JSON.stringify(result)).toContain(result.kind)
      if (result.kind === 'UNAVAILABLE')
        expect(result.reason).toBe('UNCERTAIN_RECIPIENT')
    }
    else {
      expect(result, JSON.stringify(result)).toMatchObject({ kind: 'FAST_ACTION', actionId: expected })
    }
  }, 40_000)
  it('confirms a partial menu name after recommendations without inventing an alias', async () => {
    const result = await decideInteraction({ transcript: '我想點糖醋魚飯', candidates: [{ id: 'intent:search-menu', description: '查詢餐點，不新增訂單。' }], policy, invoke, decisionState: { phase: 'ordering', clarificationOffer: { id: 'offer1', label: '招牌糖醋魚飯' }, productResolution: { status: 'possible', count: 1, references: [{ label: '招牌糖醋魚飯', refId: 'ITEM_1' }] } }, conversation: { messages: [{ role: 'user', content: '推薦飯類' }, { role: 'assistant', content: '可以看看招牌糖醋魚飯或香菇雞飯。' }] } })
    expect(result.kind).toBe('NEEDS_CLARIFICATION')
  }, 40_000)
  it.each([
    { transcript: '香菇雞飯', expected: 'NEEDS_CLARIFICATION' },
    { transcript: '小陳，你晚餐要吃香菇雞飯嗎？', expected: 'SILENT' },
    { transcript: '那份報告寫完再來討論香菇雞飯。', expected: 'SILENT' },
    { transcript: '香菇雞飯多少錢？', expected: 'NEEDS_ASSISTANT' },
  ])('routes $transcript without treating every dish mention as an order', async ({ transcript, expected }) => {
    const cancel = { id: 'configure:fixture:cancel', description: '只有明確取消這筆蒸餃才選；另一個品名不是取消。' }
    const result = await decideInteraction({ transcript, candidates: [cancel], policy, invoke, includeTrace: true, conversation: { messages: [{ role: 'user', content: '蒸餃' }, { role: 'assistant', content: '蒸餃要幾份？' }] }, decisionState: { phase: 'configuration', clarificationOffer: { id: 'offer1', label: '香菇雞飯' }, catalogEvidence: { products: [{ label: '香菇雞飯', matchedText: '香菇雞飯', source: 'name' }], categories: [] }, references: [{ refId: 'CONFIGURING_ITEM', label: '蒸餃' }], waitingFor: { questionId: 'fixture', purpose: 'item-configuration', question: '蒸餃要幾份？', expiresAt: Date.now() + 30_000, choices: [cancel] } } })
    const trace = result.trace as KioskDecisionTrace | undefined
    const diagnostic = JSON.stringify({ kind: result.kind, reason: result.reason, answers: trace?.exchanges?.map(exchange => exchange.answers), route: trace?.rawAnswer, relation: trace?.questionRelation })
    if (expected === 'SILENT') {
      expect(['IGNORE', 'UNAVAILABLE'], diagnostic).toContain(result.kind)
      if (result.kind === 'UNAVAILABLE')
        expect(result.reason).toBe('UNCERTAIN_RECIPIENT')
    }
    else {
      expect(result.kind, diagnostic).toBe(expected)
    }
    if (expected === 'NEEDS_ASSISTANT')
      expect(result.reason).toBe('NEW_REQUEST')
  }, 40_000)

  it.each([{ transcript: '對', suffix: 'yes' }, { transcript: '不是', suffix: 'no' }])('answers a single confirmation with $transcript', async ({ transcript, suffix }) => {
    const choices = [{ id: 'confirm-meal:fixture:yes', description: '是，要點香菇雞飯，接著補必要資料。' }, { id: 'confirm-meal:fixture:no', description: '不是，保留原本點餐進度。' }]
    const result = await decideInteraction({ transcript, candidates: choices, policy, invoke, includeTrace: true, decisionState: { phase: 'meal_confirmation', waitingFor: { questionId: 'fixture', purpose: 'confirm-meal', question: '您是要點香菇雞飯嗎？', expiresAt: Date.now() + 30_000, choices } } })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: `confirm-meal:fixture:${suffix}` })
    expect(result.modelCalls).toBe(1)
  }, 40_000)
})

describe.skipIf(!replayUrl)('live topic changes during meal configuration', () => {
  it.each([
    { transcript: '不要水餃', expected: 'FAST_ACTION' },
    { transcript: '我沒有要水餃，我是問有沒有', expected: 'FAST_ACTION' },
    { transcript: '我沒有要水餃，我是有有沒有', expected: 'FAST_ACTION' },
  ])('handles current-meal correction $transcript as $expected', async ({ transcript, expected }) => {
    const cancel = { id: 'configure:fixture:cancel', description: '顧客明確表示取消／不要這筆尚未加入的餐點時才選，保留購物車；單說另一個品名或分類不是取消。' }
    const inquiry = { id: 'configure:fixture:inquiry', description: '顧客更正不是要點水餃，而是在問有沒有：放棄這筆未加入需求，查詢水餃是否可點，不新增訂單。', requiresHighConfidence: true }
    const result = await decideInteraction({ transcript, candidates: [cancel, inquiry], decisionState: { phase: 'configuration', clarificationOffer: { id: 'offer-fixture', label: '水餃' }, catalogEvidence: { products: [{ label: '水餃', matchedText: '水餃', source: 'name' }], categories: [] }, references: [{ refId: 'CONFIGURING_ITEM', label: '水餃' }], waitingFor: { questionId: 'fixture', purpose: 'item-configuration', question: '請問水餃要幾份？', expiresAt: Date.now() + 30_000, choices: [cancel] } }, policy, invoke, includeTrace: true })
    expect(result, JSON.stringify(result)).toMatchObject({ kind: expected })
    if (expected === 'FAST_ACTION')
      expect(result).toMatchObject({ actionId: transcript === '不要水餃' ? cancel.id : inquiry.id })
  }, 40_000)

  it.each([
    { transcript: '香菇雞飯', effect: 'new-request', category: false },
    { transcript: '飯類', effect: 'new-request', category: true },
    { transcript: '先取消蒸餃', effect: 'cancel', category: false },
    { transcript: '兩份', effect: 'quantity', category: false },
  ] as const)('distinguishes $transcript from a bare cancellation while asking quantity', async ({ transcript, effect, category }) => {
    // Synthetic menu and dialogue, not the reported customer session.
    const cancel = { id: 'configure:fixture:cancel', description: '取消這筆尚未加入的餐點需求，保留購物車。', requiresHighConfidence: true }
    const choices = effect === 'quantity' ? [{ id: 'configure:fixture:quantity', description: '將蒸餃設為 2 份。', requiresHighConfidence: true }, cancel] : [cancel]
    const result = await decideInteraction({
      transcript,
      candidates: choices,
      decisionState: {
        phase: 'configuration',
        catalogEvidence: { products: effect === 'new-request' && !category ? [{ label: '香菇雞飯', matchedText: transcript, source: 'name' }] : [], categories: category ? [{ label: '飯類', matchedText: transcript, itemCount: 2 }] : [] },
        references: [{ refId: 'CONFIGURING_ITEM', label: '蒸餃' }],
        interactionState: { screen: 'item_configuration', matchingCartLines: 0, pendingIntent: 'ADD_ITEM' },
        waitingFor: { questionId: 'fixture', purpose: 'item-configuration', question: '請問蒸餃要幾份？', expiresAt: Date.now() + 30_000, choices },
      },
      conversation: { messages: [{ role: 'user', content: '蒸餃' }, { role: 'assistant', content: '請問蒸餃要幾份？' }] },
      policy,
      invoke,
      includeTrace: true,
    })
    expect(result).toMatchObject(effect === 'new-request'
      ? { kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' }
      : { kind: 'FAST_ACTION', actionId: `configure:fixture:${effect}` })
  }, 40_000)
})

describe.skipIf(!replayUrl)('live missing order slots versus unfinished speech', () => {
  it.each([
    { transcript: '我想點糖醋魚飯', target: 'possible', expected: 'NEEDS_ASSISTANT' },
    { transcript: '我想點招牌糖醋魚飯', target: 'exact', expected: 'FAST_ACTION' },
    { transcript: '我要一份……', target: 'none', expected: 'INCOMPLETE' },
  ] as const)('routes $transcript as $expected after a synthetic recommendation', async ({ transcript, target, expected }) => {
    // Artificial menu and dialogue only; no recorded customer history or saved
    // private profile is sent to the provider by this opt-in diagnostic.
    const result = await decideInteraction({
      transcript,
      candidates: [
        { id: 'intent:search-menu', description: '查詢餐點，不新增訂單。' },
        { id: 'intent:show-recommendations', description: '再次顯示目前的推薦餐點。' },
        ...(target === 'exact' ? [{ id: 'intent:add-item', description: '新增本句明確指定品名的餐點；缺少份數或必要規格由程式追問。', requiresHighConfidence: true }] : []),
      ],
      decisionState: {
        phase: 'ordering',
        catalogEvidence: { products: target === 'none' ? [] : [{ label: '招牌糖醋魚飯', matchedText: target === 'exact' ? '招牌糖醋魚飯' : '糖醋魚飯', source: target === 'exact' ? 'name' : 'fragment' }], categories: [] },
        productResolution: { status: target, count: target === 'none' ? 0 : 1, references: target === 'none' ? [] : [{ label: '招牌糖醋魚飯', refId: 'ITEM_1' }] },
        interactionState: { screen: 'menu', matchingCartLines: 0 },
      },
      conversation: { messages: [{ role: 'user', content: '可以推薦飯類嗎？' }, { role: 'assistant', content: '可以考慮招牌糖醋魚飯，也有香菇雞飯。' }] },
      policy,
      invoke,
      includeTrace: true,
    })
    console.info(JSON.stringify({ fixture: 'missing-order-slots', transcript, kind: result.kind, modelQuestions: result.modelQuestions, ...(result.kind === 'FAST_ACTION' ? { actionId: result.actionId } : {}) }))
    expect(result.kind).toBe(expected)
    expect(result.modelQuestions).toBe(1)
    if (result.kind === 'FAST_ACTION')
      expect(result.actionId).toBe('intent:add-item')
  }, 40_000)
})

// Synthetic contrasts only; the reported customer transcripts stay in local
// recorded-choice tests. This suite requires explicit endpoint opt-in.
describe.skipIf(!replayUrl)('live service-scope contrasts', () => {
  it.each([
    '我們下午再討論專案的分工。',
    '同事問我為什麼換成另一套軟體。',
    '那份報告還有很多問題要討論。',
    '小陳，你剛剛說那個資料要從……',
  ])('ignores discussion outside ordering service: %s', async (transcript) => {
    const result = await decideInteraction({ transcript, candidates: [{ id: 'intent:search-menu', description: '查詢餐點，不新增訂單。' }], decisionState: { phase: 'ordering' }, policy: { decisionInstruction: '需要解釋或推理時交给助手。', storeInstruction: '' }, invoke, includeTrace: true })
    expect(result.kind).toBe('IGNORE')
    expect(result.modelCalls).toBe(1)
  }, 40_000)
  it.each(['為什麼推薦這道菜？', '這兩道哪個適合小朋友？'])('keeps service explanations without a product-name requirement: %s', async (transcript) => {
    const result = await decideInteraction({ transcript, candidates: [], decisionState: { phase: 'ordering' }, policy, invoke })
    expect(result.kind).toBe('NEEDS_ASSISTANT')
  }, 40_000)
  it('keeps a vegetarian menu query as a service request', async () => {
    const result = await decideInteraction({ transcript: '有沒有素食？', candidates: [{ id: 'intent:search-menu', description: '查詢餐點或飲食條件，不新增訂單。' }], decisionState: { phase: 'ordering', dietaryReferences: [{ id: 'vegetarian', label: '店家標示的素食' }] }, policy, invoke })
    expect(['FAST_ACTION', 'NEEDS_ASSISTANT']).toContain(result.kind)
  }, 60_000)
  it('keeps a one-person answer attached to its current question', async () => {
    const result = await decideInteraction({ transcript: '一位', candidates: [{ id: 'intent:set-party-size', description: '設定內用一位', requiresHighConfidence: true }], decisionState: { phase: 'ordering', waitingFor: { questionId: 'synthetic-party', purpose: 'party-size', question: '幾位用餐？', expiresAt: Date.now() + 60_000, choices: [{ id: 'intent:set-party-size', description: '設定內用一位' }] } }, policy, invoke })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:set-party-size' })
  }, 60_000)
})

describe.skipIf(!replayUrl)('live bounded product and drift review', () => {
  it('keeps a product question distinct from the mentioned shrimp ingredient', async () => {
    const result = await decideInteraction({
      transcript: '有蝦捲嗎？',
      candidates: [{ id: 'intent:search-menu', description: '查詢餐點或飲食條件，不新增訂單。' }],
      decisionState: { phase: 'ordering', ingredientReferences: [{ id: 'shrimp', label: '蝦' }], productResolution: { status: 'possible', count: 1, references: [{ refId: 'ITEM_1', label: '蝦捲便當' }] } },
      policy,
      invoke,
      includeTrace: true,
    })
    console.info(JSON.stringify({ fixture: 'product-query', result }))
    expect(result).toMatchObject({ kind: 'FAST_ACTION', searchInterpretation: 'product', ingredientFilters: { includeIngredients: [], excludeIngredients: [] } })
  }, 40_000)

  it('does not claim a single-item inquiry was completed by an ingredient-only bento result', async () => {
    const result = await decideInteraction({
      transcript: '有單點蝦捲嗎？',
      candidates: [],
      policy,
      invoke,
      includeTrace: true,
      decisionState: { phase: 'ordering', constraints: { include: ['shrimp'], exclude: [] } },
      review: { answer: '找到含蝦便當。', observation: JSON.stringify({ understanding: { intent: 'search', include: ['shrimp'] }, actualResult: { items: [{ name: '蝦捲便當' }], hasSingleItemData: false } }) },
    })
    console.info(JSON.stringify({ fixture: 'drift-review', result }))
    expect(result.kind).toBe('NEEDS_ASSISTANT')
    expect(result.modelQuestions).toBe(1)
  }, 40_000)
})

async function invoke(state: string, questions: Record<string, SystemOneQuestion>) {
  const response = await fetch(new URL('v1/systemone', `${replayUrl!.replace(/\/+$/, '')}/`), {
    body: JSON.stringify({ state, questions }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok)
    throw new Error(`System One replay failed: ${response.status}`)
  return await response.json() as { answers?: Record<string, unknown> }
}

// Run explicitly with KIOSK_SYSTEM_ONE_REPLAY_URL; ordinary unit tests never
// depend on a merchant's model process or network availability.
describe.skipIf(!replayUrl)('live segmented decision checkpoints', () => {
  for (const fixture of [
    { transcript: '有賣什麼', phase: 'ordering', candidates: [{ id: 'intent:search-menu', description: '查詢目前販售的菜單，不加入購物車。' }], expected: 'intent:search-menu' },
    { transcript: '走走走去那邊', phase: 'ordering', candidates: [{ id: 'intent:search-menu', description: '查詢目前販售的菜單，不加入購物車。' }], expected: 'IGNORE' },
    { transcript: '信用卡', phase: 'checkout_payment_select', candidates: [{ id: 'intent:select-payment:card', description: '選擇信用卡付款，需由應用程式確認後才開始付款。', requiresHighConfidence: true }, { id: 'intent:select-payment:mobile', description: '選擇行動支付，需由應用程式確認後才開始付款。', requiresHighConfidence: true }], expected: 'intent:select-payment:card' },
  ]) {
    it(`staged fixture: ${fixture.transcript}`, async () => {
      const stages = createDecisionStages()
      const owner = { deviceId: 'synthetic-replay', visitorSessionId: crypto.randomUUID() }
      const questions: string[] = []
      let result = await stages.start(owner, checkpoint => decideInteraction({ transcript: fixture.transcript, candidates: fixture.candidates, decisionState: { phase: fixture.phase, paymentState: 'idle', ...(fixture.phase === 'checkout_payment_select' ? { allowedPaymentMethods: ['card', 'mobile'] } : {}) }, includeTrace: true, policy, invoke: checkpoint(invoke) }))
      while (result.kind === 'DECISION_PROGRESS') {
        questions.push(result.question)
        result = await stages.next(owner, result.continuationId)
      }
      console.info(JSON.stringify({ fixture: fixture.transcript, questions, kind: result.kind, ...(result.kind === 'FAST_ACTION' ? { actionId: result.actionId } : {}), modelQuestions: result.modelQuestions }))
      expect(questions[0]).toBe('route')
      if (fixture.expected === 'IGNORE')
        expect(result.kind).toBe('IGNORE')
      else
        expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: fixture.expected })
      if (fixture.phase !== 'ordering' || fixture.expected === 'IGNORE')
        expect(questions).not.toContain('filterPresence')
      expect(result.modelQuestions).toBe(questions.length)
    }, 120_000)
  }
})

describe.skipIf(!replayUrl)('kiosk System One live semantic replay', () => {
  for (const scenario of [
    { transcript: '你好', expected: 'GREET', waiting: false },
    { transcript: '店員你好', expected: 'GREET', waiting: true },
    { transcript: '小明你好，我們去那邊坐', expected: 'IGNORE', waiting: false },
    { transcript: '你好，我要兩份水餃', expected: 'FAST_ACTION', waiting: false },
  ]) {
    it(`live greeting: ${scenario.transcript}`, async () => {
      const result = await decideInteraction({
        transcript: scenario.transcript,
        policy,
        invoke,
        includeTrace: true,
        candidates: [
          { id: 'intent:search-menu', description: '查詢菜單，不新增訂單。' },
          { id: 'intent:add-item', description: '新增已解析水餃的訂購項目；招呼加購買仍是新增。', requiresHighConfidence: true },
        ],
        decisionState: { phase: 'ordering', references: [{ refId: 'ITEM_1', label: '水餃' }], ...(scenario.waiting ? { waitingFor: { questionId: 'greeting-q1', question: '要結帳嗎？', purpose: 'checkout-entry', choices: [{ id: 'intent:start-checkout', description: '進入結帳流程' }], expiresAt: Date.now() + 30_000 } } : {}) },
      })
      console.info(JSON.stringify({ transcript: scenario.transcript, decision: result }))
      expect(result.kind).toBe(scenario.expected)
      if (scenario.expected === 'FAST_ACTION')
        expect(result).toMatchObject({ actionId: 'intent:add-item' })
    }, 40_000)
  }
  for (const scenario of [
    { transcript: '兩位', partySize: undefined, expected: 'intent:set-party-size', question: '請問幾位用餐？' },
    { transcript: '選一號桌', partySize: 2, expected: 'intent:reserve-tables:TABLE_CHOICE_1', question: '請選擇桌位：1 號桌、2 號桌、3 號桌、4 號桌、5 號桌。' },
    { transcript: '同意分桌，選一號桌和二號桌', partySize: 5, expected: 'intent:reserve-tables:TABLE_CHOICE_1', question: '五位需分桌，是否同意分桌並選擇一號桌和二號桌？' },
  ]) {
    it(`live seating: ${scenario.transcript}`, async () => {
      // Replay the serialized application contract, not browser runtime code.
      // The server never owns Vue/cart resolution; that boundary is exercised
      // in Order Menu's resolver and WebMCP integration tests.
      const labels = scenario.partySize === 5
        ? ['1 號桌、2 號桌', '1 號桌、3 號桌', '1 號桌、4 號桌', '1 號桌、5 號桌', '2 號桌、3 號桌', '2 號桌、4 號桌', '2 號桌、5 號桌', '3 號桌、4 號桌', '3 號桌、5 號桌', '4 號桌、5 號桌']
        : scenario.partySize ? ['1 號桌', '2 號桌', '3 號桌', '4 號桌', '5 號桌'] : []
      const candidates = [
        { id: 'intent:search-menu', description: '查詢餐點、分類或目前販售的完整菜單；不新增訂單。' },
        { id: 'intent:recommend', description: '顧客明確要求簡單推薦或套用已知飲食限制。' },
        { id: 'intent:view-cart', description: '查看目前購物車。' },
        { id: 'intent:set-quantity', description: '修改已選或購物車現有餐點數量，不新增品項。', requiresHighConfidence: true },
        { id: 'intent:set-option', description: '修改已選或購物車現有餐點客製選項。', requiresHighConfidence: true },
        { id: 'intent:remove-item', description: '移除購物車中的特定一筆餐點。', requiresHighConfidence: true },
        { id: 'intent:clear-cart', description: '明確要求清空整個購物車。', requiresHighConfidence: true },
        { id: 'intent:set-fulfillment:takeout', description: '這筆訂單設為自取，釋放尚未付款的暫留桌位。', requiresHighConfidence: true },
        ...(scenario.partySize ? labels.map((label, index) => ({ id: `intent:reserve-tables:TABLE_CHOICE_${index + 1}`, description: scenario.partySize === 5 ? `明確同意分桌，並選擇 ${label} 暫留 10 分鐘。` : `選擇 ${label} 暫留 10 分鐘。`, requiresHighConfidence: true })) : [{ id: 'intent:set-party-size', description: '設定本次內用為 2 位，不是餐點數量；修改人數會釋放原保留桌位。', requiresHighConfidence: true }]),
      ]
      const decisionState = { phase: 'ordering', paymentState: 'idle', interactionState: { matchingCartLines: 0, seating: { partySize: scenario.partySize, ready: false, question: scenario.question } }, waitingFor: { questionId: 'replay-question', purpose: scenario.partySize ? 'tables' : 'party-size', choices: candidates, question: scenario.question, expiresAt: Date.now() + 30000 }, references: [{ label: '購物車第1筆水餃', refId: 'CART_LINE_1' }, ...labels.map((label, index) => ({ label, refId: `TABLE_CHOICE_${index + 1}` }))] }
      const result = await decideInteraction({ candidates, conversation: { messages: [{ role: 'assistant', content: scenario.question }] }, decisionState, invoke, includeTrace: true, policy, transcript: scenario.transcript, maxActionCandidates: 22 })
      console.info(JSON.stringify({ transcript: scenario.transcript, decisionState, candidateIntents: candidates, systemOne: result }))
      expect(result).toMatchObject({ trace: { rawAnswer: { choice: scenario.expected } } })
      expect(['FAST_ACTION', 'NEEDS_ASSISTANT']).toContain(result.kind)
    }, 40000)
  }
  const ordering = [
    { id: 'intent:search-menu', description: '查詢已解析的菜單品項是否存在，或瀏覽分類。' },
    { id: 'intent:select-item', description: '查看或編輯已解析的餐點，但不建立訂購項目。' },
    { id: 'intent:add-item', description: '明確建立一筆新的餐點訂購項目。', requiresHighConfidence: true },
  ]
  const selected = [
    { id: 'intent:add-item', description: '新增一份目前選取的水餃至訂單。', requiresHighConfidence: true },
    { id: 'intent:recommend', description: '顧客明確要求簡單推薦或套用已知飲食限制。' },
    { id: 'intent:set-quantity', description: '修改已選或購物車現有餐點數量，不新增品項。', requiresHighConfidence: true },
    { id: 'intent:set-option', description: '修改已選或購物車現有餐點客製選項。', requiresHighConfidence: true },
  ]
  const cases = [
    { name: '有賣什麼', phase: 'ordering', references: [], candidates: [{ id: 'intent:search-menu', description: '查詢餐點、分類或目前販售的完整菜單；不新增訂單。' }, { id: 'intent:recommend', description: '顧客明確要求簡單推薦。' }], expected: 'intent:search-menu' },
    { name: '就這個', phase: 'ordering', references: [{ label: '剛展示的招牌便當', refId: 'ITEM_1' }], candidates: ordering, conversation: { messages: [{ role: 'user' as const, content: '推薦招牌餐點' }, { role: 'assistant' as const, content: '推薦招牌便當。' }] }, expected: 'intent:add-item' },
    { name: '好', phase: 'ordering', references: [{ label: '剛展示的水餃', refId: 'ITEM_1' }], candidates: ordering, conversation: { messages: [{ role: 'user' as const, content: '水餃怎麼賣？' }, { role: 'assistant' as const, content: '一份十顆，60 元。' }] }, expected: 'IGNORE' },
    { name: '我想要吃招牌便當', phase: 'ordering', references: [{ label: '周氏蝦捲招牌便當', refId: 'ITEM_1' }], candidates: ordering, expected: 'intent:add-item', allowLowConfidenceEscalation: true },
    { name: '我不要豬肉', phase: 'ordering', references: [], candidates: [{ id: 'intent:recommend', description: '顧客明確要求簡單推薦或套用已知飲食限制。' }], expected: 'intent:recommend', constraints: { exclude: ['pork'] } },
    { name: '我好餓', phase: 'ordering', references: [], candidates: [{ id: 'intent:recommend', description: '顧客明確要求簡單推薦或套用已知飲食限制。' }], expected: 'IGNORE' },
    { name: '信用卡', phase: 'checkout_payment_select', references: [], candidates: [{ id: 'intent:select-payment:card', description: '使用信用卡付款。', requiresHighConfidence: true }, { id: 'intent:select-payment:mobile', description: '使用行動支付付款。', requiresHighConfidence: true }], expected: 'intent:select-payment:card' },
    { name: '改兩份', phase: 'ordering', references: [{ label: '目前選的水餃', refId: 'SELECTED_ITEM_1' }], candidates: selected, expected: 'intent:set-quantity' },
    { name: '不要辣', phase: 'ordering', references: [{ label: '目前選的水餃', refId: 'SELECTED_ITEM_1' }], candidates: selected, expected: 'intent:set-option' },
    { name: '再一份', phase: 'ordering', references: [{ label: '購物車第1筆水餃（最近加入）', refId: 'CART_LINE_1' }], candidates: selected, expected: 'intent:add-item' },
    { name: '水餃不要了', phase: 'ordering', references: [{ label: '購物車第1筆水餃', refId: 'CART_LINE_1' }, { label: '購物車第2筆水餃', refId: 'CART_LINE_2' }], candidates: [...ordering, { id: 'intent:view-cart', description: '查看目前購物車。' }, { id: 'intent:set-quantity', description: '修改已選或購物車現有餐點數量，不新增品項。', requiresHighConfidence: true }, { id: 'intent:set-option', description: '修改已選或購物車現有餐點客製選項。', requiresHighConfidence: true }, { id: 'intent:remove-item', description: '移除購物車中的餐點；若有多筆同名品項，程式會詢問是哪一筆。', requiresHighConfidence: true }], expected: 'intent:remove-item' },
  ]

  for (const scenario of cases) {
    it(scenario.name, async () => {
      const result = await decideInteraction({
        conversation: 'conversation' in scenario ? scenario.conversation : undefined,
        candidates: scenario.candidates,
        decisionState: {
          allowedPaymentMethods: scenario.phase === 'checkout_payment_select' ? ['card', 'mobile'] : [],
          constraints: 'constraints' in scenario ? scenario.constraints : { exclude: [] },
          interactionState: { matchingCartLines: scenario.references.filter(reference => reference.refId.startsWith('CART_LINE_')).length, ...(scenario.references.some(reference => reference.refId.startsWith('SELECTED_ITEM_')) ? { selectedItemName: '水餃' } : {}), ...(scenario.name === '再一份' ? { lastAddedItemName: '水餃' } : {}), ...(scenario.phase === 'clarification' ? { pendingIntent: 'REMOVE_ITEM' } : {}) },
          paymentState: 'idle',
          phase: scenario.phase,
          references: scenario.references,
        },
        includeTrace: true,
        invoke,
        maxActionCandidates: 22,
        policy,
        transcript: scenario.name,
      })
      console.info(JSON.stringify({ transcript: scenario.name, phase: scenario.phase, references: scenario.references, candidates: scenario.candidates.map(candidate => candidate.id), result }))
      if (scenario.expected === 'IGNORE') {
        expect(['IGNORE', 'NEEDS_ASSISTANT']).toContain(result.kind)
      }
      else if (scenario.expected === 'intent:recommend') {
        expect(['FAST_ACTION', 'NEEDS_ASSISTANT']).toContain(result.kind)
      }
      else if ('allowLowConfidenceEscalation' in scenario) {
        expect(result).toMatchObject({ trace: { rawAnswer: { choice: scenario.expected } } })
        expect(['FAST_ACTION', 'NEEDS_ASSISTANT']).toContain(result.kind)
      }
      else {
        expect(result).toMatchObject({ actionId: scenario.expected, kind: 'FAST_ACTION' })
      }
    }, 40_000)
  }

  for (const scenario of [
    { transcript: '有賣什麼', expected: 'COMPLETE' },
    { transcript: '有賣什麼，也推薦一下', expected: 'FAST_ACTION' },
  ]) {
    it(`reviews a real completed lookup: ${scenario.transcript}`, async () => {
      const result = await decideInteraction({
        candidates: [{ id: 'read:recommend', description: '顧客同時要求推薦，從已查得的菜單補充簡單推薦；只查詢展示，不新增訂單。' }],
        decisionState: { phase: 'ordering', paymentState: 'idle' },
        includeTrace: true,
        invoke,
        policy,
        review: { answer: '目前販售水餃和牛肉麵。', observation: JSON.stringify({ items: [{ name: '水餃', price: 60 }, { name: '牛肉麵', price: 120 }] }) },
        transcript: scenario.transcript,
      })
      console.info(JSON.stringify({ transcript: scenario.transcript, stage: 'result_review', result }))
      expect(result.kind).toBe(scenario.expected)
      if (result.kind === 'FAST_ACTION')
        expect(result.actionId).toBe('read:recommend')
    }, 40_000)
  }
})
