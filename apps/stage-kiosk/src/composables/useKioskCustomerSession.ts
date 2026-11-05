import type { KioskCustomerSessionOptions } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

import { useKioskCustomerSession as useSharedKioskCustomerSession } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

import { scenarioRegistry } from '../services/scenario-registry'

export type { AnonymousKioskCustomer, KioskCustomerSessionState } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

/** Connects the shared kiosk customer lifecycle to this host's scenario surface. */
interface KioskCustomerSessionHostOptions extends Omit<KioskCustomerSessionOptions, 'resetInteractiveSurface' | 'resetPolicy' | 'idleTimeoutMs'> {
  /** Renews the pinned Menu round before any old customer state is cleared. */
  resetOrderRound?: () => Promise<void>
  /** Closes the host's durable visitor session before its next customer starts. */
  endVisitorSession?: () => void | Promise<void>
  /** Clears host-rendered customer content when the shared session transitions to standby. */
  resetConversation?: () => void
}

export function useKioskCustomerSession(options: KioskCustomerSessionHostOptions) {
  return useSharedKioskCustomerSession({
    ...options,
    resetPolicy: 'confirmed-completion',
    idleTimeoutMs: 180_000,
    resetInteractiveSurface: async () => {
      await options.resetOrderRound?.()
      await options.endVisitorSession?.()
      await scenarioRegistry.reloadActive()
      options.resetConversation?.()
    },
  })
}
