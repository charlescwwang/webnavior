<script setup lang="ts">
import type { FastPathTiming } from '../services/kiosk-fast-path'

import { toTaiwanTraditionalChinese } from '@proj-airi/stage-ui/libs/taiwan-traditional-chinese'
import { BasicTextarea, Button } from '@proj-airi/ui'
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  compact?: boolean
  status?: string
  trace?: string
  timing?: FastPathTiming
}>()

const emit = defineEmits<{ simulate: [transcript: string] }>()
const { t } = useI18n()

const transcript = shallowRef('')
const canSimulate = computed(() => Boolean(transcript.value.trim()))
const copyState = shallowRef<'copy' | 'copying' | 'copied' | 'failed'>('copy')

watch(() => props.trace, () => {
  // Keep one clipboard write in flight even when a new decision arrives.
  if (copyState.value !== 'copying')
    copyState.value = 'copy'
})

async function copyTrace() {
  const trace = props.trace
  if (!trace || copyState.value === 'copying')
    return
  copyState.value = 'copying'
  try {
    // Reuse the native clipboard path used by the shared ContainerError panel.
    // Copy the entire source, independent of the scrollable preview's height.
    await navigator.clipboard.writeText(trace)
    copyState.value = props.trace === trace ? 'copied' : 'copy'
  }
  catch {
    copyState.value = props.trace === trace ? 'failed' : 'copy'
  }
}

function simulate() {
  if (!canSimulate.value)
    return
  const text = transcript.value.trim()
  // Consume the draft before notifying the parent; another submit must not
  // observe the same draft, and parent processing never blocks new input.
  transcript.value = ''
  emit('simulate', text)
}
</script>

<template>
  <section :class="['simulation-section', { 'is-compact': props.compact }]">
    <h3>測試用：模擬 ASR 辨識結果</h3>
    <p class="simulation-description">
      不使用麥克風或 ASR；會直接把這段文字交給與正式語音相同的 System One、候選操作與 互動服務工具流程。可能操作目前購物車，請只在測試時使用。
    </p>
    <form class="simulation-form" @submit.prevent="simulate">
      <BasicTextarea
        v-model="transcript"
        class="simulation-input"
        placeholder="例如：我要一個周氏蝦捲招牌便當"
        @submit="simulate"
      />
      <button type="submit" class="simulation-button" :disabled="!canSimulate">
        模擬辨識並執行
      </button>
    </form>
    <p v-if="props.status" class="simulation-status" role="status">
      {{ toTaiwanTraditionalChinese(props.status) }}
    </p>
    <div v-if="props.timing" class="simulation-timing" aria-label="Jev 執行時間">
      <p>計時語句：{{ toTaiwanTraditionalChinese(props.timing.transcript) }}</p>
      <p>Jev 請求等待：{{ (props.timing.requestDurationMs / 1000).toFixed(2) }} 秒</p>
      <p v-if="props.timing.firstResultDurationMs !== undefined">
        首個判斷回來：{{ (props.timing.firstResultDurationMs / 1000).toFixed(2) }} 秒
      </p>
      <p v-if="props.timing.modelQuestions !== undefined">
        已處理有限問題：{{ props.timing.modelQuestions }} 題
      </p>
      <p v-if="props.timing.modelCalls !== undefined && props.timing.modelDurationMs !== undefined">
        模型呼叫：{{ props.timing.modelCalls }} 次；合計耗時：{{ (props.timing.modelDurationMs / 1000).toFixed(2) }} 秒
      </p>
      <p v-else>
        模型呼叫次數／耗時：未取得完整資料
      </p>
      <small>等待不含排隊、網頁操作及語音播放；模型耗時包含與 Jev 的網路往返，非純推論時間。</small>
    </div>
    <details v-if="props.trace" class="simulation-trace">
      <summary>檢視本次 System One 決策 trace</summary>
      <Button type="button" size="sm" variant="secondary" :disabled="copyState === 'copying'" :label="t(`stage.kiosk.decision-trace.${copyState === 'failed' ? 'copy' : copyState}`)" :class="['mt-3']" @click="copyTrace" />
      <p v-if="copyState === 'failed'" role="alert">
        {{ t('stage.kiosk.decision-trace.failed') }}
      </p>
      <pre>{{ props.trace }}</pre>
    </details>
  </section>
</template>

<style scoped>
.simulation-section { display: grid; gap: .8rem; border: 1px solid rgb(120 225 209 / 32%); border-radius: 1rem; padding: 1rem; background: rgb(18 82 80 / 22%); }
.simulation-section.is-compact { gap: .45rem; padding: .5rem; }
.is-compact .simulation-description { display: none; }
.is-compact .simulation-form { grid-template-columns: minmax(0, 1fr) auto; align-items: end; }
.simulation-section h3, .simulation-description, .simulation-status { margin: 0; }
.simulation-section h3 { font-size: .95rem; }
.simulation-description { color: rgb(217 250 246 / 74%); font-size: .84rem; line-height: 1.5; }
.simulation-form { display: grid; gap: .65rem; }
.simulation-input { min-height: 4.5rem; resize: vertical; border: 1px solid rgb(255 255 255 / 20%); border-radius: .75rem; padding: .65rem .75rem; color: #ecfffb; background: rgb(1 17 20 / 48%); outline: none; }
.simulation-button { justify-self: start; border: 1px solid rgb(120 225 209 / 42%); border-radius: .7rem; padding: .6rem .85rem; color: #063437; background: #78e1d1; cursor: pointer; font: inherit; font-weight: 800; }
.simulation-button:disabled { cursor: wait; opacity: .5; }
.simulation-status { border-left: 3px solid #78e1d1; padding-left: .65rem; color: #d9fffa; font-size: .82rem; line-height: 1.5; }
.simulation-timing { display: grid; gap: .3rem; color: #d9fffa; font-size: .82rem; }
.simulation-timing p { margin: 0; }
.simulation-timing small { color: rgb(217 250 246 / 74%); }
.simulation-trace { max-width: 100%; color: #d9fffa; font-size: .78rem; }
.simulation-trace pre { max-height: 22rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
