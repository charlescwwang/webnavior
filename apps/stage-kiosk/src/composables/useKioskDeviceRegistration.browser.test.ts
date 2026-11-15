import type { DeviceSettingsSnapshot } from '@proj-airi/kiosk-proactive'

import type { KioskDevice, KioskProfile } from '../services/kiosk-device'

import { defaultDeviceSettings, defaultDeviceSettingsValues } from '@proj-airi/kiosk-proactive'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'

import { useKioskDeviceRegistration } from './useKioskDeviceRegistration'

const device: KioskDevice = { id: 'text-device', label: 'Text Kiosk', registrationMethod: 'development', siteId: 'site' }
const profile: KioskProfile = { name: 'ordering', releaseId: 'release', snapshot: { assistanceReminderPrompt: '', agentInstructions: '', characterName: 'helper', greetingPrompt: '', interactiveService: { id: 'menu', title: 'Menu', description: '', url: 'https://ordering.test' }, surveyUrl: '', version: 1, voiceConversationOnly: true } }

function snapshot(textOnlyMode: boolean, version = 1): DeviceSettingsSnapshot {
  return { deviceId: device.id, defaults: { ...defaultDeviceSettingsValues }, effective: { ...defaultDeviceSettingsValues, textOnlyMode }, settings: { ...defaultDeviceSettings, version, overrides: { textOnlyMode } } }
}

function setup(read: () => Promise<Response>) {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).endsWith('/api/kiosk/bootstrap'))
      return Response.json({ device, profile, deviceSettings: snapshot(false), mediaCapturePolicy: { mode: 'off' }, proactiveVlmEnabled: false, performanceProfile: 'balanced', voiceVadSettings: defaultDeviceSettingsValues.voiceVadSettings })
    return await read()
  })
  let registration!: ReturnType<typeof useKioskDeviceRegistration>
  const view = render(defineComponent({ setup() {
    registration = useKioskDeviceRegistration()
    return () => h('output', String(registration.deviceSettings.value?.effective.textOnlyMode))
  } }))
  return { fetch, view, registration }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// Report: this chat Nov7 — settings must synchronize without a five-minute wait.
it('refreshes on page focus and adopts remote text mode', async () => {
  const state = setup(async () => Response.json(snapshot(true, 2)))
  try {
    await state.registration.bootstrap()
    window.dispatchEvent(new Event('focus'))
    await expect.poll(() => state.registration.deviceSettings.value?.effective.textOnlyMode).toBe(true)
    expect(state.fetch).toHaveBeenCalledTimes(2)
  }
  finally { state.view.unmount() }
})

it('polls registered device settings after ten seconds and stops after disposal', async () => {
  vi.useFakeTimers()
  const state = setup(async () => Response.json(snapshot(true, 2)))
  try {
    await state.registration.bootstrap()
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.waitFor(() => expect(state.registration.deviceSettings.value?.effective.textOnlyMode).toBe(true))
    expect(state.fetch).toHaveBeenCalledTimes(2)
    state.view.unmount()
    await vi.advanceTimersByTimeAsync(10_000)
    window.dispatchEvent(new Event('focus'))
    expect(state.fetch).toHaveBeenCalledTimes(2)
  }
  finally { state.view.unmount() }
})

it('applies acknowledged saves immediately and retires an older settings response', async () => {
  const pending = Promise.withResolvers<Response>()
  const state = setup(() => pending.promise)
  try {
    await state.registration.bootstrap()
    const refresh = state.registration.refreshSettings()
    state.registration.applySavedSettings(snapshot(true, 3))
    expect(state.registration.deviceSettings.value?.effective.textOnlyMode).toBe(true)
    pending.resolve(Response.json(snapshot(false, 2)))
    await refresh
    expect(state.registration.deviceSettings.value?.effective.textOnlyMode).toBe(true)
    expect(state.registration.deviceSettings.value?.settings.version).toBe(3)
  }
  finally { state.view.unmount() }
})

it('keeps the last acknowledged mode when synchronization fails', async () => {
  const state = setup(async () => new Response('Unavailable', { status: 503 }))
  try {
    await state.registration.bootstrap()
    state.registration.applySavedSettings(snapshot(true, 2))
    await expect(state.registration.refreshSettings()).rejects.toThrow()
    expect(state.registration.deviceSettings.value?.effective.textOnlyMode).toBe(true)
  }
  finally { state.view.unmount() }
})
