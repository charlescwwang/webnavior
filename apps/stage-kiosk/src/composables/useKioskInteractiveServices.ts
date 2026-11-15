import type { OrderingSite } from '@proj-airi/stage-shared/ordering-sites'
import type { InteractionProfileService } from '@proj-airi/stage-ui/composables/use-interaction-profile'

import type { KioskProfile } from '../services/kiosk-device'

import { selectOrderingSite } from '@proj-airi/stage-shared/ordering-sites'
import { defaultFeedbackInvitationSettings } from '@proj-airi/stage-ui/components/scenarios/feedback-invitation/settings'
import { createDefaultInteractionProfile, useInteractionProfile } from '@proj-airi/stage-ui/composables/use-interaction-profile'

/** A locally configured interactive page which an administrator may enable for this kiosk. */
export type KioskInteractiveService = InteractionProfileService

const configuredOrderingUrl = import.meta.env.VITE_ORDERING_SCENARIO_URL ?? 'http://localhost:5166'

export const defaultKioskInteractiveServices = createDefaultInteractionProfile(configuredOrderingUrl).services

/** The one local interaction profile used by every Kiosk feature. */
export const kioskInteractionProfile = useInteractionProfile({ defaultServiceUrl: configuredOrderingUrl })

let pendingOrderingSite: OrderingSite | undefined
let pendingOrderingError: string | undefined

/** Queues a Server-saved merchant; the existing customer lifecycle owns when it is activated. */
export function queueOrderingSite(site: OrderingSite | undefined) {
  pendingOrderingError = site ? undefined : 'The saved ordering site is no longer published.'
  const current = kioskInteractionProfile.profile.value.services[0]
  pendingOrderingSite = current?.id === site?.id && current?.serviceUrl === site?.url && JSON.stringify(current?.catalogLabels) === JSON.stringify(site?.catalogLabels) ? undefined : site
}

/** Pending bindings require the same reset barrier as a customer round, including removed choices. */
export function hasPendingOrderingSite(): boolean {
  return Boolean(pendingOrderingSite || pendingOrderingError)
}

/** Called only after the old round and visitor have settled, before the iframe is renewed. */
export function applyPendingOrderingSite() {
  if (pendingOrderingError)
    throw new Error(pendingOrderingError)
  if (!pendingOrderingSite)
    return
  const site = pendingOrderingSite
  pendingOrderingSite = undefined
  kioskInteractionProfile.profile.value = {
    ...kioskInteractionProfile.profile.value,
    services: [{ enabled: true, id: site.id, title: site.title, description: site.description, serviceUrl: site.url, catalogLabels: site.catalogLabels }],
  }
}

/** Atomically mirrors the server-assigned Profile into the existing Host contract. */
export function applyKioskProfile(profile: KioskProfile, selectedId?: string) {
  const { snapshot } = profile
  const service = selectOrderingSite(snapshot, selectedId)
  pendingOrderingSite = undefined
  pendingOrderingError = undefined
  kioskInteractionProfile.profile.value = {
    version: 1,
    agentInstructions: snapshot.agentInstructions,
    services: [{
      enabled: true,
      id: service.id,
      title: service.title,
      description: service.description,
      serviceUrl: service.url,
      catalogLabels: service.catalogLabels,
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
