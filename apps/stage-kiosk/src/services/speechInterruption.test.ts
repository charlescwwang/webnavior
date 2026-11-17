import { expect, it } from 'vitest'

import { createSpeechInterruption } from './speechInterruption'

// Report: this chat, 2026-11-17 — TTS interruption must not wait for ASR or Jev with background judgement off.
it('qualifies once after 250 ms of local speech without a transcript or model', () => {
  const gate = createSpeechInterruption()
  gate.begin(1)
  for (let time = 0; time < 250; time += 50)
    expect(gate.observe(1, time, 0.9, 0.5, true, 'off')).toBe(false)
  expect(gate.observe(1, 250, 0.9, 0.5, true, 'off')).toBe(true)
  expect(gate.blocksPlayback()).toBe(true)
  expect(gate.observe(1, 300, 0.9, 0.5, true, 'off')).toBe(false)
})

it('rejects short noises, low scores, invalid mouths, missing capture and stale inference', () => {
  const gate = createSpeechInterruption()
  expect(gate.observe(undefined, 0, 0.9, 0.5, true, 'off')).toBe(false)
  gate.begin(1)
  expect(gate.observe(1, 0, 0.9, 0.5, true, 'off')).toBe(false)
  expect(gate.observe(1, 50, 0.1, 0.5, true, 'off')).toBe(false)
  expect(gate.observe(1, 100, 0.9, 0.5, false, 'off')).toBe(false)
  expect(gate.observe(1, 150, 0.9, 0.5, true, 'off')).toBe(false)
  expect(gate.observe(1, 450, 0.9, 0.5, true, 'off')).toBe(false)
  expect(gate.snapshot().durationMs).toBe(0)
  expect(gate.blocksPlayback()).toBe(false)
})

it('isolates overlapping ASR owners and resets all evidence on target or camera changes', () => {
  const gate = createSpeechInterruption()
  gate.begin(1)
  gate.begin(2)
  gate.release(1)
  for (let time = 0; time <= 300; time += 50)
    gate.observe(2, time, 0.9, 0.5, true, 'off')
  expect(gate.blocksPlayback()).toBe(true)
  gate.reset()
  expect(gate.blocksPlayback()).toBe(false)
  expect(gate.observe(2, 350, 0.9, 0.5, true, 'off')).toBe(false)
})

// Report: this chat, 2026-11-17 — background mode controls whether interruption waits for semantic admission.
it.each(['off', 'observe', 'enforce'] as const)('uses the existing %s background policy for playback interruption', (mode) => {
  const gate = createSpeechInterruption()
  gate.begin(1)
  const results = []
  for (let time = 0; time <= 300; time += 50)
    results.push(gate.observe(1, time, 0.9, 0.5, true, mode))
  expect(results.includes(true)).toBe(mode !== 'enforce')
  expect(gate.blocksPlayback()).toBe(mode !== 'enforce')
  if (mode === 'enforce')
    expect(gate.snapshot().reason).toBe('semantic-required')
})
