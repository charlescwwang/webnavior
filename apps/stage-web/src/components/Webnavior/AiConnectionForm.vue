<script setup lang="ts">
import type { AiConnection, AiConnectionKind } from '../../composables/useWebnaviorAiControl'

import { Button, Input } from '@proj-airi/ui'
import { computed, reactive, ref, watch } from 'vue'

const props = defineProps<{ busy: boolean, connection?: AiConnection }>()
const emit = defineEmits<{
  cancel: []
  create: [input: ConnectionInput]
  update: [input: ConnectionInput & { id: string }]
}>()

interface ConnectionInput {
  baseURL: string
  clearApiKey?: boolean
  kind: AiConnectionKind
  name: string
  plaintextKey?: string
  timeoutMs: number
}

const form = reactive({
  baseURL: 'http://localhost:11434/v1',
  kind: 'ollama' as AiConnectionKind,
  name: '本機 Ollama',
  plaintextKey: '',
  timeoutMs: 5000,
})
const clearApiKey = ref(false)
const isEditing = computed(() => Boolean(props.connection))
const canCreate = computed(() => Boolean(form.name.trim() && form.baseURL.trim()) && !props.busy)

watch(() => props.connection, (connection) => {
  form.baseURL = connection?.baseURL ?? 'http://localhost:11434/v1'
  form.kind = connection?.kind ?? 'ollama'
  form.name = connection?.name ?? '本機 Ollama'
  form.plaintextKey = ''
  form.timeoutMs = connection?.timeoutMs ?? 5000
  clearApiKey.value = false
}, { immediate: true })

function changeKind() {
  if (form.kind === 'ollama') {
    form.baseURL = 'http://localhost:11434/v1'
    form.name = '本機 Ollama'
  }
  else {
    form.baseURL = ''
    form.name = ''
  }
  form.plaintextKey = ''
}

function submit() {
  const input: ConnectionInput = {
    baseURL: form.baseURL.trim(),
    ...(clearApiKey.value ? { clearApiKey: true } : {}),
    kind: form.kind,
    name: form.name.trim(),
    ...(form.plaintextKey.trim() ? { plaintextKey: form.plaintextKey.trim() } : {}),
    timeoutMs: form.timeoutMs,
  }
  if (props.connection)
    emit('update', { ...input, id: props.connection.id })
  else
    emit('create', input)
}
</script>

<template>
  <section :class="['flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900']">
    <div>
      <h2 :class="['m-0 text-lg font-semibold text-slate-950 dark:text-white']">
        {{ isEditing ? '編輯 AI 服務' : '新增 AI 服務' }}
      </h2>
      <p :class="['mb-0 mt-1 text-sm text-slate-600 dark:text-slate-300']">
        {{ isEditing ? '變更網址或服務類型後，必須重新讀取模型清單才能再次套用。' : '先建立服務連線，再讀取它提供的模型清單並指定 Kiosk 用途。' }}
      </p>
    </div>

    <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
      服務類型
      <select v-model="form.kind" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950']" :disabled="props.busy" @change="changeKind">
        <option value="ollama">Ollama</option>
        <option value="openai-compatible">OpenAI-compatible</option>
      </select>
    </label>

    <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
      顯示名稱
      <Input v-model="form.name" :disabled="props.busy" placeholder="例如：內網 Gemma 服務" />
    </label>

    <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
      Base URL
      <Input v-model="form.baseURL" :disabled="props.busy" type="url" placeholder="https://models.example.com/v1" />
    </label>

    <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
      API Key（選填）
      <Input v-model="form.plaintextKey" :disabled="props.busy || clearApiKey" type="password" autocomplete="new-password" :placeholder="isEditing ? '留白代表保留原本的 Key' : '地端無驗證服務可留白'" />
    </label>

    <label v-if="isEditing && props.connection?.hasApiKey" :class="['flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200']">
      <input v-model="clearApiKey" type="checkbox" :disabled="props.busy">
      清除已保存的 API Key
    </label>

    <div :class="['flex flex-wrap gap-2']">
      <Button :disabled="!canCreate" @click="submit">
        {{ isEditing ? '儲存變更' : '儲存服務連線' }}
      </Button>
      <Button v-if="isEditing" :disabled="props.busy" @click="emit('cancel')">
        取消編輯
      </Button>
    </div>
  </section>
</template>
