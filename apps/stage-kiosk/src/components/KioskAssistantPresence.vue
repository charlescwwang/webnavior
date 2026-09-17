<script setup lang="ts">
export type KioskAssistantPresenceMode = 'hearing-speech' | 'listening' | 'processing' | 'speaking' | 'transcribing'

const props = defineProps<{
  description: string
  mode: KioskAssistantPresenceMode
  title: string
}>()

const iconClassByMode: Record<KioskAssistantPresenceMode, string> = {
  'hearing-speech': 'i-solar:microphone-3-bold',
  'listening': 'i-solar:microphone-3-bold-duotone',
  'processing': 'i-solar:stars-bold-duotone',
  'speaking': 'i-solar:volume-loud-bold-duotone',
  'transcribing': 'i-solar:wave-square-bold-duotone',
}
</script>

<template>
  <section :class="['assistant-presence', `is-${props.mode}`]" role="status" aria-live="polite">
    <span :class="[iconClassByMode[props.mode], 'assistant-presence-icon']" aria-hidden="true" />
    <div>
      <h2 class="assistant-presence-title">
        {{ props.title }}
      </h2>
      <p class="assistant-presence-description">
        {{ props.description }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.assistant-presence { display: grid; min-height: 100%; place-content: center; gap: .7rem; padding: 1.5rem; color: #d7fffa; text-align: center; }.assistant-presence-icon { width: 3.2rem; height: 3.2rem; margin: 0 auto; color: #8aeee0; font-size: 3.2rem; filter: drop-shadow(0 0 1rem rgb(124 231 216 / 45%)); }.assistant-presence-title { margin: 0; font-size: clamp(1.15rem, 2.2vw, 1.65rem); }.assistant-presence-description { max-width: 26rem; margin: .4rem auto 0; color: #b6ded8; font-size: clamp(.85rem, 1.4vw, 1rem); line-height: 1.55; }.assistant-presence.is-processing .assistant-presence-icon, .assistant-presence.is-transcribing .assistant-presence-icon { animation: assistant-presence-pulse 1.3s ease-in-out infinite; }.assistant-presence.is-speaking .assistant-presence-icon { animation: assistant-presence-speak .75s ease-in-out infinite alternate; }@keyframes assistant-presence-pulse { 50% { transform: scale(.84); opacity: .55; } }@keyframes assistant-presence-speak { to { transform: scale(1.1); } }
</style>
