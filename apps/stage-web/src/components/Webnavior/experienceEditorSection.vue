<script setup lang="ts">
withDefaults(defineProps<{
  description?: string
  initiallyOpen?: boolean
  title: string
}>(), {
  description: undefined,
  initiallyOpen: false,
})

defineSlots<{
  default: () => unknown
}>()
</script>

<template>
  <details :open="initiallyOpen" :class="['group rounded-xl border border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/30']">
    <summary :class="['flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 text-slate-950 marker:hidden dark:text-white']">
      <div>
        <h3 :class="['m-0 text-sm font-semibold']">
          {{ title }}
        </h3>
        <p v-if="description" :class="['mb-0 mt-1 text-sm font-normal text-slate-500 dark:text-slate-400']">
          {{ description }}
        </p>
      </div>
      <span :class="['i-solar:alt-arrow-down-bold text-lg text-slate-500 transition-transform group-open:rotate-180 dark:text-slate-400']" />
    </summary>
    <div v-if="$slots.default" :class="['flex flex-col gap-4 border-t border-slate-200 px-4 py-5 dark:border-slate-800']">
      <slot />
    </div>
  </details>
</template>
