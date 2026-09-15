<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'

import KioskVisitorSessionList from '../../components/Webnavior/kioskVisitorSessionList.vue'
import KioskVisitorSessionTranscript from '../../components/Webnavior/kioskVisitorSessionTranscript.vue'

import { useKioskManagement } from '../../composables/useKioskManagement'

const {
  load,
  deleteVisitorSessions,
  loadVisitorSessions,
  selectedSite,
  selectedSiteId,
  selectSite,
  selectVisitorSession,
  sites,
  visitorHistoryError,
  visitorHistoryLoading,
  visitorSessionDetail,
  visitorSessions,
  devices,
  saving,
  saveInteractionRetention,
  saveMediaCapturePolicy,
} = useKioskManagement()

const selectedSession = computed(() => visitorSessions.value.find(session => session.id === visitorSessionDetail.value?.session.id))
const selectedVisitorSessionIds = shallowRef<string[]>([])
const selectedDeviceId = shallowRef('')
const retentionDays = shallowRef(180)
const mediaCaptureMode = shallowRef<'off' | 'snapshot' | 'triggered' | 'continuous'>('triggered')
const historyReady = shallowRef(false)

watch(selectedSite, (site) => {
  retentionDays.value = site?.interactionRetentionDays ?? 180
  mediaCaptureMode.value = site?.mediaCapturePolicy.mode ?? 'triggered'
}, { immediate: true })

async function deleteSelectedVisitorSessions() {
  await deleteVisitorSessions(selectedVisitorSessionIds.value)
  selectedVisitorSessionIds.value = []
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
      設備
      <select v-model="selectedDeviceId" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900']">
        <option value="">所有設備</option>
        <option v-for="device in devices" :key="device.id" :value="device.id">{{ device.label }}</option>
      </select>
    </label>

    <p v-if="selectedSite" :class="['m-0 text-sm text-slate-500 dark:text-slate-400']">
      {{ selectedSite.interactionRetentionDays }} 天後會依保存政策清除完成的接待紀錄。
    </p>
    <section v-if="selectedSite" :class="['grid gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800']">
      <div>
        <h2 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
          資料保存設定
        </h2>
        <p :class="['mb-0 mt-1 text-sm text-slate-500 dark:text-slate-400']">
          圖片快照或活動短片會直接關聯到對應事件；連續影片只在訪客會話進行中錄製。
        </p>
      </div>
      <label :class="['flex max-w-md flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200']">
        保存天數
        <div :class="['flex gap-2']">
          <input v-model.number="retentionDays" min="0" type="number" :class="['w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900']">
          <button type="button" :disabled="saving || retentionDays < 0" :class="['rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900']" @click="saveInteractionRetention(retentionDays)">儲存</button>
        </div>
      </label>
      <label :class="['flex max-w-md flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200']">
        影像保存模式
        <div :class="['flex gap-2']">
          <select v-model="mediaCaptureMode" :class="['flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900']">
            <option value="off">關閉影像保存</option>
            <option value="snapshot">只保存活動觸發圖片</option>
            <option value="triggered">只保存活動觸發短片</option>
            <option value="continuous">活動短片與會話連續影片</option>
          </select>
          <button type="button" :disabled="saving" :class="['rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900']" @click="saveMediaCapturePolicy(mediaCaptureMode)">套用</button>
        </div>
      </label>
    </section>
    <p v-if="visitorHistoryError" :class="['m-0 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-100']">
      {{ visitorHistoryError }}
    </p>
    <p v-else-if="visitorHistoryLoading" :class="['m-0 text-sm text-slate-500 dark:text-slate-400']">
      正在載入使用歷程…
    </p>

    <section v-else :class="['grid gap-6 xl:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]']">
      <div :class="['flex flex-col gap-3']">
        <div v-if="selectedVisitorSessionIds.length" :class="['flex items-center justify-between gap-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-400/10 dark:text-rose-100']">
          <span>已選取 {{ selectedVisitorSessionIds.length }} 筆</span>
          <button type="button" :class="['rounded-md bg-rose-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-800']" @click="deleteSelectedVisitorSessions">
            刪除選取紀錄
          </button>
        </div>
        <KioskVisitorSessionList
          :selected-id="visitorSessionDetail?.session.id"
          :selected-ids="selectedVisitorSessionIds"
          :sessions="visitorSessions"
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
