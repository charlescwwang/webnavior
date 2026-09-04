import type { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useKioskCustomerSession } from './useKioskCustomerSession'

const { resetScenario } = vi.hoisted(() => ({
  resetScenario: vi.fn(),
}))

vi.mock('../services/scenario-registry', () => ({
  scenarioRegistry: { resetActive: resetScenario },
}))

describe('useKioskCustomerSession', () => {
  const scopes: ReturnType<typeof effectScope>[] = []

  afterEach(() => {
    scopes.splice(0).forEach(scope => scope.stop())
    vi.clearAllMocks()
  })

  it('clears the customer conversation before waiting for the independent menu service', async () => {
    const chatSession = {
      createSession: vi.fn().mockResolvedValueOnce('customer-chat').mockResolvedValueOnce('standby-chat'),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      setActiveSession: vi.fn(),
    } as unknown as ReturnType<typeof useChatSessionStore>
    let resolveMenuReset: (value: unknown) => void = () => {}
    resetScenario.mockReturnValue(new Promise(resolve => resolveMenuReset = resolve))

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
    await Promise.resolve()

    expect(resetScenario).toHaveBeenCalledWith()
    expect(chatSession.createSession).toHaveBeenCalledTimes(2)
    expect(chatSession.deleteSession).toHaveBeenCalledWith('customer-chat')
    resolveMenuReset({ cart: { itemCount: 0, lines: [], total: 0 } })
    await ending
    expect(session.customer.value).toBeUndefined()
    expect(session.state.value).toBe('standby')
  })
})
