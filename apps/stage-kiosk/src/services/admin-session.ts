import { shallowRef } from 'vue'

import { lockKioskAdmin } from './kiosk-device'

/** Tracks the current in-memory administrator session for protected kiosk routes. */
export const isKioskAdminSessionActive = shallowRef(false)

/** Grants access after the kiosk's local PIN flow has completed. */
export function beginKioskAdminSession() {
  isKioskAdminSessionActive.value = true
}

/** Closes the in-memory entry gate immediately, then clears the Server grant. */
export async function endKioskAdminSession() {
  isKioskAdminSessionActive.value = false
  await lockKioskAdmin()
}
