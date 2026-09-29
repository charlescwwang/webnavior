<script setup lang="ts">
const props = withDefaults(defineProps<{ label: string, count?: number }>(), { count: 3 })
</script>

<template>
  <section class="menu-presentation-skeleton" role="status" aria-live="polite" :aria-label="props.label">
    <p class="menu-presentation-skeleton-label">
      <span class="menu-presentation-skeleton-orb" aria-hidden="true" />
      {{ props.label }}
    </p>
    <div class="menu-presentation-skeleton-grid" aria-hidden="true">
      <article v-for="index in props.count" :key="index" class="menu-presentation-skeleton-card">
        <div class="menu-presentation-skeleton-image" />
        <div class="menu-presentation-skeleton-line is-title" />
        <div class="menu-presentation-skeleton-line" />
        <div class="menu-presentation-skeleton-line is-short" />
      </article>
    </div>
  </section>
</template>

<style scoped>
.menu-presentation-skeleton { display: grid; gap: .9rem; }
.menu-presentation-skeleton-label { display: flex; align-items: center; gap: .45rem; margin: 0; color: #85563d; font-size: .9rem; font-weight: 800; }
.menu-presentation-skeleton-orb { width: .55rem; height: .55rem; border-radius: 50%; background: #ef7244; box-shadow: 0 0 .7rem rgb(239 114 68 / 62%); animation: presentation-skeleton-pulse 1.1s ease-in-out infinite; }
.menu-presentation-skeleton-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.menu-presentation-skeleton-card { display: grid; gap: .72rem; overflow: hidden; border-radius: 20px; padding: .8rem; background: #fff; box-shadow: 0 12px 26px #7a3b1414; }
.menu-presentation-skeleton-image, .menu-presentation-skeleton-line { border-radius: .55rem; background: linear-gradient(90deg, #f1e7dc 20%, #fff7ef 45%, #f1e7dc 70%); background-size: 210% 100%; animation: presentation-skeleton-shimmer 1.3s linear infinite; }
.menu-presentation-skeleton-image { aspect-ratio: 4 / 3; }.menu-presentation-skeleton-line { width: 82%; height: .8rem; }.menu-presentation-skeleton-line.is-title { width: 54%; height: 1rem; }.menu-presentation-skeleton-line.is-short { width: 34%; }
@keyframes presentation-skeleton-pulse { 50% { opacity: .35; transform: scale(.76); } }
@keyframes presentation-skeleton-shimmer { to { background-position: -210% 0; } }
@media (prefers-reduced-motion: reduce) { .menu-presentation-skeleton-orb, .menu-presentation-skeleton-image, .menu-presentation-skeleton-line { animation: none; } }
@media (max-width: 700px) { .menu-presentation-skeleton-grid { gap: 12px; } }
</style>
