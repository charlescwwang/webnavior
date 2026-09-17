<script setup lang="ts">
import type { PresenceDecision, PresenceVisionMode } from '@proj-airi/kiosk-proactive'

import { useDraggable } from '@vueuse/core'
import { computed, onMounted, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  decision?: PresenceDecision
  diagnostics: { cadenceTier: 'idle' | 'boost' | 'stable', faceActive: boolean, poseIntervalMs: number }
  stream?: MediaStream
  visionMode: PresenceVisionMode
  zone: { height: number, width: number, x: number, y: number }
}>()
const panel = useTemplateRef<HTMLElement>('panel')
const video = useTemplateRef<HTMLVideoElement>('video')
const { style } = useDraggable(panel, { initialValue: { x: 24, y: 84 }, preventDefault: true })

function synchronizeStream(stream = props.stream) {
  if (video.value)
    video.value.srcObject = stream ?? null
}

onMounted(synchronizeStream)
watch(() => props.stream, synchronizeStream)

const stateColor = computed(() => {
  switch (props.decision?.state) {
    case 'ENGAGED': return 'border-emerald-300 bg-emerald-400/40'
    case 'APPROACHING': return 'border-cyan-300 bg-cyan-400/40'
    case 'PASSING': return 'border-amber-300 bg-amber-400/40'
    default: return 'border-slate-300 bg-slate-400/40'
  }
})
</script>

<template>
  <aside ref="panel" :style="style" :class="['fixed z-90 w-64 overflow-hidden rounded-xl border border-white/30 bg-slate-950/90 shadow-xl']">
    <header :class="['cursor-move px-3 py-2 text-xs font-semibold text-white']">
      即時相機畫面
    </header>
    <div :class="['relative']">
      <video ref="video" autoplay muted playsinline :class="['block aspect-video w-full bg-black object-cover']" />
      <div :style="{ height: `${props.zone.height * 100}%`, left: `${props.zone.x * 100}%`, top: `${props.zone.y * 100}%`, width: `${props.zone.width * 100}%` }" :class="['pointer-events-none absolute border-2 border-cyan-300/80']" />
      <span
        v-if="props.decision?.candidate"
        :style="{ left: `${props.decision.candidate.centre.x * 100}%`, top: `${props.decision.candidate.centre.y * 100}%` }"
        :class="['pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2', stateColor]"
      />
    </div>
    <div :class="['grid gap-1 px-3 py-2 text-xs text-slate-200']">
      <span>{{ props.visionMode }} · {{ props.decision?.state ?? 'EMPTY' }} · {{ props.decision?.transitionReason ?? 'waiting for sample' }}</span>
      <span>scale {{ props.decision?.candidate?.bodyScale.toFixed(3) ?? '—' }} · quality {{ props.decision?.candidate?.poseQuality.toFixed(2) ?? '—' }}</span>
      <span>x {{ props.decision?.velocityX.toFixed(2) ?? '—' }} · scale/s {{ props.decision?.scaleVelocity.toFixed(3) ?? '—' }} · ROI {{ props.decision?.candidate?.interactionRoiHit ? 'interaction' : props.decision?.candidate?.greetingRoiHit ? 'greeting' : 'outside' }}</span>
      <span>{{ props.diagnostics.cadenceTier }} {{ props.diagnostics.poseIntervalMs }}ms · face {{ props.diagnostics.faceActive ? 'active' : 'idle' }}</span>
    </div>
  </aside>
</template>
