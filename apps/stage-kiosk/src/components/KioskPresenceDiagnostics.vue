<script setup lang="ts">
import type { PresenceDecision, PresenceVisionMode } from '@proj-airi/kiosk-proactive'

import type { KioskPresenceCadenceTier } from '../composables/useKioskProactiveVision'
import type { CustomerTarget } from '../services/customerTarget'

import { useI18n } from 'vue-i18n'

import KioskDiagnosticWindow from './kioskDiagnosticWindow.vue'

const props = defineProps<{
  decision: PresenceDecision
  diagnostics: { cadenceTier: KioskPresenceCadenceTier, faceActive: boolean, poseIntervalMs: number }
  visionMode: PresenceVisionMode
  target?: CustomerTarget
}>()
const { t } = useI18n()
</script>

<template>
  <KioskDiagnosticWindow align-start :class="['presence-diagnostics']" :title="t('stage.kiosk.voice-debug.target')" :label="t('stage.kiosk.voice-debug.target')">
    <span v-if="props.target">#{{ props.target.revision }} · {{ props.target.candidates }} · {{ t(`stage.kiosk.voice-debug.target-${props.target.reason}`) }}</span>
    <span>{{ props.visionMode }} · {{ props.decision.previousState }} → {{ props.decision.state }}</span>
    <span>scale {{ props.decision.candidate?.bodyScale.toFixed(3) ?? '—' }} · quality {{ props.decision.candidate?.poseQuality.toFixed(2) ?? '—' }}</span>
    <span>center {{ props.decision.candidate ? `${props.decision.candidate.centre.x.toFixed(2)}, ${props.decision.candidate.centre.y.toFixed(2)}` : '—' }} · dwell {{ Math.round(props.decision.dwellMs) }}ms</span>
    <span>x {{ props.decision.velocityX.toFixed(2) }} · scale/s {{ props.decision.scaleVelocity.toFixed(3) }} · last seen {{ Math.round(props.decision.lastSeenAgeMs) }}ms</span>
    <span>ROI greeting {{ props.decision.candidate?.greetingRoiHit ? 'yes' : 'no' }} · interaction {{ props.decision.candidate?.interactionRoiHit ? 'yes' : 'no' }} · attention {{ props.decision.candidate?.attention ?? '—' }}</span>
    <span>greeting {{ props.decision.greetingEligible ? `eligible (${props.decision.greetingTrigger ?? '—'})` : 'not eligible' }} · idle {{ props.decision.idleSuppressed ? 'suppressed' : 'running' }}</span>
    <span>{{ props.diagnostics.cadenceTier }} {{ props.diagnostics.poseIntervalMs }}ms · face {{ props.diagnostics.faceActive ? 'active' : 'idle' }}</span>
    <span>{{ props.decision.transitionReason }}</span>
  </KioskDiagnosticWindow>
</template>
