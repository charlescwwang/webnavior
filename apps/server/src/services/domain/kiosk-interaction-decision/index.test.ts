import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'
import { createRecommendationInvitation } from './contracts'

describe('kiosk System One interaction decision', () => {
  // Known-red replay of attachment 2c567045. This trace has no dialogue,
  // waiting question or active request; only the recorded route is replayed.
  it.skipIf(process.env.KIOSK_OFF_TOPIC_DIAGNOSIS !== '1')('does not admit the reported unrelated discussion without ordering context', async () => {
    const result = await decideInteraction({
      transcript: '外面都說做得到 但是交參與也有一大堆問題',
      policy: { decisionInstruction: '', storeInstruction: '' },
      invoke: async () => ({ answers: { route: { choice: 'NEEDS_ASSISTANT', confidence: 0.6155 } } }),
      candidates: [],
      decisionState: { phase: 'ordering' },
    })
    expect(result.kind).toBe('IGNORE')
  })
  it.each(['IGNORE', 'NEEDS_ASSISTANT'] as const)('replays context-free unrelated discussion with provider route %s', async (choice) => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice, confidence: 0.6155 } } }))
    const result = await decideInteraction({
      transcript: '外面都說做得到 但是交參與也有一大堆問題',
      policy: { decisionInstruction: '', storeInstruction: '' },
      invoke,
      candidates: [],
      decisionState: { phase: 'ordering' },
    })
    expect(result.kind).toBe(choice)
    expect(result.supersededQuestionId).toBeUndefined()
    expect(invoke).toHaveBeenCalledOnce()
  })
  // Attachment 7e0c1850: MULTI_ACTION returned before the action confidence
  // check. Replaying that answer must not admit the fragment to Main Agent.
  it('does not escalate the reported low-confidence background fragment', async () => {
    const result = await decideInteraction({
      transcript: '你這樣跑掉 你要從... 從這邊 應該有辦法 不一定是...',
      policy: { decisionInstruction: '', storeInstruction: '' },
      invoke: async () => ({ answers: { route: { choice: 'MULTI_ACTION', confidence: 0.2911 } } }),
      candidates: [],
      decisionState: { phase: 'ordering' },
    })
    expect(result.kind).toBe('UNAVAILABLE')
  })
  it.each(['MULTI_ACTION', 'NEEDS_ASSISTANT', 'intent:return-menu'])('compares low-confidence background admission through route %s', async (choice) => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice, confidence: 0.2911 } } }))
    const result = await decideInteraction({
      transcript: '你這樣跑掉 你要從... 從這邊 應該有辦法 不一定是...',
      policy: { decisionInstruction: '', storeInstruction: '' },
      invoke,
      candidates: [{ id: 'intent:return-menu', description: '回到菜單', requiresHighConfidence: true }],
      decisionState: { phase: 'ordering' },
    })
    expect(result.kind).toBe('UNAVAILABLE')
    expect(invoke).toHaveBeenCalledTimes(choice === 'intent:return-menu' ? 1 : 2)
    expect(result.supersededQuestionId).toBeUndefined()
  })
  it.each(['NEEDS_ASSISTANT', 'MULTI_ACTION', 'FOLLOW_UP_ACTIVE'])('rejects unreliable %s without consuming the session question', async (choice) => {
    for (const confidence of [undefined, 0.2911, 0.5999, Number.NaN, Number.POSITIVE_INFINITY, 1.1]) {
      const waitingFor = createRecommendationInvitation('I1', Date.now())
      const decisionState = { phase: 'ordering', waitingFor, ...(choice === 'FOLLOW_UP_ACTIVE' ? { activeRequest: { stage: 'thinking' as const, text: '幫我比較便當' } } : {}) }
      const invoke = vi.fn(async () => ({ answers: { route: { choice, confidence } } }))
      const result = await decideInteraction({ transcript: '這個也有問題', candidates: [], decisionState, policy: { decisionInstruction: '', storeInstruction: '' }, invoke })
      expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION' })
      expect(result.supersededQuestionId).toBeUndefined()
      expect(result.answeredQuestionId).toBeUndefined()
      expect(decisionState.waitingFor).toBe(waitingFor)
      expect(invoke).toHaveBeenCalledTimes(2)
    }
  })
  it.each(['NEEDS_ASSISTANT', 'MULTI_ACTION', 'FOLLOW_UP_ACTIVE'])('retains reliable %s at the existing 0.6 boundary', async (choice) => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice, confidence: 0.6 } } }))
    const result = await decideInteraction({ transcript: '也幫我比較這道菜', candidates: [], decisionState: { phase: 'ordering', activeRequest: { stage: 'thinking', text: '幫我比較便當' } }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke })
    expect(result.kind).toBe(choice === 'FOLLOW_UP_ACTIVE' ? 'FOLLOW_UP_ACTIVE' : 'NEEDS_ASSISTANT')
    expect(invoke).toHaveBeenCalledOnce()
  })
  // Known-red admission replay of attachment fb20874f. The provider choice is
  // recorded locally; this does not test live Jev or send customer text outside.
  it.skipIf(process.env.KIOSK_OFF_TOPIC_DIAGNOSIS !== '1')('does not admit the reported unrelated software question as an ordering-assistant request', async () => {
    const result = await decideInteraction({
      transcript: '為什麼你會選用這個分數 然後這個軟體',
      policy: { decisionInstruction: '', storeInstruction: '' },
      invoke: async () => ({ answers: { route: { choice: 'NEEDS_ASSISTANT', confidence: 0.8784 } } }),
      candidates: [{ id: 'intent:recommend', description: '推薦餐點' }],
      decisionState: { phase: 'ordering', waitingFor: createRecommendationInvitation('I1', Date.now()) },
    })
    expect(result.kind).toBe('IGNORE')
  })
  it.each(['IGNORE', 'NEEDS_ASSISTANT'] as const)('replays the reported software question admission with provider route %s', async (choice) => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice, confidence: 0.8784 } } }))
    const result = await decideInteraction({
      transcript: '為什麼你會選用這個分數 然後這個軟體',
      policy: { decisionInstruction: '', storeInstruction: '' },
      invoke,
      candidates: [{ id: 'intent:recommend', description: '推薦餐點' }],
      decisionState: { phase: 'ordering', waitingFor: createRecommendationInvitation('I1', Date.now()) },
    })
    expect(result.kind).toBe(choice)
    expect(invoke).toHaveBeenCalledOnce()
    expect(result.supersededQuestionId).toBe(choice === 'NEEDS_ASSISTANT' ? 'I1' : undefined)
  })
  it.each([
    { transcript: '好', choice: 'intent:recommend', kind: 'FAST_ACTION' },
    { transcript: '不用', choice: 'DECLINE_INVITATION', kind: 'IGNORE' },
  ])('answers a presented recommendation invitation: $transcript', async ({ transcript, choice, kind }) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.route
      ? { answers: { route: { choice, confidence: 0.95 } } }
      : questions.relation
        ? { answers: { relation: { choice, confidence: 0.95 } } }
        : { answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, filterRequirement: { choice: 'COVERED', confidence: 0.95 }, filterPresence: { choice: 'NO_FILTER', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript, policy: { decisionInstruction: '', storeInstruction: '' }, invoke, candidates: [{ id: 'intent:recommend', description: '推薦三項，不加入購物車' }], decisionState: { phase: 'ordering', waitingFor: createRecommendationInvitation('I1', Date.now()) } })
    expect(result.kind).toBe(kind)
    expect(result).toMatchObject({ answeredQuestionId: 'I1' })
    if (result.kind === 'FAST_ACTION')
      expect(result.actionId).toBe('intent:recommend')
    expect(invoke).toHaveBeenCalledTimes(kind === 'FAST_ACTION' ? 3 : 2)
    expect(invoke.mock.calls[0]?.[1]).toHaveProperty('route')
    expect(invoke.mock.calls[1]?.[1]).toHaveProperty('relation')
  })
  it('routes a new request normally instead of translating it into invitation acceptance', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { route: { choice: 'intent:return-menu', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '回菜單', policy: { decisionInstruction: '', storeInstruction: '' }, invoke, candidates: [{ id: 'intent:return-menu', description: '回菜單' }, { id: 'intent:recommend', description: '推薦' }], decisionState: { phase: 'ordering', waitingFor: { questionId: 'I1', purpose: 'recommendation-invitation', question: '要推薦嗎？', expiresAt: Date.now() + 30000, choices: [{ id: 'intent:recommend', description: '推薦' }] } } })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:return-menu' })
    expect(result.answeredQuestionId).toBeUndefined()
    expect(invoke).toHaveBeenCalledOnce()
  })
  it('does not consume an uncertain invitation answer or authorize an absent recommendation candidate', async () => {
    for (const confidence of [0.4, 0.95]) {
      const invoke = vi.fn(async () => ({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, route: { choice: 'intent:recommend', confidence }, relation: { choice: 'ANSWER', confidence: 0.95 } } }))
      const result = await decideInteraction({ transcript: '好', policy: { decisionInstruction: '', storeInstruction: '' }, invoke, candidates: [], decisionState: { phase: 'ordering', waitingFor: { questionId: 'I1', purpose: 'recommendation-invitation', question: '要推薦嗎？', expiresAt: Date.now() + 30000, choices: [{ id: 'intent:recommend', description: '推薦' }] } } })
      expect(result.kind).toBe('UNAVAILABLE')
      expect(result.answeredQuestionId).toBeUndefined()
    }
  })
  it.each(['configuration', 'checkout', 'pending_confirmation'])('does not offer invitation acceptance in %s', async (phase) => {
    const invoke = vi.fn(async (_state: string, _questions: Record<string, unknown>) => ({ answers: { route: { choice: 'IGNORE', confidence: 0.95 }, speech: { choice: 'NON_TASK', confidence: 0.95 }, relation: { choice: 'NEW_REQUEST', confidence: 0.95 } } }))
    const result = await decideInteraction({ transcript: '好', policy: { decisionInstruction: '', storeInstruction: '' }, invoke, candidates: [], decisionState: { phase, waitingFor: { questionId: 'I1', purpose: 'recommendation-invitation', question: '要推薦嗎？', expiresAt: Date.now() + 30000, choices: [{ id: 'intent:recommend', description: '推薦' }] } } })
    expect(result.kind).not.toBe('FAST_ACTION')
    expect(result.answeredQuestionId).toBeUndefined()
    for (const call of invoke.mock.calls)
      expect(call[1]).not.toHaveProperty('invitation')
  })
  it('routes a new product query before validating configuration answers', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'NEW_REQUEST', confidence: 0.98 } } }))
    const result = await decideInteraction({ transcript: '有水餃嗎？', policy: { decisionInstruction: '', storeInstruction: '' }, invoke, candidates: [{ id: 'configure:q:hot', description: '牛肉麵大辣', requiresHighConfidence: true }], decisionState: { phase: 'configuration', waitingFor: { questionId: 'q', purpose: 'item-configuration', question: '牛肉麵要大辣、小辣還是微辣？', expiresAt: Date.now() + 30_000, choices: [{ id: 'configure:q:hot', description: '牛肉麵大辣' }] } } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0]).toEqual([expect.any(String), expect.objectContaining({ route: expect.any(Object) })])
  })
  it('hands off a deviated review once rather than restarting the route', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'DEVIATED', confidence: 0.95 } } }))
    expect(await decideInteraction({ candidates: [], transcript: '有蝦捲嗎', review: { answer: '有含蝦便當', observation: '查到便當' }, invoke, policy: { decisionInstruction: '', storeInstruction: '' } })).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'DEVIATED' })
    expect(invoke).toHaveBeenCalledTimes(1)
  })
  it('keeps possible product queries separate from ingredient polarity without extra slot forwards', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.route
      ? { answers: { route: { choice: 'intent:search-menu', confidence: 0.95 } } }
      : { answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, filterRequirement: { choice: 'COVERED', confidence: 0.95 }, filterPresence: { choice: 'PRODUCT_QUERY', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '有蝦捲嗎', policy: { decisionInstruction: '', storeInstruction: '' }, candidates: [{ id: 'intent:search-menu', description: '查詢餐點或條件' }], invoke, decisionState: { phase: 'ordering', ingredientReferences: [{ id: 'shrimp', label: '蝦' }], productResolution: { status: 'possible', count: 1, references: [{ refId: 'ITEM_1', label: '蝦捲便當' }] } } })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', searchInterpretation: 'product', ingredientFilters: { includeIngredients: [], excludeIngredients: [] } })
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(Object.keys(invoke.mock.calls[2]![1])).toEqual(['filterRequirement', 'filterPresence'])
  })
  it.each(['BOTH', 'UNCERTAIN'])('does not silently drop part of a possible product/filter requirement: %s', async (choice) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.route ? { answers: { route: { choice: 'intent:search-menu', confidence: 0.95 } } } : { answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, filterRequirement: { choice: 'COVERED', confidence: 0.95 }, filterPresence: { choice, confidence: 0.95 } } })
    expect(await decideInteraction({ transcript: '蝦捲不要蛋', policy: { decisionInstruction: '', storeInstruction: '' }, candidates: [{ id: 'intent:search-menu', description: '查詢' }], invoke, decisionState: { phase: 'ordering', productResolution: { status: 'possible', count: 1, references: [{ refId: 'ITEM_1', label: '蝦捲便當' }] } } })).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNRESOLVED_FILTER' })
  })
  it.each([{ choice: 'UNCERTAIN', confidence: 0.95 }, { choice: 'SATISFIED', confidence: 0.3 }])('does not accept an uncertain final review: $choice / $confidence', async (answer) => {
    const invoke = vi.fn(async () => ({ answers: { route: answer } }))
    expect(await decideInteraction({ candidates: [], transcript: '有蝦捲嗎', review: { answer: '有含蝦便當', observation: '查到便當' }, invoke, policy: { decisionInstruction: '', storeInstruction: '' } })).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_REVIEW' })
    expect(invoke).toHaveBeenCalledTimes(1)
  })
  it('shows verified read outcomes to Jev without leaking the dispatcher tool names', async () => {
    const invoke = vi.fn(async (_state: string) => ({ answers: { route: { choice: 'SATISFIED', confidence: 0.95 } } }))
    await decideInteraction({ transcript: '有賣什麼', candidates: [], decisionState: { phase: 'ordering', completedReads: [{ toolName: 'menu_get', customerMessage: '有蝦捲' }] }, review: { answer: '有蝦捲', observation: '查詢成功' }, invoke, policy: { decisionInstruction: '', storeInstruction: '' } })
    expect(invoke.mock.calls[0]?.[0]).toContain('有蝦捲')
    expect(invoke.mock.calls[0]?.[0]).not.toContain('menu_get')
  })
  const policy = { decisionInstruction: '', storeInstruction: '' }
  it('validates the selected missing configuration slot against its question', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.relation
      ? { answers: { relation: { choice: 'configure:q1:spice:mild', confidence: 0.97 } } }
      : { answers: { route: { choice: 'configure:q1:spice:mild', confidence: 0.97 } } })
    const result = await decideInteraction({ transcript: '小辣', policy, invoke, candidates: [{ id: 'configure:q1:spice:mild', description: '這筆紅燒牛肉麵選小辣' }, { id: 'configure:q1:cancel', description: '取消這筆需求' }], decisionState: { phase: 'configuration', paymentState: 'idle', references: [{ refId: 'CONFIGURING_ITEM', label: '紅燒牛肉麵' }], waitingFor: { questionId: 'q1', purpose: 'item-configuration', question: '辣度要哪一種？', choices: [{ id: 'configure:q1:spice:mild', description: '這筆紅燒牛肉麵選小辣' }, { id: 'configure:q1:cancel', description: '取消這筆需求' }], expiresAt: Date.now() + 30_000 } } })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'configure:q1:spice:mild' })
    expect(invoke).toHaveBeenCalledTimes(2)
    const questions = invoke.mock.calls[0]?.[1] as { route: { criteria: Record<string, string> } }
    expect(Object.keys(questions.route.criteria)).toEqual(['IGNORE', 'NEW_REQUEST', 'configure:q1:spice:mild', 'configure:q1:cancel'])
  })
  it('does not overwrite an explicit checkout choice with a second generic speech classifier', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { route: { choice: 'intent:start-checkout', confidence: 0.97 } } })
      .mockResolvedValueOnce({ answers: { speech: { choice: 'IGNORE', confidence: 0.9 } } })
    const result = await decideInteraction({ transcript: '我要結帳', policy, candidates: [{ id: 'intent:start-checkout', description: '進入結帳，不開始付款', requiresHighConfidence: true }], conversation: { messages: [{ role: 'assistant', content: '已完成。' }] }, decisionState: { phase: 'ordering' }, invoke, includeTrace: true })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:start-checkout', modelCalls: 1 })
    expect(invoke).toHaveBeenCalledTimes(1)
  })
  it('offers a directed greeting separately from background speech and ordering', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => {
      if (questions.greeting)
        return { answers: { greeting: { choice: 'GREET', confidence: 0.95 } } }
      const route = questions.route as { criteria: Record<string, string> }
      return { answers: { route: { choice: route.criteria.GREET ? 'GREET' : 'IGNORE', confidence: 0.95 } } }
    })
    const result = await decideInteraction({ transcript: '你好', policy, invoke, candidates: [], decisionState: { phase: 'ordering' } })
    expect(result.kind).toBe('GREET')
  })
  it('responds to a directed greeting during an operation question without choosing its answer', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'GREET', confidence: 0.95 }, greeting: { choice: 'GREET', confidence: 0.95 } } }))
    const result = await decideInteraction({ transcript: '你好', policy, invoke, candidates: [{ id: 'intent:start-checkout', description: '開始結帳' }], decisionState: { phase: 'ordering', waitingFor: { questionId: 'q1', question: '要結帳嗎？', purpose: 'checkout-entry', expiresAt: Date.now() + 30_000, choices: [{ id: 'intent:start-checkout', description: '開始結帳' }] } } })
    expect(result.kind).toBe('GREET')
    expect(invoke).toHaveBeenCalledTimes(2)
  })
  it('does not greet when the model is unsure who is being addressed', async () => {
    const invoke = async () => ({ answers: { route: { choice: 'GREET', confidence: 0.4 } } })
    expect((await decideInteraction({ transcript: '你好', policy, invoke, candidates: [], decisionState: { phase: 'ordering' } })).kind).toBe('UNAVAILABLE')
  })
  it('silently ignores a companion greeting even when the broad route selected GREET', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ answers: { route: { choice: 'GREET', confidence: 0.95 } } }).mockResolvedValueOnce({ answers: { greeting: { choice: 'IGNORE', confidence: 0.95 } } })
    expect((await decideInteraction({ transcript: '小明你好，我們去那邊坐', policy, invoke, candidates: [], decisionState: { phase: 'ordering' } })).kind).toBe('IGNORE')
  })
  it('does not replace a purchase request with a greeting after a mistaken broad choice', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ answers: { route: { choice: 'GREET', confidence: 0.95 } } }).mockResolvedValueOnce({ answers: { greeting: { choice: 'REQUEST', confidence: 0.95 } } })
    expect((await decideInteraction({ transcript: '你好，我要兩份水餃', policy, invoke, candidates: [{ id: 'intent:add-item', description: '新增水餃' }], decisionState: { phase: 'ordering' } })).kind).toBe('NEEDS_ASSISTANT')
  })
  it('does not allow greeting to replace a pending high-risk confirmation', async () => {
    const invoke = async () => ({ answers: { route: { choice: 'GREET', confidence: 0.95 } } })
    expect((await decideInteraction({ transcript: '你好', policy, invoke, candidates: [{ id: 'intent:confirm:c1', description: '確認清空購物車' }], decisionState: { phase: 'pending_confirmation' } })).kind).toBe('UNAVAILABLE')
  })
  it('does not treat a nutrition word in a dish name as an unavailable requirement', async () => {
    const invoke = async () => ({ answers: { 'recipient': { choice: 'KIOSK', confidence: 0.95 }, 'service': { choice: 'REQUEST', confidence: 0.95 }, 'route': { choice: 'intent:search-menu', confidence: 0.95 }, 'filterRequirement': { choice: 'COVERED', confidence: 0.95 }, 'filterPresence': { choice: 'NO_FILTER', confidence: 0.95 }, 'unavailable:sugar': { choice: 'MENTION_ONLY', confidence: 0.95 } } })
    expect(await decideInteraction({ transcript: '有糖醋排骨嗎', policy, invoke, candidates: [{ id: 'intent:search-menu', description: '查餐點是否存在' }], decisionState: { phase: 'ordering', unavailableConditionReferences: [{ id: 'sugar', label: '糖含量（沒有營養數據）' }] } })).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:search-menu' })
  })
  it('keeps a requested unavailable nutrition reference from being dropped beside a known ingredient', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => ({ answers: { 'recipient': { choice: 'KIOSK', confidence: 0.95 }, 'service': { choice: 'REQUEST', confidence: 0.95 }, 'route': { choice: 'intent:search-menu', confidence: 0.95 }, 'filterRequirement': { choice: 'COVERED', confidence: 0.95 }, 'filterPresence': { choice: 'REQUIRED', confidence: 0.95 }, 'ingredient:pork': { choice: 'EXCLUDE', confidence: 0.95 }, ...(questions['unavailable:sodium'] ? { 'unavailable:sodium': { choice: 'REQUIRED', confidence: 0.95 } } : {}) } }))
    const result = await decideInteraction({ transcript: '低鈉又不要豬肉', policy, invoke, candidates: [{ id: 'intent:search-menu', description: '查成分' }], decisionState: { phase: 'ordering', ingredientReferences: [{ id: 'pork', label: '豬肉' }], unavailableConditionReferences: [{ id: 'sodium', label: '鈉含量（未提供營養數據）' }] } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNSUPPORTED_FILTER' })
    expect(invoke.mock.calls[2]?.[1]).toHaveProperty('unavailable:sodium')
  })
  it('validates question relation only after selecting a checkout answer', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { route: { choice: 'intent:start-checkout', confidence: 0.98 } } })
      .mockResolvedValueOnce({ answers: { relation: { choice: 'intent:start-checkout', confidence: 0.98 } } })
    const result = await decideInteraction({ transcript: '對', policy, invoke, candidates: [{ id: 'intent:start-checkout', description: '開始結帳', requiresHighConfidence: true }], decisionState: { phase: 'ordering', waitingFor: { questionId: 'q', purpose: 'checkout-entry', question: '要結帳嗎？', choices: [{ id: 'intent:start-checkout', description: '開始結帳' }], expiresAt: Date.now() + 30_000 } } })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:start-checkout' })
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[0]?.[1]).toHaveProperty('route')
    expect(invoke.mock.calls[1]?.[1]).toHaveProperty('relation')
    expect(invoke.mock.calls[1]?.[1]).not.toHaveProperty('speech')
  })
  it('keeps state-valid new actions available despite a mistaken ANSWER relation', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => {
      if (questions.requestPurpose)
        return { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 } } }
      if (questions.cartRequest)
        return { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 }, cartRequest: { choice: 'SINGLE', confidence: 0.95 } } }
      if (questions.speech)
        return { answers: { speech: { choice: 'TASK_SPEECH', confidence: 0.98 }, relation: { choice: 'ANSWER', confidence: 0.9 } } }
      const route = questions.route as { criteria: Record<string, string> }
      return { answers: { route: { choice: route.criteria['intent:add-item'] ? 'intent:add-item' : 'intent:defer-question', confidence: 0.95 } } }
    })
    const result = await decideInteraction({ transcript: '周氏蝦捲再兩份', policy, invoke, candidates: [{ id: 'intent:add-item', description: '新增餐點', requiresHighConfidence: true }, { id: 'intent:defer-question', description: '暫緩結帳' }], decisionState: { phase: 'ordering', waitingFor: { questionId: 'q', purpose: 'checkout-entry', question: '要結帳嗎？', choices: [{ id: 'intent:defer-question', description: '暫緩結帳' }], expiresAt: Date.now() + 30_000 } } })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:add-item' })
  })
  it('does not execute a mistaken checkout answer when question relation is uncertain', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => {
      if (questions.relation)
        return { answers: { relation: { choice: 'intent:start-checkout', confidence: 0.18 } } }
      return { answers: { route: { choice: 'intent:start-checkout', confidence: 0.95 } } }
    })
    const result = await decideInteraction({ transcript: '周氏蝦捲再兩份', policy, invoke, candidates: [{ id: 'intent:add-item', description: '新增餐點' }, { id: 'intent:start-checkout', description: '開始結帳' }], decisionState: { phase: 'ordering', waitingFor: { questionId: 'q', purpose: 'checkout-entry', question: '要結帳嗎？', choices: [{ id: 'intent:start-checkout', description: '開始結帳' }], expiresAt: Date.now() + 30_000 } } })
    expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION' })
    expect(invoke).toHaveBeenCalledTimes(2)
  })
  it('distinguishes a new request from consent while a concrete confirmation is pending', async () => {
    const invoke = vi.fn(async (_state: string, _questions: Record<string, unknown>) => ({ answers: { route: { choice: 'NEW_REQUEST', confidence: 0.95 } } }))
    expect(await decideInteraction({ candidates: [{ id: 'intent:confirm:c1', description: '確認清空整車' }, { id: 'intent:cancel-confirmation:c1', description: '取消清空' }], decisionState: { phase: 'pending_confirmation' }, transcript: '不要清空，幫我加水餃', policy, invoke })).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
    expect(invoke.mock.calls[0]?.[1]).toHaveProperty('route.criteria.NEW_REQUEST')
  })
  it('provides phase and role history to every question gate, not just the final route choice', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => {
      if (questions.relation)
        return { answers: { relation: { choice: 'intent:start-checkout', confidence: 0.98 } } }
      return { answers: { route: { choice: 'intent:start-checkout', confidence: 0.98 } } }
    })
    await decideInteraction({ candidates: [{ id: 'intent:start-checkout', description: '開始結帳' }], decisionState: { phase: 'ordering', interactionState: { matchingCartLines: 0, screen: 'cart_review' }, waitingFor: { questionId: 'q', purpose: 'checkout', question: '要結帳嗎？', expiresAt: Date.now() + 30_000, choices: [{ id: 'intent:start-checkout', description: '开始結帳' }] } }, conversation: { messages: [{ role: 'assistant', content: '要結帳嗎？' }] }, transcript: '對', policy, invoke })
    for (const [state] of invoke.mock.calls) {
      expect(state).toContain('目前 phase：ordering')
      expect(state).toContain('目前可見畫面：cart_review')
      expect(state).toContain('"role":"assistant"')
    }
  })
  it('retains every bounded exchange when the provider fails while validating a selected question effect', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { route: { choice: 'intent:start-checkout', confidence: 0.98 } } })
      .mockRejectedValueOnce(new Error('provider offline'))
    const result = await decideInteraction({
      candidates: [{ id: 'intent:start-checkout', description: '開始結帳' }],
      decisionState: { phase: 'ordering', waitingFor: { questionId: 'q1', purpose: 'checkout', question: '要結帳嗎？', expiresAt: Date.now() + 30_000, choices: [{ id: 'intent:start-checkout', description: '開始結帳' }] } },
      transcript: '對',
      policy,
      invoke,
      includeTrace: true,
    })
    expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'PROVIDER_FAILURE', trace: { exchanges: [
      { index: 1, answers: { route: { choice: 'intent:start-checkout' } }, status: 'answered' },
      { index: 2, status: 'failed' },
    ] } })
  })
  it('explains which filter check rejected a read without discarding the original answers', async () => {
    const invoke = async () => ({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, route: { choice: 'intent:search-menu', confidence: 0.95 }, filterRequirement: { choice: 'UNSUPPORTED_FILTER', confidence: 0.9 } } })
    const result = await decideInteraction({ candidates: [{ id: 'intent:search-menu', description: '查菜單' }], decisionState: { phase: 'ordering' }, transcript: '有低鈉的嗎', policy, invoke, includeTrace: true })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNSUPPORTED_FILTER', trace: { exchanges: [expect.objectContaining({ questions: { route: expect.any(Object) } }), expect.objectContaining({ questions: { recipient: expect.any(Object) } }), expect.objectContaining({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, filterRequirement: { choice: 'UNSUPPORTED_FILTER', confidence: 0.9 }, route: { choice: 'intent:search-menu', confidence: 0.95 } } })] } })
  })
  it('rejects an unsupported filter rather than executing an unfiltered menu lookup', async () => {
    const invoke = vi.fn(async (_state: string, _questions: Record<string, unknown>) => ({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, route: { choice: 'intent:search-menu', confidence: 0.95 }, filterRequirement: { choice: 'UNSUPPORTED_FILTER', confidence: 0.95 } } }))
    const result = await decideInteraction({ candidates: [{ id: 'intent:search-menu', description: '查詢菜單' }], decisionState: { phase: 'ordering' }, transcript: '有低鈉的嗎？', policy, invoke, includeTrace: true })
    expect(result.kind).toBe('NEEDS_ASSISTANT')
    expect(invoke.mock.calls[2]?.[1]).toHaveProperty('filterRequirement')
  })
  it('compiles a bounded vegetarian choice to all four meat exclusions, never arbitrary parameters', async () => {
    const invoke = vi.fn(async () => ({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, route: { choice: 'intent:search-menu', confidence: 0.95 }, filterRequirement: { choice: 'COVERED', confidence: 0.95 }, filterPresence: { choice: 'REQUIRED', confidence: 0.95 }, dietary: { choice: 'VEGETARIAN', confidence: 0.95 } } }))
    const result = await decideInteraction({ candidates: [{ id: 'intent:search-menu', description: '查詢菜單' }], decisionState: { phase: 'ordering', dietaryReferences: [{ id: 'vegetarian', label: '素食' }] }, transcript: '有素食嗎？', policy, invoke })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', ingredientFilters: { excludeIngredients: [], includeIngredients: [], dietary: 'vegetarian' } })
  })
  it('fails closed when filter coverage is missing or when a required filter resolves to no slots', async () => {
    for (const answers of [{}, { 'filterRequirement': { choice: 'COVERED', confidence: 0.95 }, 'filterPresence': { choice: 'REQUIRED', confidence: 0.95 }, 'ingredient:pork': { choice: 'NONE', confidence: 0.95 } }]) {
      const invoke = async () => ({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, route: { choice: 'intent:search-menu', confidence: 0.95 }, ...answers } })
      expect(await decideInteraction({ candidates: [{ id: 'intent:search-menu', description: '查詢菜單' }], decisionState: { phase: 'ordering', ingredientReferences: [{ id: 'pork', label: '豬肉' }] }, transcript: '不要豬肉的', policy, invoke })).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
    }
  })
  it('preserves finite ingredient changes on an alternative recommendation', async () => {
    const invoke = vi.fn(async () => ({ answers: { 'recipient': { choice: 'KIOSK', confidence: 0.95 }, 'service': { choice: 'REQUEST', confidence: 0.95 }, 'route': { choice: 'intent:recommend-more', confidence: 0.95 }, 'filterRequirement': { choice: 'COVERED', confidence: 0.95 }, 'filterPresence': { choice: 'REQUIRED', confidence: 0.95 }, 'ingredient:pork': { choice: 'EXCLUDE', confidence: 0.95 } } }))
    const result = await decideInteraction({ transcript: '換一批，不要豬肉', policy, candidates: [{ id: 'intent:recommend-more', description: '沿用條件推薦另一批' }], decisionState: { phase: 'ordering', ingredientReferences: [{ id: 'pork', label: '豬肉' }] }, invoke })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:recommend-more', ingredientFilters: { excludeIngredients: ['pork'], includeIngredients: [] } })
  })
  it('keeps ingredient polarity in finite choices rather than a transcript regex or free parameters', async () => {
    const invoke = vi.fn(async () => ({ answers: { 'recipient': { choice: 'KIOSK', confidence: 0.95 }, 'service': { choice: 'REQUEST', confidence: 0.95 }, 'route': { choice: 'intent:search-menu', confidence: 0.95 }, 'filterRequirement': { choice: 'COVERED', confidence: 0.95 }, 'filterPresence': { choice: 'REQUIRED', confidence: 0.95 }, 'ingredient:pork': { choice: 'EXCLUDE', confidence: 0.95 }, 'ingredient:egg': { choice: 'INCLUDE', confidence: 0.95 } } }))
    const result = await decideInteraction({ transcript: '不要豬肉的，要有蛋', policy, candidates: [{ id: 'intent:search-menu', description: '搜尋符合條件的餐點' }], decisionState: { phase: 'ordering', ingredientReferences: [{ id: 'pork', label: '豬肉' }, { id: 'egg', label: '蛋' }] }, includeTrace: true, invoke })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', ingredientFilters: { excludeIngredients: ['pork'], includeIngredients: ['egg'] }, trace: { ingredientAnswers: { pork: { choice: 'EXCLUDE' } } } })
    expect(invoke).toHaveBeenCalledTimes(3)
  })
  it('routes unrecognized or uncertain ingredient choices to Agent instead of silently dropping the constraint', async () => {
    for (const slot of [{ choice: 'invented', confidence: 0.99 }, { choice: 'EXCLUDE', confidence: 0.1 }]) {
      const invoke = async () => ({ answers: { 'recipient': { choice: 'KIOSK', confidence: 0.95 }, 'service': { choice: 'REQUEST', confidence: 0.95 }, 'route': { choice: 'intent:recommend', confidence: 0.95 }, 'ingredient:pork': slot } })
      expect(await decideInteraction({ transcript: '不要豬肉', policy, candidates: [{ id: 'intent:recommend', description: '推薦符合條件的餐點' }], decisionState: { phase: 'ordering', ingredientReferences: [{ id: 'pork', label: '豬肉' }] }, invoke })).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
    }
  })
  it('does not attach ingredient filters to a cart removal even when pork is mentioned', async () => {
    const invoke = async () => ({ answers: { 'recipient': { choice: 'KIOSK', confidence: 0.95 }, 'service': { choice: 'REQUEST', confidence: 0.95 }, 'route': { choice: 'intent:remove-item', confidence: 0.95 }, 'requestPurpose': { choice: 'OPERATION', confidence: 0.95 }, 'cartRequest': { choice: 'SINGLE', confidence: 0.95 }, 'ingredient:pork': { choice: 'EXCLUDE', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '豬肉便當不要了', policy, candidates: [{ id: 'intent:remove-item', description: '移除現有購物車品項' }], decisionState: { phase: 'ordering', ingredientReferences: [{ id: 'pork', label: '豬肉' }] }, invoke })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:remove-item' })
    expect(result).not.toHaveProperty('ingredientFilters')
  })
  const candidates = [
    { description: 'Add one shrimp roll.', id: 'order:add:shrimp' },
    { description: 'Set the order to take out.', id: 'fulfillment:takeout' },
  ]

  const waitingFor = { questionId: 'Q1', purpose: 'checkout-entry', question: '要進入結帳流程嗎？', expiresAt: Date.now() + 30000, choices: [{ id: 'intent:start-checkout', description: '開始结帳，進入會員與發票步驟。' }, { id: 'intent:defer-question', description: '暫緩結帳，保留訂單。' }] }

  it('validates a refusal without pruning other legal route candidates', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => {
      if (questions.relation)
        return { answers: { relation: { choice: 'intent:defer-question', confidence: 0.8 } } }
      return { answers: { route: { choice: 'intent:defer-question', confidence: 0.95 } } }
    })
    const choices = [...waitingFor.choices, { id: 'intent:add-item', description: '新增水餃', requiresHighConfidence: true }]
    expect(await decideInteraction({ candidates: choices, decisionState: { phase: 'ordering', waitingFor }, conversation: { messages: [{ role: 'assistant', content: waitingFor.question }] }, transcript: '先不要', policy, invoke })).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:defer-question' })
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({ route: { criteria: { 'intent:start-checkout': expect.any(String), 'intent:defer-question': expect.any(String) } } })
    expect(JSON.stringify(invoke.mock.calls[0]?.[1])).toContain('intent:add-item')
  })

  it('ignores background speech in the route without spending a question-relation call', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'IGNORE', confidence: 0.98 } } }))
    expect(await decideInteraction({ candidates: waitingFor.choices, decisionState: { phase: 'ordering', waitingFor }, transcript: '走走走 去那邊', policy, invoke })).toMatchObject({ kind: 'IGNORE' })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('retains an uncertain ordinary answer without executing even a guessed deferral', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => {
      if (questions.relation)
        return { answers: { relation: { choice: 'intent:defer-question', confidence: 0.45 } } }
      return { answers: { route: { choice: 'intent:defer-question', confidence: 0.95 } } }
    })
    expect(await decideInteraction({ candidates: waitingFor.choices, decisionState: { phase: 'ordering', waitingFor }, transcript: '先不要', policy, invoke })).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION' })
    expect(invoke.mock.calls[1]?.[1]).not.toHaveProperty('relation.criteria.ANSWER')
  })

  it('rejects an unverified cart operation without requiring old-question relation', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => {
      if (questions.speech)
        return { answers: { speech: { choice: 'TASK_SPEECH', confidence: 0.98 }, relation: { choice: 'NEW_REQUEST', confidence: 0.8 } } }
      return { answers: { route: { choice: 'intent:add-item', confidence: 0.4 } } }
    })
    expect(await decideInteraction({ candidates: [...waitingFor.choices, { id: 'intent:add-item', description: '新增水餃', requiresHighConfidence: true }], decisionState: { phase: 'ordering', waitingFor }, transcript: '再加兩份水餃', policy, invoke })).toMatchObject({ kind: 'UNAVAILABLE' })
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[0]?.[0]).toContain('正在等待回答的問題：{"questionId":"Q1"')
    expect(invoke.mock.calls[0]?.[1]).not.toHaveProperty('relation')
  })

  it('provides speakers without making an answered price inquiry a pending order', async () => {
    const invoke = vi.fn(async (_state: string) => ({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, route: { choice: 'intent:search-menu' }, filterRequirement: { choice: 'COVERED', confidence: 0.95 }, filterPresence: { choice: 'NO_FILTER', confidence: 0.95 } } }))
    await decideInteraction({ candidates: [{ id: 'intent:search-menu', description: '查菜單' }], conversation: { messages: [{ role: 'user', content: '水餃怎麼賣？' }, { role: 'assistant', content: '一份十顆，60 元。' }] }, decisionState: { phase: 'ordering' }, invoke, policy, transcript: '有牛肉麵嗎' })
    expect(invoke.mock.calls[0]?.[0]).toContain('"role":"assistant"')
    expect(invoke.mock.calls[0]?.[0]).toContain('正在等待回答的問題：null')
  })

  it('reviews a completed result with finite choices, without exposing mutation options', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'SATISFIED', confidence: 0.95 } } }))
    await expect(decideInteraction({ candidates: [{ id: 'continue:recommend', description: '補充推薦' }], invoke, policy, review: { answer: '有水餃、牛肉麵。', observation: '查詢成功' }, transcript: '有賣什麼' })).resolves.toMatchObject({ kind: 'COMPLETE' })
    expect(invoke).toHaveBeenCalledWith(expect.stringContaining('本次已執行結果：查詢成功'), expect.objectContaining({ route: expect.objectContaining({ criteria: { 'SATISFIED': expect.any(String), 'DEVIATED': expect.any(String), 'UNCERTAIN': expect.any(String), 'continue:recommend': '補充推薦' } }) }))
  })

  it('rejects an uncertain operation without a second generic speech classifier', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.speech
      ? { answers: { speech: { choice: 'REQUEST', confidence: 0.9 } } }
      : { answers: { route: { choice: 'intent:add-item', confidence: 0.4 } } })
    const result = await decideInteraction({ candidates: [{ id: 'intent:add-item', description: '新增餐點', requiresHighConfidence: true }], conversation: { messages: [{ role: 'assistant', content: '推薦水餃。' }] }, invoke, policy, transcript: '這個好了' })
    expect(result.kind).toBe('UNAVAILABLE')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

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

    await expect(decideInteraction({ candidates, invoke, maxActionCandidates: 1, policy, transcript: '第二個' })).resolves.toEqual({ kind: 'UNAVAILABLE', reason: 'CANDIDATE_BUDGET' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('never uses lexical sorting to rescue menu-times-intent candidate expansion', async () => {
    const candidates = [
      { description: '查詢「周氏蝦捲招牌便當」分類。', id: 'intent:search-menu:shrimp' },
      { description: '查詢「椒麻雞便當」分類。', id: 'intent:search-menu:chicken' },
      { description: '查詢「牛肉麵」分類。', id: 'intent:search-menu:beef-noodles' },
    ]
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'intent:search-menu:beef-noodles' } } }))

    await expect(decideInteraction({ candidates, invoke, maxActionCandidates: 1, policy, transcript: '牛肉麵有什麼' })).resolves.toEqual({ kind: 'UNAVAILABLE', reason: 'CANDIDATE_BUDGET' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not convert unexpected model output into an action', async () => {
    await expect(decideInteraction({
      candidates,
      invoke: async () => ({ answers: { route: { choice: 'checkout:pay-now' } } }),
      policy,
      transcript: '幫我直接結帳',
    })).resolves.toEqual({ kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE' })
  })

  it('keeps an unfinished ordering utterance out of both WebMCP and the Main Agent', async () => {
    await expect(decideInteraction({
      candidates,
      invoke: async () => ({ answers: { route: { choice: 'INCOMPLETE', confidence: 0.95 } } }),
      policy,
      transcript: '我要一份',
    })).resolves.toEqual({ kind: 'INCOMPLETE', confidence: 0.95 })
  })

  it('does not offer a model-generated clarification outcome', async () => {
    await expect(decideInteraction({
      candidates,
      invoke: async () => ({ answers: { route: { choice: 'CLARIFICATION' } } }),
      policy,
      transcript: '幫我改成兩份',
    })).resolves.toEqual({ kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE' })
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
      route: expect.objectContaining({ criteria: expect.objectContaining({ CLARIFICATION: expect.any(String), IGNORE: expect.any(String) }), instructions: expect.stringContaining('真實 target 候選') }),
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
