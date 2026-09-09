import type { KioskDevice, KioskProfile } from '../services/kiosk-device'

import { readonly, shallowRef } from 'vue'

import { fetchKioskBootstrap, KioskDeviceRequestError, registerDevelopmentKiosk } from '../services/kiosk-device'

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
  const error = shallowRef<string>()
  const state = shallowRef<KioskRegistrationState>('checking')

  async function bootstrap() {
    state.value = 'checking'
    error.value = undefined

    try {
      const response = await fetchKioskBootstrap()
      device.value = response.device
      profile.value = response.profile
      state.value = 'registered'
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
      state.value = 'registered'
    }
    catch {
      device.value = undefined
      state.value = 'error'
      error.value = '開發 Kiosk 註冊失敗。請確認 Server 已啟用開發註冊功能。'
    }
  }

  return {
    bootstrap,
    device: readonly(device),
    profile: readonly(profile),
    error: readonly(error),
    registerDevelopmentDevice,
    state: readonly(state),
  }
}

function createDevelopmentRegistrationCode() {
  const digits = new Uint32Array(1)
  crypto.getRandomValues(digits)
  return String(digits[0] % 1_000_000).padStart(6, '0')
}
