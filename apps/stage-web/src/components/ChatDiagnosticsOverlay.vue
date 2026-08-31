<script setup lang="ts">
import { useChatDiagnosticsStore } from '@proj-airi/stage-ui/stores/chat/diagnostics'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

const diagnostics = useChatDiagnosticsStore()
const providersStore = useProvidersStore()
const { activeModel, activeProvider } = storeToRefs(useConsciousnessStore())
const { latest } = storeToRefs(diagnostics)

const contextLength = computed(() => providersStore
  .getModelsForProvider(activeProvider.value)
  .find(model => model.id === activeModel.value)
  ?.contextLength)

const statusLabel = computed(() => {
  switch (latest.value.status) {
    case 'running-tool':
      return `正在執行 ${latest.value.toolName ?? '工具'}`
    case 'generating':
      return '模型正在產生回覆'
    case 'missing-final-response':
      return '模型未產生收尾回覆'
    case 'failed':
      return '本回合失敗'
    default:
      return '本回合已完成'
  }
})
</script>

<template>
  <aside v-if="diagnostics.enabled" class="chat-diagnostics" aria-live="polite">
    <strong class="chat-diagnostics-title">對話診斷</strong>
    <span>{{ statusLabel }}</span>
    <span v-if="latest.usageAvailable">
      本回合：輸入 {{ latest.inputTokens ?? 0 }} · 輸出 {{ latest.outputTokens ?? 0 }} · 合計 {{ latest.totalTokens ?? 0 }} tokens
    </span>
    <span v-else>本回合 token usage：Provider 未回傳</span>
    <span v-if="contextLength">模型上下文上限：{{ contextLength.toLocaleString() }} tokens</span>
    <span v-else>模型上下文上限：未知</span>
    <span v-if="latest.error" class="chat-diagnostics-error">{{ latest.error }}</span>
  </aside>
</template>

<style scoped>
.chat-diagnostics { position: absolute; z-index: 30; right: 1rem; bottom: 1rem; display: grid; max-width: min(30rem, calc(100vw - 2rem)); gap: .25rem; padding: .7rem .85rem; border: 1px solid rgb(255 255 255 / .35); border-radius: .8rem; color: #e8f9ff; background: rgb(4 24 35 / .86); box-shadow: 0 .5rem 1.5rem rgb(0 0 0 / .22); font-size: .75rem; backdrop-filter: blur(.75rem); }
.chat-diagnostics-title { color: #9be7ff; font-size: .8rem; }
.chat-diagnostics-error { color: #ffb4b4; }
</style>
