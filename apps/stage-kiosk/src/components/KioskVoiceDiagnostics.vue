<script setup lang="ts">
import type { BackgroundSpeechMode } from '@proj-airi/stage-shared/kiosk-service-mode'

import type { CustomerTarget } from '../services/customerTarget'
import type { SpeechInterruptionState } from '../services/speechInterruption'

import { toOrderingTraditionalChinese } from '@proj-airi/stage-ui/libs/taiwan-traditional-chinese'
import { useI18n } from 'vue-i18n'

import KioskDiagnosticWindow from './kioskDiagnosticWindow.vue'

export interface KioskVoiceDiagnosticEntry {
  id: number
  status: 'recognizing' | 'unrecognized' | 'recognized' | 'decided' | 'failed' | 'ignored' | 'speech-start' | 'speech-end' | 'blocked' | 'tts' | 'interrupted'
  text?: string
  reason?: string
  events?: { status: KioskVoiceDiagnosticEntry['status'], at: number }[]
}

const props = defineProps<{ entries: readonly KioskVoiceDiagnosticEntry[], mode?: 'customer' | 'text' | 'admin', microphone?: boolean, capturing?: boolean, probability?: number, blockedReason?: string, error?: string, processing?: string, lagMs?: number, referenceFrames?: number, inputDb?: number, outputDb?: number, limitedPercent?: number, target?: CustomerTarget, interruption?: SpeechInterruptionState, backgroundSpeechMode?: BackgroundSpeechMode }>()
const { t } = useI18n()

function statusLabel(entry: KioskVoiceDiagnosticEntry) {
  if (['speech-start', 'speech-end', 'blocked', 'tts', 'interrupted'].includes(entry.status))
    return t(`stage.kiosk.voice-debug.${entry.status}`)
  if (entry.status === 'ignored')
    return t('stage.kiosk.voice-presence-ignored')
  if (entry.status === 'recognizing')
    return '辨識中'
  if (entry.status === 'unrecognized')
    return '未辨識出文字'
  if (entry.status === 'recognized')
    return '已辨識，等待判斷'
  if (entry.status === 'failed')
    return '辨識失敗'
  return '快速處理完成'
}
</script>

<template>
  <KioskDiagnosticWindow :class="['voice-diagnostics']" :title="t('stage.kiosk.voice-debug.title')" :label="t('stage.kiosk.voice-debug.label')">
    <template #summary>
      <span>最近 {{ props.entries.length }} 筆</span>
    </template>
    <p :class="['voice-runtime']">
      {{ t(`stage.kiosk.voice-debug.mode-${props.mode ?? 'customer'}`) }} · {{ t(props.microphone ? 'stage.kiosk.voice-debug.microphone-on' : 'stage.kiosk.voice-debug.microphone-off') }}
      · VAD {{ props.capturing ? '●' : '○' }} {{ Math.round((props.probability ?? 0) * 100) }}%
    </p>
    <p v-if="props.processing" :class="['voice-runtime']">
      {{ props.processing }}
      · {{ t('stage.kiosk.array-audio.metrics', { lag: Math.round(props.lagMs ?? 0), reference: props.referenceFrames ?? 0, input: props.inputDb?.toFixed(1) ?? '—', output: props.outputDb?.toFixed(1) ?? '—', limited: props.limitedPercent?.toFixed(1) ?? '0' }) }}
    </p>
    <p v-if="props.blockedReason" role="status">
      {{ t(`stage.kiosk.voice-debug.${props.blockedReason}`) }}
    </p>
    <p v-if="props.error" role="status">
      {{ props.error }}
    </p>
    <p v-if="props.target" :class="['voice-runtime']">
      {{ t('stage.kiosk.voice-debug.target') }} #{{ props.target.revision }} · {{ props.target.candidates }}
      · {{ t(`stage.kiosk.voice-debug.target-${props.target.reason}`) }}
    </p>
    <p v-if="props.interruption" :class="['voice-runtime']">
      {{ t('stage.kiosk.voice-debug.interruption') }} · {{ props.backgroundSpeechMode }}
      · {{ t(`stage.kiosk.voice-debug.interruption-${props.interruption.reason}`) }} {{ Math.round(props.interruption.durationMs) }}ms
    </p>
    <ol class="voice-diagnostics-list">
      <li v-for="entry in props.entries" :key="entry.id" class="voice-diagnostics-entry">
        <strong>{{ statusLabel(entry) }}</strong>
        <span v-if="entry.reason">{{ t(`stage.kiosk.voice-debug.${entry.reason}`) }}</span>
        <small v-if="entry.events?.length">{{ entry.events.map(event => `${new Date(event.at).toLocaleTimeString()} ${event.status}`).join(' → ') }}</small>
        <span v-if="entry.text" class="voice-diagnostics-text">「{{ toOrderingTraditionalChinese(entry.text) }}」</span>
      </li>
    </ol>
  </KioskDiagnosticWindow>
</template>

<style scoped>
.voice-diagnostics-list { display: grid; gap: .45rem; margin: 0; padding: 0; overflow: auto; list-style: none; }.voice-diagnostics-entry { display: grid; gap: .12rem; border-top: 1px solid rgb(254 240 138 / 15%); padding-top: .45rem; color: rgb(254 249 195 / 75%); }.voice-diagnostics-entry strong { color: rgb(254 240 138 / 96%); }.voice-diagnostics-text { color: white; font-size: .8rem; }
</style>
