<script setup lang="ts">
import { toTaiwanTraditionalChinese } from '@proj-airi/stage-ui/libs/taiwan-traditional-chinese'
import { useI18n } from 'vue-i18n'

export interface KioskVoiceDiagnosticEntry {
  id: number
  status: 'recognizing' | 'unrecognized' | 'recognized' | 'decided' | 'failed' | 'ignored'
  text?: string
}

const props = defineProps<{ entries: readonly KioskVoiceDiagnosticEntry[] }>()
const { t } = useI18n()

function statusLabel(entry: KioskVoiceDiagnosticEntry) {
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
  <aside class="voice-diagnostics" aria-live="polite" aria-label="語音診斷">
    <header class="voice-diagnostics-header">
      <span class="i-solar:microphone-3-bold-duotone" aria-hidden="true" />
      <strong>語音診斷模式</strong>
      <span>最近 {{ props.entries.length }} 段</span>
    </header>
    <ol class="voice-diagnostics-list">
      <li v-for="entry in props.entries" :key="entry.id" class="voice-diagnostics-entry">
        <strong>{{ statusLabel(entry) }}</strong>
        <span v-if="entry.text" class="voice-diagnostics-text">「{{ toTaiwanTraditionalChinese(entry.text) }}」</span>
      </li>
    </ol>
  </aside>
</template>

<style scoped>
.voice-diagnostics { position: fixed; z-index: 75; right: 1rem; bottom: 1rem; display: grid; width: min(32rem, calc(100vw - 2rem)); max-height: min(44dvh, 30rem); gap: .45rem; overflow: hidden; border: 1px solid rgb(253 224 71 / 38%); border-radius: .8rem; padding: .65rem .75rem; color: rgb(254 252 232 / 92%); background: rgb(25 22 10 / 88%); box-shadow: 0 .5rem 1.5rem rgb(0 0 0 / 28%); font-size: .72rem; backdrop-filter: blur(.65rem); pointer-events: none; }
.voice-diagnostics-header { display: flex; align-items: center; gap: .4rem; color: rgb(254 240 138 / 96%); }.voice-diagnostics-header span:last-child { margin-left: auto; color: rgb(254 249 195 / 72%); font-size: .65rem; font-weight: 400; }
.voice-diagnostics-list { display: grid; gap: .45rem; margin: 0; padding: 0; overflow: auto; list-style: none; }.voice-diagnostics-entry { display: grid; gap: .12rem; border-top: 1px solid rgb(254 240 138 / 15%); padding-top: .45rem; color: rgb(254 249 195 / 75%); }.voice-diagnostics-entry strong { color: rgb(254 240 138 / 96%); }.voice-diagnostics-text { color: white; font-size: .8rem; }
</style>
