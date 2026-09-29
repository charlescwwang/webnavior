<script setup lang="ts">
import type { SystemOneProfile, SystemOneProfileInput, SystemOneRuntimeModel } from '../../composables/useWebnaviorAiControl'

import { Button, Input } from '@proj-airi/ui'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { reactive, shallowRef, watch } from 'vue'

type ProfileForm = SystemOneProfileInput & { plaintextKey: string }

const props = defineProps<{
  busy: boolean
  inspectRuntimeModel: (input: Pick<SystemOneProfileInput, 'baseURL' | 'implementation' | 'timeoutMs'>) => Promise<SystemOneRuntimeModel>
  open: boolean
  profile?: SystemOneProfile
}>()
const emit = defineEmits<{
  'save': [input: SystemOneProfileInput]
  'update:open': [open: boolean]
  'update': [profileId: string, input: SystemOneProfileInput]
}>()

function createForm(): ProfileForm {
  return { baseURL: 'http://localhost:8000', implementation: 'dasein', modelId: '', name: '店內 Dasein', plaintextKey: '', timeoutMs: 5000 }
}

const form = reactive(createForm())
const runtimeModel = shallowRef<SystemOneRuntimeModel>()

watch(() => props.open, (open) => {
  if (!open)
    return
  Object.assign(form, props.profile
    ? { baseURL: props.profile.baseURL, implementation: props.profile.implementation, modelId: props.profile.modelId, name: props.profile.name, plaintextKey: '', timeoutMs: props.profile.timeoutMs }
    : createForm())
  runtimeModel.value = undefined
})

async function inspectModel() {
  if (!form.baseURL.trim())
    return
  runtimeModel.value = await props.inspectRuntimeModel({
    baseURL: form.baseURL.trim(),
    implementation: form.implementation,
    timeoutMs: form.timeoutMs,
  })
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
              先讀取目前服務實際載入的模型，再儲存並執行 readiness。
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
            <select v-model="form.implementation" :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950']" :disabled="props.busy">
              <option value="dasein">Dasein open-jev</option>
              <option value="lookski">lookski/openjev</option>
            </select>
          </label>
          <label :class="['flex flex-col gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 sm:col-span-2']">
            System One Base URL
            <Input v-model="form.baseURL" :disabled="props.busy" type="url" placeholder="例如：http://127.0.0.1:8000" />
            <span :class="['text-xs font-normal leading-5 text-slate-500 dark:text-slate-400']">填 API Server 可連到的網址，不要加上 <code>/v1/systemone</code>。</span>
          </label>
          <label :class="['flex flex-col gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200']">
            決策逾時（毫秒）
            <Input v-model.number="form.timeoutMs" :disabled="props.busy" type="number" min="1000" max="60000" step="1000" />
          </label>
          <label :class="['flex flex-col gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200']">
            API Key（選填）
            <Input v-model="form.plaintextKey" :disabled="props.busy" type="password" autocomplete="new-password" :placeholder="props.profile?.hasApiKey ? '留白會保留現有 API Key' : '只有服務要求 Bearer Token 時才填'" />
          </label>
        </div>

        <div :class="['mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800']">
          <div :class="['min-w-60 flex-1']">
            <p :class="['m-0 text-sm font-medium text-slate-700 dark:text-slate-200']">
              目前載入模型
            </p>
            <p :class="['mb-0 mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400']">
              Dasein 從 <code>/health.model</code>、lookski 從 <code>/health.model_id</code> 讀取；這是服務啟動時固定的模型。
            </p>
          </div>
          <Button variant="secondary" :disabled="props.busy || !form.baseURL.trim()" @click="inspectModel">
            讀取目前模型
          </Button>
          <p v-if="runtimeModel" :class="['m-0 text-sm text-emerald-700 dark:text-emerald-300']">
            偵測到：{{ runtimeModel.modelId }}
          </p>
        </div>

        <label :class="['mt-4 flex flex-col gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200']">
          Backend 模型識別
          <Input v-model="form.modelId" :disabled="props.busy" placeholder="請先讀取目前模型" />
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
