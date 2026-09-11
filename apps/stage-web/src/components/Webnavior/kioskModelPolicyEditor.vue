<script setup lang="ts">
import type { KioskSiteModelPolicy } from '../../composables/useKioskManagement'

import { Button } from '@proj-airi/ui'
import { computed, reactive, watch } from 'vue'

import ExperienceEditorSection from './experienceEditorSection.vue'

const props = defineProps<{
  busy: boolean
  policy: KioskSiteModelPolicy
}>()

const emit = defineEmits<{
  save: [overrides: KioskSiteModelPolicy['overrides']]
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

const hasSelectableModels = computed(() => modelCategories.some(category => props.policy.available[category.id].length > 0))
const selectedTtsModel = computed(() => selectedValue('tts') || props.policy.defaults.tts)
const selectedTtsVoice = computed(() => selectedTtsModel.value
  ? props.policy.sources.tts[selectedTtsModel.value]?.voice
  : undefined)
</script>

<template>
  <ExperienceEditorSection initially-open title="Kiosk 模型設定" description="選擇已由系統管理者核准的模型。儲存後，下次 Kiosk 同步設定時會套用。">
    <section v-for="category in modelCategories" :key="category.id" :class="['grid gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700']">
      <div :class="['flex items-start gap-3']">
        <span :class="[category.icon, 'rounded-lg bg-cyan-50 p-2 text-xl text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300']" />
        <div>
          <h3 :class="['m-0 text-sm font-semibold text-slate-900 dark:text-white']">{{ category.label }}</h3>
          <p :class="['mb-0 mt-1 text-xs text-slate-500 dark:text-slate-400']">{{ category.description }}</p>
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
      <p v-else :class="['m-0 text-sm text-slate-500 dark:text-slate-400']">系統尚未核准可用模型。</p>
    </section>

    <Button :disabled="busy || !hasSelectableModels" @click="save">
      儲存模型策略
    </Button>
  </ExperienceEditorSection>
</template>
