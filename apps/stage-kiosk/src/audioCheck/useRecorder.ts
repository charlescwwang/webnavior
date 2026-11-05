import type { AudioComparison } from '@proj-airi/stage-shared/kiosk-audio'

import type { ArrayMessage } from '../audio/capture'
import type { SpatialInput } from '../audio/spatialInput'

import { errorMessageFrom } from '@moeru/std'
import { encodeComparisonRecording } from '@proj-airi/stage-shared/kiosk-audio'
import { computed, onScopeDispose, shallowRef } from 'vue'

import workletUrl from '../audio/array.worklet?worker&url'

import { audioCheckMessages as text } from '../../../../packages/i18n/src/audioCheckMessages'
import { designWeights } from '../audio/lcmv'
import { createSpatialInput } from '../audio/spatialInput'

export type Position = 'front' | 'left' | 'right' | 'background'
type Phase = keyof typeof text.status
interface Recording {
  algorithm: 'lcmv-v1' | 'spatial-mask-v1'
  id: string
  position: Position
  files: { role: 'raw' | 'reference' | 'processed', url: string }[]
  detailsUrl: string
}

/** Owns only this page's hardware/graph and one local recording; never creates a Session or uploads. */
export function useRecorder() {
  const devices = shallowRef<MediaDeviceInfo[]>([])
  const selected = shallowRef('')
  const mapping = shallowRef('0,1,2,3,4,5,6')
  const radius = shallowRef<number | undefined>(44)
  const algorithm = shallowRef<'lcmv' | 'mask'>('lcmv')
  const position = shallowRef<Position>('front')
  const phase = shallowRef<Phase>('idle')
  const error = shallowRef('')
  const elapsed = shallowRef(0)
  const recording = shallowRef<Recording>()
  const connected = shallowRef(false)
  const supported = window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof globalThis.AudioWorkletNode === 'function'
  const busy = computed(() => ['permission', 'starting', 'recording', 'encoding'].includes(phase.value))
  let generation = 0
  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let node: AudioWorkletNode | undefined
  let sink: GainNode | undefined
  let maskSource: SpatialInput | undefined
  let pending: { id: string, position: Position, channelMap: number[], radiusMm: number, device: string } | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined

  function releaseRecording() {
    for (const file of recording.value?.files ?? []) URL.revokeObjectURL(file.url)
    if (recording.value)
      URL.revokeObjectURL(recording.value.detailsUrl)
    recording.value = undefined
  }
  function cancel() {
    node?.port.postMessage({ type: 'cancel' })
    maskSource?.cancelComparison()
    pending = undefined
    clearInterval(timer)
    clearTimeout(timeout)
    elapsed.value = 0
    phase.value = connected.value ? 'ready' : 'idle'
  }
  function stop() {
    ++generation
    cancel()
    connected.value = false
    maskSource?.dispose()
    maskSource = undefined
    source?.disconnect()
    node?.disconnect()
    node?.port.close()
    sink?.disconnect()
    stream?.getTracks().forEach(track => track.stop())
    if (context && context.state !== 'closed')
      void context.close()
    context = undefined
    stream = undefined
    node = undefined
    source = undefined
    sink = undefined
    phase.value = 'idle'
  }
  function fail(message: string) {
    stop()
    error.value = message
    phase.value = 'error'
  }
  async function listDevices() {
    stop()
    error.value = ''
    if (!supported) {
      fail(window.isSecureContext ? text.unsupported : text.insecure)
      return
    }
    const ticket = generation
    phase.value = 'permission'
    try {
      // Permission reveals device labels. Release this probe immediately; recording starts separately.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
      probe.getTracks().forEach(track => track.stop())
      const found = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput')
      if (ticket !== generation)
        return
      devices.value = found
      selected.value = found.find(device => /micArray|UMA-8/i.test(device.label) && !/monitor/i.test(device.label))?.deviceId ?? found[0]?.deviceId ?? ''
      phase.value = 'idle'
    }
    catch (cause) {
      if (ticket === generation)
        fail(errorMessageFrom(cause) ?? text.failed)
    }
  }
  async function connect() {
    stop()
    error.value = ''
    if (!supported || !selected.value) {
      fail(supported ? text.noDevices : text.insecure)
      return
    }
    const tokens = mapping.value.split(',').map(value => value.trim())
    const channelMap = tokens.map(Number)
    if (tokens.some(value => !/^[0-7]$/.test(value)) || channelMap.length !== 7 || new Set(channelMap).size !== 7 || channelMap.some(value => !Number.isInteger(value) || value < 0 || value > 7) || radius.value === undefined || !Number.isFinite(radius.value) || radius.value < 10 || radius.value > 100) {
      fail(text.invalidMapping)
      return
    }
    const ticket = generation
    phase.value = 'starting'
    try {
      // Resume on the explicit click before getUserMedia's asynchronous permission prompt.
      const next = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
      context = next
      await next.resume()
      const input = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: selected.value }, channelCount: { exact: 8 }, sampleRate: { ideal: 48000 }, autoGainControl: false, echoCancellation: false, noiseSuppression: false } })
      if (ticket !== generation) {
        input.getTracks().forEach(track => track.stop())
        return
      }
      stream = input
      if (input.getAudioTracks()[0]?.getSettings().channelCount !== 8)
        throw new Error(text.eightRequired)
      if (next.sampleRate !== 48000)
        throw new Error(text.rateRequired)
      if (algorithm.value === 'mask') {
        await next.close()
        context = undefined
        const inputSource = await createSpatialInput(input, { generation: ticket, channelMap, radiusMm: radius.value, onError: reason => ticket === generation && fail(reason) })
        if (ticket !== generation) {
          inputSource.dispose()
          return
        }
        maskSource = inputSource
        inputSource.start(async () => {})
        connected.value = true
        phase.value = 'ready'
        return
      }
      const weights = designWeights(radius.value, next.sampleRate)
      await next.audioWorklet.addModule(workletUrl)
      if (ticket !== generation)
        return
      source = next.createMediaStreamSource(input)
      node = new AudioWorkletNode(next, 'kiosk-array-lcmv', { outputChannelCount: [1], channelCount: 8, channelCountMode: 'explicit', channelInterpretation: 'discrete', processorOptions: { weights, channelMap } })
      // Keep the graph rendering while preventing live microphone feedback through speakers.
      sink = next.createGain()
      sink.gain.value = 0
      source.connect(node).connect(sink).connect(next.destination)
      node.onprocessorerror = () => ticket === generation && fail(text.failed)
      input.getAudioTracks()[0]!.onended = () => ticket === generation && fail(text.trackEnded)
      node.port.onmessage = ({ data }: MessageEvent<ArrayMessage>) => {
        if (ticket !== generation)
          return
        if (data.type === 'error') {
          fail(`${text.failed} ${data.reason}`)
          return
        }
        const capture = pending
        if (!capture || data.id !== capture.id)
          return
        pending = undefined
        clearInterval(timer)
        clearTimeout(timeout)
        phase.value = 'encoding'
        const files: Recording['files'] = []
        try {
          const base = { comparisonId: capture.id, sampleRate: 48000, algorithm: 'lcmv-v1', frameCount: data.processed.length, sampleStart: data.sampleStart, radiusMm: capture.radiusMm, loading: 0.03, channelMap: capture.channelMap, delayFrames: 1024 } as const
          if (base.frameCount !== 720000 || data.raw.length !== 5760000 || data.reference.length !== 720000)
            throw new Error(text.interrupted)
          for (const role of ['raw', 'reference', 'processed'] as const) {
            const details: AudioComparison = { ...base, role, channels: role === 'raw' ? 8 : 1 }
            files.push({ role, url: URL.createObjectURL(encodeComparisonRecording(data[role], details)) })
          }
          const info = { ...base, position: capture.position, device: capture.device, browser: navigator.userAgent, capturedAt: new Date().toISOString(), mappingVerified: false, microphoneGain: 'not-normalized', note: 'Physical mapping and direction suppression require separate validation.' }
          const detailsUrl = URL.createObjectURL(new Blob([JSON.stringify(info, null, 2)], { type: 'application/json' }))
          releaseRecording()
          recording.value = { algorithm: 'lcmv-v1', id: capture.id, position: capture.position, files, detailsUrl }
          elapsed.value = 15
          phase.value = 'complete'
        }
        catch (cause) {
          files.forEach(file => URL.revokeObjectURL(file.url))
          fail(errorMessageFrom(cause) ?? text.failed)
        }
      }
      connected.value = true
      phase.value = 'ready'
    }
    catch (cause) {
      if (ticket === generation) {
        const message = cause instanceof DOMException && cause.name === 'OverconstrainedError'
          ? text.eightRequired
          : errorMessageFrom(cause) ?? text.failed
        fail(message)
      }
    }
  }
  function record() {
    if ((!node && !maskSource) || !connected.value || busy.value)
      return
    error.value = ''
    pending = { id: crypto.randomUUID(), position: position.value, channelMap: mapping.value.split(',').map(Number), radiusMm: radius.value!, device: stream?.getAudioTracks()[0]?.label ?? '' }
    if (maskSource) {
      const capture = pending
      phase.value = 'recording'
      elapsed.value = 0
      const started = performance.now()
      timer = setInterval(() => elapsed.value = Math.min(15, (performance.now() - started) / 1000), 200)
      timeout = setTimeout(fail, 22000, text.interrupted)
      void maskSource.recordComparison().then((data) => {
        if (pending?.id !== capture.id)
          return
        pending = undefined
        clearInterval(timer)
        clearTimeout(timeout)
        const files: Recording['files'] = []
        for (const role of ['raw', 'reference', 'processed'] as const) {
          const sampleRate = role === 'raw' ? 48000 : 16000
          files.push({ role, url: URL.createObjectURL(encodeComparisonRecording(data[role], { role, channels: role === 'raw' ? 8 : 1, sampleRate, frameCount: 15 * sampleRate })) })
        }
        const info = { comparisonId: capture.id, algorithm: 'spatial-mask-v1', gate: false, durationSeconds: 15, sampleStart48k: data.sampleStart, sampleStart16k: data.sampleStart / 3, sampleRates: { raw: 48000, reference: 16000, processed: 16000 }, channelMap: capture.channelMap, radiusMm: capture.radiusMm, position: capture.position, device: capture.device, mappingVerified: false, microphoneGain: 'not-normalized', capturedAt: new Date().toISOString(), browser: navigator.userAgent, statistics: maskSource?.statistics }
        const detailsUrl = URL.createObjectURL(new Blob([JSON.stringify(info, null, 2)], { type: 'application/json' }))
        releaseRecording()
        recording.value = { algorithm: 'spatial-mask-v1', id: capture.id, position: capture.position, files, detailsUrl }
        elapsed.value = 15
        phase.value = 'complete'
      }).catch((cause) => {
        if (pending?.id === capture.id)
          fail(errorMessageFrom(cause) ?? text.failed)
      })
      return
    }
    const raw = new Float32Array(720000 * 8)
    const reference = new Float32Array(720000)
    const processed = new Float32Array(720000)
    phase.value = 'recording'
    elapsed.value = 0
    const started = performance.now()
    timer = setInterval(() => elapsed.value = Math.min(15, (performance.now() - started) / 1000), 200)
    timeout = setTimeout(fail, 22000, text.interrupted)
    node!.port.postMessage({ type: 'capture', id: pending.id, raw, reference, processed }, [raw.buffer, reference.buffer, processed.buffer])
  }
  const pagehide = () => stop()
  window.addEventListener('pagehide', pagehide)
  onScopeDispose(() => {
    stop()
    releaseRecording()
    window.removeEventListener('pagehide', pagehide)
  })
  return { devices, selected, mapping, radius, algorithm, position, phase, error, elapsed, recording, connected, supported, busy, listDevices, connect, stop, record, cancel }
}
