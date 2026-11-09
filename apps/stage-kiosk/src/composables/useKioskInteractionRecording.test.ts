import type { ConversationHandoff } from '@proj-airi/stage-shared/kiosk-conversation'

import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { rawTool } from '@xsai/tool'
import { array, object, parse, string } from 'valibot'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { menu } from '../../../order-menu/src/domain/order-machine'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { createMenuReplyWindow, replyFromConversation } from '../services/questionPresentation'
import { useKioskInteractionRecording } from './useKioskInteractionRecording'

const kioskApi = vi.hoisted(() => ({
  appendKioskInteraction: vi.fn(),
  endKioskVisitorSession: vi.fn(),
  fetchKioskSessionHistory: vi.fn(),
  recordKioskOrderResult: vi.fn(),
  sendKioskAssistantAction: vi.fn(),
  startKioskVisitorSession: vi.fn(),
  streamKioskConversationMessage: vi.fn(),
}))

vi.mock('../services/kiosk-device', () => kioskApi)

describe('useKioskInteractionRecording', () => {
  // Report: this chat, Nov2; legal siblings may execute; oversized counts must not be reduced or retried.
  it.each([false, true])('adds the legal sibling and explains oversized quantity (oversizedFirst=%s)', async (oversizedFirst) => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'quantity-limit', state: 'active' } })
    const execute = vi.fn(async (input: { quantity: number }) => input.quantity > 20 ? { ok: false, executed: false, rejection: 'quantity-limit', error: 'QUANTITY_LIMIT', toolName: 'order_add_item', requestedQuantity: input.quantity, maximum: 20, customerMessage: '每種餐點最多20份；超量未加入，原餐點保留。' } : { customerMessage: '已將排骨便當一份加入。' })
    const add = rawTool({ name: 'order_add_item', description: 'Add', parameters: { type: 'object', properties: { quantity: { type: 'integer', minimum: 1 } }, required: ['quantity'] }, execute })
    const quantities = oversizedFirst ? [200, 1] : [1, 200]
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: quantities.map((quantity, index) => ({ id: `quantity-${index}`, type: 'function', function: { name: 'order_add_item', arguments: JSON.stringify({ quantity }) } })) })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      const menuWindow = createMenuReplyWindow()
      const result = await recording.send('ordering', '招牌便當200份，排骨便當一份', [add], { onToolResult: (name, content) => menuWindow.record(name, content) })
      expect(result).toMatchObject({ status: 'completed', rejection: { error: 'QUANTITY_LIMIT', maximum: 20 } })
      expect(execute).toHaveBeenCalledTimes(2)
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(1)
      const reply = replyFromConversation(result!, { menu: menuWindow, failureMessage: '這次回覆尚未完成' })
      expect(reply.role).toBe('assistant')
      expect(reply.content).toContain('已將排骨便當一份加入')
      expect(reply.content).toContain('20')
      expect(reply.content).toContain('保留')
      expect(reply.content).not.toContain('尚未完成')
    }
    finally { scope.stop() }
  })

  // Report: this chat, 2026-11-02; queued browser metrics delayed phone-close presentation.
  it('saves customer turns without waiting for a stalled diagnostic write', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'diagnostic-latency', state: 'active' } })
    let releaseMetric = () => {}
    const metricSaved = new Promise<void>((resolve) => {
      releaseMetric = resolve
    })
    kioskApi.appendKioskInteraction.mockImplementation(async (entry) => {
      if (entry.metadata?.source === 'browser_tool_metrics')
        await metricSaved
      return { entry: { content: entry.content } }
    })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      await recording.start('ordering')
      const diagnostic = recording.append('service_event', '{"kind":"browser_tool_metrics"}', { source: 'browser_tool_metrics' })
      const user = recording.append('user_text', '關閉')
      const answer = recording.append('assistant_text', '已略過電話登記。')
      try {
        await vi.waitFor(() => expect(kioskApi.appendKioskInteraction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'assistant_text' })), { timeout: 100 })
        expect(kioskApi.appendKioskInteraction.mock.calls.map(([entry]) => entry.kind)).toEqual(['service_event', 'user_text', 'assistant_text'])
      }
      finally {
        releaseMetric()
        await Promise.all([diagnostic, user, answer])
      }
    }
    finally { scope.stop() }
  })

  // Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct30, seq200–227.
  it.each([false, true])('completes quantity changes after at most one unexecuted invalid proposal (legal=%s)', async (legal) => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'quantity-diagnosis', state: 'active' } })
    const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], category: '點心', price: 80, optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 3 })
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'quantity-diagnosis', transcript: '水餃三份改成兩份', expectedMenuRevision: parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context')).revisions.menu, constraints: {} })
    await runtime.invoke('kiosk_conversation_context')
    const cart = await runtime.invoke('cart_get', { display: false }) as { cart: { lines: Array<{ id: string }> } }
    const lineId = cart.cart.lines[0]!.id
    const definition = runtime.toolDefinitions.find(tool => tool.name === 'cart_set_line_quantity')!
    const execute = vi.fn(async (args: Record<string, unknown>) => runtime.invokeForAgent('cart_set_line_quantity', args))
    const tool = rawTool({ name: definition.name, description: definition.description, parameters: definition.inputSchema, execute })
    kioskApi.streamKioskConversationMessage
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'quantity', type: 'function', function: { name: legal ? 'cart_set_line_quantity' : 'cart_update_item', arguments: JSON.stringify(legal ? { lineId, quantity: 2 } : { lineId }) } }] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: legal ? [] : [{ id: 'corrected-quantity', type: 'function', function: { name: 'cart_set_line_quantity', arguments: JSON.stringify({ lineId, quantity: 2 }) } }] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [] })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      const result = await recording.send('ordering', '水餃三份改成兩份', [tool])
      if (legal) {
        expect(result?.status).toBe('completed')
        expect(execute).toHaveBeenCalledOnce()
        expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2 } })
      }
      else {
        expect(result).toMatchObject({ status: 'completed', requestedTools: ['cart_set_line_quantity'] })
        expect(execute).toHaveBeenCalledOnce()
        expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(3)
        expect(kioskApi.streamKioskConversationMessage.mock.calls[1]![0].toolResults).toMatchObject([{ name: 'cart_update_item', toolCallId: 'quantity', content: expect.stringContaining('UNKNOWN_TOOL') }])
        expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2 } })
      }
    }
    finally { scope.stop() }
  })

  // Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct30.
  it('stops after a second unknown proposal without executing either batch', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'bounded-tool-repair', state: 'active' } })
    const execute = vi.fn(async () => ({ ok: true }))
    const tool = rawTool({ name: 'order_add_item', description: 'Add', parameters: { type: 'object', properties: {} }, execute })
    kioskApi.streamKioskConversationMessage
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'bad-1', type: 'function', function: { name: 'unknown', arguments: '{}' } }] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'bad-2', type: 'function', function: { name: 'unknown-again', arguments: '{}' } }] })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '加一份', [tool])).toMatchObject({ status: 'incomplete', reason: 'tool-rejected', requestedTools: ['unknown-again'] })
      expect(kioskApi.appendKioskInteraction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tool_result', content: expect.stringContaining('TOOL_NOT_AVAILABLE'), metadata: expect.objectContaining({ name: 'unknown-again' }) }))
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(2)
      expect(execute).not.toHaveBeenCalled()
    }
    finally { scope.stop() }
  })

  it('does not execute a valid sibling before correcting an unknown tool in the same batch', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'atomic-proposal', state: 'active' } })
    const execute = vi.fn(async () => ({ ok: true, customerMessage: '已加入。' }))
    const tool = rawTool({ name: 'order_add_item', description: 'Add', parameters: { type: 'object', properties: {} }, execute })
    kioskApi.streamKioskConversationMessage
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'valid-sibling', type: 'function', function: { name: 'order_add_item', arguments: '{}' } }, { id: 'unknown-sibling', type: 'function', function: { name: 'unknown', arguments: '{}' } }] })
      .mockImplementationOnce(async ({ toolResults }) => {
        expect(execute).not.toHaveBeenCalled()
        expect(toolResults).toMatchObject([{ toolCallId: 'valid-sibling', content: expect.stringContaining('BATCH_NOT_EXECUTED') }, { toolCallId: 'unknown-sibling', content: expect.stringContaining('UNKNOWN_TOOL') }])
        return { agentMode: 'active', toolCalls: [{ id: 'corrected', type: 'function', function: { name: 'order_add_item', arguments: '{}' } }] }
      })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [] })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '加一份', [tool])).toMatchObject({ status: 'completed', requestedTools: ['order_add_item'] })
      expect(execute).toHaveBeenCalledOnce()
    }
    finally { scope.stop() }
  })

  // Report: this chat, 2026-10-26; XCUxZDdu entries236–365 contain 44 zero-round tasks.
  it('reports missing Menu context separately before any model request', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'missing-menu-context', state: 'active' } })
    const prepareRound = vi.fn(async () => {
      throw new Error('Current Menu context is unavailable.')
    })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      for (const content of ['請介紹菜單', '還能繼續嗎']) {
        const result = await recording.send('ordering', content, [], { prepareRound })
        expect(result).toMatchObject({ status: 'failed', reason: 'context-unavailable', requestedTools: [] })
        expect(recording.controlState.value).toBe('idle')
      }
      expect(prepareRound).toHaveBeenCalledTimes(2)
      expect(kioskApi.streamKioskConversationMessage).not.toHaveBeenCalled()
      const metrics = kioskApi.appendKioskInteraction.mock.calls
        .filter(([entry]) => entry.metadata?.source === 'main_task_metrics')
        .map(([entry]) => JSON.parse(entry.content))
      expect(metrics).toHaveLength(2)
      expect(metrics[0]).toMatchObject({ modelRounds: 0, requestedToolCount: 0, interrupted: false, failureStage: 'context', reason: 'context-unavailable' })
      expect(metrics[1]).toMatchObject({ modelRounds: 0, requestedToolCount: 0, interrupted: false })
    }
    finally { scope.stop() }
  })

  it('stops offering exhausted history instead of spending every model round on before:0', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'empty-history', state: 'active' } })
    kioskApi.fetchKioskSessionHistory.mockResolvedValue({ entries: [], total: 1 })
    kioskApi.streamKioskConversationMessage
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'history-1', type: 'function', function: { name: 'kiosk_session_history', arguments: '{"before":0}' } }] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [], answer: '請問想查詢哪一道餐點？' })
    const recording = useKioskInteractionRecording()
    expect(await recording.send('ordering', '剛才呢', [])).toMatchObject({ status: 'completed' })
    expect(kioskApi.fetchKioskSessionHistory).toHaveBeenCalledTimes(1)
    expect(kioskApi.streamKioskConversationMessage.mock.lastCall![0].tools).toEqual([])
    expect(kioskApi.streamKioskConversationMessage.mock.lastCall![0].toolResults[0].content).toContain('"exhausted":true')
  })

  it('refreshes the context and offered tools before each Main round', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'fresh-context', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'read', type: 'function', function: { name: 'cart_get', arguments: '{}' } }] }).mockResolvedValueOnce({ agentMode: 'active', toolCalls: [], answer: '目前已進入發票步驟。' })
    const read = rawTool({ name: 'cart_get', description: 'Read', parameters: { type: 'object', properties: {} }, execute: async () => ({ cart: { lines: [], total: 0 } }) })
    const prepareRound = vi.fn().mockResolvedValueOnce({ decisionState: { phase: 'ordering' }, tools: [read] }).mockResolvedValueOnce({ decisionState: { phase: 'checkout_invoice' }, tools: [] })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '查看訂單', [read], { prepareRound })).toMatchObject({ status: 'completed' })
      expect(prepareRound).toHaveBeenCalledTimes(2)
      expect(kioskApi.streamKioskConversationMessage.mock.calls[0]![0]).toMatchObject({ decisionState: { phase: 'ordering' } })
      expect(kioskApi.streamKioskConversationMessage.mock.calls[1]![0]).toMatchObject({ decisionState: { phase: 'checkout_invoice' } })
      expect(kioskApi.streamKioskConversationMessage.mock.calls[1]![0].tools.map((tool: { function: { name: string } }) => tool.function.name)).not.toContain('cart_get')
      const timing = kioskApi.appendKioskInteraction.mock.calls.find(([entry]) => entry.metadata?.source === 'main_task_metrics')?.[0]
      expect(timing?.visitorSessionId).toBe('fresh-context')
      expect(JSON.parse(timing!.content)).toMatchObject({ kind: 'main_task_metrics', modelRounds: 2, requestedToolCount: 1, interrupted: false })
      expect(JSON.parse(timing!.content).durationMs).toBeGreaterThanOrEqual(0)
    }
    finally { scope.stop() }
  })
  it('uses the remaining turn budget instead of starting a fresh minute for Main', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'remaining-time', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockImplementation(async ({ signal }) => await new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Timed out')), { once: true })
      if (signal.aborted)
        reject(new Error('Already timed out'))
    }))
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      const startedAt = performance.now()
      expect(await recording.send('ordering', '請確認', [], { budgetMs: 20 })).toMatchObject({ status: 'failed', reason: 'timeout' })
      expect(performance.now() - startedAt).toBeLessThan(1000)
    }
    finally { scope.stop() }
  })
  // Report: this chat, session -_n4bX6MRFcoRGilxK9-_ entries14–21, 2026-10-19.
  it.each(['same-batch', 'continuation', 'broad-menu-get', 'catalog'] as const)('presents one recommendation batch per customer turn: %s', async (path) => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'recommendation-limit', state: 'active' } })
    const first = { id: 'recommend-first', type: 'function', function: { name: path === 'catalog' ? 'menu_get' : 'menu_recommend', arguments: path === 'catalog' ? '{"scope":"catalog"}' : '{}' } }
    const second = { id: 'recommend-more', type: 'function', function: { name: path === 'broad-menu-get' ? 'menu_get' : 'menu_recommend', arguments: path === 'broad-menu-get' ? '{}' : '{"more":true}' } }
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: path === 'same-batch' ? [first, second] : [first] })
    if (path !== 'same-batch')
      kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [second] })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [] })
    const execute = vi.fn(async () => ({ presentation: { kind: path === 'catalog' ? 'query-results' : 'recommendation', itemIds: ['a', 'b', 'c'] }, items: [{ id: 'a', name: '甲', price: 100 }, { id: 'b', name: '乙', price: 110 }, { id: 'c', name: '丙', price: 120 }], customerMessage: '推薦3 項：甲、乙、丙。' }))
    const tools = ['menu_recommend', 'menu_get'].map(name => rawTool({ name, description: name, parameters: { type: 'object', properties: {} }, execute }))
    const menu = createMenuReplyWindow()
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      const onToolResult = vi.fn((name, content) => menu.record(name, content))
      const result = await recording.send('ordering', '推薦幾個餐點', tools, { onToolResult })
      expect(result?.status).toBe('completed')
      expect(execute).toHaveBeenCalledTimes(1)
      expect(onToolResult).toHaveBeenCalledTimes(1)
      expect(menu.reply()).toBe('推薦3 項：甲、乙、丙。')
      expect(kioskApi.streamKioskConversationMessage.mock.calls[1]![0].tools.map((tool: { function: { name: string } }) => tool.function.name)).not.toContain('menu_recommend')
      expect(kioskApi.streamKioskConversationMessage.mock.lastCall![0].toolResults).toContainEqual(expect.objectContaining({ name: second.function.name, content: expect.stringContaining('recommendationAlreadyPresented') }))
      kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ ...first, id: 'new-customer-more', function: { name: 'menu_recommend', arguments: '{"more":true}' } }] }).mockResolvedValueOnce({ agentMode: 'active', toolCalls: [] })
      expect(await recording.send('ordering', '還有別的嗎', tools)).toMatchObject({ status: 'completed' })
      expect(execute).toHaveBeenCalledTimes(2)
    }
    finally { scope.stop() }
  })

  it('keeps internal evidence, named comparisons and accepted order operations available after a recommendation', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'recommend-and-order', state: 'active' } })
    const recommend = vi.fn(async () => ({ presentation: { kind: 'recommendation', itemIds: ['a'] }, items: [{ id: 'a', name: '甲', price: 100 }], customerMessage: '推薦一項：甲。' }))
    const query = vi.fn(async () => ({ dataOnly: true, items: [{ id: 'b', name: '乙', price: 120 }] }))
    const add = vi.fn(async () => ({ ok: true, customerMessage: '已加入乙。' }))
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [
      { id: 'recommend', type: 'function', function: { name: 'menu_recommend', arguments: '{}' } },
      ...[{ display: false }, { query: '乙' }, { queries: ['乙'] }, { category: '主食' }].map((args, index) => ({ id: `query-${index}`, type: 'function', function: { name: 'menu_get', arguments: JSON.stringify(args) } })),
      { id: 'add', type: 'function', function: { name: 'order_add_item', arguments: '{}' } },
    ] }).mockResolvedValueOnce({ agentMode: 'active', toolCalls: [] })
    const tools = [{ name: 'menu_recommend', execute: recommend }, { name: 'menu_get', execute: query }, { name: 'order_add_item', execute: add }].map(tool => rawTool({ ...tool, description: tool.name, parameters: { type: 'object', properties: {} } }))
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '推薦一個餐點，另外查乙並加一份', tools)).toMatchObject({ status: 'completed' })
      expect(recommend).toHaveBeenCalledTimes(1)
      expect(query).toHaveBeenCalledTimes(4)
      expect(add).toHaveBeenCalledTimes(1)
    }
    finally { scope.stop() }
  })

  it('carries inquiry authority through tool continuations without applying it to the next customer request', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'inquiry', state: 'active' } })
    kioskApi.streamKioskConversationMessage
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'query-1', type: 'function', function: { name: 'menu_get', arguments: '{}' } }] })
      .mockResolvedValue({ agentMode: 'active', answer: '水餃目前可以點。', toolCalls: [] })
    const tool = rawTool({ name: 'menu_get', description: 'Menu', parameters: { type: 'object', properties: {} }, execute: async () => ({ items: [{ id: 'dumplings', name: '水餃' }] }) })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      const decisionState = { phase: 'ordering', requireMenuRead: true, readOnly: true }
      await recording.send('ordering', '有水餃嗎？', [tool], { decisionState })
      expect(kioskApi.streamKioskConversationMessage.mock.calls[0]![0]).toMatchObject({ decisionState })
      expect(kioskApi.streamKioskConversationMessage.mock.calls[1]![0]).toMatchObject({ decisionState, toolResults: [{ name: 'menu_get' }] })
      await recording.send('ordering', '我要水餃一份', [tool], { decisionState: { phase: 'ordering' } })
      expect(kioskApi.streamKioskConversationMessage.mock.calls[2]![0]).toMatchObject({ decisionState: { phase: 'ordering' } })
      expect(kioskApi.streamKioskConversationMessage.mock.calls[2]![0].decisionState).not.toHaveProperty('readOnly')
    }
    finally { scope.stop() }
  })

  it('publishes a scope question without a second model continuation', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'scope-question', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'scope-read', type: 'function', function: { name: 'menu_get', arguments: '{}' } }] })
    const tool = rawTool({ name: 'menu_get', description: 'Menu', parameters: { type: 'object', properties: {} }, execute: async () => ({ pendingCustomerChoice: { purpose: 'menu-query-scope', questionId: 'scope-1', question: '請選擇範圍', expiresAt: Date.now() + 30000, choices: [] } }) })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '120以下有什麼', [tool])).toMatchObject({ status: 'waiting' })
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(1)
      expect(kioskApi.appendKioskInteraction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tool_result', metadata: expect.objectContaining({ name: 'menu_get' }) }))
    }
    finally { scope.stop() }
  })

  it('waits for missing meal slots without executing later batch calls or another model round', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'wait-for-slots', state: 'active' } })
    const question = { questionId: 'quantity-ticket', requestId: 'meal-draft', purpose: 'item-configuration', question: '水餃要幾份？', expiresAt: Date.now() + 30000, choices: [] }
    const add = rawTool({ name: 'order_add_item', description: 'Add', parameters: { type: 'object', properties: {} }, execute: async () => ({ customerMessage: question.question, pendingCustomerChoice: question }) })
    const executeCheckout = vi.fn(async () => ({ customerMessage: '已進入結帳。' }))
    const checkout = rawTool({ name: 'checkout_start', description: 'Checkout', parameters: { type: 'object', properties: {} }, execute: executeCheckout })
    kioskApi.streamKioskConversationMessage
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [
        { id: 'missing-quantity', type: 'function', function: { name: 'order_add_item', arguments: '{}' } },
        { id: 'too-early', type: 'function', function: { name: 'checkout_start', arguments: '{}' } },
      ] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [], answer: '全部完成了。' })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '點水餃，接著結帳', [add, checkout])).toMatchObject({ status: 'waiting', question, requestedTools: ['order_add_item'], deferredTools: ['checkout_start'] })
      expect(executeCheckout).not.toHaveBeenCalled()
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(1)
      expect(kioskApi.appendKioskInteraction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tool_result', content: expect.stringContaining('AWAITING_CUSTOMER_CHOICE') }))
    }
    finally { scope.stop() }
  })

  // Report: live112 C13-A2, attempt723; after opening checkout Main
  // answered new invoice/payment questions itself within the same tool loop.
  it.each([
    // Report: Nov2 navigation acceptance; Main continued after proposing a mode change.
    { purpose: 'operation-confirmation', name: 'order_set_fulfillment' },
    { purpose: 'membership', name: 'checkout_start' },
    { purpose: 'invoice', name: 'checkout_start' },
    { purpose: 'tax-id', name: 'checkout_request_tax_id' },
    { purpose: 'payment-method', name: 'checkout_choose_invoice' },
  ])('waits for a new checkout $purpose choice before later effects', async ({ purpose, name }) => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'checkout-choice', state: 'active' } })
    const question = { questionId: 'checkout-ticket', purpose, question: '請選擇下一步', expiresAt: Date.now() + 30000, choices: [] }
    const first = rawTool({ name, description: name, parameters: { type: 'object', properties: {} }, execute: async () => ({ pendingCustomerChoice: question }) })
    const executePayment = vi.fn(async () => ({ customerMessage: '已付款。' }))
    const payment = rawTool({ name: 'checkout_select_payment', description: 'Payment', parameters: { type: 'object', properties: {} }, execute: executePayment })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [
      { id: 'checkout-choice', type: 'function', function: { name, arguments: '{}' } },
      { id: 'unanswered-payment', type: 'function', function: { name: 'checkout_select_payment', arguments: '{}' } },
    ] }).mockResolvedValueOnce({ agentMode: 'active', toolCalls: [], answer: '已完成。' })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '進入結帳', [first, payment])).toMatchObject({ status: 'waiting', question, requestedTools: [name], deferredTools: ['checkout_select_payment'] })
      expect(executePayment).not.toHaveBeenCalled()
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(1)
    }
    finally { scope.stop() }
  })

  // Report: live112 M01; a complete two-item batch continued into an unrelated edit.
  it('does not let an ordinary fulfillment question truncate same-batch additions', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'batch-follow-up', state: 'active' } })
    const runtime = createMenuToolRuntime({ menu: [
      { ...menu[0]!, id: 'first', name: '第一餐', aliases: [], optionGroups: [] },
      { ...menu[0]!, id: 'second', name: '第二餐', aliases: [], optionGroups: [] },
    ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const definition = runtime.toolDefinitions.find(tool => tool.name === 'order_add_item')!
    const tool = rawTool({ name: definition.name, description: definition.description, parameters: definition.inputSchema, execute: async (args: Record<string, unknown>) => runtime.invoke('order_add_item', args) })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: ['first', 'second'].map(itemId => ({ id: itemId, type: 'function', function: { name: 'order_add_item', arguments: JSON.stringify({ itemId, quantity: 1 }) } })) }).mockResolvedValueOnce({ agentMode: 'active', toolCalls: [], answer: '兩個餐點已加入。' })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '第一餐與第二餐各一份', [tool])).toMatchObject({ status: 'completed', requestedTools: ['order_add_item', 'order_add_item'] })
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2 } })
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(2)
    }
    finally { scope.stop() }
  })

  // Report: frozen live112 M01, attempt762; a four-round ceiling stopped
  // before the second known meal after independent per-item evidence reads.
  it('scales bounded rounds for issued targets without truncating the remaining meal', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'multi-round', state: 'active' } })
    const runtime = createMenuToolRuntime({ menu: [
      { ...menu[0]!, id: 'first', name: '第一餐', aliases: [], optionGroups: [] },
      { ...menu[0]!, id: 'second', name: '第二餐', aliases: [], optionGroups: [] },
    ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const handoff: ConversationHandoff = { intent: 'ADD_ITEM', status: 'unmatched', itemIds: ['first', 'second'], lineIds: [] }
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'multi-round', transcript: '第一餐與第二餐各一份', expectedMenuRevision: 0, constraints: {}, handoff })
    const calls = [
      { name: 'menu_get', args: { query: '第一餐', display: false } },
      { name: 'menu_get', args: { query: '第二餐', display: false } },
      { name: 'menu_select_item', args: { itemId: 'first' } },
      { name: 'cart_add_item', args: {} },
      { name: 'order_add_item', args: { itemId: 'second', quantity: 1 } },
    ] as const
    const tools = [...new Set(calls.map(call => call.name))].map((name) => {
      const definition = runtime.toolDefinitions.find(tool => tool.name === name)!
      return rawTool({ name, description: definition.description, parameters: definition.inputSchema, execute: (args: Record<string, unknown>) => runtime.invokeForAgent(name, args) })
    })
    for (const [index, call] of calls.entries())
      kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: `step-${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [], answer: '兩道餐點已加入。' })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '第一餐與第二餐各一份', tools, { decisionState: { phase: 'ordering', handoff } })).toMatchObject({ status: 'completed', requestedTools: calls.map(call => call.name) })
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { lines: [{ itemId: 'first', quantity: 1 }, { itemId: 'second', quantity: 1 }] } })
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(6)
    }
    finally { scope.stop() }
  })

  // Report: live112 M10: two spice values in one line were rejected before any effect.
  it.each(['corrected', 'repeated', 'after-write'] as const)('corrects only one proven unexecuted input, never an accepted write: %s', async (scenario) => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: `input-${scenario}`, state: 'active' } })
    const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'noodle', name: '牛肉麵', aliases: [], optionGroups: [{ id: 'spice', label: '辣度', required: true, values: [{ id: 'hot', label: '大辣', priceDelta: 0 }, { id: 'mild', label: '小辣', priceDelta: 0 }] }] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const definition = runtime.toolDefinitions.find(tool => tool.name === 'order_add_item')!
    const tool = rawTool({ name: definition.name, description: definition.description, parameters: definition.inputSchema, execute: async (args: Record<string, unknown>) => runtime.invokeForAgent('order_add_item', args) })
    const call = (id: string, values: string[]) => ({ id, type: 'function' as const, function: { name: 'order_add_item', arguments: JSON.stringify({ itemId: 'noodle', quantity: values.length === 2 ? 2 : 1, options: values.map(valueId => ({ groupId: 'spice', valueId })) }) } })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [...(scenario === 'after-write' ? [call('accepted', ['hot'])] : []), call('bad', ['hot', 'mild'])] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: scenario === 'repeated' ? [call('bad-again', ['hot', 'mild'])] : [call('hot', ['hot']), call('mild', ['mild'])] })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [], answer: '兩種規格各一份已加入。' })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      const onToolRejected = vi.fn()
      const result = await recording.send('ordering', '牛肉麵一份大辣、一份小辣', [tool], { onToolRejected })
      expect(onToolRejected).toHaveBeenCalledWith('order_add_item', true)
      const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
      if (scenario === 'corrected') {
        expect(result?.status).toBe('completed')
        expect(context.cart.itemCount).toBe(2)
        expect(context.cart.lines.map(line => line.options[0]?.valueId).sort()).toEqual(['hot', 'mild'])
      }
      else {
        expect(result?.status).toBe('incomplete')
        expect(context.cart.itemCount).toBe(scenario === 'after-write' ? 1 : 0)
      }
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(scenario === 'after-write' ? 1 : scenario === 'corrected' ? 3 : 2)
    }
    finally { scope.stop() }
  })

  it('aborts model thinking on manual takeover without dispatching a late tool', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'thinking', state: 'active' } })
    let started!: () => void
    const thinking = new Promise<void>(resolve => started = resolve)
    kioskApi.streamKioskConversationMessage.mockImplementationOnce(({ signal }) => {
      started()
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
    })
    const recording = useKioskInteractionRecording()
    const pending = recording.send('ordering', '幫我點餐', [])
    await thinking
    recording.requestManualControl()
    expect((await pending)?.reason).toBe('manual-control')
    expect(recording.controlState.value).toBe('idle')
    expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(1)
  })
  // Report: this chat, 2026-10-14 — switch to manual while a cart write is pending.
  it('waits for the accepted tool receipt and stops the rest of the batch on manual takeover', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'manual', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValue({ agentMode: 'active', toolCalls: [
      { id: 'one', type: 'function', function: { name: 'cart_add_item', arguments: '{}' } },
      { id: 'two', type: 'function', function: { name: 'cart_add_item', arguments: '{}' } },
    ] })
    let settle!: (value: object) => void
    let started!: () => void
    const executing = new Promise<void>(resolve => started = resolve)
    const execute = vi.fn(() => {
      started()
      return new Promise<object>(resolve => settle = resolve)
    })
    const tool = rawTool({ name: 'cart_add_item', description: 'Add', parameters: { type: 'object', properties: {} }, execute })
    const recording = useKioskInteractionRecording()
    kioskApi.appendKioskInteraction.mockResolvedValue({ entry: { id: 'receipt' } })
    const receipt = vi.fn()
    const pending = recording.send('ordering', '加兩種餐點', [tool], { onToolResult: receipt })
    await executing
    recording.requestManualControl()
    expect(recording.controlState.value).toBe('releasing')
    expect(receipt).not.toHaveBeenCalled()
    settle({ ok: true, customerMessage: '已加入一份水餃。' })
    const result = await pending
    expect(result?.reason).toBe('manual-control')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(receipt).toHaveBeenCalledTimes(1)
    expect(kioskApi.appendKioskInteraction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tool_result', metadata: { name: 'cart_add_item', source: 'manual_control' } }))
    expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(1)
    expect(recording.controlState.value).toBe('idle')
  })
  // Report: this chat, 2026-10-14 — 「嗨」 cannot reply with Fast Path disabled.
  it.each([undefined, { phase: 'ordering' as const }])('allows no-tool prose only for an explicitly classified service reply: %j', async (decisionState) => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-greeting', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValue({ agentMode: 'active', answer: '您好！需要什麼協助？', toolCalls: [] })
    const execute = vi.fn()
    const tool = rawTool({ name: 'menu_get', description: 'Menu', parameters: { type: 'object', properties: {} }, execute })
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())!
    try {
      const result = await recording.send('restaurant-ordering', '嗨', [tool], { decisionState })
      expect(result?.status).toBe('completed')
      expect(execute).not.toHaveBeenCalled()
      expect(replyFromConversation(result!, { menu: createMenuReplyWindow(), serviceReply: true, failureMessage: '失敗' })).toEqual({ role: 'assistant', content: '您好！需要什麼協助？' })
      expect(kioskApi.streamKioskConversationMessage.mock.calls[0][0].content).toBe('嗨')
      expect(kioskApi.streamKioskConversationMessage.mock.calls[0][0].decisionState).toEqual(decisionState)
    }
    finally { scope.stop() }
  })

  it('reports a provider failure before any tool execution as failed, not incomplete', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-failure', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockRejectedValue(new Error('upstream unavailable'))
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())!
    try {
      const result = await recording.send('restaurant-ordering', '嗨', [])
      expect(result?.status).toBe('failed')
      expect(result?.reason).toBe('provider-error')
      expect(replyFromConversation(result!, { menu: createMenuReplyWindow(), failureMessage: '模型連線失敗，請稍後再試。' })).toEqual({ role: 'error', content: '模型連線失敗，請稍後再試。' })
    }
    finally { scope.stop() }
  })

  it('retains successful reads when the model continuation fails without claiming a cart change', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-partial', state: 'active' } })
    kioskApi.streamKioskConversationMessage
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'read-1', type: 'function', function: { name: 'menu_get', arguments: '{}' } }] })
      .mockRejectedValueOnce(new Error('connection lost'))
    const menu = createMenuReplyWindow()
    const tool = rawTool({ name: 'menu_get', description: 'Menu', parameters: { type: 'object', properties: {} }, execute: async () => ({ customerMessage: '找到水餃。', items: [{ id: 'dumplings', name: '水餃', price: 80 }] }) })
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())!
    try {
      const result = await recording.send('restaurant-ordering', '我要水餃', [tool], { onToolResult: (name, content) => menu.record(name, content) })
      expect(result?.status).toBe('incomplete')
      expect(result?.reason).toBe('provider-error')
      expect(result?.requestedTools).toEqual(['menu_get'])
      expect(replyFromConversation(result!, { menu, failureMessage: '模型連線失敗。' })).toEqual({ role: 'assistant', content: '找到水餃。 模型連線失敗。' })
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(2)
    }
    finally { scope.stop() }
  })

  it('preserves a tool-owned quantity question over the model final answer', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-question', state: 'active' } })
    kioskApi.streamKioskConversationMessage
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'add-1', type: 'function', function: { name: 'order_add_item', arguments: '{}' } }] })
      .mockResolvedValueOnce({ agentMode: 'active', answer: '已加入兩份。', toolCalls: [] })
    const question = { questionId: 'quantity-1', purpose: 'quantity', question: '需要幾份水餃？', expiresAt: Date.now() + 30000, choices: [] }
    const tool = rawTool({ name: 'order_add_item', description: 'Add', parameters: { type: 'object', properties: {} }, execute: async () => ({ pendingCustomerChoice: question }) })
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())!
    try {
      const result = await recording.send('restaurant-ordering', '我要水餃', [tool])
      expect(replyFromConversation(result!, { menu: createMenuReplyWindow(), question, failureMessage: '失敗。' })).toEqual({ role: 'assistant', content: '需要幾份水餃？' })
    }
    finally { scope.stop() }
  })

  it('retains an accepted cart edit receipt over invented model completion prose', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-edit', state: 'active' } })
    kioskApi.streamKioskConversationMessage
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'edit-1', type: 'function', function: { name: 'cart_set_line_quantity', arguments: '{}' } }] })
      .mockResolvedValueOnce({ agentMode: 'active', answer: '已付款成功。', toolCalls: [] })
    const execute = vi.fn(async () => ({ customerMessage: '水餃已改成兩份。' }))
    const tool = rawTool({ name: 'cart_set_line_quantity', description: 'Edit', parameters: { type: 'object', properties: {} }, execute })
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())!
    try {
      const result = await recording.send('restaurant-ordering', '改兩份', [tool])
      expect(replyFromConversation(result!, { menu: createMenuReplyWindow(), outcome: '水餃已改成兩份。', failureMessage: '失敗。' })).toEqual({ role: 'assistant', content: '水餃已改成兩份。' })
      expect(execute).toHaveBeenCalledOnce()
    }
    finally { scope.stop() }
  })

  it('reports a server timeout before tools distinctly', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-timeout', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockImplementation(async (_input, onEvent) => {
      onEvent({ type: 'turn-failed', reason: 'timeout', message: 'model timeout' })
      throw new Error('model timeout')
    })
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())!
    try {
      expect(await recording.send('restaurant-ordering', '嗨', [])).toMatchObject({ status: 'failed', reason: 'timeout', requestedTools: [] })
    }
    finally { scope.stop() }
  })

  it('records a rejected tool but does not claim success or execute its requested retry', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-1', state: 'active' } })
    const calls = [{ id: 'clear-1', type: 'function', function: { name: 'cart_clear', arguments: '{}' } }]
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', answer: '', toolCalls: calls }).mockResolvedValueOnce({ agentMode: 'active', answer: '已完成', toolCalls: [{ ...calls[0], id: 'clear-2' }] })
    const execute = vi.fn(async () => ({ ok: false, error: 'STALE_PLAN' }))
    const tool = rawTool({ name: 'cart_clear', description: 'Clear', parameters: { type: 'object', properties: {} }, execute })
    const onToolResult = vi.fn()
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())!
    expect(await recording.send('restaurant-ordering', '清空', [tool], { onToolResult })).toMatchObject({ status: 'incomplete', answer: undefined })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(onToolResult).not.toHaveBeenCalled()
    expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledOnce()
    expect(kioskApi.appendKioskInteraction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tool_result', content: expect.stringContaining('STALE_PLAN') }))
    scope.stop()
  })

  // Report: attachment a553fda2; the stored menu_get request followed a rejected phone skip and never executed.
  it('reports the rejected stale phone operation instead of executing the subsequent hotpot lookup', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'hotpot-rejection', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'skip', type: 'function', function: { name: 'customer_skip_phone', arguments: '{}' } }] }).mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'hotpot', type: 'function', function: { name: 'menu_get', arguments: '{"query":"大腸臭臭鍋"}' } }] })
    const skip = vi.fn(async () => ({ ok: false, error: 'INVALID_PHASE' }))
    const lookup = vi.fn(async () => ({ items: [] }))
    const tools = [rawTool({ name: 'customer_skip_phone', description: 'Skip', parameters: { type: 'object', properties: {} }, execute: skip }), rawTool({ name: 'menu_get', description: 'Lookup', parameters: { type: 'object', properties: { query: { type: 'string' } } }, execute: lookup })]
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '大腸臭臭鍋一份', tools)).toMatchObject({ status: 'incomplete', reason: 'tool-rejected', requestedTools: ['customer_skip_phone'] })
      expect(skip).toHaveBeenCalledOnce()
      expect(lookup).not.toHaveBeenCalled()
    }
    finally { scope.stop() }
  })
  it('stops a bounded Agent task without claiming its unexecuted fifth round is complete', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-1', state: 'active' } })
    let call = 0
    kioskApi.streamKioskConversationMessage.mockImplementation(async () => ({ agentMode: 'active', answer: '已全部完成', toolCalls: [{ id: `read-${++call}`, type: 'function', function: { name: 'menu_get', arguments: '{}' } }] }))
    const execute = vi.fn(async () => ({ customerMessage: '有水餃' }))
    const tool = rawTool({ name: 'menu_get', description: 'Read menu', parameters: { type: 'object', properties: {} }, execute })
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())!
    expect(await recording.send('restaurant-ordering', '幫我查詢', [tool])).toMatchObject({ status: 'incomplete', answer: undefined })
    expect(execute).toHaveBeenCalledTimes(4)
    scope.stop()
  })
  // Rejected tools can stop before a queued continuation; do not leak its
  // unused provider response into the following independent customer test.
  afterEach(() => vi.resetAllMocks())

  // Report: this chat Nov8 reliability audit — restart while session creation/closure is in flight.
  it('does not resurrect a session whose creation finishes after a reset', async () => {
    let finish!: (value: { session: { id: string } }) => void
    kioskApi.startKioskVisitorSession.mockImplementationOnce(() => new Promise(resolve => finish = resolve)).mockResolvedValueOnce({ session: { id: 'new-visitor' } })
    kioskApi.endKioskVisitorSession.mockResolvedValue({})
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())!
    try {
      const oldStart = recording.start('ordering')
      await recording.end('idle')
      finish({ session: { id: 'old-visitor' } })
      await expect(oldStart).resolves.toBeUndefined()
      expect(recording.visitorSessionId.value).toBeUndefined()
      await expect(recording.start('ordering')).resolves.toBe('new-visitor')
      expect(recording.visitorSessionId.value).toBe('new-visitor')
      expect(kioskApi.endKioskVisitorSession).toHaveBeenCalledWith({ visitorSessionId: 'old-visitor', state: 'cancelled' })
    }
    finally { scope.stop() }
  })

  it('does not reuse a closing session or clear its replacement when the old end arrives late', async () => {
    let finish!: () => void
    kioskApi.startKioskVisitorSession.mockResolvedValueOnce({ session: { id: 'old-visitor' } }).mockResolvedValueOnce({ session: { id: 'new-visitor' } })
    kioskApi.endKioskVisitorSession.mockImplementationOnce(() => new Promise<void>(resolve => finish = resolve))
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())!
    try {
      await recording.start('ordering')
      const ending = recording.end('idle')
      await expect(recording.start('ordering')).resolves.toBe('new-visitor')
      finish()
      await ending
      expect(recording.visitorSessionId.value).toBe('new-visitor')
    }
    finally { scope.stop() }
  })

  it('retires a possibly ended session when its end receipt is lost', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValueOnce({ session: { id: 'old-visitor' } }).mockResolvedValueOnce({ session: { id: 'new-visitor' } })
    kioskApi.endKioskVisitorSession.mockRejectedValue(new Error('Lost end receipt'))
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())!
    try {
      await recording.start('ordering')
      await recording.end('idle')
      expect(recording.visitorSessionId.value).toBeUndefined()
      await expect(recording.start('ordering')).resolves.toBe('new-visitor')
    }
    finally { scope.stop() }
  })

  it('does not let a retired visitor receipt queue block the next visitor', async () => {
    let finish!: () => void
    kioskApi.startKioskVisitorSession.mockResolvedValueOnce({ session: { id: 'old-visitor' } }).mockResolvedValueOnce({ session: { id: 'new-visitor' } })
    kioskApi.appendKioskInteraction.mockImplementationOnce(() => new Promise<void>(resolve => finish = resolve)).mockResolvedValue({})
    kioskApi.endKioskVisitorSession.mockResolvedValue({})
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())!
    try {
      await recording.start('ordering')
      const oldReceipt = recording.append('assistant_text', '舊回覆')
      await vi.waitFor(() => expect(kioskApi.appendKioskInteraction).toHaveBeenCalledOnce())
      await recording.end('idle')
      await recording.start('ordering')
      const newReceipt = recording.append('assistant_text', '新回覆')
      try {
        await vi.waitFor(() => expect(kioskApi.appendKioskInteraction).toHaveBeenCalledWith(expect.objectContaining({ visitorSessionId: 'new-visitor', content: '新回覆' })), { timeout: 100 })
      }
      finally { finish() }
      await Promise.all([oldReceipt, newReceipt])
    }
    finally { scope.stop() }
  })

  it('creates one device session before saving ASR, proactive output, and its terminal state', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-1', state: 'active' } })
    kioskApi.appendKioskInteraction.mockResolvedValue({})
    kioskApi.sendKioskAssistantAction.mockResolvedValue({ answer: '您好，請問需要協助嗎？' })
    kioskApi.endKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-1', state: 'idle' } })
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())
    if (!recording)
      throw new Error('Expected interaction recording to initialize.')

    await recording.start('restaurant-ordering')
    await recording.append('asr_transcript', '我想要一份蝦捲。')
    await expect(recording.runAssistantAction('restaurant-ordering', 'greeting', 'data:image/jpeg;base64,ZmFrZQ==')).resolves.toEqual({ answer: '您好，請問需要協助嗎？' })
    await recording.end('idle')

    expect(kioskApi.startKioskVisitorSession).toHaveBeenCalledOnce()
    expect(kioskApi.appendKioskInteraction).toHaveBeenCalledWith({
      visitorSessionId: 'visitor-1',
      kind: 'asr_transcript',
      content: '我想要一份蝦捲。',
    })
    expect(kioskApi.sendKioskAssistantAction).toHaveBeenCalledWith({
      frame: 'data:image/jpeg;base64,ZmFrZQ==',
      visitorSessionId: 'visitor-1',
      kind: 'greeting',
      invitationAllowed: false,
    })
    expect(kioskApi.endKioskVisitorSession).toHaveBeenCalledWith({ visitorSessionId: 'visitor-1', state: 'idle' })
    expect(recording.visitorSessionId.value).toBeUndefined()
    scope.stop()
  })

  it('forwards the entry phase to VLM welcome generation without a recommendation invitation', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'vlm-entry', state: 'active' } })
    kioskApi.sendKioskAssistantAction.mockResolvedValue({ answer: '歡迎光臨！手機號碼可選填。' })
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())!
    await recording.runAssistantAction('restaurant-ordering', 'greeting', 'data:image/jpeg;base64,ZmFrZQ==', undefined, false, 'customer_entry')
    expect(kioskApi.sendKioskAssistantAction).toHaveBeenCalledWith({
      frame: 'data:image/jpeg;base64,ZmFrZQ==',
      kind: 'greeting',
      phase: 'customer_entry',
      invitationAllowed: false,
      visitorSessionId: 'vlm-entry',
    })
    scope.stop()
  })

  it('forwards cancellation when a visitor interrupts a proactive assistant action', async () => {
    const controller = new AbortController()
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-1', state: 'active' } })
    kioskApi.sendKioskAssistantAction.mockResolvedValue({ answer: '需要協助嗎？' })
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())
    if (!recording)
      throw new Error('Expected interaction recording to initialize.')

    await expect(recording.runAssistantAction('restaurant-ordering', 'reminder', 'data:image/jpeg;base64,ZmFrZQ==', controller.signal)).resolves.toEqual({ answer: '需要協助嗎？' })

    expect(kioskApi.sendKioskAssistantAction).toHaveBeenCalledWith({
      frame: 'data:image/jpeg;base64,ZmFrZQ==',
      visitorSessionId: 'visitor-1',
      kind: 'reminder',
      invitationAllowed: false,
      signal: controller.signal,
    })
    scope.stop()
  })

  it('forwards streamed assistant text to the presentation callback', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-1', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockImplementation(async (_input, onEvent) => {
      onEvent({ type: 'turn-started' })
      onEvent({ text: '牛肉', type: 'assistant-delta' })
      onEvent({ text: '麵可以點餐。', type: 'assistant-delta' })
      return { agentMode: 'active', answer: '牛肉麵可以點餐。', toolCalls: [], type: 'turn-finished' }
    })
    const onAssistantDelta = vi.fn()
    const onTurnStarted = vi.fn()
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())
    if (!recording)
      throw new Error('Expected interaction recording to initialize.')

    await expect(recording.send('restaurant-ordering', '我要牛肉麵', [], { onAssistantDelta, onTurnStarted })).resolves.toEqual({
      agentMode: 'active',
      answer: '牛肉麵可以點餐。',
      status: 'completed',
      requestedTools: [],
    })

    expect(onAssistantDelta).toHaveBeenNthCalledWith(1, '牛肉')
    expect(onAssistantDelta).toHaveBeenNthCalledWith(2, '麵可以點餐。')
    expect(onTurnStarted).toHaveBeenCalledOnce()
    expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledWith({
      content: '我要牛肉麵',
      signal: expect.any(AbortSignal),
      tools: [expect.objectContaining({ function: expect.objectContaining({ name: 'kiosk_session_history' }) })],
      visitorSessionId: 'visitor-1',
    }, expect.any(Function))
    scope.stop()
  })

  it('refreshes the payment phase after an actual tool round without replaying stale methods', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-1', state: 'active' } })
    kioskApi.streamKioskConversationMessage
      .mockResolvedValueOnce({ agentMode: 'active', answer: undefined, toolCalls: [{ id: 'call-1', type: 'function', function: { arguments: '{}', name: 'menu_get' } }] })
      .mockResolvedValueOnce({ agentMode: 'active', answer: '請選擇付款方式。', toolCalls: [] })
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())
    if (!recording)
      throw new Error('Expected interaction recording to initialize.')

    const decisionState = { phase: 'checkout_payment_select', paymentState: 'idle', allowedPaymentMethods: ['card', 'mobile'] as Array<'card' | 'mobile'> }
    // NOTICE: The previous fixture offered no menu_get tool, so it never reached
    // a continuation and its stale-state assertion passed without testing a round.
    const tool = rawTool({ name: 'menu_get', description: 'Read', parameters: { type: 'object', properties: {} }, execute: async () => ({ items: [] }) })
    const prepareRound = vi.fn().mockResolvedValueOnce({ decisionState, tools: [tool] }).mockResolvedValueOnce({ decisionState: { phase: 'checkout_invoice' }, tools: [] })
    await recording.send('restaurant-ordering', '信用卡', [tool], { decisionState, prepareRound })

    expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(2)
    expect(kioskApi.streamKioskConversationMessage.mock.calls[0]?.[0].decisionState).toEqual(decisionState)
    expect(kioskApi.streamKioskConversationMessage.mock.calls[1]?.[0].decisionState).toEqual({ phase: 'checkout_invoice' })
    scope.stop()
  })

  it('notifies the presentation as soon as the server selects a browser tool', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-1', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockImplementation(async (_input, onEvent) => {
      onEvent({
        type: 'tool-requested',
        toolCall: {
          id: 'call-menu-get',
          type: 'function',
          function: { arguments: '{"query":"炸物"}', name: 'menu_get' },
        },
      })
      return { agentMode: 'active', answer: undefined, toolCalls: [], type: 'turn-finished' }
    })
    const onToolRequested = vi.fn()
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())
    if (!recording)
      throw new Error('Expected interaction recording to initialize.')

    await recording.send('restaurant-ordering', '想吃炸物點心', [], { onToolRequested })

    expect(onToolRequested).toHaveBeenCalledWith('menu_get')
    scope.stop()
  })

  it('does not execute a browser tool delivered after a cancelled Agent turn', async () => {
    const controller = new AbortController()
    const execute = vi.fn(async () => ({ done: true }))
    const tool = rawTool({
      name: 'cart_add_item',
      description: 'Add item',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute,
    })
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-1', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockImplementation(async () => {
      controller.abort()
      return { agentMode: 'active', answer: undefined, toolCalls: [{ id: 'call-1', type: 'function', function: { arguments: '{}', name: 'cart_add_item' } }] }
    })
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())
    if (!recording)
      throw new Error('Expected interaction recording to initialize.')

    await expect(recording.send('restaurant-ordering', '我要水餃', [tool], { signal: controller.signal })).resolves.toBeUndefined()
    expect(execute).not.toHaveBeenCalled()
    scope.stop()
  })

  it('lets the Main Agent retrieve earlier text only from the current visitor session', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-1', state: 'active' } })
    kioskApi.fetchKioskSessionHistory.mockResolvedValue({ entries: [{ content: '最早說想吃水餃', index: 0, role: 'user' }], total: 60 })
    kioskApi.streamKioskConversationMessage
      .mockResolvedValueOnce({ agentMode: 'active', answer: undefined, toolCalls: [{ id: 'history-1', type: 'function', function: { arguments: '{}', name: 'kiosk_session_history' } }] })
      .mockResolvedValueOnce({ agentMode: 'active', answer: '你先前提過水餃。', toolCalls: [] })
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())
    if (!recording)
      throw new Error('Expected interaction recording to initialize.')

    await expect(recording.send('restaurant-ordering', '我最早說想吃什麼？', [])).resolves.toMatchObject({ answer: '你先前提過水餃。' })
    expect(kioskApi.fetchKioskSessionHistory).toHaveBeenCalledWith({ visitorSessionId: 'visitor-1' })
    expect(kioskApi.streamKioskConversationMessage.mock.calls[0]?.[0].tools).toEqual(expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: 'kiosk_session_history' }) })]))
    expect(kioskApi.streamKioskConversationMessage.mock.calls[1]?.[0].toolResults).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'kiosk_session_history', content: expect.stringContaining('最早說想吃水餃') })]))
    scope.stop()
  })
})

// Report: this chat, 2026-11-07, session yTDlWLScWAaHVqoxI1q9j.
it('presents a changed fish preference from the real Menu receipt after a rapid follow-up', async () => {
  kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'fish-follow-up', state: 'active' } })
  const runtime = createMenuToolRuntime({ menu: [
    { ...menu[0]!, id: 'fish', name: '魚便當', price: 100, composition: { ingredients: ['fish'], complete: true, source: 'merchant', revision: '1', removals: [] } },
    { ...menu[0]!, id: 'chicken', name: '雞便當', price: 100, composition: { ingredients: ['chicken'], complete: true, source: 'merchant', revision: '1', removals: [] } },
  ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: ['fish'] })
  kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [
    { id: 'exclude-fish', type: 'function', function: { name: 'menu_recommend', arguments: '{"action":"update","excludeIngredients":["fish"]}' } },
  ] }).mockResolvedValueOnce({ agentMode: 'active', toolCalls: [] })
  const tool = rawTool({ name: 'menu_recommend', description: 'Recommend', parameters: { type: 'object', properties: { action: { type: 'string' }, excludeIngredients: { type: 'array', items: { type: 'string' } } }, required: ['action'] }, execute: async input => await runtime.invokeForAgent('menu_recommend', parse(object({ action: string(), excludeIngredients: array(string()) }), input)) })
  const scope = effectScope()
  try {
    const recording = scope.run(() => useKioskInteractionRecording())!
    const receipts = createMenuReplyWindow()
    const result = await recording.send('ordering', '我不想吃魚了\n你還有推薦什麼？', [tool], { onToolResult: (name, content) => receipts.record(name, content) })
    expect(result?.status).toBe('completed')
    expect(receipts.reply()).toContain('雞便當')
    expect(receipts.reply()).not.toContain('魚便當')
    expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
    expect(kioskApi.streamKioskConversationMessage.mock.calls[0]![0].content).toBe('我不想吃魚了\n你還有推薦什麼？')
  }
  finally {
    scope.stop()
  }
})
