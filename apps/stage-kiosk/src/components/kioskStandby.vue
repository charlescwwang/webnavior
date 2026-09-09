<script setup lang="ts">
import type { KioskDevice, KioskProfile } from '../services/kiosk-device'

defineProps<{
  device: KioskDevice
  profile?: KioskProfile
}>()
</script>

<template>
  <main :class="['grid min-h-screen place-items-center', 'bg-[#101719] p-6 text-[#f9f6f0]']">
    <section :class="['grid w-full max-w-md gap-4', 'rounded-3xl border border-teal-100/20 bg-white/5 p-8 text-center shadow-2xl']">
      <p :class="['m-0 text-xs font-bold tracking-[0.18em] text-teal-200 uppercase']">
        測試設備已註冊
      </p>
      <h1 :class="['m-0 text-3xl font-semibold']">
        {{ device.label }}
      </h1>
      <p :class="['m-0 leading-6 text-white/70']">
        設備憑證已由瀏覽器 Cookie 驗證，並只會取得目前指派給它的發布版 Profile。
      </p>
      <div v-if="profile" :class="['grid gap-2 rounded-2xl bg-black/20 p-4 text-left', 'text-sm text-white/75']">
        <p :class="['m-0 font-semibold text-teal-100']">
          {{ profile.snapshot.characterName }} · {{ profile.name }}
        </p>
        <p :class="['m-0 leading-6']">
          {{ profile.snapshot.greetingPrompt }}
        </p>
        <p :class="['m-0 text-xs text-white/50']">
          服務：{{ profile.snapshot.interactiveService.title }}
        </p>
      </div>
      <p v-else :class="['m-0 text-sm text-amber-200']">
        此設備尚未指派 Profile。請由管理端發布一個版本。
      </p>
    </section>
  </main>
</template>
