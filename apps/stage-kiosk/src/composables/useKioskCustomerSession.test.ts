import type { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useKioskCustomerSession } from './useKioskCustomerSession'

const { reloadScenario } = vi.hoisted(() => ({
  reloadScenario: vi.fn(),
}))

vi.mock('../services/scenario-registry', () => ({
  scenarioRegistry: { reloadActive: reloadScenario },
}))

describe('useKioskCustomerSession', () => {
  const scopes: ReturnType<typeof effectScope>[] = []

  afterEach(() => {
    scopes.splice(0).forEach(scope => scope.stop())
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('clears the customer conversation and reloads the independent interactive service', async () => {
    const chatSession = {
      createSession: vi.fn().mockResolvedValueOnce('customer-chat').mockResolvedValueOnce('standby-chat'),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      setActiveSession: vi.fn(),
    } as unknown as ReturnType<typeof useChatSessionStore>
    const scope = effectScope()
    scopes.push(scope)
    const session = scope.run(() => useKioskCustomerSession({
      activeCardId: shallowRef('default'),
      chatSession,
    }))
    if (!session)
      throw new Error('Expected customer-session composable to initialize.')

    await session.recordActivity()
    const ending = session.end('staff')
    expect(reloadScenario).toHaveBeenCalledWith()
    expect(chatSession.createSession).toHaveBeenCalledTimes(2)
    expect(chatSession.deleteSession).toHaveBeenCalledWith('customer-chat')
    await ending
    expect(session.customer.value).toBeUndefined()
    expect(session.state.value).toBe('standby')
  })

  it('keeps a session active while AIRI is waiting for a provider response', async () => {
    // ROOT CAUSE:
    //
    // The session used one unconditional 60-second inactivity timer. A slow
    // provider response did not form part of the session lifecycle, so its
    // timer could reset the customer conversation while AIRI was still busy.
    //
    // We fix this by suspending that timer for pending system work and only
    // starting a fresh inactivity interval after the final pending task ends.
    vi.useFakeTimers()
    const chatSession = {
      createSession: vi.fn().mockResolvedValue('customer-chat'),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      setActiveSession: vi.fn(),
    } as unknown as ReturnType<typeof useChatSessionStore>
    const scope = effectScope()
    scopes.push(scope)
    const session = scope.run(() => useKioskCustomerSession({
      activeCardId: shallowRef('default'),
      chatSession,
    }))
    if (!session)
      throw new Error('Expected customer-session composable to initialize.')

    await session.recordActivity()
    const releasePendingWork = session.beginPendingWork()
    await vi.advanceTimersByTimeAsync(61_000)

    expect(session.state.value).toBe('active')
    releasePendingWork()
  })

  it('waits for the host to finish a completed order instead of using an independent reset timer', async () => {
    const chatSession = {
      createSession: vi.fn().mockResolvedValue('customer-chat'),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      setActiveSession: vi.fn(),
    } as unknown as ReturnType<typeof useChatSessionStore>
    const scope = effectScope()
    scopes.push(scope)
    const session = scope.run(() => useKioskCustomerSession({
      activeCardId: shallowRef('default'),
      chatSession,
    }))
    if (!session)
      throw new Error('Expected customer-session composable to initialize.')

    await session.recordActivity()
    expect(session.completeOrder()).toBe(true)
    expect(session.state.value).toBe('completing')
    expect(reloadScenario).not.toHaveBeenCalled()

    await session.end('completed')
    expect(reloadScenario).toHaveBeenCalledOnce()
    expect(session.state.value).toBe('standby')
  })
})
