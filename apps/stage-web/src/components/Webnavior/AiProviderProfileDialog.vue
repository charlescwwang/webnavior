<script setup lang="ts">
import type { AiCapability, AiModelCatalogProbe, AiProviderProfile, AiProviderProfileInput } from '../../composables/useWebnaviorAiControl'

import { Button, Checkbox, Input } from '@proj-airi/ui'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, reactive, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

type AiProviderProfileForm = Omit<AiProviderProfileInput, 'responseMode' | 'enableThinking' | 'modelId' | 'plaintextKey' | 'voice' | 'speed'> & {
  responseMode: NonNullable<AiProviderProfileInput['responseMode']>
  enableThinking: boolean
  modelId: string
  plaintextKey: string
  voice: string
  speed: number
}

const props = defineProps<{
  busy: boolean
  capability?: AiCapability
  discoverModels: (capability: AiCapability, input: AiProviderProfileInput, profileId?: string) => Promise<AiModelCatalogProbe>
  open: boolean
  profiles: readonly AiProviderProfile[]
  selectedProfileId?: string
  selectedFallbackProfileId?: string
}>()
const emit = defineEmits<{
  'activate': [capability: AiCapability, profileId: string]
  'delete': [capability: AiCapability, profileId: string]
  'refreshModels': [capability: AiCapability, profileId: string]
  'update:open': [open: boolean]
  'verifyAndSave': [capability: AiCapability, input: AiProviderProfileInput, profileId?: string]
}>()

const { t } = useI18n()

const editingProfile = shallowRef<AiProviderProfile>()
const showForm = shallowRef(false)
const form = reactive<AiProviderProfileForm>({
  baseURL: 'http://localhost:11434/v1',
  kind: 'ollama',
  enableThinking: false,
  responseMode: 'auto',
  modelId: '',
  name: '本機 Ollama',
  plaintextKey: '',
  timeoutMs: 30_000,
  voice: '',
  speed: 1,
})

function defaultTimeoutMs() {
  return props.capability === 'chat' ? 60_000 : 30_000
}

const speedAvailable = computed(() => props.capability === 'tts' && form.kind === 'openai-compatible')
const speedValid = computed(() => !speedAvailable.value || (Number.isFinite(form.speed) && form.speed >= 0.25 && form.speed <= 4))
const timeoutMaximum = computed(() => props.capability === 'chat' ? 60_000 : 30_000)
const capabilityTitles: Partial<Record<AiCapability, string>> = {
  asr: '語音辨識 ASR',
  chat: '對話 LLM',
  tts: '語音回覆 TTS',
  vision: '視覺 VLM',
}
const title = computed(() => capabilityTitles[props.capability ?? 'chat'] ?? 'AI 能力')
const visibleProfiles = computed(() => props.profiles.filter(profile => profile.capability === props.capability))
const modelCatalog = shallowRef<AiModelCatalogProbe>()
const testedConnectionSignature = shallowRef<string>()
const connectionSignature = computed(() => JSON.stringify({
  baseURL: form.baseURL.trim(),
  kind: form.kind,
  plaintextKey: form.plaintextKey.trim(),
  timeoutMs: form.timeoutMs,
}))
const hasTestedConnection = computed(() => testedConnectionSignature.value === connectionSignature.value && Boolean(modelCatalog.value))
const discoveredModels = computed(() => modelCatalog.value?.models ?? [])

watch(() => props.open, (open) => {
  if (!open) {
    showForm.value = false
    editingProfile.value = undefined
  }
})

function openNewProfile() {
  editingProfile.value = undefined
  resetForm()
  showForm.value = true
}

function openEditor(profile: AiProviderProfile) {
  editingProfile.value = profile
  form.baseURL = profile.baseURL
  form.enableThinking = profile.enableThinking
  form.responseMode = profile.responseMode
  form.kind = profile.kind
  form.modelId = profile.modelId ?? ''
  form.name = profile.name
  form.plaintextKey = ''
  form.timeoutMs = profile.timeoutMs
  form.voice = profile.voice ?? ''
  form.speed = profile.speed ?? 1
  modelCatalog.value = undefined
  testedConnectionSignature.value = undefined
  showForm.value = true
}

function resetForm() {
  form.baseURL = 'http://localhost:11434/v1'
  form.enableThinking = false
  form.responseMode = 'auto'
  form.kind = 'ollama'
  form.modelId = ''
  form.name = '本機 Ollama'
  form.plaintextKey = ''
  form.timeoutMs = defaultTimeoutMs()
  form.voice = ''
  form.speed = 1
  modelCatalog.value = undefined
  testedConnectionSignature.value = undefined
}

function changeKind() {
  if (form.kind === 'ollama') {
    form.baseURL = 'http://localhost:11434/v1'
    form.name = '本機 Ollama'
  }
  else if (form.kind === 'llama-cpp') {
    form.baseURL = 'http://localhost:8080/v1'
    form.name = '本機 llama.cpp'
  }
  else if (form.kind === 'openai-responses') {
    form.baseURL = 'https://api.openai.com/v1'
    form.name = 'OpenAI'
    form.enableThinking = false
  }
  else {
    form.baseURL = ''
    form.name = ''
  }
}

function connectionInput(): AiProviderProfileInput | undefined {
  if (!form.name.trim() || !form.baseURL.trim())
    return undefined
  return {
    baseURL: form.baseURL.trim(),
    kind: form.kind,
    name: form.name.trim(),
    ...(form.plaintextKey.trim() ? { plaintextKey: form.plaintextKey.trim() } : {}),
    timeoutMs: form.timeoutMs,
  }
}

async function testConnection() {
  if (!props.capability)
    return
  const input = connectionInput()
  if (!input)
    return
  try {
    const catalog = await props.discoverModels(props.capability, input, editingProfile.value?.id)
    if (connectionSignature.value !== JSON.stringify({
      baseURL: input.baseURL,
      kind: input.kind,
      plaintextKey: input.plaintextKey ?? '',
      timeoutMs: input.timeoutMs,
    })) {
      return
    }
    modelCatalog.value = catalog
    testedConnectionSignature.value = connectionSignature.value
    if (catalog.catalogAvailable && !catalog.models.some(model => model.id === form.modelId))
      form.modelId = ''
  }
  catch {
    // The parent has already shown an actionable toast; retain the form values.
  }
}

function verifyAndSaveProfile() {
  if (!props.capability || !form.name.trim() || !form.baseURL.trim() || !speedValid.value)
    return
  const input: AiProviderProfileInput = {
    baseURL: form.baseURL.trim(),
    kind: form.kind,
    ...(props.capability === 'chat' && form.kind === 'openai-compatible' ? { enableThinking: form.enableThinking, responseMode: form.responseMode } : {}),
    ...(props.capability === 'chat' && form.kind === 'openai-responses' ? { responseMode: form.responseMode } : {}),
    ...(form.modelId.trim() ? { modelId: form.modelId.trim() } : {}),
    name: form.name.trim(),
    ...(form.plaintextKey.trim() ? { plaintextKey: form.plaintextKey.trim() } : {}),
    timeoutMs: form.timeoutMs,
    ...(props.capability === 'tts' && form.voice.trim() ? { voice: form.voice.trim() } : {}),
    ...(speedAvailable.value ? { speed: form.speed } : {}),
  }
  emit('verifyAndSave', props.capability, input, editingProfile.value?.id)
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay :class="['fixed inset-0 z-100 bg-black/50 backdrop-blur-sm']" />
      <DialogContent :class="['fixed left-1/2 top-1/2 z-100 max-h-[calc(100vh-2rem)] w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900']">
        <div :class="['mb-5 flex items-center justify-between gap-4']">
          <div>
            <DialogTitle :class="['m-0 text-lg font-semibold text-slate-950 dark:text-white']">
              {{ title }} Provider
            </DialogTitle>
            <p :class="['mb-0 mt-1 text-sm text-slate-600 dark:text-slate-300']">
              此處的設定只供 {{ title }} 使用，不會與其他能力共用。
            </p>
          </div>
          <button type="button" :class="['rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800']" aria-label="關閉 Provider 設定" @click="emit('update:open', false)">
            <span class="i-solar:close-circle-bold text-xl" />
          </button>
        </div>

        <section v-if="!showForm" :class="['flex flex-col gap-4']">
          <Button :disabled="props.busy" @click="openNewProfile">
            新增{{ title }} Provider
          </Button>
          <p v-if="!visibleProfiles.length" :class="['m-0 rounded-lg bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300']">
            尚未保存此能力的 Provider。
          </p>
          <article v-for="profile in visibleProfiles" :key="profile.id" :class="['flex flex-col gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800']">
            <div :class="['flex flex-wrap items-start justify-between gap-3']">
              <div>
                <h3 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
                  {{ profile.name }}
                </h3>
                <p :class="['mb-0 mt-1 break-all text-sm text-slate-600 dark:text-slate-300']">
                  {{ profile.kind }} · {{ profile.baseURL }} · {{ profile.modelId ?? '尚未選擇模型' }}
                </p>
                <p v-if="profile.capability === 'chat' && (profile.kind === 'openai-compatible' || profile.kind === 'openai-responses')" :class="['mb-0 mt-2 text-sm text-cyan-800 dark:text-cyan-200']">
                  {{ t('settings.kiosk-chat-response.title') }}：{{ t(`settings.kiosk-chat-response.${profile.responseMode}`) }}
                </p>
              </div>
              <span :class="[profile.id === props.selectedProfileId ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100' : profile.verifiedAt ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-100' : 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100', 'rounded-full px-3 py-1 text-xs font-semibold']">
                {{ profile.id === props.selectedProfileId ? '目前啟用' : profile.id === props.selectedFallbackProfileId ? t('settings.kiosk-chat-fallback.backup-badge') : profile.verifiedAt ? '已驗證' : '待驗證' }}
              </span>
            </div>
            <p v-if="profile.lastCheckError || profile.lastVerificationError" :class="['m-0 text-sm text-red-600 dark:text-red-300']">
              {{ profile.lastVerificationError ?? profile.lastCheckError }}
            </p>
            <div :class="['flex flex-wrap gap-2']">
              <Button :disabled="props.busy" @click="openEditor(profile)">
                編輯
              </Button>
              <Button :disabled="props.busy" @click="emit('refreshModels', profile.capability, profile.id)">
                讀取模型
              </Button>
              <Button :disabled="props.busy || !profile.verifiedAt || profile.id === props.selectedProfileId || profile.id === props.selectedFallbackProfileId" :title="profile.id === props.selectedFallbackProfileId ? t('settings.kiosk-chat-fallback.clear-before-primary') : undefined" @click="emit('activate', profile.capability, profile.id)">
                設為啟用
              </Button>
              <Button :disabled="props.busy || profile.id === props.selectedProfileId || profile.id === props.selectedFallbackProfileId" @click="emit('delete', profile.capability, profile.id)">
                移除
              </Button>
            </div>
          </article>
        </section>

        <section v-else :class="['flex flex-col gap-4']">
          <div :class="['flex items-center justify-between gap-3']">
            <h3 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
              {{ editingProfile ? '編輯 Provider' : '新增 Provider' }}
            </h3>
            <Button :disabled="props.busy" @click="showForm = false">
              回到清單
            </Button>
          </div>
          <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
            Provider 類型
            <select v-model="form.kind" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950']" :disabled="props.busy" @change="changeKind">
              <option value="ollama">Ollama</option>
              <option value="llama-cpp">llama.cpp（啟用 Prompt Cache）</option>
              <option value="openai-compatible">OpenAI-compatible</option>
              <option v-if="props.capability === 'chat'" value="openai-responses">{{ t('settings.kiosk-openai.title') }}</option>
            </select>
          </label>
          <p v-if="form.kind === 'openai-responses'" :class="['m-0 text-xs leading-5 text-slate-500 dark:text-slate-400']">
            {{ t('settings.kiosk-openai.description') }}
          </p>
          <label v-if="props.capability === 'chat' && (form.kind === 'openai-compatible' || form.kind === 'openai-responses')" :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
            {{ t('settings.kiosk-chat-response.title') }}
            <select v-model="form.responseMode" :aria-label="t('settings.kiosk-chat-response.title')" :disabled="props.busy" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950']">
              <option value="auto">{{ t('settings.kiosk-chat-response.auto') }}</option>
              <option value="json">{{ t('settings.kiosk-chat-response.json') }}</option>
              <option value="sse">{{ t('settings.kiosk-chat-response.sse') }}</option>
            </select>
            <p :class="['m-0 text-xs leading-5 text-slate-500 dark:text-slate-400']">{{ t('settings.kiosk-chat-response.description') }}</p>
          </label>
          <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
            顯示名稱
            <Input v-model="form.name" :disabled="props.busy" placeholder="例如：店內主要模型" />
          </label>
          <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
            Base URL
            <Input v-model="form.baseURL" :disabled="props.busy" type="url" placeholder="https://models.example.com/v1" />
          </label>
          <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
            API Key（選填）
            <Input v-model="form.plaintextKey" :disabled="props.busy" type="password" autocomplete="new-password" :placeholder="editingProfile?.hasApiKey ? '留白代表保留原本的 Key' : '地端無驗證服務可留白'" />
          </label>
          <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
            等待時間（毫秒）
            <Input v-model.number="form.timeoutMs" :disabled="props.busy" type="number" min="1000" :max="timeoutMaximum" step="1000" />
            <p :class="['m-0 text-xs leading-5 text-slate-500 dark:text-slate-400']">
              {{ props.capability === 'chat' ? '對話 LLM 最長 60 秒；較慢模型可設定為 60000。' : '此能力最長 30 秒。' }}
            </p>
          </label>
          <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
            模型
            <select v-if="modelCatalog?.catalogAvailable" v-model="form.modelId" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950']" :disabled="props.busy || !hasTestedConnection">
              <option value="">請選擇模型</option>
              <option v-for="model in discoveredModels" :key="model.id" :value="model.id">{{ model.id }}</option>
            </select>
            <Input v-else v-model="form.modelId" :disabled="props.busy || !hasTestedConnection" placeholder="例如：gemma4:26b" />
            <p v-if="modelCatalog && !modelCatalog.catalogAvailable" :class="['m-0 text-xs leading-5 text-amber-700 dark:text-amber-300']">
              {{ modelCatalog.catalogMessage }}
            </p>
          </label>
          <div v-if="props.capability === 'chat' && form.kind === 'openai-compatible'" :class="['flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700']">
            <div>
              <label for="provider-thinking" :class="['text-sm font-semibold']">{{ t('settings.kiosk-thinking.title') }}</label>
              <p id="provider-thinking-description" :class="['mb-0 mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400']">
                {{ t('settings.kiosk-thinking.description') }}
              </p>
            </div>
            <Checkbox id="provider-thinking" v-model="form.enableThinking" :disabled="props.busy" aria-describedby="provider-thinking-description" />
          </div>
          <label v-if="props.capability === 'tts'" :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
            Voice ID（選填）
            <Input v-model="form.voice" :disabled="props.busy" placeholder="預設 zh-TW-HsiaoChenNeural" />
          </label>
          <label v-if="speedAvailable" :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
            {{ t('settings.kiosk-tts-speed.title') }}
            <Input v-model.number="form.speed" :disabled="props.busy" type="number" min="0.25" max="4" step="0.05" />
            <span :class="['text-xs leading-5 text-slate-500 dark:text-slate-400']">{{ t('settings.kiosk-tts-speed.description') }}</span>
          </label>
          <Button :disabled="props.busy || !form.name.trim() || !form.baseURL.trim()" @click="testConnection">
            測試連線與讀取模型
          </Button>
          <Button :disabled="props.busy || !form.name.trim() || !form.baseURL.trim() || !form.modelId || !hasTestedConnection || !speedValid" @click="verifyAndSaveProfile">
            驗證並儲存 Provider
          </Button>
        </section>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
