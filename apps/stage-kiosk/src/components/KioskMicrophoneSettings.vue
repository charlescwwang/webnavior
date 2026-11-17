<script setup lang="ts">
import type { SpeechRecognitionPolicy } from '@proj-airi/stage-shared/falcon-settings'

import { errorMessageFrom } from '@moeru/std'
import { Button, FieldCheckbox, FieldInput, FieldRange, FieldSelect } from '@proj-airi/ui'
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useKioskMicrophone } from '../composables/useKioskMicrophone'

const props = defineProps<{ recognitionMode?: SpeechRecognitionPolicy['mode'] }>()
const microphone = useKioskMicrophone()
const { settings, falconGainDb, algorithm, spatialMask } = microphone
// Drafts make algorithm/AEC/gain one deliberate apply instead of restarting
// capture at each keystroke. Other existing hardware controls keep their policy.
const draftAlgorithm = shallowRef(algorithm.value)
const draftMask = ref({ ...spatialMask.value })
const error = shallowRef('')
const changed = computed(() => draftAlgorithm.value !== algorithm.value || JSON.stringify(draftMask.value) !== JSON.stringify(spatialMask.value))
const showLcmv = computed(() => props.recognitionMode !== 'legacy' || draftAlgorithm.value === 'lcmv')
watch([algorithm, spatialMask], () => {
  draftAlgorithm.value = algorithm.value
  draftMask.value = { ...spatialMask.value }
}, { deep: true })
function apply() {
  try {
    microphone.applySpatialSettings(draftAlgorithm.value, draftMask.value)
    error.value = ''
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? 'Invalid microphone settings.'
  }
}
const { t } = useI18n()
const fields = ['frontElevationDeg', 'suppress1ElevationDeg', 'suppress2ElevationDeg', 'gainDb'] as const
const advancedFields = ['frontDeg', 'suppress1Deg', 'suppress2Deg', 'radiusMm', 'loading'] as const
</script>

<template>
  <section :class="['grid gap-3']">
    <h4>{{ t('stage.kiosk.array-audio.title') }}</h4>
    <FieldSelect v-model="settings.inputMode" :label="t('stage.kiosk.array-audio.mode')" :options="['auto', 'uma8', 'standard'].map(value => ({ value, label: t(`stage.kiosk.array-audio.${value}`) }))" layout="vertical" />
    <template v-if="settings.inputMode !== 'standard'">
      <p>{{ t('stage.kiosk.array-audio.description') }}</p>
      <template v-if="props.recognitionMode === 'legacy'">
        <FieldSelect v-model="draftAlgorithm" :label="t('stage.kiosk.array-audio.algorithm')" :options="['lcmv', 'spatial-mask'].map(value => ({ value, label: t(`stage.kiosk.array-audio.${value}`) }))" layout="vertical" />
        <template v-if="draftAlgorithm === 'spatial-mask'">
          <FieldCheckbox v-model="draftMask.aec3Enabled" :label="t('stage.kiosk.array-audio.aec3')" :description="t('stage.kiosk.array-audio.aec3Description')" />
          <FieldInput v-model.number="draftMask.gainDb" type="number" :min="0" :max="80" :label="t('stage.kiosk.array-audio.maskGainDb')" />
        </template>
        <p>{{ t('stage.kiosk.array-audio.applyDescription') }}</p>
        <Button :disabled="!changed" :label="t('stage.kiosk.array-audio.apply')" @click="apply" />
        <p v-if="error" role="alert">
          {{ error }}
        </p>
      </template>
      <p v-else>
        {{ t('stage.kiosk.array-audio.maskInactive') }}
      </p>
      <FieldInput v-for="field in showLcmv ? fields : []" :key="field" v-model.number="settings[field]" type="number" :label="t(`stage.kiosk.array-audio.${field}`)" />
      <FieldRange v-model="falconGainDb" :min="0" :max="30" :step="1" :label="t('stage.kiosk.array-audio.falconGainDb')" :description="t('stage.kiosk.array-audio.falconGainDescription')" />
      <details :class="['grid gap-3']">
        <summary>{{ t('stage.kiosk.array-audio.advanced') }}</summary>
        <FieldInput v-model="settings.channelMap" :label="t('stage.kiosk.array-audio.channelMap')" />
        <FieldInput v-for="field in showLcmv ? advancedFields : ['radiusMm'] as const" :key="field" v-model.number="settings[field]" type="number" :label="t(`stage.kiosk.array-audio.${field}`)" />
      </details>
    </template>
  </section>
</template>
