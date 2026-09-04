<script setup lang="ts">
import { Textarea } from '@proj-airi/ui'

const props = defineProps<{
  disabled?: boolean
}>()

const attentionPrompt = defineModel<string>('attentionPrompt', { required: true })
const presencePrompt = defineModel<string>('presencePrompt', { required: true })
</script>

<template>
  <section :class="['flex flex-col gap-4 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800']">
    <div>
      <h3 :class="['m-0 text-base font-semibold']">
        混合式招呼 Prompt
      </h3>
      <p :class="['mb-0 mt-1 text-sm text-neutral-600 dark:text-neutral-300']">
        注視 kiosk 與僅經過偵測區會使用不同 Prompt；同一組訪客在區域清空前仍只會收到一次招呼。
      </p>
    </div>

    <label :class="['flex flex-col gap-2 text-sm font-medium']">
      看向 kiosk 時的 Prompt
      <Textarea v-model="attentionPrompt" :disabled="props.disabled" :rows="5" />
    </label>

    <label :class="['flex flex-col gap-2 text-sm font-medium']">
      經過偵測區時的 Prompt
      <Textarea v-model="presencePrompt" :disabled="props.disabled" :rows="5" />
    </label>
  </section>
</template>
