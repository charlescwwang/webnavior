import type { FeedbackInvitationSettings } from '@proj-airi/stage-ui/components'

import { defaultFeedbackInvitationSettings } from '@proj-airi/stage-ui/components'
import { useLocalStorage } from '@vueuse/core'

/** Loads this kiosk's local post-completion feedback invitation settings. */
export function useFeedbackInvitationSettings() {
  return useLocalStorage<FeedbackInvitationSettings>(
    'kiosk/feedback-invitation/settings',
    structuredClone(defaultFeedbackInvitationSettings),
  )
}
