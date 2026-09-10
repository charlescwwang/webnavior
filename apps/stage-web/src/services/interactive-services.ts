import { useInteractionProfile } from '@proj-airi/stage-ui/composables/use-interaction-profile'
import { computed, shallowRef } from 'vue'

const defaultRestaurantOrderingUrl = import.meta.env.VITE_ORDER_MENU_URL ?? 'http://localhost:5166'

const interactionProfile = useInteractionProfile({ defaultServiceUrl: defaultRestaurantOrderingUrl })

/** An administrator-approved page that may occupy stage-web's single interactive iframe. */
export type InteractiveService = typeof interactionProfile.services.value[number]

/** Shared interaction profile state for every AIRI host on this browser origin. */
export const interactiveServices = interactionProfile.services
/** Administrator-authored operational guidance appended after web navigation safety rules. */
export const interactiveServiceAgentInstructions = interactionProfile.agentInstructions
/** Host-owned invitation settings shared with the Kiosk host on this browser origin. */
export const feedbackInvitationSettings = interactionProfile.feedbackInvitation
export const resetFeedbackInvitationSettings = interactionProfile.resetFeedbackInvitation

const activeServiceId = shallowRef<string>()

function isAvailable(service: InteractiveService) {
  if (!service.enabled || !/^[a-z][a-z0-9-]*$/.test(service.id) || !service.title.trim() || !service.description.trim())
    return false
  try {
    const url = new URL(service.serviceUrl)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}

export const availableInteractiveServices = computed(() => {
  const ids = new Set<string>()
  return interactiveServices.value.filter((service) => {
    if (!isAvailable(service) || ids.has(service.id))
      return false
    ids.add(service.id)
    return true
  })
})

export const activeInteractiveService = computed(() => {
  const current = availableInteractiveServices.value.find(service => service.id === activeServiceId.value)
  return current ?? availableInteractiveServices.value[0]
})

/** Opens one configured service in stage-web's only iframe. */
export function openInteractiveService(id: string) {
  const service = availableInteractiveServices.value.find(candidate => candidate.id === id)
  if (!service)
    throw new Error(`Interactive service "${id}" is not enabled or is incomplete.`)
  activeServiceId.value = service.id
  window.dispatchEvent(new CustomEvent('airi:interactive-service-open'))
  return service
}
