import type { KioskCustomerSessionOptions } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

import { useKioskCustomerSession as useSharedKioskCustomerSession } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

import { scenarioRegistry } from '../services/scenario-registry'

export type { AnonymousKioskCustomer, KioskCustomerSessionState } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

/** Connects the shared kiosk customer lifecycle to this host's scenario surface. */
interface KioskCustomerSessionHostOptions extends Omit<KioskCustomerSessionOptions, 'resetInteractiveSurface'> {
  /** Clears host-rendered customer content when the shared session transitions to standby. */
  resetConversation?: () => void
}

export function useKioskCustomerSession(options: KioskCustomerSessionHostOptions) {
  return useSharedKioskCustomerSession({
    ...options,
    resetInteractiveSurface: async () => {
      await scenarioRegistry.reloadActive()
      options.resetConversation?.()
    },
  })
}
