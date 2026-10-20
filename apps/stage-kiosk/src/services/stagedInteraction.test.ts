import type { WebMcpTool } from '@proj-airi/stage-ui/services/webmcp-adapter'

import type { CheckoutSnapshot } from '../../../order-menu/src/domain/checkout-flow'
import type { MenuItem } from '../../../order-menu/src/domain/order-machine'
import type { SeatingContext } from '../../../order-menu/src/domain/seating'

import { describe, expect, it, vi } from 'vitest'

import sourceMenu from '../../../../周氏蝦捲菜單_v2.json'

import { beginCheckout, chooseInvoiceMethod, confirmTaxId, requestTaxId, setTaxIdDraft, skipMembership } from '../../../order-menu/src/domain/checkout-flow'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { decideInteraction } from '../../../server/src/services/domain/kiosk-interaction-decision'
import { createRecommendationInvitation } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'
import { createDecisionStages } from '../../../server/src/services/domain/kiosk-interaction-decision/stages'
import { runFastPath } from './kiosk-fast-path'
import { createInvitationWindow, presentedQuestionFrom } from './questionPresentation'

// Use the merchant fixture's names/aliases, not the older built-in demo menu.
const merchantMenu: MenuItem[] = sourceMenu.items.map(item => ({ id: item.id, name: item.name, aliases: 'aliases' in item ? item.aliases : [], category: sourceMenu.categories.find(category => category.id === item.categoryId)!.name, price: item.price, imageUrl: item.image, description: item.description, available: item.available, optionGroups: item.optionGroups, recommendationTags: [] }))

describe('staged decision through the actual ordering runtime', () => {
  // Report: this chat, 2026-10-20; typed 略過 at phone entry must still
  // execute the browser-owned skip even when visual presence is EMPTY.
  it('skips optional phone entry with empty presence when the utterance is admitted', async () => {
    let ready = false
    const onSkip = vi.fn(() => ready = true)
    const runtime = createMenuToolRuntime({ orderingReady: () => ready, onCustomerEntrySkipped: onSkip, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const result = await runFastPath({ transcript: '略過', presenceState: 'EMPTY', isEnabled: async () => true, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://ordering.test' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) }, decide: request => decideInteraction({ ...request, policy: { decisionInstruction: '', storeInstruction: '' }, invoke: async (_state, questions) => questions.service
      ? { answers: { service: { choice: 'REQUEST', confidence: 0.95 } } }
      : { answers: { phone: { choice: 'SKIP', confidence: 0.95 } } } }) })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', action: { id: 'intent:skip-customer-entry' } })
    expect(onSkip).toHaveBeenCalledOnce()
    expect(await runtime.invoke('kiosk_interaction_state')).toHaveProperty('phase', 'ordering')
  })

  it('keeps greetings, recommendation and ordering requests at phone entry without executing a meal or a skip', async () => {
    const onCartChange = vi.fn()
    const runtime = createMenuToolRuntime({ orderingReady: () => false, onCustomerEntrySkipped: () => {}, onAction: () => {}, onCartChange, onMenuSelection: () => {} })
    const initialCartChanges = onCartChange.mock.calls.length
    const execute = vi.fn((tool: WebMcpTool, input: Record<string, unknown>) => runtime.invoke(runtime.toolDefinitions.find(definition => definition.name === tool.name)!.name, input))
    const onActionSelected = vi.fn()
    for (const { transcript, choice, expected } of [{ transcript: '你好', choice: 'GREET', expected: 'GREET' }, { transcript: '推薦一下', choice: 'ORDER', expected: 'CUSTOMER_ENTRY_REQUIRED' }, { transcript: '我要牛肉麵一份', choice: 'ORDER', expected: 'CUSTOMER_ENTRY_REQUIRED' }]) {
      const result = await runFastPath({ transcript, isEnabled: async () => true, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://ordering.test' })), execute }, onActionSelected, decide: request => decideInteraction({ ...request, policy: { decisionInstruction: '', storeInstruction: '' }, invoke: async (_state, questions) => questions.service ? { answers: { service: { choice: choice === 'GREET' ? 'HELLO_ONLY' : 'REQUEST', confidence: 0.95 } } } : { answers: { phone: { choice, confidence: 0.95 } } } }) })
      expect(result).toMatchObject({ kind: expected })
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'customer_entry' })
      expect(onCartChange.mock.calls.length).toBe(initialCartChanges)
    }
    expect(onActionSelected).not.toHaveBeenCalled()
    expect(execute.mock.calls.some(([tool]) => tool.name === 'kiosk_fast_path_execute')).toBe(false)
  })

  it('executes a correction from quantity collection into a lookup without re-asking quantity', async () => {
    const runtime = createMenuToolRuntime({ menu: merchantMenu, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要水餃' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const tools: WebMcpTool[] = runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'http://ordering.test' }))
    const result = await runFastPath({ isEnabled: async () => true, transcript: '我沒有要水餃，我是問有沒有', webMcp: { tools, execute: (tool, input) => runtime.invoke(runtime.toolDefinitions.find(definition => definition.name === tool.name)!.name, input) }, decide: request => decideInteraction({ ...request, policy: { decisionInstruction: '', storeInstruction: '' }, invoke: async (_state, questions) => questions.service ? { answers: { service: { choice: 'REQUEST', confidence: 0.99 } } } : { answers: { purpose: { choice: 'INQUIRY', confidence: 0.99 } } } }) })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', result: { customerMessage: expect.stringContaining('您是在詢問'), itemStatuses: [{ name: '水餃', status: 'available' }] } })
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'ordering' })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  // Report: local attachment eda15e0f-3084-41f3-91e4-d711b23d04e1; no public URL.
  it('retains an uncertain invitation through idle, then only displays recommendations for captured 好啊', async () => {
    vi.useFakeTimers()
    try {
      const display = vi.fn()
      const runtime = createMenuToolRuntime({ menu: merchantMenu, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: display })
      const window = createInvitationWindow()
      window.present(createRecommendationInvitation('I1', Date.now()))
      const tools: WebMcpTool[] = runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'http://ordering.test' }))
      const invoke = vi.fn()
        .mockResolvedValueOnce({ answers: { route: { choice: 'intent:recommend', confidence: 0.95 } } })
        .mockResolvedValueOnce({ answers: { relation: { choice: 'intent:recommend', confidence: 0.4 } } })
        // The uncertain reply now asks an independent recipient question;
        // an unknown addressee must retain the invitation without authorizing it.
        .mockResolvedValueOnce({ answers: { recipient: { choice: 'UNCERTAIN', confidence: 0.95 } } })
        .mockResolvedValueOnce({ answers: { route: { choice: 'intent:recommend', confidence: 0.5289 } } })
        .mockResolvedValueOnce({ answers: { relation: { choice: 'intent:recommend', confidence: 0.95 } } })
        .mockResolvedValueOnce({ answers: { recipient: { choice: 'KIOSK', confidence: 0.99 }, service: { choice: 'REQUEST', confidence: 0.99 }, filterRequirement: { choice: 'COVERED', confidence: 0.95 }, filterPresence: { choice: 'NO_FILTER', confidence: 0.95 } } })
        .mockResolvedValueOnce({ answers: { filterPresence: { choice: 'NO_FILTER', confidence: 0.95 } } })
      const run = (transcript: string) => runFastPath({ isEnabled: async () => true, transcript, webMcp: { tools, execute: (tool, input) => {
        const definition = runtime.toolDefinitions.find(definition => definition.name === tool.name)
        if (!definition)
          throw new Error('Unregistered runtime tool')
        return runtime.invoke(definition.name, input)
      } }, decide: async (request) => {
        const decision = await decideInteraction({ ...request, decisionState: window.decisionState(request.decisionState, Date.now()), policy: { decisionInstruction: '', storeInstruction: '' }, invoke })
        window.resolve(decision)
        return decision
      } })
      expect((await run('嗯')).kind).toBe('UNAVAILABLE')
      expect(display).not.toHaveBeenCalled()
      expect(window.history()).toMatchObject([{ question: { questionId: 'I1' }, status: 'pending' }])
      vi.setSystemTime(Date.now() + 55000)
      expect((await run('好啊')).kind).toBe('FAST_ACTION')
      expect(display).toHaveBeenCalledOnce()
      expect(display.mock.calls[0]?.[0].itemIds).toHaveLength(3)
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
      expect(window.history()).toMatchObject([{ question: { questionId: 'I1' }, status: 'answered' }])
      expect(window.decisionState({ phase: 'ordering' }, Date.now())).not.toHaveProperty('waitingFor')
    }
    finally { vi.useRealTimers() }
  })

  it.each([{ method: 'linepay', speech: '用 LINE Pay' }, { method: 'jkopay', speech: '用街口支付' }] as const)('selects $method from the payment answer without a second confirmation', async ({ method, speech }) => {
    let snapshot: CheckoutSnapshot | undefined
    let revision = 0
    let payment: 'pending' | undefined
    const update = (next: CheckoutSnapshot) => {
      snapshot = next
      revision++
      return next
    }
    const selectPayment = vi.fn(async () => {
      revision++
      return { customerMessage: '已選擇，尚未付款。', status: 'selected' as const }
    })
    const runtime = createMenuToolRuntime({ menu: merchantMenu, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, checkout: {
      snapshot: () => snapshot,
      revision: () => revision,
      paymentStatus: () => payment,
      paymentMethods: ['linepay', 'jkopay'],
      assertCanRestart: () => {},
      restart: () => {
        snapshot = undefined
        revision++
      },
      start: () => update(beginCheckout()),
      skipMembership: () => update(skipMembership(snapshot!)),
      chooseInvoice: method => update(chooseInvoiceMethod(snapshot!, method)),
      requestTaxId: () => update(requestTaxId(snapshot!)),
      setTaxId: value => update(setTaxIdDraft(snapshot!, value)),
      confirmTaxId: () => update(confirmTaxId(snapshot!)),
      selectPayment,
      cancel: () => {
        snapshot = undefined
        revision++
      },
    } })
    await runtime.invoke('order_add_item', { itemId: 'signature-shrimp-roll-bento' })
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
    await runtime.invoke('checkout_start', { confirmedByUser: true })
    await runtime.invoke('checkout_skip_membership', { confirmedByUser: true })
    await runtime.invoke('checkout_choose_invoice', { method: 'donation' })
    const offered = await runtime.invokeForAgent('order_ask_question', { purpose: 'payment-method' }) as { pendingCustomerChoice: { questionId: string, question: string } }
    await runtime.invoke('kiosk_dialogue_presented', { content: offered.pendingCustomerChoice.question, questionId: offered.pendingCustomerChoice.questionId })
    const tools: WebMcpTool[] = runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'http://ordering.test' }))
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { route: { choice: `intent:select-payment:${method}`, confidence: 0.5289 } } })
      .mockResolvedValueOnce({ answers: { relation: { choice: `intent:select-payment:${method}`, confidence: 0.95 } } })
    const run = (transcript: string) => runFastPath({ isEnabled: async () => true, transcript, webMcp: { tools, execute: (tool, input) => {
      const definition = runtime.toolDefinitions.find(definition => definition.name === tool.name)
      if (!definition)
        throw new Error('Unregistered runtime tool')
      return runtime.invoke(definition.name, input)
    } }, decide: request => decideInteraction({ ...request, policy: { decisionInstruction: '', storeInstruction: '' }, invoke }) })
    const result = await run(speech)
    expect(result.kind).toBe('FAST_ACTION')
    expect(selectPayment).toHaveBeenCalledExactlyOnceWith(method)
    if (result.kind !== 'FAST_ACTION')
      throw new Error('Expected payment-method selection')
    expect(result.result).toMatchObject({ payment: { method, status: 'selected' } })
    expect(result.result).not.toHaveProperty('pendingConfirmation')
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: `intent:select-payment:${method}` })).rejects.toThrow()
    expect(selectPayment).toHaveBeenCalledOnce()
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'checkout_payment_select', paymentState: 'idle' })
    expect(await runtime.invoke('kiosk_interaction_state')).not.toHaveProperty('waitingFor')
    payment = 'pending'
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'payment_locked' })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1 } })
  })

  it('orders the merchant alias after an invitation without invoking its old acceptance gate', async () => {
    const runtime = createMenuToolRuntime({ menu: merchantMenu, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const window = createInvitationWindow()
    window.present(createRecommendationInvitation('I1', Date.now()))
    const tools: WebMcpTool[] = runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'http://ordering.test' }))
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.requestPurpose
      ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.99 } } }
      : questions.cartRequest
        ? { answers: { cartRequest: { choice: 'SINGLE', confidence: 0.99 } } }
        : questions.invitation
          ? { answers: { invitation: { choice: 'ACCEPT', confidence: 0.4568 } } }
          : { answers: { route: { choice: 'intent:add-item', confidence: 0.99 } } })
    const result = await runFastPath({ isEnabled: async () => true, transcript: '排骨便當一份', webMcp: { tools, execute: (tool, input) => {
      const definition = runtime.toolDefinitions.find(definition => definition.name === tool.name)
      if (!definition)
        throw new Error('Unregistered runtime tool')
      return runtime.invoke(definition.name, input)
    } }, decide: async (request) => {
      const decision = await decideInteraction({ ...request, decisionState: window.decisionState(request.decisionState, Date.now()), policy: { decisionInstruction: '', storeInstruction: '' }, invoke })
      window.resolve(decision)
      return decision
    } })
    expect(result.kind).toBe('FAST_ACTION')
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(invoke.mock.calls[0]?.[1]).toHaveProperty('route')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ name: '炸排骨便當', quantity: 1 }] } })
    expect(window.history()).toMatchObject([{ question: { questionId: 'I1' }, status: 'superseded' }])
    expect(window.decisionState({ phase: 'ordering' }, Date.now())).not.toHaveProperty('waitingFor')
  })

  it('answers 一位 through Jev after repeating dine-in, an intervening query and 55 seconds idle', async () => {
    vi.useFakeTimers()
    try {
      let seating: SeatingContext = { revision: 0, ready: false, choices: [] }
      const setPartySize = vi.fn(async (partySize: number) => {
        seating = { ...seating, revision: seating.revision + 1, partySize }
      })
      const runtime = createMenuToolRuntime({ menu: merchantMenu, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, seating: { context: () => seating, refresh: async () => {}, release: async () => {}, reset: async () => {}, reserve: async () => {}, setPartySize } })
      const tools: WebMcpTool[] = runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'http://ordering.test' }))
      const present = async (result: unknown) => {
        const question = result && typeof result === 'object' && 'pendingCustomerChoice' in result ? presentedQuestionFrom(result.pendingCustomerChoice) : undefined
        if (question)
          await runtime.invoke('kiosk_dialogue_presented', { content: question.question, questionId: question.questionId })
      }
      await runtime.invoke('order_add_item', { itemId: 'signature-shrimp-roll-bento' })
      await present(await runtime.invoke('order_set_fulfillment', { mode: 'dine-in' }))
      const forwards: string[][] = []
      const run = (transcript: string, actionId: string) => runFastPath({ isEnabled: async () => true, transcript, onExecuted: present, webMcp: { tools, execute: (tool, input) => {
        const definition = runtime.toolDefinitions.find(definition => definition.name === tool.name)
        if (!definition)
          throw new Error('Unregistered runtime tool')
        return runtime.invoke(definition.name, input)
      } }, decide: request => decideInteraction({ ...request, policy: { decisionInstruction: '', storeInstruction: '' }, invoke: async (_state, questions) => {
        forwards.push(Object.keys(questions))
        if (questions.route)
          return { answers: { route: { choice: actionId, confidence: 0.99 } } }
        if (questions.relation)
          return { answers: { relation: { choice: actionId, confidence: 0.99 } } }
        return { answers: { recipient: { choice: 'KIOSK', confidence: 0.99 }, service: { choice: 'REQUEST', confidence: 0.99 }, filterRequirement: { choice: 'COVERED', confidence: 0.99 }, filterPresence: { choice: 'NO_FILTER', confidence: 0.99 } } }
      } }) })
      expect((await run('這裡吃', 'intent:set-fulfillment:dine-in')).kind).toBe('FAST_ACTION')
      expect(forwards).toEqual([['route']])
      expect((await run('有水餃嗎？', 'intent:search-menu')).kind).toBe('FAST_ACTION')
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ waitingFor: { purpose: 'party-size' } })
      vi.setSystemTime(Date.now() + 55000)
      forwards.length = 0
      expect((await run('一位', 'intent:set-party-size')).kind).toBe('FAST_ACTION')
      expect(forwards).toEqual([['route'], ['relation']])
      expect(seating.partySize).toBe(1)
      expect(setPartySize).toHaveBeenCalledOnce()
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1 } })
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ questionHistory: expect.arrayContaining([expect.objectContaining({ question: expect.objectContaining({ purpose: 'party-size' }) })]) })
      await runtime.reset()
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ questionHistory: [] })
    }
    finally { vi.useRealTimers() }
  })
  it('browses categories, queries during a draft, changes meal and answers after idle in one session', async () => {
    vi.useFakeTimers()
    try {
      const display = vi.fn()
      const runtime = createMenuToolRuntime({
        menu: [
          { id: 'beef', name: '紅燒牛肉麵', aliases: ['牛肉麵'], category: '麵食', price: 150, imageUrl: '', description: '', recommendationTags: [], optionGroups: [{ id: 'spice', label: '辣度', required: true, values: [{ id: 'light', label: '微辣', priceDelta: 0 }] }] },
          { id: 'dumplings', name: '水餃', category: '點心', price: 80, imageUrl: '', description: '', recommendationTags: [], optionGroups: [{ id: 'pieces', label: '每份顆數', required: true, values: [{ id: '15', label: '十五顆', priceDelta: 0 }] }] },
          { id: 'bento', name: '椒麻雞便當', category: '便當', price: 100, imageUrl: '', description: '', recommendationTags: [], optionGroups: [] },
        ],
        onAction: () => {},
        onCartChange: () => {},
        onMenuSelection: () => {},
        onRecommendationsChange: display,
      })
      const tools: WebMcpTool[] = runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'http://ordering.test' }))
      const run = (transcript: string, route: 'intent:search-menu' | 'intent:add-item' | 'answer') => runFastPath({ isEnabled: async () => true, transcript, webMcp: { tools, execute: (tool, input) => {
        const definition = runtime.toolDefinitions.find(definition => definition.name === tool.name)!
        return runtime.invoke(definition.name, input)
      } }, decide: request => decideInteraction({ ...request, policy: { decisionInstruction: '', storeInstruction: '' }, invoke: async (state, questions) => {
        if (questions.service)
          return { answers: { recipient: { choice: 'KIOSK', confidence: 0.99 }, service: { choice: 'REQUEST', confidence: 0.99 }, filterRequirement: { choice: 'COVERED', confidence: 0.99 }, filterPresence: { choice: 'NO_FILTER', confidence: 0.99 } } }
        if (questions.requestPurpose)
          return { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.99 } } }
        if (questions.cartRequest)
          return { answers: { cartRequest: { choice: 'SINGLE', confidence: 0.99 } } }
        if (questions.purpose)
          return { answers: { purpose: { choice: 'NEW_REQUEST', confidence: 0.99 } } }
        if (questions.relation)
          return { answers: { relation: { choice: route === 'answer' ? request.candidates.find(candidate => !candidate.id.endsWith(':cancel'))!.id : 'NEW_REQUEST', confidence: 0.99 } } }
        if (questions.route) {
          if (request.decisionState?.phase === 'ordering' && transcript === '我想吃麵') {
            expect(request.candidates.some(candidate => candidate.id === 'intent:add-item')).toBe(false)
            expect(state).toContain('"matchedText":"麵","itemCount":1')
          }
          const choice = route !== 'answer' && ['configuration', 'clarification'].includes(request.decisionState?.phase ?? '')
            ? 'NEW_REQUEST'
            : route === 'answer' ? request.candidates.find(candidate => !candidate.id.endsWith(':cancel'))!.id : route
          return { answers: { route: { choice, confidence: 0.99 } } }
        }
        return { answers: { recipient: { choice: 'KIOSK', confidence: 0.99 }, service: { choice: 'REQUEST', confidence: 0.99 }, filterRequirement: { choice: 'COVERED', confidence: 0.99 }, filterPresence: { choice: 'NO_FILTER', confidence: 0.99 } } }
      } }) })
      expect((await run('我想吃麵', 'intent:search-menu')).kind).toBe('FAST_ACTION')
      expect(display).toHaveBeenLastCalledWith(expect.objectContaining({ itemIds: ['beef'] }))
      expect((await run('我想吃麵，一碗', 'intent:add-item')).kind).toBe('FAST_ACTION')
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'configuration', waitingFor: { question: expect.stringContaining('辣度') } })
      expect((await run('有水餃嗎？', 'intent:search-menu')).kind).toBe('FAST_ACTION')
      expect(display).toHaveBeenLastCalledWith(expect.objectContaining({ itemIds: ['dumplings'] }))
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'configuration', references: [{ label: '紅燒牛肉麵' }] })
      expect((await run('我突然想吃便當', 'intent:search-menu')).kind).toBe('FAST_ACTION')
      expect(display).toHaveBeenLastCalledWith(expect.objectContaining({ itemIds: ['bento'] }))
      expect((await run('我要水餃', 'intent:add-item')).kind).toBe('FAST_ACTION')
      expect((await run('十五顆', 'answer')).kind).toBe('FAST_ACTION')
      vi.setSystemTime(Date.now() + 55_000)
      expect((await run('一份', 'answer')).kind).toBe('FAST_ACTION')
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'dumplings', quantity: 1, options: { pieces: '15' } }] } })
      await runtime.reset()
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    }
    finally { vi.useRealTimers() }
  })
  it('executes a bounded add once and returns to menu without altering its cart', async () => {
    let menuOpened = 0
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      onMenuRequested: () => {
        menuOpened++
      },
    })
    const stages = createDecisionStages()
    const owner = { deviceId: 'fixture', visitorSessionId: 'fixture-session' }
    const tools: WebMcpTool[] = runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'http://ordering.test' }))
    const traces: unknown[] = []
    const run = (transcript: string, route: string) => runFastPath({ isEnabled: async () => true, transcript, webMcp: { tools, execute: (tool, input) => {
      const definition = runtime.toolDefinitions.find(definition => definition.name === tool.name)
      if (!definition)
        throw new Error('Unregistered runtime tool')
      return runtime.invoke(definition.name, input)
    } }, onTrace: trace => traces.push(trace), decide: async (request) => {
      let result = await stages.start(owner, checkpoint => decideInteraction({ ...request, policy: { decisionInstruction: '', storeInstruction: '' }, invoke: checkpoint(async (_state, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map(question => [question, { choice: ({ requestPurpose: 'OPERATION', cartRequest: 'SINGLE' } as Record<string, string>)[question] ?? route, confidence: 0.99 }])) })) }))
      while (result.kind === 'DECISION_PROGRESS')
        result = await stages.next(owner, result.continuationId)
      return result
    } })
    const added = await run('我要兩份周氏蝦捲', 'intent:add-item')
    expect(added.kind, JSON.stringify(traces)).toBe('FAST_ACTION')
    const before = await runtime.invoke('cart_get', { display: false }) as { cart: { lines: Array<{ quantity: number }>, itemCount: number } }
    expect(before.cart.lines).toHaveLength(1)
    expect(before.cart.lines[0]?.quantity).toBe(2)
    expect((await run('繼續點餐', 'intent:return-menu')).kind).toBe('FAST_ACTION')
    expect(menuOpened).toBe(1)
    const after = await runtime.invoke('cart_get', { display: false }) as typeof before
    expect(after.cart).toEqual(before.cart)
    expect(traces).toContainEqual(expect.objectContaining({ executionResult: expect.objectContaining({ decisionTrace: expect.objectContaining({ authorize: { kind: 'EXECUTE' } }) }) }))
  })
})
