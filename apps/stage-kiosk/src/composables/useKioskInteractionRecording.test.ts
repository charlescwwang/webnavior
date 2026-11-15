import { browserToolResult } from '@proj-airi/stage-shared/browser-conversation'
import { rawTool } from '@xsai/tool'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { beginBrowserCartTask } from '../services/browserCartTask'
import { createBrowserDialogue } from '../services/browserDialogue'
import { createBrowserOrderingTools } from '../services/browserOrderingTools'
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
  // Report: this chat; a model's old tool name must be corrected before execution.
  it('returns an unavailable tool to Main for bounded correction instead of ending the customer request', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'repair-name', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'old-name', type: 'function', function: { name: 'browser_cart_get', arguments: '{}' } }] }).mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'question', type: 'function', function: { name: 'reply_to_customer', arguments: '{"replyType":"clarification"}' } }] })
    const execute = vi.fn(async () => ({ ok: true, source: 'browser', status: 'conversation', effect: 'none', customerMessage: '請問您想點哪一道餐點？' }))
    const tool = rawTool({ name: 'reply_to_customer', description: '', parameters: { type: 'object', properties: { replyType: { type: 'string' } }, required: ['replyType'] }, execute })
    const scope = effectScope()
    const onToolResult = vi.fn()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '幫我點餐', [tool], { onToolResult })).toMatchObject({ status: 'completed' })
      expect(execute).toHaveBeenCalledOnce()
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(2)
      expect(kioskApi.streamKioskConversationMessage.mock.calls[1][0]).toMatchObject({ toolResults: [{ name: 'browser_cart_get', content: expect.stringContaining('proposal_rejected') }] })
      expect(onToolResult).toHaveBeenCalledWith('reply_to_customer', expect.stringContaining('請問您想點哪一道餐點'))
    }
    finally { scope.stop() }
  })

  // Report: this chat, 2026-11-15 — malformed replacement counts stopped before any website operation.
  it.each(['none', 'unknown'] as const)('only repairs invalid cart arguments with a proven no-dispatch receipt (%s)', async (effect) => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'repair-cart-arguments', state: 'active' } })
    kioskApi.streamKioskConversationMessage
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'invalid-replace', type: 'function', function: { name: 'replace_item_in_cart', arguments: '{}' } }] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'correct-replace', type: 'function', function: { name: 'replace_item_in_cart', arguments: '{"replaceQuantity":2}' } }] })
    const execute = vi.fn()
      .mockResolvedValueOnce({ ok: false, source: 'browser', status: 'rejected', effect, dataOnly: true, code: 'INVALID_TOOL_ARGUMENTS', explanation: 'No website operation occurred.' })
      .mockResolvedValueOnce({ ok: true, source: 'browser', status: 'verified', effect: 'cart', customerMessage: '已更換兩份餐點。' })
    const tool = rawTool({ name: 'replace_item_in_cart', description: 'Replace', parameters: { type: 'object', properties: { replaceQuantity: { type: 'integer' } } }, execute })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      const result = await recording.send('ordering', '其中兩份換排骨便當', [tool], { isRequestComplete: () => execute.mock.calls.length === 2 })
      if (effect === 'none') {
        expect(result).toMatchObject({ status: 'completed' })
        expect(execute).toHaveBeenCalledTimes(2)
        expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(2)
        expect(kioskApi.streamKioskConversationMessage.mock.calls[1][0].toolResults[0].content).toContain('INVALID_TOOL_ARGUMENTS')
      }
      else {
        expect(result).toMatchObject({ status: 'incomplete', reason: 'tool-rejected' })
        expect(execute).toHaveBeenCalledTimes(1)
        expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(1)
      }
    }
    finally { scope.stop() }
  })

  // Report: this chat; a consumed count with remaining options is not a completed order.
  it('continues a prepared answer that still needs Main without recording the customer twice', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'prepared-main', state: 'active' } })
    kioskApi.appendKioskInteraction.mockResolvedValue({ entry: { id: 'customer-count' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValue({ agentMode: 'active', toolCalls: [] })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '兩份', [], { prepareQuestionAnswer: async () => async () => ({ ok: true, source: 'browser', selectedProduct: { name: '雞腿飯' }, requestedQuantity: 2, needsAssistant: true }) })).toMatchObject({ status: 'completed' })
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledOnce()
      expect(kioskApi.streamKioskConversationMessage.mock.calls[0][0]).not.toHaveProperty('content')
      expect(kioskApi.appendKioskInteraction.mock.calls.filter(([entry]) => entry.kind === 'user_text')).toHaveLength(1)
    }
    finally { scope.stop() }
  })

  // Master's execution principle: verified browser progress precedes the final model prose.
  it('executes and publishes a selected browser action before waiting for the model continuation', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'act-before-prose', state: 'active' } })
    let finish!: (value: { agentMode: string, toolCalls: never[] }) => void
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'show', type: 'function', function: { name: 'browser_present', arguments: '{}' } }] }).mockImplementationOnce(() => new Promise(resolve => finish = resolve))
    const execute = vi.fn(async () => ({ ok: true, source: 'browser', dataOnly: false, customerMessage: '已顯示餐點。' }))
    const tool = rawTool({ name: 'browser_present', description: '', parameters: { type: 'object', properties: {} }, execute })
    const onToolResult = vi.fn()
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      const pending = recording.send('ordering', '有什麼餐點？', [tool], { onToolResult })
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
      expect(execute).toHaveBeenCalledOnce()
      expect(onToolResult).toHaveBeenCalledOnce()
      finish({ agentMode: 'active', toolCalls: [] })
      expect(await pending).toMatchObject({ status: 'completed' })
    }
    finally { scope.stop() }
  })
  it('records a literal question answer before its Host operation and skips the model round', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'local-answer', state: 'active' } })
    kioskApi.appendKioskInteraction.mockResolvedValue({ entry: { id: 'user-answer' } })
    const events: string[] = []
    kioskApi.appendKioskInteraction.mockImplementation(async ({ kind }) => {
      events.push(kind)
      return { entry: { id: 'user-answer' } }
    })
    const receipt = { ok: true, source: 'browser', status: 'clarification', customerMessage: '請問乙餐要幾份？' }
    const execute = vi.fn(async () => {
      events.push('execute')
      return receipt
    })
    const scope = effectScope()
    const onToolResult = vi.fn()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '兩份', [], { prepareQuestionAnswer: async () => execute, onToolResult })).toMatchObject({ status: 'completed', requestedTools: ['browser_question_answer'] })
      expect(events.slice(0, 3)).toEqual(['user_text', 'execute', 'tool_result'])
      expect(kioskApi.streamKioskConversationMessage).not.toHaveBeenCalled()
      expect(onToolResult).toHaveBeenCalledWith('browser_question_answer', JSON.stringify(receipt))
    }
    finally { scope.stop() }
  })

  it('does not consume a prepared question when durable user recording fails', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'local-answer-failed', state: 'active' } })
    kioskApi.appendKioskInteraction.mockRejectedValue(new Error('offline'))
    const execute = vi.fn()
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '好', [], { prepareQuestionAnswer: async () => execute })).toMatchObject({ status: 'failed', reason: 'session-error' })
      expect(execute).not.toHaveBeenCalled()
      expect(kioskApi.streamKioskConversationMessage).not.toHaveBeenCalled()
    }
    finally { scope.stop() }
  })

  it('retains the settled Host receipt when manual control interrupts a local answer in flight', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'local-manual', state: 'active' } })
    kioskApi.appendKioskInteraction.mockResolvedValue({ entry: { id: 'user-answer' } })
    let finish!: (result: unknown) => void
    const scope = effectScope()
    const onToolResult = vi.fn()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      const pending = recording.send('ordering', '好', [], { prepareQuestionAnswer: async () => () => new Promise(resolve => finish = resolve), onToolResult })
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
      recording.requestManualControl()
      const receipt = { ok: true, source: 'browser', status: 'verified', customerMessage: '已加入甲餐。' }
      finish(receipt)
      expect(await pending).toMatchObject({ status: 'incomplete', reason: 'manual-control' })
      expect(onToolResult).toHaveBeenCalledWith('browser_question_answer', JSON.stringify(receipt))
      expect(kioskApi.streamKioskConversationMessage).not.toHaveBeenCalled()
    }
    finally { scope.stop() }
  })
  // Report: live PB flow comparison in this chat, Nov11; a Host quantity
  // question must end this turn rather than send the question back to Main.
  it('waits for the customer after the Host asks for a missing serving count', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'pb-quantity', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'quantity', type: 'function', function: { name: 'browser_ask_quantity', arguments: '{"productRef":"p-1"}' } }] })
    const payload = { ok: true, source: 'browser', status: 'clarification', effect: 'none', pendingCustomerChoice: { purpose: 'browser-order-quantity' }, customerMessage: '請問要幾份？' }
    const tool = rawTool({ name: 'browser_ask_quantity', description: 'Quantity', parameters: { type: 'object', properties: {} }, execute: async () => payload })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '我要乙餐', [tool])).toMatchObject({ status: 'completed' })
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(1)
    }
    finally { scope.stop() }
  })

  // Report: this chat, Nov14「我要點山」repeated the table question four times.
  it('ends after a table question without asking Main to call the same tool again', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'table-question' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValue({ agentMode: 'active', toolCalls: [{ id: 'table', type: 'function', function: { name: 'ask_customer_question', arguments: '{}' } }] })
    const payload = { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '目前預設櫃台取餐，要開始點餐嗎？', tableChoices: ['櫃台取餐', 'A1 桌'] }
    const execute = vi.fn(async () => payload)
    const tool = rawTool({ name: 'ask_customer_question', description: '', parameters: { type: 'object', properties: {} }, execute })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '我要點山', [tool])).toMatchObject({ status: 'completed' })
      expect(execute).toHaveBeenCalledOnce()
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledOnce()
    }
    finally { scope.stop() }
  })

  it('stops a parallel tool batch after a Host draft question instead of dispatching another operation', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'draft-question', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: ['browser_order_draft', 'browser_cart_remove'].map((name, i) => ({ id: `draft-${i}`, type: 'function', function: { name, arguments: '{}' } })) })
    const question = { ok: true, source: 'browser', pendingCustomerChoice: { purpose: 'browser-order-slot' }, customerMessage: '要加幾個？' }
    const remove = vi.fn(async () => ({ ok: true }))
    const tools = [rawTool({ name: 'browser_order_draft', description: '', parameters: { type: 'object', properties: {} }, execute: async () => question }), rawTool({ name: 'browser_cart_remove', description: '', parameters: { type: 'object', properties: {} }, execute: remove })]
    const scope = effectScope()
    const onToolResult = vi.fn()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '我要加料', tools, { onToolResult })).toMatchObject({ status: 'completed' })
      expect(remove).not.toHaveBeenCalled()
      expect(onToolResult).toHaveBeenCalledOnce()
      expect(onToolResult).toHaveBeenCalledWith('browser_order_draft', JSON.stringify(question))
    }
    finally { scope.stop() }
  })

  it('retains a confirmed-add refusal as the current browser outcome without replay', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'pb-confirm-refused', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'confirm', type: 'function', function: { name: 'browser_confirm_add', arguments: '{}' } }] })
    const payload = { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '確認後餐點已變更，請重新確認；尚未加入。' }
    const tool = rawTool({ name: 'browser_confirm_add', description: 'Confirm', parameters: { type: 'object', properties: {} }, execute: async () => payload })
    const scope = effectScope()
    const onToolResult = vi.fn()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '好', [tool], { onToolResult })).toMatchObject({ status: 'incomplete', reason: 'tool-rejected' })
      expect(onToolResult).toHaveBeenCalledWith('browser_confirm_add', JSON.stringify(payload))
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(1)
    }
    finally { scope.stop() }
  })

  // Report: this chat, Nov11; a direct reply must not hide an unfinished-cart handoff.
  it('ends after a completed customer reply instead of asking Main to repeat it', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'final-reply' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValue({ agentMode: 'active', toolCalls: [{ id: 'greet', type: 'function', function: { name: 'reply_to_customer', arguments: '{}' } }] })
    const payload = { ok: true, source: 'host', status: 'conversation', effect: 'none', customerMessage: '您好。' }
    const execute = vi.fn(async () => payload)
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '你好', [rawTool({ name: 'reply_to_customer', description: '', parameters: { type: 'object', properties: {} }, execute })])).toMatchObject({ status: 'completed' })
      expect(execute).toHaveBeenCalledOnce()
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledOnce()
    }
    finally { scope.stop() }
  })

  it.each(['handoff', 'checkout'])('ends with the verified %s receipt without another Main continuation', async (kind) => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'cart-handoff', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'checkout', type: 'function', function: { name: 'browser_respond', arguments: '{"kind":"information-unavailable"}' } }] })
    const payload = { ok: true, source: 'browser', effect: 'none', ...(kind === 'handoff' ? { status: 'clarification', customerBoundary: 'review-required', customerMessage: '購物車裡還留著未完成的餐點，需要請現場人員先確認。' } : { status: 'checkout-guidance', customerMessage: '請核對購物車，再依畫面提示自行結帳。' }) }
    const tool = rawTool({ name: 'browser_respond', description: 'Reply', parameters: { type: 'object', properties: {} }, execute: async () => payload })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '幫我結帳', [tool])).toMatchObject({ status: 'completed' })
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(1)
      expect(kioskApi.appendKioskInteraction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tool_result', content: JSON.stringify(payload) }))
    }
    finally { scope.stop() }
  })
  // Report: this chat, Nov11; a menu miss must not become unsolicited alternatives.
  it('ends a factual product clarification with its receipt instead of asking Main to recommend another dish', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'pb-missing-product', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'find-fish', type: 'function', function: { name: 'browser_clarify_product', arguments: '{"query":"虱目魚"}' } }] })
    const payload = { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '目前這個取餐時段的菜單沒有找到「虱目魚」，尚未加入購物車。' }
    const tool = rawTool({ name: 'browser_clarify_product', description: 'Find the requested product', parameters: { type: 'object', properties: { query: { type: 'string' } } }, execute: async () => payload })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '我想吃虱目魚', [tool])).toMatchObject({ status: 'completed', requestedTools: ['browser_clarify_product'] })
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(1)
      expect(kioskApi.appendKioskInteraction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tool_result', content: JSON.stringify(payload) }))
    }
    finally { scope.stop() }
  })

  // Report: this chat, Nov14 — public names/purpose must use the same per-turn presentation guard.
  it.each(['browser_present', 'point_to_menu_items'])('presents only one PB recommendation batch while retaining explicit information comparisons in the same turn (%s)', async (name) => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'pb-small-batch', state: 'active' } })
    const call = (id: string, mode?: string) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(name === 'point_to_menu_items' ? { names: ['當日餐'], purpose: mode ?? 'recommendation' } : { productRefs: ['p-1'], ...(mode ? { mode } : {}) }) } })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [call('first'), call('second'), call('comparison', 'information')] }).mockResolvedValueOnce({ agentMode: 'active', toolCalls: [] })
    const execute = vi.fn(async () => ({ ok: true, source: 'browser', presentation: { products: [{ ref: 'p-1', name: '當日餐', price: 30 }], cue: 'shown' }, customerMessage: '當日餐，單份30元。' }))
    const tool = rawTool({ name, description: 'Present selected products', parameters: { type: 'object', properties: { productRefs: { type: 'array', items: { type: 'string' } }, mode: { type: 'string' } } }, execute })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '推薦幾道，並比較價格', [tool])).toMatchObject({ status: 'completed' })
      expect(execute).toHaveBeenCalledTimes(2)
      const continuation = kioskApi.streamKioskConversationMessage.mock.calls[1][0]
      expect(JSON.parse(continuation.toolResults[1].content)).toMatchObject({ dataOnly: true, recommendationAlreadyPresented: true })
    }
    finally { scope.stop() }
  })
  // Report: this chat, 2026-11-11; 推薦什麼 returned a generic rejection when PB needed sign-in.
  it('reports a verified browser sign-in requirement without continuing, retrying or presenting it as a menu rejection', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'pb-sign-in', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'read-menu', type: 'function', function: { name: 'browser_observe', arguments: '{}' } }] })
    const payload = { ok: false, source: 'browser', status: 'rejected', effect: 'none', code: 'sign-in-required', error: 'PB requires manual sign-in.' }
    const execute = vi.fn(async () => payload)
    const tool = rawTool({ name: 'browser_observe', description: 'Read PB menu', parameters: { type: 'object', properties: {} }, execute })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      const result = await recording.send('ordering', '推薦什麼？', [tool])
      expect(result).toMatchObject({ status: 'incomplete', reason: 'sign-in-required', requestedTools: ['browser_observe'] })
      expect(execute).toHaveBeenCalledTimes(1)
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(1)
      expect(kioskApi.appendKioskInteraction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tool_result', content: JSON.stringify(payload) }))
    }
    finally { scope.stop() }
  })

  it.each([
    { source: 'host', status: 'rejected', effect: 'none', code: 'sign-in-required' },
    { source: 'browser', status: 'unknown', effect: 'unknown', code: 'sign-in-required' },
    { source: 'browser', error: 'PB requires manual sign-in.' },
  ])('keeps an unverified login claim or uncertain write as a generic rejection: %j', async (payload) => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'pb-unverified-sign-in', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'read-menu', type: 'function', function: { name: 'browser_observe', arguments: '{}' } }] })
    const tool = rawTool({ name: 'browser_observe', description: 'Read PB menu', parameters: { type: 'object', properties: {} }, execute: async () => ({ ok: false, error: 'PB requires manual sign-in.', ...payload }) })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '推薦什麼？', [tool])).toMatchObject({ reason: 'tool-rejected' })
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(1)
    }
    finally { scope.stop() }
  })

  // Report: this chat, 2026-10-29; PB exposes browser facts, not owned Menu state.
  it('runs external browser tools without inventing Menu decision state', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'pb-browser', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'pb-read', type: 'function', function: { name: 'browser_observe', arguments: '{}' } }] }).mockResolvedValueOnce({ agentMode: 'active', toolCalls: [], answer: '畫面上有雞腿便當。' })
    const observe = vi.fn(async () => ({ source: 'browser', products: ['雞腿便當'] }))
    const tool = rawTool({ name: 'browser_observe', description: 'Read the current external page', parameters: { type: 'object', properties: {} }, execute: observe })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      const result = await recording.send('ordering', '看一下雞腿便當', [tool], { prepareRound: async () => ({ tools: [tool] }) })
      expect(result).toMatchObject({ status: 'completed', requestedTools: ['browser_observe'] })
      expect(observe).toHaveBeenCalledTimes(1)
      expect(kioskApi.streamKioskConversationMessage.mock.calls[0]![0]).not.toHaveProperty('decisionState')
      expect(kioskApi.streamKioskConversationMessage.mock.calls[1]![0].toolResults[0].content).toContain('雞腿便當')
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
  it.each(['same-batch', 'continuation', 'broad-menu-get'] as const)('presents one recommendation batch per customer turn: %s', async (path) => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'recommendation-limit', state: 'active' } })
    const first = { id: 'recommend-first', type: 'function', function: { name: 'menu_recommend', arguments: '{}' } }
    const second = { id: 'recommend-more', type: 'function', function: { name: path === 'broad-menu-get' ? 'menu_get' : 'menu_recommend', arguments: path === 'broad-menu-get' ? '{}' : '{"more":true}' } }
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: path === 'same-batch' ? [first, second] : [first] })
    if (path !== 'same-batch')
      kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [second] })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [] })
    const execute = vi.fn(async () => ({ presentation: { kind: 'recommendation', itemIds: ['a', 'b', 'c'] }, items: [{ id: 'a', name: '甲', price: 100 }, { id: 'b', name: '乙', price: 110 }, { id: 'c', name: '丙', price: 120 }], customerMessage: '推薦3 項：甲、乙、丙。' }))
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
    const tool = rawTool({ name: 'menu_get', description: 'Menu', parameters: { type: 'object', properties: {} }, execute: async () => ({ pendingCustomerChoice: { purpose: 'menu-query-scope', questionId: 'scope-1', question: '請選擇範圍' } }) })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '120以下有什麼', [tool])).toMatchObject({ status: 'completed' })
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(1)
      expect(kioskApi.appendKioskInteraction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tool_result', metadata: expect.objectContaining({ name: 'menu_get' }) }))
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

  it('connects the real public table-question tool to recording and the model receipt projection', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'real-table-question' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValue({ agentMode: 'active', toolCalls: [{ id: 'table', type: 'function', function: { name: 'ask_customer_question', arguments: '{"questionType":"table"}' } }] })
    const dialogue = createBrowserDialogue({ owner: () => 'visitor', documentId: () => 'doc', answer: async () => ({ kind: 'UNCERTAIN', provider: 'unavailable' }) })
    const end = beginBrowserCartTask('我要點山', { dialogue, decide: async () => ({ choice: 'ALLOW', provider: 'main' }), isCurrent: () => true })
    const client = { tools: shallowRef([{ name: 'browser_cart_get', description: '', origin: 'http://127.0.0.1:5188', inputSchema: { type: 'object' } }]), execute: vi.fn(async () => ({ ok: true, source: 'browser', page: 'table', code: 'table-selection-required', tableChoices: ['櫃台取餐', 'A1 桌'], selectedTable: '櫃台取餐', customerMessage: '目前選擇櫃台取餐。' })) }
    const onToolResult = vi.fn()
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '我要點山', createBrowserOrderingTools(client), { onToolResult })).toMatchObject({ status: 'completed', requestedTools: ['ask_customer_question'] })
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledOnce()
      const payload = JSON.parse(onToolResult.mock.calls[0][1])
      expect(payload.pendingCustomerChoice.purpose).toBe('browser-table-selection')
      expect(payload.selectedTable).toBe('櫃台取餐')
      expect(browserToolResult('ask_customer_question', payload).outcome).toBe('awaiting_customer_answer')
      expect(browserToolResult('ask_customer_question', payload).currentQuestion).toMatchObject({ question: expect.stringContaining('櫃台取餐') })
      expect(client.execute).toHaveBeenCalledTimes(1)
    }
    finally {
      end()
      scope.stop()
    }
  })

  // Report: this chat, Nov14 cross-tool audit; an unsettled write must stop its batch.
  it('does not dispatch a second tool from the same model batch after an unknown result', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'pb-batch-unknown' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValue({ agentMode: 'active', toolCalls: ['replace_item_in_cart', 'add_items_to_cart'].map((name, i) => ({ id: `unknown-${i}`, type: 'function', function: { name, arguments: '{}' } })) })
    const replace = vi.fn(async () => ({ ok: false, source: 'browser', status: 'unknown', effect: 'unknown', customerMessage: '目前尚未確認修改結果。' }))
    const add = vi.fn(async () => ({ ok: true }))
    const tools = [rawTool({ name: 'replace_item_in_cart', description: '', parameters: { type: 'object', properties: {} }, execute: replace }), rawTool({ name: 'add_items_to_cart', description: '', parameters: { type: 'object', properties: {} }, execute: add })]
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '換成排骨，再加一份湯', tools)).toMatchObject({ status: 'incomplete' })
      expect(replace).toHaveBeenCalledOnce()
      expect(add).not.toHaveBeenCalled()
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledOnce()
    }
    finally { scope.stop() }
  })

  it('presents a truthful partial browser failure receipt without continuing or retrying it', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'pb-partial', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'replace', type: 'function', function: { name: 'browser_cart_replace', arguments: '{}' } }] })
    const payload = { ok: false, source: 'browser', status: 'unknown', partial: true, customerMessage: '新餐已加入，原餐移除尚未確認，暫停代操作。' }
    const execute = vi.fn(async () => payload)
    const tool = rawTool({ name: 'browser_cart_replace', description: 'Replace', parameters: { type: 'object', properties: {} }, execute })
    const onToolResult = vi.fn()
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '改另一份', [tool], { onToolResult })).toMatchObject({ status: 'incomplete', reason: 'tool-rejected' })
      expect(onToolResult).toHaveBeenCalledWith('browser_cart_replace', JSON.stringify(payload))
      expect(execute).toHaveBeenCalledTimes(1)
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(1)
    }
    finally { scope.stop() }
  })

  // Report: this chat, 2026-10-30; actual D01 omitted selection.version before dispatch.
  it('allows a confirmed pre-dispatch argument correction while preserving the normal tool-round budget', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'pb-argument-repair', state: 'active' } })
    kioskApi.streamKioskConversationMessage
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'missing-version', type: 'function', function: { name: 'browser_cart_add', arguments: '{"version":"cart"}' } }] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'corrected-version', type: 'function', function: { name: 'browser_cart_add', arguments: '{"version":"cart","selection":{"version":"configuration"}}' } }] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [] })
    const execute = vi.fn(async (input: Record<string, unknown>) => input.selection
      ? { ok: true, source: 'browser', status: 'verified', customerMessage: '已加入一份。' }
      : { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, error: 'Missing selection.version' })
    const tool = rawTool({ name: 'browser_cart_add', description: 'Add', parameters: { type: 'object', properties: {} }, execute })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '每日新品一份', [tool])).toMatchObject({ status: 'completed' })
      expect(execute).toHaveBeenCalledTimes(2)
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(3)
      expect(kioskApi.streamKioskConversationMessage.mock.calls[1]![0].toolResults[0].content).toContain('proposal_rejected')
      expect(kioskApi.streamKioskConversationMessage.mock.calls[2]![0].toolResults[0].content).toContain('verified')
    }
    finally { scope.stop() }
  })

  it('finishes a bounded pre-dispatch correction after the four normal tool batches', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'pb-late-repair', state: 'active' } })
    const call = (id: string, name: string, argumentsValue = '{}') => ({ id, type: 'function', function: { name, arguments: argumentsValue } })
    kioskApi.streamKioskConversationMessage
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [call('cart', 'browser_cart_get')] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [call('products', 'browser_product_get')] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [call('first', 'browser_cart_add', '{"part":"first"}')] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [call('incomplete', 'browser_cart_add', '{"part":"missing"}')] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [call('corrected', 'browser_cart_add', '{"part":"corrected"}')] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [] })
    const vendorWrite = vi.fn()
    const tools = ['browser_cart_get', 'browser_product_get', 'browser_cart_add'].map(name => rawTool({ name, description: name, parameters: { type: 'object', properties: {} }, execute: async (input: Record<string, unknown>) => {
      if (name !== 'browser_cart_add')
        return { ok: true, source: 'browser', dataOnly: true }
      if (input.part === 'missing')
        return { ok: true, source: 'browser', status: 'proposal_rejected', dataOnly: true, effect: 'none' }
      vendorWrite()
      return { ok: true, source: 'browser', status: 'verified' }
    } }))
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '今日餐甲、今日餐乙各一份', tools)).toMatchObject({ status: 'completed' })
      expect(vendorWrite).toHaveBeenCalledTimes(2)
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(6)
    }
    finally { scope.stop() }
  })

  // Report: output/playwright/pb-electron/restored-S04-split-add.json, Nov3.
  it.each(['already-shown', 'different-product', 'another-write', 'mixed'] as const)('settles only a redundant final product cue after four successful batches (%s)', async (mode) => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'pb-final-cue', state: 'active' } })
    const call = (id: string, name: string, args = '{}') => ({ id, type: 'function', function: { name, arguments: args } })
    const present = call('final-cue', 'browser_present', JSON.stringify({ productRefs: [mode === 'different-product' ? '另一餐' : '排骨便當'] }))
    const write = call('extra-write', 'browser_cart_add')
    kioskApi.streamKioskConversationMessage
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [call('observe', 'browser_observe')] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [call('config', 'browser_product_get')] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [call('plain', 'browser_cart_add')] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: [call('rice', 'browser_cart_add')] })
      .mockResolvedValueOnce({ agentMode: 'active', toolCalls: mode === 'another-write' ? [write] : mode === 'mixed' ? [present, write] : [present] })
    const cue = vi.fn()
    const writeMeal = vi.fn(async () => ({ ok: true, source: 'browser', status: 'verified', customerMessage: '目前三份，其中一份加飯。', presentation: { products: [{ ref: 'p-current', name: '排骨便當' }], cue: 'shown' } }))
    const tools = ['browser_observe', 'browser_product_get', 'browser_cart_add', 'browser_present'].map(name => rawTool({ name, description: name, parameters: { type: 'object', properties: {} }, execute: name === 'browser_cart_add' ? writeMeal : name === 'browser_present' ? cue : async () => ({ ok: true, source: 'browser', dataOnly: true }) }))
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '三份排骨便當，其中一份加飯', tools)).toMatchObject(mode === 'already-shown' ? { status: 'completed' } : { status: 'incomplete', reason: 'tool-limit' })
      expect(writeMeal).toHaveBeenCalledTimes(2)
      expect(cue).not.toHaveBeenCalled()
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(5)
      const acknowledgements = kioskApi.appendKioskInteraction.mock.calls.filter(([entry]) => entry.kind === 'tool_result' && entry.metadata?.name === 'browser_present')
      expect(acknowledgements).toHaveLength(mode === 'already-shown' ? 1 : 0)
    }
    finally { scope.stop() }
  })

  it('stops after at most two extra confirmed no-effect correction batches', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'pb-bounded-repair', state: 'active' } })
    let id = 0
    kioskApi.streamKioskConversationMessage.mockImplementation(async () => ({ agentMode: 'active', toolCalls: [{ id: `repair-${id++}`, type: 'function', function: { name: 'browser_cart_add', arguments: '{}' } }] }))
    const execute = vi.fn(async () => ({ ok: true, source: 'browser', status: 'proposal_rejected', dataOnly: true, effect: 'none' }))
    const tool = rawTool({ name: 'browser_cart_add', description: 'Add', parameters: { type: 'object', properties: {} }, execute })
    const scope = effectScope()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '每日新品一份', [tool])).toMatchObject({ status: 'incomplete', reason: 'tool-limit' })
      expect(execute).toHaveBeenCalledTimes(6)
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(7)
    }
    finally { scope.stop() }
  })

  it('ends a browser target clarification before the model can guess another cart target', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'pb-scope', state: 'active' } })
    kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'guess', type: 'function', function: { name: 'browser_cart_add', arguments: '{}' } }] })
    const payload = { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '請問您要哪一項？尚未加入。' }
    const tool = rawTool({ name: 'browser_cart_add', description: 'Add', parameters: { type: 'object', properties: {} }, execute: async () => payload })
    const scope = effectScope()
    const onToolResult = vi.fn()
    try {
      const recording = scope.run(() => useKioskInteractionRecording())!
      expect(await recording.send('ordering', '我要一份便當', [tool], { onToolResult })).toMatchObject({ status: 'completed' })
      expect(onToolResult).toHaveBeenCalledWith('browser_cart_add', JSON.stringify(payload))
      expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(1)
    }
    finally { scope.stop() }
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
      onEvent({ type: 'reply-progress' })
      onEvent({ text: '牛肉', type: 'assistant-delta' })
      onEvent({ text: '麵可以點餐。', type: 'assistant-delta' })
      return { agentMode: 'active', answer: '牛肉麵可以點餐。', toolCalls: [], type: 'turn-finished' }
    })
    const onAssistantDelta = vi.fn()
    const onReplyProgress = vi.fn()
    const onTurnStarted = vi.fn()
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())
    if (!recording)
      throw new Error('Expected interaction recording to initialize.')

    await expect(recording.send('restaurant-ordering', '我要牛肉麵', [], { onAssistantDelta, onReplyProgress, onTurnStarted })).resolves.toEqual({
      agentMode: 'active',
      answer: '牛肉麵可以點餐。',
      status: 'completed',
      requestedTools: [],
    })

    expect(onReplyProgress).toHaveBeenCalledOnce()
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

  it('sends the current payment phase on the first Main Agent request only', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-1', state: 'active' } })
    kioskApi.streamKioskConversationMessage
      .mockResolvedValueOnce({ agentMode: 'active', answer: undefined, toolCalls: [{ id: 'call-1', type: 'function', function: { arguments: '{}', name: 'menu_get' } }] })
      .mockResolvedValueOnce({ agentMode: 'active', answer: '請選擇付款方式。', toolCalls: [] })
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())
    if (!recording)
      throw new Error('Expected interaction recording to initialize.')

    const decisionState = { phase: 'checkout_payment_select', paymentState: 'idle', allowedPaymentMethods: ['card', 'mobile'] as Array<'card' | 'mobile'> }
    await recording.send('restaurant-ordering', '信用卡', [], { decisionState })

    expect(kioskApi.streamKioskConversationMessage.mock.calls[0]?.[0].decisionState).toEqual(decisionState)
    expect(kioskApi.streamKioskConversationMessage.mock.calls[1]?.[0].decisionState).toBeUndefined()
    scope.stop()
  })

  // Report: current Kiosk SSE audit; an old session must not repaint new reception progress.
  it('ignores reply progress after the owning visitor session changes', async () => {
    kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'visitor-old', state: 'active' } })
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())!
    const onReplyProgress = vi.fn()
    kioskApi.streamKioskConversationMessage.mockImplementation(async (_input, onEvent) => {
      await recording.end('cancelled')
      onEvent({ type: 'reply-progress' })
      return { agentMode: 'active', answer: undefined, toolCalls: [], type: 'turn-finished' }
    })
    await recording.send('restaurant-ordering', '你好', [], { onReplyProgress })
    expect(onReplyProgress).not.toHaveBeenCalled()
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
    const onReplyProgress = vi.fn()
    kioskApi.streamKioskConversationMessage.mockImplementation(async (_input, onEvent) => {
      controller.abort()
      onEvent({ type: 'reply-progress' })
      return { agentMode: 'active', answer: undefined, toolCalls: [{ id: 'call-1', type: 'function', function: { arguments: '{}', name: 'cart_add_item' } }] }
    })
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())
    if (!recording)
      throw new Error('Expected interaction recording to initialize.')

    await expect(recording.send('restaurant-ordering', '我要水餃', [tool], { signal: controller.signal, onReplyProgress })).resolves.toBeUndefined()
    expect(onReplyProgress).not.toHaveBeenCalled()
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

// Report: this chat, Nov1: avoid a final prose model round only when Host has
// established that the whole original request is covered by verified effects.
it.each([true, false])('ends on verified Host coverage, otherwise continues Main (%s)', async (covered) => {
  kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'single-edit', state: 'active' } })
  kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'edit', type: 'function', function: { name: 'browser_cart_remove', arguments: '{}' } }] }).mockResolvedValueOnce({ agentMode: 'active', toolCalls: [], answer: 'done' })
  const tool = rawTool({ name: 'browser_cart_remove', description: 'Remove', parameters: { type: 'object', properties: {} }, execute: async () => ({ ok: true, source: 'browser', status: 'verified' }) })
  let complete = false
  const scope = effectScope()
  try {
    const recording = scope.run(() => useKioskInteractionRecording())!
    const result = await recording.send('ordering', '移除原餐', [tool], { onToolResult: () => {
      complete = covered
    }, isRequestComplete: () => complete })
    expect(result?.status).toBe('completed')
    expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledTimes(covered ? 1 : 2)
    if (covered)
      expect(kioskApi.appendKioskInteraction.mock.calls.some(([entry]) => entry.kind === 'tool_result' && entry.metadata?.name === 'browser_cart_remove')).toBe(true)
  }
  finally { scope.stop() }
})

// Report: this chat, Nov13; old session callbacks must not adopt or clear a new reception.
it('ignores an old session start that completes after reset and a new session start', async () => {
  kioskApi.startKioskVisitorSession.mockReset()
  kioskApi.endKioskVisitorSession.mockReset().mockResolvedValue(undefined)
  let finishOld!: (result: { session: { id: string } }) => void
  kioskApi.startKioskVisitorSession.mockImplementationOnce(() => new Promise(resolve => finishOld = resolve))
  kioskApi.startKioskVisitorSession.mockResolvedValueOnce({ session: { id: 'next-reception' } })
  const scope = effectScope()
  try {
    const recording = scope.run(() => useKioskInteractionRecording())!
    const old = recording.start('ordering')
    await recording.end('cancelled')
    const next = recording.start('ordering')
    try {
      await vi.waitFor(() => expect(kioskApi.startKioskVisitorSession).toHaveBeenCalledTimes(2))
      expect(await next).toBe('next-reception')
    }
    finally {
      finishOld({ session: { id: 'old-reception' } })
      await old
    }
    expect(recording.visitorSessionId.value).toBe('next-reception')
  }
  finally { scope.stop() }
})

it('does not clear the new reception when the previous session end returns late', async () => {
  kioskApi.startKioskVisitorSession.mockReset()
  kioskApi.endKioskVisitorSession.mockReset()
  let finishEnd!: () => void
  kioskApi.startKioskVisitorSession.mockResolvedValueOnce({ session: { id: 'previous-reception' } })
  kioskApi.startKioskVisitorSession.mockResolvedValueOnce({ session: { id: 'next-reception' } })
  kioskApi.endKioskVisitorSession.mockImplementationOnce(() => new Promise<void>(resolve => finishEnd = resolve))
  const scope = effectScope()
  try {
    const recording = scope.run(() => useKioskInteractionRecording())!
    await recording.start('ordering')
    const ending = recording.end('cancelled')
    try {
      expect(await recording.start('ordering')).toBe('next-reception')
    }
    finally {
      finishEnd()
      await ending
    }
    expect(recording.visitorSessionId.value).toBe('next-reception')
  }
  finally { scope.stop() }
})

// Report: Nov14 recording/text association; one utterance can pass through several routes.
it('records a transcript once and returns its exact session before a delayed old result', async () => {
  vi.clearAllMocks()
  kioskApi.startKioskVisitorSession.mockResolvedValueOnce({ session: { id: 'evidence-old' } }).mockResolvedValueOnce({ session: { id: 'evidence-new' } })
  kioskApi.appendKioskInteraction.mockResolvedValue({ entry: { id: 'transcript-7' } })
  const recording = useKioskInteractionRecording()
  await recording.start('ordering')
  const first = recording.recordTranscript({ id: 7, text: '雞腿飯', source: 'asr' })
  const second = recording.recordTranscript({ id: 7, text: '雞腿飯', source: 'asr' })
  expect(await first).toMatchObject({ visitorSessionId: 'evidence-old', entry: { id: 'transcript-7' } })
  expect(await second).toEqual(await first)
  expect(kioskApi.appendKioskInteraction).toHaveBeenCalledTimes(1)
  await recording.end('cancelled')
  await recording.start('ordering')
  expect(recording.visitorSessionId.value).toBe('evidence-new')
})

it('does not attach an old transcript acknowledgement to the replacement reception', async () => {
  vi.clearAllMocks()
  kioskApi.startKioskVisitorSession.mockResolvedValueOnce({ session: { id: 'old-evidence' } }).mockResolvedValueOnce({ session: { id: 'new-evidence' } })
  let finish!: (value: { entry: { id: string } }) => void
  kioskApi.appendKioskInteraction.mockImplementationOnce(() => new Promise(resolve => finish = resolve))
  const recording = useKioskInteractionRecording()
  await recording.start('ordering')
  const pending = recording.recordTranscript({ id: 11, source: 'asr', text: '舊顧客' })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  await recording.end('cancelled')
  await recording.start('ordering')
  finish({ entry: { id: 'old-transcript' } })
  expect(await pending).toBeUndefined()
  expect(recording.visitorSessionId.value).toBe('new-evidence')
  expect(kioskApi.appendKioskInteraction).toHaveBeenCalledWith(expect.objectContaining({ visitorSessionId: 'old-evidence', metadata: { source: 'asr', utteranceId: 11 } }))
})

// Report: Nov14 reception isolation; an old pending append must not block the new customer's records.
it('records a new reception while an old transcript upload acknowledgement is still pending', async () => {
  vi.clearAllMocks()
  kioskApi.startKioskVisitorSession.mockResolvedValueOnce({ session: { id: 'old-chain' } }).mockResolvedValueOnce({ session: { id: 'new-chain' } })
  let finish!: (value: { entry: { id: string } }) => void
  kioskApi.appendKioskInteraction.mockImplementationOnce(() => new Promise(resolve => finish = resolve)).mockResolvedValueOnce({ entry: { id: 'new-text' } })
  const recording = useKioskInteractionRecording()
  await recording.start('ordering')
  const old = recording.recordTranscript({ id: 21, text: '舊客', source: 'asr' })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  await recording.end('cancelled')
  await recording.start('ordering')
  const next = recording.recordTranscript({ id: 22, text: '新客', source: 'asr' })
  try {
    await vi.waitFor(() => expect(kioskApi.appendKioskInteraction).toHaveBeenCalledTimes(2))
    expect(await next).toMatchObject({ visitorSessionId: 'new-chain', entry: { id: 'new-text' } })
  }
  finally {
    finish({ entry: { id: 'old-text' } })
    await old
  }
  expect(recording.visitorSessionId.value).toBe('new-chain')
})

// Report: this chat, 2026-11-14 — an empty search was followed by another vague item question.
it('ends an empty search with its concrete recovery guidance instead of another Main round', async () => {
  vi.resetAllMocks()
  kioskApi.startKioskVisitorSession.mockResolvedValue({ session: { id: 'empty-search', state: 'active' } })
  kioskApi.streamKioskConversationMessage.mockResolvedValueOnce({ agentMode: 'active', toolCalls: [{ id: 'search', type: 'function', function: { name: 'search_menu_items', arguments: '{}' } }] })
  const receipt = { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '目前搜尋沒有找到這道餐點。可以換一道餐點，或說「回到菜單」看全部餐點。' }
  const tool = rawTool({ name: 'search_menu_items', description: '', parameters: { type: 'object', properties: {} }, execute: async () => receipt })
  const scope = effectScope()
  try {
    const recording = scope.run(() => useKioskInteractionRecording())!
    const result = await recording.send('ordering', '有沒有不存在的餐點', [tool])
    expect(result?.reason).toBeUndefined()
    expect(result).toMatchObject({ status: 'completed' })
    expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledOnce()
  }
  finally { scope.stop() }
})
