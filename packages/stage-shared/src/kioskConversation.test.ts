import { parse, safeParse } from 'valibot'
import { expect, it } from 'vitest'

import { contextReplySchema, conversationContextSchema, conversationRequestSchema, formatOrderingPrice, intentRecoverySchema, normalizeOrderingPrices, replyFromContext } from './kioskConversation'

const draft = { id: 'draft', itemId: 'meal', status: 'active', options: [], missing: { quantity: true, optionGroupIds: [] }, expectedRevisions: { menu: 1 } }

it('keeps an unknown quantity absent instead of inventing one serving', () => {
  const result = safeParse(conversationRequestSchema, draft)
  expect(result.success).toBe(true)
  expect(result.output).not.toHaveProperty('quantity')
})

it.each([0, 21, 1.5])('rejects an invalid retained quantity: %s', (quantity) => {
  expect(safeParse(conversationRequestSchema, { ...draft, quantity, missing: { quantity: false, optionGroupIds: [] } }).success).toBe(false)
})

it('rejects contradictory known and missing slot facts', () => {
  expect(safeParse(conversationRequestSchema, { ...draft, quantity: 2 }).success).toBe(false)
  expect(safeParse(conversationRequestSchema, { ...draft, missing: { quantity: false, optionGroupIds: [] } }).success).toBe(false)
  expect(safeParse(conversationRequestSchema, { ...draft, options: [{ groupId: 'size', valueId: 'large' }], missing: { quantity: true, optionGroupIds: ['size'] } }).success).toBe(false)
})

it('rejects two values for the same option group', () => {
  expect(safeParse(conversationRequestSchema, { ...draft, options: [{ groupId: 'size', valueId: 'large' }, { groupId: 'size', valueId: 'small' }] }).success).toBe(false)
})

it('requires an answer scope to identify its question and contain unique issued effects', () => {
  expect(safeParse(intentRecoverySchema, { kind: 'answer', candidateIds: ['one'] }).success).toBe(false)
  expect(safeParse(intentRecoverySchema, { kind: 'answer', questionId: 'current', candidateIds: [] }).success).toBe(false)
  expect(safeParse(intentRecoverySchema, { kind: 'request', candidateIds: ['one', 'one'] }).success).toBe(false)
  expect(safeParse(intentRecoverySchema, { kind: 'answer', questionId: 'current', requestId: 'draft', candidateIds: ['one'] }).success).toBe(true)
})

// Report: C01-F1 live112 smoke: identity incorrectly displayed a generic greeting.
it('answers identity and unavailable store facts without inventing a transaction or location', () => {
  const context = parse(conversationContextSchema, { contextId: 'identity', capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 0, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] })
  expect(replyFromContext('{"kind":"service-information","topic":"identity"}', context)?.content).toContain('助手')
  expect(replyFromContext('{"kind":"service-information","topic":"location"}', context)?.content).toMatch(/服務人員確認|協助查菜單/)
  expect(replyFromContext('{"kind":"service-information","topic":"hours"}', context)?.content).toMatch(/服務人員確認|協助查菜單/)
  expect(replyFromContext('{"kind":"service-information","topic":"made-up"}', context)).toBeUndefined()
})

// Report: this chat, Nov2; rejected bulk orders must use the current Menu policy.
it('renders quantity refusal only from an available policy after entry is complete', () => {
  const context = parse(conversationContextSchema, { contextId: 'quantity', capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 0, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [], quantityPolicy: { maximum: 20, message: '每種餐點最多20份，購物車仍保留。' } })
  expect(replyFromContext('{"kind":"quantity-limit"}', context)?.content).toBe(context.quantityPolicy?.message)
  expect(replyFromContext('{"kind":"quantity-limit"}', { ...context, quantityPolicy: undefined })).toBeUndefined()
  expect(replyFromContext('{"kind":"quantity-limit"}', { ...context, entryComplete: false })).toBeUndefined()
})

// Report: this chat,Nov5 — currency prefixes must not be displayed or synthesized.
it('renders prices with 元 and normalizes only monetary tokens in assistant prose', () => {
  expect(formatOrderingPrice(145)).toBe('145元')
  expect(formatOrderingPrice(1200)).toBe('1,200元')
  expect(normalizeOrderingPrices('便當 NT$145、水餃 $80、NTD 1,200元、TWD150、NT 80。')).toBe('便當 145元、水餃 80元、1,200元、150元、80元。')
  expect(normalizeOrderingPrices('第1份，NT服務，電話0912345678。')).toBe('第1份，NT服務，電話0912345678。')
})

it('distinguishes missing service data from the ordering assistant scope', () => {
  const context = parse(conversationContextSchema, { contextId: 'scope', capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 0, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] })
  const missing = replyFromContext('{"kind":"service-information","topic":"other"}', context)!
  expect(missing.content).toMatch(/服務人員確認|協助查菜單/)
  expect(missing.content).not.toContain('理解')
  expect(replyFromContext('{"kind":"service-information","topic":"capabilities"}', context)?.content).toContain('餐點名稱和份數')
})

// Report: N05-UX-RANKING live reply selected clarification/topic:other for missing sales data.
it('rejects an unavailable-information topic masquerading as unclear meaning', () => {
  expect(safeParse(contextReplySchema, { kind: 'clarification', topic: 'other' }).success).toBe(false)
  expect(safeParse(contextReplySchema, { kind: 'service-information', topic: 'other' }).success).toBe(true)
  expect(safeParse(contextReplySchema, { kind: 'clarification' }).success).toBe(true)
  expect(safeParse(contextReplySchema, { kind: 'clarification', topic: 'menu-kind' }).success).toBe(true)
})

it('varies fixed ordering replies by turn while keeping one turn stable', () => {
  const context = parse(conversationContextSchema, { contextId: 'a', capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 0, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] })
  const greetings = ['a', 'b', 'c'].map(contextId => replyFromContext('{"kind":"greeting"}', { ...context, contextId })?.content)
  expect(new Set(greetings).size).toBe(3)
  for (const greeting of greetings) {
    expect(greeting).toContain('菜單')
    expect(greeting).toContain('台語點餐')
  }
  expect(replyFromContext('{"kind":"greeting"}', context)).toEqual(replyFromContext('{"kind":"greeting"}', context))
  expect(new Set(['a', 'b', 'c'].map(contextId => replyFromContext('{"kind":"acknowledgement"}', { ...context, contextId })?.content)).size).toBe(3)
})

// Report: this chat, 2026-11-06 — out-of-scope replies must not imply future support or refer to staff.
it('renders a normal, concise scope refusal without staff referral or implied future support', () => {
  const context = parse(conversationContextSchema, { contextId: 'outside', capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 0, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] })
  const reply = replyFromContext('{"kind":"service-information","topic":"out-of-scope"}', context)
  expect(reply?.content).toBe('我是點餐助手，可以幫您看菜單、選餐和確認訂單。您想吃什麼？')
  expect(reply?.content).not.toMatch(/目前沒有|暫時不支援|還沒有|店員/)
  expect(reply?.kind).toBe('service-information')
})

it.each(['other', 'location', 'hours'])('states missing information directly without promising a human answer: %s', (topic) => {
  const context = parse(conversationContextSchema, { contextId: 'missing', capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 0, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] })
  const reply = replyFromContext(JSON.stringify({ kind: 'service-information', topic }), context)
  expect(reply?.content).toMatch(/服務人員確認|協助查菜單/)
  expect(reply?.content).not.toMatch(/目前沒有|暫時不支援|還沒有|店員/)
})

// Report: this chat Nov7; ordinary staff assistance must not enter the service-fault lock.
it('regression K1107-STAFF renders only an offered and current simulated assistance response', () => {
  const context = parse(conversationContextSchema, { contextId: 'staff', capturedAt: Date.now(), entryComplete: true, readOnly: true, constraints: { excludeIngredients: ['pork'], includeIngredients: [] }, unavailableConditions: [{ id: 'allergen-safety', label: '過敏安全' }], phase: 'ordering', revisions: { menu: 1, cart: 1, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] })
  expect(replyFromContext('{"kind":"staff-assistance","action":"offer"}', context)?.content).toBe('這項要求需要服務人員確認，需要幫您呼叫嗎？')
  expect(replyFromContext('{"kind":"staff-assistance","action":"accept"}', context)).toBeUndefined()
  const current = parse(conversationContextSchema, { ...context, staffAssistance: { questionId: 'staff-question', expiresAt: Date.now() + 30000 } })
  expect(replyFromContext('{"kind":"staff-assistance","action":"accept"}', current)?.content).toBe('已經呼叫工作人員，您想先看看哪道餐點？')
  expect(replyFromContext('{"kind":"staff-assistance","action":"decline"}', current)?.content).toBe('好的，接下來想點什麼餐點？')
  const expired = parse(conversationContextSchema, { ...current, staffAssistance: { questionId: 'staff-question', expiresAt: Date.now() - 1 } })
  expect(replyFromContext('{"kind":"staff-assistance","action":"accept"}', expired)).toBeUndefined()
  expect(current.constraints.excludeIngredients).toEqual(['pork'])
})

// Report: this chat Nov7; the typed missing-category path must not revive abstract guidance.
it('regression K1107-GUIDE gives a concrete next action without inventing categories or budget', () => {
  const context = parse(conversationContextSchema, { contextId: 'kind', capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 0, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] })
  const reply = replyFromContext('{"kind":"clarification","topic":"menu-kind"}', context)
  expect(reply?.content).not.toMatch(/哪一類|種類|別類|價位|預算/)
  expect(reply?.content).toContain('餐點名稱')
  expect(reply?.content).toContain('畫面')
})

// Report: this chat Nov7 — service limitations should not blame insufficient data.
it.each(['other', 'location', 'hours'])('avoids data-insufficiency wording while retaining an honest service limitation: %s', (topic) => {
  const context = parse(conversationContextSchema, { contextId: 'service-boundary', capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 0, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] })
  const reply = replyFromContext(JSON.stringify({ kind: 'service-information', topic }), context)!
  expect(reply.content).not.toMatch(/資料不足|資訊不足/)
  expect(reply.content).toMatch(/服務人員確認|協助查菜單/)
  expect(reply.content).toMatch(/菜單|選餐|點餐|訂單|服務人員/)
  expect(reply.content).toMatch(/？$/)
  if (topic !== 'other')
    expect(reply).toMatchObject({ kind: 'staff-assistance', action: 'offer' })
})

// Report: this chat Nov7 — sales-unit guidance generalizes across menu names and units.
it.each([
  { name: '水餃', description: '每份10顆，現點現煮' },
  { name: '煎餃', description: '每份8顆' },
  { name: '招牌飯', description: '每盒一份' },
  { name: '紅茶', description: '每杯500毫升' },
])('renders only merchant unit facts without conversion or order authority: $name', ({ name, description }) => {
  const context = parse(conversationContextSchema, { contextId: 'units', capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [], catalog: { complete: true, itemCount: 1, items: [{ id: 'meal', name, aliases: [], category: '餐點', price: 80, description, availability: 'available', optionGroups: [] }] } })
  const selection = { kind: 'service-information', topic: 'ordering-units', subjects: [name] }
  const reply = replyFromContext(JSON.stringify(selection), context)!
  expect(reply.content).toContain(name)
  expect(reply.content).toContain(description)
  expect(reply.content).toContain('請依菜單標示的單位點餐')
  expect(reply.content).not.toMatch(/加入|三份|3份|資訊不足|資料不足/)
  expect(replyFromContext(JSON.stringify(selection), { ...context, catalog: undefined })).toBeUndefined()
  expect(safeParse(contextReplySchema, { kind: 'service-information', topic: 'ordering-units' }).success).toBe(false)
})

// Report: this chat, Nov7 — a single-item explanation should lead into ordering.
it.each(['available', 'sold-out', 'unknown'] as const)('offers quantity guidance only for a single available exact item: %s', (availability) => {
  const context = parse(conversationContextSchema, { contextId: 'intro', capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [], catalog: { complete: true, itemCount: 1, items: [{ id: 'meal', name: '餐點', aliases: [], category: '便當', price: 80, availability, optionGroups: [] }] } })
  const reply = replyFromContext(JSON.stringify({ kind: 'menu-information', subjects: ['餐點'] }), context)!
  expect(reply.content.includes('要點幾份')).toBe(availability === 'available')
  expect(reply).not.toHaveProperty('action')
  expect(replyFromContext(JSON.stringify({ kind: 'menu-information', subjects: ['其他餐點'] }), context)?.content).not.toContain('要點幾份')
})

// Report: this chat, Nov7 — operator identity and confirmed special-order assistance.
it('answers the operator separately from the assistant identity', () => {
  const context = parse(conversationContextSchema, { merchant: { id: 'operator-store', operatorName: '周氏蝦捲', paymentPolicy: 'unknown' }, contextId: 'operator', capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] })
  expect(replyFromContext(JSON.stringify({ kind: 'service-information', topic: 'operator' }), context)?.content).toBe('本機點餐服務的營運業者是周氏蝦捲。您想查詢哪道餐點？')
  expect(replyFromContext(JSON.stringify({ kind: 'service-information', topic: 'identity' }), context)?.content).toContain('點餐助手')
})

it('requires separate current intent and staff consent before presenting a simulated staff call', () => {
  const context = parse(conversationContextSchema, { contextId: 'special', sourceUtterance: '菜單上的通通來一份', capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] })
  const render = (action: string, facts = context) => replyFromContext(JSON.stringify({ kind: 'staff-assistance', action }), facts)
  expect(render('confirm-order')?.content).toContain('菜單上的通通來一份')
  expect(render('offer')).toBeUndefined()
  expect(render('accept')).toBeUndefined()
  const confirmed = parse(conversationContextSchema, { ...context, orderAssistance: { questionId: 'intent', expiresAt: Date.now() + 30000 } })
  expect(render('offer', confirmed)?.content).toContain('需要幫您通知服務人員嗎')
  expect(render('offer', confirmed)?.content).toContain('份數上限')
  expect(render('accept', confirmed)).toBeUndefined()
  expect(render('decline', confirmed)?.content).toContain('接下來想點什麼餐點')
  expect(render('offer', { ...confirmed, orderAssistance: { questionId: 'expired', expiresAt: Date.now() - 1 } })).toBeUndefined()
  const invited = { ...context, staffAssistance: { questionId: 'staff', expiresAt: Date.now() + 30000 } }
  expect(render('accept', invited)?.content).toBe('已經呼叫工作人員，您想先看看哪道餐點？')
  expect(render('accept', invited)).not.toHaveProperty('operation')
})

// Report: this chat, Nov8 — acknowledgement must guide the next customer turn.
it('ends acknowledgement variants with a useful question without an operation', () => {
  for (const contextId of ['ack-a', 'ack-b', 'ack-c', 'ack-d', 'ack-e', 'ack-f']) {
    const context = parse(conversationContextSchema, { contextId, capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] })
    const reply = replyFromContext(JSON.stringify({ kind: 'acknowledgement' }), context)!
    expect(reply.content).toMatch(/？$/)
    expect(reply).not.toHaveProperty('action')
  }
})

// Report: this chat, Nov08; a price detour must not replace the current option question with quantity guidance.
it('answers information and keeps the one current Menu question', () => {
  const context = parse(conversationContextSchema, { contextId: 'price-detour', capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'configuration', revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [], waitingFor: { questionId: 'size', purpose: 'item-configuration', question: '請問要小份還是大份？', expiresAt: Date.now() + 30000, choices: [{ id: 'small', description: '小份' }, { id: 'large', description: '大份' }] }, catalog: { complete: true, itemCount: 1, items: [{ id: 'rice', name: '雞肉飯', aliases: [], category: '飯', price: 95, availability: 'available', optionGroups: [] }] } })
  const reply = replyFromContext('{"kind":"menu-information","subjects":["雞肉飯"]}', context)!
  expect(reply.content).toContain('95元')
  expect(reply.content.endsWith('請問要小份還是大份？')).toBe(true)
  expect(reply.content).not.toContain('幾份')
  expect(reply.content.match(/？/g)).toHaveLength(1)
})

it('does not treat refusing nutritional assistance as dropping the nutritional requirement', () => {
  const context = parse(conversationContextSchema, { contextId: 'nutrition', capturedAt: 1, entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [], unavailableConditions: [{ id: 'fat', label: '低脂' }], staffAssistance: { questionId: 'staff', expiresAt: Date.now() + 30000 } })
  const reply = replyFromContext('{"kind":"staff-assistance","action":"decline"}', context)!
  expect(reply.kind).toBe('clarification')
  expect(reply.content).toBe('好的，目前仍無法依營養條件推薦。您想改用餐點名稱來選餐嗎？')
  expect(reply).not.toHaveProperty('operation')
})

// Report: this chat, Nov08 — simulated checkout methods were announced as merchant payment support.
it('uses verified merchant payment facts while retaining the current question', () => {
  const context = parse(conversationContextSchema, { contextId: 'payment', capturedAt: Date.now(), entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, phase: 'ordering', revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], paymentMethods: [{ id: 'linepay', label: 'LINE Pay' }], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [], merchant: { id: 'new-merchant', operatorName: '周氏蝦捲', paymentPolicy: 'cashless' }, waitingFor: { questionId: 'quantity', purpose: 'item-configuration', question: '這道餐點要點幾份？', choices: [], expiresAt: Date.now() + 30000 } })
  const reply = replyFromContext('{"kind":"payment-methods"}', context)!
  expect(reply.content).toContain('本店採無現金支付')
  expect(reply.content).not.toContain('LINE Pay')
  expect(reply.content.match(/？/g)).toHaveLength(1)
  expect(reply.content.endsWith(context.waitingFor!.question)).toBe(true)
  const unknown = replyFromContext('{"kind":"payment-methods"}', { ...context, merchant: { id: 'another', paymentPolicy: 'unknown' } })!
  expect(unknown.content).not.toContain('無現金')
  const verified = replyFromContext('{"kind":"payment-methods"}', { ...context, merchant: { id: 'another', paymentPolicy: 'cashless', paymentMethods: [{ id: 'confirmed-card', label: '信用卡' }] } })!
  expect(verified.content).toContain('目前支援信用卡')
  expect(verified.content).not.toContain('LINE Pay')
})
