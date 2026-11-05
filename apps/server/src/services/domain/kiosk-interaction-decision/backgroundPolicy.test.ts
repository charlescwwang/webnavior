import type { DecisionInput } from '.'

import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'

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
