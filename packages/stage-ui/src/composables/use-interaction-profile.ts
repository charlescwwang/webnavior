import type { OrderingSite } from '@proj-airi/stage-shared/ordering-sites'

import type { FeedbackInvitationSettings } from '../components/scenarios/feedback-invitation/settings'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { computed } from 'vue'

import { defaultFeedbackInvitationSettings } from '../components/scenarios/feedback-invitation/settings'

/** A browser-local configuration profile shared by AIRI Interaction Hosts on one origin. */
export interface InteractionProfile {
  /** Bump when the persisted profile shape needs an intentional migration. */
  version: 1
  /** Administrator-approved services that AIRI may embed and operate. */
  services: InteractionProfileService[]
  /** Operational guidance appended after the host's navigation safety rules. */
  agentInstructions: string
  /** Host-owned survey invitation shown after a service reports completion. */
  feedbackInvitation: FeedbackInvitationSettings
}

/** A customer-facing web service approved for one AIRI interaction profile. */
export interface InteractionProfileService {
  /** Disabled services are neither embedded nor exposed to the Agent. */
  enabled: boolean
  /** Stable identifier used by AIRI to select an approved service. */
  id: string
  /** Customer-facing name shown by the host. */
  title: string
  /** Explains when AIRI may open the service. */
  description: string
  /** HTTP(S) page embedded by the host. */
  serviceUrl: string
  /** Published discovery labels belonging only to this merchant binding. */
  catalogLabels?: OrderingSite['catalogLabels']
}

export interface UseInteractionProfileOptions {
  /** URL used only when this origin has never created an interaction profile. */
  defaultServiceUrl: string
}

const profileStorageKey = 'airi/interaction-profile/v1'

/**
 * Creates the fresh-install profile without reading or migrating prior host-specific settings.
 */
export function createDefaultInteractionProfile(defaultServiceUrl: string): InteractionProfile {
  return {
    version: 1,
    services: [{
      enabled: true,
      id: 'restaurant-ordering',
      title: '餐點點餐',
      description: '協助顧客瀏覽菜單、客製餐點、管理購物車與確認訂單。',
      serviceUrl: defaultServiceUrl,
    }],
    agentInstructions: '',
    feedbackInvitation: structuredClone(defaultFeedbackInvitationSettings),
  }
}

/**
 * Owns the non-secret Interaction Host configuration for one browser origin.
 *
 * The profile intentionally begins empty relative to the historical Web and
 * Kiosk storage keys. Existing settings are not migrated: the first host to
 * open on an origin creates this profile, and all later hosts read the same
 * `localStorage` record. Browser storage events keep separate tabs in sync.
 */
export function useInteractionProfile(options: UseInteractionProfileOptions) {
  const profile = useLocalStorageManualReset<InteractionProfile>(
    profileStorageKey,
    createDefaultInteractionProfile(options.defaultServiceUrl),
    // Settings pages bind directly to nested service and survey fields.
    // Persist those mutations as well as whole-profile replacements.
    { deep: true },
  )

  const services = computed({
    get: () => profile.value.services,
    set: services => profile.value = { ...profile.value, services },
  })
  const agentInstructions = computed({
    get: () => profile.value.agentInstructions,
    set: agentInstructions => profile.value = { ...profile.value, agentInstructions },
  })
  const feedbackInvitation = computed({
    get: () => profile.value.feedbackInvitation,
    set: feedbackInvitation => profile.value = { ...profile.value, feedbackInvitation },
  })

  function resetFeedbackInvitation() {
    feedbackInvitation.value = structuredClone(defaultFeedbackInvitationSettings)
  }

  return {
    agentInstructions,
    feedbackInvitation,
    profile,
    resetFeedbackInvitation,
    services,
  }
}
