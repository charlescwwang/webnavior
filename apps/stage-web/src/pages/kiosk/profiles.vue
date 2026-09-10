<script setup lang="ts">
import { Button, Input, Textarea } from '@proj-airi/ui'
import { onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useKioskManagement } from '../../composables/useKioskManagement'

const route = useRoute()
const {
  devices,
  draftName,
  load,
  loading,
  message,
  save,
  saving,
  selectedSite,
  selectedSiteId,
  selectSite,
  sites,
  snapshotText,
} = useKioskManagement()

onMounted(async () => {
  await load()
  const siteId = typeof route.query.site === 'string' ? route.query.site : undefined
  if (siteId && sites.value.some(site => site.id === siteId))
    await selectSite(siteId)
})

watch(() => route.query.site, async (siteId) => {
  if (typeof siteId === 'string' && sites.value.some(site => site.id === siteId))
    await selectSite(siteId)
})
</script>

<template>
  <div :class="['flex flex-col gap-6']">
    <section :class="['flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between']">
      <div>
        <p :class="['mb-2 mt-0 text-sm font-semibold tracking-wide text-cyan-700 dark:text-cyan-300']">
          CONFIGURATION
        </p>
        <h1 :class="['m-0 text-3xl font-bold tracking-tight text-slate-950 dark:text-white']">
          互動服務與 Profile
        </h1>
        <p :class="['mb-0 mt-2 text-sm text-slate-600 dark:text-slate-300']">
          編輯草稿，確認後才發布給指定店別的 Kiosk。
        </p>
      </div>
      <span v-if="selectedSite" :class="['rounded-full bg-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200']">{{ devices.length }} 台設備</span>
    </section>

    <section :class="['grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]']">
      <div :class="['flex flex-col gap-4']">
        <label :class="['flex flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200']">
          管理店別
          <select
            :value="selectedSiteId"
            :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900']"
            @change="selectSite(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="site in sites" :key="site.id" :value="site.id">{{ site.name }}</option>
          </select>
        </label>

        <section v-if="selectedSite" :class="['rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900']">
          <h2 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
            {{ selectedSite.name }}
          </h2>
          <dl :class="['mb-0 mt-5 grid gap-4 text-sm']">
            <div>
              <dt :class="['text-slate-500 dark:text-slate-400']">
                已註冊設備
              </dt>
              <dd :class="['mb-0 mt-1 font-semibold text-slate-900 dark:text-white']">
                {{ devices.length }} 台
              </dd>
            </div>
            <div>
              <dt :class="['text-slate-500 dark:text-slate-400']">
                互動資料保存
              </dt>
              <dd :class="['mb-0 mt-1 font-semibold text-slate-900 dark:text-white']">
                {{ selectedSite.interactionRetentionDays }} 天
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section v-if="selectedSiteId" :class="['flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900']">
        <div>
          <h2 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
            Profile 草稿
          </h2>
          <p :class="['mb-0 mt-1 text-sm text-slate-500 dark:text-slate-400']">
            此設定會保存在伺服器；只有發布後才會下發至設備。
          </p>
        </div>
        <label :class="['flex flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200']">Profile 名稱<Input v-model="draftName" /></label>
        <label :class="['flex flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200']">Profile 設定（JSON）<Textarea v-model="snapshotText" :rows="18" /></label>
        <div :class="['flex flex-wrap gap-3']">
          <Button :disabled="saving || loading" @click="save(false)">
            儲存草稿
          </Button>
          <Button :disabled="saving || loading" @click="save(true)">
            發布到此店別
          </Button>
        </div>
      </section>
    </section>

    <p v-if="message" :class="['m-0 text-sm text-amber-700 dark:text-amber-300']">
      {{ message }}
    </p>
  </div>
</template>

<route lang="yaml">
meta:
  layout: webnavior-admin
  title: 互動服務與 Profile
</route>
