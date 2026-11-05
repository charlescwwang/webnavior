import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

import { errorMessageFrom } from '@moeru/std'
import { array, boolean, object, parse, string } from 'valibot'
import { expect, it } from 'vitest'

import { mockDB } from '../../src/libs/mock-db'
import { admissionQuestion } from '../../src/services/domain/kiosk-interaction-decision/routing'
import { createKioskSystemOneService } from '../../src/services/domain/kiosk-system-one'
import { createEnvelopeCrypto } from '../../src/utils/envelope-crypto'

import * as schema from '../../src/schemas'

const manifestSchema = object({ cases: array(object({ id: string(), caseId: string(), group: string(), field: string(), text: string(), state: string(), accepted: array(string()), source: string(), gap: boolean() })) })

it.skipIf(process.env.KIOSK_STAGED_SLM_FULL !== '1')('runs the production SLM first gate on the entire historical source inventory, without claiming complete ordering acceptance', async () => {
  const paths = ['/tmp/webnavior-full-coverage-manifest.json', '/tmp/webnavior-full-coverage-older-manifest.json']
  const sources = paths.map((path) => {
    const raw = readFileSync(path, 'utf8')
    return { path, hash: createHash('sha256').update(raw).digest('hex'), manifest: parse(manifestSchema, JSON.parse(raw)) }
  })
  const cases = [...new Map(sources.flatMap(source => source.manifest.cases).map(row => [row.caseId, row])).values()]
  // The existing source inventory is a floor, not a sample size knob. Every
  // source record is visited, including records without usable semantic gold.
  expect(cases.length).toBe(1114)
  const baseURL = process.env.KIOSK_SLM_URL ?? 'http://127.0.0.1:12434/engines/v1'
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname))
    throw new Error('Private corpus requires a local model endpoint')
  const modelId = process.env.KIOSK_SLM_MODEL ?? 'huggingface.co/unsloth/qwen3.5-4b-gguf:latest'
  let calls = 0
  const service = createKioskSystemOneService({ db: await mockDB(schema), envelopeCrypto: createEnvelopeCrypto({ masterKey: Buffer.alloc(32, 7) }), fetchImpl: async (url, init) => {
    calls++
    return fetch(url, init)
  } })
  const profile = await service.save({ baseURL, implementation: 'slm', modelId, name: 'Isolated full inventory replay', timeoutMs: 35_000 })
  const frozen = { sources: sources.map(({ path, hash }) => ({ path, hash })), question: admissionQuestion, sourceCases: cases.length, modelId, scope: 'FIRST_GATE_ONLY. Existing labels describe different tasks and are retained as provenance, not converted into fabricated four-way gold. No Main, browser tools, cart, settings or deployed DB mutations.' }
  process.stdout.write(`[staged-frozen] ${JSON.stringify(frozen)}\n`)
  await service.readiness(profile.id)
  await service.activate(profile.id)
  const started = Date.now()
  const rows: Array<{ caseId: string, group: string, choice?: string, error?: string, ms: number }> = []
  for (const row of cases) {
    const startedAt = Date.now()
    try {
      // The exact source transcript stays separate from historical context. No
      // old model answer or expected label enters this provider request.
      const state = JSON.stringify({ customerUtterance: row.text, historicalContext: row.state })
      const response = await service.decide(state, { admission: admissionQuestion })
      const choice = response.answers?.admission as { choice?: string } | undefined
      if (response.selectionMode !== 'unscored' || !choice?.choice || !Object.hasOwn(admissionQuestion.criteria ?? {}, choice.choice))
        throw new Error('Invalid production SLM first-gate output')
      rows.push({ caseId: row.caseId, group: row.group, choice: choice.choice, ms: Date.now() - startedAt })
      // Raw speech/context is sensitive. The runner's stdout must be redirected
      // to a private log; the public summary below carries only IDs and counts.
      process.stdout.write(`[staged-raw] ${JSON.stringify({ caseId: row.caseId, state, question: admissionQuestion, response })}\n`)
    }
    catch (error) {
      rows.push({ caseId: row.caseId, group: row.group, error: errorMessageFrom(error) ?? 'Provider failure', ms: Date.now() - startedAt })
    }
    process.stdout.write(`[staged-result] ${JSON.stringify(rows.at(-1))}\n`)
    if (rows.length % 25 === 0)
      process.stdout.write(`[staged-progress] ${JSON.stringify({ completed: rows.length, total: cases.length, calls, elapsedMs: Date.now() - started })}\n`)
  }
  const counts = (items: typeof rows) => Object.fromEntries(['SERVICE', 'GREET', 'BACKGROUND', 'UNCERTAIN', 'ERROR'].map(choice => [choice, items.filter(row => choice === 'ERROR' ? Boolean(row.error) : row.choice === choice).length]))
  const publicRows = rows.map(({ error, ...row }) => ({ ...row, ...(error ? { failed: true } : {}) }))
  const summary = { ...frozen, completed: rows.length, actualRequests: calls, elapsedMs: Date.now() - started, collectionComplete: rows.length === cases.length, semanticAccuracy: null, fieldAcceptance: false, outcomes: counts(rows), groups: Object.fromEntries([...new Set(rows.map(row => row.group))].map(group => [group, counts(rows.filter(row => row.group === group))])), rows: publicRows }
  writeFileSync(process.env.KIOSK_STAGED_SLM_SUMMARY ?? '/tmp/webnavior-staged-slm-first-gate-summary.json', `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  process.stdout.write(`[staged-summary] ${JSON.stringify({ completed: rows.length, calls, elapsedMs: summary.elapsedMs, outcomes: summary.outcomes })}\n`)
  expect(rows).toHaveLength(cases.length)
  expect(rows.filter(row => row.error)).toEqual([])
}, 90 * 60_000)
