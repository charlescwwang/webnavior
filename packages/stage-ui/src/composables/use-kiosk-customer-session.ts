import type { Ref } from 'vue'

import type { useChatSessionStore } from '../stores/chat/session-store'

import { computed, onScopeDispose, readonly, shallowRef } from 'vue'

export type KioskCustomerSessionState = 'standby' | 'active' | 'completing' | 'resetting'

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
  /** Clears or reloads the host's currently embedded interactive service. */
  resetInteractiveSurface: () => void | Promise<void>
}

const idleTimeoutMs = 60_000

/**
 * Owns the anonymous customer lifecycle shared by stage-web and stage-kiosk.
 *
 * The host supplies only the interactive-surface reset action. All chat
 * replacement, idle timing, and pending-work protection remain local to this
 * module so the two stage surfaces cannot diverge in customer-session behavior.
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
    if (pendingWorkTokens.size > 0)
      return

    idleDeadlineAt.value = Date.now() + idleTimeoutMs
    endTimer = setTimeout(() => void end('idle'), idleTimeoutMs)
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
    }

    state.value = 'active'
    scheduleIdleTimeout()
  }

  async function recordActivity() {
    if (state.value === 'completing')
      return
    await begin()
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

  function completeOrder() {
    if (!customer.value || state.value === 'completing' || state.value === 'resetting')
      return false
    clearTimers()
    state.value = 'completing'
    return true
  }

  async function end(_reason: 'completed' | 'idle' | 'staff') {
    if (resetTask)
      return await resetTask

    resetTask = (async () => {
      clearTimers()
      pendingWorkTokens.clear()
      pendingWorkCount.value = 0
      state.value = 'resetting'
      const completedChatSessionId = standbyChatSessionId.value

      await options.resetInteractiveSurface()
      standbyChatSessionId.value = await options.chatSession.createSession(
        options.activeCardId.value || 'default',
        { setActive: true, title: 'Kiosk 等候中' },
      )
      if (completedChatSessionId)
        await options.chatSession.deleteSession(completedChatSessionId)

      customer.value = undefined
      state.value = 'standby'
    })().finally(() => {
      resetTask = undefined
    })

    return await resetTask
  }

  onScopeDispose(clearTimers)

  return {
    begin,
    beginPendingWork,
    customer,
    end,
    hasPendingWork: readonly(hasPendingWork),
    idleDeadlineAt: readonly(idleDeadlineAt),
    notice,
    recordActivity,
    completeOrder,
    state,
  }
}
