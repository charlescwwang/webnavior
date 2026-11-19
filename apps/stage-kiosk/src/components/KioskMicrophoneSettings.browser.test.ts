import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { createPinia, disposePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { effectScope } from 'vue'
import { createI18n } from 'vue-i18n'

import ArrayInputSettings from './ArrayInputSettings.vue'
import KioskMicrophoneSettings from './KioskMicrophoneSettings.vue'
import NativeMicrophoneSettings from './NativeMicrophoneSettings.vue'

import { useKioskMicrophone } from '../composables/useKioskMicrophone'

it('shows the runtime and CPU runtime reported by the native audio bridge', async () => {
  const request = vi.fn().mockResolvedValue({ runtime: 'Hush / Tract', requested_provider: 'CPU', device_name: 'CPU', samples: new Float32Array() })
  vi.stubGlobal('airiKioskAudio', { version: 9, request })
  const pinia = createPinia()
  const screen = render(NativeMicrophoneSettings, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] } })
  try {
    await expect.element(screen.getByRole('status')).toHaveTextContent('Hush / Tract CPU')
    await expect.element(screen.getByText('CPU', { exact: true })).toBeVisible()
    expect(request).toHaveBeenCalledWith({ kind: 'devices' })
    expect(request).toHaveBeenCalledWith({ kind: 'status' })
  }
  finally {
    screen.unmount()
    const context = useAudioContext(pinia).audioContext
    disposePinia(pinia)
    await context.close()
    vi.unstubAllGlobals()
  }
})

it('shows three 70 degree elevations and persists numeric changes separately from recognition mode', async () => {
  const key = 'kiosk/audio/microphone-processing'
  localStorage.removeItem(key)
  const screen = render(KioskMicrophoneSettings, { global: { plugins: [createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] } })
  try {
    for (const field of ['frontElevationDeg', 'suppress1ElevationDeg', 'suppress2ElevationDeg'])
      await expect.element(screen.getByRole('spinbutton', { name: `stage.kiosk.array-audio.${field}`, exact: true })).toHaveValue(70)
    await screen.getByRole('spinbutton', { name: 'stage.kiosk.array-audio.frontElevationDeg', exact: true }).fill('72')
    await expect.poll(() => JSON.parse(localStorage.getItem(key)!).frontElevationDeg).toBe(72)
    await screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.mode', exact: true }).click()
    await screen.getByRole('option', { name: 'stage.kiosk.array-audio.standard', exact: true }).click()
    await expect.poll(() => JSON.parse(localStorage.getItem(key)!).inputMode).toBe('standard')
    await expect.element(screen.getByRole('spinbutton', { name: 'stage.kiosk.array-audio.frontElevationDeg', exact: true })).not.toBeInTheDocument()
  }
  finally {
    screen.unmount()
    localStorage.removeItem(key)
  }
})

it('applies Spatial Mask and AEC3 deliberately, persists gain, keeps LCMV tuning', async () => {
  const keys = ['kiosk/audio/legacy-array-algorithm', 'kiosk/audio/spatial-mask', 'kiosk/audio/microphone-processing']
  keys.forEach(key => localStorage.removeItem(key))
  const options = { global: { plugins: [createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] } }
  let screen = render(KioskMicrophoneSettings, options)
  const scope = effectScope()
  const microphone = scope.run(() => useKioskMicrophone())!
  try {
    await screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.algorithm', exact: true }).click()
    await screen.getByRole('option', { name: 'stage.kiosk.array-audio.spatial-mask', exact: true }).click()
    expect(microphone.configuration().processing.algorithm).toBe('lcmv')
    await expect.element(screen.getByRole('switch')).toBeChecked()
    await screen.getByRole('switch').click()
    await screen.getByRole('spinbutton', { name: 'stage.kiosk.array-audio.maskGainDb', exact: true }).fill('80')
    await screen.getByRole('button', { name: 'stage.kiosk.array-audio.apply', exact: true }).click()
    await expect.poll(() => microphone.configuration().processing).toEqual({ algorithm: 'spatial-mask', aec3Enabled: false })
    expect(microphone.configuration().gainDb).toBe(80)
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

// Report: this chat, 2026-11-18 — the Desktop GPU replacement hid the existing
// microphone methods, leaving no selectable backup when GPU capture failed.
it('keeps existing desktop processing available and can return from a failed Hush selection', async () => {
  const keys = ['kiosk/audio/array-backend', 'kiosk/audio/microphone-processing', 'kiosk/audio/legacy-array-algorithm', 'kiosk/audio/spatial-mask', 'settings/audio/input/enabled', 'settings/audio/input']
  keys.forEach(key => localStorage.removeItem(key))
  const request = vi.fn().mockRejectedValue(new Error('Hush test unavailable'))
  vi.stubGlobal('airiKioskDesktop', {})
  vi.stubGlobal('airiKioskAudio', { version: 9, request })
  const pinia = createPinia()
  const options = { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] } }
  const scope = effectScope()
  const microphone = scope.run(() => useKioskMicrophone())!
  let screen = render(KioskMicrophoneSettings, options)
  try {
    await expect.element(screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.backend', exact: true })).toBeVisible()
    await expect.element(screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.algorithm', exact: true })).toBeVisible()
    expect(request).not.toHaveBeenCalled()
    await screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.algorithm', exact: true }).click()
    await screen.getByRole('option', { name: 'stage.kiosk.array-audio.spatial-mask', exact: true }).click()
    await screen.getByRole('spinbutton', { name: 'stage.kiosk.array-audio.maskGainDb', exact: true }).fill('23')
    await screen.getByRole('button', { name: 'stage.kiosk.array-audio.apply', exact: true }).click()
    const existing = microphone.configuration()

    await screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.backend', exact: true }).click()
    await screen.getByRole('option', { name: 'stage.kiosk.array-audio.native-hush', exact: true }).click()
    expect(request).not.toHaveBeenCalled()
    await screen.getByRole('button', { name: 'stage.kiosk.array-audio.applyBackend', exact: true }).click()
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Hush test unavailable')
    await expect.element(screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.algorithm', exact: true })).not.toBeInTheDocument()
    expect(microphone.nativeSelected.value).toBe(true)
    expect(microphone.configuration()).toEqual(existing)
    screen.unmount()
    screen = render(KioskMicrophoneSettings, options)
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Hush test unavailable')

    await screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.backend', exact: true }).click()
    await screen.getByRole('option', { name: 'stage.kiosk.array-audio.existing', exact: true }).click()
    await screen.getByRole('button', { name: 'stage.kiosk.array-audio.applyBackend', exact: true }).click()
    await expect.element(screen.getByRole('spinbutton', { name: 'stage.kiosk.array-audio.maskGainDb', exact: true })).toHaveValue(23)
    await expect.poll(() => localStorage.getItem('kiosk/audio/array-backend')).toBe('existing')
    expect(microphone.nativeSelected.value).toBe(false)
    const calls = request.mock.calls.length
    screen.unmount()
    screen = render(KioskMicrophoneSettings, options)
    await expect.element(screen.getByRole('spinbutton', { name: 'stage.kiosk.array-audio.maskGainDb', exact: true })).toHaveValue(23)
    expect(request).toHaveBeenCalledTimes(calls)
  }
  finally {
    screen.unmount()
    scope.stop()
    const context = useAudioContext(pinia).audioContext
    disposePinia(pinia)
    await context.close()
    vi.unstubAllGlobals()
    keys.forEach(key => localStorage.removeItem(key))
  }
})

it('requires an EXE with native hardware capture before calling the older audio bridge', async () => {
  const request = vi.fn()
  vi.stubGlobal('airiKioskAudio', { request })
  const pinia = createPinia()
  const screen = render(NativeMicrophoneSettings, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] } })
  try {
    await expect.element(screen.getByRole('alert')).toHaveTextContent('stage.kiosk.native-audio.update-exe')
    expect(request).not.toHaveBeenCalled()
  }
  finally {
    screen.unmount()
    const context = useAudioContext(pinia).audioContext
    disposePinia(pinia)
    await context.close()
    vi.unstubAllGlobals()
  }
})

// Report: this chat, 2026-11-18 — no manual recording or microphone/speaker host coupling.
it('applies microphone settings without a speaker or a five-second calibration step', async () => {
  const key = 'kiosk/audio/native-hush'
  localStorage.removeItem(key)
  const request = vi.fn().mockResolvedValue({ devices: [{ id: 'wasapi-input', name: 'UMA-8 RAW', host: 'Windows WASAPI', inputChannels: 8, outputChannels: 0 }], state: 'automatic', samples: new Float32Array() })
  vi.stubGlobal('airiKioskAudio', { version: 9, request })
  const pinia = createPinia()
  const screen = render(NativeMicrophoneSettings, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] } })
  try {
    await expect.element(screen.getByRole('status')).toHaveTextContent('stage.kiosk.native-audio.automatic-tracking')
    await screen.getByRole('combobox', { name: 'stage.kiosk.native-audio.input', exact: true }).click()
    await screen.getByRole('option', { name: 'UMA-8 RAW · Windows WASAPI · 8ch', exact: true }).click()
    await screen.getByRole('button', { name: 'stage.kiosk.native-audio.apply', exact: true }).click()
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'stage.kiosk.native-audio.calibrate', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('combobox', { name: 'stage.kiosk.native-audio.output', exact: true })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ channelMap: '0,1,2,3,4,5,6', gainDb: 30, inputDevice: 'wasapi-input', hush: { attenuationDb: 100, dryMixPercent: 0 } })
    expect(request.mock.calls.every(([input]) => ['status', 'devices'].includes(input.kind))).toBe(true)
  }
  finally {
    screen.unmount()
    const context = useAudioContext(pinia).audioContext
    disposePinia(pinia)
    await context.close()
    vi.unstubAllGlobals()
    localStorage.removeItem(key)
  }
})

// Report: this chat, 2026-11-19 — LCMV must select the real native input independently of Hush preferences.
it('lists only native eight-channel inputs for LCMV and preserves Hush and LCMV tuning', async () => {
  const key = 'kiosk/audio/native-lcmv-input'
  localStorage.removeItem(key)
  const id = JSON.stringify(['Windows WASAPI', 'UMA-8 RAW'])
  const request = vi.fn().mockResolvedValue({ devices: [
    { id, name: 'UMA-8 RAW', host: 'Windows WASAPI', inputChannels: 8, outputChannels: 0 },
    { id: 'speaker', name: 'Speakers', host: 'Windows WASAPI', inputChannels: 0, outputChannels: 2 },
  ], samples: new Float32Array() })
  vi.stubGlobal('airiKioskArrayInput', { version: 1, request })
  const microphone = useKioskMicrophone()
  const before = JSON.stringify([microphone.settings.value, microphone.nativeSettings.value])
  const screen = render(ArrayInputSettings, { global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: {} })] } })
  try {
    await expect.poll(() => request.mock.calls.length).toBe(1)
    expect(request).toHaveBeenCalledWith({ kind: 'devices' })
    await screen.getByRole('combobox').click()
    await expect.element(screen.getByRole('option', { name: 'Speakers', exact: false })).not.toBeInTheDocument()
    await screen.getByRole('option', { name: 'UMA-8 RAW · Windows WASAPI · 8ch', exact: true }).click()
    expect(microphone.arrayInputDevice.value).toBe(id)
    expect(JSON.stringify([microphone.settings.value, microphone.nativeSettings.value])).toBe(before)
  }
  finally {
    screen.unmount()
    vi.unstubAllGlobals()
    localStorage.removeItem(key)
  }
})

// Report: this chat, 2026-11-20 — retire the GPU option without silently selecting Hush.
it('requires explicit selection for retired GPU preferences and preserves Hush tuning', async () => {
  const backend = 'kiosk/audio/array-backend'
  const hush = 'kiosk/audio/native-hush'
  localStorage.setItem(backend, 'native-gpu')
  localStorage.setItem(hush, JSON.stringify({ channelMap: '0,1,2,3,4,5,6', gainDb: 23, inputDevice: '' }))
  vi.stubGlobal('airiKioskDesktop', {})
  const request = vi.fn()
  vi.stubGlobal('airiKioskAudio', { version: 9, request })
  const scope = effectScope()
  const microphone = scope.run(() => useKioskMicrophone())!
  const originalMode = microphone.settings.value.inputMode
  const screen = render(KioskMicrophoneSettings, { global: { plugins: [createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] } })
  try {
    expect(microphone.backendAvailable.value).toBe(false)
    expect(microphone.nativeSelected.value).toBe(false)
    expect(microphone.usesNativeLcmv(true)).toBe(false)
    await expect.element(screen.getByRole('alert')).toHaveTextContent('stage.kiosk.array-audio.backendRetired')
    expect(request).not.toHaveBeenCalled()
    // Selecting a standard microphone is an explicit independent hardware choice.
    microphone.settings.value.inputMode = 'standard'
    expect(microphone.backendAvailable.value).toBe(true)
    microphone.settings.value.inputMode = 'uma8'
    expect(microphone.backendAvailable.value).toBe(false)
    await screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.backend', exact: true }).click()
    await expect.element(screen.getByRole('option', { name: 'stage.kiosk.array-audio.native-gpu', exact: true })).not.toBeInTheDocument()
    await screen.getByRole('option', { name: 'stage.kiosk.array-audio.existing', exact: true }).click()
    await screen.getByRole('button', { name: 'stage.kiosk.array-audio.applyBackend', exact: true }).click()
    await expect.poll(() => microphone.backendAvailable.value).toBe(true)
    expect(microphone.nativeSettings.value.gainDb).toBe(23)
    expect(request).not.toHaveBeenCalled()
  }
  finally {
    screen.unmount()
    scope.stop()
    microphone.settings.value.inputMode = originalMode
    localStorage.removeItem(backend)
    localStorage.removeItem(hush)
    vi.unstubAllGlobals()
  }
})

// Report: this chat, 2026-11-20 — expose both documented Hush/MVDR test presets.
it('applies and restores both Hush recommendations without replacing microphone or LCMV tuning', async () => {
  const key = 'kiosk/audio/native-hush'
  localStorage.setItem(key, JSON.stringify({ channelMap: '0,1,2,3,4,5,6', gainDb: 23, inputDevice: 'test-input', aecEnabled: true, hush: { attenuationDb: 100, dryMixPercent: 0 } }))
  const request = vi.fn().mockResolvedValue({ runtime: 'Hush / Tract', requested_provider: 'CPU' })
  vi.stubGlobal('airiKioskAudio', { version: 9, request })
  const scope = effectScope()
  const microphone = scope.run(() => useKioskMicrophone())!
  const lcmv = { ...microphone.settings.value }
  const options = { global: { plugins: [createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] } }
  let screen = render(NativeMicrophoneSettings, options)
  try {
    for (const [name, percent] of [['preset-a', 30], ['preset-b', 10]] as const) {
      await expect.element(screen.getByRole('switch')).not.toBeInTheDocument()
      const previous = { ...microphone.nativeSettings.value.hush }
      await screen.getByRole('combobox', { name: 'stage.kiosk.native-audio.hush-preset', exact: true }).click()
      await screen.getByRole('option', { name: `stage.kiosk.native-audio.${name}`, exact: true }).click()
      expect(microphone.nativeSettings.value.hush).toEqual(previous)
      await screen.getByRole('button', { name: 'stage.kiosk.native-audio.apply', exact: true }).click()
      await expect.poll(() => microphone.nativeConfiguration().hush).toEqual({ attenuationDb: 20, dryMixPercent: percent })
      expect(microphone.nativeConfiguration()).not.toHaveProperty('aecEnabled')
      expect(JSON.parse(localStorage.getItem(key)!)).not.toHaveProperty('aecEnabled')
      expect(microphone.nativeConfiguration().gainDb).toBe(23)
      expect(microphone.nativeConfiguration().inputDevice).toBe('test-input')
      expect(microphone.settings.value).toEqual(lcmv)
      screen.unmount()
      screen = render(NativeMicrophoneSettings, options)
      await expect.element(screen.getByRole('combobox', { name: 'stage.kiosk.native-audio.hush-preset', exact: true })).toHaveTextContent(`stage.kiosk.native-audio.${name}`)
    }
    expect(request.mock.calls.every(([input]) => ['devices', 'status'].includes(input.kind))).toBe(true)
  }
  finally {
    screen.unmount()
    scope.stop()
    localStorage.removeItem(key)
    vi.unstubAllGlobals()
  }
})
