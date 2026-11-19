import type { HushSettings, KioskNativeAudioBridge, NativeAudioResult } from '@proj-airi/stage-shared/kiosk-native-audio'
import type { VADEvents } from '@proj-airi/stage-ui/libs/audio/vad'

import { errorMessageFrom } from '@moeru/std'
import { arrayInputPortChannel } from '@proj-airi/stage-shared/kiosk-array-input'

import { createCaptureContext } from './captureProtocol'

/** Independent native microphone capture; Hush has no AEC or playback-reference dependency. */
export async function createNativeCapture(options: {
  bridge: KioskNativeAudioBridge
  signal: AbortSignal
  channels: number[]
  inputDevice: string
  gainDb: number
  hush: HushSettings
  silenceMs: number
  minSpeechMs: number
  onSpeechStart: () => void
  onSpeechEnd: () => void
  onSpeechProbability: (probability: number, timeMs: number) => void
  onSpeechReady: (event: VADEvents['speech-ready']) => void
  onSpeechCancelled: () => void
  onError: (message: string) => void
}) {
  if (options.bridge.version !== 9)
    throw new Error('Native hardware audio requires the matching Hush Kiosk executable.')
  const generation = crypto.randomUUID()
  const nativePort = Promise.withResolvers<MessagePort>()
  const ready = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  void nativePort.promise.catch(() => {})
  void ready.promise.catch(() => {})
  void started.promise.catch(() => {})
  let receivedPort: MessagePort | undefined
  const receivePort = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== arrayInputPortChannel || event.data.generation !== generation || event.ports.length !== 1)
      return
    window.removeEventListener('message', receivePort)
    receivedPort = event.ports[0]!
    nativePort.resolve(receivedPort)
  }
  let worker: Worker | undefined
  let processing: ReturnType<typeof createCaptureContext> | undefined
  let closed = false
  let inputFrames = 0
  let processedFrames = 0
  let outputFrames = 0
  let referenceSignalFrames = 0
  let roundTripMs = 0
  let processingMs = 0
  let maxRoundTripMs = 0
  let maxProcessingMs = 0
  let originMs: number | undefined
  let activeSpeech = false
  let inputDb = -Infinity
  let outputDb = -Infinity
  let peak = 0

  function dispose() {
    if (closed)
      return
    closed = true
    if (activeSpeech) {
      activeSpeech = false
      options.onSpeechCancelled()
    }
    options.signal.removeEventListener('abort', dispose)
    ready.reject(new Error('Native capture closed.'))
    started.reject(new Error('Native capture closed.'))
    nativePort.reject(new Error('Native capture closed.'))
    window.removeEventListener('message', receivePort)
    receivedPort?.close()
    processing?.dispose()
    worker?.terminate()
    // The worker checks generation too: late cleanup cannot stop a replacement.
    void options.bridge.request({ kind: 'stop', generation }).catch(() => {})
  }
  function fail(message: string) {
    if (closed)
      return
    started.reject(new Error(message))
    dispose()
    options.onError(message)
  }
  function handleReply(reply: NativeAudioResult) {
    try {
      inputDb = 10 * Math.log10(reply.inputPower ?? 0)
      referenceSignalFrames += reply.referenceFrames ?? 0
      if (reply.phraseActive && !activeSpeech) {
        activeSpeech = true
        options.onSpeechStart()
      }
      for (const frame of reply.frames ?? []) {
        if (frame.offsetSamples !== outputFrames || frame.pcmStart + frame.length > reply.samples.length)
          throw new Error('Native output sample clock is discontinuous.')
        outputFrames += frame.length
        const audio = reply.samples.subarray(frame.pcmStart, frame.pcmStart + frame.length)
        outputDb = 10 * Math.log10(audio.reduce((sum, value) => sum + value * value, 0) / audio.length)
        peak = audio.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0)
        options.onSpeechProbability(frame.speech ? 1 : 0, originMs! + outputFrames / 16)
      }
      for (const segment of reply.segments ?? []) {
        if (segment.pcmStart + segment.length > reply.samples.length)
          throw new Error('Native segment exceeds its PCM envelope.')
        const buffer = reply.samples.slice(segment.pcmStart, segment.pcmStart + segment.length)
        options.onSpeechEnd()
        options.onSpeechReady({ buffer, duration: buffer.length / 16, startTimeMs: originMs! + segment.startSample / 16, capturedSamples: buffer.length, truncated: segment.endReason === 'max_duration' })
        activeSpeech = false
      }
      if (!reply.phraseActive && activeSpeech) {
        activeSpeech = false
        options.onSpeechCancelled()
      }
    }
    catch (error) {
      fail(errorMessageFrom(error) ?? 'Native Hush audio processing failed.')
    }
  }
  options.signal.addEventListener('abort', dispose, { once: true })
  try {
    options.signal.throwIfAborted()
    worker = new Worker(new URL('./nativeCapture.worker.ts', import.meta.url), { type: 'module' })
    processing = createCaptureContext(worker, 'client')
    worker.onerror = event => fail(event.message || 'Native audio delivery Worker failed.')
    processing.context.on(processing.response, ({ body }) => {
      if (closed || !body)
        return
      if (body.type === 'ready') {
        ready.resolve()
      }
      else if (body.type === 'native-ready') {
        originMs = body.startedAtMs - performance.timeOrigin
        started.resolve()
      }
      else if (body.type === 'error') {
        fail(body.reason)
      }
      else if (body.type === 'native-result') {
        const reply = body.result
        inputFrames = body.inputFrames
        processedFrames = reply.processedFrames!
        roundTripMs = body.roundTripMs
        processingMs = reply.processingMs ?? 0
        maxRoundTripMs = Math.max(maxRoundTripMs, roundTripMs)
        maxProcessingMs = Math.max(maxProcessingMs, processingMs)
        handleReply(reply)
      }
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([ready.promise, new Promise<never>((_, reject) => timer = setTimeout(() => reject(new Error('Native audio Worker initialization timed out.')), 12000))])
    }
    finally { clearTimeout(timer) }
    options.signal.throwIfAborted()
    window.addEventListener('message', receivePort)
    await options.bridge.request({ kind: 'connect', generation, inputDevice: options.inputDevice, hush: options.hush, channels: options.channels, gainDb: options.gainDb, silenceMs: options.silenceMs, minSpeechMs: options.minSpeechMs })
    let port: MessagePort
    try {
      port = await Promise.race([nativePort.promise, new Promise<never>((_, reject) => timer = setTimeout(() => reject(new Error('Native audio port timed out.')), 12000))])
    }
    finally { clearTimeout(timer) }
    if (closed)
      throw new Error('Native capture cancelled.')
    processing.context.emit(processing.request, { type: 'native-input', generation, input: port })
    try {
      await Promise.race([started.promise, new Promise<never>((_, reject) => timer = setTimeout(() => reject(new Error('Native audio hardware initialization timed out.')), 12000))])
    }
    finally { clearTimeout(timer) }
    options.signal.throwIfAborted()
    return {
      dispose,
      get levels() { return { inputDb, outputDb, peak, limitedPercent: 0 } },
      get referenceSignalFrames() { return referenceSignalFrames },
      get statistics() { return { inputFrames, renderFrames: 0, processedFrames, outputFrames, consumedFrames: outputFrames, referenceSignalFrames, roundTripMs, processingMs, maxRoundTripMs, maxProcessingMs, channels: 8 } },
      get lagMs() { return Math.max(0, processedFrames / 48 - outputFrames / 16) },
    }
  }
  catch (error) {
    dispose()
    throw error
  }
}
