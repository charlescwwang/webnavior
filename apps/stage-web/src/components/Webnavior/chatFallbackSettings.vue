<script setup lang="ts">
import type { AiCapabilitySelection, AiProviderProfile } from '../../composables/useWebnaviorAiControl'

import { Select } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  busy: boolean
  profiles: readonly AiProviderProfile[]
  selection?: AiCapabilitySelection
}>()
const emit = defineEmits<{ change: [profileId: string | null] }>()
const { t } = useI18n()
const disabledValue = 'no-fallback'
const eligibleProfiles = computed(() => props.profiles.filter(profile =>
  profile.capability === 'chat'
  && profile.id !== props.selection?.providerProfileId
  && Boolean(profile.verifiedAt)
  && profile.discoveredModels.some(model => model.id === profile.modelId),
))
const selectedProfile = computed(() => props.selection?.fallbackProviderProfile)
const requiresVerification = computed(() => Boolean(selectedProfile.value)
  && !eligibleProfiles.value.some(profile => profile.id === selectedProfile.value?.id))
const options = computed(() => [
  { label: t('settings.kiosk-chat-fallback.disabled'), value: disabledValue },
  ...eligibleProfiles.value.map(profile => ({ label: `${profile.name} · ${profile.modelId}`, value: profile.id })),
  // Editing a selected source can invalidate its verification. Keep its identity
  // visible until the operator verifies it again, replaces it, or clears it.
  ...(requiresVerification.value && selectedProfile.value
    ? [{ label: `${selectedProfile.value.name} · ${t('settings.kiosk-chat-fallback.needs-verification')}`, value: selectedProfile.value.id, disabled: true }]
    : []),
])

function change(value: string | undefined) {
  if (!props.selection || props.busy || value === undefined)
    return
  emit('change', value === disabledValue ? null : value)
}
</script>

<template>
  <div :class="['flex flex-col gap-2 border-t border-slate-200 pt-4 dark:border-slate-800']">
    <label :class="['flex flex-col gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100']">
      {{ t('settings.kiosk-chat-fallback.title') }}
      <Select
        :model-value="props.selection?.fallbackProviderProfileId ?? disabledValue"
        :options="options"
        :disabled="props.busy || !props.selection"
        @update:model-value="change"
      />
    </label>
    <p :class="['m-0 text-sm leading-6 text-slate-600 dark:text-slate-300']">
      {{ t('settings.kiosk-chat-fallback.description') }}
    </p>
    <p v-if="selectedProfile && props.selection" :class="['m-0 text-sm leading-6 text-slate-600 dark:text-slate-300']">
      {{ t('settings.kiosk-chat-fallback.timeouts', { primarySeconds: props.selection.providerProfile.timeoutMs / 1000, fallbackSeconds: selectedProfile.timeoutMs / 1000 }) }}
    </p>
    <p v-if="!props.selection" :class="['m-0 text-sm text-amber-800 dark:text-amber-200']">
      {{ t('settings.kiosk-chat-fallback.select-primary') }}
    </p>
    <p v-else-if="requiresVerification" :class="['m-0 text-sm text-amber-800 dark:text-amber-200']">
      {{ t('settings.kiosk-chat-fallback.verify-again') }}
    </p>
    <p v-else-if="!eligibleProfiles.length" :class="['m-0 text-sm text-slate-500 dark:text-slate-400']">
      {{ t('settings.kiosk-chat-fallback.no-candidates') }}
    </p>
  </div>
</template>
