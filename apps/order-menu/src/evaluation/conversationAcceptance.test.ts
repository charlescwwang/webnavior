import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it } from 'vitest'

import { createMenuToolRuntime } from '../webmcp'
import { applyAcceptancePolicy } from './conversationAcceptance'
import { conversationScripts } from './conversationMatrix'
import { assessScriptTurn } from './conversationOracle'
import { historyData } from './historyData'
import { incidentConversationScripts } from './orderingIncidents'

// Report: user Nov4 confirmed hearing/closing silence and whole mixed-quantity refusal.
it('accepts optional hearing responses but rejects unrequested state changes and hidden timeouts', async () => {
  const original = conversationScripts.find(script => script.id === 'D10')!
  const originalText = JSON.stringify(original)
  const current = applyAcceptancePolicy(original).script.steps.find(step => step.preserveState && !step.fault)!
  const runtime = createMenuToolRuntime({ menu: historyData.catalog, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const observed = { before, after: before, menu: historyData.catalog, answer: '', shownHistory: new Set<string>(), checkoutStarts: 0 }
  expect(assessScriptTurn(current, observed)).toEqual([])
  expect(assessScriptTurn(current, { ...observed, answer: '有收到。' })).toEqual([])
  expect(assessScriptTurn(current, { ...observed, technicalFailure: 'timeout' })).toContain('Technical failure: timeout')
  await runtime.invoke('menu_recommend', { action: 'update' })
  const after = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(assessScriptTurn(current, { ...observed, after })).toContain('Read-only remark changed navigation, selection or checkout state')
  expect(JSON.stringify(original)).toBe(originalText)
})

it('allows a harmless closing acknowledgement while keeping companion speech strictly silent', async () => {
  const runtime = createMenuToolRuntime({ menu: historyData.catalog, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const observed = { before, after: before, menu: historyData.catalog, answer: '好的，您先看看。', shownHistory: new Set<string>(), checkoutStarts: 0 }
  const closing = applyAcceptancePolicy(conversationScripts.find(script => script.id === 'D08')!).script.steps[1]!
  expect(assessScriptTurn(closing, observed)).toEqual([])
  expect(assessScriptTurn(closing, { ...observed, answer: '' })).toEqual([])
  const companion = applyAcceptancePolicy(conversationScripts.find(script => script.id === 'D01')!).script.steps[0]!
  expect(assessScriptTurn(companion, observed)).toContain('Background/idle turn produced a customer reply')
})

it.each(['C03-A1', 'C09-A1'])('allows a read-only pause for %s without requiring an acknowledgement', async (id) => {
  const source = conversationScripts.find(script => script.id === id)!
  const step = applyAcceptancePolicy(source).script.steps[1]!
  const runtime = createMenuToolRuntime({ menu: historyData.catalog, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const observed = { before, after: before, menu: historyData.catalog, answer: '', shownHistory: new Set<string>(), checkoutStarts: 0, service: { admission: 'service' as const, meaning: 'pause' as const } }
  expect(assessScriptTurn(step, observed)).toEqual([])
  expect(step.preserveState).toBe(true)
  expect(step.forbidden).toBe(source.steps[1]!.forbidden)
  expect(source.steps[1]!.silentAllowed).toBeUndefined()
  expect(assessScriptTurn(step, { ...observed, technicalFailure: 'timeout' })).toContain('Technical failure: timeout')
})

it.each(['P02-A2', 'I03-C-A1', 'I03-N-A1', 'I03-T-A1', 'I04-C-A1', 'I04-N-A2', 'I04-T-A2'])('allows silence for %s without releasing its invoice state and prohibition checks', (id) => {
  const original = incidentConversationScripts.find(script => script.id === id)!
  const revised = applyAcceptancePolicy(original).script.steps[0]!
  expect(revised.silentAllowed).toBe(true)
  expect(revised.preserveState).toBe(true)
  expect(revised.phase).toBe(original.steps[0]!.phase)
  expect(revised.forbidden).toBe(original.steps[0]!.forbidden)
  expect(original.steps[0]!.silentAllowed).toBeUndefined()
})

it('accepts both complete mixed-quantity outcomes without accepting reduced or extra meals', async () => {
  const original = incidentConversationScripts.find(script => script.id === 'Q01-J-A2')!
  const current = applyAcceptancePolicy(original).script.steps[0]!
  const runtime = createMenuToolRuntime({ menu: historyData.catalog, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const snapshot = async () => parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
  await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
  const before = await snapshot()
  const observe = (after: typeof before) => ({ before, after, menu: historyData.catalog, answer: '每種餐點最多20份，超量部分未加入。', shownHistory: new Set<string>(), checkoutStarts: 0 })
  expect(assessScriptTurn(current, observe(before))).toEqual([])
  await runtime.invoke('order_add_item', { itemId: 'fried-pork-chop-bento', quantity: 1 })
  expect(assessScriptTurn(current, observe(await snapshot()))).toEqual([])
  await runtime.invoke('order_add_item', { itemId: 'signature-shrimp-roll-bento', quantity: 20 })
  expect(assessScriptTurn(current, observe(await snapshot()))).toContain('Cart matches none of the approved complete outcomes')
  expect(original.steps[0]!.cart).toHaveLength(2)
})

it('still requires a real price answer for an ordinary menu inquiry', async () => {
  const current = applyAcceptancePolicy(conversationScripts.find(script => script.id === 'C11-A2')!).script.steps[1]!
  const runtime = createMenuToolRuntime({ menu: historyData.catalog, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const observed = { before, after: before, menu: historyData.catalog, answer: '', shownHistory: new Set<string>(), checkoutStarts: 0 }
  expect(assessScriptTurn(current, observed)).toContain('Missing customer reply')
  expect(assessScriptTurn(current, { ...observed, answer: '水餃每份80元。' })).toEqual([])
})

// Report: Nov4 user clarification: silent background and accepted pauses are different.
it('rejects a pause misclassified as background even when no reply or order change occurs', async () => {
  const runtime = createMenuToolRuntime({ menu: historyData.catalog, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const step = { ...applyAcceptancePolicy(conversationScripts.find(script => script.id === 'C03-A1')!).script.steps[1]!, admission: ['service' as const], meaning: 'pause' as const }
  const observed = { before, after: before, menu: historyData.catalog, answer: '', shownHistory: new Set<string>(), checkoutStarts: 0, service: { admission: 'background' as const } }
  expect(assessScriptTurn(step, observed)).toContain('Expected service admission service, received background')
  expect(assessScriptTurn(step, { ...observed, service: { admission: 'service', meaning: 'pause' } })).toEqual([])
})

it('rejects an admitted background fragment even when it stays silent and cannot edit the order', async () => {
  const runtime = createMenuToolRuntime({ menu: historyData.catalog, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const step = { ...applyAcceptancePolicy(conversationScripts.find(script => script.id === 'D01')!).script.steps[0]!, admission: ['background' as const, 'uncertain' as const], admissionAdvisory: false }
  const observed = { before, after: before, menu: historyData.catalog, answer: '', shownHistory: new Set<string>(), checkoutStarts: 0, service: { admission: 'service' as const } }
  expect(assessScriptTurn(step, observed)).toContain('Expected service admission background/uncertain, received service')
  expect(assessScriptTurn(step, { ...observed, service: { admission: 'uncertain' } })).toEqual([])
  expect(assessScriptTurn(step, { ...observed, service: undefined })).toContain('Expected service admission background/uncertain, received unobserved')
})

// Report: Nov4 user accepts a held-silent classification error, not background adoption.
it('keeps class observations advisory while requiring silence and unchanged cart', async () => {
  const runtime = createMenuToolRuntime({ menu: historyData.catalog, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const step = applyAcceptancePolicy(conversationScripts.find(script => script.id === 'D01')!).script.steps[0]!
  const observed = { before, after: before, menu: historyData.catalog, answer: '', shownHistory: new Set<string>(), checkoutStarts: 0, service: { admission: 'service' as const } }
  expect(step.admissionAdvisory).toBe(true)
  expect(assessScriptTurn(step, observed)).toEqual([])
  expect(assessScriptTurn(step, { ...observed, answer: '請問要吃什麼？' })).toContain('Background/idle turn produced a customer reply')
})

it('retains uncommon invoice refusal failures as advisory without changing historical gold', () => {
  const original = incidentConversationScripts.find(script => script.id === 'I04-C-A1')!
  expect(applyAcceptancePolicy(original).revision.gate).toBe('advisory')
  expect(applyAcceptancePolicy(incidentConversationScripts.find(script => script.id === 'I04-T-A2')!).revision.gate).toBe('required')
  expect(original.steps[0]!.text).toBe('先不要送出')
})

it('accepts only a preserved-state return question for an invoice edit', async () => {
  const runtime = createMenuToolRuntime({ menu: historyData.catalog, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const snapshot = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const before = { ...snapshot, phase: 'checkout_tax_id', checkout: { stage: 'tax-id', taxId: '12345678', carrierRegistered: false, citizenRegistered: false } }
  const after = { ...before, phase: 'pending_confirmation', waitingFor: { questionId: 'return', purpose: 'operation-confirmation' as const, question: '要取消目前結帳並回到訂單嗎？', expiresAt: Date.now() + 30000, choices: [] } }
  const step = applyAcceptancePolicy(incidentConversationScripts.find(script => script.id === 'I04-T-A2')!).script.steps[0]!
  const observed = { before, after, menu: historyData.catalog, answer: after.waitingFor.question, shownHistory: new Set<string>(), checkoutStarts: 0 }
  // This test owns the initial cart independently of the historical invoice fixture.
  const policy = { ...step, cart: undefined }
  expect(assessScriptTurn(policy, observed)).toEqual([])
  expect(assessScriptTurn(policy, { ...observed, after: { ...after, checkout: { ...after.checkout, taxId: undefined } } })).toContain('Read-only remark changed navigation, selection or checkout state')
  expect(assessScriptTurn(policy, { ...observed, after: { ...after, phase: 'ordering' } })).toContain('Expected phase checkout_tax_id, received ordering')
})
