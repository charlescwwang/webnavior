<script setup lang="ts">
import type { PresenceDecision, PresenceVisionMode } from '@proj-airi/kiosk-proactive'

import type { KioskPresenceCadenceTier, KioskProactiveVisionStatus } from '../composables/useKioskProactiveVision'

import { useI18n } from 'vue-i18n'

const props = defineProps<{
  decision?: PresenceDecision
  cameraStatus: KioskProactiveVisionStatus
  cameraError?: string
  sessionState: string
  diagnostics: { cadenceTier: KioskPresenceCadenceTier, faceActive: boolean, poseIntervalMs: number }
  visionMode: PresenceVisionMode
}>()
const { t } = useI18n()
</script>

<template>
  <output :class="['presence-diagnostics']">
    <span>{{ t('stage.kiosk.presence-diagnostics.camera') }} {{ props.cameraStatus }} · {{ t('stage.kiosk.presence-diagnostics.session') }} {{ props.sessionState }}</span>
    <span v-if="props.cameraError" role="status">{{ props.cameraError }}</span>
    <template v-if="props.decision">
      <span>{{ props.visionMode }} · {{ props.decision.previousState }} → {{ props.decision.state }}</span>
      <span>scale {{ props.decision.candidate?.bodyScale.toFixed(3) ?? '—' }} · quality {{ props.decision.candidate?.poseQuality.toFixed(2) ?? '—' }}</span>
      <span>center {{ props.decision.candidate ? `${props.decision.candidate.centre.x.toFixed(2)}, ${props.decision.candidate.centre.y.toFixed(2)}` : '—' }} · dwell {{ Math.round(props.decision.dwellMs) }}ms</span>
      <span>x {{ props.decision.velocityX.toFixed(2) }} · scale/s {{ props.decision.scaleVelocity.toFixed(3) }} · last seen {{ Math.round(props.decision.lastSeenAgeMs) }}ms</span>
      <span>ROI greeting {{ props.decision.candidate?.greetingRoiHit ? 'yes' : 'no' }} · interaction {{ props.decision.candidate?.interactionRoiHit ? 'yes' : 'no' }} · attention {{ props.decision.candidate?.attention ?? '—' }}</span>
      <span>greeting {{ props.decision.greetingEligible ? `eligible (${props.decision.greetingTrigger ?? '—'})` : 'not eligible' }} · idle {{ props.decision.idleSuppressed ? 'suppressed' : 'running' }}</span>
      <span>{{ props.diagnostics.cadenceTier }} {{ props.diagnostics.poseIntervalMs }}ms · face {{ props.diagnostics.faceActive ? 'active' : 'idle' }}</span>
      <span>{{ props.decision.transitionReason }}</span>
    </template>
  </output>
</template>

<style scoped>
.presence-diagnostics { position: fixed; z-index: 70; right: 1rem; bottom: 3.5rem; display: grid; gap: .15rem; max-width: 26rem; border: 1px solid rgb(188 239 231 / 20%); border-radius: .7rem; padding: .5rem .65rem; color: rgb(215 255 248 / 84%); background: rgb(1 19 22 / 76%); font-size: .68rem; pointer-events: none; }
</style>
