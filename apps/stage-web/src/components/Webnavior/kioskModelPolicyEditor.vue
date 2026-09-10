<script setup lang="ts">
import type { KioskSiteModelPolicy } from '../../composables/useKioskManagement'

import { Button } from '@proj-airi/ui'
import { reactive, watch } from 'vue'

import ExperienceEditorSection from './experienceEditorSection.vue'

const props = defineProps<{
  busy: boolean
  policy: KioskSiteModelPolicy
}>()

const emit = defineEmits<{
  save: [overrides: KioskSiteModelPolicy['overrides']]
}>()

const overrides = reactive<KioskSiteModelPolicy['overrides']>({ ...props.policy.overrides })

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
</script>

<template>
  <ExperienceEditorSection initially-open title="模型策略" description="此店別預設沿用系統模型；覆寫只能選擇系統已核准的模型。">
    <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
      對話模型（LLM）
      <select
        :value="selectedValue('llm')"
        :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900']"
        :disabled="busy || props.policy.available.llm.length === 0"
        @change="updateOverride('llm', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">使用系統預設{{ props.policy.defaults.llm ? `：${props.policy.defaults.llm}` : '' }}</option>
        <option v-for="modelId in props.policy.available.llm" :key="modelId" :value="modelId">{{ modelId }}</option>
      </select>
      <span :class="['text-xs font-normal text-slate-500 dark:text-slate-400']">此選擇會在下一次 Kiosk 對話時由 Server 套用。</span>
    </label>

    <div :class="['rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300']">
      <p :class="['m-0 font-semibold text-slate-800 dark:text-slate-100']">
        語音與視覺能力
      </p>
      <p :class="['mb-0 mt-1']">
        TTS 與 ASR 的供應商模型由系統服務統一管理；Vision 目前由 Kiosk 裝置端執行。它們尚未支援店別覆寫，因此不會在這裡顯示無效的選項。
      </p>
    </div>

    <Button :disabled="busy" @click="save">
      儲存模型策略
    </Button>
  </ExperienceEditorSection>
</template>
