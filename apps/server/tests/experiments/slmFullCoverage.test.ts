import type { SystemOneQuestion } from '../../src/services/domain/kiosk-system-one'

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { errorMessageFrom } from '@moeru/std'
import { array, boolean, literal, number, object, optional, parse, picklist, record, string } from 'valibot'
import { expect, it } from 'vitest'

import { choose } from './slmDecision'

const manifestSchema = object({
  promptLayout: optional(picklist(['question-first', 'state-first'])),
  questions: record(string(), object({ type: literal('choice'), instructions: string(), criteria: record(string(), string()) })),
  cases: array(object({ id: string(), caseId: string(), group: string(), field: string(), text: string(), state: string(), question: string(), accepted: array(string()), source: string(), gap: boolean(), evidenceMissing: optional(boolean()), note: optional(string()) })),
  limits: object({ maxCalls: number(), minutes: number(), perRequestMs: number(), consecutiveErrors: number() }),
})

it.skipIf(process.env.KIOSK_SLM_FULL !== '1')('evaluates every frozen compatible case and reports missing evidence without shrinking the denominator', async () => {
  const raw = readFileSync(process.env.KIOSK_SLM_FULL_MANIFEST ?? '/tmp/webnavior-full-coverage-manifest.json', 'utf8')
  const manifest = parse(manifestSchema, JSON.parse(raw))
  const baseURL = process.env.KIOSK_SLM_URL ?? 'http://127.0.0.1:12434/engines/v1'
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname))
    throw new Error('Private full-corpus replay requires local DMR; external endpoints are forbidden')
  if (new Set(manifest.cases.map(row => row.id)).size !== manifest.cases.length)
    throw new Error('Duplicate assessment IDs')
  const started = Date.now()
  const deadline = started + manifest.limits.minutes * 60_000
  const modelId = process.env.KIOSK_SLM_MODEL ?? 'huggingface.co/unsloth/qwen3.5-4b-gguf:latest'
  // Full-source collection uses a stable question prefix by default. A separately
  // frozen full-route control can explicitly retain the earlier state-first API.
  const promptLayout = manifest.promptLayout ?? 'question-first'
  const rows: Array<{ id: string, caseId: string, group: string, field: string, expected: string[], status: 'MATCH' | 'MISMATCH' | 'UNSCORED' | 'APPLICATION_GAP' | 'EVIDENCE_GAP' | 'ERROR' | 'NOT_RUN', choice?: string, error?: string, ms?: number, cachedTokens?: number }> = []
  let calls = 0
  let consecutiveErrors = 0
  process.stdout.write(`[full-frozen] ${JSON.stringify({ manifestHash: createHash('sha256').update(raw).digest('hex'), assessments: manifest.cases.length, sourceCases: new Set(manifest.cases.map(row => row.caseId)).size, limits: manifest.limits, modelId, layout: `${promptLayout}; cache_prompt=true; no model history or hidden retries`, scope: 'Different task groups reported separately; no production authority or confidence' })}\n`)
  // Group identical frozen questions to permit cache reuse. All cases remain;
  // this changes execution order, not gold, context or candidate membership.
  const ordered = [...manifest.cases].sort((a, b) => a.group.localeCompare(b.group) || a.question.localeCompare(b.question) || a.id.localeCompare(b.id))
  for (const test of ordered) {
    const row = { id: test.id, caseId: test.caseId, group: test.group, field: test.field, expected: test.accepted }
    if (test.evidenceMissing) {
      rows.push({ ...row, status: 'EVIDENCE_GAP' })
      continue
    }
    // Reserve a whole request deadline before starting. Truncating the last
    // request to the batch's few remaining milliseconds creates a harness
    // timeout and can leave inference running after the client has moved on.
    if (Date.now() + manifest.limits.perRequestMs > deadline || calls >= manifest.limits.maxCalls || consecutiveErrors >= manifest.limits.consecutiveErrors) {
      rows.push({ ...row, status: 'NOT_RUN' })
      continue
    }
    const question: SystemOneQuestion | undefined = manifest.questions[test.question]
    if (!question)
      throw new Error(`Missing frozen question: ${test.id}`)
    const begin = Date.now()
    calls++
    try {
      const response = await choose({ baseURL, modelId, format: 'label', questionFirst: promptLayout === 'question-first', cachePrompt: true, state: test.state, question, timeoutMs: Math.min(manifest.limits.perRequestMs, Math.max(1, deadline - Date.now())) })
      consecutiveErrors = 0
      rows.push({ ...row, status: test.gap ? 'APPLICATION_GAP' : test.accepted.length === 0 ? 'UNSCORED' : test.accepted.includes(response.choice) ? 'MATCH' : 'MISMATCH', choice: response.choice, ms: Date.now() - begin, cachedTokens: response.timings?.cache_n })
      // Raw exact prompts, responses and private utterances stay in a 0600 log,
      // never in the public summary. These are diagnostic probabilities only.
      process.stdout.write(`[full-raw] ${JSON.stringify({ id: test.id, ...response })}\n`)
    }
    catch (error) {
      consecutiveErrors++
      rows.push({ ...row, status: 'ERROR', error: errorMessageFrom(error), ms: Date.now() - begin })
    }
    process.stdout.write(`[full-result] ${JSON.stringify(rows.at(-1))}\n`)
    if (calls % 25 === 0)
      process.stdout.write(`[full-progress] ${JSON.stringify({ calls, elapsedMs: Date.now() - started, assessed: rows.length, total: manifest.cases.length })}\n`)
  }
  const groups = [...new Set(manifest.cases.map(row => row.group))].map((group) => {
    const found = rows.filter(row => row.group === group)
    return { group, assessments: found.length, sourceCases: new Set(found.map(row => row.caseId)).size, statuses: Object.fromEntries(['MATCH', 'MISMATCH', 'UNSCORED', 'APPLICATION_GAP', 'EVIDENCE_GAP', 'ERROR', 'NOT_RUN'].map(status => [status, found.filter(row => row.status === status).length])) }
  })
  process.stdout.write(`[full-summary] ${JSON.stringify({ manifestHash: createHash('sha256').update(raw).digest('hex'), elapsedMs: Date.now() - started, calls, groups, rows })}\n`)
  expect(rows).toHaveLength(manifest.cases.length)
  expect(rows.filter(row => row.status === 'NOT_RUN')).toHaveLength(0)
  expect(rows.filter(row => row.status === 'ERROR')).toHaveLength(0)
  // Semantic mismatches remain visible failures; complete collection is never
  // presented as model-quality acceptance or successful order execution.
  expect(rows.filter(row => row.status === 'MISMATCH').map(row => row.id)).toEqual([])
}, 36 * 60_000)
