import type { KioskCustomerSessionOptions } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

import { useKioskCustomerSession as useSharedKioskCustomerSession } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'
import { computed, nextTick, shallowRef } from 'vue'

import { scenarioRegistry } from '../services/scenario-registry'
import { applyPendingOrderingSite } from './useKioskInteractiveServices'

export type { AnonymousKioskCustomer, KioskCustomerSessionState } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

/** Connects the shared kiosk customer lifecycle to this host's scenario surface. */
interface KioskCustomerSessionHostOptions extends Omit<KioskCustomerSessionOptions, 'resetInteractiveSurface' | 'resetPolicy' | 'idleTimeoutMs'> {
  /** Renews the pinned Menu round before any old customer state is cleared. */
  resetOrderRound?: () => Promise<void>
  /** Resolves after the replacement page's tool handshake, before new input is admitted. */
  waitForInteractiveSurface?: () => Promise<void>
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
    restartAfterIdle: true,
    resetInteractiveSurface: async () => {
      await options.resetOrderRound?.()
      await options.endVisitorSession?.()
      applyPendingOrderingSite()
      // Let the approved-service watcher register a saved merchant before
      // waiting for the new document belonging to that service.
      await nextTick()
      await scenarioRegistry.reloadActive()
      await options.waitForInteractiveSurface?.()
      options.resetConversation?.()
    },
  })
  // Dismissing the receipt returns to standby, but must not reopen the same
  // customer's voice session. Only an explicit new-order action clears this latch.
  const completedRound = shallowRef(false)
  const restarting = shallowRef(false)
  let restartTask: Promise<void> | undefined
  const acceptsVoiceInput = computed(() => !restarting.value && !completedRound.value
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
    startNewCustomerSession() {
      if (restartTask)
        return restartTask
      // This is always an explicit new order, including standby. Repeated
      // clicks share the reset; no new voice can enter between end and begin.
      restarting.value = true
      restartTask = (async () => {
        await session.end('staff')
        await session.begin()
        if (session.state.value === 'active')
          completedRound.value = false
      })().finally(() => {
        restarting.value = false
        restartTask = undefined
      })
      return restartTask
    },
  }
}
