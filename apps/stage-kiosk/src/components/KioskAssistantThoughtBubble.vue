<script setup lang="ts">
import type { KioskConversationProgress } from '../composables/useKioskConversationProgress'

const props = defineProps<{ progress?: KioskConversationProgress }>()
</script>

<template>
  <Transition name="thought-bubble" mode="out-in">
    <aside
      v-if="props.progress"
      :key="props.progress.phase"
      class="assistant-thought-bubble"
      role="status"
      aria-live="polite"
    >
      <span class="assistant-thought-bubble-text">{{ props.progress.message }}</span>
    </aside>
  </Transition>
</template>

<style scoped>
.assistant-thought-bubble {
  position: absolute;
  z-index: 15;
  box-sizing: border-box;
  top: clamp(.65rem, 5%, 1.5rem);
  left: clamp(8.5rem, 20%, 14rem);
  display: flex;
  width: clamp(12.75rem, 29vw, 19rem);
  min-height: 3.45rem;
  align-items: center;
  border: 1px solid rgb(235 255 250 / 72%);
  border-radius: 2rem 2.55rem 2.15rem 2.7rem / 2.15rem 2rem 2.45rem 2.2rem;
  padding: .72rem 1.05rem;
  color: #173236;
  background: rgb(244 255 251 / 92%);
  box-shadow: 0 .7rem 1.7rem rgb(0 0 0 / 24%);
  font-size: clamp(.82rem, 1.35vw, 1rem);
  font-weight: 800;
  line-height: 1.45;
  pointer-events: none;
}

.assistant-thought-bubble::before,
.assistant-thought-bubble::after {
  position: absolute;
  display: block;
  border: 1px solid rgb(235 255 250 / 72%);
  border-radius: 50%;
  content: '';
  background: rgb(244 255 251 / 92%);
}

.assistant-thought-bubble::before {
  bottom: -.9rem;
  left: 1.15rem;
  width: .7rem;
  height: .7rem;
}

.assistant-thought-bubble::after {
  bottom: -1.45rem;
  left: .5rem;
  width: .38rem;
  height: .38rem;
}

.assistant-thought-bubble-text { display: block; }

.thought-bubble-enter-active,
.thought-bubble-leave-active { transition: opacity .22s ease, transform .22s ease; }

.thought-bubble-enter-from,
.thought-bubble-leave-to { opacity: 0; transform: translate3d(-.4rem, .3rem, 0) scale(.96); }

@media (prefers-reduced-motion: reduce) {
  .thought-bubble-enter-active,
  .thought-bubble-leave-active { transition: opacity .01ms linear; }
}

@media (max-width: 700px) {
  .assistant-thought-bubble {
    top: .6rem;
    left: 24%;
    width: min(16rem, 68%);
    min-height: 3rem;
    padding: .65rem .85rem;
  }
}
</style>
