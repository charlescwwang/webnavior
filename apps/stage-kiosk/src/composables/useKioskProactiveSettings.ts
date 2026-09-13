import type { KioskInteractionSettings, KioskObservationSettings } from '@proj-airi/kiosk-proactive'

import { defaultKioskInteractionSettings, needsKioskObservation } from '@proj-airi/kiosk-proactive'

/** The kiosk host's name for the shared interaction-policy contract. */
export type KioskProactiveSettings = KioskInteractionSettings
export type { KioskObservationSettings }

/** Conservative defaults shared by every AIRI interaction host. */
export const defaultKioskProactiveSettings = defaultKioskInteractionSettings
export { needsKioskObservation }
