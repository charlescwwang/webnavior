<script setup lang="ts">
defineProps<{ active: boolean, mode: 'speaking' | 'listening' | 'operating' }>()
</script>

<template>
  <span
    aria-hidden="true"
    :class="['activity-glow', `is-${mode}`, { 'is-active': active }]"
  />
</template>

<style scoped>
.activity-glow { position: absolute; inset: 0; z-index: 12; border-radius: inherit; pointer-events: none; opacity: 0; transition: opacity .25s ease; --glow-colors: #58e8d5, #84a5ff, #d990ff, #fff2e8, #58e8d5; }
.activity-glow.is-speaking { --glow-colors: #66d9ff, #9a85ff, #f18bcc, #ffc297, #66d9ff; }
.activity-glow.is-operating { --glow-colors: #6acfff, #8e9aff, #f3b66f, #e8dcff, #6acfff; }
.activity-glow::before, .activity-glow::after { position: absolute; inset: 0; border-radius: inherit; content: ''; pointer-events: none; background: linear-gradient(115deg, var(--glow-colors)); background-size: 300% 300%; padding: var(--activity-glow-frame-width, 5px); mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); mask-composite: exclude; }
.activity-glow::after { padding: 9px; filter: blur(6px); }
.activity-glow.is-active { opacity: 1; }
.activity-glow.is-speaking.is-active { box-sizing: border-box; border: var(--activity-glow-outline-width, 4px) solid rgb(194 171 255 / 90%); box-shadow: inset 0 0 22px 5px rgb(114 192 255 / 48%); }
.activity-glow.is-active::before, .activity-glow.is-active::after { animation: glow-flow 3.6s ease-in-out infinite alternate, glow-breathe 1.8s ease-in-out infinite alternate; }
@keyframes glow-flow { from { background-position: 0% 50%; } to { background-position: 100% 50%; } }
@keyframes glow-breathe { from { opacity: .55; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .activity-glow { transition: none; }
  .activity-glow.is-active::before, .activity-glow.is-active::after { animation: none; opacity: .9; }
}
</style>
