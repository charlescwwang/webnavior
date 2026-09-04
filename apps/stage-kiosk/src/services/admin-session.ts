import { shallowRef } from 'vue'

/** Tracks the current in-memory administrator session for protected kiosk routes. */
export const isKioskAdminSessionActive = shallowRef(false)

/** Grants access after the kiosk's local PIN flow has completed. */
export function beginKioskAdminSession() {
  isKioskAdminSessionActive.value = true
}
