<script setup lang="ts">
import type { ProductPresentation } from '@proj-airi/stage-shared/product-presentation'

import { onUnmounted, useTemplateRef, watch } from 'vue'

import BrowserProductPresentation from './browserProductPresentation.vue'
import CustomerPhoneModal from './customerPhoneModal.vue'
import NativeServiceSurface from './NativeServiceSurface.vue'

import { useKioskCustomerEntry } from '../composables/useKioskCustomerEntry'
import { connectDesktop } from '../services/desktopServiceConnection'
import { interactiveServiceClient } from '../services/interactiveServiceClient'
import { scenarioRegistry } from '../services/scenario-registry'

const props = defineProps<{ listening?: boolean, occluded?: boolean, presentation?: ProductPresentation }>()
const emit = defineEmits<{ activity: [] }>()
const customerEntry = useKioskCustomerEntry(interactiveServiceClient)
const scenarioFrame = useTemplateRef<HTMLIFrameElement>('scenarioFrame')
const desktop = window.airiKioskDesktop
function attachFrame() {
  scenarioRegistry.attachActiveFrame(scenarioFrame.value?.contentWindow ?? null)
  interactiveServiceClient.activate(scenarioRegistry.activeScenario.value?.serviceUrl, scenarioFrame.value?.contentWindow)
}

function attachNative(binding: { serviceId: string, documentKey: string, url: string }) {
  const scenario = scenarioRegistry.activeScenario.value
  if (!desktop || scenario?.id !== binding.serviceId || scenario.serviceUrl !== binding.url || binding.documentKey !== `${scenario.id}:${scenarioRegistry.iframeRevision.value}`)
    return
  interactiveServiceClient.activateTransport(binding.url, () => connectDesktop(desktop, binding))
}

// Reloads and URL edits can replace the document without changing its service
// ID. Revoke the old tool handles before the new iframe starts loading.
watch([scenarioRegistry.activeScenarioId, scenarioRegistry.iframeRevision], () => {
  scenarioRegistry.attachActiveFrame(null)
  interactiveServiceClient.activate(undefined)
}, { immediate: true, flush: 'sync' })

onUnmounted(() => {
  scenarioRegistry.attachActiveFrame(null)
  interactiveServiceClient.activate(undefined)
})
</script>

<template>
  <section :class="['scenario-surface', { 'has-presentation': props.presentation?.products.length }]" aria-label="互動服務畫面">
    <slot name="preparation" />
    <BrowserProductPresentation v-if="props.presentation?.products.length" :presentation="props.presentation" />
    <CustomerPhoneModal v-if="customerEntry.pending.value" :listening="props.listening" :busy="customerEntry.busy.value" :error="customerEntry.error.value" @submit="customerEntry.submit" @skip="customerEntry.submit()" @activity="emit('activity')" />
    <NativeServiceSurface
      v-if="desktop && scenarioRegistry.activeScenario.value"
      :bridge="desktop"
      :service-id="scenarioRegistry.activeScenario.value.id"
      :document-key="`${scenarioRegistry.activeScenario.value.id}:${scenarioRegistry.iframeRevision.value}`"
      :url="scenarioRegistry.activeScenario.value.serviceUrl"
      :title="scenarioRegistry.activeScenario.value.title"
      :occluded="Boolean(props.occluded || customerEntry.pending.value)"
      @activity="emit('activity')"
      @ready="attachNative"
      @navigating="interactiveServiceClient.beginNavigation()"
      @unavailable="interactiveServiceClient.activate(undefined)"
    />
    <iframe
      v-else
      ref="scenarioFrame"
      :key="`${scenarioRegistry.activeScenario.value?.id ?? 'none'}:${scenarioRegistry.iframeRevision.value}`"
      :src="scenarioRegistry.activeScenario.value?.serviceUrl"
      :inert="customerEntry.pending.value || interactiveServiceClient.availability.value === 'loading'"
      allow="geolocation; camera 'none'; microphone 'none'; display-capture 'none'"
      :title="scenarioRegistry.activeScenario.value?.title ?? '互動服務'"
      @load="attachFrame"
    />
  </section>
</template>

<style scoped>
.scenario-surface { position: relative; isolation: isolate; display: grid; grid-template-rows: minmax(0, 1fr); height: 100%; min-height: 0; overflow: hidden; border: 1px solid rgb(255 255 255 / 30%); border-radius: 1.5rem; background: #fff8ee; box-shadow: 0 1.25rem 4rem rgb(0 0 0 / 24%); }
.has-presentation { grid-template-rows: auto minmax(0, 1fr); }
iframe { min-height: 0; width: 100%; height: 100%; border: 0; }
</style>
