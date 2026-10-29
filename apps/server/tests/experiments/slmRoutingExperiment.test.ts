import type { SystemOneQuestion } from '../../src/services/domain/kiosk-system-one'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { errorMessageFrom } from '@moeru/std'
import { eq } from 'drizzle-orm'
import { array, literal, object, parse, record, string } from 'valibot'
import { expect, it } from 'vitest'

import { createDrizzle } from '../../src/libs/db'
import { mockDB } from '../../src/libs/mock-db'
import { createKioskSystemOneService } from '../../src/services/domain/kiosk-system-one'
import { createEnvelopeCrypto } from '../../src/utils/envelope-crypto'
import { choose } from './slmDecision'
import { compactInstruction, concise } from './slmRoutingQuestions'

import * as schema from '../../src/schemas'

const scopeQuestion: SystemOneQuestion = { type: 'choice', instructions: '只分流最後一句，不選商品或操作。招呼帶需求選SERVICE。向本機求助、更正或投訴也是服務；對同伴提到餐點仍是BACKGROUND。無法確認或語句未完成選UNCERTAIN，等待／澄清由後續程式處理。', criteria: { SERVICE: '向本機提出訂購、查詢、更正、取消、投訴，或回答有效問題。', GREET: '只有向本機打招呼。', BACKGROUND: '對同伴說話、無關背景或對已完成資訊單純附和。', UNCERTAIN: '語句明顯未完成，或無法確定對象／意思。' } }
const selection = ['p07', 'p13', 'p18', 'p29', 'p31', 'p37', 'p40', 'p43', 'p09']
const archiveSchema = object({ id: string(), text: string(), expected: string(), decision: object({ trace: object({ exchanges: array(object({ state: string(), questions: record(string(), object({ type: literal('choice'), instructions: string(), criteria: record(string(), string()) })) })) }) }) })

it.skipIf(process.env.KIOSK_ROUTING_EXPERIMENT !== '1')('bounded model and prompt comparison, with service scope scored separately', async () => {
  const started = Date.now()
  const deadline = started + 8 * 60_000
  const raw = readFileSync(new URL('../../../../test_prompt/turnClassifierPoc/results/partition-frozen44.jsonl', import.meta.url), 'utf8')
  const archived = raw.trim().split('\n').map(line => JSON.parse(line)).filter(row => row.mode === 'baseline' && selection.includes(row.id)).map(row => parse(archiveSchema, row))
  const cases = selection.map((id) => {
    const row = archived.find(row => row.id === id)!
    const root = row.decision.trace.exchanges.find(exchange => exchange.questions.route)!
    const accepted = ['p29', 'p31'].includes(id) ? ['MULTI_ACTION', 'NEEDS_ASSISTANT'] : [row.expected]
    return { id, text: row.text, state: root.state, question: root.questions.route!, accepted, scope: id === 'p37' || id === 'p40' ? 'BACKGROUND' : id === 'p43' ? 'UNCERTAIN' : 'SERVICE' }
  })
  // Greeting is a declared control based on the same synthetic empty state;
  // no previous model output is used to author its expected outcome.
  const control = cases.find(test => test.id === 'p09')!
  cases.push({ ...control, id: 'greeting-control', text: '您好', state: control.state.replace(/顧客語音：[^\n]*$/u, '顧客語音：您好'), accepted: ['GREET'], scope: 'GREET' })
  for (const test of cases) {
    for (const id of Object.keys(test.question.criteria)) {
      if (!concise[id])
        throw new Error(`No predeclared concise description: ${id}`)
    }
  }
  let calls = 0
  let failures = 0
  const rows: Array<{ id: string, variant: string, provider: string, expected: string[], choice?: string, correct: boolean, error?: string, ms: number }> = []
  const fetchImpl: typeof fetch = async (url, init) => {
    if (calls >= 60 || Date.now() >= deadline || failures >= 3)
      throw new Error('Routing experiment budget exhausted')
    calls++
    return fetch(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(Math.min(35_000, Math.max(1, deadline - Date.now()))), ...(init?.signal ? [init.signal] : [])]) })
  }
  const live = createDrizzle({ DATABASE_URL: process.env.DATABASE_URL!, DB_POOL_MAX: 1, DB_POOL_CONNECTION_TIMEOUT_MS: 5000 })
  try {
    const active = await live.db.query.kioskSystemOneProfiles.findFirst({ where: eq(schema.kioskSystemOneProfiles.isActive, true) })
    if (!active)
      throw new Error('No active Jev profile')
    const db = await mockDB(schema)
    await db.insert(schema.kioskSystemOneProfiles).values({ ...active, verifiedAt: new Date() })
    const jev = createKioskSystemOneService({ db, envelopeCrypto: createEnvelopeCrypto({ masterKey: Buffer.from(process.env.LLM_ROUTER_MASTER_KEY!, 'base64') }), fetchImpl })
    process.stdout.write(`[routing-frozen] ${JSON.stringify({ cases, concise, compactInstruction, scopeQuestion, hash: createHash('sha256').update(JSON.stringify({ cases, concise, compactInstruction, scopeQuestion })).digest('hex'), rule: 'flat variants share gold; scope is a different task, NEVER pool scores. No tuning/retries. Model choice diagnostic only, not confidence/full-flow acceptance.', maxCalls: 60, maxMinutes: 8 })}\n`)
    for (const variant of ['original', 'compact', 'scope']) {
      for (const test of cases) {
        const question = variant === 'scope' ? scopeQuestion : variant === 'compact' ? { ...test.question, instructions: compactInstruction, criteria: Object.fromEntries(Object.keys(test.question.criteria).map(id => [id, concise[id]!])) } : test.question
        const expected = variant === 'scope' ? [test.scope] : test.accepted
        for (const provider of variant === 'compact' ? ['slm', 'jev'] : ['jev', 'slm']) {
          if (Date.now() >= deadline || failures >= 3)
            break
          const begin = Date.now()
          try {
            let choice: string | undefined
            if (provider === 'jev') {
              const response = await jev.decide(test.state, { task: question })
              const answer = response.answers?.task
              choice = answer && typeof answer === 'object' && 'choice' in answer && typeof answer.choice === 'string' ? answer.choice : undefined
              process.stdout.write(`[routing-raw] ${JSON.stringify({ id: test.id, variant, provider, state: test.state, question, response })}\n`)
            }
            else {
              const response = await choose({ baseURL: process.env.KIOSK_SLM_URL ?? 'http://127.0.0.1:12434/engines/v1', modelId: process.env.KIOSK_SLM_MODEL ?? 'huggingface.co/unsloth/qwen3.5-4b-gguf:latest', timeoutMs: 35_000, format: 'label', state: test.state, question, fetchImpl })
              choice = response.choice
              process.stdout.write(`[routing-raw] ${JSON.stringify({ id: test.id, variant, provider, ...response })}\n`)
            }
            if (!choice || !question.criteria || !(choice in question.criteria))
              throw new Error('Invalid candidate')
            failures = 0
            rows.push({ id: test.id, variant, provider, expected, choice, correct: expected.includes(choice), ms: Date.now() - begin })
          }
          catch (error) {
            failures++
            rows.push({ id: test.id, variant, provider, expected, correct: false, error: errorMessageFrom(error), ms: Date.now() - begin })
          }
          process.stdout.write(`[routing-result] ${JSON.stringify(rows.at(-1))}\n`)
        }
      }
    }
    const summary = ['original', 'compact', 'scope'].flatMap(variant => ['jev', 'slm'].map(provider => ({ variant, provider, attempted: rows.filter(row => row.variant === variant && row.provider === provider).length, correct: rows.filter(row => row.variant === variant && row.provider === provider && row.correct).length })))
    process.stdout.write(`[routing-summary] ${JSON.stringify({ calls, elapsedMs: Date.now() - started, summary, rows })}\n`)
    expect(rows).toHaveLength(60)
    expect(rows.filter(row => row.error)).toHaveLength(0)
  }
  finally { await live.pool.end() }
}, 490_000)
