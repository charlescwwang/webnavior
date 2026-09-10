<script setup lang="ts">
import type { WebMcpToolExecution } from '@proj-airi/stage-ui/services/webmcp-adapter'
import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { createAssistanceReminderWindow, createInteractionWindow } from '@proj-airi/kiosk-proactive'
import { CustomerSessionCompletion, CustomerSessionIdleConfirmation } from '@proj-airi/stage-ui/components'
import { WidgetStage } from '@proj-airi/stage-ui/components/scenes'
import { useAudioRecorder } from '@proj-airi/stage-ui/composables/audio/audio-recorder'
import { useVAD } from '@proj-airi/stage-ui/stores/ai/models/vad'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useHearingSpeechInputPipeline } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
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
import { useKioskInteractionRecording } from '../composables/useKioskInteractionRecording'
import { useKioskInteractiveServices } from '../composables/useKioskInteractiveServices'
import { needsKioskObservation, useKioskProactiveSettings } from '../composables/useKioskProactiveSettings'
import { useKioskProactiveVision } from '../composables/useKioskProactiveVision'
import { setKioskLocale } from '../modules/i18n'
import { scenarioRegistry } from '../services/scenario-registry'
import { webMcpAdapter } from '../services/webmcp-adapter'

type KioskOrientation = 'landscape' | 'portrait'

const configuredOrientation = import.meta.env.VITE_KIOSK_ORIENTATION as KioskOrientation | undefined
const { width, height } = useWindowSize()
const orientation = computed<KioskOrientation>(() => configuredOrientation ?? (width.value >= height.value ? 'landscape' : 'portrait'))
const paused = shallowRef(false)

const settingsAudioDeviceStore = useSettingsAudioDevice()
const { language } = storeToRefs(useSettings())
const { enabled, stream } = storeToRefs(settingsAudioDeviceStore)
const { startRecord, stopRecord, onStopRecord } = useAudioRecorder(stream)
const hearingPipeline = useHearingSpeechInputPipeline()
const { transcribeForRecording } = hearingPipeline
const { supportsStreamInput } = storeToRefs(hearingPipeline)
const chatSessionStore = useChatSessionStore()
const { activeCardId } = storeToRefs(useAiriCardStore())
const customerSession = useKioskCustomerSession({ activeCardId, chatSession: chatSessionStore })
const interactionRecording = useKioskInteractionRecording()
const conversationMessages = shallowRef<ChatHistoryItem[]>([])
const conversationSending = shallowRef(false)
const {
  continueCurrentSession,
  hasPendingWork,
  idleDeadlineAt,
  notice,
  startNewCustomerSession: resetForNewCustomer,
  state: customerSessionState,
} = customerSession
const showIdleDiagnostics = import.meta.env.DEV
const feedbackInvitationSettings = useFeedbackInvitationSettings()
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
    await interactionRecording.append('asr_transcript', text)
    await sendConversationMessage(text)
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

watch(language, locale => setKioskLocale(locale), { immediate: true })

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

watch([conversationSending, customerSessionState], ([sending, sessionState]) => {
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
  void interactionRecording.end('cancelled')
})

async function handleProactiveObservation(observation: Parameters<typeof proactiveWindow.decide>[0]) {
  if (customerSessionState.value === 'active') {
    if (conversationSending.value)
      return

    const reminderCandidate = assistanceReminderWindow.decide(observation)
    if (!reminderCandidate)
      return

    // Local policy enforces presence and rate limits. The Server owns the
    // Profile prompt, model selection, Provider credentials, and transcript.
    const releasePendingWork = customerSession.beginPendingWork()
    try {
      await sendAssistantAction('reminder')
    }
    finally {
      releasePendingWork()
      assistanceReminderWindow.restartWait(performance.now())
    }
    return
  }

  if (customerSessionState.value !== 'standby' || conversationSending.value)
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
    await interactionRecording.start(scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction')
    const releasePendingWork = customerSession.beginPendingWork()
    try {
      await sendAssistantAction('greeting')
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

async function recordCustomerActivity() {
  await customerSession.recordActivity()
  await interactionRecording.start(scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction')
  await interactionRecording.append('service_event', 'activity')
  assistanceReminderWindow.recordActivity(performance.now())
}

async function sendAssistantAction(kind: 'greeting' | 'reminder') {
  const serviceId = scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction'
  conversationSending.value = true
  try {
    const answer = await interactionRecording.runAssistantAction(serviceId, kind)
    if (answer) {
      conversationMessages.value = [
        ...conversationMessages.value,
        { role: 'assistant', content: answer, slices: [], tool_results: [] },
      ]
    }
  }
  finally {
    conversationSending.value = false
  }
}

async function sendConversationMessage(text: string) {
  conversationSending.value = true
  try {
    const answer = await interactionRecording.send(scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction', text)
    conversationMessages.value = [
      ...conversationMessages.value,
      { role: 'user', content: text },
      answer
        ? { role: 'assistant', content: answer, slices: [], tool_results: [] }
        : { role: 'error', content: '暫時無法回覆，請稍後再試。' },
    ]
  }
  finally {
    conversationSending.value = false
  }
}

function recordPointerActivity(event: PointerEvent | WheelEvent) {
  const target = event.target
  if (target instanceof Element && target.closest('[data-kiosk-admin-control]'))
    return

  void recordCustomerActivity()
}

function recordWebMcpExecution(execution: WebMcpToolExecution) {
  const serviceId = scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction'
  const kind = execution.phase === 'called' ? 'tool_call' : 'tool_result'
  const payload = execution.phase === 'called' ? execution.input : (execution.error ?? execution.result)
  void interactionRecording.start(serviceId).then(async (sessionId) => {
    if (!sessionId)
      return

    await interactionRecording.append(kind, serializeInteractionPayload(payload), {
      origin: execution.tool.origin,
      toolName: execution.tool.name,
    })
  })
}

function serializeInteractionPayload(payload: unknown) {
  try {
    return JSON.stringify(payload)
  }
  catch {
    // WebMCP inputs and results should be structured JSON. This fallback keeps
    // the durable audit trail usable if a browser implementation violates it.
    return '"[unserializable WebMCP payload]"'
  }
}

async function handleScenarioCompleted(orderResult?: Parameters<typeof interactionRecording.recordOrderResult>[0]) {
  // A direct iframe click may emit `activity` and `completed` back-to-back.
  // Establish the anonymous session here as well so completion cannot outrun
  // the asynchronous activity handler and disappear without a customer screen.
  await recordCustomerActivity()
  await interactionRecording.append('service_event', 'completed')
  if (orderResult)
    await interactionRecording.recordOrderResult(orderResult)
  if (customerSession.completeOrder())
    await interactionRecording.append('service_event', 'feedback_invitation_shown')
}

async function finishCustomerSessionCompletion() {
  await interactionRecording.append('service_event', 'feedback_invitation_dismissed')
  await interactionRecording.end('completed')
  await customerSession.end('completed')
}

async function startNewCustomerSession() {
  await interactionRecording.end('idle')
  await resetForNewCustomer()
}

let stopMenuActivityListener: (() => void) | undefined
let stopMenuCompletionListener: (() => void) | undefined
let stopToolExecutionListener: (() => void) | undefined

onMounted(() => {
  stopMenuActivityListener = scenarioRegistry.on('activity', () => void recordCustomerActivity())
  stopMenuCompletionListener = scenarioRegistry.on('completed', orderResult => void handleScenarioCompleted(orderResult))
  stopToolExecutionListener = webMcpAdapter.onExecution(recordWebMcpExecution)
  void syncProactiveVision()
})

onUnmounted(() => {
  releaseChatPendingWork?.()
  stopMenuActivityListener?.()
  stopMenuCompletionListener?.()
  stopToolExecutionListener?.()
})
</script>

<template>
  <main :class="['kiosk-scene', `is-${orientation}`]" @pointerdown.capture="recordPointerActivity" @wheel.capture="recordPointerActivity">
    <KioskAdminAccess class="kiosk-admin-access">
      <span class="i-solar:settings-outline h-4 w-4" aria-hidden="true" />
      <span>設定</span>
    </KioskAdminAccess>

    <section class="stage-region" aria-label="虛擬服務員">
      <WidgetStage
        class="stage-model"
        :cursor-position="cursorPosition"
        :enable-orbit-controls="false"
        :paused="paused"
      />
    </section>

    <ScenarioSurface class="menu-region" />

    <KioskConversation
      class="conversation-region"
      :messages="conversationMessages"
      :sending="conversationSending"
      @activity="recordCustomerActivity"
      @send-message="sendConversationMessage"
    />
    <KioskIdleDiagnostics
      v-if="showIdleDiagnostics"
      :idle-deadline-at="idleDeadlineAt"
      :pending-work="hasPendingWork"
      :state="customerSessionState"
    />
    <KioskSessionNotice :message="notice" />
    <CustomerSessionIdleConfirmation
      v-if="customerSessionState === 'awaiting-idle-confirmation'"
      :deadline-at="idleDeadlineAt"
      @continue="continueCurrentSession"
      @new-customer="startNewCustomerSession"
    />
    <CustomerSessionCompletion
      v-if="customerSessionState === 'completing'"
      :settings="feedbackInvitationSettings"
      @finish="finishCustomerSessionCompletion"
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
