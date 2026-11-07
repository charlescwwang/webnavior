import type { DecisionInput } from '.'

import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'
import { resolvePhoneChoice } from './phoneResolution'
import { scopeDecisionPolicy } from './queryScopeContracts'
import { recoverServiceRequest } from './serviceRecovery'
import { resolveServiceHandoff } from './serviceResolution'

const policy = { decisionInstruction: '', storeInstruction: '' }
const candidates = [{ id: 'intent:search-menu', description: '看菜單' }]

describe('independent background speech policy', () => {
  it.each(['off', 'observe', 'enforce'] as const)('uses %s without borrowing observation confidence', async (mode) => {
    const invoke = vi.fn<DecisionInput['invoke']>(async (_state, questions) => {
      const key = Object.keys(questions)[0]!
      const choice = key === 'admission' ? 'BACKGROUND' : key === 'purpose' ? 'SINGLE' : key === 'family' ? 'MENU' : 'intent:search-menu'
      return { answers: { [key]: { choice, confidence: key === 'admission' ? 0.99 : 0.85 } } }
    })
    const result = await decideInteraction({ routing: 'staged', backgroundSpeechMode: mode, policy, candidates, transcript: '看菜單', includeTrace: true, invoke })
    expect(result.kind).toBe(mode === 'enforce' ? 'IGNORE' : 'FAST_ACTION')
    expect(invoke.mock.calls.some(([, questions]) => 'admission' in questions)).toBe(mode !== 'off')
    if (mode !== 'enforce')
      expect(result).toHaveProperty('confidence', 0.85)
  })
  it('does not call a background classifier when the setting is omitted', async () => {
    const invoke = vi.fn<DecisionInput['invoke']>(async (_state, questions) => {
      const key = Object.keys(questions)[0]!
      return { answers: { [key]: { choice: key === 'purpose' ? 'INCOMPLETE' : 'BACKGROUND', confidence: 0.9 } } }
    })
    const result = await decideInteraction({ routing: 'staged', policy, candidates, transcript: '我要那個還有', invoke })
    expect(result.kind).toBe('INCOMPLETE')
    expect(invoke.mock.calls.some(([, questions]) => 'admission' in questions)).toBe(false)
  })
})

it('continues semantic interpretation when an observe-only background call fails', async () => {
  const invoke = vi.fn<DecisionInput['invoke']>(async (_state, questions) => {
    const key = Object.keys(questions)[0]!
    if (key === 'admission')
      throw new Error('Observation unavailable')
    return { answers: { [key]: { choice: key === 'purpose' ? 'SINGLE' : key === 'family' ? 'MENU' : 'intent:search-menu', confidence: 0.8 } } }
  })
  const result = await decideInteraction({ routing: 'staged', backgroundSpeechMode: 'observe', policy, candidates, transcript: '看菜單', invoke, includeTrace: true })
  expect(result.kind).toBe('FAST_ACTION')
  expect(result).toHaveProperty('confidence', 0.8)
  expect(result.trace).toMatchObject({ backgroundObservation: { mode: 'observe', failed: true } })
})

// Report: attachment a6e7ea59, 王大陸你認識嗎？ was ignored after background mode was turned off.
it.each(['off', 'observe'] as const)('keeps %s recovery limited to meaning rather than background admission', async (mode) => {
  const complete = vi.fn(async (body: Record<string, any>) => {
    const properties = body.tools[0].function.parameters.properties
    expect(properties.admission.enum).toEqual(['service'])
    expect(properties.disposition.enum).toEqual(['assistant', 'clarify'])
    expect(properties).not.toHaveProperty('recipient')
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_request', arguments: JSON.stringify({ admission: 'service', disposition: 'assistant' }) } }] } }] })
  })
  const result = await recoverServiceRequest({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', recovery: { status: 'eligible' } }, { backgroundSpeechMode: mode, transcript: '王大陸你認識嗎？', state: { phase: 'ordering' }, complete })
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result).not.toHaveProperty('actionId')
  expect(complete).toHaveBeenCalledTimes(1)
})

// Report: this chat, 2026-11-06; scope, phone and query-scope had independent background choices.
it.each(['off', 'observe'] as const)('removes background options from all Main classifiers in %s', async (mode) => {
  const scope = vi.fn(async (body: Record<string, any>) => {
    expect(body.tools[0].function.parameters.properties.choice.enum).not.toContain('BACKGROUND')
    expect(body.tools[0].function.parameters.properties).not.toHaveProperty('recipient')
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"choice":"SERVICE_INFORMATION_ONLY"}' } }] } }] })
  })
  expect(await resolveServiceHandoff({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' }, '王大陸你認識嗎？', { phase: 'ordering' }, scope, undefined, mode)).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION' })
  const phone = vi.fn(async (body: Record<string, any>) => {
    expect(body.tools[0].function.parameters.properties.choice.enum).not.toContain('BACKGROUND')
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_phone_choice', arguments: '{"choice":"KEEP_PHONE"}' } }] } }] })
  })
  expect(await resolvePhoneChoice('你認識他嗎？', phone, mode)).toHaveProperty('choice', 'KEEP_PHONE')
  expect(scopeDecisionPolicy(mode).tool.function.parameters.properties.choice.enum).not.toContain('IGNORE')
})
