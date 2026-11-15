import type { SystemOneResponse } from '../kiosk-system-one'
import type { KioskDecisionState } from './contracts'

import { describe, expect, it } from 'vitest'

import { decideInteraction } from '.'

const url = process.env.PB_CUSTOMIZATION_JEV_URL
const navigation = { id: 'intent:return-menu', description: '放棄目前搜尋，清除搜尋與未加入的選餐，保留購物車。' }
const search: KioskDecisionState = { phase: 'ordering', menuSearch: { query: '蜜汁雞排' }, interactionState: { matchingCartLines: 0, screen: 'menu', pendingAction: '目前搜尋「蜜汁雞排」，搜尋沒有結果。取消搜尋只會清除關鍵字並回完整菜單；不刪購物車、不取消整單。' } }

// Report: this chat, 2026-11-14. Fixed synthetic states; real Jev, no merchant IO.
describe.skipIf(!url)('live Jev semantic navigation', () => {
  it.each([
    { text: '那我不要了', action: 'intent:return-menu', mayAbstain: true },
    { text: '先別找這個了，讓我看看原本有哪些', action: 'intent:return-menu', mayAbstain: true },
    { text: '這個就算了，回原來那頁', action: 'intent:return-menu', mayAbstain: true },
    { text: '把購物車裡的雞腿飯刪掉', action: undefined },
    { text: '不要取消搜尋，我還要找雞排', action: undefined },
    { text: '我要一份蛋花湯', action: undefined },
  ])('uses meaning rather than phrase coverage: $text', async ({ text, action, mayAbstain }) => {
    const result = await decideInteraction({ routing: 'staged', policy: { decisionInstruction: '', storeInstruction: '' }, transcript: text, conversation: { messages: [{ role: 'user', content: '有蜜汁雞排嗎' }, { role: 'assistant', content: '目前搜尋沒有找到這道餐點。可以換一道餐點，或回到菜單看全部餐點。' }] }, decisionState: search, candidates: [navigation], includeTrace: true, invoke: async (state, questions) => {
      const response = await fetch(new URL('v1/systemone', `${url!.replace(/\/+$/, '')}/`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, questions }), signal: AbortSignal.timeout(30_000) })
      expect(response.ok).toBe(true)
      const result = await response.json() as SystemOneResponse
      console.info(JSON.stringify({ text, answers: result.answers }))
      return result
    } })
    console.info(JSON.stringify({ text, kind: result.kind, action: result.kind === 'FAST_ACTION' ? result.actionId : undefined, confidence: 'confidence' in result ? result.confidence : undefined, calls: result.modelCalls }))
    if (mayAbstain && result.kind === 'NEEDS_ASSISTANT')
      expect(result).not.toHaveProperty('actionId')
    else if (action)
      expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: action })
    else
      expect(result.kind).not.toBe('FAST_ACTION')
  }, 120_000)
})

// Report: this chat, Nov14 — pending confirmations must survive a nonempty search.
describe.skipIf(!url)('live Jev pending-question contract audit', () => {
  it.each([
    { text: '要', action: 'confirm' },
    { text: '要啊', action: 'confirm' },
    { text: '那就幫我放進去吧', action: 'confirm' },
    { text: '不要了', action: 'cancel' },
    { text: '不要，改成兩份', action: undefined },
    { text: '有什麼湯', action: undefined },
  ])('preserves the full answer meaning: $text', async ({ text, action }) => {
    const choices = [{ id: 'confirm', description: '加入魚丸湯一份，50元，不送單。' }, { id: 'cancel', description: '取消尚未加入的魚丸湯，保留購物車。' }]
    const waitingFor = { questionId: 'synthetic-fish-offer', purpose: 'browser-confirm-add', question: '魚丸湯一份50元，要加入購物車嗎？', choices, expiresAt: Date.now() + 60000 }
    const result = await decideInteraction({ routing: 'staged', policy: { decisionInstruction: '', storeInstruction: '' }, transcript: text, conversation: { messages: [{ role: 'assistant', content: waitingFor.question }] }, decisionState: { phase: 'ordering', menuSearch: { query: '魚' }, waitingFor }, candidates: [...choices, navigation], includeTrace: true, invoke: async (state, questions) => {
      const response = await fetch(new URL('v1/systemone', `${url!.replace(/\/+$/, '')}/`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, questions }), signal: AbortSignal.timeout(30000) })
      expect(response.ok).toBe(true)
      return await response.json() as SystemOneResponse
    } })
    console.info(JSON.stringify({ text, kind: result.kind, action: result.kind === 'FAST_ACTION' ? result.actionId : undefined, confidence: 'confidence' in result ? result.confidence : undefined, calls: result.modelCalls }))
    if (result.kind === 'FAST_ACTION')
      expect(result.actionId).toBe(action)
    else
      expect(result.kind).toBe('NEEDS_ASSISTANT')
  }, 120000)
})

// Report: this chat, Nov14; current dialog is observation, never purchase consent.
describe.skipIf(!url)('live Jev current-dialog cancellation', () => {
  it.each([
    { text: '我不要a套餐了，幫我關閉', mayClose: true },
    { text: '先不要選這個，關掉回菜單', mayClose: true },
    { text: '把購物車裡的A套餐刪掉', mayClose: false },
    { text: '先不要關閉，我還想看內容', mayClose: false },
  ])('keeps the visible dialog separate from cart edits: $text', async ({ text, mayClose }) => {
    const result = await decideInteraction({ routing: 'staged', policy: { decisionInstruction: '', storeInstruction: '' }, transcript: text, decisionState: { phase: 'ordering', interactionState: { screen: 'item_configuration', selectedItemName: 'A套餐', matchingCartLines: 0, pendingAction: '目前開啟A套餐餐點視窗。關閉只返回菜單，保留購物車。查看視窗不表示已同意購買。' } }, candidates: [{ id: 'intent:return-menu', description: '關閉目前A套餐餐點視窗並返回完整菜單，清除搜尋，保留購物車裡的餐點。' }], includeTrace: true, invoke: async (state, questions) => {
      const response = await fetch(new URL('v1/systemone', `${url!.replace(/\/+$/, '')}/`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, questions }), signal: AbortSignal.timeout(30000) })
      expect(response.ok).toBe(true)
      return await response.json() as SystemOneResponse
    } })
    console.info(JSON.stringify({ text, kind: result.kind, action: result.kind === 'FAST_ACTION' ? result.actionId : undefined, confidence: 'confidence' in result ? result.confidence : undefined }))
    if (result.kind === 'FAST_ACTION') {
      expect(mayClose).toBe(true)
      expect(result.actionId).toBe('intent:return-menu')
    }
    else {
      expect(result.kind).toBe('NEEDS_ASSISTANT')
    }
  }, 120000)
})
