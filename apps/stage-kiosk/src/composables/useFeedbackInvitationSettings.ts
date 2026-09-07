import { kioskInteractionProfile } from './useKioskInteractiveServices'

/** Loads invitation settings from the shared same-origin interaction profile. */
export function useFeedbackInvitationSettings() {
  return kioskInteractionProfile.feedbackInvitation
}
