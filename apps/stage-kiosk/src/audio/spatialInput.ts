import type { PcmLevel } from '@proj-airi/stage-ui/libs/audio/inputGain'

import type { SpatialMode, SpatialProcessing } from './spatialMask'
import type { CaptureResponse, MaskRequest, MaskResponse } from './spatialMaskMessages'

import { errorMessageFrom } from '@moeru/std'
import { resumeAudioContext } from '@proj-airi/stage-ui/libs/audio/activation'
import { measurePcmLevel } from '@proj-airi/stage-ui/libs/audio/inputGain'

import captureUrl from './spatialCapture.worklet?worker&url'
/** Same source-clock interval, with explicit sample rates rather than equal frame counts. */
export interface MaskComparison {
  raw: Float32Array
  reference: Float32Array
  processed: Float32Array
  sampleStart: number
}
/** Input to the existing VAD. Ownership of the microphone track stays outside. */
export interface SpatialInput {
  start: (consume: (samples: Float32Array) => Promise<void>) => void
  /** Native audible playback state; capture timestamps each edge. Retired graphs ignore it. */
  setPlayback: (playing: boolean) => void
  finish: () => Promise<void>
  dispose: () => void
  recordComparison: () => Promise<MaskComparison>
  cancelComparison: () => void
  readonly statistics: {
    inputFrames: number
    outputFrames: number
    consumedFrames: number
    lagSeconds: number
    maxWorkMs: number
    processingMode: SpatialMode
    playbackTransitions: number
    referenceLevel?: PcmLevel
    maskLevel?: PcmLevel
  }
}
/**
 * One graph/Worker generation, with bounded in-flight audio and serial VAD delivery.
 * Capture waits for start(), so model initialization cannot create an audio backlog.
 * finish drains capture → DSP → consumer; dispose cancels without delivering old audio.
 */
export async function createSpatialInput(input: MediaStream | AudioNode, options: {
  generation: number
  channelMap: number[]
  radiusMm: number
  processing?: SpatialProcessing
  onError: (reason: string) => void
  signal?: AbortSignal
  onWaiting?: () => void
}): Promise<SpatialInput> {
  options.signal?.throwIfAborted()
  const activation = new AbortController()
  const generation = options.generation
  // A supplied AudioNode supports synthetic validation without pretending a
  // browser's stereo virtual MediaStream is a real eight-channel microphone.
  const ownsContext = input instanceof MediaStream
  const candidateContext = input instanceof MediaStream ? new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' }) : input.context
  if (!(candidateContext instanceof AudioContext))
    throw new Error('A live AudioContext is required.')
  const context: AudioContext = candidateContext
  const worker = new Worker(new URL('./spatialMask.worker.ts', import.meta.url), { type: 'module' })
  const ready = Promise.withResolvers<void>()
  const channels = Promise.withResolvers<void>()
  // Activation can wait for operator input before these startup promises are
  // awaited. Keep early cancellation/Worker errors handled during that wait.
  void ready.promise.catch(() => {})
  void channels.promise.catch(() => {})
  let source: AudioNode | undefined
  let node: AudioWorkletNode | undefined
  let silent: GainNode | undefined
  let closed = false
  let running = false
  let finishing: Promise<void> | undefined
  let captureDone: ReturnType<typeof Promise.withResolvers<void>> | undefined
  let workerDone: ReturnType<typeof Promise.withResolvers<void>> | undefined
  let consume: ((samples: Float32Array) => Promise<void>) | undefined
  let delivery = Promise.resolve()
  let inputFrames = 0
  let workerFrames = 0
  let outputFrames = 0
  let consumedFrames = 0
  let maxWorkMs = 0
  let processingMode: SpatialMode = options.processing === 'dynamic' ? 'gate' : 'soft'
  let playbackTransitions = 0
  let referenceLevel: PcmLevel | undefined
  let maskLevel: PcmLevel | undefined
  let comparison: {
    start: number
    rawCount: number
    pcmCount: number
    data: MaskComparison
    resolve: (data: MaskComparison) => void
    reject: (error: Error) => void
  } | undefined
  function cancelComparison() {
    comparison?.reject(new Error('Comparison cancelled.'))
    comparison = undefined
  }
  function completeComparison() {
    if (comparison?.rawCount === 720000 && comparison.pcmCount === 240000) {
      const result = comparison
      comparison = undefined
      result.resolve(result.data)
    }
  }
  const track = input instanceof MediaStream ? input.getAudioTracks()[0] : undefined
  function send(message: MaskRequest, transfer: Transferable[] = []) {
    worker.postMessage(message, transfer)
  }
  function dispose() {
    if (closed)
      return
    closed = true
    const retired = new Error('Mask input retired.')
    activation.abort(retired)
    ready.reject(retired)
    channels.reject(retired)
    options.signal?.removeEventListener('abort', dispose)
    cancelComparison()
    running = false
    if (source && node)
      source.disconnect(node)
    node?.disconnect()
    node?.port.close()
    silent?.disconnect()
    track?.removeEventListener('ended', ended)
    captureDone?.reject(new Error('Mask input disposed.'))
    workerDone?.reject(new Error('Mask input disposed.'))
    worker.terminate()
    if (ownsContext)
      void context.close()
  }
  function fail(reason: string) {
    if (closed)
      return
    const error = new Error(reason)
    ready.reject(error)
    channels.reject(error)
    captureDone?.reject(error)
    workerDone?.reject(error)
    dispose()
    options.onError(reason)
  }
  function ended() {
    fail('Microphone disconnected; direction suppression stopped.')
  }
  async function wait(promise: Promise<void>, label: string) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([promise, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), 5000)
      })])
    }
    finally {
      clearTimeout(timer)
    }
  }
  options.signal?.addEventListener('abort', dispose, { once: true })
  worker.onmessage = ({ data }: MessageEvent<MaskResponse>) => {
    if (closed || data.generation !== generation)
      return
    if (data.type === 'started')
      ready.resolve()
    if (data.type === 'error')
      fail(data.reason)
    if (data.type === 'progress') {
      workerFrames = data.inputFrames
      processingMode = data.processingMode
      playbackTransitions = data.playbackTransitions
      maxWorkMs = Math.max(maxWorkMs, data.workMs)
    }
    if (data.type === 'pcm') {
      if (data.offsetFrames !== outputFrames || data.mask.length > 512 || !consume) {
        fail('Discontinuous Mask PCM or missing VAD consumer.')
        return
      }
      if (comparison) {
        const start = comparison.start / 3
        const left = Math.max(data.offsetFrames, start)
        const right = Math.min(data.offsetFrames + data.mask.length, start + 240000)
        if (right > left) {
          comparison.data.processed.set(data.mask.subarray(left - data.offsetFrames, right - data.offsetFrames), left - start)
          comparison.data.reference.set(data.raw.subarray(left - data.offsetFrames, right - data.offsetFrames), left - start)
          comparison.pcmCount += right - left
          completeComparison()
        }
      }
      referenceLevel = measurePcmLevel(data.raw)
      maskLevel = measurePcmLevel(data.mask)
      outputFrames += data.mask.length
      // One second is a failure limit, not permission to drop and stitch audio.
      if (outputFrames - consumedFrames > 16000) {
        fail('VAD is falling behind; direction suppression stopped.')
        return
      }
      delivery = delivery.then(async () => {
        if (closed)
          return
        await consume!(data.mask)
        if (!closed)
          consumedFrames += data.mask.length
      }).catch(cause => fail(errorMessageFrom(cause) ?? 'VAD PCM delivery failed.'))
    }
    if (data.type === 'done') {
      if (data.inputFrames !== inputFrames || data.outputFrames !== outputFrames) {
        fail('Mask drain sample count mismatch.')
        return
      }
      workerDone?.resolve()
    }
  }
  worker.onerror = event => fail(event.message || 'Mask Worker failed.')
  try {
    if (context.sampleRate !== 48000 || (input instanceof MediaStream && !track))
      throw new Error('A live microphone and 48kHz processing are required.')
    if (context.state === 'suspended')
      options.onWaiting?.()
    await resumeAudioContext(context, activation.signal)
    await context.audioWorklet.addModule(captureUrl)
    source = input instanceof MediaStream ? context.createMediaStreamSource(input) : input
    node = new AudioWorkletNode(context, 'kiosk-spatial-capture', { channelCount: 8, channelCountMode: 'max', channelInterpretation: 'discrete', outputChannelCount: [1], processorOptions: { generation } })
    node.onprocessorerror = () => fail('Array capture Worklet failed.')
    node.port.onmessage = ({ data }: MessageEvent<CaptureResponse>) => {
      if (closed || data.generation !== generation)
        return
      if (data.type === 'channels') {
        if (data.count === 8)
          channels.resolve()
        else
          fail(`Expected eight actual channels; received ${data.count}.`)
      }
      if (data.type === 'playback') {
        if (data.offsetFrames !== inputFrames) {
          fail('Playback source clock mismatch.')
          return
        }
        send(data)
      }
      if (data.type === 'error')
        fail(data.reason)
      if (data.type === 'block') {
        if (data.offsetFrames !== inputFrames) {
          fail('Capture audio is discontinuous.')
          return
        }
        if (comparison) {
          const left = Math.max(data.offsetFrames, comparison.start)
          const right = Math.min(data.offsetFrames + data.channels[0].length, comparison.start + 720000)
          for (let frame = left; frame < right; frame++) {
            for (let ch = 0; ch < 8; ch++)
              comparison.data.raw[(frame - comparison.start) * 8 + ch] = data.channels[ch][frame - data.offsetFrames]
          }
          comparison.rawCount += Math.max(0, right - left)
          completeComparison()
        }
        inputFrames += data.channels[0].length
        if (inputFrames - workerFrames > 48000) {
          fail('Mask Worker is falling behind; direction suppression stopped.')
          return
        }
        send(data, data.channels.map(ch => ch.buffer))
      }
      if (data.type === 'stopped') {
        if (data.inputFrames !== inputFrames)
          fail('Capture drain sample count mismatch.')
        else
          captureDone?.resolve()
      }
    }
    silent = context.createGain()
    silent.gain.value = 0
    source.connect(node).connect(silent).connect(context.destination)
    track?.addEventListener('ended', ended)
    send({ type: 'start', generation, channelMap: options.channelMap, radiusMm: options.radiusMm, processing: options.processing })
    await wait(Promise.all([ready.promise, channels.promise]).then(() => {
    }), 'Array initialization')
    if (closed)
      throw new Error('Array initialization was cancelled.')
  }
  catch (cause) {
    dispose()
    throw cause
  }
  return {
    start(handler) {
      if (closed || running)
        throw new Error('Mask input is closed or already started.')
      consume = handler
      running = true
      node!.port.postMessage({ type: 'start', generation })
    },
    setPlayback(playing) {
      if (!closed)
        node!.port.postMessage({ type: 'playback', generation, playing })
    },
    finish() {
      finishing ??= (async () => {
        if (closed || !running)
          throw new Error('Mask input is not running.')
        // Attach both rejection handlers before any capture/worker failure can settle them.
        captureDone = Promise.withResolvers<void>()
        workerDone = Promise.withResolvers<void>()
        const captured = wait(captureDone.promise, 'Capture drain').then(() => send({ type: 'finish', generation }))
        const done = Promise.all([captured, wait(workerDone.promise, 'Mask drain')])
        node!.port.postMessage({ type: 'stop', generation })
        try {
          await done
          await delivery
          if (closed)
            throw new Error('Mask drain failed.')
        }
        finally {
          dispose()
        }
      })()
      return finishing
    },
    dispose,
    cancelComparison,
    recordComparison() {
      if (closed || !running || comparison)
        return Promise.reject(new Error('Start capture and finish the current comparison first.'))
      const pending = Promise.withResolvers<MaskComparison>()
      // Align to the FIR's absolute 3:1 sample clock; no per-recording filter reset.
      const start = Math.ceil(inputFrames / 3) * 3
      comparison = { start, rawCount: 0, pcmCount: 0, data: { raw: new Float32Array(720000 * 8), reference: new Float32Array(240000), processed: new Float32Array(240000), sampleStart: start }, resolve: pending.resolve, reject: pending.reject }
      return pending.promise
    },
    get statistics() {
      return { inputFrames, outputFrames, consumedFrames, lagSeconds: Math.max(0, inputFrames / 48000 - consumedFrames / 16000), maxWorkMs, processingMode, playbackTransitions, referenceLevel, maskLevel }
    },
  }
}
