import type { KioskCustomerSessionOptions } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

import { useKioskCustomerSession as useSharedKioskCustomerSession } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'
import { computed, shallowRef } from 'vue'

import { scenarioRegistry } from '../services/scenario-registry'
import { applyPendingOrderingSite } from './useKioskInteractiveServices'

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
  const session = useSharedKioskCustomerSession({
    ...options,
    resetPolicy: 'confirmed-completion',
    idleTimeoutMs: 180_000,
    resetInteractiveSurface: async () => {
      await options.resetOrderRound?.()
      await options.endVisitorSession?.()
      applyPendingOrderingSite()
      await scenarioRegistry.reloadActive()
      options.resetConversation?.()
    },
  })
  // Dismissing the receipt returns to standby, but must not reopen the same
  // customer's voice session. Only an explicit new-order action clears this latch.
  const completedRound = shallowRef(false)
  const acceptsVoiceInput = computed(() => !completedRound.value
    && session.state.value !== 'completing' && session.state.value !== 'resetting')

  return {
    ...session,
    acceptsVoiceInput,
    completeOrder() {
      const completed = session.completeOrder()
      if (completed)
        completedRound.value = true
      return completed
    },
    async startNewCustomerSession() {
      if (session.state.value === 'standby')
        await session.begin()
      else
        await session.startNewCustomerSession()
      if (session.state.value === 'active')
        completedRound.value = false
    },
  }
}
