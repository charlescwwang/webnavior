<script setup lang="ts">
import type { KioskObservationSettings as KioskObservationSettingsValue } from '../composables/useKioskProactiveSettings'

import { Checkbox } from '@proj-airi/ui'

const settings = defineModel<KioskObservationSettingsValue>({ required: true })
</script>

<template>
  <section class="admin-section">
    <div class="section-heading">
      <div>
        <h3>現場觀測</h3>
        <p>僅使用本機的 MediaPipe 判斷偵測區內是否有人與是否面向 kiosk；不保存或傳送影像。互動服務無法取得相機、麥克風、螢幕擷取或本機影像。</p>
      </div>
      <Checkbox v-model="settings.enabled" aria-label="啟用現場觀測" />
    </div>
  </section>
</template>

<style scoped>
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.section-heading h3, .section-heading p { margin: 0; }
.section-heading p { margin-top: .35rem; color: rgb(217 250 246 / 70%); font-size: .84rem; line-height: 1.5; }
</style>
