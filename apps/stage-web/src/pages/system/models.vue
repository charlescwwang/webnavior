<script setup lang="ts">
import type { ModelProviderSlice } from '../../components/Webnavior/modelProviderConnection.vue'

import { errorMessageFrom } from '@moeru/std'
import { authedFetch } from '@proj-airi/stage-ui/libs/auth-fetch'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { Button } from '@proj-airi/ui'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui'
import { computed, onMounted, reactive, shallowRef } from 'vue'

import AudioProviderConnection from '../../components/Webnavior/audioProviderConnection.vue'
import ConversationModelList from '../../components/Webnavior/ConversationModelList.vue'
import EmbeddingProviderConnection from '../../components/Webnavior/EmbeddingProviderConnection.vue'
import ModelProviderConnection from '../../components/Webnavior/modelProviderConnection.vue'
import SystemModelOverview from '../../components/Webnavior/SystemModelOverview.vue'

import { useWebnaviorNotice } from '../../composables/useWebnaviorNotice'

interface RouterConfigCurrent {
  preview: {
    LLM_ROUTER_CONFIG?: {
      asr?: { models: Record<string, unknown> }
      llm: { models: Record<string, unknown> }
      tts: { models: Record<string, unknown> }
    }
  }
  request: {
    defaults: {
      chatModel?: string
      ttsModel?: string
    }
  }
}

interface AudioConfig {
  asr?: { modelName: string, upstreamModel: string, baseURL: string, hasApiKey: boolean }
  tts?: { modelName: string, upstreamModel: string, baseURL: string, hasApiKey: boolean, voice?: string }
}

interface EmbeddingConfig {
  baseURL: string
  hasApiKey: boolean
  modelName: string
  provider: 'ollama' | 'openai-compatible'
  timeoutMs: number
}

const config = shallowRef<RouterConfigCurrent>()
const audioConfig = shallowRef<AudioConfig>({})
const embeddingConfig = shallowRef<EmbeddingConfig>()
const loading = shallowRef(false)
const message = shallowRef('')
const pendingRemovalModelId = shallowRef<string>()
const removalDialogOpen = shallowRef(false)
const form = reactive({ chatModel: '' })
const notice = useWebnaviorNotice()

const llmModels = computed(() => Object.keys(config.value?.preview.LLM_ROUTER_CONFIG?.llm.models ?? {}).sort())
const vlmModels = computed(() => llmModels.value.filter(model => model.startsWith('vlm/')))
const llmEndpoints = computed<Record<string, string | undefined>>(() => Object.fromEntries(llmModels.value.map((modelId) => {
  const model = config.value?.preview.LLM_ROUTER_CONFIG?.llm.models[modelId]
  const upstreams = model && typeof model === 'object' ? (model as { upstreams?: unknown }).upstreams : undefined
  const firstUpstream = Array.isArray(upstreams) ? upstreams[0] : undefined
  const baseURL = firstUpstream && typeof firstUpstream === 'object' ? (firstUpstream as { baseURL?: unknown }).baseURL : undefined
  return [modelId, typeof baseURL === 'string' ? baseURL : undefined]
})))
const llmEndpoint = computed(() => {
  const model = config.value?.preview.LLM_ROUTER_CONFIG?.llm.models[form.chatModel]
  if (!model || typeof model !== 'object')
    return undefined
  const upstreams = (model as { upstreams?: unknown }).upstreams
  if (!Array.isArray(upstreams) || !upstreams[0] || typeof upstreams[0] !== 'object')
    return undefined
  const baseURL = (upstreams[0] as { baseURL?: unknown }).baseURL
  return typeof baseURL === 'string' ? baseURL : undefined
})

function endpoint(path = '') {
  return new URL(`/api/admin/config/router${path}`, SERVER_URL).toString()
}

async function load() {
  loading.value = true
  message.value = ''
  try {
    const nextConfig = await authedFetch(endpoint()).then(async (response) => {
      if (!response.ok)
        throw new Error(await response.text() || `Request failed: ${response.status}`)
      return await response.json() as RouterConfigCurrent
    })
    config.value = nextConfig
    const audioResponse = await authedFetch(endpoint('/webnavior-audio'))
    if (!audioResponse.ok)
      throw new Error(await audioResponse.text() || `Request failed: ${audioResponse.status}`)
    audioConfig.value = await audioResponse.json() as AudioConfig
    const embeddingResponse = await authedFetch(endpoint('/webnavior-embedding'))
    if (!embeddingResponse.ok)
      throw new Error(await embeddingResponse.text() || `Request failed: ${embeddingResponse.status}`)
    const nextEmbeddingConfig = await embeddingResponse.json() as EmbeddingConfig | { configured: false }
    embeddingConfig.value = 'configured' in nextEmbeddingConfig ? undefined : nextEmbeddingConfig
    form.chatModel = nextConfig.request.defaults.chatModel ?? ''
  }
  catch (error) {
    notice.error(errorMessageFrom(error) ?? '無法讀取系統模型設定。請以系統管理員登入。')
  }
  finally {
    loading.value = false
  }
}

async function saveEmbedding(input: {
  baseURL: string
  modelName: string
  plaintextKey?: string
  provider: 'ollama' | 'openai-compatible'
  timeoutMs: number
}) {
  loading.value = true
  try {
    const response = await authedFetch(endpoint('/webnavior-embedding'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok)
      throw new Error(await response.text() || `Request failed: ${response.status}`)
    notice.success('Kiosk 語意判斷設定已加密儲存，後續語音判斷會立即使用。')
    await load()
  }
  catch (error) {
    notice.error(errorMessageFrom(error) ?? '無法儲存 Kiosk 語意判斷設定。')
  }
  finally {
    loading.value = false
  }
}

async function removeAudio(capability: 'asr' | 'tts') {
  loading.value = true
  try {
    const response = await authedFetch(endpoint(`/webnavior-audio/${capability}`), { method: 'DELETE' })
    if (!response.ok)
      throw new Error(await response.text())
    notice.success(`已移除${capability === 'asr' ? '語音辨識' : '語音合成'}設定。`)
    await load()
  }
  catch (error) { notice.error(errorMessageFrom(error) ?? '無法移除語音設定。') }
  finally { loading.value = false }
}

async function save() {
  const defaults = (form.chatModel ? { chatModel: form.chatModel } : {})
  if (Object.keys(defaults).length === 0)
    return

  loading.value = true
  message.value = ''
  try {
    const response = await authedFetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'merge',
        defaults,
      }),
    })
    if (!response.ok)
      throw new Error(await response.text() || `Request failed: ${response.status}`)
    notice.success('系統預設對話模型已更新。新的 Kiosk 對話會立即使用新的 LLM 預設。')
    await load()
  }
  catch (error) {
    notice.error(errorMessageFrom(error) ?? '無法儲存系統模型設定。')
  }
  finally {
    loading.value = false
  }
}

async function saveProvider(slices: ModelProviderSlice[]) {
  loading.value = true
  message.value = ''
  try {
    const response = await authedFetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'merge', slices }),
    })
    if (!response.ok)
      throw new Error(await response.text() || `Request failed: ${response.status}`)
    notice.success(`已加密儲存 ${slices.length} 個模型。現在可將它們選為系統預設或店別覆寫。`)
    await load()
  }
  catch (error) {
    notice.error(errorMessageFrom(error) ?? '無法儲存模型連線。')
  }
  finally {
    loading.value = false
  }
}

async function removeModel() {
  const modelId = pendingRemovalModelId.value
  if (!modelId)
    return
  removalDialogOpen.value = false
  pendingRemovalModelId.value = undefined
  loading.value = true
  message.value = ''
  try {
    const response = await authedFetch(endpoint(`/models/${encodeURIComponent(modelId)}`), { method: 'DELETE' })
    if (!response.ok)
      throw new Error(await response.text() || `Request failed: ${response.status}`)
    notice.success(`已移除模型「${modelId}」。`)
    await load()
  }
  catch (error) {
    notice.error(errorMessageFrom(error) ?? '無法移除模型。若它正被使用，請先改用其他模型。')
  }
  finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div :class="['flex max-w-4xl flex-col gap-6']">
    <section>
      <p :class="['mb-2 mt-0 text-sm font-semibold tracking-wide text-cyan-700 dark:text-cyan-300']">
        RUNTIME POLICY
      </p>
      <h1 :class="['m-0 text-3xl font-bold tracking-tight text-slate-950 dark:text-white']">
        系統模型
      </h1>
      <p :class="['mb-0 mt-2 text-sm text-slate-600 dark:text-slate-300']">
        設定所有店別共同沿用的模型。店別只能覆寫為這裡已配置的模型，無法看見供應商金鑰。
      </p>
    </section>

    <SystemModelOverview
      :asr="audioConfig.asr"
      :chat-model="form.chatModel"
      :llm-endpoint="llmEndpoint"
      :llm-models="llmModels"
      :vlm-models="vlmModels"
      :loading="loading"
      :tts="audioConfig.tts"
      @remove-audio="removeAudio"
      @save-defaults="save"
      @update:chat-model="form.chatModel = $event"
    />

    <ConversationModelList :endpoints="llmEndpoints" :loading="loading" :models="llmModels" @remove="pendingRemovalModelId = $event; removalDialogOpen = true" />

    <ModelProviderConnection :busy="loading" @save="saveProvider" />
    <div id="audio-services">
      <AudioProviderConnection :busy="loading" @saved="load" />
    </div>
    <EmbeddingProviderConnection :busy="loading" :connection="embeddingConfig" @save="saveEmbedding" />

    <AlertDialogRoot :open="removalDialogOpen" @update:open="removalDialogOpen = $event">
      <AlertDialogPortal>
        <AlertDialogOverlay :class="['fixed inset-0 z-100 bg-black/50']" />
        <AlertDialogContent :class="['fixed left-1/2 top-1/2 z-100 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900']" @interact-outside.prevent>
          <AlertDialogTitle :class="['text-xl font-semibold text-slate-950 dark:text-white']">
            移除模型？
          </AlertDialogTitle>
          <AlertDialogDescription :class="['mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300']">
            「{{ pendingRemovalModelId }}」的連線設定會被刪除，無法復原。
          </AlertDialogDescription>
          <div :class="['mt-6 flex justify-end gap-3']">
            <AlertDialogCancel as-child>
              <Button variant="secondary" @click="pendingRemovalModelId = undefined">
                取消
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction as-child>
              <Button variant="danger" @click="removeModel">
                確認移除
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialogRoot>

    <p v-if="message" :class="['m-0 text-sm text-amber-700 dark:text-amber-300']">
      {{ message }}
    </p>
  </div>
</template>

<route lang="yaml">
path: /admin/system/models
meta:
  layout: webnavior-admin
  title: 系統模型
</route>
