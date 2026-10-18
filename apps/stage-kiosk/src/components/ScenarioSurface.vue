<script setup lang="ts">
import { onUnmounted, useTemplateRef, watch } from 'vue'

import CustomerPhoneModal from './customerPhoneModal.vue'

import { useKioskCustomerEntry } from '../composables/useKioskCustomerEntry'
import { scenarioRegistry } from '../services/scenario-registry'
import { webMcpAdapter } from '../services/webmcp-adapter'

const emit = defineEmits<{ activity: [] }>()
const customerEntry = useKioskCustomerEntry(webMcpAdapter)
const scenarioFrame = useTemplateRef<HTMLIFrameElement>('scenarioFrame')
function attachFrame() {
  scenarioRegistry.attachActiveFrame(scenarioFrame.value?.contentWindow ?? null)
  webMcpAdapter.activate(scenarioRegistry.activeScenario.value?.serviceUrl)
}

// Reloads and URL edits can replace the document without changing its service
// ID. Revoke the old tool handles before the new iframe starts loading.
watch([scenarioRegistry.activeScenarioId, scenarioRegistry.iframeRevision], () => {
  scenarioRegistry.attachActiveFrame(null)
  webMcpAdapter.activate(undefined)
}, { immediate: true, flush: 'sync' })

onUnmounted(() => {
  scenarioRegistry.attachActiveFrame(null)
  webMcpAdapter.activate(undefined)
})
</script>

<template>
  <section :class="['scenario-surface']" aria-label="互動服務畫面">
    <CustomerPhoneModal v-if="customerEntry.pending.value" :busy="customerEntry.busy.value" :error="customerEntry.error.value" @submit="customerEntry.submit" @skip="customerEntry.submit()" @activity="emit('activity')" />
    <iframe
      ref="scenarioFrame"
      :key="`${scenarioRegistry.activeScenario.value?.id ?? 'none'}:${scenarioRegistry.iframeRevision.value}`"
      :src="scenarioRegistry.activeScenario.value?.serviceUrl"
      :inert="customerEntry.pending.value || webMcpAdapter.availability.value === 'loading'"
      allow="tools; geolocation; camera 'none'; microphone 'none'; display-capture 'none'"
      :title="scenarioRegistry.activeScenario.value?.title ?? '互動服務'"
      @load="attachFrame"
    />
  </section>
</template>

<style scoped>
.scenario-surface { position: relative; isolation: isolate; display: grid; height: 100%; min-height: 0; overflow: hidden; border: 1px solid rgb(255 255 255 / 30%); border-radius: 1.5rem; background: #fff8ee; box-shadow: 0 1.25rem 4rem rgb(0 0 0 / 24%); }
iframe { min-height: 0; width: 100%; height: 100%; border: 0; }
</style>
