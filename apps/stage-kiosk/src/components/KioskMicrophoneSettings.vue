<script setup lang="ts">
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { FieldCheckbox, FieldInput, FieldSelect } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

import { useKioskMicrophone } from '../composables/useKioskMicrophone'

const { t } = useI18n()
const devices = useSettingsAudioDevice()
const { settings, mapping, radius, dynamicProcessing } = useKioskMicrophone()
</script>

<template>
  <section :class="['grid gap-3']">
    <h4>{{ t('stage.kiosk.array-audio.title') }}</h4>
    <p>{{ t('stage.kiosk.array-audio.master-description') }}</p>
    <FieldSelect v-model="settings.inputMode" :label="t('stage.kiosk.array-audio.mode')" :options="['auto', 'standard'].map(value => ({ value, label: t(`stage.kiosk.array-audio.${value}`) }))" layout="vertical" />
    <FieldCheckbox v-model="dynamicProcessing" :disabled="devices.enabled" :label="t('stage.kiosk.array-audio.dynamic')" />
    <FieldInput v-model="mapping" :disabled="devices.enabled" :label="t('stage.kiosk.array-audio.channelMap')" />
    <FieldInput v-model.number="radius" :disabled="devices.enabled" type="number" :min="10" :max="100" :label="t('stage.kiosk.array-audio.radiusMm')" />
  </section>
</template>
