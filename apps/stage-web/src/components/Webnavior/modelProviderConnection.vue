<script setup lang="ts">
import { errorMessageFrom } from '@moeru/std'
import { authedFetch } from '@proj-airi/stage-ui/libs/auth-fetch'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { Button, Input } from '@proj-airi/ui'
import { computed, reactive, shallowRef } from 'vue'

export type ModelProviderKind = 'docker-model-runner' | 'ollama' | 'openai' | 'openai-compatible' | 'openrouter'

export interface ModelProviderSlice {
  baseURL: string
  kind: 'openai-compatible' | 'openrouter'
  modelName: string
  overrideModel: string
  plaintextKey?: string
}

interface DiscoveredModel {
  id: string
}

const props = defineProps<{ busy: boolean }>()
const emit = defineEmits<{ save: [slices: ModelProviderSlice[]] }>()

const form = reactive({
  apiKey: '',
  baseURL: 'https://api.openai.com/v1',
  kind: 'openai' as ModelProviderKind,
})
const discoveredModels = shallowRef<DiscoveredModel[]>([])
const selectedModelIds = shallowRef<string[]>([])
const discovering = shallowRef(false)
const discoveryMessage = shallowRef('')
const requiresApiKey = computed(() => form.kind === 'openai' || form.kind === 'openrouter')
const showsApiKey = computed(() => form.kind !== 'ollama' && form.kind !== 'docker-model-runner')

const providerHelp = computed(() => {
  switch (form.kind) {
    case 'openrouter': return '貼上 API Key 後，系統會從 OpenRouter 讀取你帳號可用的模型。'
    case 'ollama': return 'Ollama 預設在同一台機器的 11434 port 運作；若 Server 與 Ollama 不在同一台機器或容器，才需更改服務位址。'
    case 'docker-model-runner': return 'Docker Model Runner 預設在同一台機器的 12434 port 運作；若 Server 位於容器中，請使用容器可連回主機的位址。'
    case 'openai-compatible': return '可用於自架模型或其他 OpenAI-compatible 服務；系統會讀取其 /models 清單。'
    default: return '貼上 OpenAI API Key 後，系統會讀取你的帳號可用模型。'
  }
})
const canDiscover = computed(() => Boolean(form.baseURL.trim() && (!requiresApiKey.value || form.apiKey.trim())) && !props.busy && !discovering.value)
const selectedSlices = computed<ModelProviderSlice[]>(() => selectedModelIds.value.map(modelId => ({
  baseURL: form.baseURL.trim(),
  kind: form.kind === 'openrouter' ? 'openrouter' : 'openai-compatible',
  // The provider prefix prevents identically named upstream models from replacing one another.
  modelName: `${form.kind}/${modelId}`,
  overrideModel: modelId,
  // The current encrypted router requires a key record for every upstream.
  // Local OpenAI-compatible runtimes ignore this harmless placeholder; admins
  // never need to provide or manage a credential for them.
  plaintextKey: form.apiKey.trim() || 'not-needed',
})))

function endpoint(path: string) {
  return new URL(`/api/admin/config/router${path}`, SERVER_URL).toString()
}

function applyProviderPreset() {
  const presets: Record<ModelProviderKind, { baseURL: string, key: string }> = {
    'docker-model-runner': { baseURL: 'http://localhost:12434/engines/v1', key: '' },
    'ollama': { baseURL: 'http://localhost:11434/v1', key: '' },
    'openai': { baseURL: 'https://api.openai.com/v1', key: '' },
    'openai-compatible': { baseURL: '', key: '' },
    'openrouter': { baseURL: 'https://openrouter.ai/api/v1', key: '' },
  }
  const preset = presets[form.kind]
  form.baseURL = preset.baseURL
  form.apiKey = preset.key
  discoveredModels.value = []
  selectedModelIds.value = []
  discoveryMessage.value = ''
}

function toggleModel(modelId: string) {
  selectedModelIds.value = selectedModelIds.value.includes(modelId)
    ? selectedModelIds.value.filter(id => id !== modelId)
    : [...selectedModelIds.value, modelId]
}

async function discover() {
  discovering.value = true
  discoveryMessage.value = ''
  discoveredModels.value = []
  selectedModelIds.value = []
  try {
    const response = await authedFetch(endpoint('/discover-models'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseURL: form.baseURL.trim(),
        ...(form.apiKey.trim() ? { plaintextKey: form.apiKey.trim() } : {}),
      }),
    })
    if (!response.ok)
      throw new Error(await response.text() || `Request failed: ${response.status}`)

    const result = await response.json() as { models: DiscoveredModel[] }
    discoveredModels.value = result.models
    discoveryMessage.value = result.models.length
      ? '連線成功。請選擇要加入 Webnavior 的模型。'
      : '連線成功，但服務沒有回傳可用模型。請確認此帳號的模型權限。'
  }
  catch (error) {
    discoveryMessage.value = errorMessageFrom(error) ?? '無法讀取模型清單。'
  }
  finally {
    discovering.value = false
  }
}
</script>

<template>
  <section :class="['flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900']">
    <div>
      <h2 :class="['m-0 text-lg font-semibold text-slate-950 dark:text-white']">
        連接 AI 模型服務
      </h2>
      <p :class="['mb-0 mt-1 text-sm text-slate-600 dark:text-slate-300']">
        填入服務位址；需要驗證的服務再提供 API Key。確認連線後即可選擇要啟用的模型。
      </p>
    </div>

    <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
      模型服務
      <select v-model="form.kind" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950']" :disabled="props.busy || discovering" @change="applyProviderPreset">
        <option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option><option value="ollama">Ollama</option><option value="docker-model-runner">Docker Model Runner</option><option value="openai-compatible">其他 OpenAI-compatible 服務</option>
      </select>
    </label>

    <div :class="['flex gap-3 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950', 'dark:border-cyan-900/70 dark:bg-cyan-950/30 dark:text-cyan-100']">
      <span :class="['i-solar:info-circle-bold mt-0.5 shrink-0 text-lg text-cyan-700 dark:text-cyan-300']" />
      <p :class="['m-0 leading-6']">
        {{ providerHelp }}
      </p>
    </div>

    <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
      服務位址（Base URL）
      <Input v-model="form.baseURL" :disabled="props.busy || discovering" type="url" placeholder="https://api.example.com/v1" />
    </label>
    <label v-if="showsApiKey" :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
      {{ requiresApiKey ? 'API Key' : 'API Key（選填）' }}
      <Input v-model="form.apiKey" :disabled="props.busy || discovering" type="password" autocomplete="new-password" />
      <span :class="['text-xs font-normal text-slate-500 dark:text-slate-400']">{{ requiresApiKey ? '用於本次連線測試；選擇模型後才會加密保存。' : '自架或內網服務通常不需要填寫；需要驗證時再提供。' }}</span>
    </label>

    <div :class="['flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5 dark:border-slate-800']">
      <Button :disabled="!canDiscover" @click="discover">
        <span v-if="discovering" :class="['i-solar:spinner-line-duotone animate-spin']" />{{ discovering ? '正在讀取模型…' : '測試連線並讀取模型' }}
      </Button>
      <span v-if="discoveryMessage" :class="['text-sm text-slate-600 dark:text-slate-300']">{{ discoveryMessage }}</span>
    </div>

    <div v-if="discoveredModels.length" :class="['flex flex-col gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800']">
      <div>
        <h3 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
          選擇要啟用的模型
        </h3><p :class="['mb-0 mt-1 text-sm text-slate-600 dark:text-slate-300']">
          可以一次加入多個模型，之後再設定全系統或各店別使用哪一個。
        </p>
      </div>
      <div :class="['grid gap-2 sm:grid-cols-2']">
        <label v-for="model in discoveredModels" :key="model.id" :class="['flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm', selectedModelIds.includes(model.id) ? 'border-cyan-500 bg-cyan-50 dark:border-cyan-500 dark:bg-cyan-950/30' : 'border-slate-200 dark:border-slate-800']">
          <input :checked="selectedModelIds.includes(model.id)" type="checkbox" @change="toggleModel(model.id)">
          <span :class="['min-w-0 break-all font-mono text-slate-800 dark:text-slate-100']">{{ model.id }}</span>
        </label>
      </div>
      <Button :disabled="props.busy || selectedSlices.length === 0" @click="emit('save', selectedSlices)">
        加入 {{ selectedSlices.length }} 個模型
      </Button>
    </div>
  </section>
</template>
