import type { KioskDecisionState, KioskInteractionDecision } from './contracts'

import { expect, it, vi } from 'vitest'

import { resolveServiceHandoff } from './serviceResolution'

const decision: KioskInteractionDecision = { kind: 'NEEDS_ASSISTANT', confidence: 0.95, trace: { model: 'recorded' }, modelCalls: 2, modelQuestions: 2 }
const state: KioskDecisionState = { phase: 'ordering', catalogEvidence: { products: [], categories: [] } }
function response(choice: string) {
  return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: JSON.stringify({ choice }) } }] } }] })
}

// Report: this chat, 2026-10-21; generic Main routing incorrectly required menu reads for store FAQs.
it.each(['你們幾點關門？', '能開電子發票嗎？', '怎麼拿餐？', '可以用現金嗎？', '你可以做什麼？'])('recovers a generic service-information handoff: %s', async (transcript) => {
  const complete = vi.fn(async (_body: Record<string, unknown>) => response('SERVICE_INFO'))
  const result = await resolveServiceHandoff(decision, transcript, state, complete)
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION', modelCalls: 2, modelQuestions: 2, trace: { serviceResolution: { choice: 'SERVICE_INFO' } } })
  expect(result).not.toHaveProperty('actionId')
  expect(complete.mock.calls[0]?.[0]).toMatchObject({ tool_choice: 'required', tools: [{ function: { name: 'resolve_service_scope' } }], messages: expect.arrayContaining([{ role: 'user', content: JSON.stringify({ customerUtterance: transcript, phase: 'ordering', waitingFor: null }) }]) })
})

it.each(['MEAL_REQUEST', 'UNCERTAIN', 'invented'])('retains the original food guard for %s', async (choice) => {
  const result = await resolveServiceHandoff(decision, '我不想吃飯，還有什麼？', state, async () => response(choice))
  expect(result).not.toHaveProperty('reason')
  expect(result).not.toHaveProperty('actionId')
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', modelCalls: 2 })
})

it.each([
  { decision: { kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION' }, state },
  { decision: { kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' }, state },
  { decision: { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT' }, state },
  { decision, state: { phase: 'customer_entry' } },
  { decision, state: { ...state, catalogEvidence: { products: [{ label: '水餃', matchedText: '水餃', source: 'name' }], categories: [] } } },
] satisfies Array<{ decision: KioskInteractionDecision, state: KioskDecisionState }>)('does not reclassify qualified or protected handoffs %#', async (input) => {
  const complete = vi.fn(async () => response('SERVICE_INFO'))
  expect(await resolveServiceHandoff(input.decision, '略過', input.state, complete)).toBe(input.decision)
  expect(complete).not.toHaveBeenCalled()
})

it('retains the original guard if Main is unavailable', async () => {
  const result = await resolveServiceHandoff(decision, '幾點營業？', state, async () => {
    throw new Error('offline')
  })
  expect(result).not.toHaveProperty('reason')
  expect(result).toHaveProperty('trace.serviceResolution.choice', 'UNCERTAIN')
})

it.each([
  { name: 'order_add_item', arguments: '{"choice":"SERVICE_INFO"}' },
  { name: 'resolve_service_scope', arguments: 'invalid' },
  { name: 'resolve_service_scope', arguments: '{"choice":"SERVICE_INFO","action":"skip"}' },
])('rejects malformed scope proposals without releasing the food guard: $name/$arguments', async (call) => {
  const result = await resolveServiceHandoff(decision, '能開發票嗎？', state, async () => Response.json({ choices: [{ message: { tool_calls: [{ function: call }] } }] }))
  expect(result).not.toHaveProperty('reason')
  expect(result).toHaveProperty('trace.serviceResolution.choice', 'UNCERTAIN')
})
