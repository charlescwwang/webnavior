import validators from 'virtual:menu-tool-validators'

import { expect, it } from 'vitest'

it('checks nested tool inputs, integers, bounds and exact fields without modifying them', () => {
  const valid = { input: { itemId: 'dish', quantity: 2, options: [{ groupId: 'spice', valueId: 'hot' }] }, enums: {} }
  const before = structuredClone(valid)
  expect(validators.order_add_item!(valid)).toBe(true)
  expect(valid).toEqual(before)
  expect(validators.order_add_item!({ input: { itemId: 'dish', quantity: '2' }, enums: {} })).toBe(false)
  // Business limits return a typed refusal; schema must preserve the original count.
  expect(validators.order_add_item!({ input: { itemId: 'dish', quantity: 200 }, enums: {} })).toBe(true)
  expect(validators.order_add_item!({ input: { itemId: 'dish', options: [{ groupId: 'spice' }] }, enums: {} })).toBe(false)
  expect(validators.order_add_item!({ input: { itemId: 'dish', options: [{ groupId: 'spice', valueId: 'hot', extra: true }] }, enums: {} })).toBe(false)
})

it('uses the current POS capability enum and retains non-top-level constraints', () => {
  expect(validators.order_set_fulfillment!({ input: { mode: 'takeout' }, enums: { mode: ['takeout'] } })).toBe(true)
  expect(validators.order_set_fulfillment!({ input: { mode: 'dine-in' }, enums: { mode: ['takeout'] } })).toBe(false)
  expect(validators.menu_recommend!({ input: { action: 'update', category: '便當' }, enums: { action: ['update', 'continue', 'reset', 'clarify'], category: ['便當'] } })).toBe(true)
  expect(validators.menu_recommend!({ input: { action: 'update', category: '便當', includeIngredients: ['invented'] }, enums: {} })).toBe(false)
  expect(validators.menu_get!({ input: { queries: ['水餃', '水餃'] }, enums: {} })).toBe(false)
})

it('validates the bound confirmation identifier and affirmative or negative answer', () => {
  expect(validators.order_answer_confirmation!({ input: { confirmationId: 'ticket', confirmedByUser: true }, enums: {} })).toBe(true)
  expect(validators.order_answer_confirmation!({ input: { confirmationId: 'ticket', confirmedByUser: false }, enums: {} })).toBe(true)
  expect(validators.order_answer_confirmation!({ input: { confirmationId: 'ticket', confirmedByUser: '確認' }, enums: {} })).toBe(false)
  expect(validators.order_answer_confirmation!({ input: { confirmedByUser: true }, enums: {} })).toBe(false)
})

// Report: this chat Nov8 — 鱔魚意麵 after declining the recommendation path failed before Main started.
it('accepts literal meal subjects on host task binding while retaining strict input validation', () => {
  const input = { action: 'BEGIN', taskId: 'new-meal', transcript: '我想吃鱔魚意麵', expectedMenuRevision: 0, constraints: {}, handoff: { intent: 'ADD_ONLY', subjects: ['鱔魚意麵'], status: 'ambiguous', itemIds: [], lineIds: [] } }
  expect(validators.kiosk_agent_task!({ input, enums: {} })).toBe(true)
  expect(validators.kiosk_agent_task!({ input: { ...input, handoff: { ...input.handoff, subjects: [42] } }, enums: {} })).toBe(false)
  expect(validators.kiosk_agent_task!({ input: { ...input, handoff: { ...input.handoff, subjects: Array.from({ length: 21 }).fill('水餃') } }, enums: {} })).toBe(false)
  expect(validators.kiosk_agent_task!({ input: { ...input, handoff: { ...input.handoff, subjects: ['魚'.repeat(501)] } }, enums: {} })).toBe(false)
  expect(validators.kiosk_agent_task!({ input: { ...input, handoff: { ...input.handoff, inventedAuthority: true } }, enums: {} })).toBe(false)
})
