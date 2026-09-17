<script setup lang="ts">
import { Button, Input } from '@proj-airi/ui'
import { computed, reactive, watch } from 'vue'

export interface EmbeddingConnection {
  baseURL: string
  hasApiKey: boolean
  modelName: string
  provider: 'ollama' | 'openai-compatible'
  timeoutMs: number
}

export interface EmbeddingConnectionInput {
  baseURL: string
  modelName: string
  plaintextKey?: string
  provider: 'ollama' | 'openai-compatible'
  timeoutMs: number
}

const props = defineProps<{ busy: boolean, connection?: EmbeddingConnection }>()
const emit = defineEmits<{ save: [input: EmbeddingConnectionInput] }>()

const form = reactive({
  baseURL: 'http://localhost:11434/v1',
  modelName: 'gemma-embedding:latest',
  apiKey: '',
  provider: 'ollama' as EmbeddingConnectionInput['provider'],
  timeoutMs: 5000,
})
const canSave = computed(() => Boolean(form.baseURL.trim() && form.modelName.trim()) && !props.busy)

watch(() => props.connection, (connection) => {
  if (!connection)
    return
  form.baseURL = connection.baseURL
  form.modelName = connection.modelName
  form.provider = connection.provider
  form.timeoutMs = connection.timeoutMs
  form.apiKey = ''
}, { immediate: true })

function applyProviderPreset() {
  if (form.provider === 'ollama') {
    form.baseURL = 'http://localhost:11434/v1'
    form.modelName = 'gemma-embedding:latest'
  }
  else {
    form.baseURL = ''
    form.modelName = ''
  }
  form.apiKey = ''
}

function save() {
  emit('save', {
    baseURL: form.baseURL.trim(),
    modelName: form.modelName.trim(),
    ...(form.apiKey.trim() ? { plaintextKey: form.apiKey.trim() } : {}),
    provider: form.provider,
    timeoutMs: form.timeoutMs,
  })
}
</script>

<template>
  <section id="embedding-service" :class="['flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900']">
    <div>
      <h2 :class="['m-0 text-lg font-semibold text-slate-950 dark:text-white']">
        Kiosk 語意判斷（Embedding）
      </h2>
      <p :class="['mb-0 mt-1 text-sm text-slate-600 dark:text-slate-300']">
        只由 Server 呼叫，用來協助辨識顧客是否真的改口或下單；Kiosk 不會下載 embedding 模型。變更會立即套用到後續判斷。
      </p>
    </div>

    <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
      Embedding 服務
      <select v-model="form.provider" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950']" :disabled="props.busy" @change="applyProviderPreset">
        <option value="ollama">Ollama</option>
        <option value="openai-compatible">其他 OpenAI-compatible 服務</option>
      </select>
    </label>

    <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
      服務位址（Base URL）
      <Input v-model="form.baseURL" :disabled="props.busy" type="url" placeholder="https://api.example.com/v1" />
    </label>

    <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
      Embedding 模型名稱
      <Input v-model="form.modelName" :disabled="props.busy" placeholder="gemma-embedding:latest" />
    </label>

    <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
      API Key（選填）
      <Input v-model="form.apiKey" :disabled="props.busy" type="password" autocomplete="new-password" :placeholder="props.connection?.hasApiKey ? '已儲存；留白會保留目前金鑰' : '內網或地端服務可留白'" />
      <span :class="['text-xs font-normal text-slate-500 dark:text-slate-400']">
        {{ props.connection?.hasApiKey ? '目前已加密儲存金鑰；若要更換才重新輸入。' : '只有服務要求驗證時才需要填寫，金鑰不會回傳到瀏覽器。' }}
      </span>
    </label>

    <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
      逾時時間（毫秒）
      <Input v-model.number="form.timeoutMs" :disabled="props.busy" type="number" min="1000" max="30000" step="500" />
    </label>

    <div :class="['flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5 dark:border-slate-800']">
      <Button :disabled="!canSave" @click="save">
        儲存 Kiosk 語意判斷設定
      </Button>
      <span :class="['text-sm text-slate-600 dark:text-slate-300']">
        {{ props.connection ? '目前設定已由 Redis 持久化。' : '尚未設定時，系統會保守地使用既有語音規則。' }}
      </span>
    </div>
  </section>
</template>
