import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { createPinia, disposePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import KioskMediaDeviceSettings from './KioskMediaDeviceSettings.vue'

import { prepareKioskMicrophonePermission } from '../services/kiosk-startup-permission-gate'
import { applyAudioOutput, audioOutputStorageKey } from '../services/kioskAudioOutput'

function setup(textOnlyMode = false) {
  const pinia = createPinia()
  const screen = render(KioskMediaDeviceSettings, {
    props: { textOnlyMode },
    global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] },
  })
  const devices = useSettingsAudioDevice(pinia)
  const context = useAudioContext(pinia).audioContext
  return { screen, devices, context, async dispose() {
    screen.unmount()
    devices.stopStream()
    disposePinia(pinia)
    await context.close()
    localStorage.removeItem('settings/audio/input/enabled')
    localStorage.removeItem('settings/audio/input')
    localStorage.removeItem(audioOutputStorageKey)
  } }
}

// Report: this chat, 2026-11-17 — DEV-642583 has enabled/VAD=true but no audio track.
// Run with VITEST_FAKE_MEDIA=1: Chromium supplies real synthetic input devices;
// no MediaStream, permissions API, Pinia store or browser audio method is mocked.
it.runIf(import.meta.env.VITEST_FAKE_MEDIA === '1')('starts a real input stream when a true microphone preference survived restart', async () => {
  localStorage.setItem('settings/audio/input/enabled', 'true')
  const state = setup()
  try {
    expect(state.devices.enabled).toBe(true)
    expect(state.devices.stream).toBeUndefined()
    await prepareKioskMicrophonePermission({
      audioInputEnabled: state.devices.enabled,
      requestPermission: state.devices.askPermission,
      startAudioInput: state.devices.startStream,
      setAudioInputEnabled: enabled => state.devices.enabled = enabled,
      voiceConversationOnly: true,
    })
    await expect.poll(() => state.devices.stream?.getAudioTracks()[0]?.readyState).toBe('live')
    expect(state.devices.audioInputs.length).toBeGreaterThan(0)
    const stream = state.devices.stream
    await state.screen.getByRole('button', { name: 'stage.kiosk.media-devices.refresh', exact: true }).click()
    await expect.element(state.screen.getByRole('button', { name: 'stage.kiosk.media-devices.refresh', exact: true })).toBeEnabled()
    expect(state.devices.stream).toBe(stream)
    await state.screen.getByRole('combobox').nth(0).click()
    const microphone = state.devices.audioInputs.find(device => !['default', 'communications'].includes(device.deviceId))!
    await state.screen.getByRole('option', { name: microphone.label, exact: true }).click()
    await expect.poll(() => state.devices.selectedAudioInput).toBe(microphone.deviceId)
    await expect.poll(() => localStorage.getItem('settings/audio/input')).toBe(microphone.deviceId)
    await expect.poll(() => state.devices.stream?.getAudioTracks()[0]?.getSettings().deviceId).toBe(microphone.deviceId)
  }
  finally { await state.dispose() }
})

it.runIf(import.meta.env.VITEST_FAKE_MEDIA === '1')('routes both native media and Web Audio to an enumerated speaker and persists the selection', async () => {
  const state = setup(true)
  try {
    await state.screen.getByRole('button', { name: 'stage.kiosk.media-devices.refresh', exact: true }).click()
    await expect.element(state.screen.getByRole('button', { name: 'stage.kiosk.media-devices.refresh', exact: true })).toBeEnabled()
    expect(state.devices.stream).toBeUndefined()
    const outputs = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audiooutput')
    expect(outputs.length).toBeGreaterThan(0)
    const output = outputs.find(device => device.deviceId !== 'default') ?? outputs[0]!
    await state.screen.getByRole('combobox').nth(1).click()
    await state.screen.getByRole('option', { name: output.label, exact: true }).click()
    await expect.poll(() => localStorage.getItem(audioOutputStorageKey)).toBe(output.deviceId)
    const audio = new Audio()
    await applyAudioOutput(audio)
    expect(audio.sinkId).toBe(output.deviceId)
    expect('sinkId' in state.context && state.context.sinkId).toBe(output.deviceId)
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
    await state.screen.getByRole('button', { name: 'stage.kiosk.media-devices.test-output' }).click()
    await expect.poll(() => play.mock.contexts.some(player => player instanceof HTMLMediaElement && player.sinkId === output.deviceId)).toBe(true)
    play.mockRestore()
  }
  finally { await state.dispose() }
})

// Report: this chat, 2026-11-18 — DEV-757106 repeatedly disables capture with
// zero tracks. Chromium's real constraint rejection can have an empty message.
it.runIf(import.meta.env.VITEST_FAKE_MEDIA === '1')('shows a rejected channel layout and can reconnect after selecting standard capture', async () => {
  const state = setup()
  try {
    state.devices.inputConstraints = { channelCount: { exact: 32 } }
    await state.screen.getByRole('button', { name: 'stage.kiosk.media-devices.refresh', exact: true }).click()
    await expect.element(state.screen.getByRole('button', { name: 'stage.kiosk.media-devices.refresh', exact: true })).toBeEnabled()
    await expect.element(state.screen.getByRole('alert')).toHaveTextContent('OverconstrainedError')
    // Chromium may identify deviceId when no enumerated device can satisfy
    // the channel layout, or channelCount when that constraint is checked first.
    await expect.element(state.screen.getByRole('alert')).toHaveTextContent(/OverconstrainedError \((?:channelCount|deviceId)\)/)
    expect(state.devices.stream).toBeUndefined()
    await state.screen.getByRole('button', { name: 'stage.kiosk.media-devices.try-standard', exact: true }).click()
    await expect.poll(() => state.devices.stream?.getAudioTracks()[0]?.readyState).toBe('live')
    await expect.element(state.screen.getByRole('alert')).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('kiosk/audio/browser-capture')!).inputMode).toBe('standard')
  }
  finally {
    await state.dispose()
    localStorage.removeItem('kiosk/audio/microphone-processing')
  }
})

// Report: this chat, 2026-11-18 — exact-eight-channel getUserMedia fails on UMA-8.
// Report: this chat, 2026-11-20 — Electron must use Chromium capture after rollback.
it.runIf(import.meta.env.VITEST_FAKE_MEDIA === '1')('uses Chromium microphone capture inside Electron despite a saved native backend', async () => {
  localStorage.setItem('kiosk/audio/array-backend', 'native-hush')
  vi.stubGlobal('airiKioskDesktop', {})
  const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
  const state = setup()
  try {
    await state.screen.getByRole('button', { name: 'stage.kiosk.media-devices.refresh', exact: true }).click()
    expect(state.devices.browserCaptureEnabled).toBe(true)
    await expect.poll(() => state.devices.stream?.getAudioTracks()[0]?.readyState).toBe('live')
    expect(getUserMedia).toHaveBeenCalled()
    expect(state.devices.inputError).toBeUndefined()
  }
  finally {
    await state.dispose()
    getUserMedia.mockRestore()
    vi.unstubAllGlobals()
    localStorage.removeItem('kiosk/audio/array-backend')
  }
})
