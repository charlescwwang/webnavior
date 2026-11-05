<script setup lang="ts">
import { audioCheckMessages as text } from '../../../../packages/i18n/src/audioCheckMessages'

const props = defineProps<{
  algorithm: 'lcmv-v1' | 'spatial-mask-v1'
  id: string
  position: 'front' | 'left' | 'right' | 'background'
  files: { role: 'raw' | 'reference' | 'processed', url: string }[]
  detailsUrl: string
}>()
function pauseOthers(event: Event) {
  for (const player of document.querySelectorAll('audio')) {
    if (player !== event.target)
      player.pause()
  }
}
</script>

<template>
  <section :class="['rounded-2xl bg-white p-6 shadow-sm', 'grid gap-4']" aria-labelledby="result-title">
    <div>
      <h2 id="result-title" :class="['m-0 text-xl font-bold']">
        {{ text.results }} · {{ text[props.position] }} · {{ props.algorithm === 'lcmv-v1' ? 'LCMV' : text.mask }}
      </h2>
      <p>{{ text.playbackNote }}</p>
    </div>
    <div :class="['grid gap-4 md:grid-cols-3']">
      <article v-for="file in props.files" :key="file.role" :class="['rounded-xl border border-slate-200 p-4', 'flex flex-col gap-3']">
        <h3 :class="['m-0 font-semibold']">
          {{ text[file.role] }}
        </h3>
        <p v-if="file.role === 'raw'" :class="['text-sm text-slate-600']">
          {{ text.rawNote }}
        </p>
        <audio v-else :src="file.url" controls preload="metadata" :class="['w-full']" @play="pauseOthers" />
        <a :href="file.url" :download="`${props.position}-${props.id}-${file.role}.wav`" :class="['mt-auto text-teal-800 underline']">{{ text.download }}</a>
      </article>
    </div>
    <a :href="props.detailsUrl" :download="`${props.position}-${props.id}-details.json`" :class="['text-teal-800 underline']">{{ text.details }}</a>
    <p :class="['text-sm text-slate-600']">
      {{ text.replace }}
    </p>
  </section>
</template>
