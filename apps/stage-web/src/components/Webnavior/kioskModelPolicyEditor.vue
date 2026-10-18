<script setup lang="ts">
import type { KioskVoiceVadSettings } from '@proj-airi/kiosk-proactive'

import type { KioskSiteTechnicalSettings } from '../../composables/useKioskManagement'

import { Button } from '@proj-airi/ui'

import ExperienceEditorSection from './experienceEditorSection.vue'

const props = defineProps<{
  busy: boolean
  settings: KioskSiteTechnicalSettings
}>()

const emit = defineEmits<{
  updatePerformanceProfile: [profile: KioskSiteTechnicalSettings['performanceProfile']]
  updateVoiceVadSettings: [settings: KioskVoiceVadSettings]
}>()

function updateVoiceVadSettings(event: Event) {
  const form = event.currentTarget as HTMLFormElement
  const fields = new FormData(form)
  emit('updateVoiceVadSettings', {
    threshold: Number(fields.get('threshold')),
    minSpeechDurationMs: Number(fields.get('minSpeechDurationMs')),
    maxSpeechDurationS: Number(fields.get('maxSpeechDurationS')),
    minSilenceDurationMs: Number(fields.get('minSilenceDurationMs')),
    speechPadMs: Number(fields.get('speechPadMs')),
  })
}
</script>

<template>
  <ExperienceEditorSection initially-open title="Kiosk 現場技術設定" description="調整現場影像與語音偵測行為。AI 模型與服務連線由系統「模型與服務」統一管理。">
    <label :class="['grid gap-2 rounded-xl border border-slate-200 p-4 text-sm font-semibold dark:border-slate-700']">
      Kiosk 效能設定檔
      <select :value="props.settings.performanceProfile" :disabled="busy" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900']" @change="emit('updatePerformanceProfile', ($event.target as HTMLSelectElement).value as KioskSiteTechnicalSettings['performanceProfile'])">
        <option value="constrained">節能：480p、2 Hz、6 秒事件短片（不支援連續錄影）</option>
        <option value="balanced">平衡：640×480、5 Hz、10 秒事件短片</option>
        <option value="high">高效能：720p、10 Hz、遵從錄影政策</option>
      </select>
    </label>

    <form :class="['grid gap-3 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700']" @submit.prevent="updateVoiceVadSettings">
      <div>
        <h3 :class="['m-0 text-sm font-semibold']">
          Silero VAD
        </h3>
        <p :class="['mb-0 mt-1 text-xs text-slate-500']">
          控制語音開始、結束與送往 ASR 的切段方式。儲存後，已連線的 Kiosk 會在下一次設定同步時套用。
        </p>
      </div>
      <label :class="['grid gap-1 font-semibold']">Threshold
        <input name="threshold" type="number" min="0.1" max="0.99" step="0.01" :value="props.settings.voiceVadSettings.threshold" :disabled="busy" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900']">
      </label>
      <div :class="['grid gap-3 sm:grid-cols-2']">
        <label :class="['grid gap-1 font-semibold']">Min speech duration (ms)
          <input name="minSpeechDurationMs" type="number" min="0" max="60000" step="1" :value="props.settings.voiceVadSettings.minSpeechDurationMs" :disabled="busy" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900']">
        </label>
        <label :class="['grid gap-1 font-semibold']">Max speech duration (s)
          <input name="maxSpeechDurationS" type="number" min="1" max="9999" step="1" :value="props.settings.voiceVadSettings.maxSpeechDurationS" :disabled="busy" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900']">
        </label>
        <label :class="['grid gap-1 font-semibold']">Min silence duration (ms)
          <input name="minSilenceDurationMs" type="number" min="0" max="60000" step="1" :value="props.settings.voiceVadSettings.minSilenceDurationMs" :disabled="busy" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900']">
        </label>
        <label :class="['grid gap-1 font-semibold']">Speech pad (ms)
          <input name="speechPadMs" type="number" min="0" max="10000" step="1" :value="props.settings.voiceVadSettings.speechPadMs" :disabled="busy" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900']">
        </label>
      </div>
      <Button type="submit" :disabled="busy">
        儲存 VAD 設定
      </Button>
    </form>
  </ExperienceEditorSection>
</template>
