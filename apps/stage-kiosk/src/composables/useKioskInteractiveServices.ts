import type { InteractionProfileService } from '@proj-airi/stage-ui/composables/use-interaction-profile'

import type { KioskProfile } from '../services/kiosk-device'

import { defaultFeedbackInvitationSettings } from '@proj-airi/stage-ui/components/scenarios/feedback-invitation/settings'
import { createDefaultInteractionProfile, useInteractionProfile } from '@proj-airi/stage-ui/composables/use-interaction-profile'

/** A locally configured interactive page which an administrator may enable for this kiosk. */
export type KioskInteractiveService = InteractionProfileService

const configuredOrderingUrl = import.meta.env.VITE_ORDERING_SCENARIO_URL ?? 'http://localhost:5174'

export const defaultKioskInteractiveServices = createDefaultInteractionProfile(configuredOrderingUrl).services

/** The one local interaction profile used by every Kiosk feature. */
export const kioskInteractionProfile = useInteractionProfile({ defaultServiceUrl: configuredOrderingUrl })

/** Atomically mirrors the server-assigned Profile into the existing Host contract. */
export function applyKioskProfile(profile: KioskProfile) {
  const { snapshot } = profile
  kioskInteractionProfile.profile.value = {
    version: 1,
    agentInstructions: snapshot.agentInstructions,
    services: [{
      enabled: true,
      id: snapshot.interactiveService.id,
      title: snapshot.interactiveService.title,
      description: snapshot.interactiveService.description,
      serviceUrl: snapshot.interactiveService.url,
    }],
    feedbackInvitation: {
      ...defaultFeedbackInvitationSettings,
      enabled: true,
      surveyUrl: snapshot.surveyUrl,
    },
  }
}

/** Reads the profile-approved services shared by AIRI hosts on this browser origin. */
export function useKioskInteractiveServices() {
  return kioskInteractionProfile.services
}

/** Reads profile guidance appended after kiosk navigation safety rules. */
export function useKioskInteractiveServiceAgentInstructions() {
  return kioskInteractionProfile.agentInstructions
}
