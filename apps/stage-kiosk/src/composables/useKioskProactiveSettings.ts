import type { DetectionZone, KioskAssistanceReminderSettings, ProactiveInteractionSettings } from '@proj-airi/kiosk-proactive'

import { defaultDetectionZone, defaultKioskAssistanceReminderSettings, defaultProactiveInteractionSettings } from '@proj-airi/kiosk-proactive'
import { useLocalStorage } from '@vueuse/core'

/** Local-only kiosk settings. A later device-management service can replace this persistence seam. */
export interface KioskProactiveSettings extends ProactiveInteractionSettings, KioskAssistanceReminderSettings {
  /** Camera area that approximates the physical greeting distance for this installation. */
  detectionZone: DetectionZone
}

export const defaultKioskProactiveSettings: KioskProactiveSettings = {
  ...defaultProactiveInteractionSettings,
  ...defaultKioskAssistanceReminderSettings,
  detectionZone: defaultDetectionZone,
}

/** Loads the current kiosk's settings without contacting any remote service. */
export function useKioskProactiveSettings() {
  return useLocalStorage<KioskProactiveSettings>(
    'kiosk/proactive/settings',
    structuredClone(defaultKioskProactiveSettings),
  )
}
