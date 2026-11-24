<script setup lang="ts">
import type { KioskConversationProgress } from '../composables/useKioskConversationProgress'

import { toOrderingTraditionalChinese } from '@proj-airi/stage-ui/libs/taiwan-traditional-chinese'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useThoughtBubbleFontSize } from '../composables/useKioskConversationFontSize'

const props = defineProps<{
  progress?: Pick<KioskConversationProgress, 'phase' | 'message'>
  recognizing?: boolean
  voiceActivity?: string
}>()
const fontSize = useThoughtBubbleFontSize()
const { t } = useI18n()
// A follow-up can be transcribing while the preceding order is still executing.
const message = computed(() => props.progress?.message ?? (props.recognizing ? t('stage.kiosk.voice-received') : props.voiceActivity))
</script>

<template>
  <Transition name="thought-bubble" mode="out-in">
    <aside
      v-if="message"
      :key="props.progress?.phase ?? 'understanding'"
      class="assistant-thought-bubble"
      :style="{ fontSize: `${fontSize}px` }"
      role="status"
      aria-live="polite"
    >
      <span class="assistant-thought-bubble-text">{{ toOrderingTraditionalChinese(message) }}</span>
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
  width: min(14em, 60%);
  min-height: 3.45rem;
  align-items: center;
  border: 1px solid rgb(235 255 250 / 72%);
  border-radius: 2rem 2.55rem 2.15rem 2.7rem / 2.15rem 2rem 2.45rem 2.2rem;
  padding: .72rem 1.05rem;
  color: #173236;
  background: rgb(244 255 251 / 92%);
  box-shadow: 0 .7rem 1.7rem rgb(0 0 0 / 24%);
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

.assistant-thought-bubble-text { display: block; min-width: 0; overflow-wrap: anywhere; }

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
    width: min(14em, 68%);
    min-height: 3rem;
    padding: .65rem .85rem;
  }
}
</style>
