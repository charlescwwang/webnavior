<script setup lang="ts">
import type { KioskAudioStatusPosition } from '../composables/useKioskAudioStatusPosition'

import { computed, shallowRef } from 'vue'

const props = defineProps<{
  icon: string
  label: string
  mode: string
  position: KioskAudioStatusPosition
  title: string
}>()

const emit = defineEmits<{
  move: [position: KioskAudioStatusPosition]
}>()

const dragging = shallowRef(false)
const overlayStyle = computed(() => ({
  left: `${props.position.x}%`,
  top: `${props.position.y}%`,
}))

function move(event: PointerEvent) {
  const x = Math.round(Math.min(94, Math.max(6, event.clientX / window.innerWidth * 100)))
  const y = Math.round(Math.min(94, Math.max(6, event.clientY / window.innerHeight * 100)))
  emit('move', { x, y })
}

function beginMove(event: PointerEvent) {
  dragging.value = true
  if (event.currentTarget instanceof HTMLElement)
    event.currentTarget.setPointerCapture(event.pointerId)
  move(event)
}

function endMove(event: PointerEvent) {
  dragging.value = false
  if (event.currentTarget instanceof HTMLElement && event.currentTarget.hasPointerCapture(event.pointerId))
    event.currentTarget.releasePointerCapture(event.pointerId)
}
</script>

<template>
  <output
    :class="['audio-status-overlay', `is-${props.mode}`]"
    :style="overlayStyle"
    :aria-label="props.title"
    :title="props.title"
    role="status"
    aria-live="polite"
    @pointerdown="beginMove"
    @pointermove="dragging && move($event)"
    @pointerup="endMove"
    @pointercancel="endMove"
  >
    <span :class="[props.icon, 'status-icon']" aria-hidden="true" />
    <span class="status-label">{{ props.label }}</span>
  </output>
</template>

<style scoped>
.audio-status-overlay { position: fixed; z-index: 40; display: grid; min-width: 9.5rem; justify-items: center; gap: .7rem; padding: 1.1rem 1.4rem; color: #d9efeb; touch-action: none; user-select: none; cursor: grab; background: rgb(5 20 23 / 88%); border: 1px solid rgb(164 229 220 / 30%); border-radius: 1.35rem; box-shadow: 0 1rem 3rem rgb(0 0 0 / 34%), inset 0 1px rgb(255 255 255 / 8%); backdrop-filter: blur(14px); transform: translate(-50%, -50%); transition: color 180ms ease, border-color 180ms ease, background-color 180ms ease; }
.audio-status-overlay:active { cursor: grabbing; }
.status-icon { width: 3.6rem; height: 3.6rem; }
.status-label { font-size: 1.05rem; font-weight: 700; letter-spacing: .04em; }
.audio-status-overlay.is-listening, .audio-status-overlay.is-hearing-speech { color: #91e7d6; border-color: rgb(82 217 190 / 62%); background: rgb(9 51 50 / 88%); }
.audio-status-overlay.is-hearing-speech .status-icon { animation: audio-status-pulse 1.1s ease-in-out infinite; }
.audio-status-overlay.is-transcribing { color: #a8d8ff; border-color: rgb(116 187 255 / 62%); background: rgb(11 39 68 / 88%); }
.audio-status-overlay.is-processing { color: #e5c8ff; border-color: rgb(192 138 255 / 62%); background: rgb(49 26 75 / 88%); }
.audio-status-overlay.is-speaking { color: #ffe0a6; border-color: rgb(255 186 89 / 62%); background: rgb(70 45 14 / 88%); }
.audio-status-overlay.is-not-listening { color: #b8c6c4; border-color: rgb(184 198 196 / 28%); background: rgb(20 29 31 / 90%); }
@keyframes audio-status-pulse { 50% { transform: scale(1.12); } }
</style>
