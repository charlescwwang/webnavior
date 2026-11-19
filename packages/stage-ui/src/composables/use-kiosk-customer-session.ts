import type { Ref } from 'vue'

import type { useChatSessionStore } from '../stores/chat/session-store'

import { computed, onScopeDispose, readonly, shallowRef } from 'vue'

export type KioskCustomerSessionState = 'standby' | 'active' | 'awaiting-idle-confirmation' | 'completing' | 'resetting'

/** The identity seam for a future member lookup; v1 intentionally stores no customer data. */
export interface AnonymousKioskCustomer {
  kind: 'anonymous'
  sessionId: string
}

/**
 * Host-owned actions required to reuse the customer-session lifecycle across
 * different stage surfaces.
 */
export interface KioskCustomerSessionOptions {
  /** Current character used when creating the disposable customer conversation. */
  activeCardId: Ref<string>
  /** Chat persistence owned by the stage host. */
  chatSession: ReturnType<typeof useChatSessionStore>
  /** The reason lets hosts distinguish explicit staff initialization from automatic merchant cleanup. */
  resetInteractiveSurface: (reason: 'completed' | 'idle' | 'staff') => void | Promise<void>
  /** Kiosk requires host-confirmed completion; both policies expire unanswered idle confirmation. */
  resetPolicy?: 'automatic' | 'confirmed-completion'
  /** Customer inactivity before the confirmation dialog; defaults to 45 seconds for Stage Web. */
  idleTimeoutMs?: number
}

const idleTimeoutMs = 45_000
const idleConfirmationTimeoutMs = 15_000

/**
 * Owns the anonymous customer lifecycle shared by stage-web and stage-kiosk.
 *
 * The confirmation dialog retains all customer state. Continuing cancels its
 * reset timer; only unanswered expiry, confirmed completion or staff reset clears it.
 */
export function useKioskCustomerSession(options: KioskCustomerSessionOptions) {
  const state = shallowRef<KioskCustomerSessionState>('standby')
  const customer = shallowRef<AnonymousKioskCustomer>()
  const idleDeadlineAt = shallowRef<number>()
  const standbyChatSessionId = shallowRef<string>()
  let endTimer: ReturnType<typeof setTimeout> | undefined
  let resetTask: Promise<void> | undefined
  const pendingWorkTokens = new Set<symbol>()
  const pendingWorkCount = shallowRef(0)
  const presenceIdleSuppressed = shallowRef(false)
  // A proactive greeting opens a session but is not itself proof that the
  // visitor has begun using the kiosk. Hosts use this distinction to cap
  // camera-only idle protection without weakening protection after input.
  const hasCustomerActivity = shallowRef(false)
  const hasPendingWork = computed(() => pendingWorkCount.value > 0)

  const notice = computed(() => {
    if (state.value === 'completing')
      return '模擬訂單已完成，正在顯示完成後訊息。'
    if (state.value === 'resetting')
      return '正在清除本次接待內容…'
    return undefined
  })

  function clearTimers() {
    if (endTimer)
      clearTimeout(endTimer)
    endTimer = undefined
    idleDeadlineAt.value = undefined
  }

  async function ensureStandbyChat() {
    if (standbyChatSessionId.value)
      return standbyChatSessionId.value

    await options.chatSession.initialize()
    standbyChatSessionId.value = await options.chatSession.createSession(
      options.activeCardId.value || 'default',
      { setActive: true, title: 'Kiosk 等候中' },
    )
    return standbyChatSessionId.value
  }

  function scheduleIdleTimeout() {
    clearTimers()
    if (pendingWorkTokens.size > 0 || presenceIdleSuppressed.value)
      return

    const timeoutMs = options.idleTimeoutMs ?? idleTimeoutMs
    idleDeadlineAt.value = Date.now() + timeoutMs
    endTimer = setTimeout(requestIdleConfirmation, timeoutMs)
  }

  function requestIdleConfirmation() {
    if (state.value !== 'active' || pendingWorkTokens.size > 0 || presenceIdleSuppressed.value)
      return

    clearTimers()
    state.value = 'awaiting-idle-confirmation'
    idleDeadlineAt.value = Date.now() + idleConfirmationTimeoutMs
    endTimer = setTimeout(end, idleConfirmationTimeoutMs, 'idle')
  }

  async function begin() {
    if (state.value === 'resetting')
      return

    if (state.value === 'completing') {
      clearTimers()
      state.value = 'active'
    }

    if (!customer.value) {
      const chatSessionId = await ensureStandbyChat()
      await options.chatSession.setActiveSession(chatSessionId)
      customer.value = { kind: 'anonymous', sessionId: crypto.randomUUID() }
      hasCustomerActivity.value = false
    }

    state.value = 'active'
    scheduleIdleTimeout()
  }

  async function recordActivity() {
    if (state.value === 'completing' || state.value === 'awaiting-idle-confirmation')
      return
    await begin()
    hasCustomerActivity.value = true
  }

  function continueCurrentSession() {
    if (state.value !== 'awaiting-idle-confirmation')
      return

    // Resuming changes only lifecycle timing, not dialogue, menu or answer state.
    state.value = 'active'
    hasCustomerActivity.value = true
    scheduleIdleTimeout()
  }

  async function startNewCustomerSession() {
    if (state.value !== 'awaiting-idle-confirmation')
      return

    await end('staff')
    await begin()
    hasCustomerActivity.value = true
  }

  function beginPendingWork() {
    if (state.value !== 'active')
      return () => {}

    const token = Symbol('kiosk-pending-work')
    pendingWorkTokens.add(token)
    pendingWorkCount.value = pendingWorkTokens.size
    clearTimers()

    return () => {
      if (!pendingWorkTokens.delete(token))
        return
      pendingWorkCount.value = pendingWorkTokens.size
      if (pendingWorkTokens.size === 0 && state.value === 'active')
        scheduleIdleTimeout()
    }
  }

  /** Defers idle reset while local presence has high-confidence interaction evidence. */
  function setPresenceIdleSuppressed(suppressed: boolean) {
    if (presenceIdleSuppressed.value === suppressed)
      return
    presenceIdleSuppressed.value = suppressed
    if (suppressed) {
      clearTimers()
      return
    }
    if (state.value === 'active')
      scheduleIdleTimeout()
  }

  function completeOrder() {
    if (!customer.value || state.value === 'awaiting-idle-confirmation' || state.value === 'completing' || state.value === 'resetting')
      return false
    clearTimers()
    presenceIdleSuppressed.value = false
    state.value = 'completing'
    return true
  }

  async function end(reason: 'completed' | 'idle' | 'staff') {
    // A canceled/late idle callback has no authority over a resumed or new order.
    if (reason === 'idle' && (state.value !== 'awaiting-idle-confirmation' || idleDeadlineAt.value === undefined || Date.now() < idleDeadlineAt.value))
      return
    if (options.resetPolicy === 'confirmed-completion') {
      // Only a host-confirmed completion may clear the order. A late dismissal
      // from an old overlay must not reset the next customer's active session.
      if (reason === 'completed' && state.value !== 'completing' && !resetTask)
        return
    }
    if (resetTask)
      return await resetTask

    resetTask = (async () => {
      clearTimers()
      pendingWorkTokens.clear()
      pendingWorkCount.value = 0
      presenceIdleSuppressed.value = false
      hasCustomerActivity.value = false
      state.value = 'resetting'
      const customerBeforeReset = customer.value
      const completedChatSessionId = standbyChatSessionId.value

      try {
        await options.resetInteractiveSurface(reason)
        standbyChatSessionId.value = await options.chatSession.createSession(
          options.activeCardId.value || 'default',
          { setActive: true, title: 'Kiosk 等候中' },
        )
        if (completedChatSessionId)
          await options.chatSession.deleteSession(completedChatSessionId)

        customer.value = undefined
        state.value = 'standby'
      }
      catch (error) {
        // A failed iframe or chat reset must not strand the current visitor in
        // `resetting`; return the existing session to an actionable state so
        // the customer can continue or retry the explicit restart.
        customer.value = customerBeforeReset
        if (customerBeforeReset) {
          state.value = 'active'
          scheduleIdleTimeout()
        }
        else {
          state.value = 'standby'
        }
        throw error
      }
    })().finally(() => {
      resetTask = undefined
    })

    return await resetTask
  }

  onScopeDispose(clearTimers)

  return {
    begin,
    beginPendingWork,
    continueCurrentSession,
    customer,
    hasCustomerActivity: readonly(hasCustomerActivity),
    end,
    hasPendingWork: readonly(hasPendingWork),
    idleDeadlineAt: readonly(idleDeadlineAt),
    notice,
    recordActivity,
    setPresenceIdleSuppressed,
    completeOrder,
    startNewCustomerSession,
    state,
  }
}
