<script setup lang="ts">
import type { ManagedKioskDevice } from '../../composables/useKioskDevices'

import { DeviceSettingsPanel } from '@proj-airi/stage-ui/components/scenarios/kiosk/deviceSettings'
import { Button, Input } from '@proj-airi/ui'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, DialogTrigger } from 'reka-ui'
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { kioskManagementEndpoint } from '../../composables/kioskManagementApi'

const props = defineProps<{ device: ManagedKioskDevice, saving: boolean }>()
const emit = defineEmits<{ saveRetention: [siteId: string, days: number] }>()
const open = shallowRef(false)
const { t } = useI18n()
const retentionDays = shallowRef<number | undefined>(180)
const endpoint = computed(() => kioskManagementEndpoint(`/sites/${props.device.siteId}/devices/${props.device.id}/settings`))

watch(() => [open.value, props.device.id, props.device.site.interactionRetentionDays], () => {
  retentionDays.value = props.device.site.interactionRetentionDays
}, { immediate: true })
</script>

<template>
  <DialogRoot v-if="device.capabilities.canEditTechnicalSettings" v-model:open="open">
    <DialogTrigger as-child>
      <Button variant="secondary" :disabled="saving">
        {{ t('deviceSettings.title') }}
      </Button>
    </DialogTrigger>
    <DialogPortal>
      <DialogOverlay :class="['fixed inset-0 z-100 bg-black/50 backdrop-blur-sm']" />
      <DialogContent :class="['fixed left-1/2 top-1/2 z-100 flex max-h-[calc(100dvh-2rem)] w-[min(72rem,calc(100vw-2rem))] flex-col -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl bg-white shadow-xl dark:bg-slate-900']">
        <div :class="['flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 p-5 dark:border-slate-800']">
          <div :class="['min-w-0']">
            <DialogTitle :class="['m-0 break-words text-xl font-semibold text-slate-950 dark:text-white']">
              {{ t('stage.kiosk-devices.settings-title', { name: device.label }) }}
            </DialogTitle>
            <DialogDescription :class="['mb-0 mt-2 text-sm text-slate-600 dark:text-slate-300']">
              {{ t('stage.kiosk-devices.settings-description', { site: device.site.name }) }}
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <Button variant="ghost" :aria-label="t('stage.kiosk-devices.close-settings')">
              <span :class="['i-solar:close-circle-bold text-xl']" />
            </Button>
          </DialogClose>
        </div>
        <div :class="['min-h-0 overflow-y-auto p-5 space-y-5']">
          <DeviceSettingsPanel :key="device.id" mode="admin" :endpoint="endpoint" />
          <section :class="['grid gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800']">
            <div>
              <h2 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
                {{ t('stage.kiosk-devices.retention-title') }}
              </h2>
              <p :class="['mb-0 mt-2 text-sm text-slate-600 dark:text-slate-300']">
                {{ t('stage.kiosk-devices.retention-description', { site: device.site.name }) }}
              </p>
            </div>
            <form :class="['flex flex-wrap items-end gap-3']" @submit.prevent="emit('saveRetention', device.siteId, Number(retentionDays))">
              <label :class="['flex flex-col gap-2 text-sm font-medium']">
                {{ t('stage.kiosk-devices.retention-days') }}
                <Input v-model="retentionDays" type="number" min="0" step="1" :disabled="saving" />
              </label>
              <Button type="submit" :disabled="saving || !Number.isInteger(Number(retentionDays)) || Number(retentionDays) < 0">
                {{ t('deviceSettings.save') }}
              </Button>
            </form>
          </section>
        </div>
        <div :class="['flex shrink-0 justify-end border-t border-slate-200 p-4 dark:border-slate-800']">
          <DialogClose as-child>
            <Button variant="secondary">
              {{ t('stage.kiosk-devices.close') }}
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
