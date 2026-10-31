import type { DecisionInput } from '../kiosk-interaction-decision'
import type { KioskDecisionState, KioskInteractionDecision } from '../kiosk-interaction-decision/contracts'

import { expect, it, vi } from 'vitest'

import { resolveOrderingIntent } from '.'

const admitted: KioskInteractionDecision = { kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION', confidence: 0.2025, modelCalls: 3, modelQuestions: 3 }
const input: Pick<DecisionInput, 'transcript' | 'decisionState' | 'candidates' | 'conversation'> = {
  transcript: '我要水餃',
  decisionState: { phase: 'ordering', productResolution: { status: 'exact', count: 1, references: [{ label: '水餃', refId: 'item:dumplings' }] } },
  candidates: [{ id: 'intent:search-menu', description: '只查詢，不訂購' }, { id: 'intent:add-item', description: '新增；缺份數交Menu提問' }, { id: 'intent:start-checkout', description: '開始結帳' }],
}
const answer = (choice: string) => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_ordering_intent', arguments: JSON.stringify({ choice }) } }] } }] })

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct31 core-cart.
it.each(['intent:add-item', 'intent:search-menu'])('uses a real issued effect without turning Main selection into a JEV score: %s', async (choice) => {
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>(async () => answer(choice))
  const result = await resolveOrderingIntent(admitted, input, complete)
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: choice, resolvedBy: 'main-skill', modelCalls: 3, modelQuestions: 3, trace: { mainSkill: { id: 'ordering', version: 1, selected: choice, calls: 1 } } })
  expect(result).not.toHaveProperty('confidence')
  expect(result).not.toHaveProperty('reason')
  expect(complete).toHaveBeenCalledOnce()
  const body = complete.mock.calls[0]![0] as Record<string, unknown>
  expect(JSON.stringify(body)).toContain('ordering@1')
  expect(body).toMatchObject({ tools: [{ function: { parameters: { properties: { choice: { enum: ['intent:search-menu', 'intent:add-item', 'UNCERTAIN'] } } } } }] })
})

it.each([
  { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST' },
  { kind: 'NEEDS_ASSISTANT', reason: 'PROVIDER_FAILURE' },
  { kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' },
  { kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION', recovery: { status: 'completed', admission: 'service', readOnly: true } },
] as const)('does not promote $kind/$reason into an operation', async (decision) => {
  const complete = vi.fn(async () => answer('intent:add-item'))
  expect(await resolveOrderingIntent(decision, input, complete)).toBe(decision)
  expect(complete).not.toHaveBeenCalled()
})

it.each([
  { phase: 'customer_entry' },
  { phase: 'checkout_invoice' },
  { phase: 'ordering', readOnly: true },
  { phase: 'ordering', productResolution: { status: 'possible', count: 1, references: [] } },
  { phase: 'ordering', productResolution: { status: 'exact', count: 2, references: [] } },
  { phase: 'ordering', priceEvidence: { amounts: [], choices: [] } },
  { phase: 'ordering', constraints: { exclude: [], unresolvedPrice: true } },
] satisfies KioskDecisionState[])('keeps the original restrictions for $phase', async (state) => {
  const complete = vi.fn(async () => answer('intent:add-item'))
  expect(await resolveOrderingIntent(admitted, { ...input, decisionState: { ...input.decisionState, ...state } }, complete)).toBe(admitted)
  expect(complete).not.toHaveBeenCalled()
})

it.each(['UNCERTAIN', 'intent:start-checkout', 'invented'])('keeps the handoff when Main cannot select an eligible complete effect: %s', async (choice) => {
  const result = await resolveOrderingIntent(admitted, input, async () => answer(choice))
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
  expect(result).not.toHaveProperty('actionId')
})

it.each([
  [{ function: { name: 'order_add_item', arguments: '{"choice":"intent:add-item"}' } }],
  [{ function: { name: 'resolve_ordering_intent', arguments: '{"choice":"intent:add-item","quantity":2}' } }],
  [{ function: { name: 'resolve_ordering_intent', arguments: '{"choice":"intent:add-item"}' } }, { function: { name: 'resolve_ordering_intent', arguments: '{"choice":"intent:search-menu"}' } }],
  [{ function: { name: 'resolve_ordering_intent', arguments: 'invalid' } }],
].map(calls => ({ calls })))('rejects malformed or partial executable proposals', async ({ calls }) => {
  const result = await resolveOrderingIntent(admitted, input, async () => Response.json({ choices: [{ message: { tool_calls: calls } }] }))
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result).not.toHaveProperty('actionId')
})

it('does not retry or release a task after provider failure', async () => {
  const complete = vi.fn(async () => {
    throw new Error('offline')
  })
  const result = await resolveOrderingIntent(admitted, input, complete)
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result).not.toHaveProperty('actionId')
  expect(complete).toHaveBeenCalledOnce()
})

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, full six-turn acceptance.
it('selects only a current meal-slot answer and preserves its browser question correlation', async () => {
  const candidate = { id: 'configure:current:quantity:2', description: '目前水餃兩份' }
  const waitingFor = { questionId: 'current', purpose: 'item-configuration', question: '水餃要幾份？', expiresAt: Date.now() + 30000, choices: [candidate] }
  const state = { phase: 'configuration', waitingFor }
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>(async () => answer(candidate.id))
  const result = await resolveOrderingIntent(admitted, { ...input, transcript: '兩份', decisionState: state, candidates: [candidate, { id: 'configure:other:quantity:2', description: '另一個問題' }] }, complete)
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: candidate.id, answeredQuestionId: 'current', resolvedBy: 'main-skill' })
  expect(complete.mock.calls[0]![0]).toMatchObject({ tools: [{ function: { parameters: { properties: { choice: { enum: [candidate.id, 'UNCERTAIN'] } } } } }] })
  expect(result).not.toHaveProperty('confidence')
})

it.each(['expired', 'other-purpose', 'unissued', 'readonly'])('does not revive an invalid meal question: %s', async (scenario) => {
  const candidate = { id: 'configure:current:quantity:2', description: '目前水餃兩份' }
  const waitingFor = { questionId: 'current', purpose: scenario === 'other-purpose' ? 'payment-method' : 'item-configuration', question: '要幾份？', expiresAt: scenario === 'expired' ? Date.now() - 1 : Date.now() + 30000, choices: scenario === 'unissued' ? [] : [candidate] }
  const complete = vi.fn(async () => answer(candidate.id))
  const result = await resolveOrderingIntent(admitted, { ...input, transcript: '兩份', decisionState: { phase: 'configuration', readOnly: scenario === 'readonly', waitingFor }, candidates: [candidate] }, complete)
  expect(result).toBe(admitted)
  expect(complete).not.toHaveBeenCalled()
})
