import type { ArrayProcessing, CaptureBlock, PcmPacket } from './captureProtocol'

import wasmUrl from '@ennuicastr/webrtcaec3.js/dist/webrtcaec3-0.3.0.wasm?url'

import workletUrl from './capture.worklet?worker&url'

import { createCaptureContext } from './captureProtocol'
import { installPlaybackReference } from './playbackReference'
/** Owns one bounded UMA-8 graph. Failure closes processing rather than silently changing microphones. */
export async function createArrayCapture(context: AudioContext, source: AudioNode, options: {
  processing: ArrayProcessing
  channelMap: number[]
  radiusMm: number
  signal: AbortSignal
  onPcm: (packet: PcmPacket, endTimeMs: number) => Promise<void>
  onError: (reason: string) => void
}) {
  if (context.sampleRate !== 48000)
    throw new Error('UMA-8 capture requires a 48 kHz AudioContext.')
  const aec3Enabled = options.processing.algorithm === 'lcmv' || options.processing.aec3Enabled
  // Disabled AEC owns neither a render subscription nor a WASM instance.
  const reference = aec3Enabled ? installPlaybackReference(context) : undefined
  let worker: Worker
  try {
    worker = new Worker(new URL('./capture.worker.ts', import.meta.url), { type: 'module' })
  }
  catch (error) {
    reference?.dispose()
    throw error
  }
  const processing = createCaptureContext(worker, 'client')
  let node: AudioWorkletNode | undefined
  let capture: ReturnType<typeof createCaptureContext> | undefined
  let closed = false
  let inputFrames = 0
  let processedFrames = 0
  let referenceSignalFrames = 0
  let outputFrames = 0
  let consumedFrames = 0
  let clockOriginMs: number | undefined
  let delivery = Promise.resolve()
  const ready = Promise.withResolvers<void>()
  const channels = Promise.withResolvers<void>()
  // All pending initialization waits reject on failure/abort. Detached captures
  // cannot deliver another generation's PCM even if inference was in flight.
  void ready.promise.catch(() => { })
  void channels.promise.catch(() => { })
  function dispose() {
    if (closed)
      return
    closed = true
    options.signal.removeEventListener('abort', abort)
    ready.reject(new Error('UMA-8 capture closed.'))
    channels.reject(new Error('UMA-8 capture closed.'))
    if (node)
      source.disconnect(node)
    node?.disconnect()
    node?.port.close()
    capture?.dispose()
    processing.dispose()
    worker.terminate()
    reference?.dispose()
  }
  function fail(reason: string) {
    if (closed)
      return
    ready.reject(new Error(reason))
    channels.reject(new Error(reason))
    dispose()
    options.onError(reason)
  }
  function abort() {
    dispose()
  }
  options.signal.addEventListener('abort', abort, { once: true })
  processing.context.on(processing.response, ({ body }) => {
    if (closed || !body)
      return
    if (body.type === 'ready') {
      ready.resolve()
    }
    else if (body.type === 'error') {
      fail(body.reason)
    }
    else if (body.type === 'processed') {
      processedFrames = body.inputFrames
      referenceSignalFrames = body.referenceSignalFrames
    }
    else if (body.type === 'pcm') {
      const packet = body.packet
      if (clockOriginMs === undefined || packet.offsetFrames !== outputFrames || packet.mask.length !== 512 || packet.raw.length !== packet.mask.length) {
        fail('UMA-8 processed sample clock is discontinuous.')
        return
      }
      outputFrames += packet.mask.length
      if (outputFrames - consumedFrames > 16000) {
        fail('UMA-8 VAD processing fell more than one second behind.')
        return
      }
      const endTimeMs = clockOriginMs + outputFrames / 16
      delivery = delivery.then(async () => {
        if (!closed) {
          await options.onPcm(packet, endTimeMs)
          consumedFrames += packet.mask.length
        }
      }).catch(error => fail(String(error)))
    }
  })
  worker.onerror = event => fail(event.message || 'UMA-8 Worker failed.')
  function forward(block: CaptureBlock) {
    if (block.offsetFrames !== inputFrames) {
      fail('UMA-8 capture samples are discontinuous.')
      return
    }
    clockOriginMs ??= performance.now() + (block.startTime - context.currentTime) * 1000
    inputFrames += block.channels[0]!.length
    if (inputFrames - processedFrames > 48000) {
      fail('UMA-8 DSP processing fell more than one second behind.')
      return
    }
    processing.context.emit(processing.request, block)
    capture?.context.emit(capture.request, { type: 'ack', inputFrames })
  }
  try {
    if (options.signal.aborted)
      throw new Error('UMA-8 capture cancelled.')
    await context.resume()
    await context.audioWorklet.addModule(workletUrl)
    if (closed)
      throw new Error('UMA-8 capture cancelled.')
    node = new AudioWorkletNode(context, 'kiosk-array-capture', { numberOfInputs: 2, numberOfOutputs: 1, channelCount: 8, channelCountMode: 'max', channelInterpretation: 'discrete', outputChannelCount: [1] })
    capture = createCaptureContext(node.port, 'client')
    node.port.start()
    node.onprocessorerror = () => fail('UMA-8 AudioWorklet failed.')
    capture.context.on(capture.response, ({ body }) => {
      if (closed || !body)
        return
      if (body.type === 'channels') {
        if (body.count === 8)
          channels.resolve()
        else
          fail(`UMA-8 requires 8 discrete channels; received ${body.count}.`)
      }
      else if (body.type === 'block') {
        forward(body)
      }
      else if (body.type === 'error') {
        fail(body.reason)
      }
    })
    source.connect(node)
    reference?.input.connect(node, 0, 1)
    node.connect(context.destination) // Worklet output is silent; keeps the capture graph rendering.
    processing.context.emit(processing.request, { type: 'start', processing: options.processing, radiusMm: options.radiusMm, channelMap: options.channelMap, ...(aec3Enabled ? { wasmUrl: new URL(wasmUrl, document.baseURI).href } : {}) })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([Promise.all([ready.promise, channels.promise]), new Promise<never>((_, reject) => timer = setTimeout(() => reject(new Error('UMA-8 initialization timed out.')), 12000))])
    }
    finally {
      clearTimeout(timer)
    }
    if (closed)
      throw new Error('UMA-8 capture cancelled.')
    capture.context.emit(capture.request, { type: 'run' })
    return {
      dispose,
      get referenceSignalFrames() { return referenceSignalFrames },
      /** Source positions, not wall-clock completion times. No waveform is retained. */
      get statistics() { return { inputFrames, processedFrames, outputFrames, consumedFrames, referenceSignalFrames, channels: 8 } },
      get lagMs() { return Math.max(0, inputFrames / 48 - consumedFrames / 16) },
    }
  }
  catch (error) {
    dispose()
    throw error
  }
}
