<script setup lang="ts">
import { useWebnaviorNotice } from '../../composables/useWebnaviorNotice'

const { dismiss, notices } = useWebnaviorNotice()
</script>

<template>
  <div :class="['pointer-events-none fixed right-5 top-5 z-200 flex w-[min(24rem,calc(100vw-2.5rem))] flex-col gap-3']" aria-live="polite">
    <section v-for="notice in notices" :key="notice.id" :role="notice.tone === 'error' ? 'alert' : 'status'" :class="['pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-xl', notice.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-50' : 'border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-50']">
      <span :class="[notice.tone === 'success' ? 'i-solar:check-circle-bold-duotone text-2xl' : 'i-solar:danger-triangle-bold-duotone text-2xl']" />
      <p :class="['m-0 flex-1 text-sm font-medium leading-5']">
        {{ notice.message }}
      </p>
      <button type="button" :class="['rounded p-1 text-current opacity-70 hover:opacity-100']" aria-label="關閉通知" @click="dismiss(notice.id)">
        <span class="i-solar:close-circle-bold text-lg" />
      </button>
    </section>
  </div>
</template>
