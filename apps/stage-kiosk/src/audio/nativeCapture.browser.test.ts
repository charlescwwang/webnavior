import type { NativeAudioRequest, NativeAudioResult } from '@proj-airi/stage-shared/kiosk-native-audio'

import { expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import { createNativeCapture } from './nativeCapture'
import { connectPlaybackReference, playbackReferenceContext } from './playbackReference'

it('delivers native final PCM once with source timestamps and releases active speech on abort', async () => {
  const context = new AudioContext({ sampleRate: 48000 })
  const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
  const source = context.createConstantSource()
  source.offset.value = 0.01
  source.start()
  const requests: NativeAudioRequest[] = []
  const starts = vi.fn()
  const cancelled = vi.fn()
  const ready = vi.fn()
  const errors: string[] = []
  const controller = new AbortController()
  const bridge = {
    version: 3 as const,
    async request(request: NativeAudioRequest): Promise<NativeAudioResult> {
      requests.push(request)
      if (request.kind !== 'poll')
        return { samples: new Float32Array() }
      const index = request.offsetFrames / 384
      const segment = index === 12
      return {
        renderFrames: request.offsetFrames + 384,
        processedFrames: request.offsetFrames + 384,
        phraseActive: (index >= 3 && index < 12) || index >= 16,
        frames: [{ offsetSamples: index * 128, length: 128, pcmStart: 0, speech: true, rtfState: 'tracking', rtfUpdates: 1 }],
        segments: segment ? [{ startSample: 384, pcmStart: 128, length: 480, endReason: 'silence' }] : [],
        samples: new Float32Array(segment ? 608 : 128).fill(0.02),
      }
    },
  }
  const button = document.createElement('button')
  button.textContent = 'Start native capture'
  document.body.append(button)
  let starting: ReturnType<typeof createNativeCapture> | undefined
  button.onclick = () => starting = createNativeCapture(context, {
    bridge,
    signal: controller.signal,
    channels: [0, 1, 2, 3, 4, 5, 6],
    inputDevice: '',
    gainDb: 0,
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
    await userEvent.click(button)
    const capture = await starting
    await expect.poll(() => starts.mock.calls.length).toBe(2)
    expect(ready).toHaveBeenCalledTimes(1)
    const event = ready.mock.calls[0]![0]
    expect(event.buffer.length).toBe(480)
    expect(event.duration).toBe(30)
    expect(event.startTimeMs).toBeLessThan(performance.now())
    expect(event.truncated).toBe(false)
    const blocks = requests.filter(request => request.kind === 'poll')
    expect(blocks.length).toBeGreaterThan(16)
    expect(blocks.every((block, index) => block.offsetFrames === index * 384)).toBe(true)
    expect(blocks[0]!.samples.length).toBe(768)
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(requests.some(request => request.kind === 'open')).toBe(true)
    expect(requests.some(request => request.kind === 'status')).toBe(false)
    expect(requests.filter(request => request.kind === 'open').every(request => !('outputDevice' in request))).toBe(true)
    expect(Reflect.get(context, 'sinkId')).toBe('')
    expect(Boolean(playbackReferenceContext())).toBe(true)
    controller.abort()
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(playbackReferenceContext()).toBeUndefined()
    const stoppedAt = requests.length
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(requests.length).toBe(stoppedAt)
    expect(requests.at(-1)?.kind).toBe('stop')
    expect(capture!.statistics.processedFrames).toBeGreaterThan(0)
    expect(errors).toEqual([])
  }
  finally {
    controller.abort()
    button.remove()
    source.stop()
    getUserMedia.mockRestore()
    await context.close()
  }
}, 15000)

it('rejects a discontinuous native acknowledgment and stops its capture generation', async () => {
  const context = new AudioContext({ sampleRate: 48000 })
  const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
  const source = context.createConstantSource()
  source.start()
  const errors: string[] = []
  const stop = vi.fn()
  const controller = new AbortController()
  const button = document.createElement('button')
  button.textContent = 'Start invalid acknowledgment'
  document.body.append(button)
  let starting: ReturnType<typeof createNativeCapture> | undefined
  button.onclick = () => starting = createNativeCapture(context, {
    bridge: { version: 3, async request(request) {
      if (request.kind === 'stop')
        stop(request.generation)
      return { samples: new Float32Array(), ...(request.kind === 'poll' ? { processedFrames: 768, renderFrames: 768 } : {}) }
    } },
    signal: controller.signal,
    channels: [0, 1, 2, 3, 4, 5, 6],
    inputDevice: '',
    gainDb: 0,
    silenceMs: 600,
    minSpeechMs: 80,
    onSpeechStart: () => {},
    onSpeechEnd: () => {},
    onSpeechProbability: () => {},
    onSpeechReady: () => {},
    onSpeechCancelled: () => {},
    onError: reason => errors.push(reason),
  })
  try {
    await userEvent.click(button)
    await starting
    await expect.poll(() => errors.length).toBe(1)
    expect(errors[0]).toContain('discontinuous')
    expect(stop).toHaveBeenCalledTimes(1)
    expect(playbackReferenceContext()).toBeUndefined()
  }
  finally {
    controller.abort()
    button.remove()
    source.stop()
    getUserMedia.mockRestore()
    await context.close()
  }
}, 15000)

it('limits overlapping native playback and sends the actual stereo signal without a microphone', async () => {
  const context = new AudioContext({ sampleRate: 48000 })
  const controller = new AbortController()
  const blocks: Float32Array[] = []
  const sources = Array.from({ length: 2 }, () => context.createConstantSource())
  let capture: Awaited<ReturnType<typeof createNativeCapture>> | undefined
  const button = document.createElement('button')
  document.body.append(button)
  const disconnect: (() => void)[] = []
  let starting: ReturnType<typeof createNativeCapture> | undefined
  button.onclick = () => starting = createNativeCapture(context, {
    bridge: { version: 3, async request(request) {
      if (request.kind === 'poll') {
        blocks.push(request.samples)
        return { samples: new Float32Array(), renderFrames: request.offsetFrames + 384, processedFrames: request.offsetFrames + 384 }
      }
      return { samples: new Float32Array() }
    } },
    signal: controller.signal,
    channels: [0, 1, 2, 3, 4, 5, 6],
    inputDevice: '',
    gainDb: 0,
    silenceMs: 600,
    minSpeechMs: 80,
    onSpeechStart: () => {},
    onSpeechEnd: () => {},
    onSpeechProbability: () => {},
    onSpeechReady: () => {},
    onSpeechCancelled: () => {},
    onError: (message) => { throw new Error(message) },
  })
  try {
    await userEvent.click(button)
    capture = await starting
    for (const source of sources) {
      source.offset.value = 0.75
      source.connect(context.destination)
      disconnect.push(connectPlaybackReference(source))
      source.start()
    }
    expect(Reflect.get(context, 'sinkId')).toBe('')
    await expect.poll(() => blocks.some(block => block.every(value => value === 1))).toBe(true)
    expect(blocks.every(block => block.every(value => Math.abs(value) <= 1))).toBe(true)
  }
  finally {
    disconnect.forEach(close => close())
    sources.forEach((source) => {
      source.stop()
      source.disconnect()
    })
    capture?.dispose()
    controller.abort()
    button.remove()
    await context.close()
  }
}, 15000)
