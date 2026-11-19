import type { KioskArrayInputBridge } from '@proj-airi/stage-shared/kiosk-array-input'

import type { ArrayProcessing, CaptureBlock, PcmPacket } from './captureProtocol'

import wasmUrl from '@ennuicastr/webrtcaec3.js/dist/webrtcaec3-0.3.0.wasm?url'

import { arrayInputPortChannel } from '@proj-airi/stage-shared/kiosk-array-input'

import workletUrl from './capture.worklet?worker&url'
import referenceWorkletUrl from './nativePlayback.worklet?worker&url'

import { createCaptureContext } from './captureProtocol'
import { installPlaybackReference } from './playbackReference'
/** Owns one bounded UMA-8 graph. Failure closes processing rather than silently changing microphones. */
export async function createArrayCapture(context: AudioContext, source: AudioNode | undefined, options: {
  nativeInput?: { bridge: KioskArrayInputBridge, inputDevice: string }
  processing: ArrayProcessing
  channelMap: number[]
  radiusMm: number
  signal: AbortSignal
  onPcm: (packet: PcmPacket, endTimeMs: number) => Promise<void>
  onError: (reason: string) => void
}) {
  if (context.sampleRate !== 48000)
    throw new Error('UMA-8 capture requires a 48 kHz AudioContext.')
  const generation = crypto.randomUUID()
  const nativePort = Promise.withResolvers<MessagePort>()
  void nativePort.promise.catch(() => {})
  let receivedPort: MessagePort | undefined
  const receivePort = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== arrayInputPortChannel || event.data.generation !== generation)
      return
    if (event.ports.length !== 1)
      return
    window.removeEventListener('message', receivePort)
    receivedPort = event.ports[0]!
    nativePort.resolve(receivedPort)
  }
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
    nativePort.reject(new Error('Native array input closed.'))
    window.removeEventListener('message', receivePort)
    receivedPort?.close()
    if (options.nativeInput)
      void options.nativeInput.bridge.request({ kind: 'disconnect', generation }).catch(() => {})
    if (node && source)
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
      if (options.nativeInput)
        inputFrames = body.inputFrames
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
    await context.audioWorklet.addModule(options.nativeInput ? referenceWorkletUrl : workletUrl)
    if (closed)
      throw new Error('UMA-8 capture cancelled.')
    if (options.nativeInput) {
      node = new AudioWorkletNode(context, 'kiosk-native-playback', { processorOptions: { waitForPort: true }, numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete', outputChannelCount: [1] })
      capture = createCaptureContext(node.port, 'client')
      node.port.start()
      node.onprocessorerror = () => fail('UMA-8 reference Worklet failed.')
      window.addEventListener('message', receivePort)
      channels.resolve() // Physical channel count is validated by the native open.
    }
    else {
      if (!source)
        throw new Error('UMA-8 browser capture requires its physical input source.')
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
    }
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
    if (options.nativeInput) {
      const connected = await options.nativeInput.bridge.request({ kind: 'connect', generation, inputDevice: options.nativeInput.inputDevice })
      let portTimer: ReturnType<typeof setTimeout> | undefined
      let port: MessagePort
      try {
        port = await Promise.race([nativePort.promise, new Promise<never>((_, reject) => portTimer = setTimeout(() => reject(new Error('Native array input port timed out.')), 12000))])
      }
      finally {
        clearTimeout(portTimer)
      }
      if (connected.captureDelayFrames === undefined)
        throw new Error('Native array input did not report its capture clock delay.')
      // Input buffering delays PCM, not its source timestamps. Model/driver
      // startup time before connect completes is not part of captured speech.
      clockOriginMs = performance.now() - connected.captureDelayFrames / 48
      if (closed)
        throw new Error('Native array input cancelled.')
      const channel = new MessageChannel()
      processing.context.emit(processing.request, { type: 'native-ports', generation, input: port, render: channel.port1 })
      capture!.context.emit(capture!.request, { type: 'reference-port', port: channel.port2 })
      reference?.input.connect(node!)
      node!.connect(context.destination)
    }
    else {
      capture!.context.emit(capture!.request, { type: 'run' })
    }
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
