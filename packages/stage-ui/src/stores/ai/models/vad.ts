import type { MaybeRefOrGetter } from 'vue'

import type { PcmLevel } from '../../../libs/audio/inputGain'
import type { BaseVADConfig } from '../../../libs/audio/vad'

import { merge } from '@moeru/std'
import { errorMessageFromValue } from '@proj-airi/stage-shared'
import { ref, toRef, watch } from 'vue'

import { InputGain, measurePcmLevel } from '../../../libs/audio/inputGain'
import { createVAD, createVADStates } from '../../../workers/vad'

/** Current capture generation metadata only; no PCM or transcript is retained. */
export interface VadInputDiagnostics {
  processedSamples: number
  inputLevel?: PcmLevel
  outputLevel?: PcmLevel
  probability: number
  maximumProbability: number
  speechStarts: number
  speechSegments: number
}

interface UseVADOptions {
  /** Fixed input gain before inference and ASR buffering; ordinary inputs default to 0 dB. */
  inputGainDb?: MaybeRefOrGetter<number>
  threshold?: MaybeRefOrGetter<number>
  minSilenceDurationMs?: MaybeRefOrGetter<number>
  speechPadMs?: MaybeRefOrGetter<number>
  minSpeechDurationMs?: MaybeRefOrGetter<number>
  maxSpeechDurationS?: MaybeRefOrGetter<number>

  onSpeechStart?: () => void
  onSpeechEnd?: () => void
  onSpeechReady?: (event: { buffer: Float32Array, duration: number }) => void
}

const DEFAULT_VAD_THRESHOLD = 0.52
const DEFAULT_VAD_MIN_SILENCE_DURATION_MS = 1200
const DEFAULT_VAD_SPEECH_PAD_MS = 360
const DEFAULT_VAD_MIN_SPEECH_DURATION_MS = 300
const DEFAULT_VAD_MAX_SPEECH_DURATION_S = 30

export function resolveVADConfig(
  threshold?: number,
  minSilenceDurationMs?: number,
  speechPadMs?: number,
  minSpeechDurationMs?: number,
  maxSpeechDurationS?: number,
): Pick<BaseVADConfig, 'speechThreshold' | 'exitThreshold' | 'minSilenceDurationMs' | 'speechPadMs' | 'minSpeechDurationMs' | 'maxBufferDuration'> {
  const resolvedThreshold = threshold ?? DEFAULT_VAD_THRESHOLD

  return {
    speechThreshold: resolvedThreshold,
    exitThreshold: resolvedThreshold * 0.3,
    minSilenceDurationMs: minSilenceDurationMs ?? DEFAULT_VAD_MIN_SILENCE_DURATION_MS,
    speechPadMs: speechPadMs ?? DEFAULT_VAD_SPEECH_PAD_MS,
    minSpeechDurationMs: minSpeechDurationMs ?? DEFAULT_VAD_MIN_SPEECH_DURATION_MS,
    maxBufferDuration: maxSpeechDurationS ?? DEFAULT_VAD_MAX_SPEECH_DURATION_S,
  }
}

export function useVAD(workerUrl: string, options?: UseVADOptions) {
  const defaultOptions: UseVADOptions = {
    threshold: ref(DEFAULT_VAD_THRESHOLD),
    minSilenceDurationMs: ref(DEFAULT_VAD_MIN_SILENCE_DURATION_MS),
    speechPadMs: ref(DEFAULT_VAD_SPEECH_PAD_MS),
    minSpeechDurationMs: ref(DEFAULT_VAD_MIN_SPEECH_DURATION_MS),
    maxSpeechDurationS: ref(DEFAULT_VAD_MAX_SPEECH_DURATION_S),
  }

  options = merge(defaultOptions, options)

  const vad = ref<Awaited<ReturnType<typeof createVAD>>>()
  const manager = ref<ReturnType<typeof createVADStates>>()
  const inferenceError = ref<string>()
  const maxIsSpeechHistory = 50

  const isSpeech = ref(false)
  const isSpeechProb = ref(0)
  const isSpeechHistory = ref<number[]>([])

  const loaded = ref(false)
  const loading = ref(false)

  let generation = 0
  const inputGainDb = toRef(options.inputGainDb)
  const inputClippedSamples = ref(0)
  const inputGain = new InputGain()
  const diagnostics: VadInputDiagnostics = { processedSamples: 0, probability: 0, maximumProbability: 0, speechStarts: 0, speechSegments: 0 }
  async function processInput(samples: Float32Array) {
    if (!vad.value)
      throw new Error('VAD input is not initialized.')
    const result = inputGain.process(samples, inputGainDb.value ?? 0)
    inputClippedSamples.value += result.clippedSamples
    diagnostics.inputLevel = measurePcmLevel(samples)
    diagnostics.outputLevel = measurePcmLevel(result.samples)
    const ticket = generation
    await vad.value.processAudio(result.samples)
    if (ticket === generation)
      diagnostics.processedSamples += samples.length
  }

  const threshold = toRef(options.threshold)
  const minSilenceDurationMs = toRef(options.minSilenceDurationMs)
  const speechPadMs = toRef(options.speechPadMs)
  const minSpeechDurationMs = toRef(options.minSpeechDurationMs)
  const maxSpeechDurationS = toRef(options.maxSpeechDurationS)

  let inputMode: 'stream' | 'pcm' = 'stream'
  async function init(mode: 'stream' | 'pcm' = 'stream') {
    if (loaded.value || loading.value || manager.value)
      return

    inputMode = mode
    const ticket = ++generation
    loading.value = true
    inferenceError.value = ''

    try {
      const vadConfig = resolveVADConfig(
        threshold.value,
        minSilenceDurationMs.value,
        speechPadMs.value,
        minSpeechDurationMs.value,
        maxSpeechDurationS.value,
      )

      const created = await createVAD({
        sampleRate: 16000,
        ...vadConfig,
      })

      if (ticket !== generation)
        return
      // Set up event handlers
      vad.value = created
      vad.value.on('speech-start', () => {
        if (ticket !== generation)
          return
        diagnostics.speechStarts += 1
        isSpeech.value = true
        options?.onSpeechStart?.()
      })

      vad.value.on('speech-end', () => {
        if (ticket !== generation)
          return
        isSpeech.value = false
        options?.onSpeechEnd?.()
      })

      vad.value.on('speech-ready', (event) => {
        if (ticket !== generation)
          return
        diagnostics.speechSegments += 1
        options?.onSpeechReady?.(event)
      })

      vad.value.on('debug', ({ data }) => {
        if (ticket !== generation)
          return
        if (data?.probability !== undefined) {
          diagnostics.probability = data.probability
          diagnostics.maximumProbability = Math.max(diagnostics.maximumProbability, data.probability)
          isSpeechProb.value = data.probability

          // Update VAD history for visualization
          isSpeechHistory.value.push(data.probability)
          if (isSpeechHistory.value.length > maxIsSpeechHistory) {
            isSpeechHistory.value.shift()
          }
        }
      })

      vad.value.on('status', ({ type, message }) => {
        if (ticket !== generation)
          return
        if (type === 'error') {
          inferenceError.value = message
        }
      })

      if (inputMode === 'stream') {
        // Create and initialize audio manager
        const m = createVADStates({
          async processAudio(samples) {
            // A queued message from a retired graph cannot feed the new VAD or
            // inherit its selected microphone's gain.
            if (ticket !== generation)
              return
            await processInput(samples)
          },
        }, workerUrl, {
          minChunkSize: 512,
          // NOTICE: VAD will have it's own audio context since
          // it needs special sample rate and latency settings
          audioContextOptions: {
            sampleRate: 16000,
            latencyHint: 'interactive',
          },
        })

        await m.initialize()
        if (ticket !== generation) {
          m.dispose()
          return
        }
        manager.value = m
      }
      loaded.value = true
    }
    catch (error) {
      if (ticket === generation)
        inferenceError.value = errorMessageFromValue(error)
    }
    finally {
      if (ticket === generation)
        loading.value = false
    }
  }

  async function start(stream: MediaStream) {
    if (manager.value)
      await manager.value.start(stream)
  }

  /** Already-resampled PCM, delivered serially by its owning input generation. */
  async function processPcm(samples: Float32Array) {
    if (inputMode !== 'pcm' || !loaded.value || !vad.value)
      throw new Error('PCM VAD input is not initialized.')
    if (!samples.length || samples.length > 512 || samples.some(value => !Number.isFinite(value)))
      throw new Error('Expected at most 512 finite 16kHz PCM samples.')
    await processInput(samples)
  }

  function dispose() {
    generation += 1
    manager.value?.stop()
    manager.value?.dispose()
    manager.value = undefined

    isSpeech.value = false
    isSpeechProb.value = 0
    isSpeechHistory.value = []

    diagnostics.processedSamples = 0
    diagnostics.inputLevel = undefined
    diagnostics.outputLevel = undefined
    diagnostics.probability = 0
    diagnostics.maximumProbability = 0
    diagnostics.speechStarts = 0
    diagnostics.speechSegments = 0
    inputGain.reset()
    inputClippedSamples.value = 0
    loaded.value = false
    loading.value = false
  }

  watch(threshold, (newVal) => {
    if (vad.value && newVal !== undefined) {
      vad.value.updateConfig({ speechThreshold: newVal, exitThreshold: newVal * 0.3 })
    }
  })

  watch(minSilenceDurationMs, (newVal) => {
    if (vad.value && newVal !== undefined) {
      vad.value.updateConfig({ minSilenceDurationMs: newVal })
    }
  })

  watch(speechPadMs, (newVal) => {
    if (vad.value && newVal !== undefined) {
      vad.value.updateConfig({ speechPadMs: newVal })
    }
  })

  watch(minSpeechDurationMs, (newVal) => {
    if (vad.value && newVal !== undefined) {
      vad.value.updateConfig({ minSpeechDurationMs: newVal })
    }
  })

  watch(maxSpeechDurationS, (newVal) => {
    if (vad.value && newVal !== undefined)
      vad.value.updateConfig({ maxBufferDuration: newVal })
  })

  return {
    isSpeech,
    isSpeechProb,
    isSpeechHistory,
    loaded,
    loading,
    inferenceError,
    inputClippedSamples,
    getInputDiagnostics: (): VadInputDiagnostics => ({ ...diagnostics }),
    threshold,
    minSilenceDurationMs,
    speechPadMs,
    minSpeechDurationMs,
    maxSpeechDurationS,

    init,
    start,
    processPcm,
    dispose,
  }
}
