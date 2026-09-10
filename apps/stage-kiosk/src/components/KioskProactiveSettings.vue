<script setup lang="ts">
import type { ProactiveInteractionSettings, ProactiveTriggerMode } from '@proj-airi/kiosk-proactive'

import type { KioskProactiveVisionStatus } from '../composables/useKioskProactiveVision'

import { Checkbox, FieldInput, FieldTextArea, SelectTab } from '@proj-airi/ui'
import { computed } from 'vue'

const props = defineProps<{
  status: KioskProactiveVisionStatus
  error?: string
}>()

const settings = defineModel<ProactiveInteractionSettings>({ required: true })

const triggerOptions = [
  { label: '看向 kiosk', value: 'attention' as const, icon: 'i-solar:eye-bold-duotone' },
  { label: '進入偵測區', value: 'presence' as const, icon: 'i-solar:walk-round-bold-duotone' },
  { label: '混合式', value: 'mixed' as const, icon: 'i-solar:shuffle-bold-duotone' },
]
const statusLabel = computed(() => ({
  idle: '尚未啟用本機相機。',
  starting: '正在開啟本機相機與模型…',
  observing: '正在本機觀測；畫面不會上傳或保存。',
  unsupported: '此瀏覽器不支援相機觀測。',
  failed: props.error ?? '無法啟動本機相機觀測。',
}[props.status]))

function updateTriggerMode(value: string | number) {
  if (value !== 'attention' && value !== 'presence' && value !== 'mixed')
    return
  settings.value = { ...settings.value, triggerMode: value satisfies ProactiveTriggerMode }
}

function updateDuration(key: 'dwellMs' | 'emptyResetMs', value: string | number | undefined) {
  if (value === undefined)
    return

  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue))
    return
  settings.value = { ...settings.value, [key]: Math.max(0, Math.trunc(numericValue)) }
}

function updateGreetingPrompt(key: 'attentionGreetingPrompt' | 'presenceGreetingPrompt', value: string | undefined) {
  if (value === undefined)
    return

  settings.value = { ...settings.value, [key]: value }
}
</script>

<template>
  <section class="admin-section">
    <div class="section-heading">
      <div>
        <h3>主動招呼</h3>
        <p>針對尚未開始接待的訪客主動開場；需同時啟用「現場觀測」。偵測影像不會傳送或保存。</p>
      </div>
      <Checkbox v-model="settings.enabled" aria-label="啟用主動招呼" />
    </div>

    <template v-if="settings.enabled">
      <SelectTab
        :model-value="settings.triggerMode"
        :options="triggerOptions"
        size="sm"
        @update:model-value="updateTriggerMode"
      />
      <div class="settings-grid">
        <FieldInput
          :model-value="String(settings.dwellMs)"
          label="停留時間（毫秒）"
          description="符合條件持續多久後才招呼。"
          type="number"
          @update:model-value="updateDuration('dwellMs', $event)"
        />
        <FieldInput
          :model-value="String(settings.emptyResetMs)"
          label="區域清空重設（毫秒）"
          description="清空後才允許下一次主動招呼。"
          type="number"
          @update:model-value="updateDuration('emptyResetMs', $event)"
        />
      </div>
      <div v-if="settings.triggerMode === 'mixed'" class="settings-grid">
        <FieldTextArea
          :model-value="settings.attentionGreetingPrompt"
          label="看向 kiosk 時的 LLM 參考提示"
          description="提供訪客正注視 kiosk 的場域線索；不會覆蓋服務員的共通招呼規則。"
          :rows="5"
          @update:model-value="updateGreetingPrompt('attentionGreetingPrompt', $event)"
        />
        <FieldTextArea
          :model-value="settings.presenceGreetingPrompt"
          label="經過偵測區時的 LLM 參考提示"
          description="提供訪客進入偵測區的場域線索；混合式同時符合時會與注視線索一併提供。"
          :rows="5"
          @update:model-value="updateGreetingPrompt('presenceGreetingPrompt', $event)"
        />
      </div>
    </template>

    <p class="vision-status" :class="{ 'is-error': props.status === 'failed' || props.status === 'unsupported' }">
      {{ statusLabel }}
    </p>
  </section>
</template>

<style scoped>
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.section-heading h3, .section-heading p { margin: 0; }
.section-heading p, .vision-status { color: rgb(217 250 246 / 70%); font-size: .84rem; line-height: 1.5; }
.section-heading p { margin-top: .35rem; }
.settings-grid { display: grid; gap: .8rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.vision-status { margin: 0; }
.vision-status.is-error { color: #ffc78d; }
@media (max-width: 520px) { .settings-grid { grid-template-columns: 1fr; } }
</style>
