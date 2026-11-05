import type { DetectionZone, PresenceCandidate } from '@proj-airi/kiosk-proactive'

import { createPresenceWindow, defaultPresenceSettings, defaultProactiveInteractionSettings } from '@proj-airi/kiosk-proactive'
import { describe, expect, it } from 'vitest'

import { createVoicePresenceGate } from './voicePresence'

const zone = { x: 0.2, y: 0.15, width: 0.6, height: 0.7 }
const person = { centre: { x: 0.5, y: 0.5 }, poseQuality: 0.8, bodyScale: 0.2, attention: 'unknown' as const }
const observing = { enabled: true, observing: true }

// Exercise the real presence classifier rather than rebuilding its ROI flags.
function observe(gate: ReturnType<typeof createVoicePresenceGate>, nowMs: number, candidate: Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'> | undefined, greetingRoi: DetectionZone) {
  const presence = createPresenceWindow({ ...defaultPresenceSettings, greetingRoi }, defaultProactiveInteractionSettings)
  gate.observe(nowMs, presence.decide(nowMs, candidate).candidate)
}

// Report: this chat, 2026-10-20; ambient ASR must not invite an absent customer.
describe('local presence admission for voice and proactive speech', () => {
  it('rejects empty observations before any person has been seen', () => {
    const gate = createVoicePresenceGate()
    observe(gate, 100, undefined, zone)
    expect(gate.allows({ ...observing, nowMs: 100 })).toBe(false)
  })

  it('admits the first valid person without waiting for greeting dwell', () => {
    const gate = createVoicePresenceGate()
    observe(gate, 100, person, zone)
    expect(gate.allows({ ...observing, nowMs: 100 })).toBe(true)
  })

  it('retains short missed detections but expires old evidence even if inference stops', () => {
    const gate = createVoicePresenceGate()
    observe(gate, 100, person, zone)
    observe(gate, 500, undefined, zone)
    expect(gate.allows({ ...observing, nowMs: 1599 })).toBe(true)
    expect(gate.allows({ ...observing, nowMs: 1601 })).toBe(false)
    observe(gate, 1700, person, zone)
    expect(gate.allows({ ...observing, nowMs: 1700 })).toBe(true)
  })

  it('does not renew admission with low-quality or out-of-zone candidates', () => {
    const gate = createVoicePresenceGate()
    observe(gate, 100, { ...person, poseQuality: 0.4 }, zone)
    expect(gate.allows({ ...observing, nowMs: 100 })).toBe(false)
    observe(gate, 200, { ...person, centre: { x: 0.05, y: 0.05 } }, zone)
    expect(gate.allows({ ...observing, nowMs: 200 })).toBe(false)
  })

  it('blocks starting, failed and restarted cameras until fresh detection', () => {
    const gate = createVoicePresenceGate()
    expect(gate.allows({ enabled: true, observing: false, nowMs: 0 })).toBe(false)
    observe(gate, 100, person, zone)
    expect(gate.allows({ enabled: true, observing: false, nowMs: 100 })).toBe(false)
    gate.reset()
    expect(gate.allows({ ...observing, nowMs: 101 })).toBe(false)
  })

  it('preserves voice service when observation has not been enabled', () => {
    const gate = createVoicePresenceGate()
    expect(gate.allows({ enabled: false, observing: false, nowMs: 100 })).toBe(true)
  })
})

// Report: this chat,2026-11-05 — operator sees ENGAGED but all5 starts were rejected.
describe('voice admission diagnostics with unchanged observation policy', () => {
  it('reports low-quality evidence without falsely claiming that no person exists', () => {
    const gate = createVoicePresenceGate()
    observe(gate, 100, { ...person, poseQuality: 0.4 }, zone)
    const decision = gate.inspect({ ...observing, nowMs: 100 })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('low_quality')
    expect(decision.quality).toBe(0.4)
    expect(decision.insideZone).toBe(true)
    expect(decision.ageMs).toBeNull()
  })

  it('reports absent inference, out-of-zone and expired evidence independently', () => {
    const gate = createVoicePresenceGate()
    expect(gate.inspect({ enabled: true, observing: false, nowMs: 0 }).reason).toBe('not_observing')
    observe(gate, 100, { ...person, centre: { x: 0.01, y: 0.01 } }, zone)
    expect(gate.inspect({ ...observing, nowMs: 100 }).reason).toBe('outside_zone')
    observe(gate, 200, person, zone)
    const blocked = gate.inspect({ ...observing, nowMs: 1701 })
    expect(blocked.reason).toBe('stale')
    expect(blocked.ageMs).toBe(1501)
    expect(blocked.allowed).toBe(false)
    observe(gate, 1800, person, zone)
    expect(blocked.reason).toBe('stale')
    expect(gate.inspect({ ...observing, nowMs: 1800 }).reason).toBe('fresh_person')
  })

  it('preserves fresh valid evidence across briefly missed or low-quality frames', () => {
    const gate = createVoicePresenceGate()
    observe(gate, 100, person, zone)
    observe(gate, 500, { ...person, poseQuality: 0.4 }, zone)
    expect(gate.inspect({ ...observing, nowMs: 1599 }).allowed).toBe(true)
    expect(gate.inspect({ ...observing, nowMs: 1601 }).allowed).toBe(false)
    gate.reset()
    expect(gate.inspect({ ...observing, nowMs: 1700 }).reason).toBe('no_person')
  })
})

// Reproduces a possible ENGAGED/admission mismatch, not a claim about the user's unseen pose data.
it('can retain ENGAGED with a visible person while voice rejects sustained low-quality tracking', () => {
  const presence = createPresenceWindow(defaultPresenceSettings, defaultProactiveInteractionSettings)
  const gate = createVoicePresenceGate()
  presence.decide(0, person)
  observe(gate, 0, person, zone)
  expect(presence.decide(1300, person).state).toBe('ENGAGED')
  observe(gate, 1300, person, zone)
  const visibleButPartial = { ...person, poseQuality: 0.4 }
  expect(presence.decide(3000, visibleButPartial).state).toBe('ENGAGED')
  observe(gate, 3000, visibleButPartial, zone)
  expect(gate.inspect({ ...observing, nowMs: 3000 }).reason).toBe('low_quality')
  expect(gate.inspect({ ...observing, nowMs: 3000 }).insideZone).toBe(true)
})

// Report: this chat screenshot,2026-11-05 — ENGAGED/ROI interaction while voice says outside_zone.
it('admits a fresh customer in the interaction ROI below the greeting zone', () => {
  const settings = { ...defaultPresenceSettings, greetingRoi: zone }
  const presence = createPresenceWindow(settings, defaultProactiveInteractionSettings)
  const gate = createVoicePresenceGate()
  const customer = { ...person, centre: { x: 0.5, y: 0.86 }, poseQuality: 0.599304709815979 }
  presence.decide(0, customer)
  const decision = presence.decide(1300, customer)
  expect(decision.state).toBe('ENGAGED')
  expect(decision.candidate?.greetingRoiHit).toBe(false)
  expect(decision.candidate?.interactionRoiHit).toBe(true)
  gate.observe(1300, decision.candidate)
  expect(gate.inspect({ ...observing, nowMs: 1300 }).allowed).toBe(true)
  expect(gate.inspect({ ...observing, nowMs: 1300 }).insideZone).toBe(true)
})

it('preserves greeting-only admission and rejects people outside both canonical zones', () => {
  const gate = createVoicePresenceGate()
  const presence = createPresenceWindow({ ...defaultPresenceSettings, greetingRoi: zone }, defaultProactiveInteractionSettings)
  const greetingOnly = presence.decide(100, { ...person, centre: { x: 0.25, y: 0.5 } }).candidate
  expect(greetingOnly?.greetingRoiHit).toBe(true)
  expect(greetingOnly?.interactionRoiHit).toBe(false)
  gate.observe(100, greetingOnly)
  expect(gate.inspect({ ...observing, nowMs: 100 }).allowed).toBe(true)
  gate.reset()
  gate.observe(200, presence.decide(200, { ...person, centre: { x: 0.9, y: 0.95 } }).candidate)
  expect(gate.inspect({ ...observing, nowMs: 200 }).reason).toBe('outside_zone')
  expect(gate.inspect({ ...observing, nowMs: 200 }).allowed).toBe(false)
})

it('still requires fresh quality-qualified observations within the interaction-only area', () => {
  const gate = createVoicePresenceGate()
  const presence = createPresenceWindow({ ...defaultPresenceSettings, greetingRoi: zone }, defaultProactiveInteractionSettings)
  gate.observe(100, presence.decide(100, { ...person, centre: { x: 0.5, y: 0.86 }, poseQuality: 0.49 }).candidate)
  expect(gate.inspect({ ...observing, nowMs: 100 }).reason).toBe('low_quality')
  gate.observe(200, presence.decide(200, { ...person, centre: { x: 0.5, y: 0.86 } }).candidate)
  expect(gate.inspect({ ...observing, nowMs: 200 }).allowed).toBe(true)
  expect(gate.inspect({ ...observing, nowMs: 1701 }).reason).toBe('stale')
  expect(gate.inspect({ enabled: true, observing: false, nowMs: 201 }).allowed).toBe(false)
})
