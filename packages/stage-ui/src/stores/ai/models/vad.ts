import type { MaybeRefOrGetter } from 'vue'

import type { BaseVADConfig, VADEvents } from '../../../libs/audio/vad'

import { merge } from '@moeru/std'
import { errorMessageFromValue } from '@proj-airi/stage-shared'
import { ref, toRef, toValue, watch } from 'vue'

import { createVAD, createVADStates } from '../../../workers/vad'

interface UseVADOptions {
  /** External PCM owns capture/resampling; no second AudioContext or microphone graph is allocated. */
  externalPCM?: MaybeRefOrGetter<boolean>
  /** Gates new phrases before inference; an admitted phrase still runs through its ending silence. */
  canStartSpeech?: (endTimeMs?: number) => boolean
  threshold?: MaybeRefOrGetter<number>
  minSilenceDurationMs?: MaybeRefOrGetter<number>
  speechPadMs?: MaybeRefOrGetter<number>
  minSpeechDurationMs?: MaybeRefOrGetter<number>
  maxSpeechDurationS?: MaybeRefOrGetter<number>

  onSpeechStart?: () => void
  /** Every inferred score, even when unchanged; local interruption must not count the VAD silence tail as speech. */
  onSpeechProbability?: (probability: number, timeMs: number) => void
  onSpeechEnd?: () => void
  onSpeechReady?: (event: VADEvents['speech-ready']) => void
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

  const threshold = toRef(options.threshold)
  const minSilenceDurationMs = toRef(options.minSilenceDurationMs)
  const speechPadMs = toRef(options.speechPadMs)
  const minSpeechDurationMs = toRef(options.minSpeechDurationMs)
  const maxSpeechDurationS = toRef(options.maxSpeechDurationS)
  let generation = 0

  async function init() {
    if (loaded.value || loading.value || manager.value)
      return

    loading.value = true
    inferenceError.value = ''
    const owner = ++generation

    try {
      const vadConfig = resolveVADConfig(
        threshold.value,
        minSilenceDurationMs.value,
        speechPadMs.value,
        minSpeechDurationMs.value,
        maxSpeechDurationS.value,
      )

      const processor = await createVAD({
        sampleRate: 16000,
        ...vadConfig,
      })
      if (owner !== generation) {
        await processor.dispose()
        return
      }
      vad.value = processor

      // Set up event handlers
      vad.value.on('speech-start', () => {
        isSpeech.value = true
        options?.onSpeechStart?.()
      })

      vad.value.on('speech-end', () => {
        isSpeech.value = false
        options?.onSpeechEnd?.()
      })

      vad.value.on('speech-ready', (event) => {
        options?.onSpeechReady?.(event)
      })

      vad.value.on('debug', ({ data }) => {
        if (data?.probability !== undefined) {
          isSpeechProb.value = data.probability
          options?.onSpeechProbability?.(data.probability, performance.now())

          // Update VAD history for visualization
          isSpeechHistory.value.push(data.probability)
          if (isSpeechHistory.value.length > maxIsSpeechHistory) {
            isSpeechHistory.value.shift()
          }
        }
      })

      vad.value.on('status', ({ type, message }) => {
        if (type === 'error') {
          inferenceError.value = message
        }
      })

      if (toValue(options?.externalPCM)) {
        loaded.value = true
        return
      }

      // Create and initialize audio manager
      const m = createVADStates(vad.value, workerUrl, {
        minChunkSize: 512,
        canStartSpeech: options?.canStartSpeech,
        // NOTICE: VAD will have it's own audio context since
        // it needs special sample rate and latency settings
        audioContextOptions: {
          sampleRate: 16000,
          latencyHint: 'interactive',
        },
      })

      await m.initialize()
      if (owner !== generation) {
        m.dispose()
        await processor.dispose()
        return
      }
      manager.value = m
      loaded.value = true
    }
    catch (error) {
      if (owner === generation)
        inferenceError.value = errorMessageFromValue(error)
    }
    finally {
      if (owner === generation)
        loading.value = false
    }
  }

  async function start(stream: MediaStream) {
    if (manager.value)
      await manager.value.start(stream)
  }

  /** Feeds externally processed, source-clocked PCM without a second browser resampler. */
  async function processAudio(input: Float32Array, endTimeMs: number, recording = input) {
    if (!vad.value || !loaded.value)
      throw new Error('VAD must be loaded before external PCM can be processed.')
    await vad.value.processAudio(input, endTimeMs, recording, options?.canStartSpeech?.(endTimeMs) ?? true)
  }

  function dispose() {
    generation++
    manager.value?.stop()
    manager.value?.dispose()
    manager.value = undefined
    void vad.value?.dispose().catch(error => console.error('Failed to release VAD model:', error))
    vad.value = undefined

    isSpeech.value = false
    isSpeechProb.value = 0
    isSpeechHistory.value = []

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
    threshold,
    minSilenceDurationMs,
    speechPadMs,
    minSpeechDurationMs,
    maxSpeechDurationS,

    init,
    processAudio,
    start,
    dispose,
  }
}
