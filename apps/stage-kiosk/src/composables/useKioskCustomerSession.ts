import type { KioskCustomerSessionOptions } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

import { useKioskCustomerSession as useSharedKioskCustomerSession } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'
import { nextTick } from 'vue'

import { interactiveServiceClient } from '../services/interactiveServiceClient'
import { resetConversationService } from '../services/kioskConversationRetry'
import { scenarioRegistry } from '../services/scenario-registry'
import { applyPendingOrderingSite, hasPendingOrderingSite } from './useKioskInteractiveServices'

export type { AnonymousKioskCustomer, KioskCustomerSessionState } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

/** Connects the shared kiosk customer lifecycle to this host's scenario surface. */
interface KioskCustomerSessionHostOptions extends Omit<KioskCustomerSessionOptions, 'resetInteractiveSurface' | 'resetPolicy' | 'idleTimeoutMs'> {
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
      await resetConversationService(interactiveServiceClient)
      const changingSite = hasPendingOrderingSite()
      // Native reset verifies the old cart in its existing document. The next
      // customer must still enter through the configured select-table URL;
      // retaining that document would leave them on the previous menu page.
      if (!changingSite)
        await scenarioRegistry.reloadActive()
      await options.endVisitorSession?.()
      if (changingSite) {
        // Revoke the old visitor before changing the published binding. PB's
        // reset has already cleared its unfinished cart, retained login and
        // checked pending work before this site switch.
        applyPendingOrderingSite()
        await nextTick()
        await scenarioRegistry.reloadActive()
      }
      options.resetConversation?.()
    },
  })
}
