import type { KioskNativeAudioBridge } from '@proj-airi/stage-shared/kiosk-native-audio'

import { arrayInputPortChannel } from '@proj-airi/stage-shared/kiosk-array-input'
import { expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import { createNativeCapture } from './nativeCapture'

// Report: this chat, 2026-11-20 — native playback delivery exceeded 250 ms.
// Keep the true native-stall guard while isolating the renderer's event loop.
it.each([{ stall: false, openDelayMs: 350 }, { stall: true, openDelayMs: 0 }])('runs microphone-only capture without reference delivery and preserves native timeouts: %j', async ({ stall, openDelayMs }) => {
  const controller = new AbortController()
  const hardware = new Worker(new URL('./__fixtures__/hushInput.worker.ts', import.meta.url), { type: 'module' })
  const errors: string[] = []
  const ready = vi.fn()
  const stopped = vi.fn()
  const bridge: KioskNativeAudioBridge = {
    version: 9,
    async request(input) {
      if (input.kind === 'connect') {
        const channel = new MessageChannel()
        hardware.postMessage({ port: channel.port1, generation: input.generation, stall, openDelayMs }, [channel.port1])
        window.postMessage({ channel: arrayInputPortChannel, generation: input.generation }, location.origin, [channel.port2])
      }
      if (input.kind === 'stop')
        stopped()
      if (input.kind === 'poll')
        throw new Error('Realtime PCM must never use the renderer RPC bridge.')
      return { captureDelayFrames: 0, samples: new Float32Array() }
    },
  }
  const button = document.createElement('button')
  document.body.append(button)
  let starting: ReturnType<typeof createNativeCapture> | undefined
  button.onclick = () => starting = createNativeCapture({
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
    onSpeechReady: ready,
    onSpeechCancelled: () => {},
    onError: message => errors.push(message),
  })
  try {
    await userEvent.click(button)
    const capture = (await starting)!
    if (stall) {
      await expect.poll(() => errors.length).toBe(1)
      expect(errors[0]).toContain('Native microphone read exceeded 250 ms.')
      expect(errors[0]).toContain('captured=0, processed=0')
      expect(stopped).toHaveBeenCalledTimes(1)
      expect(capture.statistics.processedFrames).toBe(0)
    }
    else {
      await expect.poll(() => capture.statistics.processedFrames).toBeGreaterThan(0)
      expect(capture.referenceSignalFrames).toBe(0)
      expect(capture.statistics.renderFrames).toBe(0)
      const before = capture.statistics.processedFrames
      const end = performance.now() + 350
      // NOTICE: sleeping would release the UI event loop and miss this failure.
      while (performance.now() < end) { /* Simulate a busy admin/3D renderer. */ }
      await expect.poll(() => capture.statistics.processedFrames).toBeGreaterThan(before + 16000)
      await expect.poll(() => ready.mock.calls.length).toBe(1)
      expect(errors).toEqual([])
      expect(capture.statistics.outputFrames).toBe(capture.statistics.processedFrames / 3)
      expect(capture.statistics.processingMs).toBe(1)
      expect(ready.mock.calls[0]![0].buffer.length).toBe(480)
      controller.abort()
      expect(stopped).toHaveBeenCalledTimes(1)
      const count = capture.statistics.outputFrames
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(capture.statistics.outputFrames).toBe(count)
    }
  }
  finally {
    controller.abort()
    hardware.terminate()
    button.remove()
  }
}, 15000)
