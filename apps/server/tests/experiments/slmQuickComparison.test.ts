import type { SystemOneQuestion } from '../../src/services/domain/kiosk-system-one'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { errorMessageFrom } from '@moeru/std'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'

import { createDrizzle } from '../../src/libs/db'
import { mockDB } from '../../src/libs/mock-db'
import { createKioskSystemOneService } from '../../src/services/domain/kiosk-system-one'
import { createEnvelopeCrypto } from '../../src/utils/envelope-crypto'
import { choose } from './slmDecision'

import * as schema from '../../src/schemas'

// Synthetic task requirements, frozen before either model runs. This is a small
// diagnostic sample, not a hidden holdout or an estimate of field accuracy.
const cases = [
  { id: 'Q01', text: '您好', expected: 'GREET', context: '沒有待答問題。' },
  { id: 'Q02', text: '有水餃嗎？', expected: 'INFO', context: '沒有待答問題。' },
  { id: 'Q03', text: '我要一份排骨便當', expected: 'ORDER', context: '購物車空白。' },
  { id: 'Q04', text: '我想請你幫忙，那個，我還沒說清楚。', expected: 'CLARIFY', context: '沒有待答問題。' },
  { id: 'Q05', text: '我先看看，你等我一下', expected: 'WAIT', context: '正在瀏覽菜單。' },
  { id: 'Q06', text: '小陳，你昨天下班去哪裡？', expected: 'BACKGROUND', context: '說話者正與同伴談話。' },
  { id: 'Q07', text: '不要內用，改外帶', expected: 'MODE', context: '目前內用，購物車有一份水餃。' },
  { id: 'Q08', text: '剛才水餃不是再加兩份，是總共兩份', expected: 'MODIFY', context: '購物車目前有三份水餃。' },
  { id: 'Q09', text: '除了排骨，有沒有別的推薦？', expected: 'INFO', context: '畫面只顯示排骨便當，購物車空白。' },
  { id: 'Q10', text: '把全部菜單給我看', expected: 'INFO', context: '畫面只顯示排骨便當，購物車空白。' },
  { id: 'Q11', text: '雞腿便當多少錢？再幫我加一份水餃', expected: 'MULTI', context: '購物車空白。' },
  { id: 'Q12', text: '對', expected: 'CLARIFY', context: '沒有待答問題，也沒有先前選項。' },
  { id: 'Q13', text: '你聽得到我嗎？', expected: 'INFO', context: '正在測試本機收音，沒有點餐需求。' },
  { id: 'Q14', text: '我只問有沒有牛肉麵，先不要點', expected: 'INFO', context: '購物車空白。' },
  { id: 'Q15', text: '水餃跟雞腿便當各一份', expected: 'MULTI', context: '購物車空白。' },
  { id: 'Q16', text: '剛才那份雞腿便當取消', expected: 'MODIFY', context: '購物車有一份雞腿便當。' },
]
const criteria = {
  GREET: '只向本機打招呼。',
  INFO: '向本機詢問資訊、推薦、完整菜單或本機功能，未同時要求訂購。',
  ORDER: '明確新增單一餐點的訂購需求。',
  MODIFY: '取消、更換或修正既有購物車餐點／數量。',
  MODE: '變更內用／外帶方式，不是新增餐點。',
  CLARIFY: '向本機求助但需求不明，或缺少對應問題的肯定句；應澄清。',
  WAIT: '明確要求等待或表示先自行瀏覽。',
  BACKGROUND: '對同伴說話，與本機無關。',
  MULTI: '同句有多個品項或資訊加訂購的多需求；應保留整句交由後續處理。',
}
const instructions = '依目前情境選擇顧客這一句的需求類別。詢問不等於訂購；更正不等於追加。多品項或混合需求選MULTI。明確求助但目的不明選CLARIFY，不視為背景。只做分類，不執行操作。'

it.skipIf(process.env.KIOSK_SLM_QUICK !== '1')('bounded paired task comparison with independently specified expectations', async () => {
  const started = Date.now()
  const deadline = started + 7 * 60_000
  const rows: Array<{ id: string, order: number, provider: string, expected: string, actual?: string, error?: string, durationMs: number }> = []
  let calls = 0
  let failures = 0
  const fetchImpl: typeof fetch = async (url, init) => {
    if (Date.now() >= deadline || calls >= 66 || failures >= 3)
      throw new Error('Quick comparison budget exhausted')
    calls++
    return fetch(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(30_000), AbortSignal.timeout(Math.max(1, deadline - Date.now())), ...(init?.signal ? [init.signal] : [])]) })
  }
  const live = createDrizzle({ DATABASE_URL: process.env.DATABASE_URL!, DB_POOL_MAX: 1, DB_POOL_CONNECTION_TIMEOUT_MS: 5000 })
  try {
    const active = await live.db.query.kioskSystemOneProfiles.findFirst({ where: eq(schema.kioskSystemOneProfiles.isActive, true) })
    if (!active)
      throw new Error('No active Jev profile')
    const db = await mockDB(schema)
    await db.insert(schema.kioskSystemOneProfiles).values({ ...active, verifiedAt: new Date() })
    const envelopeCrypto = createEnvelopeCrypto({ masterKey: Buffer.from(process.env.LLM_ROUTER_MASTER_KEY!, 'base64') })
    const jev = createKioskSystemOneService({ db, envelopeCrypto, fetchImpl, traceObserver: { record: trace => process.stdout.write(`[quick-jev-trace] ${JSON.stringify(trace)}\n`) } })
    process.stdout.write(`[quick-frozen] ${JSON.stringify({ cases, criteria, instructions, hash: createHash('sha256').update(JSON.stringify({ cases, criteria, instructions })).digest('hex'), rule: 'Candidate only if SLM correct >= Jev, SLM >=29/32, zero INFO/CLARIFY/WAIT/BACKGROUND to ORDER/MODIFY/MODE errors, zero order-instability; no retuning or reruns. Not production acceptance.', model: active.modelId, maxCalls: 66, maxMinutes: 7 })}\n`)
    // Both providers receive identical semantic data. Reverse candidate order
    // in a second pass; alternate provider order to expose position effects.
    for (let order = 0; order < 2; order++) {
      for (const test of cases) {
        if (Date.now() >= deadline || failures >= 3)
          break
        const question: SystemOneQuestion = { type: 'choice', instructions, criteria: Object.fromEntries(order === 0 ? Object.entries(criteria) : Object.entries(criteria).reverse()) }
        const state = JSON.stringify({ context: test.context, customerUtterance: test.text })
        for (const provider of order === 0 ? ['jev', 'slm'] : ['slm', 'jev']) {
          const callStarted = Date.now()
          try {
            let actual: string | undefined
            if (provider === 'jev') {
              const result = await jev.decide(state, { task: question })
              const answer = result.answers?.task
              actual = answer && typeof answer === 'object' && 'choice' in answer && typeof answer.choice === 'string' ? answer.choice : undefined
              if (!actual || !(actual in criteria))
                throw new Error('Jev returned an invalid candidate')
            }
            else {
              const result = await choose({ baseURL: process.env.KIOSK_SLM_URL ?? 'http://127.0.0.1:12434/engines/v1', modelId: process.env.KIOSK_SLM_MODEL ?? 'huggingface.co/unsloth/qwen3.5-4b-gguf:latest', timeoutMs: 30_000, state, question, format: 'label', fetchImpl })
              actual = result.choice
              process.stdout.write(`[quick-slm-raw] ${JSON.stringify({ id: test.id, order, ...result })}\n`)
            }
            failures = 0
            rows.push({ id: test.id, order, provider, expected: test.expected, actual, durationMs: Date.now() - callStarted })
          }
          catch (error) {
            failures++
            rows.push({ id: test.id, order, provider, expected: test.expected, error: errorMessageFrom(error), durationMs: Date.now() - callStarted })
          }
          process.stdout.write(`[quick-result] ${JSON.stringify(rows.at(-1))}\n`)
        }
      }
    }
    const summary = ['jev', 'slm'].map((provider) => {
      const selected = rows.filter(row => row.provider === provider)
      return { provider, attempted: selected.length, correct: selected.filter(row => row.actual === row.expected).length, errors: selected.filter(row => row.error).length, unsafe: selected.filter(row => ['INFO', 'CLARIFY', 'WAIT', 'BACKGROUND'].includes(row.expected) && ['ORDER', 'MODIFY', 'MODE'].includes(row.actual ?? '')).length, unstable: cases.filter(test => new Set(selected.filter(row => row.id === test.id && row.actual).map(row => row.actual)).size > 1).map(test => test.id) }
    })
    process.stdout.write(`[quick-summary] ${JSON.stringify({ calls, elapsedMs: Date.now() - started, complete: rows.length === 64, summary })}\n`)
    expect(rows).toHaveLength(64)
    expect(rows.filter(row => row.error)).toHaveLength(0)
  }
  finally {
    await live.pool.end()
  }
}, 450_000)
