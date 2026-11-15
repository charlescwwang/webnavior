<script setup lang="ts">
import type { SystemOneProfile, SystemOneProfileInput, SystemOneRuntimeModel } from '../../composables/useWebnaviorAiControl'

import { Button, Input } from '@proj-airi/ui'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, reactive, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

type ProfileForm = SystemOneProfileInput & { plaintextKey: string }
const props = defineProps<{
  busy: boolean
  inspectRuntimeModel: (input: Pick<SystemOneProfileInput, 'baseURL' | 'implementation' | 'timeoutMs' | 'plaintextKey'>) => Promise<SystemOneRuntimeModel>
  open: boolean
  profile?: SystemOneProfile
}>()

const emit = defineEmits<{
  'save': [input: SystemOneProfileInput]
  'update:open': [open: boolean]
  'update': [profileId: string, input: SystemOneProfileInput]
}>()

const { t } = useI18n()

function createForm(): ProfileForm {
  return { baseURL: 'http://localhost:8000', implementation: 'dasein', modelId: '', name: '店內 Dasein', plaintextKey: '', timeoutMs: 5000 }
}

const form = reactive(createForm())
const runtimeModel = shallowRef<SystemOneRuntimeModel>()
const isDecisions = computed(() => form.implementation === 'openai-decisions')
const isModelCatalog = computed(() => isDecisions.value || form.implementation === 'slm')

function changeImplementation() {
  runtimeModel.value = undefined
  form.modelId = ''
  if (['店內 Dasein', '店內 lookski', '店內 SLM', t('stage.system-one.slm-profile-name'), 'OpenAI Decisions'].includes(form.name)) {
    const names = { 'dasein': '店內 Dasein', 'lookski': '店內 lookski', 'slm': t('stage.system-one.slm-profile-name'), 'openai-decisions': 'OpenAI Decisions' }
    form.name = names[form.implementation]
  }
  if (isDecisions.value) {
    if (['http://localhost:8000', 'http://127.0.0.1:12434/engines/v1'].includes(form.baseURL))
      form.baseURL = 'https://api.openai.com/v1'
    form.modelId = 'gpt-6-luna'
    return
  }
  if (form.baseURL === 'https://api.openai.com/v1')
    form.baseURL = 'http://localhost:8000'
  if (form.implementation === 'slm' && form.baseURL === 'http://localhost:8000') {
    form.baseURL = 'http://127.0.0.1:12434/engines/v1'
    form.timeoutMs = 30_000
  }
  else if (form.implementation !== 'slm' && form.baseURL === 'http://127.0.0.1:12434/engines/v1') {
    form.baseURL = 'http://localhost:8000'
  }
}

watch(() => form.baseURL, () => {
  runtimeModel.value = undefined
})

watch(() => props.open, (open) => {
  if (!open)
    return
  Object.assign(form, props.profile
    ? { baseURL: props.profile.baseURL, implementation: props.profile.implementation, modelId: props.profile.modelId, name: props.profile.name, plaintextKey: '', timeoutMs: props.profile.timeoutMs }
    : createForm())
  runtimeModel.value = undefined
}, { immediate: true })

async function inspectModel() {
  if (!form.baseURL.trim())
    return
  runtimeModel.value = await props.inspectRuntimeModel({
    baseURL: form.baseURL.trim(),
    implementation: form.implementation,
    timeoutMs: form.timeoutMs,
    ...(form.plaintextKey.trim() ? { plaintextKey: form.plaintextKey.trim() } : {}),
  })
  if (!runtimeModel.value.modelIds?.includes(form.modelId))
    form.modelId = runtimeModel.value.modelId
}

function save() {
  if (!form.baseURL.trim() || !form.modelId.trim() || !form.name.trim())
    return
  const input: SystemOneProfileInput = {
    baseURL: form.baseURL.trim(),
    implementation: form.implementation,
    modelId: form.modelId.trim(),
    name: form.name.trim(),
    ...(form.plaintextKey.trim() ? { plaintextKey: form.plaintextKey.trim() } : {}),
    timeoutMs: form.timeoutMs,
  }
  if (props.profile)
    emit('update', props.profile.id, input)
  else
    emit('save', input)
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay :class="['fixed inset-0 z-100 bg-black/50 backdrop-blur-sm']" />
      <DialogContent :class="['fixed left-1/2 top-1/2 z-100 max-h-[calc(100vh-2rem)] w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900']">
        <div :class="['mb-5 flex items-start justify-between gap-4']">
          <div>
            <DialogTitle :class="['m-0 text-lg font-semibold text-slate-950 dark:text-white']">
              {{ props.profile ? '編輯 System One profile' : '新增 System One profile' }}
            </DialogTitle>
            <p :class="['mb-0 mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300']">
              {{ t('stage.system-one.model-setup-hint') }}
            </p>
          </div>
          <button type="button" :class="['rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800']" aria-label="關閉 System One 設定" @click="emit('update:open', false)">
            <span class="i-solar:close-circle-bold text-xl" />
          </button>
        </div>

        <div :class="['grid gap-3 sm:grid-cols-2']">
          <label :class="['flex flex-col gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200']">
            Profile 名稱
            <Input v-model="form.name" :disabled="props.busy" placeholder="例如：店內 Dasein" />
          </label>
          <label :class="['flex flex-col gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200']">
            System One implementation
            <select v-model="form.implementation" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950']" :disabled="props.busy" @change="changeImplementation">
              <option value="dasein">Dasein open-jev</option>
              <option value="lookski">lookski/openjev</option>
              <option value="openai-decisions">OpenAI Decisions</option>
              <option value="slm">{{ t('stage.system-one.slm-option') }}</option>
            </select>
          </label>
          <label :class="['flex flex-col gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 sm:col-span-2']">
            System One Base URL
            <Input v-model="form.baseURL" :disabled="props.busy" type="url" placeholder="例如：http://127.0.0.1:8000" />
            <span :class="['text-xs font-normal leading-5 text-slate-500 dark:text-slate-400']">{{ isDecisions ? t('stage.system-one.decisions-base-url-hint') : form.implementation === 'slm' ? t('stage.system-one.slm-base-url-hint') : '填 API Server 可連到的網址，不要加上 /v1/systemone。' }}</span>
          </label>
          <label :class="['flex flex-col gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200']">
            決策逾時（毫秒）
            <Input v-model.number="form.timeoutMs" :disabled="props.busy" type="number" min="1000" max="60000" step="1000" />
          </label>
          <label :class="['flex flex-col gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200']">
            {{ isDecisions ? t('stage.system-one.decisions-api-key') : 'API Key（選填）' }}
            <Input v-model="form.plaintextKey" :disabled="props.busy" type="password" autocomplete="new-password" :placeholder="props.profile?.hasApiKey ? '留白會保留現有 API Key' : '只有服務要求 Bearer Token 時才填'" />
          </label>
        </div>

        <div :class="['mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800']">
          <div :class="['min-w-60 flex-1']">
            <p :class="['m-0 text-sm font-medium text-slate-700 dark:text-slate-200']">
              {{ isModelCatalog ? t('stage.system-one.available-models') : '目前載入模型' }}
            </p>
            <p :class="['mb-0 mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400']">
              {{ isDecisions ? t('stage.system-one.decisions-discovery-hint') : form.implementation === 'slm' ? t('stage.system-one.discovery-hint') : 'Dasein 從 /health.model、lookski 從 /health.model_id 讀取服務啟動時固定的模型。' }}
            </p>
          </div>
          <Button variant="secondary" :disabled="props.busy || !form.baseURL.trim()" @click="inspectModel">
            {{ isModelCatalog ? t('stage.system-one.read-models') : '讀取目前模型' }}
          </Button>
          <p v-if="runtimeModel" :class="['m-0 text-sm text-emerald-700 dark:text-emerald-300']">
            偵測到：{{ runtimeModel.modelId }}
          </p>
        </div>

        <label :class="['mt-4 flex flex-col gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200']">
          Backend 模型識別
          <select v-if="runtimeModel?.modelIds?.length" v-model="form.modelId" :disabled="props.busy" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950']">
            <option v-for="modelId in runtimeModel.modelIds" :key="modelId" :value="modelId">{{ modelId }}</option>
          </select>
          <Input v-else v-model="form.modelId" :disabled="props.busy" :placeholder="isDecisions ? 'gpt-6-luna' : '請先讀取目前模型'" />
        </label>

        <div :class="['mt-5 flex flex-wrap justify-end gap-2']">
          <Button variant="secondary" :disabled="props.busy" @click="emit('update:open', false)">
            取消
          </Button>
          <Button :disabled="props.busy || !form.name.trim() || !form.baseURL.trim() || !form.modelId.trim()" @click="save">
            {{ props.profile ? '儲存變更' : '儲存 System One profile' }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
