<script setup lang="ts">
import type { KioskCustomerSessionState } from '../composables/useKioskCustomerSession'

import { useNow } from '@vueuse/core'
import { computed } from 'vue'

const props = defineProps<{
  idleDeadlineAt: number | undefined
  pendingWork: boolean
  presenceIdleProtection?: { reason: 'customer-activity' | 'visual-engagement', until?: number }
  state: KioskCustomerSessionState
}>()

const now = useNow({ interval: 1_000 })
const secondsUntilReset = computed(() => {
  if (props.idleDeadlineAt === undefined)
    return undefined
  return Math.max(0, Math.ceil((props.idleDeadlineAt - now.value.getTime()) / 1_000))
})
const label = computed(() => {
  if (props.state === 'standby')
    return '待命中'
  if (props.state === 'completing')
    return '訂單完成中'
  if (props.state === 'awaiting-idle-confirmation')
    return `等待顧客確認：${secondsUntilReset.value ?? '—'} 秒`
  if (props.state === 'resetting')
    return '重置中'
  if (props.pendingWork)
    return '閒置重置暫停：服務員處理中'
  if (props.presenceIdleProtection?.reason === 'customer-activity')
    return '閒置重置暫停：顧客正在互動'
  if (props.presenceIdleProtection?.reason === 'visual-engagement') {
    const seconds = props.presenceIdleProtection.until == null
      ? undefined
      : Math.max(0, Math.ceil((props.presenceIdleProtection.until - now.value.getTime()) / 1_000))
    return `閒置重置暫停：偵測使用者靠近（${seconds ?? '—'} 秒）`
  }
  return `閒置重置：${secondsUntilReset.value ?? '—'} 秒`
})
</script>

<template>
  <output class="idle-diagnostics" aria-live="polite">
    <span class="i-solar:hourglass-line-duotone" aria-hidden="true" />
    <span>測試 · {{ label }}</span>
  </output>
</template>

<style scoped>
.idle-diagnostics { position: fixed; z-index: 70; right: 1rem; bottom: 1rem; display: inline-flex; align-items: center; gap: .35rem; border: 1px solid rgb(188 239 231 / 20%); border-radius: 999px; padding: .38rem .62rem; color: rgb(215 255 248 / 84%); background: rgb(1 19 22 / 62%); font-size: .72rem; pointer-events: none; }
</style>
