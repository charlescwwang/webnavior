import type { CaptureResponse } from './spatialMaskMessages'

import { resumeAudioContext } from '@proj-airi/stage-ui/libs/audio/activation'

import captureUrl from './spatialCapture.worklet?worker&url'

import { channelStabilityFrames } from './spatialMaskMessages'

/** Acquisition policy belongs to the selected device, not its requested channel count. */
export type MicrophoneCaptureMode = 'raw' | 'standard'

/** User-selected eight-channel recognition gain; independent of playback/comparison audio. */
export const arrayInputGainDb = 65

/** Field-trial gain for dynamic spatial output, before the shared VAD/ASR limiter. */
export const dynamicInputGainDb = 15

/** Prefer raw eight-channel capture without making ordinary devices fail getUserMedia. */
export const arrayCaptureConstraints: MediaTrackConstraints = {
  channelCount: { ideal: 8 },
  sampleRate: { ideal: 48000 },
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
}

/** General voice capture policy, requested again at acquisition if runtime changes do not apply. */
export const standardCaptureConstraints: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

/** Select by observed Worklet channels; device names never participate in routing. */
export function selectProcessing(channels: number): 'mask' | 'standard' {
  return channels === 8 ? 'mask' : 'standard'
}

/**
 * Observe actual discrete Worklet input, never an upmixed node or just track settings.
 * The probe records nothing and stops only its own graph. Abort retires stale probes
 * when the selected device or capture lifecycle changes.
 */
export async function inspectChannels(input: MediaStream | AudioNode, signal: AbortSignal, onWaiting?: () => void): Promise<number> {
  signal.throwIfAborted()
  const ownsContext = input instanceof MediaStream
  const candidate = input instanceof MediaStream ? new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' }) : input.context
  if (!(candidate instanceof AudioContext))
    throw new Error('A live AudioContext is required.')
  const context = candidate
  let source: AudioNode | undefined
  let node: AudioWorkletNode | undefined
  let silent: GainNode | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = Promise.withResolvers<number>()
  const abort = () => result.reject(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  // Attach rejection handling before module loading; an early abort must not
  // produce an unhandled rejection while addModule is still in flight.
  const observed = result.promise
  void observed.catch(() => {})
  try {
    if (context.state === 'suspended')
      onWaiting?.()
    await resumeAudioContext(context, signal)
    timer = setTimeout(() => result.reject(new Error('Microphone channel detection timed out.')), 5000)
    await context.audioWorklet.addModule(captureUrl)
    signal.throwIfAborted()
    source = input instanceof MediaStream ? context.createMediaStreamSource(input) : input
    node = new AudioWorkletNode(context, 'kiosk-spatial-capture', { channelCount: 8, channelCountMode: 'max', channelInterpretation: 'discrete', outputChannelCount: [1], processorOptions: { generation: 0 } })
    node.port.onmessage = ({ data }: MessageEvent<CaptureResponse>) => {
      if (data.type === 'channels' && data.stableFrames >= channelStabilityFrames)
        result.resolve(data.count)
    }
    node.onprocessorerror = () => result.reject(new Error('Microphone channel detection failed.'))
    silent = context.createGain()
    silent.gain.value = 0
    source.connect(node).connect(silent).connect(context.destination)
    return await observed
  }
  finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    if (source && node)
      source.disconnect(node)
    node?.disconnect()
    node?.port.close()
    silent?.disconnect()
    if (ownsContext)
      await context.close()
  }
}
