<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'

import AdminMetric from '../../components/Webnavior/AdminMetric.vue'
import DashboardExperienceOverview from '../../components/Webnavior/dashboardExperienceOverview.vue'
import DashboardNextAction from '../../components/Webnavior/dashboardNextAction.vue'

import { useKioskManagement } from '../../composables/useKioskManagement'

const {
  deviceCount,
  load,
  loading,
  message,
  publishedExperience,
  selectedSite,
  sites,
} = useKioskManagement()

const nextAction = computed(() => {
  if (!selectedSite.value) {
    return {
      title: '建立第一個店別',
      description: '建立店別後，才能安排 Kiosk 設備與顧客互動體驗。',
      icon: 'i-solar:buildings-3-bold-duotone',
      to: '/admin/kiosk/devices',
    }
  }

  if (!publishedExperience.value) {
    return {
      title: '發布第一個互動體驗',
      description: '先確認顧客會看到的助手名稱與互動服務，再發布到這個店別。',
      icon: 'i-solar:upload-minimalistic-bold-duotone',
      to: `/admin/kiosk/profiles?site=${selectedSite.value.id}`,
    }
  }

  if (deviceCount.value === 0) {
    return {
      title: '註冊 Kiosk 設備',
      description: '發布後，仍需註冊設備才能讓現場顧客使用這套互動體驗。',
      icon: 'i-solar:monitor-smartphone-bold-duotone',
      to: '/admin/kiosk/devices',
    }
  }

  return {
    title: '檢視 Kiosk 設備',
    description: '目前已有已註冊設備。設備即時健康狀態將在加入心跳回報後顯示。',
    icon: 'i-solar:monitor-smartphone-bold-duotone',
    to: '/admin/kiosk/devices',
  }
})

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
          營運概覽
        </h1>
        <p :class="['mb-0 mt-2 text-sm text-slate-600 dark:text-slate-300']">
          先確認店別目前提供的顧客體驗，再處理下一個營運步驟。
        </p>
      </div>
      <RouterLink
        to="/admin/kiosk/profiles"
        :class="['inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white', 'hover:bg-cyan-500']"
      >
        <span class="i-solar:clipboard-check-bold-duotone text-lg" />
        查看互動體驗
      </RouterLink>
    </section>

    <section :class="['grid gap-4 md:grid-cols-2 xl:grid-cols-3']">
      <AdminMetric label="可管理店別" :value="sites.length" description="你目前獲授權的營運場域" icon="i-solar:buildings-3-bold-duotone" />
      <AdminMetric label="已註冊設備" :value="deviceCount" description="目前店別的 Kiosk 數量，非即時在線數" icon="i-solar:monitor-smartphone-bold-duotone" />
      <AdminMetric :label="publishedExperience ? '顧客體驗' : '待完成事項'" :value="publishedExperience ? '已發布' : '尚未發布'" :description="publishedExperience ? '目前已有顧客可使用的發布版本' : '先發布互動體驗，Kiosk 才能套用設定'" icon="i-solar:clipboard-check-bold-duotone" />
    </section>

    <section :class="['grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.7fr)]']">
      <DashboardExperienceOverview :experience="publishedExperience" :site="selectedSite" />
      <DashboardNextAction v-bind="nextAction" />
    </section>

    <section :class="['overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900']">
      <div :class="['flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800']">
        <div>
          <h2 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
            可管理店別
          </h2>
          <p :class="['mb-0 mt-1 text-sm text-slate-500 dark:text-slate-400']">
            名稱是管理範圍；進入後才會顯示該店別目前的顧客體驗與設備。
          </p>
        </div>
        <RouterLink to="/admin/kiosk/devices" :class="['text-sm font-semibold text-cyan-700 hover:text-cyan-600 dark:text-cyan-300']">
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
          <RouterLink :to="`/admin/kiosk/profiles?site=${site.id}`" :class="['text-sm font-semibold text-cyan-700 hover:text-cyan-600 dark:text-cyan-300']">
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
  title: Webnavior 管理後台
</route>
