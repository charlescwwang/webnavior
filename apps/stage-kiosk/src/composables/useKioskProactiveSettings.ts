import type { KioskInteractionSettings, KioskObservationSettings } from '@proj-airi/kiosk-proactive'

import { defaultKioskInteractionSettings, needsKioskObservation } from '@proj-airi/kiosk-proactive'
import { useLocalStorage } from '@vueuse/core'

/** The kiosk host's name for the shared interaction-policy contract. */
export type KioskProactiveSettings = KioskInteractionSettings
export type { KioskObservationSettings }

/** Conservative defaults shared by every AIRI interaction host. */
export const defaultKioskProactiveSettings = defaultKioskInteractionSettings
export { needsKioskObservation }

/** Loads the current kiosk's settings without contacting any remote service. */
export function useKioskProactiveSettings() {
  return useLocalStorage<KioskProactiveSettings>(
    'kiosk/interaction/settings',
    structuredClone(defaultKioskProactiveSettings),
  )
}
