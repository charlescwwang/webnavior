<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

defineProps<{
  state: 'pending' | 'blocked' | 'failed'
  message?: string
  restartDisabled: boolean
}>()
const emit = defineEmits<{ restart: [] }>()
const { t } = useI18n()
const titles = { pending: 'checking', blocked: 'preparation-title', failed: 'preparation-failed' } as const
</script>

<template>
  <section role="status" aria-live="polite" :class="['ordering-preparation absolute inset-0 z-10 flex items-center justify-center bg-[#fff8ee] p-6']">
    <div :class="['grid max-w-lg justify-items-center gap-5 text-center text-slate-800']">
      <span :class="['h-10 w-10', state === 'pending' ? 'i-solar:refresh-circle-line-duotone animate-spin' : 'i-solar:cart-large-minimalistic-line-duotone']" aria-hidden="true" />
      <h2 :class="['m-0 text-2xl font-semibold']">
        {{ t(`stage.kiosk.cart-handoff.${titles[state]}`) }}
      </h2>
      <template v-if="state !== 'pending'">
        <p :class="['m-0 text-lg leading-relaxed']">
          {{ message }}
        </p>
        <Button :disabled="restartDisabled" @click="emit('restart')">
          {{ t('stage.kiosk.restart-order') }}
        </Button>
      </template>
    </div>
  </section>
</template>
