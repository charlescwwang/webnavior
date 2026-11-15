<script setup lang="ts">
import type { OrderingSite } from '@proj-airi/stage-shared/ordering-sites'

import { Button, Input } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

import CatalogLabelsEditor from './catalogLabelsEditor.vue'

defineProps<{ disabled: boolean }>()
const sites = defineModel<OrderingSite[]>({ default: () => [] })
const { t } = useI18n()

function add() {
  sites.value = [...sites.value, { id: '', title: '', description: '', url: '' }]
}
</script>

<template>
  <section :class="['flex flex-col gap-3']">
    <p>{{ t('deviceSettings.orderingSiteRegistryHint') }}</p>
    <div v-for="(site, index) in sites" :key="index" :class="['grid gap-2 rounded-lg border p-3']">
      <label>{{ t('deviceSettings.orderingSiteId') }}<Input v-model="site.id" :disabled="disabled" required /></label>
      <label>{{ t('deviceSettings.orderingSite') }}<Input v-model="site.title" :disabled="disabled" required /></label>
      <label>{{ t('deviceSettings.orderingSiteUrl') }}<Input v-model="site.url" :disabled="disabled" type="url" required /></label>
      <label>{{ t('deviceSettings.orderingSiteDescription') }}<Input v-model="site.description" :disabled="disabled" /></label>
      <CatalogLabelsEditor v-model="site.catalogLabels" :disabled="disabled" />
      <Button :disabled="disabled" @click="sites = sites.filter((_, position) => position !== index)">
        {{ t('deviceSettings.removeOrderingSite') }}
      </Button>
    </div>
    <Button :disabled="disabled || sites.length >= 30" @click="add">
      {{ t('deviceSettings.addOrderingSite') }}
    </Button>
  </section>
</template>
