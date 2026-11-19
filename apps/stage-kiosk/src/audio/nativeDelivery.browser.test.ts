import type { NativeAudioRequest } from '@proj-airi/stage-shared/kiosk-native-audio'

import { expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import { createNativeCapture } from './nativeCapture'

// Report: this chat, 2026-11-18 — "Native playback delivery exceeded 250 ms".
// Hold the external native response while using the actual Chromium Worklet;
// no model, hardware microphone or speaker playback is needed to reproduce it.
it('reports the playback delivery limit when native completion stalls even with silent render', async () => {
  const context = new AudioContext({ sampleRate: 48000 })
  const controller = new AbortController()
  const completion = Promise.withResolvers<void>()
  const polls: Extract<NativeAudioRequest, { kind: 'poll' }>[] = []
  const errors: string[] = []
  const stopped = vi.fn()
  const button = document.createElement('button')
  document.body.append(button)
  let starting: ReturnType<typeof createNativeCapture> | undefined
  button.onclick = () => starting = createNativeCapture(context, {
    bridge: { version: 3, async request(input) {
      if (input.kind === 'stop')
        stopped()
      if (input.kind === 'poll') {
        polls.push(input)
        await completion.promise
        return { samples: new Float32Array(), renderFrames: input.offsetFrames + 384, processedFrames: 0 }
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
    onError: message => errors.push(message),
  })
  try {
    await userEvent.click(button)
    await starting
    await expect.poll(() => errors).toEqual(['Native playback delivery exceeded 250 ms.'])
    expect(polls.length).toBe(32)
    expect(polls.every(poll => poll.samples.every(sample => sample === 0))).toBe(true)
    expect(stopped).toHaveBeenCalledTimes(1)
  }
  finally {
    completion.resolve()
    controller.abort()
    button.remove()
    await context.close()
  }
}, 10000)

// Report: this chat, 2026-11-18 — opening the administrator panel reveals the
// delivery error, and speech never arrives. Reproduce a UI scheduling stall
// with a fast native boundary; this does not measure the real panel's render time.
it('can hit the same limit when the UI thread pauses despite fast native responses', async () => {
  const context = new AudioContext({ sampleRate: 48000 })
  const controller = new AbortController()
  const errors: string[] = []
  let polls = 0
  const button = document.createElement('button')
  document.body.append(button)
  let starting: ReturnType<typeof createNativeCapture> | undefined
  button.onclick = () => starting = createNativeCapture(context, {
    bridge: { version: 3, async request(input) {
      if (input.kind === 'poll') {
        polls++
        return { samples: new Float32Array(), renderFrames: input.offsetFrames + 384, processedFrames: 0 }
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
    onError: message => errors.push(message),
  })
  try {
    await userEvent.click(button)
    await starting
    await expect.poll(() => polls).toBeGreaterThanOrEqual(4)
    expect(errors).toEqual([])
    const end = performance.now() + 350
    // NOTICE: an intentional synchronous stall models a busy renderer. Sleeping
    // would release its event loop and would not exercise this failure path.
    while (performance.now() < end) { /* Keep this test's renderer busy. */ }
    await expect.poll(() => errors).toEqual(['Native playback delivery exceeded 250 ms.'])
  }
  finally {
    controller.abort()
    button.remove()
    await context.close()
  }
}, 10000)
