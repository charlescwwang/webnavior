<script setup lang="ts">
interface Props {
  description: string
  icon: string
  label: string
  value: string | number
}

defineProps<Props>()
</script>

<template>
  <section :class="['rounded-xl border border-slate-200 bg-white p-5 shadow-sm', 'dark:border-slate-800 dark:bg-slate-900']">
    <div :class="['flex items-start justify-between gap-3']">
      <div>
        <p :class="['m-0 text-sm font-medium text-slate-500 dark:text-slate-400']">
          {{ label }}
        </p>
        <p :class="['mb-1 mt-2 text-3xl font-semibold text-slate-950 dark:text-white']">
          {{ value }}
        </p>
        <p :class="['m-0 text-xs text-slate-500 dark:text-slate-400']">
          {{ description }}
        </p>
      </div>
      <span :class="[icon, 'rounded-lg bg-cyan-50 p-2 text-xl text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300']" />
    </div>
  </section>
</template>
