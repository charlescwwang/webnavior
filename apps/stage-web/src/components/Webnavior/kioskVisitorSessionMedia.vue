<script setup lang="ts">
import type { KioskVisitorMedia } from '../../composables/useKioskManagement'

import { authedFetch } from '@proj-airi/stage-ui/libs/auth-fetch'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { computed, onUnmounted, shallowRef } from 'vue'

const props = defineProps<{ media: KioskVisitorMedia[] }>()
const sources = shallowRef<Record<string, string>>({})
const loadingId = shallowRef<string>()
const videoItems = computed(() => props.media.filter(item => item.kind === 'continuous_video'))

function label(kind: KioskVisitorMedia['kind']) {
  return {
    audio_recording: '原始麥克風錄音',
    continuous_video: '連續攝影機片段',
    triggered_video: '互動觸發短片',
  }[kind]
}

function endpoint(media: KioskVisitorMedia) {
  return new URL(`/api/admin/kiosk/visitor-media/${media.id}`, SERVER_URL).toString()
}

function size(byteSize: number) {
  return `${(byteSize / 1024 / 1024).toFixed(1)} MB`
}

async function load(media: KioskVisitorMedia) {
  if (sources.value[media.id])
    return
  loadingId.value = media.id
  try {
    const response = await authedFetch(endpoint(media))
    if (!response.ok)
      throw new Error(`Request failed: ${response.status}`)
    sources.value = { ...sources.value, [media.id]: URL.createObjectURL(await response.blob()) }
  }
  finally {
    if (loadingId.value === media.id)
      loadingId.value = undefined
  }
}

onUnmounted(() => Object.values(sources.value).forEach(source => URL.revokeObjectURL(source)))
</script>

<template>
  <section :class="['border-t border-slate-200 p-5 dark:border-slate-800']">
    <h3 :class="['m-0 text-sm font-semibold text-slate-950 dark:text-white']">連續攝影機紀錄</h3>
    <p :class="['mb-3 mt-1 text-xs text-slate-500 dark:text-slate-400']">互動短片會直接出現在對應的顧客活動下；此區保留完整時序的攝影機片段。</p>
    <div v-if="videoItems.length" :class="['grid gap-4 lg:grid-cols-2']">
      <article v-for="item in videoItems" :key="item.id" :class="['rounded-lg border border-slate-200 p-3 dark:border-slate-700']">
        <p :class="['mb-2 mt-0 text-sm font-medium text-slate-800 dark:text-slate-100']">{{ label(item.kind) }} · {{ size(item.byteSize) }}</p>
        <button v-if="!sources[item.id]" type="button" :class="['rounded-md bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900']" :disabled="loadingId === item.id" @click="load(item)">{{ loadingId === item.id ? '載入中…' : '檢視影片' }}</button>
        <video v-else :src="sources[item.id]" controls playsinline :class="['w-full rounded']" />
      </article>
    </div>
    <p v-else :class="['m-0 text-sm text-slate-500 dark:text-slate-400']">這次接待目前沒有保存影片。</p>
  </section>
</template>
