<script setup lang="ts">
import { Button } from '@proj-airi/ui'

defineProps<{
  error?: string
  registering: boolean
}>()

const emit = defineEmits<{
  register: []
}>()
</script>

<template>
  <main :class="['grid min-h-screen place-items-center', 'bg-[#101719] p-6 text-[#f9f6f0]']">
    <section :class="['grid w-full max-w-md gap-5', 'rounded-3xl border border-white/15 bg-white/5 p-8 shadow-2xl']">
      <p :class="['m-0 text-xs font-bold tracking-[0.18em] text-teal-200 uppercase']">
        AIRI Kiosk POC
      </p>
      <div :class="['grid gap-2']">
        <h1 :class="['m-0 text-3xl font-semibold']">
          註冊測試 Kiosk
        </h1>
        <p :class="['m-0 leading-6 text-white/70']">
          此開發環境會產生一次數字註冊碼並由 Server 建立測試設備。正式環境將改用 QR Code。
        </p>
      </div>
      <p v-if="error" :class="['m-0 rounded-xl bg-amber-200/15 p-3 text-sm text-amber-100']" role="alert">
        {{ error }}
      </p>
      <Button
        :class="['rounded-xl bg-teal-200 px-5 py-3 font-semibold text-[#063437]', 'disabled:cursor-wait disabled:opacity-60']"
        :loading="registering"
        shape="rounded"
        @click="emit('register')"
      >
        {{ registering ? '正在註冊…' : '建立測試設備' }}
      </Button>
    </section>
  </main>
</template>
