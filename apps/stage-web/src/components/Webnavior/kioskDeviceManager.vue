<script setup lang="ts">
import type { DeviceAction, DeviceSort } from '../../composables/useKioskDevices'

import { Button, Select } from '@proj-airi/ui'
import { AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogOverlay, AlertDialogPortal, AlertDialogRoot, AlertDialogTitle, CheckboxIndicator, CheckboxRoot } from 'reka-ui'
import { computed, onMounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import KioskDeviceSettingsDialog from './kioskDeviceSettingsDialog.vue'

import { useKioskDevices } from '../../composables/useKioskDevices'

const { t, locale } = useI18n()
const { applyAction, descending, devices, load, loading, message, saveRetention, saving, selectedSiteId, sites, sortBy, visibleDevices } = useKioskDevices()
const selectedIds = shallowRef<string[]>([])
const pendingAction = shallowRef<{ kind: DeviceAction, ids: string[], label?: string }>()
const actionOpen = shallowRef(false)
const resultMessage = shallowRef('')
const selectableDevices = computed(() => visibleDevices.value.filter(device => device.capabilities.canManageDevices))
const selectedDevices = computed(() => selectableDevices.value.filter(device => selectedIds.value.includes(device.id)))
const activeIds = computed(() => selectedDevices.value.filter(device => !device.disabledAt).map(device => device.id))
const disabledIds = computed(() => selectedDevices.value.filter(device => device.disabledAt).map(device => device.id))
const allSelected = computed(() => selectableDevices.value.length > 0 && selectableDevices.value.every(device => selectedIds.value.includes(device.id)))
const siteOptions = computed(() => [{ label: t('stage.kiosk-devices.all-sites'), value: 'all' }, ...sites.value.map(site => ({ label: site.name, value: site.id }))])
const sortOptions = computed<Array<{ label: string, value: DeviceSort }>>(() => [
  { label: t('stage.kiosk-devices.sort-created'), value: 'createdAt' },
  { label: t('stage.kiosk-devices.sort-name'), value: 'label' },
  { label: t('stage.kiosk-devices.sort-site'), value: 'site' },
])
const direction = computed(() => t(`stage.kiosk-devices.${sortBy.value === 'createdAt' ? (descending.value ? 'newest-first' : 'oldest-first') : (descending.value ? 'descending' : 'ascending')}`))
const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }))
const actionTitle = computed(() => pendingAction.value ? t(`stage.kiosk-devices.confirm-${pendingAction.value.kind}`, { count: pendingAction.value.ids.length }) : '')
const actionDescription = computed(() => pendingAction.value ? t(`stage.kiosk-devices.describe-${pendingAction.value.kind}`, { name: pendingAction.value.label ?? t('stage.kiosk-devices.selected-devices') }) : '')

function selectDevice(id: string, selected: boolean) {
  selectedIds.value = selected ? [...new Set([...selectedIds.value, id])] : selectedIds.value.filter(current => current !== id)
}

function requestAction(kind: DeviceAction, ids: string[], label?: string) {
  pendingAction.value = { kind, ids, label }
  actionOpen.value = true
}

async function confirmAction() {
  const action = pendingAction.value
  if (!action)
    return
  const result = await applyAction(action.kind, action.ids)
  if (result) {
    resultMessage.value = t('stage.kiosk-devices.action-result', { action: t(`stage.kiosk-devices.${action.kind}`), succeeded: result.succeededDeviceIds.length, failed: result.failedDeviceIds.length })
    selectedIds.value = []
  }
  actionOpen.value = false
  pendingAction.value = undefined
}

watch(sortBy, value => descending.value = value === 'createdAt')
watch(selectedSiteId, () => {
  selectedIds.value = []
  resultMessage.value = ''
})
watch(devices, (rows) => {
  const available = new Set(rows.filter(device => device.capabilities.canManageDevices).map(device => device.id))
  selectedIds.value = selectedIds.value.filter(id => available.has(id))
})
onMounted(() => void load())
</script>

<template>
  <div :class="['flex flex-col gap-5']">
    <div :class="['flex flex-wrap items-end gap-4']">
      <label :class="['min-w-48 flex flex-1 flex-col gap-2 text-sm font-semibold sm:max-w-sm']">
        {{ t('stage.kiosk-devices.site') }}
        <Select v-model="selectedSiteId" :options="siteOptions" :disabled="loading || saving" />
      </label>
      <label :class="['min-w-40 flex flex-col gap-2 text-sm font-semibold']">
        {{ t('stage.kiosk-devices.sort') }}
        <Select v-model="sortBy" :options="sortOptions" :disabled="saving" />
      </label>
      <Button variant="secondary" :disabled="saving" @click="descending = !descending">
        <span :class="[descending ? 'i-solar:sort-from-top-to-bottom-bold-duotone' : 'i-solar:sort-from-bottom-to-top-bold-duotone', 'text-lg']" />
        {{ direction }}
      </Button>
      <Button variant="secondary" :disabled="loading || saving" @click="load">
        <span :class="['i-solar:refresh-bold-duotone text-lg']" />
        {{ t('stage.kiosk-devices.refresh') }}
      </Button>
    </div>
    <section :aria-label="t('stage.kiosk-devices.list')" :class="['overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900']">
      <div :class="['flex flex-wrap items-center gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800']">
        <h2 :class="['m-0 text-base font-semibold']">
          {{ t('stage.kiosk-devices.device-count', { count: visibleDevices.length }) }}
        </h2>
        <label v-if="selectableDevices.length" :class="['ml-auto flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300']">
          <CheckboxRoot :aria-label="t('stage.kiosk-devices.select-visible')" :model-value="allSelected" :disabled="loading || saving" :class="['size-5 shrink-0 rounded border border-slate-400 data-[state=checked]:border-cyan-700 data-[state=checked]:bg-cyan-700 data-[state=checked]:text-white', 'focus-visible:outline-2 focus-visible:outline-cyan-600 disabled:opacity-50']" @update:model-value="selectedIds = $event === true ? selectableDevices.map(device => device.id) : []">
            <CheckboxIndicator><span :class="['i-solar:check-read-linear block']" /></CheckboxIndicator>
          </CheckboxRoot>
          {{ t('stage.kiosk-devices.select-visible') }}
        </label>
      </div>
      <p v-if="loading" role="status" :class="['m-0 px-5 py-8 text-sm text-slate-500']">
        {{ t('stage.kiosk-devices.loading') }}
      </p>
      <p v-else-if="message" role="alert" :class="['m-0 px-5 py-8 text-sm text-amber-700 dark:text-amber-300']">
        {{ message }}
      </p>
      <ul v-else-if="visibleDevices.length" :class="['m-0 list-none divide-y divide-slate-100 p-0 dark:divide-slate-800']">
        <li v-for="device in visibleDevices" :key="device.id" :data-device-id="device.id" :class="['flex flex-wrap items-center gap-4 px-5 py-4']">
          <CheckboxRoot v-if="device.capabilities.canManageDevices" :aria-label="t('stage.kiosk-devices.select-device', { name: device.label, site: device.site.name })" :model-value="selectedIds.includes(device.id)" :disabled="saving" :class="['size-5 shrink-0 rounded border border-slate-400 data-[state=checked]:border-cyan-700 data-[state=checked]:bg-cyan-700 data-[state=checked]:text-white', 'focus-visible:outline-2 focus-visible:outline-cyan-600 disabled:opacity-50']" @update:model-value="selectDevice(device.id, $event === true)">
            <CheckboxIndicator><span :class="['i-solar:check-read-linear block']" /></CheckboxIndicator>
          </CheckboxRoot>
          <span :class="['i-solar:monitor-smartphone-bold-duotone hidden rounded-lg bg-cyan-50 p-2 text-xl text-cyan-700 sm:block dark:bg-cyan-400/10 dark:text-cyan-300']" />
          <div :class="['min-w-0 flex-1 basis-40']">
            <p :class="['m-0 break-words font-medium text-slate-900 dark:text-white']">
              {{ device.label }}
            </p>
            <p :class="['mb-0 mt-1 text-sm text-slate-600 dark:text-slate-300']">
              {{ device.site.name }}
            </p>
            <p :class="['mb-0 mt-1 text-xs text-slate-500 dark:text-slate-400']">
              {{ t('stage.kiosk-devices.created') }} <time :datetime="device.createdAt">{{ dateFormat.format(new Date(device.createdAt)) }}</time>
            </p>
            <p :class="['mb-0 mt-1 text-xs text-slate-500 dark:text-slate-400']">
              {{ t('stage.kiosk-devices.registration', { method: device.registrationMethod }) }}
            </p>
            <p v-if="device.disabledAt" :class="['mb-0 mt-1 text-xs text-amber-700 dark:text-amber-300']">
              {{ t('stage.kiosk-devices.disabled') }}
            </p>
          </div>
          <div :class="['ml-auto flex flex-wrap gap-2']">
            <KioskDeviceSettingsDialog :device="device" :saving="saving" @save-retention="saveRetention" />
            <template v-if="device.capabilities.canManageDevices">
              <Button variant="secondary" :disabled="saving" @click="requestAction(device.disabledAt ? 'enable' : 'disable', [device.id], `${device.label} · ${device.site.name}`)">
                {{ t(`stage.kiosk-devices.${device.disabledAt ? 'enable' : 'disable'}`) }}
              </Button>
              <Button v-if="device.disabledAt" variant="danger" :disabled="saving" @click="requestAction('delete', [device.id], `${device.label} · ${device.site.name}`)">
                {{ t('stage.kiosk-devices.delete') }}
              </Button>
            </template>
          </div>
        </li>
      </ul>
      <p v-else :class="['m-0 px-5 py-8 text-sm text-slate-500']">
        {{ t('stage.kiosk-devices.empty') }}
      </p>
      <div v-if="selectedIds.length" :class="['flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-950/40']">
        <p :class="['m-0 text-sm']">
          {{ t('stage.kiosk-devices.selected-count', { count: selectedIds.length }) }}
        </p>
        <div :class="['ml-auto flex flex-wrap gap-2']">
          <Button variant="secondary" :disabled="saving || !activeIds.length" @click="requestAction('disable', activeIds)">
            {{ t('stage.kiosk-devices.disable-count', { count: activeIds.length }) }}
          </Button>
          <Button variant="danger" :disabled="saving || !disabledIds.length" @click="requestAction('delete', disabledIds)">
            {{ t('stage.kiosk-devices.delete-count', { count: disabledIds.length }) }}
          </Button>
        </div>
      </div>
      <p v-if="resultMessage" role="status" :class="['m-0 border-t border-slate-200 px-5 py-3 text-sm dark:border-slate-800']">
        {{ resultMessage }}
      </p>
    </section>
    <AlertDialogRoot v-model:open="actionOpen">
      <AlertDialogPortal>
        <AlertDialogOverlay :class="['fixed inset-0 z-100 bg-black/50']" />
        <AlertDialogContent :class="['fixed left-1/2 top-1/2 z-100 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900']" @interact-outside.prevent @escape-key-down="saving && $event.preventDefault()">
          <AlertDialogTitle :class="['m-0 text-xl font-semibold']">
            {{ actionTitle }}
          </AlertDialogTitle>
          <AlertDialogDescription :class="['mb-0 mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300']">
            {{ actionDescription }}
          </AlertDialogDescription>
          <div :class="['mt-6 flex justify-end gap-3']">
            <AlertDialogCancel as-child>
              <Button variant="secondary" :disabled="saving">
                {{ t('stage.kiosk-devices.cancel') }}
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction as-child>
              <Button :variant="pendingAction?.kind === 'delete' ? 'danger' : 'secondary'" :disabled="saving" @click.prevent="confirmAction">
                {{ t(`stage.kiosk-devices.${saving ? 'processing' : 'confirm'}`) }}
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialogRoot>
  </div>
</template>
