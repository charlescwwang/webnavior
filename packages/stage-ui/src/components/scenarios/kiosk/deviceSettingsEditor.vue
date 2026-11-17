<script setup lang="ts">
import type { DeviceSettingKey, DeviceSettingsSnapshot, DeviceSettingsValues, KioskVoiceVadSettings } from '@proj-airi/kiosk-proactive'

import { deviceSettingKeys } from '@proj-airi/kiosk-proactive'
import { readPbJourney } from '@proj-airi/stage-shared/pb-journey'
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
const orderingSiteOptions = computed(() => (props.snapshot.orderingSites ?? []).map((site) => {
  // Names are editable. Identify the environment from the reviewed destination,
  // so a test page called "PB" cannot be mistaken for the merchant's live site.
  const journey = readPbJourney(site.url)
  let environment: 'production' | 'fixture' | 'merchantTest' | undefined
  if (journey?.origin === 'https://app.esgpb.com')
    environment = 'production'
  else if (journey?.origin === 'http://127.0.0.1:5188')
    environment = 'fixture'
  else if (journey)
    environment = 'merchantTest'
  const label = environment ? `【${t(`deviceSettings.environments.${environment}`)}】${site.title}` : site.title
  return { ...site, label: `${label} — ${journey?.origin ?? site.url}`, environment }
}))
const selectedOrderingSite = computed(() => orderingSiteOptions.value.find(site => site.id === (values.value.orderingServiceId || orderingSiteOptions.value[0]?.id)))
const activeOrderingSiteTitle = computed(() => orderingSiteOptions.value.find(site => site.id === props.activeOrderingSiteId)?.label ?? props.activeOrderingSiteId)
// Service mode still belongs to the owned Menu. Background speech is a
// Server-resolved decision policy and applies independently to the PB service.
const genericSettingKeys = deviceSettingKeys.filter(key => !['voiceVadSettings', 'orderingServiceId', 'serviceMode'].includes(key))
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
      <select :aria-label="t('deviceSettings.orderingSite')" :value="values.orderingServiceId ?? ''" :disabled="saving" :class="['settings-select', 'rounded border p-2']" @change="setValue('orderingServiceId', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('deviceSettings.defaultOrderingSite') }}{{ orderingSiteOptions[0] ? ` — ${orderingSiteOptions[0].label}` : '' }}</option>
        <option v-for="site in orderingSiteOptions" :key="site.id" :value="site.id">{{ site.label }}</option>
      </select>
      <small v-if="selectedOrderingSite" :class="['break-all']">{{ selectedOrderingSite.url }}</small>
      <small v-if="selectedOrderingSite?.environment">{{ t(`deviceSettings.environmentHints.${selectedOrderingSite.environment}`) }}</small>
      <small>{{ t('deviceSettings.orderingSiteHint') }}</small>
      <small v-if="activeOrderingSiteId">{{ t('deviceSettings.activeOrderingSite', { name: activeOrderingSiteTitle }) }}</small>
      <small v-if="activeOrderingSiteId && savedOrderingSiteId !== activeOrderingSiteId" role="status">{{ t('deviceSettings.pendingOrderingSite') }}</small>
    </label>
    <div v-for="key in genericSettingKeys" :key="key" :class="['flex flex-wrap items-center gap-3 rounded-lg border p-3']">
      <span :class="['min-w-48 font-medium']">{{ t(`deviceSettings.fields.${key}`) }}</span>
      <p v-if="key === 'textOnlyMode' || key === 'mouthDetectionEnabled' || key === 'performanceProfile' || key === 'faceDetectionConfidence' || key === 'voiceDiagnosticsEnabled' || key === 'conversationDiagnosticsEnabled'" :class="['m-0 basis-full text-xs text-slate-600 dark:text-slate-300']">
        {{ t(`deviceSettings.fieldDescriptions.${key}`) }}
      </p>
      <select
        v-if="options[key]"
        :aria-label="t(`deviceSettings.fields.${key}`)"
        :value="values[key]"
        :disabled="saving"
        :class="['settings-select', 'rounded border p-2']"
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

<style scoped>
/* Native option popups can use a light system background even inside the dark
   kiosk panel. Set both colors on the control and its options before hover. */
.settings-select,
.settings-select option { color-scheme: light; color: #172033; background-color: #fff; }
.settings-select { min-width: 0; max-width: 100%; }
</style>
