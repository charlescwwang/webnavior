import { afterEach, describe, expect, it, vi } from 'vitest'

import { createKioskTranscriptionBody, decideKioskInteraction, isKioskFastPathEnabled, synthesizeKioskSpeech } from './kiosk-device'

describe('segmented device requests', () => {
  afterEach(() => vi.restoreAllMocks())

  // Report: this chat, 2026-10-21 — speech must use the same Traditional text as the Kiosk display.
  it('normalizes speech output without rewriting the caller text', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['audio'], { type: 'audio/wav' })))
    const input = { locale: 'zh-Hant', text: '请确认这份订单。' }
    await synthesizeKioskSpeech(input)
    expect(JSON.parse(String(network.mock.calls[0]?.[1]?.body))).toEqual({ locale: 'zh-Hant', text: '請確認這份訂單。' })
    expect(input.text).toBe('请确认这份订单。')
  })

  it('reads uncached activation on each utterance without sending dialogue or calling Jev', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ enabled: false })).mockResolvedValueOnce(Response.json({ enabled: true }))
    expect(await isKioskFastPathEnabled()).toBe(false)
    expect(await isKioskFastPathEnabled()).toBe(true)
    expect(network).toHaveBeenCalledTimes(2)
    for (const [url, options] of network.mock.calls) {
      expect(url).toContain('/interaction-decisions/status')
      expect(options).toMatchObject({ cache: 'no-store', credentials: 'include', signal: expect.any(AbortSignal) })
      expect(options?.body).toBeUndefined()
    }
  })

  it('delivers the provisional route before requesting its dependent conditions', async () => {
    const onProgress = vi.fn()
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ kind: 'DECISION_PROGRESS', continuationId: 'c1', question: 'route', choice: 'intent:search-menu', confidence: 0.95, expiresAt: Date.now() + 15000, durationMs: 20 })).mockImplementationOnce(async (_url, input) => {
      expect(onProgress).toHaveBeenCalledOnce()
      expect(JSON.parse(String(input?.body))).toEqual({ visitorSessionId: 's1' })
      return Response.json({ kind: 'FAST_ACTION', actionId: 'intent:search-menu', modelCalls: 1, modelQuestions: 1 })
    })
    expect(await decideKioskInteraction({ onProgress, visitorSessionId: 's1', transcript: '有賣什麼', candidates: [] })).toMatchObject({ kind: 'FAST_ACTION' })
    expect(network).toHaveBeenCalledTimes(2)
    expect(network.mock.calls[1]?.[0]).toContain('/interaction-decisions/c1')
    expect(JSON.parse(String(network.mock.calls[0]?.[1]?.body))).toMatchObject({ segmented: true })
  })

  it('notifies recovery progress before the slow continuation completes', async () => {
    let finish!: (response: Response) => void
    const onProgress = vi.fn()
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ kind: 'SERVICE_RECOVERY_PROGRESS', stage: 'adjudication', status: 'started', continuationId: 'main', expiresAt: Date.now() + 15000 })).mockImplementationOnce(() => new Promise<Response>(resolve => finish = resolve))
    const pending = decideKioskInteraction({ transcript: '請幫我確認', candidates: [], onProgress, budgetMs: 5000 })
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledOnce())
    expect(onProgress.mock.calls[0]?.[0]).toMatchObject({ kind: 'SERVICE_RECOVERY_PROGRESS', status: 'started' })
    expect(JSON.parse(String(network.mock.calls[0]?.[1]?.body)).budgetMs).toBe(5000)
    finish(Response.json({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION', modelCalls: 0, modelQuestions: 0 }))
    expect(await pending).toMatchObject({ kind: 'NEEDS_ASSISTANT', modelQuestions: 0 })
  })

  it('allows recovery events after the full Jev question budget without treating them as Jev questions', async () => {
    let index = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const step = index++
      return Response.json(step < 24 ? { kind: 'DECISION_PROGRESS', question: 'route', continuationId: `jev-${step}`, expiresAt: Date.now() + 15000, durationMs: 1 } : step < 28 ? { kind: 'SERVICE_RECOVERY_PROGRESS', stage: step < 26 ? 'adjudication' : 'review', status: step % 2 === 0 ? 'started' : 'completed', continuationId: `main-${step}`, expiresAt: Date.now() + 15000 } : { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST', modelQuestions: 24 })
    })
    const onProgress = vi.fn()
    expect(await decideKioskInteraction({ transcript: '請確認', candidates: [], onProgress })).toMatchObject({ kind: 'UNAVAILABLE', modelQuestions: 24 })
    expect(onProgress).toHaveBeenCalledTimes(28)
  })

  it('does not resume a replaced utterance or a repeated checkpoint', async () => {
    const checkpoint = { kind: 'DECISION_PROGRESS', continuationId: 'c1', question: 'route', expiresAt: Date.now() + 15000, durationMs: 20 }
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(checkpoint))
    await expect(decideKioskInteraction({ isCurrent: () => false, transcript: '有賣什麼', candidates: [] })).rejects.toThrow('replaced')
    expect(network).toHaveBeenCalledTimes(1)
    network.mockClear()
    await expect(decideKioskInteraction({ transcript: '有賣什麼', candidates: [] })).rejects.toThrow('budget')
    expect(network).toHaveBeenCalledTimes(2)
  })
})

describe('createKioskTranscriptionBody', () => {
  it('carries bounded chunk identity and original sample ranges without creating separate order requests', () => {
    const body = createKioskTranscriptionBody(new Blob(['RIFF']), { utteranceId: 'utterance-1', index: 2, sampleStart: 640000, sampleEnd: 720000, final: true })
    expect(body.get('utteranceId')).toBe('utterance-1')
    expect(body.get('chunkIndex')).toBe('2')
    expect(body.get('sampleStart')).toBe('640000')
    expect(body.get('sampleEnd')).toBe('720000')
    expect(body.get('finalChunk')).toBe('true')
  })
  it('labels WAV microphone recordings with their actual container format', () => {
    const recording = new Blob(['RIFF'], { type: 'audio/wav' })

    const uploaded = createKioskTranscriptionBody(recording).get('file')

    expect(uploaded).toBeInstanceOf(File)
    expect(uploaded).toMatchObject({
      name: 'recording.wav',
      type: 'audio/wav',
    })
  })
})
