import { expect, it } from 'vitest'

import { historicalSupplierCatalog as supplierCatalog } from '../../order-menu-server/src/fixtures/historicalSupplierCatalog'
import { applySupplierOrdering } from './supplierOrdering'
import { createMenuToolRuntime } from './webmcp'

function setup() {
  return createMenuToolRuntime({ menu: applySupplierOrdering(supplierCatalog.items), merchant: { id: 'shalun-simulation', operatorName: '周氏蝦捲', paymentPolicy: 'cashless' }, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: () => {}, onMenuRequested: () => {} })
}

// A true alias no longer needs identity consent; use an actual name mismatch to exercise that boundary.
async function proposedDumplings() {
  const runtime = setup()
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'dumplings', transcript: '我要周氏水絞', expectedMenuRevision: 0, constraints: {} })
  await runtime.invoke('kiosk_conversation_context')
  const lookup = await runtime.invokeForAgent('menu_get', { query: '周氏水絞' })
  await runtime.invoke('kiosk_conversation_context')
  const proposed = await runtime.invokeForAgent('menu_confirm_item', { itemId: 'supplier-item-08' }) as { pendingCustomerChoice: { questionId: string, question: string } }
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'dumplings' })
  await runtime.invoke('kiosk_dialogue_presented', { questionId: proposed.pendingCustomerChoice.questionId, content: proposed.pendingCustomerChoice.question })
  const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '好' }) as { candidates: Array<{ id: string }> }
  const configuration = await runtime.invoke('kiosk_fast_path_execute', { candidateId: answer.candidates.find(choice => choice.id.endsWith(':yes'))!.id })
  return { runtime, lookup, configuration }
}

// Report: this chat Nov09 — availability lookup followed by identity confirmation asked two questions.
it('leaves the sole purchase question to the owned identity confirmation', async () => {
  const { lookup, configuration } = await proposedDumplings()
  expect(lookup).not.toHaveProperty('customerReply.nextQuestion')
  expect(lookup).not.toHaveProperty('pendingCustomerChoice')
  expect(configuration).toHaveProperty('pendingCustomerChoice.question', expect.stringContaining('要加量嗎'))
})

// Report: this chat Nov09 — 加五顆 failed HTTP validation: expected <=20 candidates, received103.
it.each(['加5顆', '加五顆', '加五顆水餃', '加100顆'])('bounds the piece-answer choices before the Host sends %s', async (transcript) => {
  const { runtime } = await proposedDumplings()
  const context = await runtime.invoke('kiosk_fast_path_context', { transcript }) as { candidates: Array<{ id: string }>, waitingFor: { choices: unknown[] } }
  expect(context.candidates.length).toBeLessThanOrEqual(5)
  expect(context.waitingFor.choices.length).toBeLessThanOrEqual(5)
  const count = transcript === '加100顆' ? 100 : 5
  const option = context.candidates.find(choice => choice.id.endsWith(`:extra-pieces:extra-${count}`))!
  expect(option).toBeDefined()
  expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: option.id })).toHaveProperty('customerMessage', '請問周氏水餃(最低8顆)要幾份？')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  const quantity = await runtime.invoke('kiosk_fast_path_context', { transcript: '一份' }) as { candidates: Array<{ id: string }> }
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: quantity.candidates.find(choice => choice.id.includes(':quantity:1'))!.id })
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.total', 64 + count * 8)
})

it('introduces the supplier noodle category three names at a time without reciting prices', async () => {
  const runtime = setup()
  const first = await runtime.invoke('menu_get', { category: '麵區', display: true })
  expect(first).toHaveProperty('customerMessage', expect.stringContaining('有9道餐點，先介紹周氏水餃(最低8顆)、老董紅燒牛肉麵、椒香麻辣牛肉麵'))
  expect(first).toHaveProperty('customerMessage', expect.not.stringMatching(/目前可以點|單份|元/))
  expect(first).toHaveProperty('customerMessage', expect.stringContaining('還是再聽其他的'))
  const next = await runtime.invokeForAgent('menu_recommend', { action: 'continue' })
  expect(next).toHaveProperty('customerMessage', expect.stringContaining('牛肉湯餃(10顆)、紅燒牛肉湯(無肉)、蛋花湯'))
})

it.each(['要加量', '加101顆', '加5顆或加6顆'])('keeps the draft unmodified while asking for one valid piece count: %s', async (transcript) => {
  const { runtime } = await proposedDumplings()
  const context = await runtime.invoke('kiosk_fast_path_context', { transcript }) as { candidates: Array<{ id: string }> }
  expect(context.candidates.length).toBeLessThanOrEqual(5)
  expect(context.candidates.filter(choice => /:extra-pieces:extra-[1-9]/.test(choice.id))).toEqual([])
  const guidance = context.candidates.find(choice => choice.id.endsWith(':ask-count'))!
  expect(guidance).toBeDefined()
  expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: guidance.id })).toHaveProperty('customerMessage', expect.stringContaining('要加量嗎'))
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

// Report: this chat Nov09 — 加五粒 advanced to quantity and the cart used extra-0.
it.each(['加五粒', '加5粒', '每份加量五顆', '加量五顆'])('preserves the exact piece option through serving confirmation: %s', async (transcript) => {
  const { runtime } = await proposedDumplings()
  const context = await runtime.invoke('kiosk_fast_path_context', { transcript }) as { candidates: Array<{ id: string }> }
  const choice = context.candidates.find(choice => choice.id.endsWith(':extra-pieces:extra-5'))
  expect(choice).toBeDefined()
  expect(context.candidates.some(choice => choice.id.endsWith(':extra-pieces:extra-0'))).toBe(false)
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: choice!.id })
  const quantity = await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' }) as { candidates: Array<{ id: string }> }
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: quantity.candidates.find(choice => choice.id.endsWith(':quantity:2'))!.id })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { total: 208, lines: [{ quantity: 2, options: { 'extra-pieces': 'extra-5' }, unitPrice: 104 }] } })
})

it.each(['加五克', '加個五克好了', '加量', '五公斤', '加一百零一粒'])('does not offer zero or advance servings for an unresolved piece answer: %s', async (transcript) => {
  const { runtime } = await proposedDumplings()
  const context = await runtime.invoke('kiosk_fast_path_context', { transcript }) as { candidates: Array<{ id: string }> }
  expect(context.candidates.some(choice => /:extra-pieces:extra-\d+$/.test(choice.id))).toBe(false)
  const guidance = context.candidates.find(choice => choice.id.endsWith(':ask-count'))!
  expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: guidance.id })).toHaveProperty('customerMessage', expect.stringContaining('要加量嗎'))
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  const corrected = await runtime.invoke('kiosk_fast_path_context', { transcript: '加五粒' }) as { candidates: Array<{ id: string }> }
  expect(corrected.candidates.some(choice => choice.id.endsWith(':extra-pieces:extra-5'))).toBe(true)
})
