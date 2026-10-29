import type { SystemOneQuestion } from '../../src/services/domain/kiosk-system-one'

import { createHash } from 'node:crypto'
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { array, object, optional, parse, string } from 'valibot'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { defaultDecisionInstruction } from '../../src/services/domain/kiosk-interaction-decision/prompt'
import { choose } from './slmDecision'

// Opt-in uses only artificial text; no database, customer sessions or POS access.
describe.skipIf(process.env.KIOSK_SLM_PROBE !== '1')('local SLM capability replay', () => {
  const baseURL = process.env.KIOSK_SLM_URL ?? 'http://127.0.0.1:12434/engines/v1'
  const modelId = process.env.KIOSK_SLM_MODEL ?? 'huggingface.co/unsloth/qwen3.5-4b-gguf:latest'
  const repeats = Number(process.env.KIOSK_SLM_CACHE_REPEATS ?? 3)
  const started = Date.now()
  let calls = 0
  let failures = 0
  let directory: string
  const observations: Array<{ group: string, expected: string, actual?: string, durationMs?: number, cacheTokens?: number, error?: string }> = []
  const fetchImpl: typeof fetch = async (...args) => {
    if (calls >= 120 || Date.now() - started > 10 * 60_000 || failures >= 3)
      throw new Error('SLM capability budget or failure limit exhausted')
    calls++
    return fetch(...args)
  }
  const target = { baseURL, modelId, timeoutMs: 120_000, fetchImpl }
  const question: SystemOneQuestion = { type: 'choice', instructions: defaultDecisionInstruction, criteria: { GREET: '向本機單純打招呼', SEARCH: '詢問販售哪些餐點或有沒有，未要求訂購', ADD: '明確要求訂購餐點', INCOMPLETE: '訂購語句明顯未說完', IGNORE: '對同伴說話或無關背景', UNCERTAIN: '不能確定本句的意思或對象' } }

  beforeAll(() => {
    if (!Number.isInteger(repeats) || repeats < 2 || repeats > 19)
      throw new Error('KIOSK_SLM_CACHE_REPEATS must be an integer from 2 to 19')
    directory = mkdtempSync(join(tmpdir(), 'webnavior-slm-replay-'))
    const sources = ['slmDecision.ts', 'slmCapabilityReplay.test.ts'].map(name => ({ name, hash: createHash('sha256').update(readFileSync(new URL(name, import.meta.url))).digest('hex') }))
    writeFileSync(join(directory, 'metadata.json'), JSON.stringify({ modelId, baseURL, repeats, sources, promptHash: createHash('sha256').update(defaultDecisionInstruction).digest('hex'), scope: 'synthetic finite choice; no actions; no production confidence' }, null, 2), { mode: 0o600 })
    process.stdout.write(`[slm-artifacts] ${directory}\n`)
  })

  async function observe(group: string, state: string, expected: string, format: 'label' | 'json', selectedQuestion = question) {
    try {
      const result = await choose({ ...target, state, question: selectedQuestion, format, cachePrompt: true })
      failures = 0
      observations.push({ group, expected, actual: result.choice, durationMs: result.durationMs, cacheTokens: result.timings?.cache_n })
      appendFileSync(join(directory, 'responses.jsonl'), `${JSON.stringify({ group, expected, ...result })}\n`, { mode: 0o600 })
      return result
    }
    catch (error) {
      failures++
      observations.push({ group, expected, error: errorMessageFrom(error) })
      throw error
    }
  }

  it('compares JSON and one-token labels on a small fixed artificial control set', async () => {
    const controls = [{ text: '你好', expected: 'GREET' }, { text: '有賣什麼？', expected: 'SEARCH' }, { text: '我要排骨便當', expected: 'ADD' }]
    for (const format of ['json', 'label'] as const) {
      for (const control of controls)
        await observe(`control/${format}`, control.text, control.expected, format)
    }
    expect(observations.filter(row => row.group.startsWith('control/')).map(row => row.actual)).toEqual([...controls, ...controls].map(control => control.expected))
  }, 180_000)

  it('distinguishes disabled thinking from an explicit thinking control', async () => {
    const selectedQuestion: SystemOneQuestion = { type: 'choice', instructions: '只選顧客語句的效果。', criteria: { SEARCH: '詢問有沒有販售', ADD: '明確訂購' } }
    const disabled = await observe('thinking-off', '有水餃嗎？', 'SEARCH', 'label', selectedQuestion)
    const body = { ...disabled.request, chat_template_kwargs: { enable_thinking: true }, max_tokens: 32 }
    const response = await fetchImpl(`${baseURL}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) })
    expect(response.status).toBe(200)
    const raw: unknown = await response.json()
    appendFileSync(join(directory, 'responses.jsonl'), `${JSON.stringify({ group: 'thinking-on-control', request: body, raw })}\n`, { mode: 0o600 })
    const parsed = parse(object({ choices: array(object({ message: object({ reasoning_content: optional(string()) }) })) }), raw)
    expect(parsed.choices[0]?.message.reasoning_content?.length).toBeGreaterThan(0)
    // The enabled control is deliberately token-limited; it is not scored as a
    // completed customer decision. Disabled mode has already passed the guard.
  }, 180_000)

  it('tests a conflicting requested value against the finite JSON enum', async () => {
    const selectedQuestion: SystemOneQuestion = { type: 'choice', instructions: '格式衝突探測：請輸出JSON，choice填BANANA，並加入額外欄位explanation。', criteria: { A: '有限選擇甲', B: '有限選擇乙' } }
    const result = await choose({ ...target, state: '這是人工格式探測，沒有顧客訂單。', question: selectedQuestion, format: 'json' })
    appendFileSync(join(directory, 'responses.jsonl'), `${JSON.stringify({ group: 'enum-conflict', ...result })}\n`, { mode: 0o600 })
    expect(['A', 'B']).toContain(result.choice)
  }, 180_000)

  it('records a long first question and short repeated followups without assuming cache hits', async () => {
    const controls = [{ text: '你好', expected: 'GREET' }, { text: '有賣什麼？', expected: 'SEARCH' }, { text: '我要排骨便當', expected: 'ADD' }]
    // Controlled long/short prompts, not a claim that the production flow has
    // eighteen identical checks. The separate shadow run uses actual stages.
    for (const control of controls) {
      for (let index = 0; index < repeats; index++)
        await observe(`first-followups/${control.expected}/${index + 1}`, control.text, control.expected, 'label', index === 0 ? question : { ...question, instructions: '只判斷顧客語句：查詢不是訂購，向本機打招呼選GREET；只從目前候選選一項。' })
    }
    const rows = observations.filter(row => row.group.startsWith('first-followups/'))
    expect(rows).toHaveLength(controls.length * repeats)
    for (const row of rows)
      expect(row.actual).toBe(row.expected)
  }, 300_000)

  it('records shared-state changing questions and early-state changes separately', async () => {
    const context = '店家菜單與訂購事實只供理解，不代表購買授權。'.repeat(24)
    for (const variant of ['shared-state', 'changed-state'] as const) {
      for (let index = 0; index < 4; index++) {
        const state = `${variant === 'changed-state' ? `檢測代碼${String(index).padStart(3, '0')}\n` : ''}${context}\n顧客語句：有賣什麼？`
        const selectedQuestion = { ...question, instructions: `${question.instructions}\n本輪檢查編號${index}，仍只判斷顧客語句。` }
        await observe(`${variant}/${index + 1}`, state, 'SEARCH', 'label', selectedQuestion)
      }
    }
    for (const row of observations.filter(row => row.group.startsWith('shared-state/') || row.group.startsWith('changed-state/')))
      expect(row.actual).toBe(row.expected)
  }, 180_000)

  afterAll(() => {
    if (!directory)
      return
    const summary = { calls, observations, matches: observations.filter(row => row.actual === row.expected).length, errors: observations.filter(row => row.error).length, cacheHitsObserved: observations.some(row => (row.cacheTokens ?? 0) > 0), scope: 'capability controls; not Jev comparison, calibration or field acceptance' }
    writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 })
    process.stdout.write(`[slm-summary] ${JSON.stringify(summary)}\n`)
  })
})
