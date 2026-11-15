import { safeParse } from 'valibot'
import { expect, it, vi } from 'vitest'

import { decideAnswer, findPresentedQuestion } from '.'
import { browserEffectSchema } from './contracts'

const effect = { transcript: '每日新品兩份有嗎？', action: 'add' as const, description: '新增每日新品兩份', completedEffects: [], storeFacts: '', note: '', deltas: [{ name: '每日新品', kind: 'product' as const, mode: 'increase' as const, quantity: 1 }] }

// Report: this chat, Nov15 — checkout assent must reference the presented question.
it('finds a final checkout question after the completed add and revokes it after another write', () => {
  type Entry = Parameters<typeof findPresentedQuestion>[0][number]
  const entry = (kind: Entry['kind'], value: unknown, sequence: number): Entry => ({ id: String(sequence), visitorSessionId: 'visitor', sequence, kind, content: typeof value === 'string' ? value : JSON.stringify(value), metadata: { name: 'add_items_to_cart' }, createdAt: new Date() })
  const question = { questionId: 'checkout-1', purpose: 'browser-service-question', question: '要結帳嗎？', expiresAt: Date.now() + 30_000, choices: [{ id: 'yes', description: '開啟購物車核對餐點，不送單。' }, { id: 'no', description: '繼續點餐。' }] }
  const added = entry('tool_result', { source: 'browser', status: 'verified' }, 1)
  const presented = entry('service_event', { kind: 'browser_question_presented', source: 'browser', pendingCustomerChoice: question }, 2)
  const user = entry('user_text', '好，幫我結帳吧', 3)
  expect(findPresentedQuestion([added, presented, user], question.questionId)).toEqual(question)
  expect(findPresentedQuestion([added, entry('assistant_text', question.question, 2), user], question.questionId)).toBeUndefined()
  expect(findPresentedQuestion([presented, added, user], question.questionId)).toBeUndefined()
  expect(findPresentedQuestion([added, entry('service_event', { kind: 'unrelated', source: 'browser', pendingCustomerChoice: question }, 2), user], question.questionId)).toBeUndefined()
})

it('accepts a bounded completed receipt with configuration labels instead of dropping them before the next step', () => {
  expect(safeParse(browserEffectSchema, { ...effect, completedEffects: [`已加入每日新品（${'配菜、'.repeat(200)}）1 份。`] }).success).toBe(true)
  expect(safeParse(browserEffectSchema, { ...effect, completedEffects: ['字'.repeat(4_001)] }).success).toBe(false)
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov2 S04/S12.
// Report: this chat, Nov15 — answering a pending question must be one decision, not relation plus selection.
it.each(['confirm', 'NEW_REQUEST', 'UNCERTAIN'])('reads the complete answer once and retains its intent: %s', async (choice) => {
  const question = { questionId: 'q', purpose: 'browser-confirm-add', question: '要加入甲餐兩份嗎？', expiresAt: 200, choices: [{ id: 'confirm', description: '加入甲餐兩份' }, { id: 'cancel', description: '不加入' }] }
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'judge_browser_answer', arguments: JSON.stringify({ choice }) } }] } }] }))
  expect(await decideAnswer({ transcript: '第二個兩份', questionId: 'q', cartContext: { version: 'cart', lines: [{ name: '乙餐', quantity: 1 }] } }, question, { complete }, 100)).toMatchObject(choice === 'confirm' ? { kind: 'ANSWER', choiceId: 'confirm' } : { kind: choice })
  expect(complete).toHaveBeenCalledOnce()
  expect(JSON.stringify(complete.mock.calls[0])).not.toContain('answer_relation')
})

it('accepts a confident first finite choice without asking it or Main to verify again', async () => {
  const question = { questionId: 'q', purpose: 'browser-product-choice', question: '甲餐或乙餐？', expiresAt: 200, choices: [{ id: 'product:1', description: '甲餐' }, { id: 'product:2', description: '乙餐' }] }
  const finite = vi.fn(async () => ({ answers: { answer: { choice: 'product:2', confidence: 0.95 } } }))
  const complete = vi.fn(async () => {
    throw new Error('Do not re-judge a selected finite answer.')
  })
  expect(await decideAnswer({ transcript: '第二個', questionId: 'q' }, question, { finite, complete }, 100)).toMatchObject({ kind: 'ANSWER', choiceId: 'product:2', provider: 'system-one' })
  expect(finite).toHaveBeenCalledOnce()
  expect(complete).not.toHaveBeenCalled()
})

it('hands an uncertain first finite answer to Main once without returning to finite', async () => {
  const question = { questionId: 'q', purpose: 'browser-product-choice', question: '甲餐或乙餐？', expiresAt: 200, choices: [{ id: 'product:1', description: '甲餐' }, { id: 'cancel', description: '取消' }] }
  const finite = vi.fn(async () => ({ answers: { answer: { choice: 'UNCERTAIN', confidence: 0.95 } } }))
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'judge_browser_answer', arguments: '{"choice":"cancel"}' } }] } }] }))
  expect(await decideAnswer({ transcript: '先不要了', questionId: 'q' }, question, { finite, complete }, 100)).toMatchObject({ kind: 'ANSWER', choiceId: 'cancel', provider: 'main' })
  expect(finite).toHaveBeenCalledOnce()
  expect(complete).toHaveBeenCalledOnce()
})
