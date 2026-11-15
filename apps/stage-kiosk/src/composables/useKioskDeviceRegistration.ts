import type { DeviceSettingsSnapshot, KioskVoiceVadSettings } from '@proj-airi/kiosk-proactive'

import type { KioskDevice, KioskMediaCaptureMode, KioskPerformanceProfile, KioskProfile } from '../services/kiosk-device'

import { defaultKioskVoiceVadSettings } from '@proj-airi/kiosk-proactive'
import { useEventListener } from '@vueuse/core'
import { onScopeDispose, readonly, shallowRef } from 'vue'

import { fetchDeviceSettings, fetchKioskBootstrap, KioskDeviceRequestError, registerDevelopmentKiosk } from '../services/kiosk-device'

export type KioskRegistrationState = 'checking' | 'registered' | 'unregistered' | 'registering' | 'error'

const settingsSyncIntervalMs = 10_000

/**
 * Owns the browser's kiosk enrollment state without exposing the device
 * credential itself. The browser sends that credential only as an HttpOnly
 * cookie, so this composable stores the public device record returned by the
 * Server instead.
 */
export function useKioskDeviceRegistration() {
  const device = shallowRef<KioskDevice>()
  const profile = shallowRef<KioskProfile>()
  const deviceSettings = shallowRef<DeviceSettingsSnapshot>()
  const mediaCaptureMode = shallowRef<KioskMediaCaptureMode>('off')
  const proactiveVlmEnabled = shallowRef(false)
  const performanceProfile = shallowRef<KioskPerformanceProfile>('constrained')
  const voiceVadSettings = shallowRef<KioskVoiceVadSettings>({ ...defaultKioskVoiceVadSettings })
  const error = shallowRef<string>()
  const state = shallowRef<KioskRegistrationState>('checking')
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let controller: AbortController | undefined
  let syncRevision = 0

  function applySettings(snapshot: DeviceSettingsSnapshot) {
    if (disposed || snapshot.deviceId !== device.value?.id)
      return
    // Device versions are monotonic. Same-version snapshots still matter when
    // Site defaults change, but an older response cannot undo a saved device edit.
    if (deviceSettings.value && snapshot.settings.version < deviceSettings.value.settings.version)
      return
    if (JSON.stringify(deviceSettings.value) === JSON.stringify(snapshot))
      return
    deviceSettings.value = snapshot
    mediaCaptureMode.value = snapshot.effective.mediaCaptureMode
    proactiveVlmEnabled.value = snapshot.effective.proactiveVlmEnabled
    performanceProfile.value = snapshot.effective.performanceProfile
    voiceVadSettings.value = snapshot.effective.voiceVadSettings
  }

  function scheduleSync() {
    clearTimeout(timer)
    if (disposed || state.value !== 'registered')
      return
    timer = setTimeout(() => {
      // Offline devices keep their acknowledged mode. A failed read never
      // fabricates a default or disables the following synchronization attempt.
      void refreshSettings().catch(() => {})
    }, settingsSyncIntervalMs)
  }

  /** Reads effective policy; a newer read or acknowledged save retires this response. */
  async function refreshSettings() {
    if (disposed || state.value !== 'registered' || !device.value)
      return
    clearTimeout(timer)
    controller?.abort()
    const current = new AbortController()
    controller = current
    const revision = ++syncRevision
    try {
      const snapshot = await fetchDeviceSettings(current.signal)
      if (!disposed && revision === syncRevision)
        applySettings(snapshot)
    }
    catch (exception) {
      if (disposed || current.signal.aborted || revision !== syncRevision)
        return
      if (exception instanceof KioskDeviceRequestError && exception.status === 401) {
        state.value = 'unregistered'
        device.value = undefined
      }
      throw exception
    }
    finally {
      if (revision === syncRevision) {
        controller = undefined
        scheduleSync()
      }
    }
  }

  /** Adopts the Server's successful save response without another fallible read. */
  function applySavedSettings(snapshot: DeviceSettingsSnapshot) {
    if (disposed || snapshot.deviceId !== device.value?.id)
      return
    ++syncRevision
    controller?.abort()
    controller = undefined
    applySettings(snapshot)
    scheduleSync()
  }

  useEventListener('focus', () => {
    if (state.value === 'registered')
      void refreshSettings().catch(() => {})
  })

  onScopeDispose(() => {
    disposed = true
    ++syncRevision
    clearTimeout(timer)
    controller?.abort()
  })

  async function bootstrap() {
    state.value = 'checking'
    error.value = undefined

    try {
      const response = await fetchKioskBootstrap()
      device.value = response.device
      profile.value = response.profile
      mediaCaptureMode.value = response.mediaCapturePolicy.mode
      proactiveVlmEnabled.value = response.proactiveVlmEnabled
      performanceProfile.value = response.performanceProfile
      voiceVadSettings.value = response.voiceVadSettings
      applySettings(response.deviceSettings)
      state.value = 'registered'
      scheduleSync()
    }
    catch (exception) {
      device.value = undefined
      if (exception instanceof KioskDeviceRequestError && exception.status === 401) {
        state.value = 'unregistered'
        return
      }

      state.value = 'error'
      error.value = '無法確認此 Kiosk 的註冊狀態。請確認 Server 連線後再試一次。'
    }
  }

  async function registerDevelopmentDevice() {
    state.value = 'registering'
    error.value = undefined

    try {
      const response = await registerDevelopmentKiosk(createDevelopmentRegistrationCode())
      device.value = response.device
      const bootstrapResponse = await fetchKioskBootstrap()
      profile.value = bootstrapResponse.profile
      mediaCaptureMode.value = bootstrapResponse.mediaCapturePolicy.mode
      proactiveVlmEnabled.value = bootstrapResponse.proactiveVlmEnabled
      performanceProfile.value = bootstrapResponse.performanceProfile
      voiceVadSettings.value = bootstrapResponse.voiceVadSettings
      applySettings(bootstrapResponse.deviceSettings)
      state.value = 'registered'
      scheduleSync()
    }
    catch {
      device.value = undefined
      state.value = 'error'
      error.value = '開發 Kiosk 註冊失敗。請確認 Server 已啟用開發註冊功能。'
    }
  }

  return {
    bootstrap,
    deviceSettings: readonly(deviceSettings),
    device: readonly(device),
    profile: readonly(profile),
    refreshSettings,
    applySavedSettings,
    error: readonly(error),
    mediaCaptureMode: readonly(mediaCaptureMode),
    proactiveVlmEnabled: readonly(proactiveVlmEnabled),
    performanceProfile: readonly(performanceProfile),
    voiceVadSettings: readonly(voiceVadSettings),
    registerDevelopmentDevice,
    state: readonly(state),
  }
}

function createDevelopmentRegistrationCode() {
  const digits = new Uint32Array(1)
  crypto.getRandomValues(digits)
  return String(digits[0] % 1_000_000).padStart(6, '0')
}
