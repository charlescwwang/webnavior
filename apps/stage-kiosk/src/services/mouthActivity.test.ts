import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

import { expect, it } from 'vitest'

import { createMouthActivityGate, readMouthGeometry } from './mouthActivity'

const mouth = { centre: { x: 0.5, y: 0.5 }, widthPx: 40, aperture: 0.01 }

// Report: this chat, 2026-11-18 — optional mouth assistance must not discard ordinary speech.
it('admits speech without visual evidence when mouth assistance is disabled', () => {
  let enabled = false
  const gate = createMouthActivityGate({ enabled: () => enabled })
  expect(gate.allowsStart(100)).toBe(true)
  const capture = gate.begin(100)
  gate.observe(200, undefined)
  expect(gate.complete(capture, 5000)).toBe(true)
  enabled = true
  expect(gate.allowsStart(5100)).toBe(false)
  gate.observe(5200, mouth)
  gate.observe(5300, { ...mouth, aperture: 0.08 })
  expect(gate.allowsStart(5300)).toBe(true)
  const assisted = gate.begin(5300)
  gate.observe(5400, undefined)
  expect(gate.complete(assisted, 5500)).toBe(false)
})

// Report: this chat, 2026-11-17 — legacy ASR needs visual admission before VAD.
it('requires real mouth changes instead of a visible face or a mouth held open', () => {
  const gate = createMouthActivityGate()
  expect(gate.allowsStart(0)).toBe(false)
  gate.observe(0, { ...mouth, aperture: 0.1 })
  gate.observe(100, { ...mouth, aperture: 0.1 })
  expect(gate.allowsStart(100)).toBe(false)
  gate.observe(200, { ...mouth, aperture: 0.102 })
  expect(gate.allowsStart(200)).toBe(false)
  gate.observe(300, { ...mouth, aperture: 0.16 })
  expect(gate.allowsStart(300)).toBe(true)
})

it('expires motion, tolerates brief closed lips, and invalidates an utterance on a lost target', () => {
  const gate = createMouthActivityGate()
  gate.observe(0, mouth)
  gate.observe(100, { ...mouth, aperture: 0.08 })
  const capture = gate.begin(100)
  expect(capture).toBeDefined()
  gate.observe(200, mouth)
  gate.observe(300, mouth)
  expect(gate.allowsStart(300)).toBe(false)
  expect(gate.complete(capture, 300)).toBe(true)
  gate.observe(800, mouth)
  expect(gate.allowsStart(800)).toBe(false)
  expect(gate.complete(capture, 800)).toBe(false)
  gate.observe(900, { ...mouth, aperture: 0.08 })
  const next = gate.begin(900)
  gate.observe(1000, undefined)
  gate.observe(1100, mouth)
  expect(gate.complete(next, 1100)).toBe(false)
  expect(gate.allowsStart(1100)).toBe(false)
})

it('never carries motion or capture permission to another person, camera restart or stale frame', () => {
  const gate = createMouthActivityGate()
  gate.observe(0, mouth)
  gate.observe(100, { ...mouth, aperture: 0.08 })
  const capture = gate.begin(100)
  gate.observe(200, { ...mouth, centre: { x: 0.8, y: 0.5 }, aperture: 0.15 })
  expect(gate.allowsStart(200)).toBe(false)
  expect(gate.complete(capture, 200)).toBe(false)
  gate.observe(300, { ...mouth, centre: { x: 0.8, y: 0.5 }, aperture: 0.22 })
  expect(gate.allowsStart(300)).toBe(true)
  expect(gate.allowsStart(600)).toBe(false)
  gate.reset()
  expect(gate.allowsStart(300)).toBe(false)
})

// Report: this chat, 2026-11-17 — closed customer lips still allowed bystander transcripts.
it('never treats lip closure as permission for a new background utterance', () => {
  const gate = createMouthActivityGate()
  gate.observe(0, mouth)
  gate.observe(100, { ...mouth, aperture: 0.08 })
  expect(gate.allowsStart(100)).toBe(true)
  gate.observe(200, mouth)
  expect(gate.allowsStart(200)).toBe(false)
  expect(gate.begin(200)).toBeUndefined()
  gate.observe(300, { ...mouth, aperture: 0.032 })
  expect(gate.allowsStart(300)).toBe(false)
})

// Report: this chat, 2026-11-17 — fresh face geometry alone let background speech extend an admitted phrase.
it('revokes a phrase after sustained visual inactivity even if the same face keeps arriving', () => {
  const gate = createMouthActivityGate()
  gate.observe(0, mouth)
  gate.observe(100, { ...mouth, aperture: 0.08 })
  const capture = gate.begin(100)
  for (let time = 200; time <= 1200; time += 100)
    gate.observe(time, mouth)
  expect(gate.complete(capture, 1200)).toBe(false)
  gate.observe(1300, { ...mouth, aperture: 0.1 })
  expect(gate.allowsStart(1300)).toBe(true)
  expect(gate.complete(capture, 1300)).toBe(false)
  expect(gate.complete(gate.begin(1300), 1300)).toBe(true)
})

it('preserves normal lip closures and the configured VAD silence tail', () => {
  const gate = createMouthActivityGate({ maxMotionGapMs: () => 1600 })
  gate.observe(0, mouth)
  gate.observe(100, { ...mouth, aperture: 0.08 })
  const capture = gate.begin(100)
  for (let time = 200; time <= 1500; time += 100)
    gate.observe(time, mouth)
  expect(gate.allowsStart(1500)).toBe(false)
  expect(gate.complete(capture, 1500)).toBe(true)
  gate.observe(1600, { ...mouth, aperture: 0.08 })
  expect(gate.complete(capture, 1600)).toBe(true)
})

it('measures a single in-zone mouth without canvas, rejecting ambiguous and invalid geometry', () => {
  const face: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))
  face[61] = { x: 0.4, y: 0.5, z: 0, visibility: 1 }
  face[291] = { x: 0.6, y: 0.5, z: 0, visibility: 1 }
  face[13] = { x: 0.5, y: 0.49, z: 0, visibility: 1 }
  face[14] = { x: 0.5, y: 0.51, z: 0, visibility: 1 }
  const zone = { x: 0, y: 0, width: 1, height: 1 }
  expect(readMouthGeometry(200, 100, [face], zone)?.aperture).toBeCloseTo(0.05)
  expect(readMouthGeometry(200, 100, [face], zone)?.widthPx).toBeCloseTo(40)
  expect(readMouthGeometry(200, 100, [face, face], zone)).toBeUndefined()
  expect(readMouthGeometry(0, 100, [face], zone)).toBeUndefined()
  face[14].y = Number.NaN
  expect(readMouthGeometry(200, 100, [face], zone)).toBeUndefined()
})
