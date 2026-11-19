import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { createPinia, disposePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { userEvent } from 'vitest/browser'
import { effectScope } from 'vue'
import { createI18n } from 'vue-i18n'

import ArrayInputSettings from './ArrayInputSettings.vue'
import KioskMicrophoneSettings from './KioskMicrophoneSettings.vue'
import NativeMicrophoneSettings from './NativeMicrophoneSettings.vue'

import { useKioskMicrophone } from '../composables/useKioskMicrophone'

it('shows the runtime and Intel device reported by the native audio bridge', async () => {
  const request = vi.fn().mockResolvedValue({ runtime: 'OpenVINO', requested_provider: 'GPU.0', device_name: 'Intel Iris Xe', gpu_verified: true, samples: new Float32Array() })
  vi.stubGlobal('airiKioskAudio', { version: 3, request })
  const pinia = createPinia()
  const screen = render(NativeMicrophoneSettings, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] } })
  try {
    await expect.element(screen.getByRole('status')).toHaveTextContent('OpenVINO GPU.0')
    await expect.element(screen.getByText('Intel Iris Xe', { exact: true })).toBeVisible()
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

// Report: this chat, 2026-11-18 — the Desktop GPU replacement hid the existing
// microphone methods, leaving no selectable backup when GPU capture failed.
it('keeps existing desktop processing available and can return from a failed GPU selection', async () => {
  const keys = ['kiosk/audio/array-backend', 'kiosk/audio/microphone-processing', 'kiosk/audio/legacy-array-algorithm', 'kiosk/audio/spatial-mask', 'settings/audio/input/enabled', 'settings/audio/input']
  keys.forEach(key => localStorage.removeItem(key))
  const request = vi.fn().mockRejectedValue(new Error('GPU test unavailable'))
  vi.stubGlobal('airiKioskDesktop', {})
  vi.stubGlobal('airiKioskAudio', { version: 3, request })
  const pinia = createPinia()
  const options = { props: { recognitionMode: 'legacy' as const }, global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] } }
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
    await screen.getByRole('option', { name: 'stage.kiosk.array-audio.native-gpu', exact: true }).click()
    expect(request).not.toHaveBeenCalled()
    await screen.getByRole('button', { name: 'stage.kiosk.array-audio.applyBackend', exact: true }).click()
    await expect.element(screen.getByRole('alert')).toHaveTextContent('GPU test unavailable')
    await expect.element(screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.algorithm', exact: true })).not.toBeInTheDocument()
    expect(microphone.nativeSelected.value).toBe(true)
    expect(microphone.configuration()).toEqual(existing)
    screen.unmount()
    screen = render(KioskMicrophoneSettings, options)
    await expect.element(screen.getByRole('alert')).toHaveTextContent('GPU test unavailable')

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
  const key = 'kiosk/audio/native-rtf'
  localStorage.removeItem(key)
  const request = vi.fn().mockResolvedValue({ devices: [{ id: 'wasapi-input', name: 'UMA-8 RAW', host: 'Windows WASAPI', inputChannels: 8, outputChannels: 0 }], state: 'automatic', samples: new Float32Array() })
  vi.stubGlobal('airiKioskAudio', { version: 3, request })
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
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ channelMap: '0,1,2,3,4,5,6', gainDb: 30, inputDevice: 'wasapi-input' })
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

// Report: this chat, 2026-11-18 — bypass UL-UNAS without claiming GPU execution.
it('shows explicit model bypass instead of waiting for GPU verification', async () => {
  vi.stubGlobal('airiKioskAudio', { version: 3, request: vi.fn().mockResolvedValue({ runtime: 'Bypass', requested_provider: 'disabled', gpu_verified: false, samples: new Float32Array() }) })
  const pinia = createPinia()
  const screen = render(NativeMicrophoneSettings, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] } })
  try {
    await expect.element(screen.getByRole('status')).toHaveTextContent('stage.kiosk.native-audio.model-bypassed')
    await expect.element(screen.getByRole('status')).not.toHaveTextContent('stage.kiosk.native-audio.gpu-pending')
    await expect.element(screen.getByRole('status')).not.toHaveTextContent('stage.kiosk.native-audio.gpu-ready')
  }
  finally {
    screen.unmount()
    const context = useAudioContext(pinia).audioContext
    disposePinia(pinia)
    await context.close()
    vi.unstubAllGlobals()
  }
})

// Report: this chat, 2026-11-19 — LCMV must select the real native input independently of GPU preferences.
it('lists only native eight-channel inputs for LCMV and preserves GPU and LCMV tuning', async () => {
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
