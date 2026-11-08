<script setup lang="ts">
import type { DeviceSettingKey, DeviceSettingsSnapshot, DeviceSettingsValues, KioskVoiceVadSettings } from '@proj-airi/kiosk-proactive'

import { deviceSettingKeys } from '@proj-airi/kiosk-proactive'
import { Button, Checkbox, Input } from '@proj-airi/ui'
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import DeviceSettingsVoiceVadEditor from './deviceSettingsVoiceVadEditor.vue'

const props = defineProps<{ snapshot: DeviceSettingsSnapshot, mode: 'admin' | 'local', saving: boolean, activeOrderingSiteId?: string }>()
const emit = defineEmits<{
  save: [change: { version: number, overrides: Partial<DeviceSettingsValues> }]
  dirty: [changed: boolean]
  reload: []
}>()
const { t } = useI18n()
const values = shallowRef<DeviceSettingsValues>({ ...props.snapshot.effective })
const options: Partial<Record<DeviceSettingKey, string[]>> = {
  serviceMode: ['kiosk', 'table-service'],
  backgroundSpeechMode: ['off', 'observe', 'enforce'],
  triggerMode: ['attention', 'presence', 'mixed'],
  mediaCaptureMode: ['off', 'snapshot', 'triggered', 'continuous'],
  performanceProfile: ['constrained', 'balanced', 'high'],
  presenceVisionMode: ['face_only', 'pose_only', 'pose_plus_conditional_face'],
}
const savedOrderingSiteId = computed(() => props.snapshot.effective.orderingServiceId || props.snapshot.orderingSites?.[0]?.id)
const activeOrderingSiteTitle = computed(() => props.snapshot.orderingSites?.find(site => site.id === props.activeOrderingSiteId)?.title ?? props.activeOrderingSiteId)
const genericSettingKeys = deviceSettingKeys.filter(key => key !== 'voiceVadSettings' && key !== 'orderingServiceId')
// Store only edited fields plus existing device choices. Saving an unrelated
// field must not freeze every inherited Site default into a device override.
const overrides = computed<Partial<DeviceSettingsValues>>(() => ({
  ...props.snapshot.settings.overrides,
  ...Object.fromEntries(deviceSettingKeys
    .filter(key => JSON.stringify(values.value[key]) !== JSON.stringify(props.snapshot.effective[key]))
    .map(key => [key, values.value[key]])),
}))
watch(() => props.snapshot, (snapshot) => {
  values.value = { ...snapshot.effective }
}, { immediate: true })

// A remote refresh must never replace an operator's unsaved draft.
watch(() => JSON.stringify(values.value) !== JSON.stringify(props.snapshot.effective), changed => emit('dirty', changed), { flush: 'sync' })

function setValue(key: DeviceSettingKey, value: string | number | boolean | undefined) {
  const parsed = typeof props.snapshot.defaults[key] === 'number' ? Number(value) : value
  values.value = { ...values.value, [key]: parsed }
}

function setVoiceVadSettings(settings: KioskVoiceVadSettings) {
  values.value = { ...values.value, voiceVadSettings: settings }
}
</script>

<template>
  <form :class="['flex flex-col gap-4']" @submit.prevent="emit('save', { version: snapshot.settings.version, overrides })">
    <p>{{ t('deviceSettings.description') }}</p>
    <label :class="['flex flex-col gap-2 rounded-lg border p-3']">
      {{ t('deviceSettings.orderingSite') }}
      <select :aria-label="t('deviceSettings.orderingSite')" :value="values.orderingServiceId ?? ''" :disabled="saving" :class="['rounded border bg-transparent p-2']" @change="setValue('orderingServiceId', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('deviceSettings.defaultOrderingSite') }}</option>
        <option v-for="site in snapshot.orderingSites ?? []" :key="site.id" :value="site.id">{{ site.title }}</option>
      </select>
      <small>{{ t('deviceSettings.orderingSiteHint') }}</small>
      <small v-if="activeOrderingSiteId">{{ t('deviceSettings.activeOrderingSite', { name: activeOrderingSiteTitle }) }}</small>
      <small v-if="activeOrderingSiteId && savedOrderingSiteId !== activeOrderingSiteId" role="status">{{ t('deviceSettings.pendingOrderingSite') }}</small>
    </label>
    <div v-for="key in genericSettingKeys" :key="key" :class="['flex flex-wrap items-center gap-3 rounded-lg border p-3']">
      <span :class="['min-w-48 font-medium']">{{ t(`deviceSettings.fields.${key}`) }}</span>
      <p v-if="key === 'textOnlyMode' || key === 'performanceProfile' || key === 'faceDetectionConfidence' || key === 'voiceDiagnosticsEnabled' || key === 'conversationDiagnosticsEnabled'" :class="['m-0 basis-full text-xs text-slate-600 dark:text-slate-300']">
        {{ t(`deviceSettings.fieldDescriptions.${key}`) }}
      </p>
      <select
        v-if="options[key]"
        :aria-label="t(`deviceSettings.fields.${key}`)"
        :value="values[key]"
        :disabled="saving"
        :class="['rounded border bg-transparent p-2']"
        @change="setValue(key, ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="option in options[key]" :key="option" :value="option">
          {{ t(`deviceSettings.options.${option}`) }}
        </option>
      </select>
      <Checkbox
        v-else-if="typeof snapshot.defaults[key] === 'boolean'"
        :aria-label="t(`deviceSettings.fields.${key}`)"
        :model-value="Boolean(values[key])"
        :disabled="saving"
        @update:model-value="setValue(key, $event)"
      />
      <Input
        v-else
        :aria-label="t(`deviceSettings.fields.${key}`)"
        :model-value="Number(values[key])"
        type="number"
        step="any"
        :disabled="saving"
        @update:model-value="setValue(key, $event)"
      />
      <span :class="['text-xs opacity-70']">{{ t('deviceSettings.effective') }}: {{ snapshot.effective[key] }}</span>
    </div>
    <DeviceSettingsVoiceVadEditor
      :effective="snapshot.effective.voiceVadSettings"
      :locked="saving"
      :settings="values.voiceVadSettings"
      @update="setVoiceVadSettings"
    />
    <div :class="['sticky bottom-0 z-10 rounded-lg border bg-white p-3 dark:bg-slate-900']">
      <slot name="status" />
      <div :class="['flex gap-3']">
        <Button type="submit" :disabled="saving">
          {{ t('deviceSettings.save') }}
        </Button>
        <Button type="button" variant="secondary" :disabled="saving" @click="emit('reload')">
          {{ t('deviceSettings.reload') }}
        </Button>
      </div>
    </div>
  </form>
</template>
