<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'

import KioskVisitorSessionList from '../../components/Webnavior/kioskVisitorSessionList.vue'
import KioskVisitorSessionTranscript from '../../components/Webnavior/kioskVisitorSessionTranscript.vue'

import { useKioskManagement } from '../../composables/useKioskManagement'

const {
  load,
  deleteVisitorSessions,
  downloadTrainingDataset,
  loadVisitorSessions,
  selectedSiteId,
  selectSite,
  selectVisitorSession,
  sites,
  visitorHistoryError,
  visitorHistoryLoading,
  visitorSessionDetail,
  visitorSessions,
  devices,
} = useKioskManagement()

const selectedSession = computed(() => visitorSessions.value.find(session => session.id === visitorSessionDetail.value?.session.id))
const selectedVisitorSessionIds = shallowRef<string[]>([])
const selectedDeviceId = shallowRef('')
const historyFilter = shallowRef<'all' | 'greeting_only' | 'interactive'>('interactive')
const historyReady = shallowRef(false)
const filteredVisitorSessions = computed(() => historyFilter.value === 'all'
  ? visitorSessions.value
  : visitorSessions.value.filter(session => session.presence === historyFilter.value))

async function deleteSelectedVisitorSessions() {
  await deleteVisitorSessions(selectedVisitorSessionIds.value)
  selectedVisitorSessionIds.value = []
}

async function downloadSelectedTrainingDataset(kind: 'asr' | 'llm') {
  await downloadTrainingDataset(kind, selectedVisitorSessionIds.value)
}

onMounted(async () => {
  await load()
  historyReady.value = true
  await loadVisitorSessions(selectedDeviceId.value)
})

watch([selectedSiteId, selectedDeviceId], () => {
  if (historyReady.value)
    void loadVisitorSessions(selectedDeviceId.value)
})

watch(historyFilter, () => {
  selectedVisitorSessionIds.value = []
})
</script>

<template>
  <div :class="['flex flex-col gap-6']">
    <section>
      <p :class="['mb-2 mt-0 text-sm font-semibold tracking-wide text-cyan-700 dark:text-cyan-300']">
        HISTORY
      </p>
      <h1 :class="['m-0 text-3xl font-bold tracking-tight text-slate-950 dark:text-white']">
        Kiosk 使用歷程
      </h1>
      <p :class="['mb-0 mt-2 text-sm text-slate-600 dark:text-slate-300']">
        查看保留期間內的顧客文字對話、語音轉錄、服務事件與內部 POC 原始錄音／影像。
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
    <label :class="['flex max-w-md flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200']">
      接待類型
      <select v-model="historyFilter" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900']">
        <option value="interactive">有顧客互動（建議）</option>
        <option value="greeting_only">僅主動招呼</option>
        <option value="all">全部紀錄</option>
      </select>
    </label>
    <label :class="['flex max-w-md flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200']">
      設備
      <select v-model="selectedDeviceId" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900']">
        <option value="">所有設備</option>
        <option v-for="device in devices" :key="device.id" :value="device.id">{{ device.label }}</option>
      </select>
    </label>

    <p v-if="visitorHistoryError" :class="['m-0 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-100']">
      {{ visitorHistoryError }}
    </p>
    <p v-else-if="visitorHistoryLoading" :class="['m-0 text-sm text-slate-500 dark:text-slate-400']">
      正在載入使用歷程…
    </p>

    <section v-else :class="['grid gap-6 xl:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]']">
      <div :class="['flex flex-col gap-3']">
        <div v-if="selectedVisitorSessionIds.length" :class="['flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-900 dark:bg-slate-800 dark:text-slate-100']">
          <span>已選取 {{ selectedVisitorSessionIds.length }} 筆</span>
          <span :class="['flex flex-wrap gap-2']">
            <button type="button" :class="['rounded-md bg-cyan-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-800']" @click="downloadSelectedTrainingDataset('llm')">下載 LLM JSONL</button>
            <button type="button" :class="['rounded-md bg-violet-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-800']" @click="downloadSelectedTrainingDataset('asr')">下載 ASR ZIP</button>
            <button type="button" :class="['rounded-md bg-rose-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-800']" @click="deleteSelectedVisitorSessions">刪除選取紀錄</button>
          </span>
        </div>
        <KioskVisitorSessionList
          :selected-id="visitorSessionDetail?.session.id"
          :selected-ids="selectedVisitorSessionIds"
          :sessions="filteredVisitorSessions"
          @select="selectVisitorSession"
          @select-ids="selectedVisitorSessionIds = $event"
        />
      </div>
      <KioskVisitorSessionTranscript :detail="visitorSessionDetail" :session="selectedSession" />
    </section>
  </div>
</template>

<route lang="yaml">
path: /admin/kiosk/history
meta:
  layout: webnavior-admin
  title: Kiosk 使用歷程
</route>
