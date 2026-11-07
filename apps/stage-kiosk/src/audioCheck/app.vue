<script setup lang="ts">
import Input from '@proj-airi/ui/src/components/form/input/input.vue'
import Select from '@proj-airi/ui/src/components/form/select/select.vue'
import Button from '@proj-airi/ui/src/components/misc/button.vue'

import { computed } from 'vue'

import RecordingResult from './recordingResult.vue'

import { audioCheckMessages as text } from '../../../../packages/i18n/src/audioCheckMessages'
import { useRecorder } from './useRecorder'

const { devices, selected, mapping, radius, algorithm, position, phase, error, elapsed, recording, connected, supported, busy, listDevices, connect, stop, record, cancel } = useRecorder()
const deviceOptions = computed(() => devices.value.map((device, index) => ({ label: device.label || `${text.microphone} ${index + 1}`, value: device.deviceId })))
const positions = (['front', 'left', 'right', 'background'] as const).map(value => ({ value, label: text[value] }))
const unsupportedMessage = window.isSecureContext ? text.unsupported : text.insecure
</script>

<template>
  <main :class="['mx-auto max-w-5xl px-4 py-8 text-slate-900', 'grid gap-6 md:py-12']">
    <header :class="['grid gap-2']">
      <span :class="['text-sm font-semibold tracking-widest text-teal-800']">WEBNAVIOR · AUDIO CHECK</span>
      <h1 :class="['m-0 text-3xl font-bold md:text-4xl']">
        {{ text.title }}
      </h1>
      <p :class="['m-0 text-lg text-slate-600']">
        {{ text.intro }}
      </p>
      <p :class="['rounded-xl bg-teal-50 p-4 text-teal-950']">
        {{ text.localOnly }}
      </p>
    </header>
    <label>{{ text.algorithm }} <Select v-model="algorithm" :options="[{ label: 'LCMV', value: 'lcmv' }, { label: text.mask, value: 'mask' }]" :disabled="connected || busy" /></label>
    <section :class="['rounded-2xl bg-white p-6 shadow-sm', 'grid gap-5']" :aria-label="text.controls">
      <p v-if="!supported" role="alert">
        {{ unsupportedMessage }}
      </p>
      <Button :label="text.permission" :disabled="!supported || busy || connected" @click="listDevices" />
      <label :class="['grid gap-2']">{{ text.device }}
        <Select v-model="selected" :options="deviceOptions" :disabled="connected || busy" :placeholder="text.noDevices" />
      </label>
      <details>
        <summary>{{ text.advanced }}</summary>
        <div :class="['mt-3 grid gap-4 sm:grid-cols-2']">
          <label :class="['grid gap-2']">{{ text.mapping }}<Input v-model="mapping" :disabled="connected || busy" /></label>
          <label :class="['grid gap-2']">{{ text.radius }}<Input v-model="radius" type="number" min="10" max="100" :disabled="connected || busy" /></label>
        </div>
      </details>
      <div :class="['flex flex-wrap gap-3']">
        <Button v-if="!connected" :label="text.connect" :disabled="!supported || !selected || busy" @click="connect" />
        <Button v-else :label="text.stop" variant="secondary" :disabled="phase === 'encoding'" @click="stop" />
      </div>
      <hr :class="['w-full border-0 border-t border-slate-100']">
      <label :class="['grid gap-2']">{{ text.position }}<Select v-model="position" :options="positions" :disabled="busy" /></label>
      <p :class="['m-0 text-slate-600']">
        {{ text.instruction }} {{ text.phrase }}
      </p>
      <div :class="['flex flex-wrap items-center gap-3']">
        <Button :label="text.record" :disabled="!connected || busy" @click="record" />
        <Button v-if="phase === 'recording'" :label="text.cancel" variant="secondary" @click="cancel" />
        <span role="status" aria-live="polite">{{ text.status[phase] }}</span>
      </div>
      <progress v-if="phase === 'recording'" :value="elapsed" max="15" :class="['h-3 w-full']" />
      <p v-if="error" role="alert" :class="['m-0 rounded-lg bg-red-50 p-3 text-red-900']">
        {{ error }}
      </p>
    </section>
    <RecordingResult v-if="recording" v-bind="recording" />
    <footer :class="['text-sm leading-relaxed text-slate-600']">
      <p>{{ text.mappingNotice }}</p>
      <p>{{ text.firefox }}</p>
    </footer>
  </main>
</template>
