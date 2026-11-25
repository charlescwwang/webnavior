<script setup lang="ts">
import { isPbSimulatorHost, readPbJourney } from '@proj-airi/stage-shared/pb-journey'
import { computed, onUnmounted, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import CustomerPhoneModal from './customerPhoneModal.vue'
import KioskActivityGlow from './KioskActivityGlow.vue'
import NativeServiceSurface from './NativeServiceSurface.vue'

import { useKioskCustomerEntry } from '../composables/useKioskCustomerEntry'
import { connectDesktop } from '../services/desktopServiceConnection'
import { interactiveServiceClient } from '../services/interactiveServiceClient'
import { gatewayPage } from '../services/paymentChoice'
import { scenarioRegistry } from '../services/scenario-registry'

const props = defineProps<{ listening?: boolean, operating?: boolean, occluded?: boolean }>()
const emit = defineEmits<{ activity: [] }>()
const customerEntry = useKioskCustomerEntry(interactiveServiceClient)
const scenarioFrame = useTemplateRef<HTMLIFrameElement>('scenarioFrame')
const desktop = window.airiKioskDesktop
const { t } = useI18n()
const browserPbUnsupported = computed(() => {
  const url = scenarioRegistry.activeScenario.value?.serviceUrl
  return !desktop && Boolean(url && readPbJourney(url) && !isPbSimulatorHost(url, location.href))
})
function attachFrame() {
  scenarioRegistry.attachActiveFrame(scenarioFrame.value?.contentWindow ?? null)
  interactiveServiceClient.activate(scenarioRegistry.activeScenario.value?.serviceUrl, scenarioFrame.value?.contentWindow)
}

function attachNative(binding: { serviceId: string, documentKey: string, url: string }) {
  const scenario = scenarioRegistry.activeScenario.value
  if (!desktop || scenario?.id !== binding.serviceId || scenario.serviceUrl !== binding.url || binding.documentKey !== `${scenario.id}:${scenarioRegistry.iframeRevision.value}`)
    return
  gatewayPage.value = undefined
  interactiveServiceClient.activateTransport(binding.url, () => connectDesktop(desktop, binding))
}

// Reloads and URL edits can replace the document without changing its service
// ID. Revoke the old tool handles before the new iframe starts loading.
watch([scenarioRegistry.activeScenarioId, scenarioRegistry.iframeRevision], () => {
  gatewayPage.value = undefined
  scenarioRegistry.attachActiveFrame(null)
  interactiveServiceClient.activate(undefined)
}, { immediate: true, flush: 'sync' })

onUnmounted(() => {
  gatewayPage.value = undefined
  scenarioRegistry.attachActiveFrame(null)
  interactiveServiceClient.activate(undefined)
})
</script>

<template>
  <section class="scenario-surface" aria-label="互動服務畫面">
    <KioskActivityGlow :active="Boolean(props.operating)" mode="operating" />
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
      @navigating="gatewayPage = undefined; interactiveServiceClient.beginNavigation()"
      @manual-payment="gatewayPage = $event; interactiveServiceClient.beginManualPayment()"
      @unavailable="gatewayPage = undefined; interactiveServiceClient.activate(undefined)"
    />
    <div v-else-if="browserPbUnsupported" role="status" :class="['flex flex-col items-center justify-center gap-4 p-6 text-center']">
      <p>{{ t('stage.kiosk.browser-pb-backup') }}</p>
      <a href="https://webnavior.aikcitri.qzz.io/kiosk/" :class="['text-primary-600 underline']">{{ t('stage.kiosk.browser-pb-backup-link') }}</a>
    </div>
    <iframe
      v-else
      ref="scenarioFrame"
      :key="`${scenarioRegistry.activeScenario.value?.id ?? 'none'}:${scenarioRegistry.iframeRevision.value}`"
      :src="scenarioRegistry.activeScenario.value?.serviceUrl"
      :inert="customerEntry.pending.value"
      allow="geolocation; camera 'none'; microphone 'none'; display-capture 'none'"
      :title="scenarioRegistry.activeScenario.value?.title ?? '互動服務'"
      @load="attachFrame"
    />
  </section>
</template>

<style scoped>
.scenario-surface { padding: 3px; position: relative; isolation: isolate; display: grid; grid-template-rows: minmax(0, 1fr); height: 100%; min-height: 0; overflow: hidden; border: 1px solid rgb(255 255 255 / 30%); border-radius: 1rem; background: #fff8ee; box-shadow: 0 1.25rem 4rem rgb(0 0 0 / 24%); }
iframe { min-height: 0; width: 100%; height: 100%; border: 0; }
</style>
