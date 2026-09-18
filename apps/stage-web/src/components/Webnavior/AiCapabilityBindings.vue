<script setup lang="ts">
import type { AiBinding, AiCapability, AiConnection } from '../../composables/useWebnaviorAiControl'

import { Button } from '@proj-airi/ui'
import { computed, reactive, watch } from 'vue'

const props = defineProps<{
  bindings: readonly AiBinding[]
  busy: boolean
  connections: readonly AiConnection[]
}>()
const emit = defineEmits<{
  apply: []
  save: [input: { capability: AiCapability, connectionId: string, modelId: string, voice?: string }]
}>()

const capabilities: Array<{ description: string, id: AiCapability, title: string }> = [
  { id: 'chat', title: '對話', description: '處理顧客對話、點餐與工具操作。' },
  { id: 'vision', title: '視覺理解', description: '只在啟用主動視覺互動時使用。' },
  { id: 'asr', title: '語音辨識', description: '將顧客語音轉成文字。' },
  { id: 'tts', title: '語音回覆', description: '將 Kiosk 回應唸給顧客聽。' },
  { id: 'embedding', title: '語意判斷', description: '協助判斷改口、背景聲與打斷時機；只由 Server 使用。' },
]
const selection = reactive<Record<AiCapability, { connectionId: string, modelId: string, voice: string }>>({
  asr: { connectionId: '', modelId: '', voice: '' },
  chat: { connectionId: '', modelId: '', voice: '' },
  embedding: { connectionId: '', modelId: '', voice: '' },
  tts: { connectionId: '', modelId: '', voice: '' },
  vision: { connectionId: '', modelId: '', voice: '' },
})
const connectionById = computed(() => new Map(props.connections.map(connection => [connection.id, connection])))

watch(() => props.bindings, (bindings) => {
  for (const binding of bindings) {
    selection[binding.capability] = {
      connectionId: binding.connectionId,
      modelId: binding.modelId,
      voice: binding.voice ?? '',
    }
  }
}, { immediate: true })

function modelsFor(capability: AiCapability) {
  return connectionById.value.get(selection[capability].connectionId)?.discoveredModels ?? []
}

function changeConnection(capability: AiCapability) {
  selection[capability].modelId = ''
}

function save(capability: AiCapability) {
  const selected = selection[capability]
  if (!selected.connectionId || !selected.modelId)
    return
  emit('save', {
    capability,
    connectionId: selected.connectionId,
    modelId: selected.modelId,
    ...(capability === 'tts' && selected.voice.trim() ? { voice: selected.voice.trim() } : {}),
  })
}
</script>

<template>
  <section :class="['flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900']">
    <div>
      <h2 :class="['m-0 text-lg font-semibold text-slate-950 dark:text-white']">
        Kiosk 能力指派
      </h2>
      <p :class="['mb-0 mt-1 text-sm text-slate-600 dark:text-slate-300']">
        每項能力只能選擇已成功讀取的模型。儲存後仍需按「套用到 Kiosk」才會生效。
      </p>
    </div>

    <article v-for="capability in capabilities" :key="capability.id" :class="['flex flex-col gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800']">
      <div>
        <h3 :class="['m-0 text-base font-semibold text-slate-900 dark:text-white']">
          {{ capability.title }}
        </h3>
        <p :class="['mb-0 mt-1 text-sm text-slate-600 dark:text-slate-300']">
          {{ capability.description }}
        </p>
      </div>
      <select v-model="selection[capability.id].connectionId" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950']" :disabled="props.busy" @change="changeConnection(capability.id)">
        <option value="">
          選擇服務連線
        </option>
        <option v-for="connection in props.connections" :key="connection.id" :value="connection.id">
          {{ connection.name }}
        </option>
      </select>
      <select v-model="selection[capability.id].modelId" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950']" :disabled="props.busy || !selection[capability.id].connectionId">
        <option value="">
          選擇模型
        </option>
        <option v-for="model in modelsFor(capability.id)" :key="model.id" :value="model.id">
          {{ model.id }}
        </option>
      </select>
      <input v-if="capability.id === 'tts'" v-model="selection.tts.voice" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950']" :disabled="props.busy" placeholder="Voice ID（選填）">
      <Button :disabled="props.busy || !selection[capability.id].connectionId || !selection[capability.id].modelId" @click="save(capability.id)">
        儲存{{ capability.title }}選擇
      </Button>
    </article>

    <Button :disabled="props.busy || !props.bindings.length" @click="emit('apply')">
      套用到 Kiosk
    </Button>
  </section>
</template>
