<script setup lang="ts">
import type { KioskProactiveModule } from '../../../modules/kiosk-proactive/catalog'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { CheckBar } from '@proj-airi/stage-ui/components'
import { Button, Input } from '@proj-airi/ui'
import { computed, ref } from 'vue'

import { loadKioskProactiveModule } from '../../../modules/kiosk-proactive/catalog'

const installed = ref(false)
const loading = ref(false)
const proactiveModule = ref<KioskProactiveModule>()
const enabled = useLocalStorageManualReset('kiosk/proactive/enabled', false)
const dwellMs = useLocalStorageManualReset('kiosk/proactive/dwell-ms', 2500)
const emptyResetMs = useLocalStorageManualReset('kiosk/proactive/empty-reset-ms', 1500)
const simulatorPeople = ref(1)
const simulatorNowMs = ref(0)
const simulator = ref<ReturnType<KioskProactiveModule['createInteractionWindow']>>()
const latestDecision = ref('尚未收到觀測資料')

const configuration = computed(() => ({
  enabled: enabled.value,
  dwellMs: sanitizeDuration(dwellMs.value, 2500),
  emptyResetMs: sanitizeDuration(emptyResetMs.value, 1500),
  minAttendingPeople: 1,
}))

async function install() {
  loading.value = true
  try {
    proactiveModule.value = await loadKioskProactiveModule()
    installed.value = true
    resetSimulator()
  }
  finally {
    loading.value = false
  }
}

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
  const decision = simulator.value.decide({
    observedAtMs: simulatorNowMs.value,
    attendingPeople: Math.max(0, Math.trunc(simulatorPeople.value)),
  })
  latestDecision.value = decision.shouldGreet
    ? `第 ${simulatorNowMs.value} ms：應主動招呼（${decision.attendingPeople} 人）`
    : `第 ${simulatorNowMs.value} ms：${decision.reason}`
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
            以本機相機觀測結果建立匿名互動視窗；目前不會載入相機或 MediaPipe。
          </p>
        </div>
        <Button v-if="!installed" :loading="loading" @click="install">
          載入 POC 模組
        </Button>
        <span v-else :class="['text-sm text-green-600 dark:text-green-400']">已載入</span>
      </div>
    </section>

    <template v-if="installed">
      <CheckBar
        v-model="enabled"
        icon-on="i-solar:eye-bold-duotone"
        icon-off="i-solar:eye-closed-bold-duotone"
        text="啟用主動互動"
        description="關閉時，系統會清空進行中的互動視窗，且不會發出新的主動招呼。"
      />

      <section :class="['grid gap-4 sm:grid-cols-2']">
        <label :class="['flex flex-col gap-2 text-sm font-medium']">
          注視停留時間（毫秒）
          <Input v-model="dwellMs" type="number" :disabled="!enabled" />
        </label>
        <label :class="['flex flex-col gap-2 text-sm font-medium']">
          區域清空重設時間（毫秒）
          <Input v-model="emptyResetMs" type="number" :disabled="!enabled" />
        </label>
      </section>

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
          <label :class="['flex flex-col gap-2 text-sm font-medium']">
            正在注視 kiosk 的人數
            <Input v-model="simulatorPeople" type="number" />
          </label>
          <Button :disabled="!enabled" @click="simulateObservation">
            送入 500 ms 觀測
          </Button>
        </div>
        <p :class="['mb-0 mt-4 text-sm text-neutral-600 dark:text-neutral-300']">
          {{ latestDecision }}
        </p>
      </section>
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
  stageTransition:
    name: slide
</route>
