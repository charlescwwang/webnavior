import type { KioskArrayInputBridge } from '@proj-airi/stage-shared/kiosk-array-input'

import { arrayInputPortChannel } from '@proj-airi/stage-shared/kiosk-array-input'
import { expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import { createArrayCapture } from './capture'
import { connectPlaybackReference } from './playbackReference'
import { defaultLcmv } from './tuning'

// Report: this chat, 2026-11-19 — browser exact-eight capture fails while native
// eight-channel input works. The original LCMV must retain its processing path.
it('runs real AEC3 and LCMV from eight native channels without browser capture and survives a busy UI', async () => {
  const context = new AudioContext({ sampleRate: 48000 })
  const controller = new AbortController()
  const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(new DOMException('Browser cannot provide eight channels', 'OverconstrainedError'))
  const hardware = new Worker(new URL('./__fixtures__/nativeInput.worker.ts', import.meta.url), { type: 'module' })
  const packets: { offset: number, samples: Float32Array }[] = []
  const errors: string[] = []
  let source: ConstantSourceNode | undefined
  let disconnect: (() => void) | undefined
  const stopped = vi.fn()
  const bridge: KioskArrayInputBridge = {
    version: 1,
    async request(input) {
      if (input.kind === 'connect') {
        const channel = new MessageChannel()
        hardware.postMessage({ port: channel.port1, generation: input.generation }, [channel.port1])
        window.postMessage({ channel: arrayInputPortChannel, generation: input.generation }, location.origin, [channel.port2])
      }
      if (input.kind === 'disconnect')
        stopped()
      return { captureDelayFrames: 0, samples: new Float32Array() }
    },
  }
  const button = document.createElement('button')
  document.body.append(button)
  let starting: ReturnType<typeof createArrayCapture> | undefined
  button.onclick = () => starting = createArrayCapture(context, undefined, {
    nativeInput: { bridge, inputDevice: '' },
    processing: { algorithm: 'lcmv', tuning: defaultLcmv },
    channelMap: [0, 1, 2, 3, 4, 5, 6],
    radiusMm: 44,
    signal: controller.signal,
    onPcm: async (packet) => { packets.push({ offset: packet.offsetFrames, samples: packet.mask }) },
    onError: reason => errors.push(reason),
  })
  try {
    await userEvent.click(button)
    const capture = await starting
    await expect.poll(() => packets.length, { timeout: 10000 }).toBeGreaterThan(8)
    source = context.createConstantSource()
    source.offset.value = 0.001
    source.connect(context.destination)
    disconnect = connectPlaybackReference(source)
    source.start()
    await expect.poll(() => capture!.referenceSignalFrames).toBeGreaterThan(0)
    const before = packets.length
    const end = performance.now() + 350
    // NOTICE: deliberately block only the UI. Timers would not exercise the
    // original 250 ms delivery failure; both audio ports now stay in workers.
    while (performance.now() < end) { /* Exercise a busy administrator/3D renderer. */ }
    await expect.poll(() => packets.length).toBeGreaterThan(before + 8)
    expect(errors).toEqual([])
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(packets.every((packet, index) => packet.offset === index * 512)).toBe(true)
    expect(packets.every(packet => packet.samples.length === 512 && packet.samples.every(Number.isFinite))).toBe(true)
    expect(packets.some(packet => packet.samples.some(value => Math.abs(value) > 1e-5))).toBe(true)
    expect(capture!.statistics.channels).toBe(8)
    controller.abort()
    expect(stopped).toHaveBeenCalledTimes(1)
    const count = packets.length
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(packets.length).toBe(count)
  }
  finally {
    controller.abort()
    disconnect?.()
    source?.stop()
    hardware.terminate()
    getUserMedia.mockRestore()
    button.remove()
    await context.close()
  }
}, 20000)
