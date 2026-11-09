import type { PresenceState } from '@proj-airi/kiosk-proactive'
import type { KioskCustomerSessionOptions } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

import { useKioskCustomerSession as useSharedKioskCustomerSession } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'
import { computed, nextTick, shallowRef, watch } from 'vue'

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
  /** Rearms local greeting windows only after a new order is ready for input. */
  onNewOrder?: () => void
  /** Announces an accepted completion after input closes, independently of ASR/model work. */
  onOrderCompleted?: () => void
}

export function useKioskCustomerSession(options: KioskCustomerSessionHostOptions) {
  const session = useSharedKioskCustomerSession({
    ...options,
    resetPolicy: 'confirmed-completion',
    idleTimeoutMs: 180_000,
    restartAfterIdle: false,
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
  // Receipt dismissal alone cannot reopen the previous customer's voice. A new
  // order is explicit, or follows confirmed EMPTY -> APPROACHING/ENGAGED presence.
  // The Scene must supply healthy camera observations, never fault/stop events.
  const completedRound = shallowRef(false)
  const restarting = shallowRef(false)
  let departureObserved = false
  let visitorRestartClaimed = false
  let restartTask: Promise<void> | undefined
  const acceptsVoiceInput = computed(() => !restarting.value && !completedRound.value
    && session.state.value !== 'completing' && session.state.value !== 'resetting')
  const canGreet = computed(() => !completedRound.value && !restarting.value && session.state.value === 'standby')
  // All successful fresh rounds wait for the visitor, including idle resets.
  // Receipt dismissal keeps completedRound latched, so it cannot rearm greeting.
  watch(canGreet, (ready) => {
    if (ready)
      options.onNewOrder?.()
  }, { flush: 'sync' })

  return {
    ...session,
    acceptsVoiceInput,
    canGreet,
    /** Offers one reset per arrival; callers await the normal order-reset barrier. */
    observePresence(state: PresenceState) {
      if (!completedRound.value || restarting.value)
        return false
      if (state === 'EMPTY') {
        departureObserved = true
        visitorRestartClaimed = false
        return false
      }
      // Wait for receipt/session persistence to finish. A failed reset remains
      // blocked until a new departure/arrival or an explicit retry by the user.
      if (session.state.value !== 'standby' || !departureObserved || visitorRestartClaimed
        || (state !== 'APPROACHING' && state !== 'ENGAGED')) {
        return false
      }
      visitorRestartClaimed = true
      return true
    },
    completeOrder() {
      const completed = session.completeOrder()
      if (completed) {
        completedRound.value = true
        departureObserved = false
        visitorRestartClaimed = false
        options.onOrderCompleted?.()
      }
      return completed
    },
    startNewCustomerSession() {
      if (restartTask)
        return restartTask
      // Repeated starts share one reset. The replacement round stays in standby
      // until camera greeting or real customer activity begins its session.
      restarting.value = true
      restartTask = (async () => {
        await session.end('staff')
        if (session.state.value === 'standby') {
          completedRound.value = false
          departureObserved = false
          visitorRestartClaimed = false
        }
      })().finally(() => {
        restarting.value = false
        restartTask = undefined
      })
      return restartTask
    },
  }
}
