<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  toolName: string
  state?: 'executing' | 'done' | 'error'
}>()
const { t } = useI18n()

const label = computed(() => {
  if (props.state === 'error')
    return t('stage.chat.tool-activity.failed')

  return props.state === 'done' ? t('stage.chat.tool-activity.step-complete') : t('stage.chat.tool-activity.processing-step')
})

const iconClass = computed(() => {
  if (props.state === 'error')
    return 'i-solar:danger-circle-bold-duotone text-amber-500'

  if (props.state === 'done')
    return 'i-solar:check-circle-bold-duotone text-emerald-500'

  return 'i-eos-icons:loading text-primary-500'
})
</script>

<template>
  <div class="order-tool-status" role="status">
    <div :class="[iconClass, 'h-4 w-4 flex-none']" />
    <span>{{ label }}</span>
  </div>
</template>

<style scoped>
.order-tool-status { display: flex; min-width: 0; align-items: center; gap: .4rem; color: #236d65; font-size: .8rem; font-weight: 700; overflow-wrap: anywhere; }
</style>
