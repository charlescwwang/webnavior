<script setup lang="ts">
import type { NativeAudioResult } from '@proj-airi/stage-shared/kiosk-native-audio'

import { errorMessageFrom } from '@moeru/std'
import { Button, FieldInput, FieldRange, FieldSelect } from '@proj-airi/ui'
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { hushPresets, useKioskMicrophone } from '../composables/useKioskMicrophone'

const { t } = useI18n()
const microphone = useKioskMicrophone()
const draft = ref({ ...microphone.nativeSettings.value, hush: { ...microphone.nativeSettings.value.hush } })
const selectedPreset = computed({
  get: () => hushPresets.find(preset => preset.attenuationDb === draft.value.hush.attenuationDb && preset.dryMixPercent === draft.value.hush.dryMixPercent)?.id ?? 'preset-custom',
  set: (id: string) => {
    const preset = hushPresets.find(preset => preset.id === id)
    if (preset)
      draft.value.hush = { attenuationDb: preset.attenuationDb, dryMixPercent: preset.dryMixPercent }
  },
})
const presetOptions = computed(() => [
  ...hushPresets.map(preset => ({ value: preset.id, label: t(`stage.kiosk.native-audio.${preset.id}`) })),
  ...(selectedPreset.value === 'preset-custom' ? [{ value: 'preset-custom', label: t('stage.kiosk.native-audio.preset-custom'), disabled: true }] : []),
])
const status = shallowRef<NativeAudioResult>()
const nativeDevices = shallowRef<NonNullable<NativeAudioResult['devices']>>([])
const inputSelection = computed({ get: () => draft.value.inputDevice || '__automatic__', set: (id: string) => draft.value.inputDevice = id === '__automatic__' ? '' : id })
const inputOptions = computed(() => [{ value: '__automatic__', label: t('stage.kiosk.native-audio.automatic') }, ...nativeDevices.value.filter(d => d.inputChannels >= 8).map(d => ({ value: d.id, label: `${d.name} · ${d.host} · ${d.inputChannels}ch` }))])
const error = shallowRef('')

async function refresh() {
  try {
    const bridge = window.airiKioskAudio
    if (bridge?.version !== 9)
      throw new Error(t('stage.kiosk.native-audio.update-exe'))
    nativeDevices.value = (await bridge.request({ kind: 'devices' })).devices ?? []
    status.value = await bridge.request({ kind: 'status' })
    error.value = ''
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? t('stage.kiosk.native-audio.failed')
  }
}
function apply() {
  try {
    microphone.nativeConfiguration(draft.value)
    // Save only microphone-owned settings; the normal speaker selector owns
    // browser playback and must never be inferred from the microphone host.
    microphone.nativeSettings.value = { channelMap: draft.value.channelMap, gainDb: draft.value.gainDb, inputDevice: draft.value.inputDevice, hush: { ...draft.value.hush } }
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
    <h4>{{ t('stage.kiosk.native-audio.title') }}</h4>
    <p>{{ t('stage.kiosk.native-audio.description') }}</p>
    <p role="status">
      {{ status?.runtime }} {{ status?.requested_provider }}
      {{ status?.runtime ? t('stage.kiosk.native-audio.cpu-ready') : t('stage.kiosk.native-audio.cpu-pending') }}
      · {{ t('stage.kiosk.native-audio.automatic-tracking') }}
    </p>
    <p v-if="status?.device_name">
      {{ status.device_name }}
    </p>
    <FieldSelect v-model="inputSelection" :label="t('stage.kiosk.native-audio.input')" :options="inputOptions" layout="vertical" />
    <p>{{ t('stage.kiosk.native-audio.independent-output') }}</p>
    <Button :label="t('stage.kiosk.native-audio.refresh-devices')" @click="refresh" />
    <FieldInput v-model="draft.channelMap" :label="t('stage.kiosk.array-audio.channelMap')" />
    <FieldRange v-model="draft.gainDb" :min="0" :max="40" :step="1" :label="t('stage.kiosk.native-audio.gain')" />
    <FieldSelect v-model="selectedPreset" :label="t('stage.kiosk.native-audio.hush-preset')" :options="presetOptions" layout="vertical" />
    <p>{{ t('stage.kiosk.native-audio.preset-description') }}</p>
    <Button :label="t('stage.kiosk.native-audio.apply')" @click="apply" />
    <p>{{ t('stage.kiosk.native-audio.tracking-description') }}</p>
    <p v-if="error" role="alert">
      {{ error }}
    </p>
  </section>
</template>
