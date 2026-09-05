<script setup lang="ts">
import type { KioskInteractiveService } from '../composables/useKioskInteractiveServices'
import type { KioskProactiveSettings as KioskProactiveSettingsValue } from '../composables/useKioskProactiveSettings'
import type { KioskProactiveVisionStatus } from '../composables/useKioskProactiveVision'

import KioskAssistanceReminderSettings from './KioskAssistanceReminderSettings.vue'
import KioskInteractiveServicesSettings from './KioskInteractiveServicesSettings.vue'
import KioskProactiveSettings from './KioskProactiveSettings.vue'

const props = defineProps<{
  sessionEnding: boolean
  proactiveStatus: KioskProactiveVisionStatus
  proactiveError?: string
}>()

const emit = defineEmits<{
  close: []
  endSession: []
}>()

const paused = defineModel<boolean>('paused', { required: true })
const proactiveSettings = defineModel<KioskProactiveSettingsValue>('proactiveSettings', { required: true })
const interactiveServices = defineModel<KioskInteractiveService[]>('interactiveServices', { required: true })
const interactiveServiceAgentInstructions = defineModel<string>('interactiveServiceAgentInstructions', { required: true })
</script>

<template>
  <section class="admin-panel" aria-label="Kiosk 管理員設定">
    <header class="admin-header">
      <div>
        <span class="admin-kicker">管理員模式</span>
        <h2 class="admin-title">
          Kiosk 現場設定
        </h2>
      </div>
      <button type="button" class="close-button" aria-label="關閉管理員模式" @click="emit('close')">
        <div class="i-solar:close-circle-outline h-6 w-6" />
      </button>
    </header>

    <div class="admin-content">
      <KioskProactiveSettings
        v-model="proactiveSettings"
        :status="props.proactiveStatus"
        :error="props.proactiveError"
      />

      <KioskAssistanceReminderSettings v-model="proactiveSettings" />

      <KioskInteractiveServicesSettings
        v-model="interactiveServices"
        v-model:agent-instructions="interactiveServiceAgentInstructions"
      />

      <section class="admin-section">
        <h3>舞台</h3>
        <label class="toggle-row">
          <input v-model="paused" type="checkbox">
          <span>暫停虛擬人物動畫</span>
        </label>
      </section>

      <section class="admin-section">
        <h3>顧客接待</h3>
        <p class="session-description">
          清除目前匿名顧客的對話與購物車，回到等待下一位顧客的畫面。
        </p>
        <button type="button" class="end-session-button" :disabled="props.sessionEnding" @click="emit('endSession')">
          {{ props.sessionEnding ? '正在結束目前接待…' : '結束目前接待' }}
        </button>
      </section>

      <p class="admin-note">
        對話模型與語音輸入請在一般設定中調整；此頁只保留 Kiosk 現場行為與互動服務設定。
      </p>
    </div>
  </section>
</template>

<style scoped>
.admin-panel { position: fixed; z-index: 30; top: 50%; left: 50%; display: grid; width: min(42rem, calc(100vw - 2rem)); max-height: min(48rem, calc(100dvh - 2rem)); overflow: hidden; border: 1px solid rgb(255 255 255 / 18%); border-radius: 1.5rem; color: #ecfffb; background: #0d2225; box-shadow: 0 2rem 7rem rgb(0 0 0 / 52%); transform: translate(-50%, -50%); grid-template-rows: auto minmax(0, 1fr); }
.admin-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgb(255 255 255 / 12%); padding: 1rem 1.2rem; }
.admin-kicker { color: #8bd9cb; font-size: .72rem; font-weight: 800; letter-spacing: .08em; }
.admin-title { margin: .15rem 0 0; font-size: 1.2rem; }
.close-button { display: grid; place-items: center; border: 0; border-radius: .75rem; padding: .35rem; color: #d9faf6; background: transparent; cursor: pointer; }
.close-button:hover { background: rgb(255 255 255 / 10%); }
.admin-content { display: grid; gap: 1rem; overflow-y: auto; padding: 1.2rem; }
.admin-section { display: grid; gap: .8rem; border: 1px solid rgb(255 255 255 / 12%); border-radius: 1rem; padding: 1rem; background: rgb(255 255 255 / 4%); }
.admin-section h3 { margin: 0; font-size: .95rem; }
.toggle-row { display: flex; align-items: center; gap: .7rem; cursor: pointer; }
.session-description { margin: -.25rem 0 0; color: rgb(217 250 246 / 70%); font-size: .84rem; line-height: 1.5; }
.end-session-button { justify-self: start; border: 1px solid rgb(255 191 125 / 46%); border-radius: .7rem; padding: .6rem .85rem; color: #ffe0b5; background: rgb(117 58 26 / 36%); cursor: pointer; }
.end-session-button:disabled { cursor: wait; opacity: .65; }
.toggle-row input { width: 1.1rem; height: 1.1rem; accent-color: #78e1d1; }
.admin-note { margin: 0; color: rgb(217 250 246 / 70%); font-size: .8rem; line-height: 1.5; }
</style>
