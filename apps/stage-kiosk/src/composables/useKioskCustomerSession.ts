import type { KioskCustomerSessionOptions } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

import { useKioskCustomerSession as useSharedKioskCustomerSession } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

import { scenarioRegistry } from '../services/scenario-registry'

export type { AnonymousKioskCustomer, KioskCustomerSessionState } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

/** Connects the shared kiosk customer lifecycle to this host's scenario surface. */
export function useKioskCustomerSession(options: Omit<KioskCustomerSessionOptions, 'resetInteractiveSurface'>) {
  return useSharedKioskCustomerSession({
    ...options,
    resetInteractiveSurface: () => scenarioRegistry.reloadActive(),
  })
}
