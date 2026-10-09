<script setup lang="ts">
import { useNow } from '@vueuse/core'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  deadlineAt: number | undefined
}>()

const emit = defineEmits<{
  continue: []
  newCustomer: []
}>()

const { t } = useI18n()
const now = useNow({ interval: 1_000 })
const secondsRemaining = computed(() => {
  if (props.deadlineAt === undefined)
    return 0

  return Math.max(0, Math.ceil((props.deadlineAt - now.value.getTime()) / 1_000))
})
</script>

<template>
  <section class="idle-confirmation" role="dialog" aria-modal="true" :aria-label="t('stage.customer-session.idle-confirmation.title')">
    <div class="idle-confirmation-card">
      <div class="i-solar:hourglass-line-duotone h-9 w-9 text-amber-400" aria-hidden="true" />
      <div>
        <h2>{{ t('stage.customer-session.idle-confirmation.title') }}</h2>
        <p>{{ t('stage.customer-session.idle-confirmation.description') }}</p>
        <p v-if="props.deadlineAt !== undefined" class="countdown">
          {{ t('stage.customer-session.idle-confirmation.countdown', { seconds: secondsRemaining }) }}
        </p>
      </div>
      <div class="idle-confirmation-actions">
        <button type="button" class="secondary-action" @click="emit('newCustomer')">
          {{ t('stage.customer-session.idle-confirmation.new-customer') }}
        </button>
        <button type="button" class="primary-action" @click="emit('continue')">
          {{ t('stage.customer-session.idle-confirmation.continue') }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.idle-confirmation { position: fixed; z-index: 80; inset: 0; display: grid; place-items: center; padding: 1rem; background: rgb(0 0 0 / 48%); backdrop-filter: blur(4px); }
.idle-confirmation-card { display: grid; width: min(30rem, 100%); grid-template-columns: auto minmax(0, 1fr); gap: 1rem; border: 1px solid rgb(255 255 255 / 20%); border-radius: 1.25rem; padding: 1.25rem; color: #effffc; background: #102d31; box-shadow: 0 1.5rem 5rem rgb(0 0 0 / 45%); }
h2 { margin: 0; font-size: 1.2rem; }
p { margin: .45rem 0 0; color: rgb(225 255 250 / 76%); line-height: 1.5; }
.countdown { color: #ffd58e; font-size: .85rem; font-weight: 700; }
.idle-confirmation-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .65rem; }
.idle-confirmation-actions button { border-radius: .7rem; padding: .6rem .85rem; font-weight: 700; cursor: pointer; }
.secondary-action { border: 1px solid rgb(255 255 255 / 22%); color: #d9faf6; background: rgb(255 255 255 / 7%); }
.primary-action { border: 1px solid #83ead9; color: #08383b; background: #83ead9; }
</style>
