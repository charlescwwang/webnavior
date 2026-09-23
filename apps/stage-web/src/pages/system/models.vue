<script setup lang="ts">
import type { AiCapability, AiProviderProfileInput } from '../../composables/useWebnaviorAiControl'

import { Button } from '@proj-airi/ui'
import { computed, onMounted, shallowRef } from 'vue'

import AiCapabilityCards from '../../components/Webnavior/AiCapabilityCards.vue'
import AiProviderProfileDialog from '../../components/Webnavior/AiProviderProfileDialog.vue'

import { useWebnaviorAiControl } from '../../composables/useWebnaviorAiControl'
import { useWebnaviorNotice } from '../../composables/useWebnaviorNotice'

const aiControl = useWebnaviorAiControl()
const notice = useWebnaviorNotice()
const isLoaded = shallowRef(false)
const configuredCapability = shallowRef<AiCapability>()

const requiredCapabilities = [
  { id: 'chat', label: '對話 LLM' },
  { id: 'asr', label: '語音辨識 ASR' },
  { id: 'tts', label: '語音回覆 TTS' },
] as const
const selectedProfileId = computed(() => configuredCapability.value
  ? aiControl.selections.value.find(selection => selection.capability === configuredCapability.value)?.providerProfileId
  : undefined)
const missingRequiredCapabilities = computed(() => requiredCapabilities.filter(required =>
  !aiControl.selections.value.some(selection => selection.capability === required.id),
))

function reportFailure(fallback: string) {
  notice.error(aiControl.error.value ?? fallback)
}

function openCapability(capability: AiCapability) {
  configuredCapability.value = capability
}

function closeCapability() {
  configuredCapability.value = undefined
}

async function verifyAndSaveProvider(capability: AiCapability, input: AiProviderProfileInput, profileId?: string) {
  try {
    await aiControl.verifyAndSaveProvider(capability, input, profileId)
    notice.success(profileId ? 'Provider 已驗證並儲存變更。' : 'Provider 已驗證並儲存，現在可以設為啟用。')
    closeCapability()
  }
  catch {
    reportFailure('Provider 驗證失敗，設定尚未儲存。')
  }
}

async function refreshModels(capability: AiCapability, profileId: string) {
  try {
    await aiControl.refreshProfileModels(capability, profileId)
    notice.success('模型清單已更新。編輯後驗證並儲存，才會套用變更。')
  }
  catch {
    reportFailure('無法讀取模型清單。')
  }
}

async function discoverProviderModels(capability: AiCapability, input: AiProviderProfileInput) {
  try {
    const probe = await aiControl.discoverProviderModels(capability, input)
    notice.success(probe.catalogAvailable
      ? `連線成功，找到 ${probe.models.length} 個模型。請選擇模型後驗證並儲存。`
      : '連線成功，但服務未提供模型清單；請手動輸入 Model ID。')
    return probe
  }
  catch {
    reportFailure('無法連線至模型服務。請確認網址、網路與 API Key。')
    throw new Error('無法連線至模型服務。')
  }
}

async function activateProfile(capability: AiCapability, profileId: string) {
  try {
    await aiControl.selectProfile(capability, profileId)
    notice.success('已切換啟用 Provider；按「套用到 Kiosk」後才會在現場生效。')
  }
  catch {
    reportFailure('無法切換啟用 Provider。')
  }
}

async function removeProfile(capability: AiCapability, profileId: string) {
  try {
    await aiControl.deleteProfile(capability, profileId)
    notice.success('Provider 已移除。')
  }
  catch {
    reportFailure('無法移除目前正在使用的 Provider。')
  }
}

async function apply() {
  try {
    const result = await aiControl.apply()
    notice.success(`已套用 ${result.appliedCapabilities.length} 項 Kiosk AI 能力；下一次請求會使用新設定。`)
  }
  catch {
    reportFailure('無法套用 Kiosk AI 設定。')
  }
}

async function initializeSpeechGuard() {
  try {
    await aiControl.initializeSpeechGuard()
    notice.success(`語意防護基準已建立，共 ${aiControl.speechGuard.value.baselineCount} 筆語料。`)
  }
  catch {
    reportFailure('無法建立語意防護基準。請先套用已驗證的 Embedding Provider。')
  }
}

async function load() {
  await aiControl.load()
  isLoaded.value = true
  if (aiControl.error.value)
    reportFailure('無法載入 AI Provider 設定。')
}

onMounted(load)
</script>

<template>
  <div :class="['flex max-w-5xl flex-col gap-6']">
    <section :class="['flex flex-wrap items-end justify-between gap-4']">
      <div>
        <p :class="['mb-2 mt-0 text-sm font-semibold tracking-wide text-cyan-700 dark:text-cyan-300']">
          Webnavior 系統管理
        </p>
        <h1 :class="['m-0 text-2xl font-bold text-slate-950 dark:text-white']">
          Kiosk AI 能力
        </h1>
        <p :class="['mb-0 mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300']">
          分別管理對話、視覺、語音與語意判斷的 Provider。各能力獨立保存多個來源，可在已驗證項目間切換。
        </p>
      </div>
      <Button :disabled="aiControl.busy.value" @click="load">
        重新整理
      </Button>
    </section>

    <p v-if="aiControl.error.value" :class="['m-0 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200']">
      {{ aiControl.error.value }}
    </p>

    <section v-if="isLoaded && !aiControl.error.value && missingRequiredCapabilities.length" :class="['rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-50']">
      <h2 :class="['m-0 text-base font-semibold']">
        尚未完成 Kiosk 必要設定
      </h2>
      <p :class="['mb-0 mt-2 text-sm leading-6']">
        尚未啟用：{{ missingRequiredCapabilities.map(capability => capability.label).join('、') }}。設定、驗證並啟用後，再套用到 Kiosk。
      </p>
    </section>

    <AiCapabilityCards
      :busy="aiControl.busy.value"
      :profiles="aiControl.profiles.value"
      :selections="aiControl.selections.value"
      @configure="openCapability"
    />

    <section :class="['rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900']">
      <h2 :class="['m-0 text-lg font-semibold text-slate-950 dark:text-white']">
        套用設定
      </h2>
      <p :class="['mb-4 mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300']">
        儲存與切換只變更待套用設定；按下此按鈕後，Server 才會更新 Kiosk 使用的模型與 Provider。
      </p>
      <Button :disabled="aiControl.busy.value || !aiControl.selections.value.length" @click="apply">
        套用到 Kiosk
      </Button>
    </section>

    <section :class="['rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900']">
      <h2 :class="['m-0 text-lg font-semibold text-slate-950 dark:text-white']">
        語意防護基準
      </h2>
      <p :class="['mb-4 mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300']">
        以目前已套用的 Embedding Provider 將系統語料建立成 Server 基準，用於過濾新對話的背景人聲。更換 Embedding Provider 或模型後，請重新建立。
      </p>
      <p :class="['mb-4 text-sm text-slate-600 dark:text-slate-300']">
        <template v-if="aiControl.speechGuard.value.ready">
          已就緒：{{ aiControl.speechGuard.value.baselineCount }} 筆 · {{ aiControl.speechGuard.value.embeddingModelId }}
        </template>
        <template v-else-if="aiControl.speechGuard.value.configurationError">
          {{ aiControl.speechGuard.value.configurationError }} 請先按「套用到 Kiosk」，再建立基準。
        </template>
        <template v-else>
          尚未建立基準；新對話會使用保守的文字與 presence 判斷。
        </template>
      </p>
      <Button :disabled="aiControl.busy.value" @click="initializeSpeechGuard">
        {{ aiControl.speechGuard.value.ready ? '重新建立語意防護基準' : '建立語意防護基準' }}
      </Button>
    </section>

    <AiProviderProfileDialog
      :busy="aiControl.busy.value"
      :capability="configuredCapability"
      :discover-models="discoverProviderModels"
      :open="Boolean(configuredCapability)"
      :profiles="aiControl.profiles.value"
      :selected-profile-id="selectedProfileId"
      @activate="activateProfile"
      @delete="removeProfile"
      @refresh-models="refreshModels"
      @update:open="open => !open && closeCapability()"
      @verify-and-save="verifyAndSaveProvider"
    />
  </div>
</template>

<route lang="yaml">
path: /admin/system/models
meta:
  layout: webnavior-admin
  title: Kiosk AI 能力
</route>
