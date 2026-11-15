import type { DecisionInput, KioskDecisionTrace } from '../../src/services/domain/kiosk-interaction-decision'

import { Buffer } from 'node:buffer'

import { errorMessageFrom } from '@moeru/std'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'

import { createDrizzle } from '../../src/libs/db'
import { mockDB } from '../../src/libs/mock-db'
import { decideInteraction } from '../../src/services/domain/kiosk-interaction-decision'
import { createKioskSystemOneService } from '../../src/services/domain/kiosk-system-one'
import { createEnvelopeCrypto } from '../../src/utils/envelope-crypto'

import * as schema from '../../src/schemas'

// Report: this chat. Fixed contrasts measure selected labels separately from
// threshold abstention. No browser tools, merchant writes or live profile edits.
// NOTICE: These hand-written pools include choices without request-derived
// quantities or production facts. Match counts cannot establish application
// accuracy or rank providers; use production-generated candidates for that.
it.skipIf(process.env.KIOSK_DIRECT_PROBE !== '1')('measures direct decisions with a configured provider in an isolated database', async () => {
  const menu = [
    { id: 'read', description: '只查詢A套餐目前內容及單價，不開商品視窗、不加入購物車。' },
    { id: 'open', description: '開啟A套餐商品視窗供顧客查看，不加入購物車。' },
    { id: 'add', description: '新增炸排骨便當兩份至購物車。' },
    { id: 'quantity', description: '選擇炸排骨便當並詢問份數，尚未加入購物車。' },
    { id: 'cart', description: '打開購物車，顯示目前餐點與總額。' },
    { id: 'clear', description: '清除目前搜尋條件，顯示完整菜單，不移除購物車餐點。' },
    { id: 'recommend', description: '依目前條件推薦三道可供應餐點並依序展示，不購買。' },
  ]
  const edit = [
    { id: 'more', description: '目前炸排骨便當一份，另外新增兩份，完成後共三份。' },
    { id: 'set', description: '將購物車中的炸排骨便當最後總份數設為兩份。' },
    { id: 'remove', description: '移除購物車中的全部炸排骨便當。' },
    { id: 'close', description: '關閉尚未購買的餐點選擇視窗，回到菜單，購物車不變。' },
  ]
  const waitingFor = { questionId: 'synthetic-quantity', purpose: 'browser-order-quantity', question: '炸排骨便當要幾份？', choices: [{ id: 'answer', description: '以顧客回答的兩份完成炸排骨便當訂購並加入購物車。' }], expiresAt: Date.now() + 180000 }
  const cases: Array<{ text: string, expected: string, candidates: DecisionInput['candidates'], state?: DecisionInput['decisionState'], conversation?: DecisionInput['conversation'] }> = [
    { text: '開始點餐', expected: 'start', candidates: [{ id: 'table', description: '改選A1，留在選桌頁。' }, { id: 'start', description: '沿用畫面目前B3 吧檯開始點餐。' }], state: { phase: 'selecting_table', tableSelection: { choices: ['A1 桌', 'B3 吧檯'], selectedTable: 'B3 吧檯' } }, conversation: { messages: [{ role: 'user', content: '我要A1' }] } },
    { text: 'A套餐有什麼', expected: 'read', candidates: menu },
    { text: 'A套餐多少錢', expected: 'read', candidates: menu },
    { text: '幫我打開A套餐看一下', expected: 'open', candidates: menu },
    { text: '我要炸排骨便當兩份', expected: 'add', candidates: menu },
    { text: '炸排骨便當，來兩份', expected: 'add', candidates: menu },
    { text: '我要炸排骨便當', expected: 'quantity', candidates: menu },
    { text: '看購物車', expected: 'cart', candidates: menu },
    { text: '那我不要了', expected: 'clear', candidates: menu, state: { phase: 'ordering', menuSearch: { query: '蜜汁雞排' } } },
    { text: '回到完整菜單', expected: 'clear', candidates: menu, state: { phase: 'ordering', menuSearch: { query: '魚' } } },
    { text: '推薦三樣', expected: 'recommend', candidates: menu },
    { text: '炸排骨便當再加兩份', expected: 'more', candidates: edit },
    { text: '炸排骨便當改成兩份', expected: 'set', candidates: edit },
    { text: '炸排骨便當只要兩份', expected: 'set', candidates: edit },
    { text: '炸排骨便當多兩份', expected: 'more', candidates: edit },
    { text: '購物車裡的炸排骨便當不要了', expected: 'remove', candidates: edit },
    { text: '這個先不要，關掉選餐視窗', expected: 'close', candidates: edit },
    { text: '兩份', expected: 'answer', candidates: [...menu, ...waitingFor.choices], state: { phase: 'ordering', waitingFor } },
    { text: '幫我加兩份炸排骨便當，再打開購物車', expected: 'HANDOFF', candidates: menu },
    { text: '炸排骨便當兩份一共多少錢？', expected: 'HANDOFF', candidates: menu },
    { text: '好', expected: 'HANDOFF', candidates: menu, conversation: { messages: [{ role: 'assistant', content: '可以考慮炸排骨便當。' }] } },
    { text: '我要一份……', expected: 'INCOMPLETE', candidates: menu },
    { text: '你好', expected: 'GREET', candidates: menu },
  ]
  const live = createDrizzle({ DATABASE_URL: process.env.DATABASE_URL!, DB_POOL_MAX: 1, DB_POOL_CONNECTION_TIMEOUT_MS: 5000 })
  try {
    const profileId = process.env.KIOSK_DIRECT_PROFILE_ID
    const profile = await live.db.query.kioskSystemOneProfiles.findFirst({ where: profileId ? eq(schema.kioskSystemOneProfiles.id, profileId) : eq(schema.kioskSystemOneProfiles.isActive, true) })
    if (!profile || profile.implementation === 'slm')
      throw new Error('Select a configured Jev or OpenAI Decisions profile')
    const isolated = await mockDB(schema)
    await isolated.insert(schema.kioskSystemOneProfiles).values({ ...profile, isActive: true, verifiedAt: new Date() })
    const savedPolicy = await live.db.query.kioskSystemOnePolicies.findFirst()
    if (savedPolicy)
      await isolated.insert(schema.kioskSystemOnePolicies).values(savedPolicy)
    let calls = 0
    const service = createKioskSystemOneService({ db: isolated, envelopeCrypto: createEnvelopeCrypto({ masterKey: Buffer.from(process.env.LLM_ROUTER_MASTER_KEY!, 'base64') }), fetchImpl: async (url, init) => {
      if (++calls > 60)
        throw new Error('Probe request budget exhausted')
      return fetch(url, init)
    } })
    const policy = await service.getPolicy()
    await service.readiness(profile.id)
    const rows = []
    for (const test of cases) {
      const started = performance.now()
      try {
        const result = await decideInteraction({ routing: 'direct', backgroundSpeechMode: 'off', policy, transcript: test.text, candidates: test.candidates, decisionState: test.state ?? { phase: 'ordering' }, conversation: test.conversation, includeTrace: true, maxActionCandidates: await service.maxActionCandidates(), invoke: service.decide })
        const trace = result.trace as KioskDecisionTrace
        const answer = trace.exchanges?.at(-1)?.answers?.action as { choice?: string, confidence?: number } | undefined
        rows.push({ text: test.text, expected: test.expected, selected: answer?.choice, confidence: answer?.confidence, correct: answer?.choice === test.expected, kind: result.kind, reason: result.reason, calls: result.modelCalls, ms: Math.round(performance.now() - started) })
      }
      catch (error) {
        rows.push({ text: test.text, expected: test.expected, error: errorMessageFrom(error), ms: Math.round(performance.now() - started) })
      }
      process.stdout.write(`[direct-probe] ${JSON.stringify({ provider: profile.implementation, ...rows.at(-1) })}\n`)
    }
    expect(rows).toHaveLength(cases.length)
    expect(rows.filter(row => 'error' in row)).toEqual([])
    expect(rows.filter(row => 'reason' in row && (row.reason === 'PROVIDER_FAILURE' || row.reason === 'INVALID_CHOICE'))).toEqual([])
    process.stdout.write(`[direct-probe-summary] ${JSON.stringify({ provider: profile.implementation, cases: rows.length, selectedCorrect: rows.filter(row => 'correct' in row && row.correct).length, direct: rows.filter(row => 'kind' in row && row.kind === 'FAST_ACTION').length, calls })}\n`)
  }
  finally {
    await live.pool.end()
  }
}, 180000)
