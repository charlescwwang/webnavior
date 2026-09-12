import { useLocalStorage } from '@vueuse/core'

/** Operator-only preference for exposing the local camera feed; it never changes capture or Server policy. */
export function useKioskCameraPreview() {
  return useLocalStorage('kiosk/camera-preview/enabled', false)
}
