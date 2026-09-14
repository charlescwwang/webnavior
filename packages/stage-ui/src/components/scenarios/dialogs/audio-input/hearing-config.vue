<script setup lang="ts">
import { Callout, FieldCheckbox, FieldCombobox } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

import { useAudioAnalyzer } from '../../../../composables'
import { useSettingsAudioDevice } from '../../../../stores'

const deviceStore = useSettingsAudioDevice()
const { audioInputs, enabled, permissionGranted, permissionState, selectedAudioInput } = storeToRefs(deviceStore)
const { askPermission } = deviceStore
const { volumeLevel } = useAudioAnalyzer()

const autoSend = defineModel<boolean | undefined>('autoSend')
const hasAutoSendControl = computed(() => autoSend.value !== undefined)
const autoSendEnabled = computed({
  get: () => autoSend.value ?? false,
  set: value => autoSend.value = value,
})
const permissionMessage = computed(() => {
  if (permissionState.value === 'denied')
    return 'Microphone access was denied. Choose Allow in your browser settings, then try again.'
  if (permissionState.value === 'unavailable')
    return 'No microphone is available. Connect or select a microphone, then try again.'
  return undefined
})
const hearingToggleLabel = computed(() => {
  if (enabled.value)
    return 'Disable microphone input'
  if (permissionState.value === 'denied' || permissionState.value === 'unavailable')
    return 'Retry microphone permission'
  return 'Enable microphone input'
})
const hearingToggleClass = computed(() => [
  'absolute left-1/2 top-1/2 grid h-16 w-16 place-items-center outline-none -translate-x-1/2 -translate-y-1/2',
  'rounded-2xl backdrop-blur-md',
  'transition-colors duration-150 ease-in-out',
  'focus-visible:ring-2 focus-visible:ring-primary-400/40',
  'active:scale-95',
  enabled.value
    ? [
        'border-2 border-solid border-primary-300/30 bg-primary-200/90~45 text-primary-950',
        'hover:border-primary-400/55 active:border-primary-500/60',
        'dark:border-primary-400/30 dark:bg-primary-500/75~45*90 dark:text-primary-50',
        'dark:hover:border-primary-300/55 dark:active:border-primary-300/70',
      ]
    : [
        'border-2 border-solid border-neutral-300/40 bg-neutral-100/70 text-neutral-700',
        'hover:border-neutral-400/55 active:border-neutral-500/60',
        'dark:border-neutral-700/45 dark:bg-neutral-800/70 dark:text-neutral-200',
        'dark:hover:border-neutral-600/65 dark:active:border-neutral-500/70',
      ],
])
const ringEnabledClass = computed(() => enabled.value
  ? 'bg-primary-500/15 dark:bg-primary-600/20'
  : 'bg-neutral-300/20 dark:bg-neutral-700/20',
)

async function toggleHearingEnabled() {
  if (enabled.value)
    return enabled.value = false

  // This function is called directly by the visible microphone button. Keep
  // getUserMedia within that user gesture so mobile browsers can display the
  // permission prompt instead of suppressing it after a dialog watcher runs.
  try {
    if (!permissionGranted.value)
      await askPermission()
    enabled.value = permissionGranted.value || permissionState.value === 'granted'
  }
  catch {
    enabled.value = false
  }
}
</script>

<template>
  <div class="space-y-2">
    <!-- Minimal mic control with animated rings -->
    <div class="flex flex-col items-center justify-center py-2">
      <div class="relative h-28 w-28 select-none">
        <!-- Rings (scale + opacity follow volume) -->
        <div
          class="absolute left-1/2 top-1/2 h-20 w-20 rounded-full transition-all duration-150 -translate-x-1/2 -translate-y-1/2"
          :style="{ transform: `translate(-50%, -50%) scale(${1 + (volumeLevel / 100) * 0.35})`, opacity: String(0.25 + (volumeLevel / 100) * 0.25) }"
          :class="ringEnabledClass"
        />
        <div
          class="absolute left-1/2 top-1/2 h-24 w-24 rounded-full transition-all duration-200 -translate-x-1/2 -translate-y-1/2"
          :style="{ transform: `translate(-50%, -50%) scale(${1.2 + (volumeLevel / 100) * 0.55})`, opacity: String(0.15 + (volumeLevel / 100) * 0.2) }"
          :class="enabled ? 'bg-primary-500/10 dark:bg-primary-600/15' : 'bg-neutral-300/10 dark:bg-neutral-700/10'"
        />
        <div
          class="absolute left-1/2 top-1/2 h-28 w-28 rounded-full transition-all duration-300 -translate-x-1/2 -translate-y-1/2"
          :style="{ transform: `translate(-50%, -50%) scale(${1.5 + (volumeLevel / 100) * 0.8})`, opacity: String(0.08 + (volumeLevel / 100) * 0.15) }"
          :class="enabled ? 'bg-primary-500/5 dark:bg-primary-600/10' : 'bg-neutral-300/5 dark:bg-neutral-700/5'"
        />

        <!-- Mic icon button -->
        <button
          :aria-label="hearingToggleLabel"
          :title="hearingToggleLabel"
          :class="hearingToggleClass"
          @click="toggleHearingEnabled"
        >
          <div :class="enabled ? 'i-ph:microphone' : 'i-ph:microphone-slash'" class="h-6 w-6" />
        </button>
      </div>

      <div class="mt-3 h-1" />

      <div v-if="permissionMessage" class="mt-3 w-full">
        <Callout theme="orange" label="Microphone permission required">
          <div class="text-sm">
            {{ permissionMessage }}
          </div>
        </Callout>
      </div>
    </div>

    <div v-if="hasAutoSendControl" class="mt-3">
      <FieldCheckbox
        v-model="autoSendEnabled"
        label="Auto send"
        description="Send transcribed text to chat automatically."
      />
    </div>

    <!-- Always-visible device selector -->
    <div class="mt-3 w-full">
      <FieldCombobox
        v-model="selectedAudioInput"
        label="Input device"
        description="Select the microphone you want to use."
        :options="audioInputs.map(device => ({ label: device.label || 'Unknown Device', value: device.deviceId }))"
        placeholder="Select microphone"
        layout="vertical"
      />
    </div>
  </div>
</template>
