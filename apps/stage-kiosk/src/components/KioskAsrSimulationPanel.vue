<script setup lang="ts">
import { BasicTextarea } from '@proj-airi/ui'
import { computed, shallowRef } from 'vue'

const props = defineProps<{
  busy: boolean
  status?: string
  trace?: string
}>()

const emit = defineEmits<{ simulate: [transcript: string] }>()

const transcript = shallowRef('')
const canSimulate = computed(() => Boolean(transcript.value.trim()) && !props.busy)

function simulate() {
  if (!canSimulate.value)
    return
  emit('simulate', transcript.value.trim())
  transcript.value = ''
}
</script>

<template>
  <section class="simulation-section">
    <h3>測試用：模擬 ASR 辨識結果</h3>
    <p class="simulation-description">
      不使用麥克風或 ASR；會直接把這段文字交給與正式語音相同的 System One、候選操作與 WebMCP 流程。可能操作目前購物車，請只在測試時使用。
    </p>
    <form class="simulation-form" @submit.prevent="simulate">
      <BasicTextarea
        v-model="transcript"
        class="simulation-input"
        placeholder="例如：我要一個周氏蝦捲招牌便當"
        @submit="simulate"
      />
      <button type="submit" class="simulation-button" :disabled="!canSimulate">
        {{ props.busy ? '正在測試…' : '模擬辨識並執行' }}
      </button>
    </form>
    <p v-if="props.status" class="simulation-status" role="status">
      {{ props.status }}
    </p>
    <details v-if="props.trace" class="simulation-trace">
      <summary>檢視本次 System One 決策 trace</summary>
      <pre>{{ props.trace }}</pre>
    </details>
  </section>
</template>

<style scoped>
.simulation-section { display: grid; gap: .8rem; border: 1px solid rgb(120 225 209 / 32%); border-radius: 1rem; padding: 1rem; background: rgb(18 82 80 / 22%); }
.simulation-section h3, .simulation-description, .simulation-status { margin: 0; }
.simulation-section h3 { font-size: .95rem; }
.simulation-description { color: rgb(217 250 246 / 74%); font-size: .84rem; line-height: 1.5; }
.simulation-form { display: grid; gap: .65rem; }
.simulation-input { min-height: 4.5rem; resize: vertical; border: 1px solid rgb(255 255 255 / 20%); border-radius: .75rem; padding: .65rem .75rem; color: #ecfffb; background: rgb(1 17 20 / 48%); outline: none; }
.simulation-button { justify-self: start; border: 1px solid rgb(120 225 209 / 42%); border-radius: .7rem; padding: .6rem .85rem; color: #063437; background: #78e1d1; cursor: pointer; font: inherit; font-weight: 800; }
.simulation-button:disabled { cursor: wait; opacity: .5; }
.simulation-status { border-left: 3px solid #78e1d1; padding-left: .65rem; color: #d9fffa; font-size: .82rem; line-height: 1.5; }
.simulation-trace { max-width: 100%; color: #d9fffa; font-size: .78rem; }
.simulation-trace pre { max-height: 22rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
