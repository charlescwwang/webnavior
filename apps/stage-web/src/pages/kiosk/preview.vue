<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'

import KioskExperiencePreview from '../../components/Webnavior/kioskExperiencePreview.vue'

import { useKioskManagement } from '../../composables/useKioskManagement'

const route = useRoute()
const {
  load,
  loading,
  message,
  profileDraft,
  selectedSite,
  selectedSiteId,
  selectSite,
  sites,
} = useKioskManagement()

async function selectSiteFromRoute(siteId: unknown) {
  if (typeof siteId !== 'string' || !sites.value.some(site => site.id === siteId))
    return

  await selectSite(siteId)
}

onMounted(async () => {
  await load()
  await selectSiteFromRoute(route.query.site)
})

watch(() => route.query.site, siteId => void selectSiteFromRoute(siteId))
</script>

<template>
  <div :class="['flex flex-col gap-6']">
    <section>
      <p :class="['mb-2 mt-0 text-sm font-semibold tracking-wide text-cyan-700 dark:text-cyan-300']">
        EXPERIENCE PREVIEW
      </p>
      <h1 :class="['m-0 text-3xl font-bold tracking-tight text-slate-950 dark:text-white']">
        體驗預覽
      </h1>
      <p :class="['mb-0 mt-2 text-sm text-slate-600 dark:text-slate-300']">
        在發布前檢查顧客會看到的助手名稱、開場招呼與互動服務畫面。
      </p>
    </section>

    <label :class="['flex max-w-md flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200']">
      預覽店別
      <select
        :value="selectedSiteId"
        :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900']"
        @change="selectSite(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="site in sites" :key="site.id" :value="site.id">
          {{ site.name }}
        </option>
      </select>
    </label>

    <p v-if="loading" :class="['m-0 text-sm text-slate-500 dark:text-slate-400']">
      正在載入體驗草稿…
    </p>
    <p v-else-if="message" :class="['m-0 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-100']">
      {{ message }}
    </p>
    <KioskExperiencePreview v-else-if="profileDraft" :draft="profileDraft" :site="selectedSite" />
    <p v-else :class="['m-0 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300']">
      尚未有可預覽的體驗草稿。
    </p>
  </div>
</template>

<route lang="yaml">
meta:
  layout: webnavior-admin
  title: 體驗預覽
</route>
