import { describe, expect, it } from 'vitest'

import { defaultKioskInteractionSettings, needsKioskObservation } from './interaction-settings'

describe('defaultKioskInteractionSettings', () => {
  it('keeps every visual capability off until a deployment explicitly enables it', () => {
    expect(defaultKioskInteractionSettings.observation.enabled).toBe(false)
    expect(defaultKioskInteractionSettings.visualAssistance.enabled).toBe(false)
    expect(defaultKioskInteractionSettings.mediaRetention.mode).toBe('disabled')
    expect(defaultKioskInteractionSettings.visualAssistance.providerPolicy).toBe('local-only')
  })
})

describe('needsKioskObservation', () => {
  it('never opens the camera only because visual assistance is configured', () => {
    const settings = structuredClone(defaultKioskInteractionSettings)
    settings.visualAssistance.enabled = true

    expect(needsKioskObservation(settings, false)).toBe(false)
    expect(needsKioskObservation(settings, true)).toBe(false)
  })
})
