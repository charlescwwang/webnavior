<script setup lang="ts">
import type { DeviceSettingKey, DeviceSettingsSnapshot, DeviceSettingsValues } from '@proj-airi/kiosk-proactive'

import { deviceSettingKeys } from '@proj-airi/kiosk-proactive'
import { Button, Checkbox, Input } from '@proj-airi/ui'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ snapshot: DeviceSettingsSnapshot, mode: 'admin' | 'local', saving: boolean }>()
const emit = defineEmits<{
  save: [change: { version: number, overrides: Partial<DeviceSettingsValues>, localControls: DeviceSettingKey[], clearLocalOverrides: DeviceSettingKey[] }]
  reload: []
}>()
const { t } = useI18n()
const overrides = ref<Partial<DeviceSettingsValues>>({})
const localControls = ref<DeviceSettingKey[]>([])
const clearLocalOverrides = ref<DeviceSettingKey[]>([])
const options: Partial<Record<DeviceSettingKey, string[]>> = {
  triggerMode: ['attention', 'presence', 'mixed'],
  mediaCaptureMode: ['off', 'triggered', 'continuous'],
  performanceProfile: ['constrained', 'balanced', 'high'],
}
watch(() => props.snapshot, (snapshot) => {
  overrides.value = { ...(props.mode === 'admin' ? snapshot.settings.overrides : snapshot.settings.localOverrides) }
  localControls.value = [...snapshot.settings.localControls]
  clearLocalOverrides.value = []
}, { immediate: true })

function locked(key: DeviceSettingKey) {
  return props.saving || (props.mode === 'local' && !props.snapshot.settings.localControls.includes(key))
}

function toggleOverride(key: DeviceSettingKey, enabled: boolean) {
  if (enabled)
    overrides.value = { ...overrides.value, [key]: props.snapshot.effective[key] }
  else
    delete overrides.value[key]
}

function setValue(key: DeviceSettingKey, value: string | number | boolean | undefined) {
  const parsed = typeof props.snapshot.defaults[key] === 'number' ? Number(value) : value
  overrides.value = { ...overrides.value, [key]: parsed }
}

function delegate(key: DeviceSettingKey, enabled: boolean) {
  localControls.value = enabled ? [...localControls.value, key] : localControls.value.filter(item => item !== key)
}
</script>

<template>
  <form :class="['flex flex-col gap-4']" @submit.prevent="emit('save', { version: snapshot.settings.version, overrides, localControls, clearLocalOverrides })">
    <p>{{ t('deviceSettings.description') }}</p>
    <div v-for="key in deviceSettingKeys" :key="key" :class="['flex flex-wrap items-center gap-3 rounded-lg border p-3']">
      <span :class="['min-w-48 font-medium']">{{ t(`deviceSettings.fields.${key}`) }}</span>
      <p v-if="key === 'performanceProfile'" :class="['m-0 basis-full text-xs text-slate-600 dark:text-slate-300']">
        {{ t('deviceSettings.fieldDescriptions.performanceProfile') }}
      </p>
      <label :class="['flex items-center gap-2']">
        <Checkbox :model-value="overrides[key] !== undefined" :disabled="locked(key)" @update:model-value="toggleOverride(key, $event)" />
        {{ t('deviceSettings.override') }}
      </label>
      <select
        v-if="options[key]"
        :aria-label="t(`deviceSettings.fields.${key}`)"
        :value="overrides[key] ?? snapshot.effective[key]"
        :disabled="locked(key) || overrides[key] === undefined"
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
        :model-value="Boolean(overrides[key] ?? snapshot.effective[key])"
        :disabled="locked(key) || overrides[key] === undefined"
        @update:model-value="setValue(key, $event)"
      />
      <Input
        v-else
        :aria-label="t(`deviceSettings.fields.${key}`)"
        :model-value="Number(overrides[key] ?? snapshot.effective[key])"
        type="number"
        step="any"
        :disabled="locked(key) || overrides[key] === undefined"
        @update:model-value="setValue(key, $event)"
      />
      <span :class="['text-xs opacity-70']">{{ t('deviceSettings.effective') }}: {{ snapshot.effective[key] }}</span>
      <label v-if="mode === 'admin'" :class="['flex items-center gap-2']">
        <Checkbox :model-value="localControls.includes(key)" :disabled="saving" @update:model-value="delegate(key, $event)" />
        {{ t('deviceSettings.delegate') }}
      </label>
      <label v-if="mode === 'admin' && snapshot.settings.localOverrides[key] !== undefined" :class="['flex items-center gap-2']">
        <Checkbox :model-value="clearLocalOverrides.includes(key)" :disabled="saving" @update:model-value="clearLocalOverrides = $event ? [...clearLocalOverrides, key] : clearLocalOverrides.filter(item => item !== key)" />
        {{ t('deviceSettings.revoke') }}
      </label>
      <span v-if="mode === 'local' && locked(key)">{{ t('deviceSettings.locked') }}</span>
    </div>
    <div :class="['flex gap-3']">
      <Button type="submit" :disabled="saving">
        {{ t('deviceSettings.save') }}
      </Button>
      <Button type="button" variant="secondary" :disabled="saving" @click="emit('reload')">
        {{ t('deviceSettings.reload') }}
      </Button>
    </div>
  </form>
</template>
