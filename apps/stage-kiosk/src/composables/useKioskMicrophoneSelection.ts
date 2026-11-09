import type { MicrophoneCaptureMode } from '../audio/microphoneInput'

import { isMissingAudioInputDeviceError } from '@proj-airi/stage-ui/composables/audio/audio-device'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings/audio-device'
import { useLocalStorage } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onScopeDispose, readonly, shallowRef, watch } from 'vue'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { arrayCaptureConstraints, standardCaptureConstraints } from '../audio/microphoneInput'

// The shared device store deduplicates acquisition globally. Serialize Kiosk
// acquisitions across Scene owners too: a retired permission request must drain
// and release its late stream before the next device can acquire that store.
let captureQueue = Promise.resolve()

/** Owns draft, successfully saved, and live microphone identities independently. */
export function useKioskMicrophoneSelection() {
  const device = useSettingsAudioDevice()
  const { captureConstraints, selectedAudioInput, enabled, audioInputs, stream } = storeToRefs(device)
  const saved = useLocalStorage('kiosk/audio/input-device', '')
  const microphone = shallowRef(saved.value)
  const activeMicrophone = shallowRef('')
  const captureMode = shallowRef<MicrophoneCaptureMode>('raw')
  const busy = shallowRef(false)
  const text = orderingMessages['zh-Hant'].arrayAudio
  const devices = shallowRef<readonly MediaDeviceInfo[]>(audioInputs.value)
  const authorization = shallowRef<'unknown' | 'granted' | 'denied'>('unknown')
  watch(audioInputs, inputs => devices.value = inputs)
  const selected = computed(() => microphone.value && !['default', 'communications', '__automatic__'].includes(microphone.value) ? microphone.value : '')
  let generation = 0
  let disposed = false
  const message = computed(() => {
    if (!selected.value)
      return text.chooseMicrophone
    if (authorization.value === 'granted' && devices.value.length && !devices.value.some(input => input.deviceId === selected.value))
      return text.microphoneUnavailable
    return ''
  })
  function stop() {
    ++generation
    busy.value = false
    enabled.value = false
    activeMicrophone.value = ''
    device.stopStream()
  }
  function pin(id: string, mode: MicrophoneCaptureMode = 'raw') {
    captureMode.value = mode
    selectedAudioInput.value = id
    captureConstraints.value = {
      ...(mode === 'standard' ? standardCaptureConstraints : arrayCaptureConstraints),
      // An empty/default ID permits implicit browser selection. Until there is
      // an explicit choice, block shared capture; consent discovery is separate.
      deviceId: { exact: id || '__kiosk_microphone_selection_required__' },
    }
  }
  stop()
  pin(selected.value)

  function check(ticket: number, signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (disposed || ticket !== generation)
      throw new DOMException('Microphone operation retired.', 'AbortError')
  }
  async function start(signal?: AbortSignal, mode: MicrophoneCaptureMode = 'raw') {
    const id = selected.value
    if (!id)
      throw new Error(text.chooseMicrophone)
    stop()
    const ticket = generation
    busy.value = true
    const operation = captureQueue.then(async () => {
      check(ticket, signal)
      pin(id, mode)
      // Let the shared enabled=false watcher finish stopping the old stream
      // before acquiring the new one; otherwise it can close newly acquired audio.
      await nextTick()
      check(ticket, signal)
      try {
        await device.startStream()
        check(ticket, signal)
        const track = stream.value?.getAudioTracks()[0]
        if (!track || track.readyState !== 'live' || track.getSettings().deviceId !== id)
          throw new Error(text.microphoneMismatch)
        activeMicrophone.value = id
        authorization.value = 'granted'
        saved.value = id
      }
      catch (cause) {
        // No newer acquisition has run yet: queue ownership makes this cleanup
        // safe even when this owner's permission request completed after stop().
        device.stopStream()
        if (cause instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError'].includes(cause.name)) {
          if (ticket === generation)
            authorization.value = 'denied'
          throw new DOMException(text.microphonePermissionDenied, 'NotAllowedError')
        }
        if (isMissingAudioInputDeviceError(cause))
          throw new Error(text.microphoneUnavailable, { cause })
        throw cause
      }
    })
    captureQueue = operation.catch(() => {})
    try {
      await operation
    }
    finally {
      if (ticket === generation)
        busy.value = false
    }
  }
  async function requestDevices(signal?: AbortSignal) {
    stop()
    const ticket = generation
    busy.value = true
    const operation = captureQueue.then(async () => {
      check(ticket, signal)
      let consent: MediaStream | undefined
      try {
        // NOTICE: useDevicesList's cached permissionGranted can survive a browser
        // revocation (`@vueuse/core/dist/index.js`, useDevicesList.ensurePermissions).
        // Explicit consent/retry therefore owns a fresh native request, using the
        // same late-stream cleanup pattern as useKioskProactiveVision. This stream
        // is never assigned to capture, VAD or ASR, and never saves a device choice.
        consent = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        check(ticket, signal)
        const discovered = await navigator.mediaDevices.enumerateDevices()
        check(ticket, signal)
        devices.value = discovered.filter(input => input.kind === 'audioinput')
        authorization.value = 'granted'
      }
      catch (cause) {
        if (cause instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError'].includes(cause.name)) {
          if (ticket === generation)
            authorization.value = 'denied'
          throw new DOMException(text.microphonePermissionDenied, 'NotAllowedError')
        }
        throw cause
      }
      finally {
        consent?.getTracks().forEach(track => track.stop())
      }
    })
    captureQueue = operation.catch(() => {})
    try {
      await operation
    }
    finally {
      if (ticket === generation)
        busy.value = false
    }
  }
  onScopeDispose(() => {
    disposed = true
    stop()
    // Keep the retiring device pin until any pending native request drains.
    // A later Scene installs its own pin when it acquires the shared queue.
  })
  return { microphone, captureMode: readonly(captureMode), savedMicrophone: readonly(saved), activeMicrophone: readonly(activeMicrophone), permissionState: readonly(authorization), devices: readonly(devices), busy: readonly(busy), hasSelection: computed(() => Boolean(selected.value)), message, start, stop, requestDevices }
}
