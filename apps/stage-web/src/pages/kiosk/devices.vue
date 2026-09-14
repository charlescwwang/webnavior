<script setup lang="ts">
import { DeviceSettingsPanel } from '@proj-airi/stage-ui/components/scenarios/kiosk/deviceSettings'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { Button } from '@proj-airi/ui'
import { AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogOverlay, AlertDialogPortal, AlertDialogRoot, AlertDialogTitle } from 'reka-ui'
import { computed, onMounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useKioskManagement } from '../../composables/useKioskManagement'

const {
  capabilities,
  deleteDevice,
  deleteDevices,
  devices,
  disableDevice,
  disableDevices,
  enableDevice,
  load,
  loading,
  message,
  saving,
  selectedSite,
  selectedSiteId,
  selectSite,
  sites,
} = useKioskManagement()

type DeviceActionKind = 'batch-delete' | 'batch-disable' | 'delete' | 'disable' | 'enable'

interface PendingAction {
  deviceIds: string[]
  kind: DeviceActionKind
  label?: string
}

const pendingAction = shallowRef<PendingAction>()
const settingsDeviceId = shallowRef('')
const { t } = useI18n()
const actionDialogOpen = shallowRef(false)
const selectedDeviceIds = shallowRef<string[]>([])
const batchResultMessage = shallowRef('')
const settingsEndpoint = computed(() => new URL(
  `/api/admin/kiosk/sites/${selectedSiteId.value}/devices/${settingsDeviceId.value}/settings`,
  SERVER_URL,
).href)
const selectedDevices = computed(() => devices.value.filter(device => selectedDeviceIds.value.includes(device.id)))
const selectedActiveDevices = computed(() => selectedDevices.value.filter(device => !device.disabledAt))
const selectedDisabledDevices = computed(() => selectedDevices.value.filter(device => device.disabledAt))
const allDevicesSelected = computed(() => devices.value.length > 0 && selectedDeviceIds.value.length === devices.value.length)
const actionTitle = computed(() => {
  switch (pendingAction.value?.kind) {
    case 'disable': return '停用 Kiosk 設備？'
    case 'enable': return '啟用 Kiosk 設備？'
    case 'delete': return '刪除 Kiosk 設備？'
    case 'batch-disable': return `停用 ${pendingAction.value.deviceIds.length} 台 Kiosk 設備？`
    case 'batch-delete': return `刪除 ${pendingAction.value.deviceIds.length} 台 Kiosk 設備？`
    default: return '確認設備操作？'
  }
})
const actionDescription = computed(() => {
  const action = pendingAction.value
  if (!action)
    return ''
  if (action.kind === 'disable')
    return `「${action.label}」的瀏覽器憑證會立即撤銷。`
  if (action.kind === 'enable')
    return `「${action.label}」會恢復使用原本的瀏覽器憑證。`
  if (action.kind === 'delete')
    return `「${action.label}」只會從設備清單移除；既有訪客紀錄、逐字稿與媒體都會保留。`
  if (action.kind === 'batch-disable')
    return '每台設備會個別停用並撤銷瀏覽器憑證。若其中一台無法處理，其他成功停用的設備不會回復。'
  return '只會刪除目前已停用的設備；既有訪客紀錄、逐字稿與媒體都會保留。若其中一台無法處理，其他成功刪除的設備不會回復。'
})

function requestAction(deviceId: string, label: string, kind: Exclude<DeviceActionKind, 'batch-delete' | 'batch-disable'>) {
  pendingAction.value = { deviceIds: [deviceId], kind, label }
  actionDialogOpen.value = true
}

function setDeviceSelected(deviceId: string, selected: boolean) {
  selectedDeviceIds.value = selected
    ? [...new Set([...selectedDeviceIds.value, deviceId])]
    : selectedDeviceIds.value.filter(id => id !== deviceId)
}

function setAllDevicesSelected(selected: boolean) {
  selectedDeviceIds.value = selected ? devices.value.map(device => device.id) : []
}

function requestBatchAction(kind: 'batch-delete' | 'batch-disable') {
  const deviceIds = kind === 'batch-disable'
    ? selectedActiveDevices.value.map(device => device.id)
    : selectedDisabledDevices.value.map(device => device.id)
  if (deviceIds.length === 0)
    return

  pendingAction.value = { deviceIds, kind }
  actionDialogOpen.value = true
}

async function confirmAction() {
  const action = pendingAction.value
  if (!action)
    return
  if (action.kind === 'disable') {
    await disableDevice(action.deviceIds[0])
  }
  else if (action.kind === 'enable') {
    await enableDevice(action.deviceIds[0])
  }
  else if (action.kind === 'delete') {
    await deleteDevice(action.deviceIds[0])
  }
  else {
    const result = action.kind === 'batch-disable'
      ? await disableDevices(action.deviceIds)
      : await deleteDevices(action.deviceIds)
    if (result) {
      const actionName = action.kind === 'batch-disable' ? '停用' : '刪除'
      batchResultMessage.value = result.failedDeviceIds.length === 0
        ? `已${actionName} ${result.succeededDeviceIds.length} 台設備。`
        : `已${actionName} ${result.succeededDeviceIds.length} 台設備；${result.failedDeviceIds.length} 台未能完成。請重新整理清單後再試。`
      selectedDeviceIds.value = []
    }
  }
  actionDialogOpen.value = false
  pendingAction.value = undefined
}

watch(devices, (nextDevices) => {
  const availableIds = new Set(nextDevices.map(device => device.id))
  selectedDeviceIds.value = selectedDeviceIds.value.filter(deviceId => availableIds.has(deviceId))
})

watch(selectedSiteId, () => {
  selectedDeviceIds.value = []
  batchResultMessage.value = ''
})

onMounted(() => void load())
</script>

<template>
  <div :class="['flex flex-col gap-6']">
    <section>
      <p :class="['mb-2 mt-0 text-sm font-semibold tracking-wide text-cyan-700 dark:text-cyan-300']">
        KIOSK
      </p>
      <h1 :class="['m-0 text-3xl font-bold tracking-tight text-slate-950 dark:text-white']">
        Kiosk 設備
      </h1>
      <p :class="['mb-0 mt-2 text-sm text-slate-600 dark:text-slate-300']">
        查看已註冊到店別的展示設備。
      </p>
    </section>

    <label :class="['flex max-w-md flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200']">
      店別
      <select
        :value="selectedSiteId"
        :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900']"
        @change="selectSite(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="site in sites" :key="site.id" :value="site.id">{{ site.name }}</option>
      </select>
    </label>

    <section :class="['overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900']">
      <div :class="['flex items-center gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800']">
        <h2 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
          {{ selectedSite?.name ?? '設備清單' }}
        </h2>
        <label
          v-if="capabilities?.canManageDevices && devices.length"
          :class="['ml-auto flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300']"
        >
          <input
            type="checkbox"
            :checked="allDevicesSelected"
            :disabled="saving"
            @change="setAllDevicesSelected(($event.target as HTMLInputElement).checked)"
          >
          全選目前店別
        </label>
      </div>
      <div v-if="loading" :class="['px-5 py-8 text-sm text-slate-500 dark:text-slate-400']">
        正在載入設備…
      </div>
      <div v-else-if="message" :class="['px-5 py-8 text-sm text-amber-700 dark:text-amber-300']">
        {{ message }}
      </div>
      <ul v-else-if="devices.length" :class="['m-0 divide-y divide-slate-100 p-0 dark:divide-slate-800']">
        <li v-for="device in devices" :key="device.id" :class="['flex items-center gap-4 px-5 py-4']">
          <input
            v-if="capabilities?.canManageDevices"
            type="checkbox"
            :aria-label="`選取 ${device.label}`"
            :checked="selectedDeviceIds.includes(device.id)"
            :disabled="saving"
            @change="setDeviceSelected(device.id, ($event.target as HTMLInputElement).checked)"
          >
          <span :class="['i-solar:monitor-smartphone-bold-duotone rounded-lg bg-cyan-50 p-2 text-xl text-cyan-700', 'dark:bg-cyan-400/10 dark:text-cyan-300']" />
          <div>
            <p :class="['m-0 font-medium text-slate-900 dark:text-white']">
              {{ device.label }}
            </p>
            <p :class="['mb-0 mt-1 text-xs text-slate-500 dark:text-slate-400']">
              註冊方式：{{ device.registrationMethod }}
            </p>
            <p v-if="device.disabledAt" :class="['mb-0 mt-1 text-xs text-amber-700 dark:text-amber-300']">
              已停用
            </p>
          </div>
          <div v-if="capabilities?.canManageDevices" :class="['ml-auto flex items-center gap-2']">
            <Button v-if="capabilities.canEditTechnicalSettings" variant="secondary" @click="settingsDeviceId = device.id">
              {{ t('deviceSettings.title') }}
            </Button>
            <Button
              v-if="!device.disabledAt"
              variant="secondary"
              :disabled="saving"
              @click="requestAction(device.id, device.label, 'disable')"
            >
              停用
            </Button>
            <Button
              v-else
              variant="secondary"
              :disabled="saving"
              @click="requestAction(device.id, device.label, 'enable')"
            >
              啟用
            </Button>
            <Button
              v-if="device.disabledAt"
              variant="danger"
              :disabled="saving"
              @click="requestAction(device.id, device.label, 'delete')"
            >
              刪除
            </Button>
          </div>
        </li>
      </ul>
      <div
        v-if="capabilities?.canManageDevices && selectedDeviceIds.length"
        :class="['flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-950/40']"
      >
        <p :class="['m-0 text-sm text-slate-700 dark:text-slate-200']">
          已選取 {{ selectedDeviceIds.length }} 台設備
          <span v-if="selectedActiveDevices.length">，其中 {{ selectedActiveDevices.length }} 台可停用</span>
          <span v-if="selectedDisabledDevices.length">，其中 {{ selectedDisabledDevices.length }} 台可刪除</span>
        </p>
        <div :class="['ml-auto flex flex-wrap gap-2']">
          <Button
            variant="secondary"
            :disabled="saving || selectedActiveDevices.length === 0"
            @click="requestBatchAction('batch-disable')"
          >
            停用已選取的 {{ selectedActiveDevices.length }} 台
          </Button>
          <Button
            variant="danger"
            :disabled="saving || selectedDisabledDevices.length === 0"
            @click="requestBatchAction('batch-delete')"
          >
            刪除已停用的 {{ selectedDisabledDevices.length }} 台
          </Button>
        </div>
      </div>
      <p
        v-if="batchResultMessage"
        role="status"
        :class="['mb-0 mt-0 border-t border-slate-200 px-5 py-3 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200']"
      >
        {{ batchResultMessage }}
      </p>
      <div v-if="!loading && !message && !devices.length" :class="['px-5 py-8 text-sm text-slate-500 dark:text-slate-400']">
        此店別尚未註冊 Kiosk 設備。
      </div>
    </section>
    <DeviceSettingsPanel
      v-if="capabilities?.canEditTechnicalSettings && devices.some(device => device.id === settingsDeviceId)"
      :key="`${selectedSiteId}:${settingsDeviceId}`"
      mode="admin"
      :endpoint="settingsEndpoint"
    />
    <AlertDialogRoot :open="actionDialogOpen" @update:open="actionDialogOpen = $event">
      <AlertDialogPortal>
        <AlertDialogOverlay :class="['fixed inset-0 z-100 bg-black/50']" />
        <AlertDialogContent :class="['fixed left-1/2 top-1/2 z-100 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900']" @interact-outside.prevent>
          <AlertDialogTitle :class="['m-0 text-xl font-semibold text-slate-950 dark:text-white']">
            {{ actionTitle }}
          </AlertDialogTitle>
          <AlertDialogDescription :class="['mb-0 mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300']">
            {{ actionDescription }}
          </AlertDialogDescription>
          <div :class="['mt-6 flex justify-end gap-3']">
            <AlertDialogCancel as-child>
              <Button variant="secondary" :disabled="saving">
                取消
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction as-child>
              <Button :variant="pendingAction?.kind === 'delete' || pendingAction?.kind === 'batch-delete' ? 'danger' : 'secondary'" :disabled="saving" @click.prevent="confirmAction">
                {{ saving ? '處理中…' : '確認' }}
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialogRoot>
  </div>
</template>

<route lang="yaml">
path: /admin/kiosk/devices
meta:
  layout: webnavior-admin
  title: Kiosk 設備
</route>
