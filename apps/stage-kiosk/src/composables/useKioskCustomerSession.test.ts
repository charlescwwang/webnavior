import type { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'

import type { CatalogSnapshot } from '../../../order-menu-server/src/domain/contracts'
import type { SeatingContext } from '../../../order-menu/src/domain/seating'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { createPosSimulator } from '../../../order-menu-server/src/simulator'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { interactiveServiceClient } from '../services/interactiveServiceClient'
import { useKioskCustomerSession } from './useKioskCustomerSession'
import { kioskInteractionProfile, queueOrderingSite } from './useKioskInteractiveServices'

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
    interactiveServiceClient.activate(undefined)
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  // Report: this chat, Nov14; PB's successful in-document reset left the next customer on the menu.
  it.each(['cart', 'paid', 'cancelled'] as const)('reloads the configured entry after a verified %s idle reset, before admitting the next customer', async (stage) => {
    vi.useFakeTimers()
    const calls: string[] = []
    interactiveServiceClient.activateTransport('https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table', () => {
      const lifetime = new AbortController()
      return {
        signal: lifetime.signal,
        dispose: reason => lifetime.abort(reason),
        discover: async request => ({ ...request, documentId: 'native-document', toolsRevision: 1, tools: (stage === 'cart' ? ['browser_recovery_context', 'browser_customer_reset'] : ['browser_state_get']).map(name => ({ name, description: '', inputSchema: { type: 'object' } })) }),
        inspect: async request => ({ connectionId: request.connectionId, documentId: request.documentId, pendingCount: 0, operations: [] }),
        execute: async (request) => {
          calls.push(request.name)
          const result = stage === 'cart' ? { ok: true, status: 'customer-reset', cartCleared: true, documentId: request.documentId } : { ok: true, source: 'browser', page: 'order-result', documentId: request.documentId, restart: 'allowed', order: { reference: 'previous-order', status: stage === 'paid' ? 50 : 79, total: 50, paymentStatus: stage, paymentMethods: [], invoice: {} } }
          return { connectionId: request.connectionId, documentId: request.documentId, operationId: request.operationId, result }
        },
      }
    })
    await interactiveServiceClient.waitUntilReady()
    const chatSession = {
      createSession: vi.fn().mockResolvedValueOnce('old-customer').mockResolvedValueOnce('standby').mockResolvedValueOnce('new-customer'),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      setActiveSession: vi.fn(),
    } as unknown as ReturnType<typeof useChatSessionStore>
    reloadScenario.mockImplementationOnce(() => {
      calls.push('reload-entry')
      // ScenarioSurface revokes the old document synchronously on reload.
      interactiveServiceClient.activate(undefined)
    })
    const scope = effectScope()
    scopes.push(scope)
    const session = scope.run(() => useKioskCustomerSession({
      activeCardId: shallowRef('default'),
      chatSession,
      endVisitorSession: () => { calls.push('end-visitor') },
      resetConversation: () => { calls.push('clear-conversation') },
    }))!
    await session.recordActivity()
    const previousCustomer = session.customer.value?.sessionId
    await vi.advanceTimersByTimeAsync(194_999)
    expect(session.state.value).toBe('awaiting-idle-confirmation')
    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toEqual([stage === 'cart' ? 'browser_customer_reset' : 'browser_state_get', 'reload-entry', 'end-visitor', 'clear-conversation'])
    expect(session.state.value).toBe('standby')
    expect(interactiveServiceClient.getDocumentId()).toBeUndefined()
    expect(interactiveServiceClient.tools.value).toEqual([])
    await session.recordActivity()
    expect(session.customer.value?.sessionId).toBeDefined()
    expect(session.customer.value?.sessionId).not.toBe(previousCustomer)
    expect(session.state.value).toBe('active')
  })

  it('clears the customer conversation and applies a queued published site only after closing the visitor', async () => {
    const chatSession = {
      createSession: vi.fn().mockResolvedValueOnce('customer-chat').mockResolvedValueOnce('standby-chat'),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      setActiveSession: vi.fn(),
    } as unknown as ReturnType<typeof useChatSessionStore>
    const scope = effectScope()
    scopes.push(scope)
    const originalProfile = kioskInteractionProfile.profile.value
    const original = originalProfile.services[0]!
    const nextSite = { id: 'next-published-site', title: 'Next published site', description: '', url: 'https://example.com/menu' }
    const endVisitorSession = vi.fn(async () => {
      expect(kioskInteractionProfile.profile.value).toBe(originalProfile)
    })
    const session = scope.run(() => useKioskCustomerSession({
      activeCardId: shallowRef('default'),
      chatSession,
      endVisitorSession,
    }))
    if (!session)
      throw new Error('Expected customer-session composable to initialize.')

    await session.recordActivity()
    queueOrderingSite(nextSite)
    expect(kioskInteractionProfile.profile.value).toBe(originalProfile)
    try {
      await session.end('staff')
      expect(endVisitorSession).toHaveBeenCalledOnce()
      expect(kioskInteractionProfile.profile.value.services[0]?.id).toBe(nextSite.id)
      expect(kioskInteractionProfile.profile.value.services[0]?.serviceUrl).toBe(nextSite.url)
      expect(reloadScenario).toHaveBeenCalledOnce()
      expect(chatSession.createSession).toHaveBeenCalledTimes(2)
      expect(chatSession.deleteSession).toHaveBeenCalledWith('customer-chat')
      expect(session.customer.value).toBeUndefined()
      expect(session.state.value).toBe('standby')
    }
    finally {
      kioskInteractionProfile.profile.value = originalProfile
      queueOrderingSite({ id: original.id, title: original.title, description: original.description, url: original.serviceUrl })
    }
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
    const endVisitorSession = vi.fn()
    const resetConversation = vi.fn()
    const session = scope.run(() => useKioskCustomerSession({
      activeCardId: shallowRef('default'),
      chatSession,
      endVisitorSession,
      resetConversation,
    }))
    if (!session)
      throw new Error('Expected customer-session composable to initialize.')

    await session.recordActivity()
    await expect(session.end('staff')).rejects.toThrow('iframe unavailable')

    expect(session.state.value).toBe('active')
    expect(session.customer.value?.sessionId).toBeTruthy()
    expect(endVisitorSession).not.toHaveBeenCalled()
    expect(resetConversation).not.toHaveBeenCalled()
    expect(chatSession.deleteSession).not.toHaveBeenCalled()
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
    expect(session.idleDeadlineAt.value).toBe(Date.now() + 180_000)
    const releasePendingWork = session.beginPendingWork()
    expect(session.hasPendingWork.value).toBe(true)
    expect(session.idleDeadlineAt.value).toBeUndefined()
    await vi.advanceTimersByTimeAsync(181_000)

    expect(session.state.value).toBe('active')
    releasePendingWork()
    expect(session.hasPendingWork.value).toBe(false)
    expect(session.idleDeadlineAt.value).toBe(Date.now() + 180_000)
  })

  it('defers idle reset while high-confidence presence is engaged', async () => {
    vi.useFakeTimers()
    const chatSession = {
      createSession: vi.fn().mockResolvedValue('customer-chat'),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      setActiveSession: vi.fn(),
    } as unknown as ReturnType<typeof useChatSessionStore>
    const scope = effectScope()
    scopes.push(scope)
    const session = scope.run(() => useKioskCustomerSession({ activeCardId: shallowRef('default'), chatSession }))
    if (!session)
      throw new Error('Expected customer-session composable to initialize.')

    await session.recordActivity()
    session.setPresenceIdleSuppressed(true)
    await vi.advanceTimersByTimeAsync(181_000)
    expect(session.state.value).toBe('active')
    session.setPresenceIdleSuppressed(false)
    expect(session.idleDeadlineAt.value).toBe(Date.now() + 180_000)
  })

  it('distinguishes a proactive session from a customer action', async () => {
    const chatSession = {
      createSession: vi.fn().mockResolvedValue('customer-chat'),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      setActiveSession: vi.fn(),
    } as unknown as ReturnType<typeof useChatSessionStore>
    const scope = effectScope()
    scopes.push(scope)
    const session = scope.run(() => useKioskCustomerSession({ activeCardId: shallowRef('default'), chatSession }))
    if (!session)
      throw new Error('Expected customer-session composable to initialize.')

    await session.begin()
    expect(session.hasCustomerActivity.value).toBe(false)

    await session.recordActivity()
    expect(session.hasCustomerActivity.value).toBe(true)

    await session.end('staff')
    expect(session.hasCustomerActivity.value).toBe(false)
  })

  it('asks before clearing an inactive customer and keeps their conversation after continuing', async () => {
    vi.useFakeTimers()
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const endVisitorSession = vi.fn()
    const resetConversation = vi.fn()
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
      endVisitorSession,
      resetConversation,
    }))
    if (!session)
      throw new Error('Expected customer-session composable to initialize.')

    await session.recordActivity()
    const customerSessionId = session.customer.value?.sessionId
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要紅燒牛肉麵' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    await vi.advanceTimersByTimeAsync(180_000)

    expect(session.state.value).toBe('awaiting-idle-confirmation')
    expect(session.customer.value?.sessionId).toBeTruthy()
    expect(session.idleDeadlineAt.value).toBe(Date.now() + 15_000)

    await vi.advanceTimersByTimeAsync(14_000)

    session.continueCurrentSession()

    expect(session.state.value).toBe('active')
    expect(session.customer.value?.sessionId).toBe(customerSessionId)
    expect(chatSession.deleteSession).not.toHaveBeenCalled()
    expect(chatSession.createSession).toHaveBeenCalledOnce()
    expect(reloadScenario).not.toHaveBeenCalled()
    expect(endVisitorSession).not.toHaveBeenCalled()
    expect(resetConversation).not.toHaveBeenCalled()
    expect(session.idleDeadlineAt.value).toBe(Date.now() + 180_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await session.end('idle')
    expect(session.state.value).toBe('active')
    expect(session.customer.value?.sessionId).toBe(customerSessionId)
    expect(reloadScenario).not.toHaveBeenCalled()
    expect(resetConversation).not.toHaveBeenCalled()
    const resumed = await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' }) as { candidates: Array<{ id: string, description: string }> }
    expect(resumed).toMatchObject({ phase: 'configuration', references: [{ label: '紅燒牛肉麵' }] })
    const choice = resumed.candidates.find(candidate => candidate.description.includes('2 份'))!

    // Reloading the independent menu is the host's external reset boundary.
    // Continuing must not call it; explicitly starting over must clear the draft.
    reloadScenario.mockImplementationOnce(() => runtime.reset())
    await session.end('staff')
    expect(reloadScenario).toHaveBeenCalledOnce()
    expect(endVisitorSession).toHaveBeenCalledOnce()
    expect(resetConversation).toHaveBeenCalledOnce()
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' })).not.toMatchObject({ phase: 'configuration' })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: choice.id })).rejects.toThrow('STALE_PLAN')
  })

  it('clears the completed order and conversation when its completion screen finishes', async () => {
    const endVisitorSession = vi.fn().mockResolvedValue(undefined)
    const resetConversation = vi.fn()
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
      endVisitorSession,
      resetConversation,
    }))
    if (!session)
      throw new Error('Expected customer-session composable to initialize.')

    await session.recordActivity()
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      onOrderConfirmed: () => session.completeOrder(),
    })
    await runtime.invoke('menu_select_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('cart_add_item')
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
    await expect(runtime.confirmPaidOrder('payment-accepted')).resolves.toMatchObject({ receipt: { status: 'accepted' } })
    expect(session.state.value).toBe('completing')
    expect(reloadScenario).not.toHaveBeenCalled()
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1 } })

    reloadScenario.mockImplementationOnce(() => runtime.reset())
    await session.end('completed')
    expect(reloadScenario).toHaveBeenCalledOnce()
    expect(endVisitorSession).toHaveBeenCalledOnce()
    expect(resetConversation).toHaveBeenCalledOnce()
    expect(chatSession.deleteSession).toHaveBeenCalledWith('customer-chat')
    expect(chatSession.createSession).toHaveBeenCalledTimes(2)
    expect(session.customer.value).toBeUndefined()
    expect(session.state.value).toBe('standby')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0, lines: [] } })
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '好' })).toMatchObject({ phase: 'ordering' })

    await session.recordActivity()
    const nextCustomerId = session.customer.value?.sessionId
    // A second dismissal from the previous screen is not another completed order.
    await session.end('completed')
    expect(reloadScenario).toHaveBeenCalledOnce()
    expect(endVisitorSession).toHaveBeenCalledOnce()
    expect(session.customer.value?.sessionId).toBe(nextCustomerId)
    expect(session.state.value).toBe('active')
  })

  it('retains the presented party-size question and order when continuing near the idle deadline', async () => {
    vi.useFakeTimers()
    let seating: SeatingContext = { revision: 0, ready: false, choices: [] }
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      seating: {
        context: () => seating,
        refresh: async () => {},
        release: async () => {},
        reset: async () => {},
        reserve: async () => {},
        setPartySize: async (partySize) => { seating = { ...seating, partySize, revision: seating.revision + 1 } },
      },
    })
    const endVisitorSession = vi.fn()
    const resetConversation = vi.fn()
    const chatSession = {
      createSession: vi.fn().mockResolvedValue('customer-chat'),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      setActiveSession: vi.fn(),
    } as unknown as ReturnType<typeof useChatSessionStore>
    const scope = effectScope()
    scopes.push(scope)
    const session = scope.run(() => useKioskCustomerSession({ activeCardId: shallowRef('default'), chatSession, endVisitorSession, resetConversation }))!
    await session.recordActivity()
    const customer = session.customer.value
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    const dineIn = await runtime.invoke('order_set_fulfillment', { mode: 'dine-in' }) as { pendingCustomerChoice: { questionId: string, question: string } }
    await runtime.invoke('kiosk_dialogue_presented', { content: dineIn.pendingCustomerChoice.question, questionId: dineIn.pendingCustomerChoice.questionId })
    const before = await runtime.invoke('kiosk_interaction_state')
    expect(before).toMatchObject({ waitingFor: { purpose: 'party-size' } })
    await vi.advanceTimersByTimeAsync(194_999)
    expect(session.state.value).toBe('awaiting-idle-confirmation')
    expect(await runtime.invoke('kiosk_interaction_state')).toEqual(before)
    session.continueCurrentSession()
    await vi.advanceTimersByTimeAsync(1)
    expect(session.customer.value).toBe(customer)
    expect(session.state.value).toBe('active')
    expect(await runtime.invoke('kiosk_interaction_state')).toEqual(before)
    expect(reloadScenario).not.toHaveBeenCalled()
    expect(endVisitorSession).not.toHaveBeenCalled()
    expect(resetConversation).not.toHaveBeenCalled()
    expect(chatSession.deleteSession).not.toHaveBeenCalled()
    expect(chatSession.createSession).toHaveBeenCalledOnce()
    const resumed = await runtime.invoke('kiosk_fast_path_context', { transcript: '一位' })
    expect(resumed).toMatchObject({ waitingFor: { purpose: 'party-size' } })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:set-party-size' })
    expect(seating.partySize).toBe(1)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, fulfillmentMode: 'dine-in' } })
  })

  it('does not clear an active order on a completion dismissal without confirmed completion', async () => {
    const resetConversation = vi.fn()
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
      resetConversation,
    }))
    if (!session)
      throw new Error('Expected customer-session composable to initialize.')

    await session.recordActivity()
    const customerSessionId = session.customer.value?.sessionId
    await session.end('completed')
    expect(reloadScenario).not.toHaveBeenCalled()
    expect(resetConversation).not.toHaveBeenCalled()
    expect(chatSession.deleteSession).not.toHaveBeenCalled()
    expect(session.customer.value?.sessionId).toBe(customerSessionId)
    expect(session.state.value).toBe('active')
  })

  it('replaces the idle customer only after three minutes of inactivity and the 15-second countdown expire', async () => {
    vi.useFakeTimers()
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
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
    const customerSessionId = session.customer.value?.sessionId
    const added = await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' }) as { pendingCustomerChoice: { questionId: string, question: string } }
    await runtime.invoke('kiosk_dialogue_presented', { content: added.pendingCustomerChoice.question, questionId: added.pendingCustomerChoice.questionId })
    reloadScenario.mockImplementationOnce(() => runtime.reset())
    await vi.advanceTimersByTimeAsync(179_999)
    expect(session.state.value).toBe('active')
    expect(session.customer.value?.sessionId).toBe(customerSessionId)
    expect(reloadScenario).not.toHaveBeenCalled()
    expect(resetConversation).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await session.end('idle')
    expect(endVisitorSession).not.toHaveBeenCalled()
    expect(resetConversation).not.toHaveBeenCalled()
    expect(reloadScenario).not.toHaveBeenCalled()
    expect(chatSession.deleteSession).not.toHaveBeenCalled()
    expect(chatSession.createSession).toHaveBeenCalledOnce()
    expect(session.customer.value?.sessionId).toBe(customerSessionId)
    expect(session.state.value).toBe('awaiting-idle-confirmation')
    expect(session.idleDeadlineAt.value).toBe(Date.now() + 15_000)
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ waitingFor: { purpose: 'fulfillment' } })
    await vi.advanceTimersByTimeAsync(14_999)
    expect(reloadScenario).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(endVisitorSession).toHaveBeenCalledOnce()
    expect(resetConversation).toHaveBeenCalledOnce()
    expect(reloadScenario).toHaveBeenCalledOnce()
    expect(chatSession.deleteSession).toHaveBeenCalledWith('customer-chat')
    expect(chatSession.createSession).toHaveBeenCalledTimes(2)
    expect(session.customer.value).toBeUndefined()
    expect(session.state.value).toBe('standby')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    expect(await runtime.invoke('kiosk_interaction_state')).not.toHaveProperty('waitingFor')

    await session.recordActivity()
    expect(session.customer.value?.sessionId).not.toBe(customerSessionId)
    expect(session.state.value).toBe('active')
  })
})
