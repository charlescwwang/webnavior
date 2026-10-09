import process from 'node:process'

import { readFileSync } from 'node:fs'

const label = process.argv[2] ?? ''
if (!/^[a-z0-9-]{1,40}$/.test(label))
  throw new Error('Pass the recorded run label; this tool never makes provider calls')
const path = new URL(`../../../../test_prompt/turnClassifierPoc/results/assistant-${label}.jsonl`, import.meta.url)
const records = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, any>)
const observations = records.filter(row => row.type === 'observation')
const generations = records.filter(row => row.type === 'generation' || row.type === 'jev')

// This is a receipt/outcome summary, not an oracle for semantic completeness or
// customer-visible prose. Frozen raw rows are never rewritten or regraded.
console.info(JSON.stringify({
  stopped: records.filter(row => row.type === 'stopped' || row.type === 'provider-error'),
  modes: ['jev-front', 'proposal', 'tool-agent'].map((mode) => {
    const rows = observations.filter(row => row.mode === mode)
    const calls = generations.filter(row => row.tag.endsWith(`/${mode}`))
    const perTurn = rows.map(row => calls.filter(call => call.tag.startsWith(`${row.id}/`)).reduce((sum, call) => sum + call.latency_ms, 0)).sort((a, b) => a - b)
    return {
      mode,
      measured: rows.length,
      outcomeMatches: rows.filter(row => row.assessment.outcomeMatches).length,
      automaticCompleted: rows.filter(row => row.assessment.completed).length,
      handoffs: rows.filter(row => row.assessment.localHandoff).length,
      errors: rows.filter(row => row.assessment.toolErrors > 0).length,
      unfinishedLoops: rows.filter(row => !row.assessment.protocolComplete).length,
      httpGenerations: calls.length,
      meanGeneration_ms: perTurn.length ? perTurn.reduce((a, b) => a + b, 0) / perTurn.length : null,
      p50Generation_ms: perTurn.length ? perTurn[Math.ceil(perTurn.length * 0.5) - 1] : null,
      p95Generation_ms: perTurn.length ? perTurn[Math.ceil(perTurn.length * 0.95) - 1] : null,
      quotaWait_ms: calls.reduce((sum, row) => sum + (row.wait_ms ?? 0), 0),
      count_ms: calls.reduce((sum, row) => sum + (row.count_ms ?? 0), 0),
      promptTokens: calls.reduce((sum, row) => sum + (row.data?.usage?.prompt_tokens ?? 0), 0),
      completionTokens: calls.reduce((sum, row) => sum + (row.data?.usage?.completion_tokens ?? 0), 0),
    }
  }),
  cases: observations.map(row => ({ id: row.id, mode: row.mode, after: row.after.items, party: row.after.party, modeAfter: row.after.cart.fulfillmentMode, ...row.assessment, tools: row.receipts.map((receipt: Record<string, unknown>) => receipt.name), answerContainsThought: row.finalAnswer?.includes('<thought>') ?? false })),
}, null, 2))
