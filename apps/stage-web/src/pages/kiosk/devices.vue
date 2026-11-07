<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import KioskDeviceManager from '../../components/Webnavior/kioskDeviceManager.vue'

const { t } = useI18n()
</script>

<template>
  <div :class="['flex flex-col gap-6']">
    <section>
      <p :class="['mb-2 mt-0 text-sm font-semibold tracking-wide text-cyan-700 dark:text-cyan-300']">
        KIOSK
      </p>
      <h1 :class="['m-0 text-3xl font-bold tracking-tight text-slate-950 dark:text-white']">
        {{ t('stage.kiosk-devices.title') }}
      </h1>
      <p :class="['mb-0 mt-2 text-sm text-slate-600 dark:text-slate-300']">
        {{ t('stage.kiosk-devices.description') }}
      </p>
    </section>
    <KioskDeviceManager />
  </div>
</template>

<route lang="yaml">
path: /admin/kiosk/devices
meta:
  layout: webnavior-admin
  title: Kiosk 設備
</route>
