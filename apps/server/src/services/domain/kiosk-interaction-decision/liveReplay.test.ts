import type { SystemOneQuestion } from '../kiosk-system-one'

import { describe, expect, it } from 'vitest'

import { decideInteraction } from '.'
import { createDecisionStages } from './stages'

const replayUrl = process.env.KIOSK_SYSTEM_ONE_REPLAY_URL
const policy = { decisionInstruction: '', storeInstruction: '' }

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
