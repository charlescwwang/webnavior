<script setup lang="ts">
import { FieldCombobox } from '@proj-airi/ui'
import { computed } from 'vue'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'

const props = defineProps<{ devices: readonly MediaDeviceInfo[], disabled: boolean }>()
const microphone = defineModel<string>({ required: true })
const text = orderingMessages['zh-Hant'].arrayAudio
const choices = computed(() => props.devices
  .filter(device => device.deviceId && !['default', 'communications'].includes(device.deviceId))
  .map(device => ({ label: device.label || text.unknownDevice, value: device.deviceId })))
</script>

<template>
  <FieldCombobox
    v-model="microphone"
    :label="text.pendingMicrophone"
    :description="text.applyDescription"
    :options="choices"
    :disabled="props.disabled"
    layout="vertical"
  />
</template>
