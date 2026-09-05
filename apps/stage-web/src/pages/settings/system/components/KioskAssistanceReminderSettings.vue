<script setup lang="ts">
import { Checkbox, Input, Textarea } from '@proj-airi/ui'

const props = defineProps<{
  disabled?: boolean
}>()

const enabled = defineModel<boolean>('enabled', { required: true })
const waitMs = defineModel<number>('waitMs', { required: true })
const maxRemindersPerSession = defineModel<number>('maxRemindersPerSession', { required: true })
const reminderText = defineModel<string>('reminderText', { required: true })
</script>

<template>
  <section :class="['flex flex-col gap-4 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800']">
    <div :class="['flex items-center justify-between gap-4']">
      <div>
        <h3 :class="['m-0 text-base font-semibold']">
          無操作協助提醒
        </h3>
        <p :class="['mb-0 mt-1 text-sm text-neutral-600 dark:text-neutral-300']">
          使用者仍在偵測區、但沒有有效操作時，AIRI 會主動提供協助。操作後會重新計時。
        </p>
      </div>
      <Checkbox v-model="enabled" :disabled="props.disabled" aria-label="啟用無操作協助提醒" />
    </div>

    <template v-if="enabled">
      <div :class="['grid gap-4 sm:grid-cols-2']">
        <label :class="['flex flex-col gap-2 text-sm font-medium']">
          提醒等待時間（毫秒）
          <Input v-model="waitMs" type="number" :disabled="props.disabled" />
        </label>
        <label :class="['flex flex-col gap-2 text-sm font-medium']">
          單一接待最大提醒次數
          <Input v-model="maxRemindersPerSession" type="number" :disabled="props.disabled" />
        </label>
      </div>

      <label :class="['flex flex-col gap-2 text-sm font-medium']">
        LLM 場域參考提示
        <Textarea v-model="reminderText" :disabled="props.disabled" :rows="3" />
      </label>
      <p :class="['m-0 text-xs text-neutral-500 dark:text-neutral-400']">
        LLM 會依 AIRI 人設與目前對話脈絡決定是否提醒及如何表達；系統仍強制在場、等待與次數限制。
      </p>
    </template>
  </section>
</template>
