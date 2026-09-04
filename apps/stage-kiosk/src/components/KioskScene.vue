<script setup lang="ts">
import type { ChatProvider } from '@xsai-ext/providers/utils'

import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { createAssistanceReminderWindow, createInteractionWindow } from '@proj-airi/kiosk-proactive'
import { WidgetStage } from '@proj-airi/stage-ui/components/scenes'
import { useAudioRecorder } from '@proj-airi/stage-ui/composables/audio/audio-recorder'
import { useVAD } from '@proj-airi/stage-ui/stores/ai/models/vad'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useHearingSpeechInputPipeline } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { useMouse, useWindowSize } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'

import KioskAdminAccess from './KioskAdminAccess.vue'
import KioskConversation from './KioskConversation.vue'
import KioskSessionNotice from './KioskSessionNotice.vue'
import ScenarioSurface from './ScenarioSurface.vue'

import { useKioskCustomerSession } from '../composables/useKioskCustomerSession'
import { useKioskInteractiveServices } from '../composables/useKioskInteractiveServices'
import { useKioskProactiveGreeting } from '../composables/useKioskProactiveGreeting'
import { useKioskProactiveSettings } from '../composables/useKioskProactiveSettings'
import { useKioskProactiveVision } from '../composables/useKioskProactiveVision'
import { scenarioRegistry } from '../services/scenario-registry'

type KioskOrientation = 'landscape' | 'portrait'

const configuredOrientation = import.meta.env.VITE_KIOSK_ORIENTATION as KioskOrientation | undefined
const { width, height } = useWindowSize()
const orientation = computed<KioskOrientation>(() => configuredOrientation ?? (width.value >= height.value ? 'landscape' : 'portrait'))
const paused = shallowRef(false)

const settingsAudioDeviceStore = useSettingsAudioDevice()
const { enabled, stream } = storeToRefs(settingsAudioDeviceStore)
const { startRecord, stopRecord, onStopRecord } = useAudioRecorder(stream)
const hearingPipeline = useHearingSpeechInputPipeline()
const { transcribeForRecording } = hearingPipeline
const { supportsStreamInput } = storeToRefs(hearingPipeline)
const providersStore = useProvidersStore()
const consciousnessStore = useConsciousnessStore()
const { activeModel, activeProvider } = storeToRefs(consciousnessStore)
const chatStore = useChatOrchestratorStore()
const chatSessionStore = useChatSessionStore()
const { activeCardId } = storeToRefs(useAiriCardStore())
const customerSession = useKioskCustomerSession({ activeCardId, chatSession: chatSessionStore })
const { notice, state: customerSessionState } = customerSession
const proactiveSettings = useKioskProactiveSettings()
const interactiveServices = useKioskInteractiveServices()
watch(interactiveServices, services => scenarioRegistry.setServices(services), { deep: true, immediate: true })
const proactiveCamera = useTemplateRef<HTMLVideoElement>('proactiveCamera')
const proactiveGreeting = useKioskProactiveGreeting()
let proactiveWindow = createInteractionWindow(proactiveSettings.value)
let assistanceReminderWindow = createAssistanceReminderWindow(proactiveSettings.value)
const proactiveVision = useKioskProactiveVision({
  settings: () => proactiveSettings.value,
  onObservation: observation => void handleProactiveObservation(observation),
})
const shouldUseStreamInput = computed(() => supportsStreamInput.value && !!stream.value)
const { x, y } = useMouse()
const cursorPosition = computed(() => ({ x: x.value, y: y.value }))

const { dispose, init, loaded, start } = useVAD(workletUrl, {
  threshold: shallowRef(0.6),
  onSpeechStart: () => {
    if (!shouldUseStreamInput.value)
      startRecord()
  },
  onSpeechEnd: () => {
    if (!shouldUseStreamInput.value)
      stopRecord()
  },
})

let stopOnStopRecord: (() => void) | undefined

async function startAudioInteraction() {
  await init()
  if (stream.value)
    await start(stream.value)

  stopOnStopRecord = onStopRecord(async (recording) => {
    const text = await transcribeForRecording(recording)
    if (!text?.trim())
      return

    await recordCustomerActivity()
    const provider = await providersStore.getProviderInstance(activeProvider.value)
    if (provider && activeModel.value)
      await chatStore.ingest(text, { model: activeModel.value, chatProvider: provider as ChatProvider })
  })
}

function stopAudioInteraction() {
  stopOnStopRecord?.()
  stopOnStopRecord = undefined
  dispose()
}

watch(enabled, async (isEnabled) => {
  if (isEnabled)
    await startAudioInteraction().catch(error => console.error('Failed to start kiosk audio interaction:', error))
  else
    stopAudioInteraction()
}, { immediate: true })

watch([stream, loaded], async ([audioStream, vadLoaded]) => {
  if (enabled.value && vadLoaded && audioStream)
    await start(audioStream).catch(error => console.error('Failed to connect kiosk VAD to audio input:', error))
})

watch(proactiveSettings, () => {
  proactiveWindow = createInteractionWindow(proactiveSettings.value)
  assistanceReminderWindow = createAssistanceReminderWindow(proactiveSettings.value)
  if (customerSessionState.value === 'active')
    assistanceReminderWindow.start(performance.now())
}, { deep: true })

async function syncProactiveVision() {
  if (!proactiveSettings.value.enabled) {
    proactiveVision.stop()
    return
  }

  if (proactiveCamera.value)
    await proactiveVision.start(proactiveCamera.value)
}

watch(() => proactiveSettings.value.enabled, () => void syncProactiveVision())

watch(customerSessionState, (state) => {
  if (state === 'standby')
    assistanceReminderWindow.reset()
})

onUnmounted(() => {
  stopAudioInteraction()
  proactiveVision.stop()
})

async function handleProactiveObservation(observation: Parameters<typeof proactiveWindow.decide>[0]) {
  if (customerSessionState.value === 'active') {
    if (chatStore.sending || proactiveGreeting.sending.value)
      return

    const reminderCandidate = assistanceReminderWindow.decide(observation)
    if (!reminderCandidate)
      return

    // This built-in adapter realizes the policy candidate verbatim. A future
    // Agent adapter belongs at this seam: it may suppress or tailor a candidate,
    // but the reminder policy has already enforced presence and rate limits.
    proactiveGreeting.remind(proactiveSettings.value.reminderText)
    return
  }

  if (customerSessionState.value !== 'standby' || chatStore.sending || proactiveGreeting.sending.value)
    return

  const decision = proactiveWindow.decide(observation)
  if (!decision.shouldGreet)
    return

  try {
    // Begin before asking the LLM so another camera frame cannot create a
    // second greeting while the selected provider is still streaming.
    await customerSession.begin()
    const greetingPrompt = decision.greetingTrigger === 'attention'
      ? proactiveSettings.value.attentionGreetingPrompt
      : proactiveSettings.value.presenceGreetingPrompt
    await proactiveGreeting.greet(decision, greetingPrompt)
    assistanceReminderWindow.start(performance.now())
  }
  catch (error) {
    console.error('[stage-kiosk] failed to create proactive greeting:', error)
  }
}

async function recordCustomerActivity() {
  await customerSession.recordActivity()
  assistanceReminderWindow.recordActivity(performance.now())
}

function recordPointerActivity(event: PointerEvent | WheelEvent) {
  const target = event.target
  if (target instanceof Element && target.closest('[data-kiosk-admin-control]'))
    return

  void recordCustomerActivity()
}

let stopMenuActivityListener: (() => void) | undefined
let stopMenuCompletionListener: (() => void) | undefined

onMounted(() => {
  stopMenuActivityListener = scenarioRegistry.on('activity', () => void recordCustomerActivity())
  stopMenuCompletionListener = scenarioRegistry.on('completed', () => customerSession.completeOrder())
  void syncProactiveVision()
})

onUnmounted(() => {
  stopMenuActivityListener?.()
  stopMenuCompletionListener?.()
})
</script>

<template>
  <main :class="['kiosk-scene', `is-${orientation}`]" @pointerdown.capture="recordPointerActivity" @wheel.capture="recordPointerActivity">
    <section class="stage-region" aria-label="AIRI 虛擬服務員">
      <KioskAdminAccess
        class="stage-label"
      >
        <span class="stage-dot" /> AIRI 互動服務員
      </KioskAdminAccess>
      <WidgetStage
        class="stage-model"
        :cursor-position="cursorPosition"
        :enable-orbit-controls="false"
        :paused="paused"
      />
    </section>

    <ScenarioSurface class="menu-region" />

    <KioskConversation class="conversation-region" @activity="recordCustomerActivity" />
    <KioskSessionNotice :message="notice" />
    <video ref="proactiveCamera" class="proactive-camera" muted playsinline aria-hidden="true" />
  </main>
</template>

<style scoped>
.kiosk-scene { display: grid; width: 100vw; height: 100dvh; padding: 1.25rem; overflow: hidden; background: radial-gradient(circle at top left, #154d56, transparent 45%), #101719; gap: 1rem; }
.kiosk-scene.is-landscape { grid-template-columns: minmax(14rem, .24fr) minmax(0, .76fr); grid-template-rows: minmax(0, .31fr) minmax(0, .69fr); }
.kiosk-scene.is-portrait { grid-template-columns: minmax(10rem, .3fr) minmax(0, .7fr); grid-template-rows: minmax(0, .35fr) minmax(0, .65fr); }
.stage-region { position: relative; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid rgb(255 255 255 / 18%); border-radius: 1.5rem; background: rgb(4 19 22 / 74%); grid-column: 1; grid-row: 1; }
.stage-model { width: 100%; height: 100%; }
.stage-label { position: absolute; z-index: 2; top: 1rem; left: 1rem; display: flex; align-items: center; gap: .5rem; padding: .55rem .75rem; border-radius: 99rem; background: rgb(1 17 20 / 58%); color: #d9faf6; font-size: .85rem; font-weight: 800; }
.stage-dot { width: .5rem; height: .5rem; border-radius: 999px; background: #56dec5; box-shadow: 0 0 0 .32rem rgb(86 222 197 / 20%); }
.conversation-region { grid-column: 2; grid-row: 1; }
.menu-region { min-width: 0; min-height: 0; grid-column: 1 / span 2; grid-row: 2; }
.proactive-camera { position: fixed; width: 1px; height: 1px; pointer-events: none; opacity: 0; }

@media (max-width: 700px) {
  .kiosk-scene { padding: .6rem; gap: .6rem; }
  .kiosk-scene.is-landscape { grid-template-columns: minmax(7rem, .25fr) minmax(0, .75fr); }
  .stage-label { top: .55rem; left: .55rem; font-size: .72rem; }
}
</style>
