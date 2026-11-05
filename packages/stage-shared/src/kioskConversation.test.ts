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
  expect(replyFromContext('{"kind":"service-information","topic":"location"}', context)?.content).toContain('未提供')
  expect(replyFromContext('{"kind":"service-information","topic":"hours"}', context)?.content).toContain('未提供')
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
  expect(missing.content).toContain('沒有可確認的這項資料')
  expect(missing.content).not.toContain('理解')
  expect(replyFromContext('{"kind":"service-information","topic":"capabilities"}', context)?.content).toContain('其他事項請洽現場店員')
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
