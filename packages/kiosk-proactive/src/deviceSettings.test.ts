import { describe, expect, it } from 'vitest'

import { defaultDeviceSettings, defaultDeviceSettingsValues, observationSettings, resolveDeviceSettings } from './deviceSettings'
import { needsKioskObservation } from './interaction-settings'

describe('server device policy projection', () => {
  it('defaults to paid Kiosk with background classification off', () => {
    expect(defaultDeviceSettingsValues.serviceMode).toBe('kiosk')
    expect(defaultDeviceSettingsValues.backgroundSpeechMode).toBe('off')
  })
  it('projects the shared device override policy onto camera decisions', () => {
    const effective = resolveDeviceSettings(defaultDeviceSettingsValues, {
      ...defaultDeviceSettings,
      overrides: { observationEnabled: true, greetingEnabled: true },
    })
    expect(effective.observationEnabled).toBe(true)
    expect(effective.proactiveVlmEnabled).toBe(false)
    expect(effective.presenceVisionMode).toBe('pose_plus_conditional_face')
    expect(needsKioskObservation(observationSettings(effective), false)).toBe(true)
    expect(needsKioskObservation(observationSettings({ ...effective, observationEnabled: false }), true)).toBe(false)
  })
})
