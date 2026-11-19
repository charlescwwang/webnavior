<script setup lang="ts">
import type { NativeAudioResult } from '@proj-airi/stage-shared/kiosk-native-audio'

import { errorMessageFrom } from '@moeru/std'
import { Button, FieldSelect } from '@proj-airi/ui'
import { computed, onMounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useKioskMicrophone } from '../composables/useKioskMicrophone'

const { t } = useI18n()
const microphone = useKioskMicrophone()
const devices = shallowRef<NonNullable<NativeAudioResult['devices']>>([])
const error = shallowRef('')
const selection = computed({ get: () => microphone.arrayInputDevice.value || '__automatic__', set: (value: string) => microphone.arrayInputDevice.value = value === '__automatic__' ? '' : value })
const options = computed(() => [{ value: '__automatic__', label: t('stage.kiosk.native-audio.automatic') }, ...devices.value.filter(device => device.inputChannels >= 8).map(device => ({ value: device.id, label: `${device.name} · ${device.host} · ${device.inputChannels}ch` }))])
async function refresh() {
  try {
    if (!window.airiKioskArrayInput)
      throw new Error(t('stage.kiosk.array-audio.native-update'))
    devices.value = (await window.airiKioskArrayInput.request({ kind: 'devices' })).devices ?? []
    error.value = ''
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? t('stage.kiosk.native-audio.failed')
  }
}
onMounted(refresh)
</script>

<template>
  <section :class="['grid gap-3']">
    <p>{{ t('stage.kiosk.array-audio.native-description') }}</p>
    <FieldSelect v-model="selection" :label="t('stage.kiosk.native-audio.input')" :options="options" layout="vertical" />
    <Button :label="t('stage.kiosk.native-audio.refresh-devices')" @click="refresh" />
    <p v-if="error" role="alert">
      {{ error }}
    </p>
  </section>
</template>
