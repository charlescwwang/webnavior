<script setup lang="ts">
import { useChatDiagnosticsStore } from '@proj-airi/stage-ui/stores/chat/diagnostics'
import { computed, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'

import ChatDiagnosticsOverlay from './ChatDiagnosticsOverlay.vue'

import { activeInteractiveService } from '../services/interactive-services'
import { webMcpAdapter } from '../services/webmcp-adapter'

const props = defineProps<{
  resetRevision: number
}>()

const emit = defineEmits<{
  activity: []
  completed: []
}>()

const visible = shallowRef(true)
const menuFrame = useTemplateRef<HTMLIFrameElement>('menuFrame')
const chatDiagnostics = useChatDiagnosticsStore()
const activeService = activeInteractiveService
const webMcpUnavailable = computed(() => webMcpAdapter.availability.value === 'unavailable')

function reportCompleted() {
  if (import.meta.env.DEV)
    console.info('[DEBUG-feedback-lifecycle] Stage Web accepted interaction completion')
  emit('completed')
}

function openPanel() {
  visible.value = true
}

function attachFrame() {
  webMcpAdapter.activate(activeService.value?.serviceUrl)
}

function onInteractionLifecycleMessage(event: MessageEvent<{ source?: string, type?: string }>) {
  const service = activeService.value
  const frameWindow = menuFrame.value?.contentWindow
  if (!service || !frameWindow || event.source !== frameWindow) {
    if (import.meta.env.DEV && event.data?.source === 'airi-interaction-lifecycle')
      console.info('[DEBUG-feedback-lifecycle] Stage Web ignored lifecycle event because iframe source did not match', { hasFrame: !!frameWindow, hasService: !!service })
    return
  }
  if (event.origin !== new URL(service.serviceUrl).origin) {
    if (import.meta.env.DEV && event.data?.source === 'airi-interaction-lifecycle')
      console.info('[DEBUG-feedback-lifecycle] Stage Web ignored lifecycle event because origin did not match', { actualOrigin: event.origin, serviceUrl: service.serviceUrl })
    return
  }
  if (event.data?.source !== 'airi-interaction-lifecycle')
    return

  if (event.data.type === 'activity') {
    emit('activity')
    return
  }

  if (event.data.type === 'completed')
    reportCompleted()
}

watch(activeService, () => webMcpAdapter.activate(undefined), { immediate: true })
watch(() => props.resetRevision, () => webMcpAdapter.activate(undefined))
// Native WebMCP is the primary completion path for an Agent-executed tool.
// The iframe lifecycle message above remains for direct customer clicks inside
// the embedded service, which do not pass through the host WebMCP adapter.
watch(webMcpAdapter.completionRevision, (revision, previousRevision) => {
  if (revision > previousRevision)
    reportCompleted()
})

onMounted(() => {
  window.addEventListener('airi:order-menu-open', openPanel)
  window.addEventListener('airi:interactive-service-open', openPanel)
  window.addEventListener('message', onInteractionLifecycleMessage)
})
onUnmounted(() => {
  webMcpAdapter.activate(undefined)
  window.removeEventListener('airi:order-menu-open', openPanel)
  window.removeEventListener('airi:interactive-service-open', openPanel)
  window.removeEventListener('message', onInteractionLifecycleMessage)
})
</script>

<template>
  <section v-if="visible" class="order-menu-panel" aria-label="AIRI 互動服務面板">
    <header>
      <p v-if="webMcpUnavailable" class="webmcp-status" role="status">
        {{ webMcpAdapter.error.value ?? '此瀏覽器不支援 WebMCP。' }}
      </p>
      <div class="panel-actions">
        <button type="button" :title="chatDiagnostics.enabled ? '關閉對話診斷' : '開啟對話診斷'" @click="chatDiagnostics.enabled = !chatDiagnostics.enabled">
          <div :class="chatDiagnostics.enabled ? 'i-solar:chart-2-bold-duotone' : 'i-solar:chart-2-line-duotone'" />
        </button>
        <button type="button" title="隱藏互動服務" @click="visible = false">
          <div class="i-solar:close-circle-linear" />
        </button>
      </div>
    </header>
    <iframe
      ref="menuFrame"
      :key="`${activeService?.id ?? 'none'}:${resetRevision}`"
      :src="activeService?.serviceUrl"
      allow="tools; geolocation"
      :title="activeService?.title ?? 'AIRI 互動服務'"
      @load="attachFrame"
    />
    <ChatDiagnosticsOverlay />
  </section>
</template>

<style scoped>
.order-menu-panel { position: absolute; z-index: 20; top: 1rem; left: 1rem; width: min(54vw, 42rem); height: min(72vh, 48rem); overflow: hidden; border: 1px solid rgb(255 255 255 / .55); border-radius: 1.25rem; background: rgb(255 255 255 / .88); box-shadow: 0 1.25rem 3.5rem rgb(20 8 0 / .25); backdrop-filter: blur(1rem); }
header { display: flex; align-items: center; justify-content: space-between; height: 3.25rem; padding: 0 .75rem; color: #5b2b15; } .webmcp-status { overflow: hidden; margin: 0; color: #8e492d; font-size: .72rem; text-overflow: ellipsis; white-space: nowrap; } .panel-actions { display: flex; flex: none; gap: .25rem; } button { display: grid; width: 2rem; height: 2rem; place-items: center; border: 0; border-radius: 999px; background: transparent; color: #8e492d; cursor: pointer; font-size: 1.25rem; } button:hover { background: rgb(142 73 45 / .12); } iframe { width: 100%; height: calc(100% - 3.25rem); border: 0; background: #fff8ee; }
@media (max-width: 768px) { .order-menu-panel { top: .5rem; left: .5rem; width: calc(100vw - 1rem); height: 58vh; } }
</style>
