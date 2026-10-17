<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ releasing: boolean }>()
const emit = defineEmits<{ manual: [] }>()
const { t } = useI18n()
</script>

<template>
  <aside :class="['fixed bottom-20 left-4 right-4 z-30', 'flex items-center justify-between gap-4 rounded-xl p-4', 'bg-slate-900 text-white shadow-lg']" aria-live="polite">
    <span>{{ t(props.releasing ? 'stage.kiosk-agent.control-releasing' : 'stage.kiosk-agent.control-active') }}</span>
    <Button :disabled="props.releasing" @click="emit('manual')">
      {{ t('stage.kiosk-agent.control-manual') }}
    </Button>
  </aside>
</template>
