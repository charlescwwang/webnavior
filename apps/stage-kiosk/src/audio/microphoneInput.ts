import type { CaptureResponse } from './spatialMaskMessages'

import captureUrl from './spatialCapture.worklet?worker&url'

/** Prefer raw eight-channel capture without making ordinary devices fail getUserMedia. */
export const arrayCaptureConstraints: MediaTrackConstraints = {
  channelCount: { ideal: 8 },
  sampleRate: { ideal: 48000 },
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
}

/** Existing device-store defaults, restored on the same borrowed track before stream VAD. */
export const standardCaptureConstraints: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

/** Only the known UMA-8 geometry may use this Mask; eight channels alone do not identify an array. */
export function selectProcessing(label: string, channels: number): 'mask' | 'standard' {
  return isUma8(label) && channels === 8 ? 'mask' : 'standard'
}

/** Browser labels become available after microphone permission has been granted. */
export function isUma8(label: string): boolean {
  return /\bUMA[\s_-]*8\b/i.test(label)
}

/**
 * Observe actual discrete Worklet input, never an upmixed node or just track settings.
 * The probe records nothing and stops only its own graph. Abort retires stale probes
 * when the selected device or capture lifecycle changes.
 */
export async function inspectChannels(input: MediaStream | AudioNode, signal: AbortSignal): Promise<number> {
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
    timer = setTimeout(() => result.reject(new Error('Microphone channel detection timed out.')), 5000)
    await context.audioWorklet.addModule(captureUrl)
    signal.throwIfAborted()
    source = input instanceof MediaStream ? context.createMediaStreamSource(input) : input
    node = new AudioWorkletNode(context, 'kiosk-spatial-capture', { channelCount: 8, channelCountMode: 'max', channelInterpretation: 'discrete', outputChannelCount: [1], processorOptions: { generation: 0 } })
    node.port.onmessage = ({ data }: MessageEvent<CaptureResponse>) => {
      if (data.type === 'channels')
        result.resolve(data.count)
    }
    node.onprocessorerror = () => result.reject(new Error('Microphone channel detection failed.'))
    silent = context.createGain()
    silent.gain.value = 0
    source.connect(node).connect(silent).connect(context.destination)
    void context.resume().catch(result.reject)
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
