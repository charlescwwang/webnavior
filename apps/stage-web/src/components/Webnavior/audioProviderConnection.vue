<script setup lang="ts">
import { errorMessageFrom } from '@moeru/std'
import { authedFetch } from '@proj-airi/stage-ui/libs/auth-fetch'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { Button, Input } from '@proj-airi/ui'
import { computed, reactive, shallowRef, watch } from 'vue'

type Capability = 'asr' | 'tts'
interface Model { id: string }

const props = defineProps<{ busy: boolean }>()
const emit = defineEmits<{ saved: [] }>()
const defaultTtsVoice = 'zh-TW-HsiaoChenNeural'
const form = reactive({ capability: 'asr' as Capability, baseURL: '', apiKey: '', selectedModel: '', voice: '' })
const models = shallowRef<Model[]>([])
const status = shallowRef('')
const checking = shallowRef(false)
const canCheck = computed(() => Boolean(form.baseURL.trim()) && !checking.value && !props.busy)
const asrModels = ['breeze-asr-26', 'kitchen-asr-v0.1', 'kitchen-asr-v0.2', 'kitchen-asr-v0.2.1']
const selectableModels = computed(() => form.capability === 'asr'
  ? asrModels.map(id => ({ id }))
  : models.value)

watch(() => form.capability, () => {
  form.selectedModel = ''
  form.voice = form.capability === 'tts' ? defaultTtsVoice : ''
  models.value = []
  status.value = ''
})

function endpoint(path: string) {
  return new URL(`/api/admin/config/router${path}`, SERVER_URL).toString()
}

async function check() {
  checking.value = true
  status.value = ''
  models.value = []
  form.selectedModel = ''
  try {
    const response = await authedFetch(endpoint('/discover-audio'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capability: form.capability, baseURL: form.baseURL, ...(form.apiKey ? { plaintextKey: form.apiKey } : {}) }) })
    if (!response.ok)
      throw new Error(await response.text())
    models.value = (await response.json() as { models: Model[] }).models
    status.value = form.capability === 'asr'
      ? '連線成功。請選擇此 ASR 服務允許的模型。'
      : models.value.length ? '連線成功，請選擇要使用的模型。' : '連線成功，但服務未回傳模型清單。'
  }
  catch (error) { status.value = errorMessageFrom(error) ?? '無法連線至語音服務。' }
  finally { checking.value = false }
}

async function save() {
  if (!form.selectedModel)
    return
  const response = await authedFetch(endpoint('/webnavior-audio'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capability: form.capability, baseURL: form.baseURL, upstreamModel: form.selectedModel, modelName: `openai-compatible/${form.selectedModel}`, ...(form.capability === 'tts' ? { voice: form.voice } : {}), ...(form.apiKey ? { plaintextKey: form.apiKey } : {}) }) })
  if (response.ok) {
    status.value = `${form.capability === 'asr' ? '語音辨識' : '語音合成'}設定已加密儲存。`
    emit('saved')
  }
  else {
    status.value = await response.text()
  }
}
</script>

<template>
  <section :class="['flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900']">
    <div>
      <h2 :class="['m-0 text-lg font-semibold text-slate-950 dark:text-white']">
        連接語音服務
      </h2><p :class="['mb-0 mt-1 text-sm text-slate-600 dark:text-slate-300']">
        ASR 與 TTS 均使用 OpenAI-compatible 服務。ASR 會確認轉錄能力並讀取服務公開的預設模型；TTS 讀取模型清單。
      </p>
    </div>
    <label :class="['flex flex-col gap-2 text-sm font-medium']">用途<select v-model="form.capability" :class="['rounded-lg border px-3 py-2']"><option value="asr">語音辨識（ASR）</option><option value="tts">語音合成（TTS）</option></select></label>
    <label :class="['flex flex-col gap-2 text-sm font-medium']">服務位址（Base URL）<Input v-model="form.baseURL" type="url" placeholder="https://api.example.com/v1" /></label>
    <label :class="['flex flex-col gap-2 text-sm font-medium']">API Key（選填）<Input v-model="form.apiKey" type="password" autocomplete="new-password" /><span :class="['text-xs font-normal text-slate-500']">地端或內網服務可留白；若服務要求驗證才填寫。</span></label>
    <label v-if="form.capability === 'tts'" :class="['flex flex-col gap-2 text-sm font-medium']">語音（Voice）<Input v-model="form.voice" placeholder="zh-TW-HsiaoChenNeural" /><span :class="['text-xs font-normal text-slate-500']">會原樣傳到 <code>voice</code> 欄位。預設為繁體中文曉臻語音。</span></label>
    <div :class="['flex flex-wrap items-center gap-3']">
      <Button :disabled="!canCheck" @click="check">
        {{ checking ? '正在測試…' : '測試連線並讀取模型' }}
      </Button><span :class="['text-sm text-slate-600 dark:text-slate-300']">{{ status }}</span>
    </div>
    <div v-if="models.length && selectableModels.length" :class="['flex flex-col gap-3 border-t pt-4']">
      <label :class="['flex flex-col gap-2 text-sm font-medium']">選擇實際傳給服務的模型<select v-model="form.selectedModel" :class="['rounded-lg border px-3 py-2']"><option value="" disabled>請選擇</option><option v-for="model in selectableModels" :key="model.id" :value="model.id">{{ model.id }}</option></select><span v-if="form.capability === 'asr'" :class="['text-xs font-normal text-slate-500']">這些是此服務可接受的模型名稱，會原樣傳到 <code>model</code> 欄位。</span></label><Button :disabled="!form.selectedModel || props.busy" @click="save">
        儲存 {{ form.capability === 'asr' ? 'ASR' : 'TTS' }} 設定
      </Button>
    </div>
  </section>
</template>
