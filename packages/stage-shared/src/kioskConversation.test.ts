import { parse, safeParse } from 'valibot'
import { expect, it } from 'vitest'

import { conversationContextSchema, conversationRequestSchema, intentRecoverySchema, replyFromContext } from './kioskConversation'

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
