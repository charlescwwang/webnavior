import { errorMessageFrom } from '@moeru/std'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { shallowRef, watch } from 'vue'

import { useAudioDevice } from '../../composables/audio'

let microphonePermissionStatus: PermissionStatus

/** Browser acquisition failure, retained until the operator retries capture. */
export interface AudioInputFailure {
  name: string
  message: string
  constraint?: string
}

function inputFailure(error: unknown): AudioInputFailure {
  const detail = error && typeof error === 'object' ? error : undefined
  const name = detail && 'name' in detail && typeof detail.name === 'string' ? detail.name : 'MicrophoneError'
  const constraint = detail && 'constraint' in detail && typeof detail.constraint === 'string' ? detail.constraint : undefined
  // Chromium may provide an empty message for OverconstrainedError. Preserve
  // the name and constraint instead of rendering a blank connection failure.
  const message = [name, constraint ? `(${constraint})` : undefined, errorMessageFrom(error)?.trim()].filter(Boolean).join(' ')
  return { name, message, constraint }
}

export const useSettingsAudioDevice = defineStore('settings-audio-devices', () => {
  const {
    audioInputs,
    deviceConstraints,
    inputConstraints,
    selectedAudioInput: selectedAudioInputNonPersist,
    permissionGranted,
    permissionState,
    startStream: startAudioInputStream,
    stopStream: stopAudioInputStream,
    stream,
    askPermission: askAudioInputPermission,
  } = useAudioDevice()

  const selectedAudioInputPersist = useLocalStorageManualReset<string>('settings/audio/input', selectedAudioInputNonPersist.value)
  const audioInputEnabled = useLocalStorageManualReset<boolean>('settings/audio/input/enabled', false)
  // External native capture owns the device while enabled remains the user's
  // listening preference. It must never allocate a competing browser stream.
  const browserCaptureEnabled = shallowRef(true)
  const inputError = shallowRef<AudioInputFailure>()
  let audioInputStartGeneration = 0
  let audioInputStart: ReturnType<typeof startAudioInputStream> | undefined

  function syncSelectedAudioInputFromRuntime() {
    if (selectedAudioInputPersist.value !== selectedAudioInputNonPersist.value)
      selectedAudioInputPersist.value = selectedAudioInputNonPersist.value
  }

  function syncSelectedAudioInputToRuntime() {
    if (selectedAudioInputPersist.value && selectedAudioInputPersist.value !== selectedAudioInputNonPersist.value)
      selectedAudioInputNonPersist.value = selectedAudioInputPersist.value
  }

  async function askPermission() {
    syncSelectedAudioInputToRuntime()
    try {
      await askAudioInputPermission()
    }
    catch (error) {
      inputError.value = inputFailure(error)
      throw error
    }
    syncSelectedAudioInputFromRuntime()
  }

  function createAudioInputStartGeneration() {
    audioInputStartGeneration += 1
    return audioInputStartGeneration
  }

  function invalidateAudioInputStarts() {
    audioInputStartGeneration += 1
  }

  /** Reuses the active browser request so concurrent consumers cannot allocate duplicate streams. */
  function getOrStartAudioInputStream() {
    if (audioInputStart)
      return audioInputStart

    inputError.value = undefined
    const currentStart = startAudioInputStream()
    audioInputStart = currentStart
    const clearCurrentStart = () => {
      if (audioInputStart === currentStart)
        audioInputStart = undefined
    }
    void currentStart.then(clearCurrentStart, (error) => {
      inputError.value = inputFailure(error)
      clearCurrentStart()
    })
    return currentStart
  }

  async function startStreamForGeneration(generation: number) {
    syncSelectedAudioInputToRuntime()
    await getOrStartAudioInputStream()

    if (generation === audioInputStartGeneration)
      syncSelectedAudioInputFromRuntime()
  }

  async function startStream() {
    if (!browserCaptureEnabled.value)
      return
    await startStreamForGeneration(createAudioInputStartGeneration())
  }

  function stopStream() {
    invalidateAudioInputStarts()
    stopAudioInputStream()
  }

  function handleStartStreamError(generation: number, error: unknown, message: string) {
    console.error(message, error)

    if (generation === audioInputStartGeneration)
      audioInputEnabled.value = false
  }

  watch(selectedAudioInputPersist, (newValue) => {
    selectedAudioInputNonPersist.value = newValue
  })

  watch([audioInputEnabled, browserCaptureEnabled], ([val, browser]) => {
    if (val && browser) {
      const generation = createAudioInputStartGeneration()
      startStreamForGeneration(generation).catch((error) => {
        handleStartStreamError(generation, error, 'Unable to start audio input stream:')
      })
    }
    else {
      stopStream()
    }
  })

  // permissionGranted from vueuse does not track revocation yet.
  // implement it manually.
  try {
    navigator?.permissions?.query({ name: 'microphone' }).then((status) => {
      microphonePermissionStatus = status // existing one cleaned up by GC
      status.onchange = () => {
        if (browserCaptureEnabled.value && (status.state === 'denied' || status.state === 'prompt')) {
          permissionState.value = status.state === 'denied' ? 'denied' : 'idle'
          inputError.value = { name: 'NotAllowedError', message: `NotAllowedError: microphone permission changed to ${status.state}` }
          audioInputEnabled.value = false
        }
      }
    })
  }
  catch (e) { console.info(`Unable to track microphone permission: ${e}`) }
  void microphonePermissionStatus // suppress unused variable lint
  function initialize() {
    const hasSelectedInput = selectedAudioInputPersist.value
      && audioInputs.value.some(device => device.deviceId === selectedAudioInputPersist.value)

    if (hasSelectedInput)
      syncSelectedAudioInputToRuntime()

    if (browserCaptureEnabled.value && audioInputEnabled.value && hasSelectedInput) {
      const generation = createAudioInputStartGeneration()
      startStreamForGeneration(generation).catch((error) => {
        handleStartStreamError(generation, error, 'Unable to initialize audio input stream:')
      })
    }
    else if (selectedAudioInputPersist.value && audioInputs.value.length > 0 && !hasSelectedInput) {
      selectedAudioInputPersist.value = selectedAudioInputNonPersist.value
    }
    if (selectedAudioInputNonPersist.value && !audioInputEnabled.value) {
      selectedAudioInputPersist.value = selectedAudioInputNonPersist.value
    }
  }

  function resetState() {
    inputError.value = undefined
    selectedAudioInputPersist.reset()
    selectedAudioInputNonPersist.value = ''
    audioInputEnabled.reset()
    stopStream()
  }

  return {
    audioInputs,
    deviceConstraints,
    inputConstraints,
    selectedAudioInput: selectedAudioInputPersist,
    enabled: audioInputEnabled,
    permissionGranted,
    permissionState,
    inputError,
    browserCaptureEnabled,

    stream,

    initialize,

    askPermission,
    startStream,
    stopStream,
    resetState,
  }
})
