import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'

import { kioskInteractionProfile } from './useKioskInteractiveServices'

/** Local operator policy, independent of server profile refreshes and customer resets. */
export function useFeedbackInvitationEnabled() {
  return useLocalStorage('kiosk/feedback-invitation/enabled', true)
}

/** The local switch can suppress the published invitation without changing its URL. */
export function useFeedbackInvitationSettings() {
  const enabled = useFeedbackInvitationEnabled()
  return computed(() => ({
    ...kioskInteractionProfile.feedbackInvitation.value,
    enabled: enabled.value && kioskInteractionProfile.feedbackInvitation.value.enabled,
  }))
}
