<script setup lang="ts">
import type { OrderingSite } from '@proj-airi/stage-shared/ordering-sites'

import { Button, Input } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

defineProps<{ disabled: boolean }>()
const labels = defineModel<OrderingSite['catalogLabels']>()
const { t } = useI18n()

function update(index: number, patch: Partial<NonNullable<OrderingSite['catalogLabels']>[number]>) {
  labels.value = (labels.value ?? []).map((label, position) => position === index ? { ...label, ...patch } : label)
}

function updateAliases(index: number, value: string | undefined) {
  const aliases = (value ?? '').split(/[、,，]/).map(value => value.trim()).filter(Boolean)
  update(index, { aliases: [...new Set(aliases)] })
}
</script>

<template>
  <details>
    <summary :class="['cursor-pointer font-medium']">
      {{ t('deviceSettings.catalogLabels.summary', { count: labels?.length ?? 0 }) }}
    </summary>
    <div :class="['mt-3 flex flex-col gap-3']">
      <p :class="['m-0 text-sm text-slate-500 dark:text-slate-400']">
        {{ t('deviceSettings.catalogLabels.hint') }}
      </p>
      <div v-for="(label, index) in labels" :key="index" :class="['grid gap-2 rounded-lg border p-3']">
        <label :class="['flex flex-col gap-1']">
          {{ t('deviceSettings.catalogLabels.name') }}
          <Input :model-value="label.name" :disabled="disabled" required :maxlength="200" @update:model-value="update(index, { name: $event ?? '' })" />
        </label>
        <label :class="['flex flex-col gap-1']">
          {{ t('deviceSettings.catalogLabels.aliases') }}
          <Input :model-value="label.aliases.join('、')" :disabled="disabled" @update:model-value="updateAliases(index, $event)" />
        </label>
        <label :class="['flex flex-col gap-1']">
          {{ t('deviceSettings.catalogLabels.category') }}
          <Input :model-value="label.category" :disabled="disabled" :maxlength="100" @update:model-value="update(index, { category: $event ?? '' })" />
        </label>
        <Button :disabled="disabled" @click="labels = labels?.filter((_, position) => position !== index)">
          {{ t('deviceSettings.catalogLabels.remove') }}
        </Button>
      </div>
      <Button :disabled="disabled || (labels?.length ?? 0) >= 200" @click="labels = [...labels ?? [], { name: '', aliases: [], category: '' }]">
        {{ t('deviceSettings.catalogLabels.add') }}
      </Button>
    </div>
  </details>
</template>
