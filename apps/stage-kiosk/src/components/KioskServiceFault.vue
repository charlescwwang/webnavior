<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

import KioskAdminAccess from './KioskAdminAccess.vue'

const props = defineProps<{ busy: boolean, error?: string }>()
const emit = defineEmits<{ restart: [], unlock: [] }>()
const { t } = useI18n()
</script>

<template>
  <section :class="['service-fault']" role="alertdialog" aria-modal="true" aria-labelledby="service-fault-title">
    <div :class="['fault-card']">
      <h2 id="service-fault-title">
        {{ t('stage.kiosk.service-fault.title') }}
      </h2>
      <p>{{ t('stage.kiosk.service-fault.spoken') }}</p>
      <p>{{ t('stage.kiosk.service-fault.description') }}</p>
      <p v-if="props.error" role="alert">
        {{ props.error }}
      </p>
      <KioskAdminAccess single-tap @unlocked="emit('unlock')">
        {{ t('stage.kiosk.service-fault.unlock') }}
      </KioskAdminAccess>
      <Button :disabled="props.busy" @click="emit('restart')">
        {{ t('stage.kiosk.service-fault.restart') }}
      </Button>
    </div>
  </section>
</template>

<style scoped>
.service-fault { position: fixed; z-index: 300; inset: 0; display: grid; place-items: center; padding: 1.5rem; background: rgb(2 12 14 / 90%); }
.fault-card { display: grid; width: min(30rem, 100%); gap: 1rem; padding: 2rem; border-radius: 1.5rem; color: #173032; background: #fffaf2; }
h2, p { margin: 0; line-height: 1.6; }
.fault-card :deep(button) { border-radius: .75rem; padding: .9rem; font-weight: 700; }
</style>
