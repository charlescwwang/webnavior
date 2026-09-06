<script setup lang="ts">
import type { ProactiveTriggerMode } from '@proj-airi/kiosk-proactive'

import type { KioskProactiveModule } from '../../../modules/kiosk-proactive/catalog'

import { errorMessageFrom } from '@moeru/std'
import { defaultAttentionGreetingPrompt, defaultKioskAssistanceReminderSettings, defaultPresenceGreetingPrompt } from '@proj-airi/kiosk-proactive'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { Button, Checkbox, Input, SelectTab } from '@proj-airi/ui'
import { computed, onMounted, shallowRef, watch } from 'vue'

import KioskAssistanceReminderSettings from './components/KioskAssistanceReminderSettings.vue'
import KioskProactiveCameraTest from './components/KioskProactiveCameraTest.vue'
import KioskProactiveGreetingPrompts from './components/KioskProactiveGreetingPrompts.vue'

import { loadKioskProactiveModule } from '../../../modules/kiosk-proactive/catalog'

const installed = shallowRef(false)
const loading = shallowRef(true)
const loadError = shallowRef('')
const proactiveModule = shallowRef<KioskProactiveModule>()
const enabled = useLocalStorageManualReset('kiosk/proactive/enabled', false)
const dwellMs = useLocalStorageManualReset('kiosk/proactive/dwell-ms', 2500)
const emptyResetMs = useLocalStorageManualReset('kiosk/proactive/empty-reset-ms', 1500)
const triggerMode = useLocalStorageManualReset<ProactiveTriggerMode>('kiosk/proactive/trigger-mode', 'attention')
const attentionGreetingPrompt = useLocalStorageManualReset('kiosk/proactive/attention-greeting-prompt', defaultAttentionGreetingPrompt)
const presenceGreetingPrompt = useLocalStorageManualReset('kiosk/proactive/presence-greeting-prompt', defaultPresenceGreetingPrompt)
const assistanceReminderEnabled = useLocalStorageManualReset('kiosk/proactive/assistance-reminder-enabled', defaultKioskAssistanceReminderSettings.enabled)
const assistanceReminderWaitMs = useLocalStorageManualReset('kiosk/proactive/assistance-reminder-wait-ms', defaultKioskAssistanceReminderSettings.waitMs)
const assistanceReminderMax = useLocalStorageManualReset('kiosk/proactive/assistance-reminder-max', defaultKioskAssistanceReminderSettings.maxRemindersPerSession)
const assistanceReminderText = useLocalStorageManualReset('kiosk/proactive/assistance-reminder-text', defaultKioskAssistanceReminderSettings.reminderText)
const simulatorPeople = shallowRef(1)
const simulatorPresencePeople = shallowRef(1)
const simulatorAttendingPeople = shallowRef(1)
const simulatorNowMs = shallowRef(0)
const simulator = shallowRef<ReturnType<KioskProactiveModule['createInteractionWindow']>>()
const latestDecision = shallowRef('尚未收到觀測資料')

const configuration = computed(() => ({
  enabled: enabled.value,
  dwellMs: sanitizeDuration(dwellMs.value, 2500),
  emptyResetMs: sanitizeDuration(emptyResetMs.value, 1500),
  minAttendingPeople: 1,
  triggerMode: triggerMode.value,
  attentionGreetingPrompt: attentionGreetingPrompt.value,
  presenceGreetingPrompt: presenceGreetingPrompt.value,
}))

const triggerModeOptions = [
  {
    label: '看向 kiosk',
    value: 'attention' as const,
    icon: 'i-solar:eye-bold-duotone',
  },
  {
    label: '經過偵測區',
    value: 'presence' as const,
    icon: 'i-solar:walk-round-bold-duotone',
  },
  {
    label: '混合式',
    value: 'mixed' as const,
    icon: 'i-solar:shuffle-bold-duotone',
  },
]

const simulatorPeopleLabel = computed(() => triggerMode.value === 'attention'
  ? '正在看向 kiosk 的人數'
  : '正在經過偵測區的人數')
const dwellLabel = computed(() => triggerMode.value === 'presence'
  ? '經過偵測區的停留時間（毫秒）'
  : triggerMode.value === 'mixed'
    ? '每種訊號各自的停留時間（毫秒）'
    : '注視停留時間（毫秒）')

watch([enabled, dwellMs, emptyResetMs, triggerMode], () => resetSimulator())

async function install() {
  loading.value = true
  loadError.value = ''
  try {
    proactiveModule.value = await loadKioskProactiveModule()
    installed.value = true
    resetSimulator()
  }
  catch (error) {
    loadError.value = errorMessageFrom(error) ?? '無法載入主動互動模組。'
  }
  finally {
    loading.value = false
  }
}

onMounted(() => void install())

function resetSimulator() {
  if (!proactiveModule.value)
    return

  simulator.value = proactiveModule.value.createInteractionWindow(configuration.value)
  simulatorNowMs.value = 0
  latestDecision.value = '模擬器已重設，等待第一筆觀測資料。'
}

function simulateObservation() {
  if (!simulator.value)
    return

  simulatorNowMs.value += 500
  const observationPeople = simulatedObservationPeople()
  const decision = simulator.value.decide({
    observedAtMs: simulatorNowMs.value,
    ...observationPeople,
  })
  latestDecision.value = decision.shouldGreet
    ? `第 ${simulatorNowMs.value} ms：應主動招呼（${decision.triggeringPeople} 人）`
    : `第 ${simulatorNowMs.value} ms：${decision.reason}`
}

function normalizedPeople(value: number) {
  return Math.max(0, Math.trunc(value))
}

function simulatedObservationPeople() {
  if (triggerMode.value === 'attention') {
    const attendingPeople = normalizedPeople(simulatorPeople.value)
    return { attendingPeople, presencePeople: attendingPeople }
  }

  if (triggerMode.value === 'presence')
    return { attendingPeople: 0, presencePeople: normalizedPeople(simulatorPeople.value) }

  const presencePeople = normalizedPeople(simulatorPresencePeople.value)
  return {
    attendingPeople: Math.min(normalizedPeople(simulatorAttendingPeople.value), presencePeople),
    presencePeople,
  }
}

function sanitizeDuration(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || value === undefined)
    return fallback

  return Math.max(0, Math.trunc(value))
}
</script>

<template>
  <div :class="['flex flex-col gap-5', 'pb-12']">
    <section :class="['rounded-2xl p-5', 'bg-neutral-100 dark:bg-neutral-900/60']">
      <div :class="['flex flex-wrap items-center justify-between gap-4']">
        <div>
          <h2 :class="['m-0 text-lg font-semibold']">
            主動互動
          </h2>
          <p :class="['mb-0 mt-2 text-sm text-neutral-600 dark:text-neutral-300']">
            設定會自動儲存在此瀏覽器。啟用主動互動時會要求相機權限來顯示本機 webcam 預覽；開始偵測後才會載入 MediaPipe。
          </p>
        </div>
        <span v-if="loading" :class="['text-sm text-neutral-600 dark:text-neutral-300']">正在準備測試台…</span>
        <span v-else-if="installed" :class="['text-sm text-green-600 dark:text-green-400']">已載入，設定會自動儲存</span>
        <Button v-else variant="secondary" @click="install">
          重新載入測試台
        </Button>
      </div>
      <p v-if="loadError" :class="['mb-0 mt-3 text-sm text-red-600 dark:text-red-400']">
        {{ loadError }}
      </p>
    </section>

    <template v-if="installed">
      <section :class="['flex items-center justify-between gap-4', 'rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800']">
        <div>
          <h3 :class="['m-0 text-base font-semibold']">
            啟用主動互動
          </h3>
          <p :class="['mb-0 mt-1 text-sm text-neutral-600 dark:text-neutral-300']">
            {{ enabled ? '已啟用：偵測到符合條件的訪客時可發出招呼。' : '已關閉：不會開始新的主動招呼。' }}
          </p>
        </div>
        <Checkbox v-model="enabled" aria-label="啟用主動互動" />
      </section>

      <section :class="['flex flex-col gap-3', 'rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800']">
        <div>
          <h3 :class="['m-0 text-base font-semibold']">
            觸發條件
          </h3>
          <p :class="['mb-0 mt-1 text-sm text-neutral-600 dark:text-neutral-300']">
            可選擇看向 kiosk、經過偵測區，或混合式；設定內容會作為 LLM 的場域參考提示，同時符合時會一併提供。
          </p>
        </div>
        <SelectTab v-model="triggerMode" :options="triggerModeOptions" :disabled="!enabled" size="sm" />
      </section>

      <section :class="['grid gap-4 sm:grid-cols-2']">
        <label :class="['flex flex-col gap-2 text-sm font-medium']">
          {{ dwellLabel }}
          <Input v-model="dwellMs" type="number" :disabled="!enabled" />
        </label>
        <label :class="['flex flex-col gap-2 text-sm font-medium']">
          區域清空重設時間（毫秒）
          <Input v-model="emptyResetMs" type="number" :disabled="!enabled" />
        </label>
      </section>

      <KioskProactiveGreetingPrompts
        v-if="triggerMode === 'mixed'"
        v-model:attention-prompt="attentionGreetingPrompt"
        v-model:presence-prompt="presenceGreetingPrompt"
        :disabled="!enabled"
      />

      <section :class="['rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800']">
        <div :class="['flex flex-wrap items-center justify-between gap-3']">
          <div>
            <h3 :class="['m-0 text-base font-semibold']">
              決策模擬
            </h3>
            <p :class="['mb-0 mt-1 text-sm text-neutral-600 dark:text-neutral-300']">
              用來驗證停留與「一個互動視窗只招呼一次」的規則，不會開啟攝影機。
            </p>
          </div>
          <Button variant="secondary" @click="resetSimulator">
            重設
          </Button>
        </div>
        <div :class="['mt-4 flex flex-wrap items-end gap-3']">
          <label v-if="triggerMode !== 'mixed'" :class="['flex flex-col gap-2 text-sm font-medium']">
            {{ simulatorPeopleLabel }}
            <Input v-model="simulatorPeople" type="number" />
          </label>
          <template v-else>
            <label :class="['flex flex-col gap-2 text-sm font-medium']">
              偵測區內人數
              <Input v-model="simulatorPresencePeople" type="number" />
            </label>
            <label :class="['flex flex-col gap-2 text-sm font-medium']">
              看向 kiosk 人數
              <Input v-model="simulatorAttendingPeople" type="number" />
            </label>
          </template>
          <Button :disabled="!enabled" @click="simulateObservation">
            送入 500 ms 觀測
          </Button>
        </div>
        <p :class="['mb-0 mt-4 text-sm text-neutral-600 dark:text-neutral-300']">
          {{ latestDecision }}
        </p>
      </section>

      <KioskProactiveCameraTest :settings="configuration" />

      <KioskAssistanceReminderSettings
        v-model:enabled="assistanceReminderEnabled"
        v-model:max-reminders-per-session="assistanceReminderMax"
        v-model:reminder-text="assistanceReminderText"
        v-model:wait-ms="assistanceReminderWaitMs"
      />
    </template>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: 主動互動
  subtitle: 系統設定
  description: 安裝與設定 kiosk 主動互動 POC 模組
  icon: i-solar:eye-bold-duotone
  settingsEntry: true
  order: 3
  stageTransition:
    name: slide
</route>
