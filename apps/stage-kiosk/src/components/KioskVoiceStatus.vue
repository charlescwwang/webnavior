<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const props = defineProps<{ state: 'thinking' | 'ready' | 'text-ready' | 'unavailable', speaking?: boolean }>()
const { t } = useI18n()
</script>

<template>
  <div :class="['voice-status', `is-${props.state}`, { 'is-speaking': props.speaking }]" role="status">
    <span :class="['sr-only']">{{ t(`stage.kiosk.voice-status.${props.state}`) }}</span>
    <span class="status-badge" aria-hidden="true">
      <span v-if="props.state === 'thinking'" class="spinner" />
      <span v-else :class="['i-solar:microphone-3-outline size-8']" />
    </span>
  </div>
</template>

<style scoped>
.voice-status {
  --status-color: #078344;
  position: absolute;
  z-index: 13;
  inset: 0;
  border: var(--activity-glow-frame-width, 5px) solid #2b7773;
  border-radius: 1rem;
  pointer-events: none;
}

.voice-status.is-thinking {
  --status-color: #8a5500;
  border-color: #ffcb61;
  box-shadow: inset 0 0 16px rgb(255 203 97 / 32%);
}

.voice-status.is-speaking {
  border-color: transparent;
}

.voice-status.is-unavailable {
  --status-color: #46524d;
}

.is-unavailable .status-badge::after {
  position: absolute;
  width: 1.65rem;
  height: 2px;
  background: currentColor;
  box-shadow: 0 -2px var(--status-color);
  transform: rotate(45deg);
  content: '';
}

.status-badge {
  position: absolute;
  right: .5rem;
  bottom: .5rem;
  display: grid;
  width: 3rem;
  height: 3rem;
  place-items: center;
  border-radius: 50%;
  color: white;
  background: var(--status-color);
}

/* Keep the badge inside the panel and clear of the restart action on short screens. */
@container (width < 13rem) or (height < 7rem) {
  .status-badge { top: .25rem; bottom: auto; }
}

.spinner {
  width: 1.5rem;
  height: 1.5rem;
  border: 3px solid rgb(255 255 255 / 35%);
  border-top-color: #ffe0a0;
  border-radius: 50%;
  animation: voice-status-spin .85s linear infinite;
}

@keyframes voice-status-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .spinner { animation: none; }
}
</style>
