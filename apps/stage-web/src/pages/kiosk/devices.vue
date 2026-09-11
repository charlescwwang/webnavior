<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { onMounted } from 'vue'

import { useKioskManagement } from '../../composables/useKioskManagement'

const {
  capabilities,
  deleteDevice,
  devices,
  disableDevice,
  load,
  loading,
  message,
  saving,
  selectedSite,
  selectedSiteId,
  selectSite,
  sites,
} = useKioskManagement()

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
      <div :class="['border-b border-slate-200 px-5 py-4 dark:border-slate-800']">
        <h2 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
          {{ selectedSite?.name ?? '設備清單' }}
        </h2>
      </div>
      <div v-if="loading" :class="['px-5 py-8 text-sm text-slate-500 dark:text-slate-400']">
        正在載入設備…
      </div>
      <div v-else-if="message" :class="['px-5 py-8 text-sm text-amber-700 dark:text-amber-300']">
        {{ message }}
      </div>
      <ul v-else-if="devices.length" :class="['m-0 divide-y divide-slate-100 p-0 dark:divide-slate-800']">
        <li v-for="device in devices" :key="device.id" :class="['flex items-center gap-4 px-5 py-4']">
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
            <Button
              v-if="!device.disabledAt"
              variant="secondary"
              :disabled="saving"
              @click="disableDevice(device.id)"
            >
              停用
            </Button>
            <Button
              v-else
              variant="danger"
              :disabled="saving"
              @click="deleteDevice(device.id)"
            >
              刪除
            </Button>
          </div>
        </li>
      </ul>
      <div v-else :class="['px-5 py-8 text-sm text-slate-500 dark:text-slate-400']">
        此店別尚未註冊 Kiosk 設備。
      </div>
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: webnavior-admin
  title: Kiosk 設備
</route>
