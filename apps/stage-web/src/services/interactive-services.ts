import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { computed, shallowRef } from 'vue'

import { defaultOrderMenuUrl, orderMenuBridge } from './order-menu-bridge'

/** An administrator-approved page that may occupy stage-web's single interactive iframe. */
export interface InteractiveService {
  description: string
  enabled: boolean
  id: string
  serviceUrl: string
  title: string
}

export const interactiveServices = useLocalStorageManualReset<InteractiveService[]>(
  'interactive-services/services',
  [{
    description: '協助顧客瀏覽菜單、客製餐點、管理購物車與確認訂單。',
    enabled: true,
    id: 'restaurant-ordering',
    serviceUrl: defaultOrderMenuUrl,
    title: '餐點點餐',
  }],
)
/** Administrator-authored operational guidance appended after web navigation safety rules. */
export const interactiveServiceAgentInstructions = useLocalStorageManualReset(
  'interactive-services/agent-instructions',
  '',
)

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
  if (service.id === 'restaurant-ordering')
    orderMenuBridge.setMenuUrl(service.serviceUrl)
  activeServiceId.value = service.id
  window.dispatchEvent(new CustomEvent('airi:interactive-service-open'))
  return service
}
