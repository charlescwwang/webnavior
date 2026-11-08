<script setup lang="ts">
import type { KioskVoiceVadSettings } from '@proj-airi/kiosk-proactive'

import { Input } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

type VoiceVadField = keyof KioskVoiceVadSettings

const props = defineProps<{
  effective: KioskVoiceVadSettings
  locked: boolean
  settings: KioskVoiceVadSettings
}>()

const emit = defineEmits<{
  update: [settings: KioskVoiceVadSettings]
}>()

const { t } = useI18n()
const fields: Array<{ key: VoiceVadField, max: number, min: number, step: number }> = [
  { key: 'threshold', min: 0.1, max: 0.99, step: 0.01 },
  { key: 'minSpeechDurationMs', min: 0, max: 60_000, step: 1 },
  { key: 'maxSpeechDurationS', min: 1, max: 9_999, step: 1 },
  { key: 'minSilenceDurationMs', min: 0, max: 60_000, step: 1 },
  { key: 'speechPadMs', min: 0, max: 10_000, step: 1 },
]

function update(key: VoiceVadField, value: string | number | undefined) {
  emit('update', { ...props.settings, [key]: Number(value) })
}
</script>

<template>
  <section :class="['grid gap-3 rounded-lg border p-3']">
    <div>
      <h3 :class="['m-0 font-medium']">
        {{ t('deviceSettings.vad.title') }}
      </h3>
      <p :class="['mb-0 mt-1 text-xs text-slate-600 dark:text-slate-300']">
        {{ t('deviceSettings.vad.description') }}
      </p>
    </div>
    <div :class="['grid gap-3 sm:grid-cols-2']">
      <label v-for="field in fields" :key="field.key" :class="['grid gap-1 text-sm font-medium']">
        {{ t(`deviceSettings.vad.fields.${field.key}`) }}
        <Input
          :aria-label="t(`deviceSettings.vad.fields.${field.key}`)"
          :disabled="locked"
          :max="field.max"
          :min="field.min"
          :model-value="settings[field.key]"
          :step="field.step"
          type="number"
          @update:model-value="update(field.key, $event)"
        />
      </label>
    </div>
    <p :class="['m-0 text-xs text-slate-600 dark:text-slate-300']">
      {{ t('deviceSettings.vad.effective') }}
      {{ t('deviceSettings.vad.summary', { ...effective }) }}
    </p>
  </section>
</template>
