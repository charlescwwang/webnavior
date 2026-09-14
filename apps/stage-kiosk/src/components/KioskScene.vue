<script setup lang="ts">
import type { DeviceSettingsValues } from '@proj-airi/kiosk-proactive'
import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import type { KioskMediaCaptureMode, KioskPerformanceProfile } from '../services/kiosk-device'

import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { createAssistanceReminderWindow, createInteractionWindow, defaultDeviceSettingsValues, observationSettings } from '@proj-airi/kiosk-proactive'
import { CustomerSessionCompletion, CustomerSessionIdleConfirmation } from '@proj-airi/stage-ui/components'
import { WidgetStage } from '@proj-airi/stage-ui/components/scenes'
import { useVAD } from '@proj-airi/stage-ui/stores/ai/models/vad'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useLlmToolsStore } from '@proj-airi/stage-ui/stores/llm-tools'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { useMouse, useWindowSize } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'

import KioskAdminAccess from './KioskAdminAccess.vue'
import KioskCameraPreview from './KioskCameraPreview.vue'
import KioskConversation from './KioskConversation.vue'
import KioskIdleDiagnostics from './KioskIdleDiagnostics.vue'
import KioskSessionNotice from './KioskSessionNotice.vue'
import ScenarioSurface from './ScenarioSurface.vue'

import { useFeedbackInvitationSettings } from '../composables/useFeedbackInvitationSettings'
import { useKioskCameraPreview } from '../composables/useKioskCameraPreview'
import { useKioskCustomerSession } from '../composables/useKioskCustomerSession'
import { useKioskInteractionRecording } from '../composables/useKioskInteractionRecording'
import { canStartKioskVoiceTurn, useKioskInteractionTurn } from '../composables/useKioskInteractionTurn'
import { useKioskInteractiveServices } from '../composables/useKioskInteractiveServices'
import { useKioskMediaCapture } from '../composables/useKioskMediaCapture'
import { needsKioskObservation } from '../composables/useKioskProactiveSettings'
import { useKioskProactiveVision } from '../composables/useKioskProactiveVision'
import { setKioskLocale } from '../modules/i18n'
import { createKioskVadRecording } from '../services/kiosk-audio'
import { synthesizeKioskSpeech, transcribeKioskAudio } from '../services/kiosk-device'
import { kioskPerformanceSettings } from '../services/kiosk-performance'
import { createKioskStartupPermissionGate } from '../services/kiosk-startup-permission-gate'
import { scenarioRegistry } from '../services/scenario-registry'
import { webMcpAdapter } from '../services/webmcp-adapter'
import { describeWebnaviorKioskToolActivity, loadWebnaviorKioskActivityManifest } from '../services/webnaviorKioskActivity'

type KioskOrientation = 'landscape' | 'portrait'

const props = defineProps<{
  deviceSettings?: DeviceSettingsValues
  mediaCaptureMode: KioskMediaCaptureMode
  performanceProfile: KioskPerformanceProfile
  proactiveVlmEnabled: boolean
  voiceConversationOnly: boolean
  voiceVadThreshold: number
}>()

const configuredOrientation = import.meta.env.VITE_KIOSK_ORIENTATION as KioskOrientation | undefined
const { width, height } = useWindowSize()
const orientation = computed<KioskOrientation>(() => configuredOrientation ?? (width.value >= height.value ? 'landscape' : 'portrait'))
const paused = shallowRef(false)

const settingsAudioDeviceStore = useSettingsAudioDevice()
const { language } = storeToRefs(useSettings())
const { enabled, stream } = storeToRefs(settingsAudioDeviceStore)
const { askPermission: requestMicrophonePermission } = settingsAudioDeviceStore
const chatSessionStore = useChatSessionStore()
const { activeTools } = storeToRefs(useLlmToolsStore())
const { activeCardId } = storeToRefs(useAiriCardStore())
const conversationMessages = shallowRef<ChatHistoryItem[]>([])
const conversationWorkStatus = shallowRef<string>()
const pendingTranscript = shallowRef<string>()
const toolActivityManifest = shallowRef<Awaited<ReturnType<typeof loadWebnaviorKioskActivityManifest>>>()
const interactionTurn = useKioskInteractionTurn()
const conversationSending = computed(() => (
  interactionTurn.phase.value === 'thinking' || interactionTurn.phase.value === 'using-tool'
))
const conversationActivityStatus = computed(() => {
  if (interactionTurn.phase.value === 'hearing-speech')
    return '正在聆聽…'
  if (interactionTurn.phase.value === 'transcribing')
    return '正在辨識語音…'
  if (interactionTurn.phase.value === 'using-tool')
    return conversationWorkStatus.value ?? '正在確認資訊…'
  if (interactionTurn.phase.value === 'thinking')
    return conversationWorkStatus.value ?? '已收到你的需求，正在處理…'
  if (interactionTurn.phase.value === 'speaking')
    return '正在說明，可直接說話打斷。'
  return undefined
})
const interactionRecording = useKioskInteractionRecording()
const customerSession = useKioskCustomerSession({
  activeCardId,
  chatSession: chatSessionStore,
  endVisitorSession: () => interactionRecording.end('idle'),
  resetConversation: clearConversationPresentation,
})
const performanceSettings = computed(() => kioskPerformanceSettings[props.performanceProfile])
// The constrained profile intentionally cannot start continuous capture. The
// Server still retains the selected policy, but weak kiosk hardware always has
// a local safety ceiling instead of consuming its memory with long recordings.
const effectiveMediaCaptureMode = computed<KioskMediaCaptureMode>(() => (
  props.performanceProfile === 'constrained' && props.mediaCaptureMode === 'continuous'
    ? 'triggered'
    : props.mediaCaptureMode
))
const mediaCapture = useKioskMediaCapture(
  () => interactionRecording.visitorSessionId.value,
  () => performanceSettings.value,
)
const cameraPreviewEnabled = useKioskCameraPreview()
const cameraStream = shallowRef<MediaStream>()
const detectedFaces = shallowRef<Array<{ centre: { x: number, y: number }, facesCamera: boolean }>>([])
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
const proactiveSettings = computed(() => observationSettings(props.deviceSettings ?? defaultDeviceSettingsValues))
const interactiveServices = useKioskInteractiveServices()
watch(interactiveServices, services => scenarioRegistry.setServices(services), { deep: true, immediate: true })
let activityManifestLoadRevision = 0
watch(() => scenarioRegistry.activeScenario.value?.serviceUrl, async (serviceUrl) => {
  const loadRevision = ++activityManifestLoadRevision
  toolActivityManifest.value = undefined
  if (!serviceUrl)
    return

  const manifest = await loadWebnaviorKioskActivityManifest(serviceUrl)
  if (loadRevision === activityManifestLoadRevision)
    toolActivityManifest.value = manifest
}, { immediate: true })
// Agent-originated completion travels in the native WebMCP tool result. Direct
// customer interaction continues to use the iframe lifecycle event registered
// below, so both routes converge on the same session transition.
watch(webMcpAdapter.completionRevision, (revision, previousRevision) => {
  if (revision > previousRevision)
    handleScenarioCompleted()
})
const proactiveCamera = useTemplateRef<HTMLVideoElement>('proactiveCamera')
const initialMicrophonePermission = createKioskStartupPermissionGate()
let releaseChatPendingWork: (() => void) | undefined
let proactiveWindow = createInteractionWindow(proactiveSettings.value.proactiveGreeting)
let assistanceReminderWindow = createAssistanceReminderWindow(proactiveSettings.value.assistanceReminder)
const localObservationRequired = computed(() => needsKioskObservation(
  proactiveSettings.value,
  customerSessionState.value === 'active',
))
const proactiveVision = useKioskProactiveVision({
  detectionEnabled: () => localObservationRequired.value,
  detectionZone: () => proactiveSettings.value.observation.detectionZone,
  performance: () => performanceSettings.value,
  onCameraStream: (stream) => {
    cameraStream.value = stream
    if (!stream)
      detectedFaces.value = []
    mediaCapture.attachCameraStream(stream)
  },
  onFaces: faces => detectedFaces.value = faces,
  onObservation: observation => void handleProactiveObservation(observation),
})
const cameraRequired = computed(() => localObservationRequired.value || effectiveMediaCaptureMode.value !== 'off')
const { x, y } = useMouse()
const cursorPosition = computed(() => ({ x: x.value, y: y.value }))
let assistantAudio: HTMLAudioElement | undefined
let activeVoiceTurn: ReturnType<typeof interactionTurn.begin> | undefined

const { dispose, inferenceError, init, loaded, start } = useVAD(workletUrl, {
  threshold: computed(() => props.voiceVadThreshold),
  onSpeechStart: () => {
    if (!canStartKioskVoiceTurn(interactionTurn.phase.value))
      return

    activeVoiceTurn = interactionTurn.begin('voice', 'hearing-speech')
    if (customerSessionState.value === 'awaiting-idle-confirmation')
      continueCurrentSession()
  },
  onSpeechReady: ({ buffer }) => {
    // VAD emits the ready callback after the recorded utterance. Release this
    // slot before ASR starts; otherwise a later, gated utterance could reuse
    // the old turn and feed its audio into the in-flight ordering request.
    const turn = activeVoiceTurn
    activeVoiceTurn = undefined
    if (turn && interactionTurn.isCurrent(turn))
      void processVadRecording(buffer, turn)
  },
})

const audioInputStarted = shallowRef(false)
const isAudioListening = computed(() => enabled.value && audioInputStarted.value && !inferenceError.value)
const audioInputIndicator = computed(() => {
  if (!isAudioListening.value) {
    return {
      icon: 'i-solar:microphone-slash-bold',
      label: '未收音',
      mode: 'not-listening',
      title: '麥克風未收音',
    }
  }

  if (interactionTurn.phase.value === 'transcribing') {
    return {
      icon: 'i-solar:microphone-3-bold-duotone',
      label: '辨識中',
      mode: 'transcribing',
      title: '正在辨識語音，請稍候。',
    }
  }

  if (interactionTurn.phase.value === 'thinking' || interactionTurn.phase.value === 'using-tool') {
    return {
      icon: 'i-solar:cpu-bolt-bold-duotone',
      label: '處理中',
      mode: 'processing',
      title: '正在處理你的點餐需求，暫時不接收新的語音。',
    }
  }

  if (interactionTurn.phase.value === 'hearing-speech') {
    return {
      icon: 'i-solar:microphone-3-bold',
      label: '正在收音',
      mode: 'hearing-speech',
      title: '正在收音，說完後會自動辨識。',
    }
  }

  return {
    icon: 'i-solar:microphone-3-bold',
    label: '收音中',
    mode: 'listening',
    title: interactionTurn.phase.value === 'speaking'
      ? '正在說明，可直接說話打斷。'
      : '麥克風收音中',
  }
})

async function startAudioInteraction() {
  console.info('[KIOSK AUDIO] startAudioInteraction', {
    enabled: enabled.value,
    hasStream: !!stream.value,
    loaded: loaded.value,
    inferenceError: inferenceError.value,
  })

  audioInputStarted.value = false

  await init()

  console.info('[KIOSK AUDIO] after VAD init', {
    hasStream: !!stream.value,
    loaded: loaded.value,
    inferenceError: inferenceError.value,
  })

  if (stream.value) {
    console.info('[KIOSK AUDIO] starting VAD with stream')

    await start(stream.value)

    audioInputStarted.value = true

    console.info('[KIOSK AUDIO] VAD connected')
  }
  else {
    console.warn('[KIOSK AUDIO] no microphone stream after VAD init')
  }
}

async function processVadRecording(buffer: Float32Array, turn: ReturnType<typeof interactionTurn.begin>) {
  if (buffer.length === 0) {
    if (interactionTurn.isCurrent(turn))
      interactionTurn.complete(turn)
    return
  }

  try {
    if (!interactionTurn.advance(turn, 'transcribing'))
      return

    pendingTranscript.value = '正在辨識你的語音…'
    const recording = createKioskVadRecording(buffer)
    const activity = await recordCustomerActivity('voice_input')
    if (!interactionTurn.isCurrent(turn))
      return

    // Store and transcribe the same VAD-owned WAV so operator evidence has
    // the leading padding that lets ASR hear the first phoneme.
    mediaCapture.saveAudio(recording, activity?.id)
    const { text } = await transcribeKioskAudio(recording, turn.signal)
    if (!interactionTurn.isCurrent(turn))
      return

    if (!text?.trim())
      return

    await interactionRecording.append('asr_transcript', text)
    if (!interactionTurn.isCurrent(turn))
      return

    pendingTranscript.value = undefined
    await sendConversationMessage(text, turn)
  }
  catch (error) {
    if (!turn.signal.aborted)
      console.error('Failed to process kiosk voice input:', error)
  }
  finally {
    if (activeVoiceTurn?.id === turn.id)
      activeVoiceTurn = undefined
    if (interactionTurn.isCurrent(turn)) {
      pendingTranscript.value = undefined
      interactionTurn.complete(turn)
    }
  }
}

function interruptAssistantOutput() {
  assistantAudio?.pause()
  if (assistantAudio)
    URL.revokeObjectURL(assistantAudio.src)
  assistantAudio = undefined
}

function clearConversationPresentation() {
  interactionTurn.cancel()
  interruptAssistantOutput()
  conversationMessages.value = []
  conversationWorkStatus.value = undefined
  pendingTranscript.value = undefined
}

async function speakAssistantReply(text: string, turn: ReturnType<typeof interactionTurn.begin>) {
  interruptAssistantOutput()
  try {
    const audio = await synthesizeKioskSpeech({ locale: language.value, signal: turn.signal, text })
    if (!interactionTurn.isCurrent(turn))
      return

    const player = new Audio(URL.createObjectURL(audio))
    assistantAudio = player
    await new Promise<void>((resolve) => {
      function finish() {
        turn.signal.removeEventListener('abort', stop)
        if (assistantAudio === player)
          assistantAudio = undefined
        URL.revokeObjectURL(player.src)
        resolve()
      }
      function stop() {
        player.pause()
        finish()
      }
      player.onended = finish
      player.onerror = finish
      turn.signal.addEventListener('abort', stop, { once: true })
      void player.play().catch(finish)
    })
  }
  catch (error) {
    if (!turn.signal.aborted)
      console.error('Failed to synthesize kiosk reply:', error)
  }
}

function stopAudioInteraction() {
  dispose()
  audioInputStarted.value = false
}

watch(enabled, async (isEnabled) => {
  if (isEnabled)
    await startAudioInteraction().catch(error => console.error('Failed to start kiosk audio interaction:', error))
  else
    stopAudioInteraction()
}, { immediate: true })

// A published experience chooses exactly one customer input mode. Only the
// voice-only mode requests a microphone, and it does so before optional camera
// work so private browser profiles cannot lose the microphone prompt.
async function prepareMicrophone() {
  if (!props.voiceConversationOnly || enabled.value) {
    initialMicrophonePermission.settle()
    return
  }

  try {
    // `useDevicesList` is deliberately passive during startup. Ask explicitly
    // here so a provisioned kiosk surfaces the browser's microphone prompt
    // before VAD tries to consume the stream.
    await requestMicrophonePermission()
    enabled.value = true
  }
  catch (error) {
    console.error('Kiosk microphone permission was not granted:', error)
  }
  finally {
    // Camera observation is optional. It starts only after the microphone
    // prompt settles, so closing a camera prompt can never block voice input.
    initialMicrophonePermission.settle()
  }
}

watch(() => props.voiceConversationOnly, () => void prepareMicrophone(), { immediate: true })

watch(language, locale => setKioskLocale(locale), { immediate: true })

watch([stream, loaded], async ([audioStream, vadLoaded]) => {
  if (enabled.value && vadLoaded && audioStream) {
    await start(audioStream)
      .then(() => audioInputStarted.value = true)
      .catch((error) => {
        audioInputStarted.value = false
        console.error('Failed to connect kiosk VAD to audio input:', error)
      })
  }
})

watch(proactiveSettings, () => {
  proactiveWindow = createInteractionWindow(proactiveSettings.value.proactiveGreeting)
  assistanceReminderWindow = createAssistanceReminderWindow(proactiveSettings.value.assistanceReminder)
  if (customerSessionState.value === 'active')
    assistanceReminderWindow.start(performance.now())
}, { deep: true })

async function syncProactiveVision() {
  if (!cameraRequired.value) {
    proactiveVision.stop()
    return
  }

  if (proactiveCamera.value)
    await proactiveVision.start(proactiveCamera.value)
}

watch([cameraRequired, localObservationRequired, () => props.deviceSettings], () => {
  // Stop in-flight camera work before applying a remote policy, including a
  // recording downgrade while observation itself remains enabled.
  interactionTurn.cancelProactive()
  mediaCapture.stopContinuousCapture()
  proactiveVision.stop()
  void syncProactiveVision()
})

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
  interactionTurn.cancel()
  interruptAssistantOutput()
  proactiveVision.stop()
  void interactionRecording.end('cancelled')
})

async function handleProactiveObservation(observation: Parameters<typeof proactiveWindow.decide>[0]) {
  if (!localObservationRequired.value)
    return
  if (customerSessionState.value === 'active') {
    if (!interactionTurn.canProactivelySpeak.value)
      return

    const reminderCandidate = assistanceReminderWindow.decide(observation)
    if (!reminderCandidate)
      return

    // Local policy enforces presence and rate limits. The Server owns the
    // Profile prompt, model selection, Provider credentials, and transcript.
    const turn = interactionTurn.begin('proactive', 'thinking')
    const releasePendingWork = customerSession.beginPendingWork()
    try {
      await sendAssistantAction('reminder', undefined, turn)
    }
    finally {
      releasePendingWork()
      assistanceReminderWindow.restartWait(performance.now())
    }
    return
  }

  if (customerSessionState.value !== 'standby' || !interactionTurn.canProactivelySpeak.value)
    return

  const decision = proactiveWindow.decide(observation)
  if (!decision.shouldGreet)
    return
  if (!decision.greetingTrigger)
    return

  const frame = props.proactiveVlmEnabled ? captureProactiveCameraFrame(proactiveCamera.value) : undefined
  if (props.proactiveVlmEnabled && !frame)
    return

  // Claim the proactive slot before asynchronous session setup. Otherwise a
  // customer utterance could start between setup awaits and be superseded by
  // this delayed greeting request.
  const turn = interactionTurn.begin('proactive', 'thinking')
  try {
    // Begin before asking the LLM so another camera frame cannot create a
    // second greeting while the selected provider is still streaming.
    await customerSession.begin()
    if (!interactionTurn.isCurrent(turn))
      return
    await interactionRecording.start(scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction')
    if (!interactionTurn.isCurrent(turn))
      return
    mediaCapture.startSessionCapture(effectiveMediaCaptureMode.value)
    const greetingEvent = await interactionRecording.append('service_event', 'proactive_greeting')
    if (!interactionTurn.isCurrent(turn))
      return
    if (effectiveMediaCaptureMode.value !== 'off')
      mediaCapture.captureInteractionClip(greetingEvent?.id)
    const releasePendingWork = customerSession.beginPendingWork()
    try {
      const delivered = await sendAssistantAction('greeting', frame, turn)
      if (delivered)
        assistanceReminderWindow.start(performance.now())
    }
    finally {
      releasePendingWork()
    }
  }
  catch (error) {
    console.error('[stage-kiosk] failed to create proactive greeting:', error)
  }
  finally {
    if (interactionTurn.isCurrent(turn))
      interactionTurn.complete(turn)
  }
}

async function recordCustomerActivity(source: 'scenario' | 'voice_input' | 'voice_transcript' | 'completed' = 'scenario') {
  await customerSession.recordActivity()
  await interactionRecording.start(scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction')
  mediaCapture.startSessionCapture(effectiveMediaCaptureMode.value)
  const activity = await interactionRecording.append('service_event', 'customer_activity', { source })
  if (effectiveMediaCaptureMode.value !== 'off')
    mediaCapture.captureInteractionClip(activity?.id)
  assistanceReminderWindow.recordActivity(performance.now())
  return activity
}

async function sendAssistantAction(
  kind: 'greeting' | 'reminder',
  capturedFrame?: string,
  existingTurn?: ReturnType<typeof interactionTurn.begin>,
) {
  const serviceId = scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction'
  const frame = props.proactiveVlmEnabled ? capturedFrame ?? captureProactiveCameraFrame(proactiveCamera.value) : undefined
  if (props.proactiveVlmEnabled && !frame) {
    console.warn('[stage-kiosk] skipped proactive assistant action because the camera frame is unavailable')
    return
  }
  const turn = existingTurn ?? interactionTurn.begin('proactive', 'thinking')
  if (!interactionTurn.isCurrent(turn))
    return
  conversationWorkStatus.value = '正在觀察現場…'
  let delivered = false
  try {
    const answer = await interactionRecording.runAssistantAction(serviceId, kind, frame, turn.signal)
    if (!interactionTurn.isCurrent(turn))
      return
    if (answer) {
      conversationMessages.value = [
        ...conversationMessages.value,
        { role: 'assistant', content: answer, slices: [], tool_results: [] },
      ]
      interactionTurn.advance(turn, 'speaking')
      await speakAssistantReply(answer, turn)
      delivered = !turn.signal.aborted
    }
  }
  finally {
    if (interactionTurn.isCurrent(turn)) {
      interactionTurn.complete(turn)
      conversationWorkStatus.value = undefined
    }
  }
  return delivered
}

/**
 * Captures only the frame needed to decide the next proactive line. The image
 * is downscaled before leaving the device so it fits the normal API body cap
 * and is never retained as kiosk media.
 */
function captureProactiveCameraFrame(video: HTMLVideoElement | null) {
  if (!video?.videoWidth || !video.videoHeight)
    return undefined

  const width = Math.min(video.videoWidth, 512)
  const height = Math.max(1, Math.round(video.videoHeight * width / video.videoWidth))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')?.drawImage(video, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', 0.7)
}

async function sendConversationMessage(text: string, existingTurn?: ReturnType<typeof interactionTurn.begin>) {
  const turn = existingTurn ?? interactionTurn.begin('conversation', 'thinking')
  if (!existingTurn && !interactionTurn.isCurrent(turn))
    return
  if (existingTurn && !interactionTurn.advance(turn, 'thinking'))
    return

  conversationMessages.value = [...conversationMessages.value, { role: 'user', content: text }]
  conversationWorkStatus.value = '正在思考…'
  try {
    const answer = await interactionRecording.send(
      scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction',
      text,
      activeTools.value,
      (toolName, state) => {
        if (!interactionTurn.isCurrent(turn))
          return
        interactionTurn.advance(turn, 'using-tool')
        conversationWorkStatus.value = describeToolActivity(toolName, state)
      },
      turn.signal,
    )
    if (!interactionTurn.isCurrent(turn))
      return
    conversationMessages.value = [
      ...conversationMessages.value,
      answer
        ? { role: 'assistant', content: answer, slices: [], tool_results: [] }
        : { role: 'error', content: '暫時無法回覆，請稍後再試。' },
    ]
    if (answer) {
      interactionTurn.advance(turn, 'speaking')
      await speakAssistantReply(answer, turn)
    }
  }
  finally {
    if (interactionTurn.isCurrent(turn)) {
      interactionTurn.complete(turn)
      conversationWorkStatus.value = undefined
    }
  }
}

function describeToolActivity(toolName: string, state: 'executing' | 'done' | 'error') {
  return describeWebnaviorKioskToolActivity(toolActivityManifest.value, toolName, state)
}

async function handleScenarioCompleted(orderResult?: Parameters<typeof interactionRecording.recordOrderResult>[0]) {
  // A direct iframe click may emit `activity` and `completed` back-to-back.
  // Establish the anonymous session here as well so completion cannot outrun
  // the asynchronous activity handler and disappear without a customer screen.
  await recordCustomerActivity('completed')
  await interactionRecording.append('service_event', 'completed')
  if (orderResult)
    await interactionRecording.recordOrderResult(orderResult)
  if (customerSession.completeOrder())
    await interactionRecording.append('service_event', 'feedback_invitation_shown')
}

async function finishCustomerSessionCompletion() {
  await interactionRecording.append('service_event', 'feedback_invitation_dismissed')
  mediaCapture.stopContinuousCapture()
  await interactionRecording.end('completed')
  await customerSession.end('completed')
  conversationMessages.value = []
}

async function startNewCustomerSession() {
  mediaCapture.stopContinuousCapture()
  await interactionRecording.end('idle')
  await resetForNewCustomer()
}

async function restartCustomerSession() {
  if (customerSessionState.value === 'standby')
    return

  // This is an explicit customer reset, not an order completion. It bypasses
  // `completeOrder`, so no thank-you screen or feedback invitation is shown.
  mediaCapture.stopContinuousCapture()
  await interactionRecording.append('service_event', 'customer_requested_restart')
  await interactionRecording.end('idle')
  await customerSession.end('staff')
  conversationMessages.value = []
}

let stopMenuActivityListener: (() => void) | undefined
let stopMenuCompletionListener: (() => void) | undefined

onMounted(() => {
  stopMenuActivityListener = scenarioRegistry.on('activity', () => void recordCustomerActivity('scenario'))
  stopMenuCompletionListener = scenarioRegistry.on('completed', orderResult => void handleScenarioCompleted(orderResult))
  void initialMicrophonePermission.wait().then(syncProactiveVision)
})

onUnmounted(() => {
  initialMicrophonePermission.settle()
  releaseChatPendingWork?.()
  stopMenuActivityListener?.()
  stopMenuCompletionListener?.()
  mediaCapture.stopContinuousCapture()
})
</script>

<template>
  <main :class="['kiosk-scene', `is-${orientation}`]">
    <output
      class="audio-listening-indicator"
      :class="[`is-${audioInputIndicator.mode}`]"
      :aria-label="audioInputIndicator.title"
      :title="audioInputIndicator.title"
    >
      <span :class="[audioInputIndicator.icon, 'h-4 w-4']" aria-hidden="true" />
      <span class="audio-listening-label">{{ audioInputIndicator.label }}</span>
    </output>
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
        :thinking="conversationSending"
      />
    </section>

    <ScenarioSurface class="menu-region" />

    <button
      v-if="customerSessionState === 'active'"
      type="button"
      class="customer-restart"
      :disabled="conversationSending"
      @click="restartCustomerSession"
    >
      <span class="i-solar:restart-bold h-4 w-4" aria-hidden="true" />
      重新開始／新訂單
    </button>

    <KioskConversation
      class="conversation-region"
      :activity-status="conversationActivityStatus"
      :messages="conversationMessages"
      :pending-transcript="pendingTranscript"
      :sending="conversationSending"
      :voice-input-locked="interactionTurn.phase === 'transcribing' || conversationSending"
      :voice-conversation-only="props.voiceConversationOnly"
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
    <KioskCameraPreview v-if="cameraPreviewEnabled && cameraStream" :faces="detectedFaces" :stream="cameraStream" :zone="proactiveSettings.observation.detectionZone" />
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
.audio-listening-indicator { position: fixed; z-index: 20; top: 1.15rem; right: 1.15rem; display: inline-flex; align-items: center; gap: .4rem; border: 1px solid; border-radius: 999px; padding: .45rem .7rem; color: #fff; font-size: .75rem; font-weight: 700; transition: color .2s ease, background .2s ease, border-color .2s ease; }
.audio-listening-indicator.is-listening, .audio-listening-indicator.is-hearing-speech { border-color: rgb(74 222 128 / 70%); background: rgb(20 83 45 / 88%); box-shadow: 0 0 .9rem rgb(74 222 128 / 36%); }
.audio-listening-indicator.is-transcribing { border-color: rgb(250 204 21 / 76%); background: rgb(113 63 18 / 91%); box-shadow: 0 0 .9rem rgb(250 204 21 / 34%); }
.audio-listening-indicator.is-processing { border-color: rgb(103 232 249 / 76%); background: rgb(8 47 73 / 91%); box-shadow: 0 0 .9rem rgb(103 232 249 / 34%); }
.audio-listening-indicator.is-not-listening { border-color: rgb(248 113 113 / 70%); background: rgb(127 29 29 / 88%); box-shadow: 0 0 .9rem rgb(248 113 113 / 30%); }
.audio-listening-indicator.is-listening > :first-child, .audio-listening-indicator.is-hearing-speech > :first-child, .audio-listening-indicator.is-transcribing > :first-child, .audio-listening-indicator.is-processing > :first-child { animation: audio-listening-pulse 1.2s ease-in-out infinite; }
@keyframes audio-listening-pulse { 50% { opacity: .45; transform: scale(.82); } }
.customer-restart { position: fixed; z-index: 20; bottom: 1.15rem; left: 1.15rem; display: inline-flex; align-items: center; gap: .45rem; border: 1px solid rgb(207 250 254 / 48%); border-radius: .7rem; padding: .6rem .8rem; color: #ecfeff; background: rgb(8 47 73 / 90%); font-size: .8rem; font-weight: 700; box-shadow: 0 .35rem 1rem rgb(0 0 0 / 28%); transition: background .16s ease, opacity .16s ease; }.customer-restart:hover:not(:disabled) { background: rgb(14 116 144 / 94%); }.customer-restart:disabled { cursor: wait; opacity: .55; }

@media (max-width: 700px) {
  .kiosk-scene { padding: .6rem; gap: .6rem; }
  .kiosk-scene.is-landscape { grid-template-columns: minmax(7rem, .25fr) minmax(0, .75fr); }
}
</style>
