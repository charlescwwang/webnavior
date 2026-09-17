import type { DeviceSettingsSnapshot, KioskVoiceVadSettings } from '@proj-airi/kiosk-proactive'

import type { KioskDevice, KioskMediaCaptureMode, KioskPerformanceProfile, KioskProfile } from '../services/kiosk-device'

import { defaultKioskVoiceVadSettings } from '@proj-airi/kiosk-proactive'
import { onScopeDispose, readonly, shallowRef } from 'vue'

import { fetchDeviceSettings, fetchKioskBootstrap, KioskDeviceRequestError, registerDevelopmentKiosk } from '../services/kiosk-device'

export type KioskRegistrationState = 'checking' | 'registered' | 'unregistered' | 'registering' | 'error'

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

  function applySettings(snapshot: DeviceSettingsSnapshot) {
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
    if (disposed)
      return
    // One in-flight request per mounted registration owner. Re-read effective
    // values too: a Site default may change without changing device revision.
    timer = setTimeout(async () => {
      controller = new AbortController()
      try {
        const snapshot = await fetchDeviceSettings(controller.signal)
        if (!disposed && snapshot.deviceId === device.value?.id)
          applySettings(snapshot)
      }
      catch (exception) {
        if (exception instanceof KioskDeviceRequestError && exception.status === 401) {
          state.value = 'unregistered'
          device.value = undefined
          return
        }
        // Offline devices retain their last Server snapshot; API mutations and
        // uploads are independently authorized against current Server policy.
      }
      finally {
        if (device.value)
          scheduleSync()
      }
    }, 15000)
  }

  onScopeDispose(() => {
    disposed = true
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
