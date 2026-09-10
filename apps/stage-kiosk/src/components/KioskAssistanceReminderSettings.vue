<script setup lang="ts">
import type { KioskAssistanceReminderSettings } from '@proj-airi/kiosk-proactive'

import { Checkbox, FieldInput, FieldTextArea } from '@proj-airi/ui'

const settings = defineModel<KioskAssistanceReminderSettings>({ required: true })

function updateDuration(value: string | number | undefined) {
  if (value === undefined)
    return

  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue))
    return
  settings.value = { ...settings.value, waitMs: Math.max(0, Math.trunc(numericValue)) }
}

function updateMaximum(value: string | number | undefined) {
  if (value === undefined)
    return

  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue))
    return
  settings.value = { ...settings.value, maxRemindersPerSession: Math.max(0, Math.trunc(numericValue)) }
}

function updateText(value: string | undefined) {
  if (value === undefined)
    return

  settings.value = { ...settings.value, reminderText: value }
}
</script>

<template>
  <section class="admin-section">
    <div class="section-heading">
      <div>
        <h3>無操作協助提醒</h3>
        <p>已開始接待的使用者仍在偵測區、但暫時沒有有效操作時，虛擬服務員會主動詢問是否需要協助；需同時啟用「現場觀測」。</p>
      </div>
      <Checkbox v-model="settings.enabled" aria-label="啟用無操作協助提醒" />
    </div>

    <template v-if="settings.enabled">
      <div class="settings-grid">
        <FieldInput
          :model-value="String(settings.waitMs)"
          label="提醒等待時間（毫秒）"
          description="從最後一次有效操作開始計時；預設為 20 秒。"
          type="number"
          @update:model-value="updateDuration($event)"
        />
        <FieldInput
          :model-value="String(settings.maxRemindersPerSession)"
          label="單一接待最大提醒次數"
          description="預設為 2 次；達到上限後不再主動提醒。"
          type="number"
          @update:model-value="updateMaximum($event)"
        />
      </div>
      <FieldTextArea
        :model-value="settings.reminderText"
        label="LLM 場域參考提示"
        description="提供無操作時的現場線索；服務員會依角色設定與對話脈絡決定是否提醒及如何表達。"
        :rows="3"
        @update:model-value="updateText($event)"
      />
    </template>
  </section>
</template>

<style scoped>
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.section-heading h3, .section-heading p { margin: 0; }
.section-heading p { margin-top: .35rem; color: rgb(217 250 246 / 70%); font-size: .84rem; line-height: 1.5; }
.settings-grid { display: grid; gap: .8rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 520px) { .settings-grid { grid-template-columns: 1fr; } }
</style>
