<script setup lang="ts">
import type { AiCapability, AiCapabilitySelection, AiProviderProfile } from '../../composables/useWebnaviorAiControl'

import { Button } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  busy: boolean
  profiles: readonly AiProviderProfile[]
  selections: readonly AiCapabilitySelection[]
}>()
const emit = defineEmits<{ configure: [capability: AiCapability] }>()
const { t } = useI18n()
const capabilities: Array<{ description: string, id: AiCapability, title: string }> = [
  { id: 'chat', title: '對話 LLM', description: '處理顧客對話、點餐與工具操作。' },
  { id: 'vision', title: '視覺 VLM', description: '處理主動招呼或現場視覺理解。' },
  { id: 'asr', title: '語音辨識 ASR', description: '將顧客語音安全地轉成文字。' },
  { id: 'tts', title: '語音回覆 TTS', description: '將 Kiosk 的回應轉成語音播放。' },
]
const selectionByCapability = computed(() => new Map(props.selections.map(selection => [selection.capability, selection])))
const profilesByCapability = computed(() => new Map(capabilities.map(capability => [
  capability.id,
  props.profiles.filter(profile => profile.capability === capability.id),
])))

function activeProfile(capability: AiCapability) {
  return selectionByCapability.value.get(capability)?.providerProfile
}
</script>

<template>
  <section :class="['flex flex-col gap-5']">
    <div>
      <h2 :class="['m-0 text-lg font-semibold text-slate-950 dark:text-white']">
        Kiosk AI 能力
      </h2>
      <p :class="['mb-0 mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300']">
        每項能力各自保存 Provider；不會共用網址、模型或憑證。切換已驗證項目後，仍需套用才會影響 Kiosk。
      </p>
    </div>

    <article v-for="capability in capabilities" :key="capability.id" :class="['flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900']">
      <div :class="['flex flex-wrap items-start justify-between gap-4']">
        <div>
          <h3 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
            {{ capability.title }}
          </h3>
          <p :class="['mb-0 mt-1 text-sm text-slate-600 dark:text-slate-300']">
            {{ capability.description }}
          </p>
        </div>
        <Button :disabled="props.busy" @click="emit('configure', capability.id)">
          設定{{ capability.title }}
        </Button>
      </div>

      <div v-if="activeProfile(capability.id)" :class="['rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-50']">
        <span :class="['font-semibold']">目前啟用：</span>
        {{ activeProfile(capability.id)?.name }} · {{ activeProfile(capability.id)?.modelId }}
        <p v-if="capability.id === 'chat' && activeProfile(capability.id)?.kind === 'openai-compatible'" :class="['mb-0 mt-2']">
          {{ t('settings.kiosk-chat-response.title') }}：{{ t(`settings.kiosk-chat-response.${activeProfile(capability.id)?.responseMode}`) }}
        </p>
      </div>
      <div v-else :class="['rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-50']">
        尚未啟用 Provider。
      </div>
      <p :class="['m-0 text-sm text-slate-500 dark:text-slate-400']">
        已保存 {{ profilesByCapability.get(capability.id)?.length ?? 0 }} 個 Provider。
      </p>
    </article>
  </section>
</template>
