import type { SystemOneQuestion } from '../kiosk-system-one'

import { describe, expect, it } from 'vitest'

// Synthetic paired states, frozen before inference. No customer, merchant,
// provider credential or real cart data is included in this replay.
const cases = [
  { id: 'missing-count', state: '顧客已說要雞腿飯，但沒說份數。', text: '我要雞腿飯', expected: 'ask' },
  { id: 'missing-target', state: '購物車有不同配置的兩道餐點，未指定修改對象。', text: '改成兩份', expected: 'ask' },
  { id: 'recommend-assent', state: '剛推薦雞腿飯；尚未確認要買，也沒有份數。', text: '好', expected: 'ask' },
  { id: 'table-needed', state: '在選桌頁，顧客還沒選桌號。', text: '開始點餐', expected: 'ask' },
  { id: 'greeting', state: '目前沒有待回答的問題。', text: '你好', expected: 'reply' },
  { id: 'microphone', state: '目前沒有待回答的問題。', text: '你有聽到我說話嗎', expected: 'reply' },
  { id: 'read-first', state: '目前沒有商品價格資料；本次沒有提供查價選項。', text: '雞腿飯多少錢', expected: 'main' },
  { id: 'add-action', state: '餐點與份數明確；本次沒有提供加入購物車的選項。', text: '雞腿飯兩份', expected: 'main' },
  { id: 'contextual-count', state: '正等雞腿飯份數，已收到兩份；本次沒有提供執行加入的選項。', text: '兩份', expected: 'main' },
] as const
const variants: Record<string, Record<string, string>> = {
  broad: { ask: '向顧客提出問題。', reply: '回覆顧客的招呼、確認、一般說明或下一步。', main: '需要其他處理或無法確定，交給Main。' },
  bounded: { ask: '只補問目前缺少的桌號、餐點或份數；推薦後只回答好，要確認是否購買及份數。', reply: '只回覆招呼或確認是否收到說話內容；不能代替查價、加入餐點或處理份數答案。', main: '需要讀取網站、執行操作、接續份數答案，或無法確定，交給Main。' },
  withoutReply: { ask: '只補問目前缺少的桌號、餐點或份數，或確認是否購買推薦餐點。', main: '本版沒有一般回覆選項；招呼、聽到確認、網站查詢、購物車操作或無法確定，交給Main。' },
}
const endpoint = process.env.JEV_TOOL_WORDING_URL

describe.skipIf(!endpoint)('live Jev PB tool wording comparison', () => {
  it('reports valid choices, confidence, semantic errors and handoff separately', async () => {
    const records: Array<Record<string, unknown>> = []
    for (const [variant, criteria] of Object.entries(variants)) {
      // Rotate option order without changing candidate meanings or gold labels.
      for (const offset of [0, 1]) {
        const entries = Object.entries(criteria)
        const rotated = Object.fromEntries([...entries.slice(offset), ...entries.slice(0, offset)])
        for (const test of cases) {
          const question: SystemOneQuestion = { type: 'choice', instructions: '依人工測試的顧客原句及目前狀態，從提供的下一步選項選一個。不自行執行網站操作。', criteria: rotated }
          const start = performance.now()
          const response = await fetch(new URL('v1/systemone', `${endpoint!.replace(/\/+$/, '')}/`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: JSON.stringify({ state: test.state, customerUtterance: test.text }), questions: { next: question } }), signal: AbortSignal.timeout(30_000) })
          if (!response.ok)
            throw new Error(`Jev wording experiment stopped: HTTP ${response.status}`)
          const result = await response.json() as { answers?: { next?: { choice?: string, confidence?: number } }, model?: string }
          const answer = result.answers?.next
          expect(answer?.choice).toBeDefined()
          expect(Object.hasOwn(criteria, answer!.choice!)).toBe(true)
          expect(typeof answer?.confidence).toBe('number')
          const accepted = Number.isFinite(answer?.confidence) && answer!.confidence! >= 0.6 && answer!.confidence! <= 1
          const choice = accepted ? answer!.choice : 'main'
          const expected = variant === 'withoutReply' && test.expected === 'reply' ? 'main' : test.expected
          records.push({ variant, optionOrder: offset, case: test.id, expected, choice, accepted, matched: choice === expected, wrongDirectSelection: choice !== 'main' && choice !== expected, originalReplyCase: test.expected === 'reply', durationMs: performance.now() - start, model: result.model })
        }
      }
    }
    console.info(JSON.stringify({ experiment: 'pb-tool-wording', threshold: 0.6, syntheticOnly: true, limitation: 'Choice accuracy only; not ASR, cart execution or Main end-to-end accuracy.', records }))
    expect(records).toHaveLength(cases.length * 2 * Object.keys(variants).length)
  }, 1_800_000)
})
