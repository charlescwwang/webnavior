import type { SeatingContext } from './domain/seating'

import { describe, expect, it, vi } from 'vitest'

import { createMenuToolRuntime } from './webmcp'

describe('dine-in WebMCP and semantic integration', () => {
  it('announces the party-size control before updating once through the spoken fast path', async () => {
    let state: SeatingContext = { revision: 0, ready: false, choices: [] }
    const events: string[] = []
    const onAction = vi.fn(async () => {
      events.push('animate')
    })
    const setPartySize = vi.fn(async (partySize: number) => {
      events.push('update')
      state = { ...state, revision: state.revision + 1, partySize }
    })
    const runtime = createMenuToolRuntime({ onAction, onCartChange: () => {}, onMenuSelection: () => {}, onReviewRequested: async () => {
      events.push('reveal')
    }, seating: { context: () => state, refresh: async () => {}, release: async () => {}, reset: async () => {}, reserve: async () => {}, setPartySize } })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('order_set_fulfillment', { mode: 'dine-in' })
    events.length = 0
    onAction.mockClear()
    await runtime.invoke('kiosk_fast_path_context', { transcript: '一位' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:set-party-size' })
    expect(state.partySize).toBe(1)
    expect(events).toEqual(['animate', 'reveal', 'animate', 'update'])
    expect(onAction).toHaveBeenNthCalledWith(1, expect.objectContaining({ controlId: 'order:view' }))
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ controlId: 'seating:party-size' }))
    expect(setPartySize).toHaveBeenCalledOnce()
  })
  it('keeps the party question after repeating dine-in, a lookup, deferral and idle, then accepts 一位', async () => {
    vi.useFakeTimers()
    try {
      let state: SeatingContext = { revision: 0, ready: false, choices: [] }
      const reset = vi.fn(async () => {})
      const runtime = createMenuToolRuntime({
        onAction: () => {},
        onCartChange: () => {},
        onMenuSelection: () => {},
        seating: {
          context: () => state,
          refresh: async () => {},
          release: async () => {},
          reset,
          reserve: async () => {},
          setPartySize: async (partySize) => { state = { revision: state.revision + 1, partySize, ready: false, choices: [{ id: 'TABLE_CHOICE_1', label: '1 號桌', tableIds: ['T1'], splitRequired: false }] } },
        },
      })
      await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
      const dineIn = await runtime.invoke('order_set_fulfillment', { mode: 'dine-in' }) as { pendingCustomerChoice: { questionId: string, question: string } }
      await runtime.invoke('kiosk_dialogue_presented', { content: dineIn.pendingCustomerChoice.question, questionId: dineIn.pendingCustomerChoice.questionId })
      const repeated = await runtime.invoke('kiosk_fast_path_context', { transcript: '這裡吃' }) as { candidates: Array<{ id: string }> }
      expect(repeated.candidates.some(candidate => candidate.id === 'intent:set-fulfillment:dine-in')).toBe(true)
      const sameMode = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:set-fulfillment:dine-in' }) as { pendingCustomerChoice: { questionId: string, question: string } }
      await runtime.invoke('kiosk_dialogue_presented', { content: sameMode.pendingCustomerChoice.question, questionId: sameMode.pendingCustomerChoice.questionId })
      await runtime.invoke('menu_get', { query: '周氏蝦捲' })
      await runtime.invoke('kiosk_dialogue_presented', { content: '我找到周氏蝦捲。' })
      await runtime.invoke('kiosk_fast_path_context', { transcript: '等一下' })
      await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:defer-question' })
      vi.advanceTimersByTime(55_000)
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ waitingFor: { purpose: 'party-size' } })
      const next = await runtime.invoke('kiosk_fast_path_context', { transcript: '一位' })
      expect(next).toMatchObject({ waitingFor: { purpose: 'party-size', choices: expect.arrayContaining([expect.objectContaining({ id: 'intent:set-party-size' })]) } })
      const sized = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:set-party-size' }) as { pendingCustomerChoice: { questionId: string, question: string } }
      expect(state.partySize).toBe(1)
      await runtime.invoke('kiosk_dialogue_presented', { content: sized.pendingCustomerChoice.question, questionId: sized.pendingCustomerChoice.questionId })
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ waitingFor: { purpose: 'tables' } })
      expect(reset).not.toHaveBeenCalled()
    }
    finally { vi.useRealTimers() }
  })

  it('does not refresh seats for ordinary pickup decisions or Agent cart writes', async () => {
    const refresh = vi.fn(async () => {})
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, seating: { context: () => ({ revision: 0, ready: false, choices: [] }), refresh, release: async () => {}, reset: async () => {}, setPartySize: async () => {}, reserve: async () => {} } })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '查看購物車' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:view-cart' })
    await runtime.invokeForAgent('order_add_item', { itemId: 'chous-shrimp-roll', quantity: 2 })
    expect(refresh).not.toHaveBeenCalled()
    await runtime.invoke('order_set_fulfillment', { mode: 'dine-in' })
    expect(refresh).toHaveBeenCalledTimes(1)
    await runtime.invoke('kiosk_fast_path_context', { transcript: '查看購物車' })
    expect(refresh).toHaveBeenCalledTimes(2)
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:view-cart' })
    expect(refresh).toHaveBeenCalledTimes(3)
  })
  it('routes person count and finite seat choice through the same controller without leaking hold capabilities', async () => {
    let state: SeatingContext = { revision: 0, ready: false, choices: [] }
    const reserve = vi.fn(async () => {
      state = { ...state, revision: state.revision + 1, ready: true, choices: [] }
    })
    const reset = vi.fn(async () => {
      state = { revision: state.revision + 1, ready: false, choices: [] }
    })
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      seating: {
        context: () => state,
        refresh: async () => {},
        release: async () => {},
        reset,
        reserve,
        setPartySize: async (partySize) => { state = { revision: state.revision + 1, partySize, ready: false, choices: [{ id: 'TABLE_CHOICE_1', label: '1 號桌', tableIds: ['T1'], splitRequired: false }] } },
      },
    })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await expect(runtime.invoke('order_set_fulfillment', { mode: 'dine-in' })).resolves.toMatchObject({ pendingCustomerChoice: { question: '請問幾位用餐？' } })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '兩位' })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:set-party-size' })).resolves.toMatchObject({ seating: { partySize: 2, ready: false } })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '選一號桌' }) as { references: Array<{ label: string, refId: string }> }
    expect(context.references).toContainEqual({ label: '1 號桌', refId: 'TABLE_CHOICE_1' })
    expect(JSON.stringify(context)).not.toContain('T1')
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:reserve-tables:TABLE_CHOICE_1' })
    expect(reserve).toHaveBeenCalledWith('TABLE_CHOICE_1', false, 1)
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
    expect(reset).toHaveBeenCalledOnce()
  })

  it('rejects both a stale Jev choice and a stale Agent ordinal instead of mapping it to a different table', async () => {
    let state: SeatingContext = { revision: 1, partySize: 2, ready: false, choices: [{ id: 'TABLE_CHOICE_1', label: '1 號桌', tableIds: ['T1'], splitRequired: false }] }
    const reserve = vi.fn(async () => {})
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, seating: { context: () => state, refresh: async () => {}, release: async () => {}, reset: async () => {}, setPartySize: async () => {}, reserve } })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('order_set_fulfillment', { mode: 'dine-in' })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '選一號桌' })
    state = { ...state, revision: 2, choices: [{ id: 'TABLE_CHOICE_1', label: '2 號桌', tableIds: ['T2'], splitRequired: false }] }
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:reserve-tables:TABLE_CHOICE_1' })).rejects.toThrow('STALE_PLAN')
    await expect(runtime.invokeForAgent('seating_reserve', { choiceId: 'TABLE_CHOICE_1', splitApproved: false, expectedRevision: 1 })).rejects.toThrow('STALE_PLAN')
    expect(reserve).not.toHaveBeenCalled()
  })
})
