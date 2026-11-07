<script setup lang="ts">
import type { PcmLevel } from '@proj-airi/stage-ui/libs/audio/inputGain'
import type { VadInputDiagnostics } from '@proj-airi/stage-ui/stores/ai/models/vad'

import type { SpatialInput } from '../audio/spatialInput'
import type { VoicePresenceDecision } from '../services/voicePresence'

import { Button, Checkbox } from '@proj-airi/ui'

import KioskMicrophonePicker from './KioskMicrophonePicker.vue'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'

const props = defineProps<{ presenceAdmission?: VoicePresenceDecision, lastVoiceBlock?: VoicePresenceDecision, cameraStatus?: string, inputDiagnostics?: VadInputDiagnostics, spatialStatistics?: SpatialInput['statistics'], admissionCounts?: { startBlocked: number, endBlocked: number, noCandidate: number, overloaded: number, asrRequests: number }, enabled: boolean, mode: 'standard' | 'mask', channelCount?: number, status: string, error: string, vadStatus: string, vadError: string, presenceStatus: string, devices: readonly MediaDeviceInfo[], inputGainDb: number, clippedSamples: number, captureStatus: string, capturedDevice: string, captureError: string, starting: boolean, voiceOnly: boolean, hasStream: boolean }>()
const emit = defineEmits<{ start: [], stop: [], permission: [] }>()
const dynamicProcessing = defineModel<boolean>('dynamicProcessing', { default: false })
const microphone = defineModel<string>('microphone', { required: true })
const mapping = defineModel<string>('mapping', { required: true })
const radius = defineModel<number>('radius', { required: true })
const text = orderingMessages['zh-Hant'].arrayAudio
function level(value?: PcmLevel) {
  if (!value)
    return '—'
  const rms = value.rmsDbfs === null ? '−∞' : value.rmsDbfs.toFixed(1)
  const peak = value.peakDbfs === null ? '−∞' : value.peakDbfs.toFixed(1)
  return `RMS ${rms} / peak ${peak} dBFS`
}
</script>

<template>
  <section :class="['rounded border p-3', 'grid gap-2']">
    <h3>{{ text.title }}</h3>
    <p>{{ text.manualSelection }}</p>
    <KioskMicrophonePicker v-model="microphone" :devices="props.devices" :disabled="props.starting" />
    <label :class="['flex items-center gap-2']">
      <Checkbox v-model="dynamicProcessing" :disabled="props.enabled || props.starting" :aria-label="text.dynamicProcessing" />
      {{ text.dynamicProcessing }}
    </label>
    <p>{{ text.dynamicNotice }}</p>
    <p>{{ text.inputGain }} +{{ props.inputGainDb }} dB</p>
    <p v-if="props.clippedSamples > 0" role="status">
      {{ text.clipping }} {{ props.clippedSamples }}
    </p>
    <p>{{ text.captureStatus }} {{ props.captureStatus }}</p>
    <p>
      {{ text.capturedDevice }} {{ props.capturedDevice || text.noActiveMicrophone }}
    </p>
    <p v-if="!props.voiceOnly">
      {{ text.voiceDisabled }}
    </p>
    <p v-if="props.captureError" role="alert">
      {{ props.captureError }}
    </p>
    <div :class="['flex flex-wrap gap-2']">
      <Button :label="text.requestDevices" variant="secondary" :disabled="!props.voiceOnly || props.starting" @click="emit('permission')" />
      <Button :label="text.applyMicrophone" :disabled="!microphone || !props.voiceOnly || props.starting" @click="emit('start')" />
      <Button :label="text.stopCapture" :disabled="!props.starting && !props.enabled" variant="secondary" @click="emit('stop')" />
    </div>
    <p>{{ text.mode }}：{{ props.status === 'stopped' ? text.notDetected : props.mode === 'mask' ? dynamicProcessing ? text.dynamicMask : text.mask : text.standard }}</p>
    <p v-if="props.starting" role="status">
      {{ text.microphoneWorking }}
    </p>
    <p>{{ text.status }} {{ props.status }} <span v-if="props.channelCount !== undefined">（{{ props.channelCount }} CH）</span></p>
    <p v-if="props.error" role="alert">
      {{ props.error }}
    </p>
    <p>{{ text.vadStatus }} {{ props.vadStatus }}</p>
    <p>{{ text.presenceStatus }} {{ props.presenceStatus }}</p>
    <p v-if="props.vadError" role="alert">
      {{ props.vadError }}
    </p>
    <details open>
      <summary>{{ text.signalDiagnostics }}</summary>
      <p>{{ text.digitalLevel }}</p>
      <template v-if="props.spatialStatistics">
        <p>{{ text.dynamicState }} {{ props.spatialStatistics.processingMode }} / {{ props.spatialStatistics.playbackTransitions }}</p>
        <p>{{ text.processingLag }} {{ Math.round(props.spatialStatistics.lagSeconds * 1000) }} ms / {{ props.spatialStatistics.maxWorkMs.toFixed(1) }} ms</p>
        <p>{{ text.referenceLevel }} {{ level(props.spatialStatistics.referenceLevel) }}</p>
        <p>{{ text.maskLevel }} {{ level(props.spatialStatistics.maskLevel) }}</p>
        <p>{{ text.transportFrames }} {{ props.spatialStatistics.inputFrames }} / {{ props.spatialStatistics.outputFrames }} / {{ props.spatialStatistics.consumedFrames }}</p>
      </template>
      <template v-if="props.inputDiagnostics">
        <p>{{ text.vadInputLevel }} {{ level(props.inputDiagnostics.outputLevel) }}</p>
        <p>{{ text.vadSamples }} {{ props.inputDiagnostics.processedSamples }}</p>
        <p>{{ text.vadProbability }} {{ props.inputDiagnostics.probability.toFixed(3) }} / {{ props.inputDiagnostics.maximumProbability.toFixed(3) }}</p>
        <p>{{ text.vadEvents }} {{ props.inputDiagnostics.speechStarts }} / {{ props.inputDiagnostics.speechSegments }}</p>
      </template>
      <p v-if="props.admissionCounts">
        {{ text.admissionCounts }} {{ props.admissionCounts.startBlocked }} / {{ props.admissionCounts.endBlocked }} / {{ props.admissionCounts.noCandidate }} / {{ props.admissionCounts.overloaded }} / {{ props.admissionCounts.asrRequests }}
      </p>
      <p v-if="props.presenceAdmission">
        {{ text.voicePresence }} {{ props.cameraStatus }} / {{ props.presenceAdmission.reason }} / {{ props.presenceAdmission.quality ?? '—' }} / {{ props.presenceAdmission.insideZone ?? '—' }} / {{ props.presenceAdmission.ageMs === null ? '—' : Math.round(props.presenceAdmission.ageMs) }} ms
      </p>
      <p v-if="props.lastVoiceBlock">
        {{ text.lastVoiceBlock }} {{ props.lastVoiceBlock.reason }} / {{ props.lastVoiceBlock.quality ?? '—' }} / {{ props.lastVoiceBlock.insideZone ?? '—' }} / {{ props.lastVoiceBlock.ageMs === null ? '—' : Math.round(props.lastVoiceBlock.ageMs) }} ms
      </p>
    </details>
    <details>
      <summary>{{ text.geometry }}</summary>
      <p>{{ text.stopToConfigure }}</p>
      <label>{{ text.mapping }} <input v-model="mapping" :disabled="props.enabled"></label>
      <label>{{ text.radius }} <input v-model.number="radius" type="number" min="10" max="100" :disabled="props.enabled"></label>
      <p>{{ text.front }}</p>
    </details>
    <p>{{ text.localComparison }}</p>
  </section>
</template>
