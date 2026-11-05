import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { errorMessageFrom } from '@moeru/std'
import { array, boolean, literal, object, optional, parse, record, string, unknown } from 'valibot'
import { expect, it } from 'vitest'

import { scenarios } from '../../../order-menu/src/experiments/partitionScenarios'
import { choose } from './slmDecision'

const source = new URL('../../../../test_prompt/turnClassifierPoc/results/partition-frozen44.jsonl', import.meta.url)
const rowSchema = object({
  id: string(),
  mode: string(),
  expected: string(),
  assessment: object({ contractMatch: boolean() }),
  decision: object({ trace: object({ exchanges: array(object({
    state: string(),
    questions: record(string(), object({ type: literal('choice'), instructions: string(), criteria: record(string(), string()) })),
    answers: optional(record(string(), unknown())),
  })) }) }),
})
// Historical states and candidate descriptions stay intact. A concise SLM
// policy replaces the old Jev-specific instruction; expected answers stay out.
const instructions = '這是歷史點餐情境的當時快照。只判斷最後一句顧客對本機要求的效果，只選本次候選。不執行操作。查詢販售、價格、瀏覽與想吃分類但沒數量，不是新增訂購；明確指定餐點訂購才新增。改既有數量、移除與內外帶依各候選，不因舊待答問題忽略新需求。省略回答只承接當時有效問題；對已完成資訊單純附和選IGNORE。漏單核對、未知成分或不能完整處理的需求選NEEDS_ASSISTANT。同句多項獨立需求選MULTI_ACTION，不能只做第一項。對同伴說話選IGNORE；話語本身中斷才選INCOMPLETE，缺少唯一品項或數量不是未說完。只能選目前提供的候選，不猜缺少的資料。'

it.skipIf(process.env.KIOSK_SLM_HISTORY !== '1')('sLM only: archived Jev failure families with original state and candidate evidence', async () => {
  const started = Date.now()
  const deadline = started + 7 * 60_000
  const raw = readFileSync(source, 'utf8')
  const selected = raw.trim().split('\n').map(line => JSON.parse(line)).filter(row => row.mode === 'baseline' && row.assessment?.contractMatch === false).map(row => parse(rowSchema, row))
  const manifest = selected.map((row) => {
    const scenario = scenarios.find(test => test.id === row.id)
    if (!scenario || scenario.expected !== row.expected)
      throw new Error(`Historical source/gold mismatch: ${row.id}`)
    const root = row.decision.trace.exchanges.find(exchange => exchange.questions.route)
    if (!root)
      throw new Error(`No historical route evidence: ${row.id}`)
    const accepted = scenario.needsAll ? ['NEEDS_ASSISTANT', 'MULTI_ACTION'] : [row.expected]
    return { id: row.id, family: scenario.family, text: scenario.text, expected: row.expected, accepted, input: { state: root.state, question: { ...root.questions.route!, instructions } }, available: accepted.some(choice => choice in root.questions.route!.criteria), archivedAnswers: root.answers }
  })
  process.stdout.write(`[history-frozen] ${JSON.stringify({ sourceHash: createHash('sha256').update(raw).digest('hex'), manifestHash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), instructions, selected: manifest.map(({ input, ...row }) => row), maxMinutes: 7, maxCalls: manifest.length, scope: 'SLM route selection only, no Jev calls, no fake confidence, no runtime actions; historical final failure does not imply archived root was wrong' })}\n`)
  const rows: Array<{ id: string, family: string, expected: string[], actual?: string, pass: boolean, error?: string }> = []
  let failures = 0
  for (const test of manifest) {
    if (!test.available) {
      process.stdout.write(`[history-gap] ${JSON.stringify({ id: test.id, reason: 'Expected effect missing from archived candidates; application limitation, not an SLM failure' })}\n`)
      continue
    }
    if (Date.now() >= deadline || failures >= 3)
      break
    try {
      const result = await choose({ baseURL: process.env.KIOSK_SLM_URL ?? 'http://127.0.0.1:12434/engines/v1', modelId: process.env.KIOSK_SLM_MODEL ?? 'huggingface.co/unsloth/qwen3.5-4b-gguf:latest', timeoutMs: Math.min(30_000, Math.max(1, deadline - Date.now())), format: 'label', ...test.input })
      failures = 0
      rows.push({ id: test.id, family: test.family, expected: test.accepted, actual: result.choice, pass: test.accepted.includes(result.choice) })
      process.stdout.write(`[history-raw] ${JSON.stringify({ id: test.id, ...result })}\n`)
    }
    catch (error) {
      failures++
      rows.push({ id: test.id, family: test.family, expected: test.accepted, pass: false, error: errorMessageFrom(error) })
    }
    process.stdout.write(`[history-result] ${JSON.stringify(rows.at(-1))}\n`)
  }
  process.stdout.write(`[history-summary] ${JSON.stringify({ selected: manifest.length, gaps: manifest.filter(test => !test.available).map(test => test.id), attempted: rows.length, correct: rows.filter(row => row.pass).length, errors: rows.filter(row => row.error).length, elapsedMs: Date.now() - started, rows })}\n`)
  expect(rows).toHaveLength(manifest.filter(test => test.available).length)
  expect(rows.filter(row => row.error)).toHaveLength(0)
  expect(rows.filter(row => !row.pass)).toEqual([])
}, 450_000)
