<script setup lang="ts">
import { Button, Checkbox, Input, Textarea } from '@proj-airi/ui'

import { feedbackInvitationSettings, resetFeedbackInvitationSettings } from '../../../services/feedback-invitation'

function updateDuration(value: string | number | undefined) {
  if (value === undefined)
    return

  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue))
    return

  feedbackInvitationSettings.value = {
    ...feedbackInvitationSettings.value,
    displayDurationSeconds: Math.min(300, Math.max(5, Math.trunc(numericValue))),
  }
}

function reset() {
  resetFeedbackInvitationSettings()
}
</script>

<template>
  <div :class="['flex flex-col gap-5', 'pb-12']">
    <section :class="['flex flex-col gap-4', 'rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800']">
      <div :class="['flex flex-wrap items-start justify-between gap-4']">
        <div>
          <h2 :class="['m-0 text-lg font-semibold']">
            完成後問卷邀請
          </h2>
          <p :class="['mb-0 mt-2 text-sm text-neutral-600 dark:text-neutral-300']">
            互動服務回報完成後，以此網址在瀏覽器本機產生 QR Code。此設定會與同 origin 的 Stage Kiosk 共用；第一版不將訂單、對話或顧客資料放入問卷網址。
          </p>
        </div>
        <Checkbox v-model="feedbackInvitationSettings.enabled" aria-label="啟用完成後問卷邀請" />
      </div>

      <template v-if="feedbackInvitationSettings.enabled">
        <label :class="['flex flex-col gap-2 text-sm font-medium']">
          問卷網址
          <Input v-model="feedbackInvitationSettings.surveyUrl" type="url" placeholder="https://example.com/survey" />
          <span :class="['text-xs font-normal text-neutral-500 dark:text-neutral-400']">僅接受 HTTP 或 HTTPS 的固定問卷網址。</span>
        </label>

        <div :class="['grid gap-4 sm:grid-cols-2']">
          <label :class="['flex flex-col gap-2 text-sm font-medium']">
            顯示秒數
            <Input :model-value="String(feedbackInvitationSettings.displayDurationSeconds)" type="number" min="5" max="300" @update:model-value="updateDuration($event)" />
            <span :class="['text-xs font-normal text-neutral-500 dark:text-neutral-400']">5 到 300 秒，預設 30 秒。</span>
          </label>
          <label :class="['flex flex-col gap-2 text-sm font-medium']">
            略過按鈕文字
            <Input v-model="feedbackInvitationSettings.dismissLabel" />
          </label>
        </div>

        <label :class="['flex flex-col gap-2 text-sm font-medium']">
          標題
          <Input v-model="feedbackInvitationSettings.title" />
        </label>
        <label :class="['flex flex-col gap-2 text-sm font-medium']">
          說明
          <Textarea v-model="feedbackInvitationSettings.description" :rows="3" />
        </label>
      </template>

      <div :class="['flex justify-end']">
        <Button variant="secondary" @click="reset">
          回復預設值
        </Button>
      </div>
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: 完成後問卷
  subtitle: 系統設定
  description: 設定互動完成後顯示的 QR Code 問卷邀請
  icon: i-solar:qr-code-bold-duotone
  settingsEntry: true
  order: 5
  stageTransition:
    name: slide
</route>
