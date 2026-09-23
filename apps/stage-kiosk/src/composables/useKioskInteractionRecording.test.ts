import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useKioskInteractionRecording } from './useKioskInteractionRecording'

const kioskApi = vi.hoisted(() => ({
  appendKioskInteraction: vi.fn(),
  endKioskVisitorSession: vi.fn(),
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
    const scope = effectScope()
    const recording = scope.run(() => useKioskInteractionRecording())
    if (!recording)
      throw new Error('Expected interaction recording to initialize.')

    await expect(recording.send('restaurant-ordering', '我要牛肉麵', [], undefined, undefined, onAssistantDelta)).resolves.toEqual({
      agentMode: 'active',
      answer: '牛肉麵可以點餐。',
    })

    expect(onAssistantDelta).toHaveBeenNthCalledWith(1, '牛肉')
    expect(onAssistantDelta).toHaveBeenNthCalledWith(2, '麵可以點餐。')
    expect(kioskApi.streamKioskConversationMessage).toHaveBeenCalledWith({
      content: '我要牛肉麵',
      signal: undefined,
      tools: [],
      visitorSessionId: 'visitor-1',
    }, expect.any(Function))
    scope.stop()
  })
})
