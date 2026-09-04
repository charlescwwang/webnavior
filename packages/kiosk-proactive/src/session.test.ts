import { describe, expect, it } from 'vitest'

import { createInteractionWindow, defaultProactiveInteractionSettings } from './session'

describe('createInteractionWindow', () => {
  it('greets once after continuous attention and suppresses the same anonymous window', () => {
    const window = createInteractionWindow({ ...defaultProactiveInteractionSettings, enabled: true })

    expect(window.decide({ observedAtMs: 0, attendingPeople: 2, presencePeople: 2 })).toMatchObject({ phase: 'observing', reason: 'observing', shouldGreet: false })
    expect(window.decide({ observedAtMs: 2499, attendingPeople: 2, presencePeople: 2 })).toMatchObject({ phase: 'observing', reason: 'observing', shouldGreet: false })
    expect(window.decide({ observedAtMs: 2500, attendingPeople: 2, presencePeople: 2 })).toMatchObject({ phase: 'greeted', reason: 'dwell-met', shouldGreet: true })
    expect(window.decide({ observedAtMs: 5000, attendingPeople: 3, presencePeople: 3 })).toMatchObject({ phase: 'greeted', reason: 'already-greeted', shouldGreet: false })
  })

  it('requires a real empty interval before allowing a new greeting', () => {
    const window = createInteractionWindow({ ...defaultProactiveInteractionSettings, enabled: true })

    window.decide({ observedAtMs: 0, attendingPeople: 1, presencePeople: 1 })
    window.decide({ observedAtMs: 2500, attendingPeople: 1, presencePeople: 1 })
    expect(window.decide({ observedAtMs: 3000, attendingPeople: 0, presencePeople: 0 })).toMatchObject({ phase: 'greeted', reason: 'no-attention' })
    expect(window.decide({ observedAtMs: 4499, attendingPeople: 0, presencePeople: 0 })).toMatchObject({ phase: 'greeted', reason: 'no-attention' })
    expect(window.decide({ observedAtMs: 4500, attendingPeople: 0, presencePeople: 0 })).toMatchObject({ phase: 'idle', reason: 'window-reset' })
    expect(window.decide({ observedAtMs: 4501, attendingPeople: 1, presencePeople: 1 })).toMatchObject({ phase: 'observing', reason: 'observing' })
  })

  it('clears an in-progress window while disabled', () => {
    const settings = { ...defaultProactiveInteractionSettings, enabled: true }
    const window = createInteractionWindow(settings)

    window.decide({ observedAtMs: 0, attendingPeople: 1, presencePeople: 1 })
    settings.enabled = false
    expect(window.decide({ observedAtMs: 1000, attendingPeople: 1, presencePeople: 1 })).toMatchObject({ phase: 'idle', reason: 'disabled' })
    settings.enabled = true
    expect(window.decide({ observedAtMs: 2500, attendingPeople: 1, presencePeople: 1 })).toMatchObject({ phase: 'observing', reason: 'observing', shouldGreet: false })
  })

  it('can trigger for a passerby without screen attention', () => {
    const window = createInteractionWindow({
      ...defaultProactiveInteractionSettings,
      enabled: true,
      triggerMode: 'presence',
    })

    expect(window.decide({ observedAtMs: 0, attendingPeople: 0, presencePeople: 1 })).toMatchObject({ phase: 'observing', triggeringPeople: 1 })
    expect(window.decide({ observedAtMs: 2500, attendingPeople: 0, presencePeople: 1 })).toMatchObject({ phase: 'greeted', shouldGreet: true })
  })

  it('uses the attention greeting in mixed mode when both signals match', () => {
    const window = createInteractionWindow({
      ...defaultProactiveInteractionSettings,
      enabled: true,
      triggerMode: 'mixed',
    })

    window.decide({ observedAtMs: 0, attendingPeople: 1, presencePeople: 1 })
    expect(window.decide({ observedAtMs: 2500, attendingPeople: 1, presencePeople: 1 })).toMatchObject({
      shouldGreet: true,
      greetingTrigger: 'attention',
    })
  })

  it('restarts dwell when mixed mode changes from presence to attention', () => {
    const window = createInteractionWindow({
      ...defaultProactiveInteractionSettings,
      enabled: true,
      triggerMode: 'mixed',
    })

    window.decide({ observedAtMs: 0, attendingPeople: 0, presencePeople: 1 })
    expect(window.decide({ observedAtMs: 2400, attendingPeople: 1, presencePeople: 1 })).toMatchObject({
      shouldGreet: false,
      reason: 'observing',
    })
    expect(window.decide({ observedAtMs: 4900, attendingPeople: 1, presencePeople: 1 })).toMatchObject({
      shouldGreet: true,
      greetingTrigger: 'attention',
    })
  })
})
