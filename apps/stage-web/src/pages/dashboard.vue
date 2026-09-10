<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterLink } from 'vue-router'

import AdminMetric from '../components/Webnavior/AdminMetric.vue'

import { useKioskManagement } from '../composables/useKioskManagement'

const { deviceCount, load, loading, message, sites } = useKioskManagement()

onMounted(() => void load())
</script>

<template>
  <div :class="['flex flex-col gap-6']">
    <section :class="['flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between']">
      <div>
        <p :class="['mb-2 mt-0 text-sm font-semibold tracking-wide text-cyan-700 dark:text-cyan-300']">
          OVERVIEW
        </p>
        <h1 :class="['m-0 text-3xl font-bold tracking-tight text-slate-950 dark:text-white']">
          營運儀表板
        </h1>
        <p :class="['mb-0 mt-2 text-sm text-slate-600 dark:text-slate-300']">
          在這裡掌握店別、Kiosk 設備與互動設定的發布狀態。
        </p>
      </div>
      <RouterLink
        to="/kiosk/profiles"
        :class="['inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white', 'hover:bg-cyan-500']"
      >
        <span class="i-solar:clipboard-check-bold-duotone text-lg" />
        管理 Profile
      </RouterLink>
    </section>

    <section :class="['grid gap-4 md:grid-cols-2 xl:grid-cols-3']">
      <AdminMetric label="已授權店別" :value="sites.length" description="你目前有管理權限的場域" icon="i-solar:buildings-3-bold-duotone" />
      <AdminMetric label="已註冊設備" :value="deviceCount" description="目前選取店別的 Kiosk" icon="i-solar:monitor-smartphone-bold-duotone" />
      <AdminMetric label="設定發布流程" value="草稿 → 發布" description="設定由伺服器統一保存與下發" icon="i-solar:upload-minimalistic-bold-duotone" />
    </section>

    <section :class="['overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900']">
      <div :class="['flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800']">
        <div>
          <h2 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
            店別概覽
          </h2>
          <p :class="['mb-0 mt-1 text-sm text-slate-500 dark:text-slate-400']">
            選擇店別後，可檢視設備並發布互動 Profile。
          </p>
        </div>
        <RouterLink to="/kiosk/devices" :class="['text-sm font-semibold text-cyan-700 hover:text-cyan-600 dark:text-cyan-300']">
          查看設備
        </RouterLink>
      </div>
      <div v-if="loading" :class="['px-5 py-8 text-sm text-slate-500 dark:text-slate-400']">
        正在載入管理資料…
      </div>
      <div v-else-if="message" :class="['px-5 py-8 text-sm text-amber-700 dark:text-amber-300']">
        {{ message }}
      </div>
      <ul v-else-if="sites.length" :class="['m-0 divide-y divide-slate-100 p-0 dark:divide-slate-800']">
        <li v-for="site in sites" :key="site.id" :class="['flex items-center justify-between gap-4 px-5 py-4']">
          <div>
            <p :class="['m-0 font-medium text-slate-900 dark:text-white']">
              {{ site.name }}
            </p>
            <p :class="['mb-0 mt-1 text-sm text-slate-500 dark:text-slate-400']">
              互動資料保存 {{ site.interactionRetentionDays }} 天
            </p>
          </div>
          <RouterLink :to="`/kiosk/profiles?site=${site.id}`" :class="['text-sm font-semibold text-cyan-700 hover:text-cyan-600 dark:text-cyan-300']">
            管理
          </RouterLink>
        </li>
      </ul>
      <div v-else :class="['px-5 py-8 text-sm text-slate-500 dark:text-slate-400']">
        尚未有可管理的店別。
      </div>
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: webnavior-admin
  title: Webnavior 儀表板
</route>
