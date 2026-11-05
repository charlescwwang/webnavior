import { useLocalStorage } from '@vueuse/core'

/** PIN-protected browser preference; off defers to the device/Profile policy. */
export function useKioskTextOnlyMode() {
  return useLocalStorage('kiosk/conversation/text-only', false)
}
