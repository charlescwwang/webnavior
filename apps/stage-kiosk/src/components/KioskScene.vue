<script setup lang="ts">
import type { ProactiveGreetingTrigger } from '@proj-airi/kiosk-proactive'
import type { ChatProvider } from '@xsai-ext/providers/utils'

import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { createAssistanceReminderWindow, createInteractionWindow } from '@proj-airi/kiosk-proactive'
import { canShowFeedbackInvitation, FeedbackInvitation } from '@proj-airi/stage-ui/components'
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
import KioskIdleDiagnostics from './KioskIdleDiagnostics.vue'
import KioskSessionNotice from './KioskSessionNotice.vue'
import ScenarioSurface from './ScenarioSurface.vue'

import { useFeedbackInvitationSettings } from '../composables/useFeedbackInvitationSettings'
import { useKioskCustomerSession } from '../composables/useKioskCustomerSession'
import { useKioskInteractiveServices } from '../composables/useKioskInteractiveServices'
import { useKioskProactiveGreeting } from '../composables/useKioskProactiveGreeting'
import { needsKioskObservation, useKioskProactiveSettings } from '../composables/useKioskProactiveSettings'
import { useKioskProactiveVision } from '../composables/useKioskProactiveVision'
import { scenarioRegistry } from '../services/scenario-registry'
import { webMcpAdapter } from '../services/webmcp-adapter'

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
const { hasPendingWork, idleDeadlineAt, notice, state: customerSessionState } = customerSession
const showIdleDiagnostics = import.meta.env.DEV
const feedbackInvitationSettings = useFeedbackInvitationSettings()
const canShowCompletionInvitation = computed(() => canShowFeedbackInvitation(feedbackInvitationSettings.value))
const proactiveSettings = useKioskProactiveSettings()
const interactiveServices = useKioskInteractiveServices()
watch(interactiveServices, services => scenarioRegistry.setServices(services), { deep: true, immediate: true })
// Agent-originated completion travels in the native WebMCP tool result. Direct
// customer interaction continues to use the iframe lifecycle event registered
// below, so both routes converge on the same session transition.
watch(webMcpAdapter.completionRevision, (revision, previousRevision) => {
  if (revision > previousRevision)
    handleScenarioCompleted()
})
const proactiveCamera = useTemplateRef<HTMLVideoElement>('proactiveCamera')
const proactiveGreeting = useKioskProactiveGreeting()
let releaseChatPendingWork: (() => void) | undefined
let proactiveWindow = createInteractionWindow(proactiveSettings.value.proactiveGreeting)
let assistanceReminderWindow = createAssistanceReminderWindow(proactiveSettings.value.assistanceReminder)
const proactiveVision = useKioskProactiveVision({
  detectionZone: () => proactiveSettings.value.observation.detectionZone,
  onObservation: observation => void handleProactiveObservation(observation),
})
const localObservationRequired = computed(() => needsKioskObservation(
  proactiveSettings.value,
  customerSessionState.value === 'active',
))
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
    try {
      await webMcpAdapter.waitUntilReady()
      const provider = await providersStore.getProviderInstance(activeProvider.value)
      if (provider && activeModel.value)
        await chatStore.ingest(text, { model: activeModel.value, chatProvider: provider as ChatProvider })
    }
    catch (error) {
      console.warn('[stage-kiosk] ignored voice input while interactive service is unavailable:', error)
    }
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
  proactiveWindow = createInteractionWindow(proactiveSettings.value.proactiveGreeting)
  assistanceReminderWindow = createAssistanceReminderWindow(proactiveSettings.value.assistanceReminder)
  if (customerSessionState.value === 'active')
    assistanceReminderWindow.start(performance.now())
}, { deep: true })

async function syncProactiveVision() {
  if (!localObservationRequired.value) {
    proactiveVision.stop()
    return
  }

  if (proactiveCamera.value)
    await proactiveVision.start(proactiveCamera.value)
}

watch(localObservationRequired, () => void syncProactiveVision())

watch(customerSessionState, (state) => {
  if (state !== 'active') {
    releaseChatPendingWork?.()
    releaseChatPendingWork = undefined
  }
  if (state === 'standby')
    assistanceReminderWindow.reset()
})

watch([() => chatStore.sending, customerSessionState], ([sending, sessionState]) => {
  if (sending && sessionState === 'active') {
    releaseChatPendingWork ??= customerSession.beginPendingWork()
    return
  }

  const wasWaitingForChat = releaseChatPendingWork !== undefined
  releaseChatPendingWork?.()
  releaseChatPendingWork = undefined
  if (wasWaitingForChat && sessionState === 'active')
    assistanceReminderWindow.restartWait(performance.now())
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

    // The local policy enforces presence and rate limits before the selected
    // provider decides whether and how to realize this candidate.
    const releasePendingWork = customerSession.beginPendingWork()
    try {
      await proactiveGreeting.remind(reminderCandidate, proactiveSettings.value.assistanceReminder.reminderText)
    }
    finally {
      releasePendingWork()
      assistanceReminderWindow.restartWait(performance.now())
    }
    return
  }

  if (customerSessionState.value !== 'standby' || chatStore.sending || proactiveGreeting.sending.value)
    return

  const decision = proactiveWindow.decide(observation)
  if (!decision.shouldGreet)
    return
  if (!decision.greetingTrigger)
    return

  try {
    // Begin before asking the LLM so another camera frame cannot create a
    // second greeting while the selected provider is still streaming.
    await customerSession.begin()
    const releasePendingWork = customerSession.beginPendingWork()
    try {
      await proactiveGreeting.greet(decision, greetingContextPrompts(decision.greetingTrigger))
      assistanceReminderWindow.start(performance.now())
    }
    finally {
      releasePendingWork()
    }
  }
  catch (error) {
    console.error('[stage-kiosk] failed to create proactive greeting:', error)
  }
}

/** Selects context references without allowing either administrator prompt to replace the shared greeting policy. */
function greetingContextPrompts(trigger: ProactiveGreetingTrigger) {
  if (trigger === 'presence')
    return [proactiveSettings.value.proactiveGreeting.presenceGreetingPrompt]

  if (proactiveSettings.value.proactiveGreeting.triggerMode === 'mixed')
    return [proactiveSettings.value.proactiveGreeting.presenceGreetingPrompt, proactiveSettings.value.proactiveGreeting.attentionGreetingPrompt]

  return [proactiveSettings.value.proactiveGreeting.attentionGreetingPrompt]
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

function handleScenarioCompleted() {
  if (!customerSession.completeOrder())
    return

  if (!canShowCompletionInvitation.value)
    void customerSession.end('completed')
}

function finishFeedbackInvitation() {
  void customerSession.end('completed')
}

let stopMenuActivityListener: (() => void) | undefined
let stopMenuCompletionListener: (() => void) | undefined

onMounted(() => {
  stopMenuActivityListener = scenarioRegistry.on('activity', () => void recordCustomerActivity())
  stopMenuCompletionListener = scenarioRegistry.on('completed', handleScenarioCompleted)
  void syncProactiveVision()
})

onUnmounted(() => {
  releaseChatPendingWork?.()
  stopMenuActivityListener?.()
  stopMenuCompletionListener?.()
})
</script>

<template>
  <main :class="['kiosk-scene', `is-${orientation}`]" @pointerdown.capture="recordPointerActivity" @wheel.capture="recordPointerActivity">
    <KioskAdminAccess class="kiosk-admin-access">
      <span class="i-solar:settings-outline h-4 w-4" aria-hidden="true" />
      <span>設定</span>
    </KioskAdminAccess>

    <section class="stage-region" aria-label="AIRI 虛擬服務員">
      <WidgetStage
        class="stage-model"
        :cursor-position="cursorPosition"
        :enable-orbit-controls="false"
        :paused="paused"
      />
    </section>

    <ScenarioSurface class="menu-region" />

    <KioskConversation class="conversation-region" @activity="recordCustomerActivity" />
    <KioskIdleDiagnostics
      v-if="showIdleDiagnostics"
      :idle-deadline-at="idleDeadlineAt"
      :pending-work="hasPendingWork"
      :state="customerSessionState"
    />
    <KioskSessionNotice :message="notice" />
    <FeedbackInvitation
      v-if="customerSessionState === 'completing' && canShowCompletionInvitation"
      :settings="feedbackInvitationSettings"
      @finish="finishFeedbackInvitation"
    />
    <video ref="proactiveCamera" class="proactive-camera" muted playsinline aria-hidden="true" />
  </main>
</template>

<style scoped>
.kiosk-scene { display: grid; width: 100vw; height: 100dvh; padding: 1.25rem; overflow: hidden; background: radial-gradient(circle at top left, #154d56, transparent 45%), #101719; gap: 1rem; }
.kiosk-scene.is-landscape { grid-template-columns: minmax(14rem, .24fr) minmax(0, .76fr); grid-template-rows: minmax(0, .31fr) minmax(0, .69fr); }
.kiosk-scene.is-portrait { grid-template-columns: minmax(10rem, .3fr) minmax(0, .7fr); grid-template-rows: minmax(0, .35fr) minmax(0, .65fr); }
.stage-region { position: relative; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid rgb(255 255 255 / 18%); border-radius: 1.5rem; background: rgb(4 19 22 / 74%); grid-column: 1; grid-row: 1; }
.stage-model { width: 100%; height: 100%; }
/* Keep the administrator hold target available without exposing controls in the customer-facing composition. */
:global(.kiosk-admin-access) { position: fixed; z-index: 100; top: 1.75rem; left: 1.75rem; display: inline-flex; height: 2.25rem; align-items: center; gap: .35rem; border: 1px solid rgb(217 250 246 / 28%); border-radius: .7rem; padding: 0 .7rem; color: #d9faf6; background: rgb(1 17 20 / 92%); box-shadow: 0 .35rem 1rem rgb(0 0 0 / 28%); opacity: 0; transition: opacity .16s ease, background .16s ease; }
:global(.kiosk-admin-access:hover), :global(.kiosk-admin-access:focus-visible) { background: #153f43; opacity: 1; }
.conversation-region { grid-column: 2; grid-row: 1; }
.menu-region { min-width: 0; min-height: 0; grid-column: 1 / span 2; grid-row: 2; }
.proactive-camera { position: fixed; width: 1px; height: 1px; pointer-events: none; opacity: 0; }

@media (max-width: 700px) {
  .kiosk-scene { padding: .6rem; gap: .6rem; }
  .kiosk-scene.is-landscape { grid-template-columns: minmax(7rem, .25fr) minmax(0, .75fr); }
}
</style>
