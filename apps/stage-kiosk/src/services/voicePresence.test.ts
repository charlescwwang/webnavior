import { describe, expect, it } from 'vitest'

import { createVoicePresenceGate } from './voicePresence'

const zone = { x: 0.2, y: 0.15, width: 0.6, height: 0.7 }
const person = { centre: { x: 0.5, y: 0.5 }, poseQuality: 0.8, bodyScale: 0.2, attention: 'unknown' as const }
const observing = { enabled: true, observing: true }

// Report: this chat, 2026-10-20; ambient ASR must not invite an absent customer.
describe('local presence admission for voice and proactive speech', () => {
  it('rejects empty observations before any person has been seen', () => {
    const gate = createVoicePresenceGate()
    gate.observe(100, undefined, zone)
    expect(gate.allows({ ...observing, nowMs: 100 })).toBe(false)
  })

  it('admits the first valid person without waiting for greeting dwell', () => {
    const gate = createVoicePresenceGate()
    gate.observe(100, person, zone)
    expect(gate.allows({ ...observing, nowMs: 100 })).toBe(true)
  })

  it('retains short missed detections but expires old evidence even if inference stops', () => {
    const gate = createVoicePresenceGate()
    gate.observe(100, person, zone)
    gate.observe(500, undefined, zone)
    expect(gate.allows({ ...observing, nowMs: 1599 })).toBe(true)
    expect(gate.allows({ ...observing, nowMs: 1601 })).toBe(false)
    gate.observe(1700, person, zone)
    expect(gate.allows({ ...observing, nowMs: 1700 })).toBe(true)
  })

  it('does not renew admission with low-quality or out-of-zone candidates', () => {
    const gate = createVoicePresenceGate()
    gate.observe(100, { ...person, poseQuality: 0.4 }, zone)
    expect(gate.allows({ ...observing, nowMs: 100 })).toBe(false)
    gate.observe(200, { ...person, centre: { x: 0.05, y: 0.05 } }, zone)
    expect(gate.allows({ ...observing, nowMs: 200 })).toBe(false)
  })

  it('blocks starting, failed and restarted cameras until fresh detection', () => {
    const gate = createVoicePresenceGate()
    expect(gate.allows({ enabled: true, observing: false, nowMs: 0 })).toBe(false)
    gate.observe(100, person, zone)
    expect(gate.allows({ enabled: true, observing: false, nowMs: 100 })).toBe(false)
    gate.reset()
    expect(gate.allows({ ...observing, nowMs: 101 })).toBe(false)
  })

  it('preserves voice service when observation has not been enabled', () => {
    const gate = createVoicePresenceGate()
    expect(gate.allows({ enabled: false, observing: false, nowMs: 100 })).toBe(true)
  })
})
