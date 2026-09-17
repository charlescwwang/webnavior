<script setup lang="ts">
import type { KioskVoiceVadSettings } from '@proj-airi/kiosk-proactive'

import { Checkbox, Input } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

type VoiceVadField = keyof KioskVoiceVadSettings

const props = defineProps<{
  delegateEnabled: boolean
  effective: KioskVoiceVadSettings
  hasLocalOverride: boolean
  locked: boolean
  mode: 'admin' | 'local'
  override?: KioskVoiceVadSettings
  overrideEnabled: boolean
  saving: boolean
}>()

const emit = defineEmits<{
  delegate: [enabled: boolean]
  revoke: [enabled: boolean]
  toggleOverride: [enabled: boolean]
  update: [settings: KioskVoiceVadSettings]
}>()

const { t } = useI18n()
const displayedSettings = computed(() => props.override ?? props.effective)
const fields: Array<{ key: VoiceVadField, max: number, min: number, step: number }> = [
  { key: 'threshold', min: 0.1, max: 0.99, step: 0.01 },
  { key: 'minSpeechDurationMs', min: 0, max: 60_000, step: 1 },
  { key: 'maxSpeechDurationS', min: 1, max: 9_999, step: 1 },
  { key: 'minSilenceDurationMs', min: 0, max: 60_000, step: 1 },
  { key: 'speechPadMs', min: 0, max: 10_000, step: 1 },
]

function update(key: VoiceVadField, value: string | number | undefined) {
  emit('update', { ...displayedSettings.value, [key]: Number(value) })
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
    <label :class="['flex items-center gap-2']">
      <Checkbox :model-value="overrideEnabled" :disabled="locked" @update:model-value="emit('toggleOverride', $event)" />
      {{ t('deviceSettings.vad.override') }}
    </label>
    <div :class="['grid gap-3 sm:grid-cols-2']">
      <label v-for="field in fields" :key="field.key" :class="['grid gap-1 text-sm font-medium']">
        {{ t(`deviceSettings.vad.fields.${field.key}`) }}
        <Input
          :aria-label="t(`deviceSettings.vad.fields.${field.key}`)"
          :disabled="locked || !overrideEnabled"
          :max="field.max"
          :min="field.min"
          :model-value="displayedSettings[field.key]"
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
    <label v-if="mode === 'admin'" :class="['flex items-center gap-2']">
      <Checkbox :model-value="delegateEnabled" :disabled="saving" @update:model-value="emit('delegate', $event)" />
      {{ t('deviceSettings.vad.delegate') }}
    </label>
    <label v-if="mode === 'admin' && hasLocalOverride" :class="['flex items-center gap-2']">
      <Checkbox :disabled="saving" :model-value="false" @update:model-value="emit('revoke', $event)" />
      {{ t('deviceSettings.revoke') }}
    </label>
    <p v-if="mode === 'local' && locked" :class="['m-0 text-sm text-slate-600 dark:text-slate-300']">
      {{ t('deviceSettings.locked') }}
    </p>
  </section>
</template>
