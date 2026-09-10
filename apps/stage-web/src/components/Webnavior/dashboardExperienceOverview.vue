<script setup lang="ts">
import type { KioskProfileDraft, KioskSite } from '../../composables/useKioskManagement'

import { RouterLink } from 'vue-router'

defineProps<{
  experience?: KioskProfileDraft
  site?: KioskSite
}>()
</script>

<template>
  <section :class="['rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900']">
    <div :class="['flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between']">
      <div>
        <p :class="['mb-2 mt-0 text-sm font-semibold tracking-wide text-cyan-700 dark:text-cyan-300']">
          CUSTOMER EXPERIENCE
        </p>
        <h2 :class="['m-0 text-xl font-semibold text-slate-950 dark:text-white']">
          目前顧客會遇到的體驗
        </h2>
      </div>
      <RouterLink
        :to="site ? `/kiosk/profiles?site=${site.id}` : '/kiosk/profiles'"
        :class="['inline-flex items-center justify-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700', 'hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800']"
      >
        管理互動體驗
      </RouterLink>
    </div>

    <div v-if="experience" :class="['mt-6 grid gap-5 border-t border-slate-200 pt-5 dark:border-slate-800 sm:grid-cols-3']">
      <div>
        <p :class="['m-0 text-xs font-semibold text-slate-500 dark:text-slate-400']">
          已發布體驗
        </p>
        <p :class="['mb-0 mt-1 font-semibold text-slate-950 dark:text-white']">
          {{ experience.name }}
        </p>
      </div>
      <div>
        <p :class="['m-0 text-xs font-semibold text-slate-500 dark:text-slate-400']">
          顧客看到的助手
        </p>
        <p :class="['mb-0 mt-1 font-semibold text-slate-950 dark:text-white']">
          {{ experience.snapshot.characterName }}
        </p>
      </div>
      <div>
        <p :class="['m-0 text-xs font-semibold text-slate-500 dark:text-slate-400']">
          顧客可使用的服務
        </p>
        <p :class="['mb-0 mt-1 font-semibold text-slate-950 dark:text-white']">
          {{ experience.snapshot.interactiveService.title }}
        </p>
      </div>
    </div>

    <div v-else :class="['mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-100']">
      此店別尚未發布互動體驗，因此 Kiosk 不會使用新的顧客設定。
    </div>
  </section>
</template>
