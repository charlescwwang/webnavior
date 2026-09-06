import type { KioskInteractionSettings } from './types'

import { defaultKioskAssistanceReminderSettings } from './assistance-reminder'
import { defaultDetectionZone } from './observation'
import { defaultProactiveInteractionSettings } from './session'

/** Conservative defaults: no camera, VLM request, or media persistence. */
export const defaultKioskInteractionSettings: KioskInteractionSettings = {
  observation: {
    enabled: false,
    detectionZone: defaultDetectionZone,
  },
  proactiveGreeting: defaultProactiveInteractionSettings,
  assistanceReminder: {
    ...defaultKioskAssistanceReminderSettings,
    enabled: false,
  },
  visualAssistance: {
    enabled: false,
    contextScope: 'event',
    providerPolicy: 'local-only',
    eventTimeoutMs: 3_000,
  },
  mediaRetention: {
    mode: 'disabled',
  },
}

/**
 * Determines whether the local camera is currently needed for an interaction.
 * A reminder never starts a session by itself; it needs an active customer and
 * confirmation that the customer remains in the interaction area.
 */
export function needsKioskObservation(settings: KioskInteractionSettings, hasActiveSession: boolean) {
  if (!settings.observation.enabled)
    return false

  return settings.proactiveGreeting.enabled
    || (settings.assistanceReminder.enabled && hasActiveSession)
}
