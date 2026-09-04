import type { RegisteredScenario } from '../services/scenario-registry'

import { useLocalStorage } from '@vueuse/core'

/** A locally configured interactive page which an administrator may enable for this kiosk. */
export interface KioskInteractiveService extends RegisteredScenario {
  /** Disabled services are neither embedded nor exposed to the Agent. */
  enabled: boolean
}

const configuredOrderingUrl = import.meta.env.VITE_ORDERING_SCENARIO_URL ?? 'http://localhost:5174'

export const defaultKioskInteractiveServices: KioskInteractiveService[] = [
  {
    enabled: true,
    id: 'restaurant-ordering',
    title: '餐點點餐',
    description: '協助顧客瀏覽菜單、客製餐點、管理購物車與確認訂單。',
    serviceUrl: configuredOrderingUrl,
  },
]

/** Persists this kiosk's administrator-approved iframe services on the local device. */
export function useKioskInteractiveServices() {
  return useLocalStorage<KioskInteractiveService[]>(
    'kiosk/interactive-services',
    structuredClone(defaultKioskInteractiveServices),
  )
}
