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
})
