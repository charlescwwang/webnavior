<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

withDefaults(defineProps<{
  /** Whether the current conversation still has an active response. */
  active?: boolean
}>(), {
  active: false,
})

const { t } = useI18n()
const label = computed(() => t('stage.chat.status.responding'))
</script>

<template>
  <div
    v-if="active"
    role="status"
    aria-live="polite"
    :aria-label="label"
    :class="[
      'flex items-center gap-2 text-xs text-primary-600 dark:text-primary-300',
      'motion-reduce:transition-none',
    ]"
  >
    <span
      aria-hidden="true"
      :class="[
        'h-2 w-2 shrink-0 rounded-full bg-primary-500',
        'animate-pulse motion-reduce:animate-none',
      ]"
    />
    <span>{{ label }}</span>
  </div>
</template>
