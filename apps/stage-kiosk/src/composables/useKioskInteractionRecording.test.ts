import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

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
  afterEach(() => vi.clearAllMocks())

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
    await expect(recording.runAssistantAction('restaurant-ordering', 'greeting', 'data:image/jpeg;base64,ZmFrZQ==')).resolves.toBe('您好，請問需要協助嗎？')
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
    })
    expect(kioskApi.endKioskVisitorSession).toHaveBeenCalledWith({ visitorSessionId: 'visitor-1', state: 'idle' })
    expect(recording.visitorSessionId.value).toBeUndefined()
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

    await expect(recording.runAssistantAction('restaurant-ordering', 'reminder', 'data:image/jpeg;base64,ZmFrZQ==', controller.signal)).resolves.toBe('需要協助嗎？')

    expect(kioskApi.sendKioskAssistantAction).toHaveBeenCalledWith({
      frame: 'data:image/jpeg;base64,ZmFrZQ==',
      visitorSessionId: 'visitor-1',
      kind: 'reminder',
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
    })

    expect(onAssistantDelta).toHaveBeenNthCalledWith(1, '牛肉')
    expect(onAssistantDelta).toHaveBeenNthCalledWith(2, '麵可以點餐。')
    expect(onTurnStarted).toHaveBeenCalledOnce()
    expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledWith({
      content: '我要牛肉麵',
      signal: undefined,
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
