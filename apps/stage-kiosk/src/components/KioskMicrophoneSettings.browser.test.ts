import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { userEvent } from 'vitest/browser'
import { effectScope } from 'vue'
import { createI18n } from 'vue-i18n'

import KioskMicrophoneSettings from './KioskMicrophoneSettings.vue'

import { useKioskMicrophone } from '../composables/useKioskMicrophone'

it('shows three 70 degree elevations and persists numeric changes separately from recognition mode', async () => {
  const key = 'kiosk/audio/microphone-processing'
  localStorage.removeItem(key)
  const screen = render(KioskMicrophoneSettings, { global: { plugins: [createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] } })
  try {
    for (const field of ['frontElevationDeg', 'suppress1ElevationDeg', 'suppress2ElevationDeg'])
      await expect.element(screen.getByRole('spinbutton', { name: `stage.kiosk.array-audio.${field}`, exact: true })).toHaveValue(70)
    await screen.getByRole('spinbutton', { name: 'stage.kiosk.array-audio.frontElevationDeg', exact: true }).fill('72')
    await expect.poll(() => JSON.parse(localStorage.getItem(key)!).frontElevationDeg).toBe(72)
    await screen.getByRole('combobox').click()
    await screen.getByRole('option', { name: 'stage.kiosk.array-audio.standard', exact: true }).click()
    await expect.poll(() => JSON.parse(localStorage.getItem(key)!).inputMode).toBe('standard')
    await expect.element(screen.getByRole('spinbutton', { name: 'stage.kiosk.array-audio.frontElevationDeg', exact: true })).not.toBeInTheDocument()
  }
  finally {
    screen.unmount()
    localStorage.removeItem(key)
  }
})

// Report: this chat, 2026-11-17 — add an independently adjustable gain before Falcon.
it('persists Falcon gain independently from VAD gain and restores it after reopening settings', async () => {
  const key = 'kiosk/audio/falcon-input-gain-db'
  const microphoneKey = 'kiosk/audio/microphone-processing'
  localStorage.removeItem(key)
  localStorage.removeItem(microphoneKey)
  const options = { global: { plugins: [createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] } }
  let screen = render(KioskMicrophoneSettings, options)
  const scope = effectScope()
  const captureSettings = scope.run(() => useKioskMicrophone())!
  try {
    const gain = screen.getByRole('slider')
    await expect.element(gain).toHaveValue('0')
    await gain.click()
    await userEvent.keyboard('{Home}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}')
    await expect.poll(() => JSON.parse(localStorage.getItem(key)!)).toBe(6)
    await expect.poll(() => captureSettings.configuration().falconGainDb).toBe(6)
    expect(captureSettings.configuration().gainDb).toBe(15)
    await expect.element(screen.getByRole('spinbutton', { name: 'stage.kiosk.array-audio.gainDb', exact: true })).toHaveValue(15)
    screen.unmount()
    screen = render(KioskMicrophoneSettings, options)
    await expect.element(screen.getByRole('slider')).toHaveValue('60000')
    await screen.getByRole('slider').click()
    await userEvent.keyboard('{End}{ArrowRight}')
    await expect.poll(() => captureSettings.configuration().falconGainDb).toBe(30)
  }
  finally {
    screen.unmount()
    scope.stop()
    localStorage.removeItem(key)
    localStorage.removeItem(microphoneKey)
  }
})

it('applies Spatial Mask and AEC3 deliberately, persists gain, and keeps Falcon on LCMV', async () => {
  const keys = ['kiosk/audio/legacy-array-algorithm', 'kiosk/audio/spatial-mask', 'kiosk/audio/microphone-processing']
  keys.forEach(key => localStorage.removeItem(key))
  const options = { props: { recognitionMode: 'legacy' as const }, global: { plugins: [createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] } }
  let screen = render(KioskMicrophoneSettings, options)
  const scope = effectScope()
  const microphone = scope.run(() => useKioskMicrophone())!
  try {
    const original = microphone.configuration('falcon')
    await screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.algorithm', exact: true }).click()
    await screen.getByRole('option', { name: 'stage.kiosk.array-audio.spatial-mask', exact: true }).click()
    expect(microphone.configuration().processing.algorithm).toBe('lcmv')
    await expect.element(screen.getByRole('switch')).toBeChecked()
    await screen.getByRole('switch').click()
    await screen.getByRole('spinbutton', { name: 'stage.kiosk.array-audio.maskGainDb', exact: true }).fill('80')
    await screen.getByRole('button', { name: 'stage.kiosk.array-audio.apply', exact: true }).click()
    await expect.poll(() => microphone.configuration().processing).toEqual({ algorithm: 'spatial-mask', aec3Enabled: false })
    expect(microphone.configuration().gainDb).toBe(80)
    expect(microphone.configuration('falcon')).toEqual(original)
    expect(microphone.settings.value.gainDb).toBe(15)
    screen.unmount()
    screen = render(KioskMicrophoneSettings, options)
    await expect.element(screen.getByRole('switch')).not.toBeChecked()
    await expect.element(screen.getByRole('spinbutton', { name: 'stage.kiosk.array-audio.maskGainDb', exact: true })).toHaveValue(80)
    await screen.getByRole('spinbutton', { name: 'stage.kiosk.array-audio.maskGainDb', exact: true }).fill('81')
    await screen.getByRole('button', { name: 'stage.kiosk.array-audio.apply', exact: true }).click()
    await expect.element(screen.getByRole('alert')).toBeVisible()
    expect(microphone.configuration().gainDb).toBe(80)
    await screen.getByRole('spinbutton', { name: 'stage.kiosk.array-audio.maskGainDb', exact: true }).fill('80')
    await screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.algorithm', exact: true }).click()
    await screen.getByRole('option', { name: 'stage.kiosk.array-audio.lcmv', exact: true }).click()
    await screen.getByRole('button', { name: 'stage.kiosk.array-audio.apply', exact: true }).click()
    await expect.poll(() => microphone.configuration().processing.algorithm).toBe('lcmv')
    expect(microphone.configuration().gainDb).toBe(15)
  }
  finally {
    screen.unmount()
    scope.stop()
    keys.forEach(key => localStorage.removeItem(key))
  }
})

it('does not expose legacy Spatial Mask controls in Falcon mode', async () => {
  const screen = render(KioskMicrophoneSettings, { props: { recognitionMode: 'falcon' }, global: { plugins: [createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] } })
  try {
    await expect.element(screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.algorithm', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('spinbutton', { name: 'stage.kiosk.array-audio.frontElevationDeg', exact: true })).toBeVisible()
  }
  finally {
    screen.unmount()
  }
})
