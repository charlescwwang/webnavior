<script setup lang="ts">
import { Button } from '@proj-airi/ui'

interface AudioService { upstreamModel: string, baseURL: string, voice?: string }

const props = defineProps<{
  asr?: AudioService
  chatModel: string
  llmEndpoint?: string
  llmModels: string[]
  loading: boolean
  tts?: AudioService
}>()

const emit = defineEmits<{
  'removeAudio': [capability: 'asr' | 'tts']
  'saveDefaults': []
  'update:chatModel': [value: string]
}>()
</script>

<template>
  <section :class="['overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900']">
    <div :class="['flex flex-col gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-end']">
      <div :class="['min-w-0 flex-1']">
        <h2 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
          系統預設
        </h2>
        <p :class="['mb-0 mt-1 text-sm text-slate-600 dark:text-slate-300']">
          新建立的互動體驗會採用此對話模型。語音服務請在下方服務能力中管理。
        </p>
      </div>
      <Button :disabled="props.loading || !props.chatModel" size="sm" @click="emit('saveDefaults')">
        儲存變更
      </Button>
    </div>
    <div :class="['p-5']">
      <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">對話模型（LLM）
        <select :value="props.chatModel" :class="['rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950']" :disabled="props.loading || props.llmModels.length === 0" @change="emit('update:chatModel', ($event.target as HTMLSelectElement).value)"><option value="" disabled>請選擇已配置模型</option><option v-for="model in props.llmModels" :key="model" :value="model">{{ model }}</option></select>
        <span :class="['font-mono text-xs font-normal text-slate-500 dark:text-slate-400']">{{ props.llmEndpoint ?? '尚未設定連線位址' }}</span>
      </label>
    </div>
  </section>

  <section :class="['overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900']">
    <div :class="['border-b border-slate-200 px-5 py-4 dark:border-slate-800']">
      <h2 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
        服務能力
      </h2><p :class="['mb-0 mt-1 text-sm text-slate-600 dark:text-slate-300']">
        每種能力各自管理連線與模型，不會共用供應商金鑰。
      </p>
    </div>
    <div :class="['divide-y divide-slate-200 dark:divide-slate-800']">
      <div :class="['flex flex-wrap items-center gap-3 px-5 py-3.5']">
        <span :class="['i-solar:microphone-3-bold-duotone text-lg text-cyan-600']" /><div :class="['min-w-45 flex-1']">
          <p :class="['m-0 text-sm font-medium text-slate-900 dark:text-white']">
            語音辨識 <span :class="['ml-1 text-xs font-normal text-slate-500']">ASR</span>
          </p><p :class="['mb-0 mt-0.5 font-mono text-xs text-slate-500']">
            {{ props.asr?.upstreamModel ?? '尚未設定' }}<span v-if="props.asr"> · {{ props.asr.baseURL }}</span>
          </p>
        </div><span :class="['rounded-full px-2 py-0.5 text-xs', props.asr ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300']">{{ props.asr ? '已設定' : '未設定' }}</span><a href="#audio-services" :class="['text-sm text-cyan-700 hover:underline dark:text-cyan-300']">設定</a><button v-if="props.asr" :disabled="props.loading" :class="['text-sm text-slate-500 hover:text-red-600 disabled:opacity-50 dark:text-slate-400']" type="button" @click="emit('removeAudio', 'asr')">
          移除
        </button>
      </div>
      <div :class="['flex flex-wrap items-center gap-3 px-5 py-3.5']">
        <span :class="['i-solar:volume-loud-bold-duotone text-lg text-cyan-600']" /><div :class="['min-w-45 flex-1']">
          <p :class="['m-0 text-sm font-medium text-slate-900 dark:text-white']">
            語音合成 <span :class="['ml-1 text-xs font-normal text-slate-500']">TTS</span>
          </p><p :class="['mb-0 mt-0.5 font-mono text-xs text-slate-500']">
            {{ props.tts?.upstreamModel ?? '尚未設定' }}<span v-if="props.tts"> · {{ props.tts.voice ?? 'zh-TW-HsiaoChenNeural' }} · {{ props.tts.baseURL }}</span>
          </p>
        </div><span :class="['rounded-full px-2 py-0.5 text-xs', props.tts ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300']">{{ props.tts ? '已設定' : '未設定' }}</span><a href="#audio-services" :class="['text-sm text-cyan-700 hover:underline dark:text-cyan-300']">設定</a><button v-if="props.tts" :disabled="props.loading" :class="['text-sm text-slate-500 hover:text-red-600 disabled:opacity-50 dark:text-slate-400']" type="button" @click="emit('removeAudio', 'tts')">
          移除
        </button>
      </div>
      <div :class="['flex flex-wrap items-center gap-3 px-5 py-3.5']">
        <span :class="['i-solar:eye-bold-duotone text-lg text-cyan-600']" /><div :class="['min-w-45 flex-1']">
          <p :class="['m-0 text-sm font-medium text-slate-900 dark:text-white']">
            現場觀測 <span :class="['ml-1 text-xs font-normal text-slate-500']">Vision</span>
          </p><p :class="['mb-0 mt-0.5 text-xs text-slate-500']">
            MediaPipe · 僅限裝置本機處理
          </p>
        </div><span :class="['rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300']">固定設定</span><span :class="['text-sm text-slate-400']">無需設定</span>
      </div>
    </div>
  </section>
</template>
