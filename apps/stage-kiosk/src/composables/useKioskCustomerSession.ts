import type { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import type { Ref } from 'vue'

import { computed, onScopeDispose, shallowRef } from 'vue'

import { scenarioRegistry } from '../services/scenario-registry'

export type KioskCustomerSessionState = 'standby' | 'active' | 'completing' | 'resetting'

/** The identity seam for a future member lookup; v1 intentionally stores no customer data. */
export interface AnonymousKioskCustomer {
  kind: 'anonymous'
  sessionId: string
}

interface Options {
  activeCardId: Ref<string>
  chatSession: ReturnType<typeof useChatSessionStore>
}

const idleTimeoutMs = 60_000
const completionResetMs = 10_000

/**
 * Owns the customer-facing lifecycle around AIRI's reusable chat store and
 * the separate interactive service. A Kiosk session is deliberately narrower than
 * AIRI's persisted chat history: it is disposable and anonymous by default.
 */
export function useKioskCustomerSession(options: Options) {
  const state = shallowRef<KioskCustomerSessionState>('standby')
  const customer = shallowRef<AnonymousKioskCustomer>()
  const standbyChatSessionId = shallowRef<string>()
  let endTimer: ReturnType<typeof setTimeout> | undefined
  let resetTask: Promise<void> | undefined
  const pendingWorkTokens = new Set<symbol>()

  const notice = computed(() => {
    if (state.value === 'completing')
      return '模擬訂單已完成，準備迎接下一位顧客。'
    if (state.value === 'resetting')
      return '正在清除本次接待內容…'
    return undefined
  })

  function clearTimers() {
    if (endTimer)
      clearTimeout(endTimer)
    endTimer = undefined
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
    await begin()
  }

  /**
   * Suspends automatic session expiry while AIRI performs work on behalf of
   * the customer. The returned release function is idempotent so overlapping
   * model or tool calls cannot resume the timer prematurely.
   */
  function beginPendingWork() {
    if (state.value !== 'active')
      return () => {}

    const token = Symbol('kiosk-pending-work')
    pendingWorkTokens.add(token)
    clearTimers()

    return () => {
      if (!pendingWorkTokens.delete(token))
        return

      if (pendingWorkTokens.size === 0 && state.value === 'active')
        scheduleIdleTimeout()
    }
  }

  function completeOrder() {
    if (!customer.value)
      return

    clearTimers()
    state.value = 'completing'
    endTimer = setTimeout(() => void end('completed'), completionResetMs)
  }

  async function end(_reason: 'completed' | 'idle' | 'staff') {
    if (resetTask)
      return await resetTask

    resetTask = (async () => {
      clearTimers()
      pendingWorkTokens.clear()
      state.value = 'resetting'
      const completedChatSessionId = standbyChatSessionId.value

      // Reloading is the generic session reset boundary. It keeps AIH from
      // requiring every independent WebMCP service to expose a reset tool.
      scenarioRegistry.reloadActive()

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
    notice,
    recordActivity,
    completeOrder,
    state,
  }
}
