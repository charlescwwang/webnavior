<script setup lang="ts">
defineProps<{
  message: string | undefined
}>()
</script>

<template>
  <Transition name="notice">
    <output v-if="message" class="session-notice" aria-live="polite">
      <span class="i-solar:hourglass-line-duotone h-5 w-5" />
      {{ message }}
    </output>
  </Transition>
</template>

<style scoped>
.session-notice { position: fixed; z-index: 12; top: 1.4rem; left: 50%; display: flex; max-width: min(34rem, calc(100vw - 2rem)); align-items: center; gap: .55rem; border: 1px solid rgb(255 225 152 / 42%); border-radius: 999px; padding: .7rem 1rem; color: #fff2cc; background: rgb(56 39 8 / 92%); box-shadow: 0 1rem 3rem rgb(0 0 0 / 32%); transform: translateX(-50%); }
.notice-enter-active, .notice-leave-active { transition: opacity .2s ease, transform .2s ease; }
.notice-enter-from, .notice-leave-to { opacity: 0; transform: translate(-50%, -0.55rem); }
</style>
