<script setup lang="ts">
import type { KioskInteractionEntry, KioskVisitorSessionDetail, KioskVisitorSessionSummary } from '../../composables/useKioskManagement'

import { authedFetch } from '@proj-airi/stage-ui/libs/auth-fetch'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { computed, onUnmounted, shallowRef } from 'vue'

import KioskVisitorSessionMedia from './kioskVisitorSessionMedia.vue'

const props = defineProps<{
  detail?: KioskVisitorSessionDetail
  session?: KioskVisitorSessionSummary
}>()
const audioSources = shallowRef<Record<string, string>>({})
const loadingAudioEntryId = shallowRef<string>()
const videoSources = shallowRef<Record<string, string>>({})
const loadingVideoEntryId = shallowRef<string>()
const conversationEntries = computed(() => {
  const entries = props.detail?.entries ?? []
  return entries.filter((entry, index) => {
    if (entry.kind === 'asr_transcript' || entry.kind === 'assistant_text')
      return true
    // A voice turn is persisted both as ASR evidence and as the LLM's user
    // message. Keep the transcription as the single customer-visible row.
    return entry.kind === 'user_text' && !entries.slice(0, index).some(previous => previous.kind === 'asr_transcript' && previous.content === entry.content)
  })
})
const activityEntries = computed(() => props.detail?.entries.filter(entry => entry.kind === 'service_event' || entry.kind === 'order_result') ?? [])

const dateTime = new Intl.DateTimeFormat('zh-TW', {
  dateStyle: 'short',
  timeStyle: 'medium',
})

function entryLabel(kind: KioskInteractionEntry['kind']) {
  return {
    assistant_text: '服務員回覆',
    asr_transcript: '語音轉錄',
    order_result: '點餐結果',
    service_event: '服務事件',
    tool_call: '工具呼叫',
    tool_result: '工具結果',
    user_text: '顧客輸入',
  }[kind]
}

function formatDate(value: string) {
  return dateTime.format(new Date(value))
}

function formatContent(entry: KioskInteractionEntry) {
  if (entry.kind !== 'service_event')
    return entry.content
  if (entry.content === 'customer_activity') {
    const source = entry.metadata.source
    return source === 'voice_input' ? '顧客開始語音輸入' : source === 'scenario' ? '顧客在互動服務操作' : source === 'completed' ? '顧客完成互動' : source === 'pointer' ? '舊版記錄：來源未能辨識' : '顧客互動活動'
  }
  return {
    completed: '顧客完成點餐流程',
    feedback_invitation_dismissed: '顧客關閉回饋邀請',
    feedback_invitation_shown: '顯示回饋邀請',
  }[entry.content] ?? entry.content
}

function audioForEntry(entry: KioskInteractionEntry) {
  if (entry.kind !== 'asr_transcript')
    return
  const entries = props.detail?.entries ?? []
  const index = entries.findIndex(item => item.id === entry.id)
  const activity = entries.slice(0, index).reverse().find(item => item.kind === 'service_event' && item.content === 'customer_activity' && item.metadata.source === 'voice_input')
  const linkedRecording = props.detail?.media.find(item => item.kind === 'audio_recording' && item.interactionEntryId === activity?.id)
  if (linkedRecording)
    return linkedRecording

  // Sessions collected before evidence links were introduced still retain
  // their WAV files. Present those recordings in the same chronological order
  // as ASR turns so operators do not lose access to already-collected POC data.
  const transcriptIndex = entries.filter(item => item.kind === 'asr_transcript').findIndex(item => item.id === entry.id)
  return props.detail?.media.filter(item => item.kind === 'audio_recording')[transcriptIndex]
}

function videoForEntry(entry: KioskInteractionEntry) {
  return props.detail?.media.find(item => item.kind === 'triggered_video' && item.interactionEntryId === entry.id)
}

async function loadAudio(entry: KioskInteractionEntry) {
  const media = audioForEntry(entry)
  if (!media || audioSources.value[entry.id])
    return
  loadingAudioEntryId.value = entry.id
  try {
    const response = await authedFetch(new URL(`/api/admin/kiosk/visitor-media/${media.id}`, SERVER_URL).toString())
    if (!response.ok)
      throw new Error(`Request failed: ${response.status}`)
    audioSources.value = { ...audioSources.value, [entry.id]: URL.createObjectURL(await response.blob()) }
  }
  finally {
    if (loadingAudioEntryId.value === entry.id)
      loadingAudioEntryId.value = undefined
  }
}

async function loadVideo(entry: KioskInteractionEntry) {
  const media = videoForEntry(entry)
  if (!media || videoSources.value[entry.id])
    return
  loadingVideoEntryId.value = entry.id
  try {
    const response = await authedFetch(new URL(`/api/admin/kiosk/visitor-media/${media.id}`, SERVER_URL).toString())
    if (!response.ok)
      throw new Error(`Request failed: ${response.status}`)
    videoSources.value = { ...videoSources.value, [entry.id]: URL.createObjectURL(await response.blob()) }
  }
  finally {
    if (loadingVideoEntryId.value === entry.id)
      loadingVideoEntryId.value = undefined
  }
}

onUnmounted(() => Object.values(audioSources.value).forEach(source => URL.revokeObjectURL(source)))
onUnmounted(() => Object.values(videoSources.value).forEach(source => URL.revokeObjectURL(source)))
</script>

<template>
  <section :class="['overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm', 'dark:border-slate-800 dark:bg-slate-900']">
    <div :class="['border-b border-slate-200 px-5 py-4 dark:border-slate-800']">
      <h2 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
        {{ props.session ? `${props.session.deviceLabel} 的互動內容` : '互動內容' }}
      </h2>
      <p v-if="props.session" :class="['mb-0 mt-1 text-xs text-slate-500 dark:text-slate-400']">
        開始於 {{ formatDate(props.session.createdAt) }}
      </p>
    </div>
    <div v-if="props.detail?.entries.length" :class="['flex flex-col gap-6 p-5']">
      <section v-if="conversationEntries.length">
        <h3 :class="['m-0 text-sm font-semibold text-slate-950 dark:text-white']">對話</h3>
        <ol :class="['mb-0 mt-3 flex flex-col gap-3 p-0']">
      <li v-for="entry in conversationEntries" :key="entry.id" :class="['rounded-lg border border-slate-200 p-3 dark:border-slate-700']">
        <div :class="['flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400']">
          <span :class="['font-semibold text-slate-700 dark:text-slate-200']">{{ entryLabel(entry.kind) }}</span>
          <time :datetime="entry.createdAt">{{ formatDate(entry.createdAt) }}</time>
        </div>
        <pre :class="['mb-0 mt-2 whitespace-pre-wrap break-words font-sans text-sm text-slate-800 dark:text-slate-100']">{{ formatContent(entry) }}</pre>
        <button v-if="audioForEntry(entry) && !audioSources[entry.id]" type="button" :class="['mt-3 rounded-md bg-cyan-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-800']" :disabled="loadingAudioEntryId === entry.id" @click="loadAudio(entry)">{{ loadingAudioEntryId === entry.id ? '載入錄音中…' : '聽顧客原始語音' }}</button>
        <audio v-else-if="audioSources[entry.id]" :src="audioSources[entry.id]" controls autoplay :class="['mt-3 w-full']" />
      </li>
        </ol>
      </section>
      <section v-if="activityEntries.length">
        <h3 :class="['m-0 text-sm font-semibold text-slate-950 dark:text-white']">行為摘要</h3>
        <ol :class="['mb-0 mt-3 flex flex-col gap-2 p-0']">
          <li v-for="entry in activityEntries" :key="entry.id" :class="['rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60']">
            <div :class="['flex items-center justify-between gap-3']"><span>{{ formatContent(entry) }}</span><time :datetime="entry.createdAt" :class="['text-xs text-slate-500 dark:text-slate-400']">{{ formatDate(entry.createdAt) }}</time></div>
            <button v-if="videoForEntry(entry) && !videoSources[entry.id]" type="button" :class="['mt-2 rounded-md bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900']" :disabled="loadingVideoEntryId === entry.id" @click="loadVideo(entry)">{{ loadingVideoEntryId === entry.id ? '載入短片中…' : '檢視此活動短片' }}</button>
            <video v-else-if="videoSources[entry.id]" :src="videoSources[entry.id]" controls playsinline :class="['mt-2 w-full rounded']" />
          </li>
        </ol>
      </section>
    </div>
    <p v-else-if="props.session" :class="['m-0 px-5 py-8 text-sm text-slate-500 dark:text-slate-400']">
      這次接待尚未留下可顯示的互動事件。
    </p>
    <p v-else :class="['m-0 px-5 py-8 text-sm text-slate-500 dark:text-slate-400']">
      從左側選擇一筆接待紀錄，以查看已保存的文字與事件。
    </p>
    <KioskVisitorSessionMedia v-if="props.detail" :media="props.detail.media" />
  </section>
</template>
