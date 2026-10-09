import { describe, expect, it } from 'vitest'

import { createPresenceWindow, defaultPresenceSettings } from './presence'
import { defaultProactiveInteractionSettings } from './session'

function candidate(overrides = {}) {
  return {
    attention: 'unknown' as const,
    bodyScale: 0.05,
    centre: { x: 0.5, y: 0.5 },
    poseQuality: 0.9,
    ...overrides,
  }
}

describe('createPresenceWindow', () => {
  const greeting = { ...defaultProactiveInteractionSettings, enabled: true, triggerMode: 'presence' as const }

  it('honors the configured dwell for pose candidates, including near visitors', () => {
    const window = createPresenceWindow(defaultPresenceSettings, { ...greeting, dwellMs: 2500 })
    window.decide(0, candidate({ bodyScale: 0.2 }))
    expect(window.decide(200, candidate({ bodyScale: 0.2 })).greetingEligible).toBe(false)
    expect(window.decide(1300, candidate({ bodyScale: 0.2 })).greetingEligible).toBe(false)
    expect(window.decide(2500, candidate({ bodyScale: 0.2 })).greetingEligible).toBe(true)
  })

  it('does not infer two people from the single anonymous pose candidate', () => {
    const window = createPresenceWindow(defaultPresenceSettings, { ...greeting, dwellMs: 500, minAttendingPeople: 2 })
    window.decide(0, candidate())
    expect(window.decide(500, candidate()).greetingEligible).toBe(false)
  })
  it('withdraws an unclaimed attention greeting when attention is lost', () => {
    const window = createPresenceWindow(defaultPresenceSettings, { ...greeting, triggerMode: 'attention', dwellMs: 200 })
    window.decide(0, candidate({ attention: true }))
    expect(window.decide(200, candidate({ attention: true })).greetingEligible).toBe(true)
    expect(window.decide(300, candidate({ attention: false })).greetingEligible).toBe(false)
  })
  it('uses configured empty reset separately from geometry loss grace', () => {
    const window = createPresenceWindow(defaultPresenceSettings, { ...greeting, dwellMs: 200, emptyResetMs: 4000 })
    window.decide(0, candidate())
    expect(window.decide(200, candidate()).greetingEligible).toBe(true)
    window.claimGreeting()
    window.decide(400)
    window.decide(2000)
    expect(window.decide(2100, candidate()).greetingEligible).toBe(false)
    window.decide(2200)
    window.decide(6300)
    window.decide(6400, candidate())
    // Existing presence cooldown is a separate anti-repeat gate.
    expect(window.decide(6700, candidate()).greetingEligible).toBe(false)
    expect(window.decide(31000, candidate()).greetingEligible).toBe(true)
  })

  it('classifies a fast short traversal as PASSING without suppressing idle', () => {
    const window = createPresenceWindow(defaultPresenceSettings, greeting)
    window.decide(0, candidate({ centre: { x: 0.2, y: 0.5 } }))
    const decision = window.decide(500, candidate({ centre: { x: 0.6, y: 0.5 } }))

    expect(decision.state).toBe('PASSING')
    expect(decision.idleSuppressed).toBe(false)
  })

  it('requires enough quality before a near sample can enter ENGAGED', () => {
    const window = createPresenceWindow(defaultPresenceSettings, greeting)
    const near = candidate({ bodyScale: 0.2, poseQuality: 0.2 })

    window.decide(0, near)
    expect(window.decide(1_500, near).state).not.toBe('ENGAGED')
  })

  it('keeps ENGAGED through a short detection loss then clears it after grace', () => {
    const window = createPresenceWindow(defaultPresenceSettings, greeting)
    const near = candidate({ bodyScale: 0.2 })

    window.decide(0, near)
    expect(window.decide(1_300, near).state).toBe('ENGAGED')
    expect(window.decide(2_000).state).toBe('ENGAGED')
    expect(window.decide(3_000).state).toBe('EMPTY')
  })

  it('distinguishes unknown attention from a known false result', () => {
    const attentionGreeting = { ...greeting, triggerMode: 'attention' as const }
    const unknown = createPresenceWindow(defaultPresenceSettings, attentionGreeting)
    const falseAttention = createPresenceWindow(defaultPresenceSettings, attentionGreeting)

    expect(unknown.decide(500, candidate()).greetingEligible).toBe(false)
    expect(falseAttention.decide(500, candidate({ attention: false })).greetingEligible).toBe(false)
  })

  it('requires two samples and starts cooldown only after the greeting is claimed', () => {
    const window = createPresenceWindow(defaultPresenceSettings, { ...greeting, dwellMs: 200 })

    expect(window.decide(0, candidate()).greetingEligible).toBe(false)
    expect(window.decide(200, candidate()).greetingEligible).toBe(true)
    expect(window.decide(400, candidate()).greetingEligible).toBe(true)

    window.claimGreeting()
    expect(window.decide(600, candidate()).greetingEligible).toBe(false)
  })
})
