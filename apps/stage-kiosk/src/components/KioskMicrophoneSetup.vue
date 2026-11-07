<script setup lang="ts">
import { Button } from '@proj-airi/ui'

import KioskMicrophonePicker from './KioskMicrophonePicker.vue'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'

const props = defineProps<{ devices: readonly MediaDeviceInfo[], busy: boolean, error: string }>()
const emit = defineEmits<{ apply: [], permission: [], stop: [] }>()
const microphone = defineModel<string>({ required: true })
const text = orderingMessages['zh-Hant'].arrayAudio
</script>

<template>
  <section role="region" :aria-label="text.startupMicrophoneTitle" :class="['fixed bottom-4 left-1/2 z-50 -translate-x-1/2', 'w-[min(36rem,calc(100vw-2rem))] max-h-[80vh] overflow-auto', 'grid gap-3 rounded-2xl border border-neutral-300 bg-white p-5 text-neutral-900 shadow-xl']">
    <h2 :class="['text-xl font-bold']">
      {{ text.startupMicrophoneTitle }}
    </h2>
    <p>{{ text.startupMicrophoneDescription }}</p>
    <KioskMicrophonePicker v-model="microphone" :devices="props.devices" :disabled="props.busy" />
    <p v-if="props.error" role="alert">
      {{ props.error }}
    </p>
    <p v-if="props.busy" role="status">
      {{ text.microphoneWorking }}
    </p>
    <div :class="['flex flex-wrap gap-2']">
      <Button :label="text.useMicrophone" :disabled="props.busy || !microphone" @click="emit('apply')" />
      <Button :label="text.requestDevices" variant="secondary" :disabled="props.busy" @click="emit('permission')" />
      <Button v-if="props.busy" :label="text.stopCapture" variant="secondary" @click="emit('stop')" />
    </div>
    <p :class="['text-sm text-neutral-600']">
      {{ text.changeInAdmin }}
    </p>
  </section>
</template>
