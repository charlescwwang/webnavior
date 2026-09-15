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
    await ending

    // The shared lifecycle awaits the host's iframe reset because a host may
    // need to finish an asynchronous reload before creating the next session.
    expect(reloadScenario).toHaveBeenCalledWith()
    expect(chatSession.createSession).toHaveBeenCalledTimes(2)
    expect(chatSession.deleteSession).toHaveBeenCalledWith('customer-chat')
    expect(session.customer.value).toBeUndefined()
    expect(session.state.value).toBe('standby')
  })

  it('restores the active customer session when interactive reset fails', async () => {
    reloadScenario.mockRejectedValueOnce(new Error('iframe unavailable'))
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
    await expect(session.end('staff')).rejects.toThrow('iframe unavailable')

    expect(session.state.value).toBe('active')
    expect(session.customer.value?.sessionId).toBeTruthy()
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
    expect(session.idleDeadlineAt.value).toBe(Date.now() + 45_000)
    const releasePendingWork = session.beginPendingWork()
    expect(session.hasPendingWork.value).toBe(true)
    expect(session.idleDeadlineAt.value).toBeUndefined()
    await vi.advanceTimersByTimeAsync(61_000)

    expect(session.state.value).toBe('active')
    releasePendingWork()
    expect(session.hasPendingWork.value).toBe(false)
    expect(session.idleDeadlineAt.value).toBe(Date.now() + 45_000)
  })

  it('asks before clearing an inactive customer and keeps their conversation after continuing', async () => {
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
    await vi.advanceTimersByTimeAsync(45_000)

    expect(session.state.value).toBe('awaiting-idle-confirmation')
    expect(session.customer.value?.sessionId).toBeTruthy()
    expect(session.idleDeadlineAt.value).toBe(Date.now() + 15_000)

    session.continueCurrentSession()

    expect(session.state.value).toBe('active')
    expect(chatSession.deleteSession).not.toHaveBeenCalled()
    expect(session.idleDeadlineAt.value).toBe(Date.now() + 45_000)
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

  it('clears the host conversation when the idle-confirmation countdown expires', async () => {
    vi.useFakeTimers()
    const endVisitorSession = vi.fn().mockResolvedValue(undefined)
    const resetConversation = vi.fn()
    const chatSession = {
      createSession: vi.fn().mockResolvedValue('customer-chat'),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      setActiveSession: vi.fn(),
    } as unknown as ReturnType<typeof useChatSessionStore>
    const options = {
      activeCardId: shallowRef('default'),
      chatSession,
      endVisitorSession,
      resetConversation,
    }
    const scope = effectScope()
    scopes.push(scope)
    const session = scope.run(() => useKioskCustomerSession(options))
    if (!session)
      throw new Error('Expected customer-session composable to initialize.')

    await session.recordActivity()
    await vi.advanceTimersByTimeAsync(45_000)
    await vi.advanceTimersByTimeAsync(15_000)

    expect(endVisitorSession).toHaveBeenCalledOnce()
    expect(resetConversation).toHaveBeenCalledOnce()
    expect(session.state.value).toBe('standby')
  })
})
