import type { KioskNativeAudioBridge } from '@proj-airi/stage-shared/kiosk-native-audio'
import type { VADEvents } from '@proj-airi/stage-ui/libs/audio/vad'

import { errorMessageFrom } from '@moeru/std'

import workletUrl from './nativePlayback.worklet?worker&url'

import { applyAudioOutput } from '../services/kioskAudioOutput'
import { createCaptureContext } from './captureProtocol'
import { installPlaybackReference } from './playbackReference'

/** PortAudio owns the microphone; normal browser output supplies application PCM for AEC. */
export async function createNativeCapture(context: AudioContext, options: {
  bridge: KioskNativeAudioBridge
  signal: AbortSignal
  channels: number[]
  inputDevice: string
  gainDb: number
  silenceMs: number
  minSpeechMs: number
  onSpeechStart: () => void
  onSpeechEnd: () => void
  onSpeechProbability: (probability: number, timeMs: number) => void
  onSpeechReady: (event: VADEvents['speech-ready']) => void
  onSpeechCancelled: () => void
  onError: (message: string) => void
}) {
  if (options.bridge.version !== 3)
    throw new Error('Native hardware audio requires Kiosk EXE 0.6.0 or newer.')
  if (context.sampleRate !== 48000)
    throw new Error('Native UMA-8 requires a 48 kHz playback/capture AudioContext.')
  const generation = crypto.randomUUID()
  let node: AudioWorkletNode | undefined
  let transport: ReturnType<typeof createCaptureContext> | undefined
  let reference: ReturnType<typeof installPlaybackReference> | undefined
  let closed = false
  let inputFrames = 0
  let processedFrames = 0
  let outputFrames = 0
  let referenceSignalFrames = 0
  let pending = 0
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
    node?.disconnect()
    node?.port.close()
    transport?.dispose()
    reference?.dispose()
    // The worker checks generation too: late cleanup cannot stop a replacement.
    void options.bridge.request({ kind: 'stop', generation }).catch(() => {})
  }
  function fail(message: string) {
    if (closed)
      return
    dispose()
    options.onError(message)
  }
  options.signal.addEventListener('abort', dispose, { once: true })
  try {
    options.signal.throwIfAborted()
    await options.bridge.request({ kind: 'start', generation, channels: options.channels, gainDb: options.gainDb, silenceMs: options.silenceMs, minSpeechMs: options.minSpeechMs })
    if (closed)
      throw new Error('Native capture cancelled.')
    await context.resume()
    await context.audioWorklet.addModule(workletUrl)
    if (closed)
      throw new Error('Native capture cancelled.')
    await applyAudioOutput(context)
    if (closed)
      throw new Error('Native capture cancelled.')
    originMs = performance.now()
    await options.bridge.request({ kind: 'open', generation, inputDevice: options.inputDevice })
    if (closed)
      throw new Error('Native capture cancelled.')
    reference = installPlaybackReference(context)
    node = new AudioWorkletNode(context, 'kiosk-native-playback', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete', outputChannelCount: [1] })
    transport = createCaptureContext(node.port, 'client')
    node.port.start()
    node.onprocessorerror = () => fail('Native audio capture Worklet failed.')
    transport.context.on(transport.response, ({ body }) => {
      if (closed || !body)
        return
      if (body.type === 'error') {
        fail(body.reason)
      }
      else if (body.type === 'block') {
        if (body.offsetFrames !== inputFrames || ++pending > 32) {
          fail('Native capture clock failed or processing exceeded 256 ms backlog.')
          return
        }
        originMs ??= performance.now() + (body.startTime - context.currentTime) * 1000
        inputFrames += 384
        const samples = new Float32Array(768)
        for (let channel = 0; channel < 2; channel++)
          samples.set(body.render[channel]!, channel * 384)
        void options.bridge.request({ kind: 'poll', generation, offsetFrames: body.offsetFrames, samples }).then((reply) => {
          pending--
          if (closed)
            return
          if (reply.renderFrames !== body.offsetFrames + 384 || reply.processedFrames === undefined || reply.processedFrames < processedFrames)
            throw new Error('Native DSP acknowledgment is discontinuous.')
          processedFrames = reply.processedFrames
          transport?.context.emit(transport.request, { type: 'ack', inputFrames: reply.renderFrames })
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
        }).catch(error => fail(errorMessageFrom(error) ?? 'Native GPU audio processing failed.'))
      }
    })
    reference.input.connect(node)
    node.connect(context.destination)
    options.signal.throwIfAborted()
    return {
      dispose,
      get levels() { return { inputDb, outputDb, peak, limitedPercent: 0 } },
      get referenceSignalFrames() { return referenceSignalFrames },
      get statistics() { return { inputFrames: processedFrames, renderFrames: inputFrames, processedFrames, outputFrames, consumedFrames: outputFrames, referenceSignalFrames, channels: 8 } },
      get lagMs() { return Math.max(0, processedFrames / 48 - outputFrames / 16) },
    }
  }
  catch (error) {
    dispose()
    throw error
  }
}
