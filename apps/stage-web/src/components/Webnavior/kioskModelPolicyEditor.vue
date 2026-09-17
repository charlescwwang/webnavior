<script setup lang="ts">
import type { KioskVoiceVadSettings } from '@proj-airi/kiosk-proactive'

import type { KioskSiteModelPolicy } from '../../composables/useKioskManagement'

import { Button, Checkbox } from '@proj-airi/ui'
import { computed, reactive, watch } from 'vue'

import ExperienceEditorSection from './experienceEditorSection.vue'

const props = defineProps<{
  busy: boolean
  policy: KioskSiteModelPolicy
}>()

const emit = defineEmits<{
  save: [overrides: KioskSiteModelPolicy['overrides']]
  updateProactiveVlm: [enabled: boolean]
  updatePerformanceProfile: [profile: KioskSiteModelPolicy['performanceProfile']]
  updateVoiceVadSettings: [settings: KioskVoiceVadSettings]
}>()

const overrides = reactive<KioskSiteModelPolicy['overrides']>({ ...props.policy.overrides })

const modelCategories = [
  {
    description: '管理 Kiosk 對話的回覆模型。',
    icon: 'i-solar:chat-round-dots-bold-duotone',
    id: 'llm',
    label: '對話模型（LLM）',
  },
  {
    description: 'Kiosk 將錄音轉為文字時使用的模型。',
    icon: 'i-solar:microphone-3-bold-duotone',
    id: 'asr',
    label: '語音辨識（ASR）',
  },
  {
    description: 'Kiosk 朗讀助手回覆時使用的模型。',
    icon: 'i-solar:volume-loud-bold-duotone',
    id: 'tts',
    label: '語音合成（TTS）',
  },
  {
    description: '主動招呼與閒置提醒時，分析當下視訊畫面並決定自然台詞的模型。',
    icon: 'i-solar:eye-bold-duotone',
    id: 'vision',
    label: '現場影像（VLM）',
  },
] as const

watch(() => props.policy.overrides, (value) => {
  Object.assign(overrides, value)
  for (const category of ['asr', 'llm', 'tts', 'vision'] as const) {
    if (!value[category])
      delete overrides[category]
  }
})

function selectedValue(category: keyof KioskSiteModelPolicy['available']) {
  return overrides[category] ?? ''
}

function updateOverride(category: keyof KioskSiteModelPolicy['available'], value: string) {
  if (value)
    overrides[category] = value
  else
    delete overrides[category]
}

function save() {
  emit('save', { ...overrides })
}

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

const hasSelectableModels = computed(() => modelCategories.some(category => props.policy.available[category.id].length > 0))
const selectedTtsModel = computed(() => selectedValue('tts') || props.policy.defaults.tts)
const selectedTtsVoice = computed(() => selectedTtsModel.value
  ? props.policy.sources.tts[selectedTtsModel.value]?.voice
  : undefined)
</script>

<template>
  <ExperienceEditorSection initially-open title="Kiosk 模型設定" description="選擇已由系統管理者核准的模型。儲存後，下次 Kiosk 同步設定時會套用。">
    <div :class="['flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700']">
      <div>
        <h3 :class="['m-0 text-sm font-semibold']">
          VLM 情境台詞生成
        </h3><p :class="['mb-0 mt-1 text-xs text-slate-500']">
          MediaPipe 觸發後會主動招呼或提醒。開啟時會將當下畫面送往 VLM 生成情境台詞；關閉時不傳送影像，改依場域指引由一般 LLM 生成台詞。
        </p>
      </div>
      <Checkbox :model-value="props.policy.proactiveVlmEnabled" :disabled="busy" @update:model-value="emit('updateProactiveVlm', $event)" />
    </div>
    <label :class="['grid gap-2 rounded-xl border border-slate-200 p-4 text-sm font-semibold dark:border-slate-700']">
      Kiosk 效能設定檔
      <select :value="props.policy.performanceProfile" :disabled="busy" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900']" @change="emit('updatePerformanceProfile', ($event.target as HTMLSelectElement).value as KioskSiteModelPolicy['performanceProfile'])">
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
        <input name="threshold" type="number" min="0.1" max="0.99" step="0.01" :value="props.policy.voiceVadSettings.threshold" :disabled="busy" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900']">
      </label>
      <div :class="['grid gap-3 sm:grid-cols-2']">
        <label :class="['grid gap-1 font-semibold']">Min speech duration (ms)
          <input name="minSpeechDurationMs" type="number" min="0" max="60000" step="1" :value="props.policy.voiceVadSettings.minSpeechDurationMs" :disabled="busy" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900']">
        </label>
        <label :class="['grid gap-1 font-semibold']">Max speech duration (s)
          <input name="maxSpeechDurationS" type="number" min="1" max="9999" step="1" :value="props.policy.voiceVadSettings.maxSpeechDurationS" :disabled="busy" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900']">
        </label>
        <label :class="['grid gap-1 font-semibold']">Min silence duration (ms)
          <input name="minSilenceDurationMs" type="number" min="0" max="60000" step="1" :value="props.policy.voiceVadSettings.minSilenceDurationMs" :disabled="busy" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900']">
        </label>
        <label :class="['grid gap-1 font-semibold']">Speech pad (ms)
          <input name="speechPadMs" type="number" min="0" max="10000" step="1" :value="props.policy.voiceVadSettings.speechPadMs" :disabled="busy" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900']">
        </label>
      </div>
      <Button type="submit" :disabled="busy">
        儲存 VAD 設定
      </Button>
    </form>
    <section v-for="category in modelCategories" :key="category.id" :class="['grid gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700']">
      <div :class="['flex items-start gap-3']">
        <span :class="[category.icon, 'rounded-lg bg-cyan-50 p-2 text-xl text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300']" />
        <div>
          <h3 :class="['m-0 text-sm font-semibold text-slate-900 dark:text-white']">
            {{ category.label }}
          </h3>
          <p :class="['mb-0 mt-1 text-xs text-slate-500 dark:text-slate-400']">
            {{ category.description }}
          </p>
        </div>
      </div>
      <p v-if="category.id === 'tts'" :class="['m-0 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-950/40 dark:text-slate-300']">
        音色：<span :class="['font-semibold text-slate-900 dark:text-white']">{{ selectedTtsVoice ?? '尚未設定' }}</span>
        <span :class="['ml-1']">由系統「模型與服務」中的 TTS 連線統一管理，切換模型不會改變音色。</span>
      </p>
      <div v-if="props.policy.available[category.id].length" :class="['grid gap-2 sm:grid-cols-2']">
        <button
          type="button"
          :disabled="busy"
          :class="['rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50', selectedValue(category.id) === '' ? 'border-cyan-600 bg-cyan-50 text-cyan-900 dark:border-cyan-400 dark:bg-cyan-400/10 dark:text-cyan-100' : 'border-slate-200 hover:border-cyan-400 dark:border-slate-700 dark:hover:border-cyan-500']"
          @click="updateOverride(category.id, '')"
        >
          <span :class="['block text-sm font-semibold']">系統預設</span>
          <span :class="['mt-1 block text-xs opacity-75']">{{ props.policy.defaults[category.id] ?? '尚未設定預設模型' }}</span>
        </button>
        <button
          v-for="modelId in props.policy.available[category.id]"
          :key="modelId"
          type="button"
          :disabled="busy"
          :class="['rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50', selectedValue(category.id) === modelId ? 'border-cyan-600 bg-cyan-50 text-cyan-900 dark:border-cyan-400 dark:bg-cyan-400/10 dark:text-cyan-100' : 'border-slate-200 hover:border-cyan-400 dark:border-slate-700 dark:hover:border-cyan-500']"
          @click="updateOverride(category.id, modelId)"
        >
          <span :class="['block break-all text-sm font-semibold']">{{ modelId }}</span>
          <span :class="['mt-1 block break-all text-xs opacity-75']">{{ props.policy.sources[category.id][modelId]?.baseURL ?? '系統已核准的服務' }}</span>
          <span :class="['mt-1 block text-xs opacity-75']">實際模型：{{ props.policy.sources[category.id][modelId]?.upstreamModel ?? modelId }}</span>
          <span v-if="category.id === 'tts'" :class="['mt-1 block text-xs opacity-75']">音色：{{ props.policy.sources.tts[modelId]?.voice ?? '尚未設定' }}</span>
        </button>
      </div>
      <p v-else :class="['m-0 text-sm text-slate-500 dark:text-slate-400']">
        系統尚未核准可用模型。
      </p>
    </section>

    <Button :disabled="busy || !hasSelectableModels" @click="save">
      儲存模型策略
    </Button>
  </ExperienceEditorSection>
</template>
