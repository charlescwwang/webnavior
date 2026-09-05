<script setup lang="ts">
import type { FeedbackInvitationSettings } from '@proj-airi/stage-ui/components'

import { Checkbox, FieldInput, FieldTextArea } from '@proj-airi/ui'

const settings = defineModel<FeedbackInvitationSettings>({ required: true })

function updateDuration(value: string | number | undefined) {
  if (value === undefined)
    return

  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue))
    return

  settings.value = { ...settings.value, displayDurationSeconds: Math.min(300, Math.max(5, Math.trunc(numericValue))) }
}

function updateText(key: 'surveyUrl' | 'title' | 'description' | 'dismissLabel', value: string | undefined) {
  if (value === undefined)
    return

  settings.value = { ...settings.value, [key]: value }
}
</script>

<template>
  <section class="admin-section">
    <div class="section-heading">
      <div>
        <h3>完成後問卷邀請</h3>
        <p>互動服務回報完成後，顯示由此網址在本機產生的 QR Code。第一版不傳送訂單、對話或顧客資料。</p>
      </div>
      <Checkbox v-model="settings.enabled" aria-label="啟用完成後問卷邀請" />
    </div>

    <template v-if="settings.enabled">
      <FieldInput
        :model-value="settings.surveyUrl"
        label="問卷網址"
        description="僅接受 HTTP 或 HTTPS 網址；請填入固定問卷連結。"
        type="url"
        placeholder="https://example.com/survey"
        @update:model-value="updateText('surveyUrl', $event)"
      />
      <div class="settings-grid">
        <FieldInput
          :model-value="String(settings.displayDurationSeconds)"
          label="顯示秒數"
          description="5 到 300 秒，預設 30 秒。"
          type="number"
          @update:model-value="updateDuration($event)"
        />
        <FieldInput
          :model-value="settings.dismissLabel"
          label="略過按鈕文字"
          description="顧客不填問卷時結束本輪接待的按鈕。"
          @update:model-value="updateText('dismissLabel', $event)"
        />
      </div>
      <FieldInput
        :model-value="settings.title"
        label="標題"
        description="顯示在 QR Code 上方的訊息。"
        @update:model-value="updateText('title', $event)"
      />
      <FieldTextArea
        :model-value="settings.description"
        label="說明"
        description="簡短說明邀請顧客掃碼填寫問卷的原因。"
        :rows="3"
        @update:model-value="updateText('description', $event)"
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
