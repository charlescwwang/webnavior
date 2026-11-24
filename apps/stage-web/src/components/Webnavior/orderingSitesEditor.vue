<script setup lang="ts">
import type { OrderingSite } from '@proj-airi/stage-shared/ordering-sites'

import { Button, Input, Textarea } from '@proj-airi/ui'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, DialogTrigger } from 'reka-ui'
import { reactive } from 'vue'
import { useI18n } from 'vue-i18n'

import CatalogLabelsEditor from './catalogLabelsEditor.vue'

defineProps<{ canEdit: boolean, disabled: boolean, technical: boolean }>()
const defaultSite = defineModel<OrderingSite>('defaultSite', { required: true })
const sites = defineModel<OrderingSite[]>({ default: () => [] })
const { t } = useI18n()

// Reloading the saved draft replaces its rows, ending ID editing for new sites.
const newSites = reactive(new WeakSet<OrderingSite>())

function add() {
  const site = { id: '', title: '', description: '', url: '' }
  newSites.add(site)
  sites.value = [...sites.value, site]
}
</script>

<template>
  <section :class="['flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4']">
    <div>
      <h3 :class="['m-0 font-semibold']">
        {{ t('deviceSettings.orderingSetup') }}
      </h3>
      <p :class="['mb-0 mt-1 text-sm']">
        {{ t('deviceSettings.defaultSite') }}：{{ defaultSite.title }}
      </p>
    </div>
    <DialogRoot>
      <DialogTrigger as-child>
        <Button variant="secondary" :disabled="disabled">
          {{ t('deviceSettings.openOrderingSetup') }}
        </Button>
      </DialogTrigger>
      <DialogPortal>
        <DialogOverlay :class="['fixed inset-0 z-100 bg-black/50']" />
        <DialogContent :class="['fixed left-1/2 top-1/2 z-100 w-[min(44rem,calc(100vw-2rem))] max-h-[90dvh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto', 'grid gap-4 rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900']">
          <DialogTitle :class="['m-0 text-lg font-semibold']">
            {{ t('deviceSettings.orderingSetup') }}
          </DialogTitle>
          <DialogDescription :class="['m-0 text-sm']">
            {{ t('deviceSettings.orderingDraftHint') }}
          </DialogDescription>
          <section :class="['grid gap-2 rounded-lg border p-3']">
            <h4 :class="['m-0']">
              {{ t('deviceSettings.defaultSite') }}
            </h4>
            <p :class="['m-0 text-sm']">
              {{ t('deviceSettings.defaultSiteHint') }}
            </p>
            <label>{{ t('deviceSettings.siteName') }}<Input v-model="defaultSite.title" :disabled="disabled || !canEdit" /></label>
            <label v-if="technical">{{ t('deviceSettings.orderingSiteUrl') }}<Input v-model="defaultSite.url" :disabled="disabled || !canEdit" type="url" /></label>
            <label>{{ t('deviceSettings.orderingSiteDescription') }}<Textarea v-model="defaultSite.description" :disabled="disabled || !canEdit" :rows="2" /></label>
            <CatalogLabelsEditor v-model="defaultSite.catalogLabels" :disabled="disabled || !canEdit" />
          </section>
          <section v-if="technical" :class="['grid gap-2']">
            <h4 :class="['m-0']">
              {{ t('deviceSettings.additionalSites') }}
            </h4>
            <p :class="['m-0 text-sm']">
              {{ t('deviceSettings.orderingSiteRegistryHint') }}
            </p>
            <div v-for="(site, index) in sites" :key="index" :class="['grid gap-2 rounded-lg border p-3']">
              <label v-if="newSites.has(site)">{{ t('deviceSettings.orderingSiteId') }}<Input v-model="site.id" :disabled="disabled" required /></label>
              <div v-else>
                <span>{{ t('deviceSettings.orderingSiteIdReadOnly') }}</span>
                <div :class="['font-mono text-sm']">
                  {{ site.id }}
                </div>
              </div>
              <label>{{ t('deviceSettings.siteName') }}<Input v-model="site.title" :disabled="disabled" required /></label>
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
          <DialogClose as-child>
            <Button variant="secondary">
              {{ t('deviceSettings.backToProfile') }}
            </Button>
          </DialogClose>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </section>
</template>
