import type { FeedbackInvitationSettings } from '@proj-airi/stage-ui/components'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defaultFeedbackInvitationSettings } from '@proj-airi/stage-ui/components'

/** Local settings for the web host's post-completion survey invitation. */
export const feedbackInvitationSettings = useLocalStorageManualReset<FeedbackInvitationSettings>(
  'interactive-services/feedback-invitation',
  structuredClone(defaultFeedbackInvitationSettings),
)
