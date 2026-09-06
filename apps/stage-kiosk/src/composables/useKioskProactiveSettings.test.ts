import { describe, expect, it } from 'vitest'

import { defaultKioskProactiveSettings, needsKioskObservation } from './useKioskProactiveSettings'

describe('needsKioskObservation', () => {
  it('does not use the camera while observation is disabled', () => {
    const settings = structuredClone(defaultKioskProactiveSettings)
    settings.proactiveGreeting.enabled = true
    settings.assistanceReminder.enabled = true

    expect(needsKioskObservation(settings, true)).toBe(false)
  })

  it('uses the camera for proactive greetings before a customer session exists', () => {
    const settings = structuredClone(defaultKioskProactiveSettings)
    settings.observation.enabled = true
    settings.proactiveGreeting.enabled = true

    expect(needsKioskObservation(settings, false)).toBe(true)
  })

  it('uses the camera for reminders only during an active customer session', () => {
    const settings = structuredClone(defaultKioskProactiveSettings)
    settings.observation.enabled = true
    settings.assistanceReminder.enabled = true

    expect(needsKioskObservation(settings, false)).toBe(false)
    expect(needsKioskObservation(settings, true)).toBe(true)
  })
})
