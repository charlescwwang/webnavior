import { afterEach, describe, expect, it, vi } from 'vitest'

import { createKioskTranscriptionBody, decideKioskInteraction, isKioskFastPathEnabled } from './kiosk-device'

describe('segmented device requests', () => {
  afterEach(() => vi.restoreAllMocks())

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
