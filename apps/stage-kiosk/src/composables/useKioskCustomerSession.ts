import type { KioskCustomerSessionOptions } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

import { readPbStateJourney } from '@proj-airi/stage-shared/pb-journey'
import { useKioskCustomerSession as useSharedKioskCustomerSession } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'
import { nextTick } from 'vue'

import { interactiveServiceClient } from '../services/interactiveServiceClient'
import { resetConversationService } from '../services/kioskConversationRetry'
import { scenarioRegistry } from '../services/scenario-registry'
import { applyPendingOrderingSite, hasPendingOrderingSite, kioskInteractionProfile } from './useKioskInteractiveServices'

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
    resetInteractiveSurface: async (reason) => {
      const pb = readPbStateJourney(kioskInteractionProfile.profile.value.services[0]?.serviceUrl ?? '')
        || interactiveServiceClient.tools.value.some(tool => tool.name === 'browser_state_get' || tool.name === 'browser_recovery_context')
      if (reason === 'staff' && pb) {
        const outcome = await resetConversationService(interactiveServiceClient, 'new-order')
        if (outcome === 'reload') {
          const localReset = interactiveServiceClient.tools.value.find(tool => tool.name === 'browser_reception_reset')
          try {
            if (localReset)
              await interactiveServiceClient.execute(localReset, {}, AbortSignal.timeout(1500))
          }
          catch {
            // An unavailable order/payment page cannot veto local initialization.
          }
        }
        interactiveServiceClient.activate(undefined)
      }
      else {
        await resetConversationService(interactiveServiceClient)
      }
      const changingSite = hasPendingOrderingSite()
      // Both an empty editable cart and a retired order start at the configured entry.
      if (!changingSite)
        await scenarioRegistry.reloadActive()
      await options.endVisitorSession?.()
      if (changingSite) {
        // Revoke the old visitor before changing the published binding.
        applyPendingOrderingSite()
        await nextTick()
        await scenarioRegistry.reloadActive()
      }
      options.resetConversation?.()
    },
  })
}
