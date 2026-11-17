<script setup lang="ts">
import type { SpeechRecognitionPolicy } from '@proj-airi/stage-shared/falcon-settings'

import { errorMessageFrom } from '@moeru/std'
import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { Button, FieldSelect } from '@proj-airi/ui'
import { useDevicesList, useLocalStorage } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onScopeDispose, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import KioskMicrophoneSettings from './KioskMicrophoneSettings.vue'

import { applyAudioOutput, audioOutputStorageKey } from '../services/kioskAudioOutput'
import { playKioskAudio } from '../services/kioskPlayback'

const props = defineProps<{ textOnlyMode?: boolean, recognitionMode?: SpeechRecognitionPolicy['mode'] }>()
const { t } = useI18n()
const devices = useSettingsAudioDevice()
const { audioInputs, selectedAudioInput, stream } = storeToRefs(devices)
const refreshing = shallowRef(false)
const error = shallowRef<string>()
const testing = shallowRef(false)
let testController: AbortController | undefined
onScopeDispose(() => testController?.abort())
const outputs = useDevicesList({ constraints: { audio: true }, requestPermissions: false })
const outputDeviceId = useLocalStorage(audioOutputStorageKey, '')
const { audioContext } = useAudioContext()
// Reka Select reserves an empty value for clearing. The capture policy uses
// an empty device id to mean browser default, so translate only at this UI edge.
const microphoneSelection = computed({ get: () => selectedAudioInput.value || '__system_default__', set: (value: string) => selectedAudioInput.value = value === '__system_default__' ? '' : value })
const outputSelection = computed({ get: () => outputDeviceId.value || '__system_default__', set: (value: string) => void selectOutput(value === '__system_default__' ? '' : value) })
const microphoneOptions = computed(() => [
  { value: '__system_default__', label: t('stage.kiosk.media-devices.system-default') },
  ...audioInputs.value.map((device, index) => ({ value: device.deviceId, label: device.label || t('stage.kiosk.media-devices.unnamed-microphone', { number: index + 1 }) })),
])
const outputOptions = computed(() => [
  { value: '__system_default__', label: t('stage.kiosk.media-devices.system-default') },
  ...outputs.audioOutputs.value.map((device, index) => ({ value: device.deviceId, label: device.label || t('stage.kiosk.media-devices.unnamed-output', { number: index + 1 }) })),
])

async function selectOutput(deviceId: string) {
  error.value = undefined
  try {
    // Validate both audible paths before persisting: cues use media elements,
    // while avatar TTS uses the shared Web Audio graph.
    await applyAudioOutput(new Audio(), deviceId)
    await applyAudioOutput(audioContext, deviceId)
    outputDeviceId.value = deviceId
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? t('stage.kiosk.media-devices.failed')
  }
}

async function refresh() {
  refreshing.value = true
  error.value = undefined
  try {
    await devices.askPermission()
    if (!props.textOnlyMode) {
      devices.enabled = true
      if (!stream.value)
        await devices.startStream()
    }
    await outputs.ensurePermissions()
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? t('stage.kiosk.media-devices.failed')
  }
  finally {
    refreshing.value = false
  }
}

async function testOutput() {
  testController?.abort()
  const controller = new AbortController()
  testController = controller
  testing.value = true
  error.value = undefined
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}audio/kiosk_acknowledged_chime.wav`, { signal: controller.signal })
    if (!response.ok)
      throw new Error(t('stage.kiosk.media-devices.failed'))
    const audio = (await response.blob()).slice(0, undefined, 'audio/wav')
    const result = await playKioskAudio(audio, controller.signal).finished
    if (result.kind === 'failed')
      throw new Error(result.message)
  }
  catch (cause) {
    if (!controller.signal.aborted)
      error.value = errorMessageFrom(cause) ?? t('stage.kiosk.media-devices.failed')
  }
  finally {
    if (testController === controller) {
      testController = undefined
      testing.value = false
    }
  }
}
</script>

<template>
  <section :class="['admin-section grid gap-3']">
    <h3>{{ t('stage.kiosk.media-devices.title') }}</h3>
    <p>{{ t('stage.kiosk.media-devices.description') }}</p>
    <FieldSelect v-model="microphoneSelection" :label="t('stage.kiosk.media-devices.microphone')" :options="microphoneOptions" layout="vertical" />
    <FieldSelect v-model="outputSelection" :label="t('stage.kiosk.media-devices.output')" :options="outputOptions" layout="vertical" />
    <KioskMicrophoneSettings :recognition-mode="props.recognitionMode" />
    <p role="status">
      {{ t(stream?.getAudioTracks().some(track => track.readyState === 'live') ? 'stage.kiosk.media-devices.connected' : 'stage.kiosk.media-devices.disconnected') }}
    </p>
    <Button :disabled="refreshing" @click="refresh">
      {{ t(refreshing ? 'stage.kiosk.media-devices.refreshing' : 'stage.kiosk.media-devices.refresh') }}
    </Button>
    <Button :disabled="testing" @click="testOutput">
      {{ t('stage.kiosk.media-devices.test-output') }}
    </Button>
    <p v-if="error" role="alert">
      {{ error }}
    </p>
  </section>
</template>
