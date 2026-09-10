<script setup lang="ts">
import { RouterLink } from 'vue-router'

defineProps<{
  description: string
  icon: string
  title: string
  to: string
}>()
</script>

<template>
  <section :class="['rounded-xl bg-slate-950 p-6 text-slate-100 shadow-sm dark:bg-cyan-950']">
    <span :class="[icon, 'rounded-lg bg-white/10 p-2 text-xl text-cyan-200']" />
    <h2 :class="['mb-0 mt-5 text-lg font-semibold text-white']">
      {{ title }}
    </h2>
    <p :class="['mb-5 mt-2 text-sm leading-6 text-slate-300']">
      {{ description }}
    </p>
    <RouterLink :to="to" :class="['inline-flex rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300']">
      前往處理
    </RouterLink>
  </section>
</template>
