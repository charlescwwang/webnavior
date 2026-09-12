<script setup lang="ts">
import { useDraggable } from '@vueuse/core'
import { onMounted, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  faces: Array<{ centre: { x: number, y: number }, facesCamera: boolean }>
  stream?: MediaStream
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
</script>

<template>
  <aside ref="panel" :style="style" :class="['fixed z-90 w-64 overflow-hidden rounded-xl border border-white/30 bg-slate-950/90 shadow-xl']">
    <header :class="['cursor-move px-3 py-2 text-xs font-semibold text-white']">
      即時相機畫面
    </header>
    <div :class="['relative']">
      <video ref="video" autoplay muted playsinline :class="['block aspect-video w-full bg-black object-cover']" />
      <div :style="{ height: `${props.zone.height * 100}%`, left: `${props.zone.x * 100}%`, top: `${props.zone.y * 100}%`, width: `${props.zone.width * 100}%` }" :class="['pointer-events-none absolute border-2 border-cyan-300/80']" />
      <span v-for="(face, index) in props.faces" :key="index" :style="{ left: `${face.centre.x * 100}%`, top: `${face.centre.y * 100}%` }" :class="['pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2', face.facesCamera ? 'border-emerald-300 bg-emerald-400/40' : 'border-amber-300 bg-amber-400/40']" />
    </div>
    <p :class="['m-0 px-3 py-2 text-xs text-slate-200']">
      {{ props.faces.length }} 人 · 綠色：面向 Kiosk · 黃色：未面向
    </p>
  </aside>
</template>
