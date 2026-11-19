import type { NativeAudioRequest } from '@proj-airi/stage-shared/kiosk-native-audio'

import { expect, it, vi } from 'vitest'

import { createTestBridge } from './__fixtures__/nativeBridge'
import { createNativeCapture } from './nativeCapture'
import { playbackReferenceContext } from './playbackReference'

// Report: this chat, 2026-11-20 — remove Hush AEC and all playback pairing.
it('delivers continuous native PCM and a complete utterance without any browser audio graph', async () => {
  const requests: NativeAudioRequest[] = []
  let index = 0
  const starts = vi.fn()
  const cancelled = vi.fn()
  const ready = vi.fn()
  const errors: string[] = []
  const controller = new AbortController()
  const bridge = createTestBridge(async (request) => {
    requests.push(request)
    if (request.kind !== 'read')
      return { samples: new Float32Array() }
    const position = index++
    const segment = position === 12
    return {
      capturedFrames: (position + 1) * 480,
      processedFrames: (position + 1) * 480,
      phraseActive: (position >= 3 && position < 12) || position >= 16,
      frames: [{ offsetSamples: position * 160, length: 160, pcmStart: 0, speech: true, rtfState: 'tracking', rtfUpdates: 1 }],
      segments: segment ? [{ startSample: 480, pcmStart: 160, length: 480, endReason: 'silence' }] : [],
      samples: new Float32Array(segment ? 640 : 160).fill(0.02),
    }
  })
  const capture = await createNativeCapture({
    bridge,
    signal: controller.signal,
    channels: [0, 1, 2, 3, 4, 5, 6],
    inputDevice: '',
    gainDb: 0,
    hush: { attenuationDb: 20, dryMixPercent: 30 },
    silenceMs: 600,
    minSpeechMs: 80,
    onSpeechStart: starts,
    onSpeechEnd: () => {},
    onSpeechProbability: () => {},
    onSpeechReady: ready,
    onSpeechCancelled: cancelled,
    onError: message => errors.push(message),
  })
  try {
    await expect.poll(() => starts.mock.calls.length).toBe(2)
    expect(requests.find(request => request.kind === 'start')).toMatchObject({ hush: { attenuationDb: 20, dryMixPercent: 30 } })
    expect(requests.some(request => request.kind === 'poll')).toBe(false)
    expect(ready).toHaveBeenCalledTimes(1)
    const event = ready.mock.calls[0]![0]
    expect(event.buffer.length).toBe(480)
    expect(event.duration).toBe(30)
    expect(event.startTimeMs).toBeLessThan(performance.now())
    expect(playbackReferenceContext()).toBeUndefined()
    expect(capture.statistics.renderFrames).toBe(0)
    expect(capture.referenceSignalFrames).toBe(0)
    expect(errors).toEqual([])
    controller.abort()
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(requests.filter(request => request.kind === 'stop')).toHaveLength(1)
  }
  finally { controller.abort() }
})

it('rejects a discontinuous microphone clock and releases the generation', async () => {
  const controller = new AbortController()
  const stop = vi.fn()
  const errors: string[] = []
  const bridge = createTestBridge(async (request) => {
    if (request.kind === 'stop')
      stop()
    return { samples: new Float32Array(), ...(request.kind === 'read' ? { capturedFrames: 384, processedFrames: 768 } : {}) }
  })
  try {
    await createNativeCapture({
      bridge,
      signal: controller.signal,
      channels: [0, 1, 2, 3, 4, 5, 6],
      inputDevice: '',
      gainDb: 0,
      hush: { attenuationDb: 20, dryMixPercent: 30 },
      silenceMs: 600,
      minSpeechMs: 80,
      onSpeechStart: () => {},
      onSpeechEnd: () => {},
      onSpeechProbability: () => {},
      onSpeechReady: () => {},
      onSpeechCancelled: () => {},
      onError: message => errors.push(message),
    })
    await expect.poll(() => errors.length).toBe(1)
    expect(errors[0]).toContain('discontinuous')
    expect(stop).toHaveBeenCalledTimes(1)
  }
  finally { controller.abort() }
})
