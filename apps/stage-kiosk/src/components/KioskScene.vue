<script setup lang="ts">
import type { DeviceSettingsValues, KioskVoiceVadSettings, PresenceCandidate } from '@proj-airi/kiosk-proactive'
import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import type { KioskConversationDecisionState, KioskDevice, KioskMediaCaptureMode, KioskPerformanceProfile } from '../services/kiosk-device'
import type { KioskUtterance, KioskUtteranceReservation, KioskUtteranceTicket } from '../services/kioskUtteranceQueue'
import type { KioskAssistantPresenceMode } from './KioskAssistantPresence.vue'
import type { KioskDecisionEntry } from './KioskDecisionInspector.vue'
import type { KioskVoiceDiagnosticEntry } from './KioskVoiceDiagnostics.vue'

import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { createAssistanceReminderWindow, createInteractionWindow, createPresenceWindow, defaultDeviceSettingsValues, defaultPresenceSettings, observationSettings } from '@proj-airi/kiosk-proactive'
import { CustomerSessionCompletion, CustomerSessionIdleConfirmation } from '@proj-airi/stage-ui/components'
import { DeviceSettingsPanel } from '@proj-airi/stage-ui/components/scenarios/kiosk/deviceSettings'
import { WidgetStage } from '@proj-airi/stage-ui/components/scenes'
import { useVAD } from '@proj-airi/stage-ui/stores/ai/models/vad'
import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useLlmToolsStore } from '@proj-airi/stage-ui/stores/llm-tools'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { useMouse, useWindowSize } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import KioskAdminAccess from './KioskAdminAccess.vue'
import KioskAdminPanel from './KioskAdminPanel.vue'
import KioskAssistantThoughtBubble from './KioskAssistantThoughtBubble.vue'
import KioskAudioStatusOverlay from './KioskAudioStatusOverlay.vue'
import KioskCameraPreview from './KioskCameraPreview.vue'
import KioskConversation from './KioskConversation.vue'
import KioskDecisionInspector from './KioskDecisionInspector.vue'
import KioskIdleDiagnostics from './KioskIdleDiagnostics.vue'
import KioskPresenceDiagnostics from './KioskPresenceDiagnostics.vue'
import KioskSessionNotice from './KioskSessionNotice.vue'
import KioskVoiceDiagnostics from './KioskVoiceDiagnostics.vue'
import ScenarioSurface from './ScenarioSurface.vue'

import { useFeedbackInvitationSettings } from '../composables/useFeedbackInvitationSettings'
import { useKioskAudioStatusPosition } from '../composables/useKioskAudioStatusPosition'
import { useKioskCameraPreview } from '../composables/useKioskCameraPreview'
import { useKioskConversationFontSize } from '../composables/useKioskConversationFontSize'
import { useKioskConversationProgress } from '../composables/useKioskConversationProgress'
import { useKioskCustomerSession } from '../composables/useKioskCustomerSession'
import { useKioskInteractionRecording } from '../composables/useKioskInteractionRecording'
import { useKioskInteractionTurn } from '../composables/useKioskInteractionTurn'
import { useKioskInteractiveServices } from '../composables/useKioskInteractiveServices'
import { useKioskMediaCapture } from '../composables/useKioskMediaCapture'
import { needsKioskObservation } from '../composables/useKioskProactiveSettings'
import { useKioskProactiveVision } from '../composables/useKioskProactiveVision'
import { setKioskLocale } from '../modules/i18n'
import { createKioskVadRecording } from '../services/kiosk-audio'
import { decideKioskInteraction, synthesizeKioskSpeech, transcribeKioskAudio } from '../services/kiosk-device'
import { conversationDecisionStateFrom, createIncompleteAsrSession, runFastPath } from '../services/kiosk-fast-path'
import { kioskPerformanceSettings } from '../services/kiosk-performance'
import { createKioskStartupPermissionGate, prepareKioskMicrophonePermission } from '../services/kiosk-startup-permission-gate'
import { isKioskConversationRetrySafeTool } from '../services/kioskConversationRetry'
import { createKioskUtteranceQueue } from '../services/kioskUtteranceQueue'
import { scenarioRegistry } from '../services/scenario-registry'
import { webMcpAdapter } from '../services/webmcp-adapter'
import { describeWebnaviorKioskToolActivity, loadWebnaviorKioskActivityManifest } from '../services/webnaviorKioskActivity'

type KioskOrientation = 'landscape' | 'portrait'
type KioskMotionName = 'acknowledge' | 'greeting' | 'idle' | 'listening' | 'presentRecommendations' | 'thinking'

interface FastPathInput {
  id?: number
  recording?: Blob
  source: 'asr' | 'simulation'
  text: string
}

const props = defineProps<{
  device?: KioskDevice
  deviceSettings?: DeviceSettingsValues
  idleAnimation?: string
  motionAnimations?: Partial<Record<KioskMotionName, string>>
  sceneBackgroundUrl?: string
  mediaCaptureMode: KioskMediaCaptureMode
  performanceProfile: KioskPerformanceProfile
  proactiveVlmEnabled: boolean
  voiceConversationOnly: boolean
  voiceVadSettings: KioskVoiceVadSettings
}>()
const emit = defineEmits<{ deviceSettingsUpdated: [] }>()

const conversationLongWaitMs = 5_000
const asrSimulationStatus = shallowRef<string>()
const asrSimulationTrace = shallowRef<string>()
const decisionEntries = shallowRef<KioskDecisionEntry[]>([])
const incompleteAsrSession = createIncompleteAsrSession()

const route = useRoute()
const router = useRouter()
const adminPanelOpen = computed(() => route.query.admin === 'true')
const deviceSettingsEndpoint = new URL('/api/kiosk/settings', import.meta.env.VITE_API_SERVER_URL ?? 'http://localhost:5168').href

const configuredOrientation = import.meta.env.VITE_KIOSK_ORIENTATION as KioskOrientation | undefined
const { width, height } = useWindowSize()
const orientation = computed<KioskOrientation>(() => configuredOrientation ?? (width.value >= height.value ? 'landscape' : 'portrait'))
const paused = shallowRef(false)

const settingsAudioDeviceStore = useSettingsAudioDevice()
const { language } = storeToRefs(useSettings())
const { enabled, stream } = storeToRefs(settingsAudioDeviceStore)
const { askPermission: requestMicrophonePermission } = settingsAudioDeviceStore
const chatSessionStore = useChatSessionStore()
const { audioContext } = useAudioContext()
const assistantAudioNode = shallowRef<AudioNode>()
const { activeTools } = storeToRefs(useLlmToolsStore())
const { activeCardId } = storeToRefs(useAiriCardStore())
const conversationMessages = shallowRef<ChatHistoryItem[]>([])
const conversationWorkStatus = shallowRef<string>()
const conversationActivitySteps = shallowRef<Array<{ label: string, state: 'done' | 'error' | 'executing' | 'selected', toolName: string }>>([])
const conversationExecutionDurationMs = shallowRef<number>()
const retryableConversationRequest = shallowRef<string>()
const {
  extendWait: extendConversationProgressWait,
  finish: finishConversationProgress,
  progress: conversationProgress,
  selectTool: selectConversationProgressTool,
  start: startConversationProgress,
} = useKioskConversationProgress()
const streamingAssistantMessage = shallowRef<ChatHistoryItem>()
const pendingTranscript = shallowRef<string>()
const customerResetError = shallowRef<string>()
const voiceDiagnosticEntries = shallowRef<KioskVoiceDiagnosticEntry[]>([])
let nextVoiceDiagnosticId = 0
const voiceDiagnosticByUtterance = new Map<number, number>()
const toolActivityManifest = shallowRef<Awaited<ReturnType<typeof loadWebnaviorKioskActivityManifest>>>()
const interactionTurn = useKioskInteractionTurn()
interface ActiveAgentRequest {
  decisionEntryId?: number
  done: Promise<void>
  ready: Promise<void>
  resolveDone: () => void
  resolveReady: () => void
  stage: 'starting' | 'thinking' | 'tool_requested' | 'mutating'
  text: string
  turn: ReturnType<typeof interactionTurn.begin>
}
let activeAgentRequest: ActiveAgentRequest | undefined
function currentAgentRequest() {
  return activeAgentRequest && interactionTurn.isCurrent(activeAgentRequest.turn) ? activeAgentRequest : undefined
}
const utteranceQueueState = shallowRef<{ active?: KioskUtterance, pending: readonly KioskUtterance[] }>({ pending: [] })
const utteranceQueue = createKioskUtteranceQueue({
  onDrop: (utterance, reason) => {
    finishVoiceDiagnostic(utterance.id, 'failed')
    if (utterance.source === 'simulation')
      asrSimulationStatus.value = reason === 'expired' ? '這句等待太久，未執行；請重新送出。' : '會話已重設，待處理語句已取消。'
    else if (reason === 'expired')
      pendingTranscript.value = '剛才語句等待太久，請再說一次。'
  },
  onError: (utterance, error) => {
    finishVoiceDiagnostic(utterance.id, 'failed')
    console.error('Failed to process kiosk utterance:', error)
    if (utterance.source === 'simulation')
      asrSimulationStatus.value = '無法確認這句是否已操作成功，請先查看購物車或訂單，不要直接重試。'
    else
      pendingTranscript.value = '無法確認操作結果，請先查看購物車或訂單。'
  },
  onState: state => utteranceQueueState.value = state,
  process: processKioskUtterance,
})
function updateDecisionEntry(id: number, patch: Partial<KioskDecisionEntry>) {
  decisionEntries.value = decisionEntries.value.map(entry => entry.id === id ? { ...entry, ...patch } : entry)
}
function finishVoiceDiagnostic(utteranceId: number, status: KioskVoiceDiagnosticEntry['status']) {
  const diagnosticId = voiceDiagnosticByUtterance.get(utteranceId)
  if (diagnosticId === undefined)
    return
  updateVoiceDiagnostic(diagnosticId, { status })
  voiceDiagnosticByUtterance.delete(utteranceId)
}
const transientMotion = shallowRef<'acknowledge' | 'greeting' | 'presentRecommendations'>()
let transientMotionTimer: ReturnType<typeof setTimeout> | undefined
const conversationSending = computed(() => (
  interactionTurn.phase.value === 'thinking' || interactionTurn.phase.value === 'using-tool'
))
const activeMotionAnimation = computed(() => {
  if (transientMotion.value)
    return props.motionAnimations?.[transientMotion.value] ?? props.motionAnimations?.idle ?? props.idleAnimation
  if (interactionTurn.phase.value === 'hearing-speech')
    return props.motionAnimations?.listening ?? props.idleAnimation
  if (interactionTurn.phase.value === 'transcribing' || conversationSending.value)
    return props.motionAnimations?.thinking ?? props.idleAnimation
  return props.motionAnimations?.idle ?? props.idleAnimation
})
const activeMotionLoop = computed(() => !transientMotion.value)
const voiceDiagnosticsEnabled = computed(() => Boolean(props.deviceSettings?.voiceDiagnosticsEnabled))
const conversationDiagnosticsEnabled = computed(() => Boolean(props.deviceSettings?.conversationDiagnosticsEnabled))
const stageBackgroundStyle = computed(() => props.sceneBackgroundUrl
  ? { backgroundImage: `linear-gradient(180deg, rgb(4 16 18 / 14%), rgb(3 12 14 / 52%)), url("${props.sceneBackgroundUrl}")` }
  : undefined,
)

watch(conversationDiagnosticsEnabled, (enabled) => {
  if (!enabled)
    conversationExecutionDurationMs.value = undefined
})

function playTransientMotion(name: 'acknowledge' | 'greeting' | 'presentRecommendations') {
  if (!props.motionAnimations?.[name])
    return
  transientMotion.value = name
  if (transientMotionTimer)
    clearTimeout(transientMotionTimer)
  transientMotionTimer = setTimeout(() => {
    transientMotion.value = undefined
    transientMotionTimer = undefined
  }, 1800)
}

function startVoiceDiagnostic() {
  const id = ++nextVoiceDiagnosticId
  if (!voiceDiagnosticsEnabled.value)
    return id
  const entry: KioskVoiceDiagnosticEntry = { id, status: 'recognizing' }
  voiceDiagnosticEntries.value = [
    ...voiceDiagnosticEntries.value,
    entry,
  ].slice(-8)
  return id
}

function updateVoiceDiagnostic(id: number, patch: Omit<Partial<KioskVoiceDiagnosticEntry>, 'id'>) {
  if (!voiceDiagnosticsEnabled.value)
    return
  voiceDiagnosticEntries.value = voiceDiagnosticEntries.value.map(entry => entry.id === id ? { ...entry, ...patch } : entry)
}
const assistantOutputInterruptible = computed(() => interactionTurn.phase.value === 'speaking')
const assistantPresence = computed<{ description: string, mode: KioskAssistantPresenceMode, title: string }>(() => {
  if (interactionTurn.phase.value === 'hearing-speech') {
    return {
      description: '你說完後，我會接著協助你。',
      mode: 'hearing-speech',
      title: '我正在聽',
    }
  }
  if (interactionTurn.phase.value === 'transcribing') {
    return {
      description: '正在整理你剛剛說的內容。',
      mode: 'transcribing',
      title: '讓我確認一下',
    }
  }
  if (interactionTurn.phase.value === 'thinking' || interactionTurn.phase.value === 'using-tool') {
    return {
      description: '我正在幫你確認菜單與點餐內容。',
      mode: 'processing',
      title: '正在幫你安排',
    }
  }
  if (interactionTurn.phase.value === 'speaking') {
    return {
      description: '想換個選擇時，直接說出來就可以。',
      mode: 'speaking',
      title: '我正在說明',
    }
  }
  return {
    description: '也可以直接點選下方菜單。',
    mode: 'listening',
    title: '直接告訴我想吃什麼',
  }
})
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
const audioStatusPosition = useKioskAudioStatusPosition()
const conversationFontSize = useKioskConversationFontSize()
const cameraStream = shallowRef<MediaStream>()
const {
  continueCurrentSession,
  end: endCustomerSession,
  hasCustomerActivity,
  hasPendingWork,
  idleDeadlineAt,
  notice,
  startNewCustomerSession: resetForNewCustomer,
  state: customerSessionState,
} = customerSession
const sessionNotice = computed(() => customerResetError.value ?? notice.value)
const customerSessionButtonLabel = computed(() => (
  customerSessionState.value === 'standby' ? '開始新交談／新訂單' : '重新開始／新訂單'
))
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
const presenceSettings = {
  ...defaultPresenceSettings,
  greetingRoi: proactiveSettings.value.observation.detectionZone,
}
let presenceWindow = createPresenceWindow(presenceSettings, proactiveSettings.value.proactiveGreeting)
const presenceDecision = shallowRef<ReturnType<typeof presenceWindow.decide>>()
const lastPresenceCandidate = shallowRef<Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'>>()
let visualEngagementProtectionStartedAtMs: number | undefined
const presenceDiagnostics = shallowRef<{ cadenceTier: 'idle' | 'boost' | 'stable', faceActive: boolean, poseIntervalMs: number }>({ cadenceTier: 'idle', faceActive: false, poseIntervalMs: performanceSettings.value.detectionIntervalMs })
const localObservationRequired = computed(() => {
  const hasActiveSession = customerSessionState.value === 'active'
  // Once observation is explicitly enabled, an active session keeps the local
  // presence policy running even when greetings and reminders are disabled.
  // Otherwise ENGAGED could never release or restore the idle timer.
  return proactiveSettings.value.observation.enabled && (
    hasActiveSession || needsKioskObservation(proactiveSettings.value, hasActiveSession)
  )
})
const presenceIdleProtection = computed(() => {
  const decision = presenceDecision.value
  if (customerSessionState.value !== 'active' || !decision?.idleSuppressed)
    return undefined
  if (hasCustomerActivity.value)
    return { reason: 'customer-activity' as const }
  if (decision.state !== 'ENGAGED')
    return { reason: 'visual-engagement' as const }

  const startedAtMs = visualEngagementProtectionStartedAtMs
  const until = startedAtMs == null ? undefined : startedAtMs + presenceSettings.visualEngagedIdleProtectionMs
  if (until != null && Date.now() >= until)
    return undefined
  return { reason: 'visual-engagement' as const, until }
})
const proactiveVision = useKioskProactiveVision({
  detectionConfidence: () => props.deviceSettings?.faceDetectionConfidence ?? defaultDeviceSettingsValues.faceDetectionConfidence,
  detectionEnabled: () => localObservationRequired.value,
  detectionZone: () => proactiveSettings.value.observation.detectionZone,
  performance: () => performanceSettings.value,
  visionMode: () => props.deviceSettings?.presenceVisionMode ?? defaultDeviceSettingsValues.presenceVisionMode,
  shouldRunFace: () => {
    const mode = props.deviceSettings?.presenceVisionMode ?? defaultDeviceSettingsValues.presenceVisionMode
    const candidate = presenceDecision.value?.candidate
    return mode === 'pose_plus_conditional_face'
      && (proactiveSettings.value.proactiveGreeting.triggerMode === 'attention' || proactiveSettings.value.proactiveGreeting.triggerMode === 'mixed')
      && Boolean(candidate?.greetingRoiHit || candidate?.interactionRoiHit)
  },
  onCameraStream: (stream) => {
    cameraStream.value = stream
    mediaCapture.attachCameraStream(stream)
  },
  onObservation: observation => void handleProactiveObservation(observation),
  onPresenceCandidate: candidate => handlePresenceCandidate(candidate),
  onDiagnostics: diagnostics => presenceDiagnostics.value = diagnostics,
})
const cameraRequired = computed(() => localObservationRequired.value || effectiveMediaCaptureMode.value !== 'off')
const { x, y } = useMouse()
const cursorPosition = computed(() => ({ x: x.value, y: y.value }))
let assistantAudio: HTMLAudioElement | undefined
let activeVoiceCandidate: ReturnType<typeof interactionTurn.beginCustomerVoiceCandidate> | undefined

const { dispose, inferenceError, init, loaded, start } = useVAD(workletUrl, {
  threshold: computed(() => props.voiceVadSettings.threshold),
  minSpeechDurationMs: computed(() => props.voiceVadSettings.minSpeechDurationMs),
  maxSpeechDurationS: computed(() => props.voiceVadSettings.maxSpeechDurationS),
  minSilenceDurationMs: computed(() => props.voiceVadSettings.minSilenceDurationMs),
  speechPadMs: computed(() => props.voiceVadSettings.speechPadMs),
  onSpeechStart: () => {
    // Capture first; even audible output remains intact until Jev decides
    // that the speech is addressed to this kiosk rather than background talk.
    activeVoiceCandidate = interactionTurn.beginCustomerVoiceCandidate()
  },
  onSpeechReady: ({ buffer }) => {
    // Release this capture slot before ASR so another final utterance can be
    // transcribed independently while the first is waiting for a decision.
    const candidate = activeVoiceCandidate
    activeVoiceCandidate = undefined
    if (!candidate)
      return
    const reservation = utteranceQueue.reserve('asr')
    if (reservation.kind === 'OVERLOADED') {
      interactionTurn.completeVoiceCandidate(candidate)
      pendingTranscript.value = '目前語句太多，請稍後再說一次。'
      return
    }
    void processVoiceCandidate(buffer, candidate, reservation)
  },
})

const audioInputStarted = shallowRef(false)
const isAudioListening = computed(() => enabled.value && audioInputStarted.value && !inferenceError.value)
const audioInputIndicator = computed(() => {
  // A customer-facing operation always wins over background observation. This
  // keeps the floating indicator useful while speech or a reply is in flight.
  if (interactionTurn.phase.value === 'transcribing') {
    return {
      icon: 'i-solar:microphone-3-bold-duotone',
      label: '系統正在辨識',
      mode: 'transcribing',
      title: '正在辨識語音，請稍候。',
    }
  }

  if (interactionTurn.phase.value === 'thinking' || interactionTurn.phase.value === 'using-tool') {
    return {
      icon: 'i-solar:cpu-bolt-bold-duotone',
      label: '系統處理中，也持續收音',
      mode: 'processing',
      title: '正在處理你的點餐需求；若你繼續說話，系統會先判斷是否需要中斷或更新目前工作。',
    }
  }

  if (interactionTurn.phase.value === 'hearing-speech') {
    return {
      icon: 'i-solar:microphone-3-bold',
      label: '系統正在收音',
      mode: 'hearing-speech',
      title: '正在收音，說完後會自動辨識。',
    }
  }

  if (interactionTurn.phase.value === 'speaking') {
    return {
      icon: 'i-solar:volume-loud-bold-duotone',
      hint: '直接說話即可打斷',
      label: '系統正在說明',
      mode: 'speaking',
      title: '系統正在說明回覆內容',
    }
  }

  if (cameraRequired.value && proactiveVision.status.value === 'starting') {
    return {
      icon: 'i-solar:camera-rotate-bold-duotone',
      label: '系統正在啟動偵測',
      mode: 'starting-detection',
      title: '正在啟動相機與人員偵測。',
    }
  }

  if (cameraRequired.value && proactiveVision.status.value === 'observing') {
    return {
      icon: 'i-solar:radar-2-bold-duotone',
      label: '系統正在偵測',
      mode: 'detecting',
      title: '正在本機偵測偵測區內的人員。',
    }
  }

  if (!isAudioListening.value) {
    return {
      icon: 'i-solar:microphone-slash-bold',
      label: '系統未收音',
      mode: 'not-listening',
      title: '麥克風未收音',
    }
  }

  return {
    icon: 'i-solar:microphone-3-bold',
    label: '系統正在傾聽',
    mode: 'listening',
    title: '麥克風正在傾聽，直接說話即可開始。',
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

async function processVoiceCandidate(
  buffer: Float32Array,
  candidate: NonNullable<ReturnType<typeof interactionTurn.beginCustomerVoiceCandidate>>,
  reservation: Extract<KioskUtteranceReservation, { kind: 'ACCEPTED' }>,
) {
  if (buffer.length === 0) {
    reservation.cancel()
    interactionTurn.completeVoiceCandidate(candidate)
    return
  }
  const diagnosticId = startVoiceDiagnostic()
  voiceDiagnosticByUtterance.set(reservation.id, diagnosticId)
  let submitted = false
  try {
    const recording = createKioskVadRecording(buffer)
    const { text } = await transcribeKioskAudio(recording, candidate.signal)
    if (!text.trim()) {
      updateVoiceDiagnostic(diagnosticId, { status: 'unrecognized' })
      return
    }
    updateVoiceDiagnostic(diagnosticId, { status: 'recognized', text })
    if (!interactionTurn.isCurrentVoiceCandidate(candidate))
      return
    reservation.complete({ recording, text })
    submitted = true
    pendingTranscript.value = undefined
  }
  catch (error) {
    updateVoiceDiagnostic(diagnosticId, { status: 'failed' })
    if (!candidate.signal.aborted)
      console.error('Failed to process kiosk voice candidate:', error)
  }
  finally {
    reservation.cancel()
    if (!submitted)
      voiceDiagnosticByUtterance.delete(reservation.id)
    interactionTurn.completeVoiceCandidate(candidate)
  }
}

/** One final ASR utterance enters the same decision path in live and test mode. */
async function processKioskUtterance(utterance: KioskUtterance, ticket: KioskUtteranceTicket) {
  const input: FastPathInput = utterance
  const entry: KioskDecisionEntry = {
    id: utterance.id,
    route: 'deciding',
    source: utterance.source,
    startedAt: utterance.capturedAt,
    transcript: utterance.text,
  }
  decisionEntries.value = [...decisionEntries.value, entry].slice(-20)
  for (let attempt = 0; attempt < 3 && ticket.isCurrent(); attempt++) {
    const active = currentAgentRequest()
    let selectedTurn: ReturnType<typeof interactionTurn.begin> | undefined
    const result = await runFastPath({
      activeRequest: active ? { stage: active.stage, text: active.text.slice(0, 240) } : undefined,
      decide: decideKioskInteraction,
      isCurrent: ticket.isCurrent,
      onActionSelected: async () => {
        const request = currentAgentRequest()
        if (request) {
          if (request.stage !== 'thinking')
            return 'DEFER'
          // No browser tool has been requested. Its user turn is already
          // stored by /messages, so the new Agent request sees both turns.
          if (request.decisionEntryId !== undefined)
            updateDecisionEntry(request.decisionEntryId, { agentStep: '因顧客新語句中斷' })
          interactionTurn.cancelActiveTurn()
          await request.done
        }
        if (!ticket.isCurrent())
          return 'DEFER'
        interruptAssistantOutput()
        selectedTurn = interactionTurn.begin('voice', 'thinking')
      },
      onTrace: (trace) => {
        const context = trace.browserContext && typeof trace.browserContext === 'object' ? trace.browserContext as Record<string, unknown> : {}
        const rawCandidates = Array.isArray(context.candidates) ? context.candidates : []
        const rawReferences = Array.isArray(context.references) ? context.references : []
        const execution = trace.executionResult && typeof trace.executionResult === 'object' ? trace.executionResult as Record<string, unknown> : {}
        const decisionTrace = execution.decisionTrace && typeof execution.decisionTrace === 'object' ? execution.decisionTrace as Record<string, unknown> : {}
        const operation = decisionTrace.operationPlan && typeof decisionTrace.operationPlan === 'object' ? decisionTrace.operationPlan as Record<string, unknown> : {}
        const authorization = decisionTrace.authorize && typeof decisionTrace.authorize === 'object' ? decisionTrace.authorize as Record<string, unknown> : {}
        updateDecisionEntry(utterance.id, {
          phase: typeof context.phase === 'string' ? context.phase : undefined,
          references: rawReferences.flatMap((reference: unknown) => reference && typeof reference === 'object' && typeof (reference as Record<string, unknown>).label === 'string' ? [(reference as Record<string, string>).label] : []),
          candidates: rawCandidates.flatMap((candidate: unknown) => candidate && typeof candidate === 'object' && typeof (candidate as Record<string, unknown>).description === 'string' ? [(candidate as Record<string, string>).description] : []),
          decision: trace.decision.kind,
          confidence: 'confidence' in trace.decision ? trace.decision.confidence : undefined,
          operation: typeof operation.toolName === 'string' ? operation.toolName : undefined,
          authorization: typeof authorization.kind === 'string' ? authorization.kind : undefined,
        })
        if (utterance.source === 'simulation')
          asrSimulationTrace.value = JSON.stringify(trace, null, 2)
      },
      presenceState: presenceDecision.value?.state,
      session: incompleteAsrSession,
      transcript: utterance.text,
      webMcp: { execute: webMcpAdapter.execute, tools: webMcpAdapter.tools.value },
    })
    if (!ticket.isCurrent())
      return

    if (result.kind === 'DEFERRED') {
      updateDecisionEntry(utterance.id, { route: 'deferred' })
      const request = currentAgentRequest()
      if (request)
        await (request.stage === 'starting' ? request.ready : request.done)
      continue
    }
    if (result.kind === 'IGNORE' || result.kind === 'INCOMPLETE' || result.kind === 'UNAVAILABLE') {
      finishVoiceDiagnostic(utterance.id, result.kind === 'UNAVAILABLE' ? 'failed' : 'decided')
      updateDecisionEntry(utterance.id, { route: result.kind === 'IGNORE' ? 'ignored' : result.kind === 'INCOMPLETE' ? 'incomplete' : 'unavailable' })
      if (result.kind === 'UNAVAILABLE' && utterance.source === 'asr')
        pendingTranscript.value = '暫時無法判斷，請再說一次或使用螢幕操作。'
      if (utterance.source === 'simulation') {
        asrSimulationStatus.value = result.kind === 'IGNORE'
          ? 'System One：背景或無關語句，未執行。'
          : result.kind === 'INCOMPLETE'
            ? 'System One：語句尚未完成，等待下一句。'
            : 'System One 暫時無法判斷，未執行，也未送往 AI 助手。'
      }
      return
    }

    if (result.kind === 'FOLLOW_UP_ACTIVE') {
      const request = currentAgentRequest()
      if (!request)
        continue
      if (request.stage === 'starting') {
        await request.ready
        continue
      }
      if (request.stage !== 'thinking') {
        await request.done
        continue
      }
      if (request.decisionEntryId !== undefined)
        updateDecisionEntry(request.decisionEntryId, { agentStep: '因顧客補充而重啟' })
      interactionTurn.cancelActiveTurn()
      await request.done
      if (!ticket.isCurrent())
        return
      interruptAssistantOutput()
      const turn = interactionTurn.begin('conversation', 'thinking')
      updateDecisionEntry(utterance.id, { route: 'main_agent' })
      if (utterance.source === 'simulation')
        asrSimulationStatus.value = 'System One：相關補充已中斷尚未操作工具的 AI 回合，正在重新處理。'
      void persistAssistantEscalation(input)
      void sendConversationMessage(utterance.text, turn, { decisionEntryId: utterance.id, decisionState: conversationDecisionStateFrom(result.decisionState) })
        .catch(error => console.error('Failed to restart Main Agent with kiosk follow-up:', error))
      finishVoiceDiagnostic(utterance.id, 'decided')
      return
    }

    const request = currentAgentRequest()
    if (request && !selectedTurn) {
      // An unrelated request cannot steal or race the existing Agent turn.
      // Re-read browser state after it finishes, especially around checkout.
      await request.done
      continue
    }
    if (!selectedTurn)
      interruptAssistantOutput()
    const turn = selectedTurn ?? interactionTurn.begin('voice', 'thinking')
    updateDecisionEntry(utterance.id, { route: result.kind === 'FAST_ACTION' ? 'fast_path' : result.kind === 'CLARIFICATION' ? 'clarification' : 'main_agent' })
    if (utterance.source === 'simulation') {
      asrSimulationStatus.value = result.kind === 'FAST_ACTION'
        ? `System One 已執行：${result.action.id}。`
        : result.kind === 'CLARIFICATION'
          ? `System One：${result.prompt}`
          : 'System One：需要 AI 助手，已轉交處理。'
    }
    // Persist and show the completed browser action before dequeuing another
    // utterance. Only TTS/Agent streaming continues asynchronously afterward.
    let spokenReply: string | undefined
    try {
      spokenReply = await presentFastPathResult(input, result, turn)
    }
    catch (error) {
      if (interactionTurn.isCurrent(turn))
        interactionTurn.complete(turn)
      throw error
    }
    if (spokenReply && interactionTurn.advance(turn, 'speaking')) {
      void speakAssistantReply(spokenReply, turn).finally(() => {
        if (interactionTurn.isCurrent(turn))
          interactionTurn.complete(turn)
      })
    }
    else if (result.kind !== 'NEEDS_ASSISTANT' && interactionTurn.isCurrent(turn)) {
      interactionTurn.complete(turn)
    }
    finishVoiceDiagnostic(utterance.id, 'decided')
    return
  }
  if (utterance.source === 'simulation')
    asrSimulationStatus.value = '目前仍有操作在進行，這句未執行；請稍後重試。'
  updateDecisionEntry(utterance.id, { route: 'deferred' })
  finishVoiceDiagnostic(utterance.id, 'failed')
}

async function presentFastPathResult(
  input: FastPathInput,
  result: Awaited<ReturnType<typeof runFastPath>>,
  turn: ReturnType<typeof interactionTurn.begin>,
) {
  if (!interactionTurn.isCurrent(turn))
    return

  if (result.kind === 'FAST_ACTION') {
    const activity = await recordCustomerActivity(input.source === 'asr' ? 'voice_input' : 'asr_simulation')
    if (!interactionTurn.isCurrent(turn))
      return
    if (input.recording) {
      mediaCapture.saveAudio(input.recording, activity?.id)
    }
    await interactionRecording.append('asr_transcript', input.text, { decisionRoute: 'fast_path', source: input.source })
    if (!interactionTurn.isCurrent(turn))
      return
    const answer = customerMessageFrom(result.result) ?? '已完成你剛剛指定的操作。'
    conversationMessages.value = [
      ...conversationMessages.value,
      { role: 'user', content: input.text },
      { role: 'assistant', content: answer, slices: [], tool_results: [] },
    ]
    await interactionRecording.append('assistant_text', answer, { decisionRoute: 'fast_path' })
    if (result.result && typeof result.result === 'object') {
      const payload = result.result as Record<string, unknown>
      const trace = payload.decisionTrace as { authorize?: { kind?: string }, operationPlan?: { toolName?: string } } | undefined
      if (trace?.authorize?.kind === 'EXECUTE' && trace.operationPlan?.toolName && (payload.cart || payload.item || payload.items || payload.presentation)) {
        // Keep only grounded result data needed by the Agent's session summary.
        // The full menu or checkout identifiers must not be echoed into it.
        const summary = { cart: payload.cart, line: payload.line, item: payload.item, items: payload.items, presentation: payload.presentation }
        await interactionRecording.append('tool_result', JSON.stringify(summary), {
          decisionRoute: 'fast_path',
          name: trace.operationPlan.toolName,
        })
      }
    }
    if (!interactionTurn.isCurrent(turn))
      return
    playTransientMotion('acknowledge')
    return answer
  }

  if (result.kind === 'CLARIFICATION') {
    const activity = await recordCustomerActivity(input.source === 'asr' ? 'voice_input' : 'asr_simulation')
    if (!interactionTurn.isCurrent(turn))
      return
    if (input.recording)
      mediaCapture.saveAudio(input.recording, activity?.id)
    await interactionRecording.append('asr_transcript', input.text, { decisionRoute: 'fast_path', source: input.source })
    await interactionRecording.append('assistant_text', result.prompt, { decisionRoute: 'fast_path' })
    if (!interactionTurn.isCurrent(turn))
      return
    conversationMessages.value = [
      ...conversationMessages.value,
      { role: 'user', content: input.text },
      { role: 'assistant', content: result.prompt, slices: [], tool_results: [] },
    ]
    return result.prompt
  }

  const decisionState = conversationDecisionStateFrom(result.decisionState)

  if (result.kind === 'NEEDS_ASSISTANT') {
    // System One has already classified this as a real customer need that the
    // finite fast path cannot fulfil. Continue in the Main Agent immediately;
    // requiring a second screen tap makes conversational ordering feel broken.
    void persistAssistantEscalation(input)
    void sendConversationMessage(input.text, turn, { decisionEntryId: input.id, decisionState })
      .catch(error => console.error('Failed to forward kiosk request to Main Agent:', error))
  }

  // An unavailable decision did not establish that ambient audio addresses
  // this kiosk. Fail closed and surface the status; never send it to Agent.
}

function customerMessageFrom(result: unknown) {
  if (!result || typeof result !== 'object')
    return undefined
  const payload = result as Record<string, unknown>
  const customerMessage = payload.customerMessage
  const question = payload.pendingCustomerChoice
  const prompt = question && typeof question === 'object'
    ? (question as Record<string, unknown>).question
    : undefined
  const message = typeof customerMessage === 'string' && customerMessage.trim() ? customerMessage : undefined
  if (typeof prompt === 'string' && prompt.trim())
    return message ? `${message} ${prompt}` : prompt
  if (message)
    return message
  const cart = payload.cart
  if (cart && typeof cart === 'object') {
    const itemCount = (cart as Record<string, unknown>).itemCount
    if (typeof itemCount === 'number')
      return itemCount === 0 ? '目前購物車是空的。' : `目前購物車共有 ${itemCount} 份餐點。`
  }
  return undefined
}

async function persistAssistantEscalation(input: FastPathInput) {
  try {
    const activity = await recordCustomerActivity(input.source === 'asr' ? 'voice_input' : 'asr_simulation')
    if (!input.recording)
      return
    mediaCapture.saveAudio(input.recording, activity?.id)
    await interactionRecording.append('asr_transcript', input.text)
  }
  catch (error) {
    // The deliberate escalation still reaches the Agent; persistence failure is
    // observable in development but must not turn a customer action into a noop.
    console.error('[stage-kiosk] failed to persist assistant escalation:', error)
  }
}

function interruptAssistantOutput() {
  assistantAudio?.pause()
  if (assistantAudio)
    URL.revokeObjectURL(assistantAudio.src)
  assistantAudio = undefined
}

function interruptSpokenReply() {
  if (interactionTurn.phase.value !== 'speaking')
    return

  // Cancelling the active turn also aborts speech synthesis when the audio
  // has not started yet; the player's abort listener pauses active playback.
  interactionTurn.cancelActiveTurn()
  interruptAssistantOutput()
}

function clearConversationPresentation() {
  utteranceQueue.reset()
  voiceDiagnosticByUtterance.clear()
  voiceDiagnosticEntries.value = []
  interactionTurn.cancel()
  interruptAssistantOutput()
  conversationMessages.value = []
  streamingAssistantMessage.value = undefined
  conversationWorkStatus.value = undefined
  conversationActivitySteps.value = []
  retryableConversationRequest.value = undefined
  pendingTranscript.value = undefined
  asrSimulationStatus.value = undefined
  asrSimulationTrace.value = undefined
  decisionEntries.value = []
}

async function speakAssistantReply(text: string, turn: ReturnType<typeof interactionTurn.begin>) {
  interruptAssistantOutput()
  try {
    const audio = await synthesizeKioskSpeech({ locale: language.value, signal: turn.signal, text })
    if (!interactionTurn.isCurrent(turn))
      return

    const player = new Audio(URL.createObjectURL(audio))
    const source = audioContext ? audioContext.createMediaElementSource(player) : undefined
    if (source) {
      assistantAudioNode.value = source
      source.connect(audioContext.destination)
    }
    assistantAudio = player
    await new Promise<void>((resolve) => {
      function finish() {
        turn.signal.removeEventListener('abort', stop)
        if (assistantAudio === player)
          assistantAudio = undefined
        if (assistantAudioNode.value === source)
          assistantAudioNode.value = undefined
        source?.disconnect()
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

watch([enabled, () => props.voiceConversationOnly], async ([isEnabled, voiceConversationOnly]) => {
  if (isEnabled && voiceConversationOnly)
    await startAudioInteraction().catch(error => console.error('Failed to start kiosk audio interaction:', error))
  else
    stopAudioInteraction()
}, { immediate: true })

// Voice-only mode is the explicit microphone consent mode. It asks before
// optional camera work begins, while text kiosks never request microphone use.
async function prepareMicrophone() {
  if (!props.voiceConversationOnly) {
    // A profile can change from voice-only to text mode while this browser
    // retains its previous local preference. Keep that stale preference from
    // starting the audio pipeline in the text-only experience.
    enabled.value = false
    initialMicrophonePermission.settle()
    return
  }

  try {
    await prepareKioskMicrophonePermission({
      audioInputEnabled: enabled.value,
      requestPermission: requestMicrophonePermission,
      setAudioInputEnabled: nextEnabled => enabled.value = nextEnabled,
      voiceConversationOnly: props.voiceConversationOnly,
    })
  }
  catch (error) {
    enabled.value = false
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
  presenceWindow = createPresenceWindow({
    ...defaultPresenceSettings,
    greetingRoi: proactiveSettings.value.observation.detectionZone,
  }, proactiveSettings.value.proactiveGreeting)
  presenceDecision.value = undefined
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
  utteranceQueue.reset()
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

  if ((props.deviceSettings?.presenceVisionMode ?? defaultDeviceSettingsValues.presenceVisionMode) !== 'face_only')
    return

  const decision = proactiveWindow.decide(observation)
  if (!decision.shouldGreet)
    return
  if (!decision.greetingTrigger)
    return

  await startProactiveGreeting()
}

function handlePresenceCandidate(candidate: Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'> | undefined) {
  lastPresenceCandidate.value = candidate
  const decision = presenceWindow.decide(performance.now(), candidate)
  presenceDecision.value = decision
  if (import.meta.env.DEV && decision.state !== decision.previousState) {
    console.info('[stage-kiosk] presence transition', {
      bodyScale: decision.candidate?.bodyScale,
      centre: decision.candidate?.centre,
      greetingEligible: decision.greetingEligible,
      greetingRoiHit: decision.candidate?.greetingRoiHit,
      idleSuppressed: decision.idleSuppressed,
      interactionRoiHit: decision.candidate?.interactionRoiHit,
      lastSeenAgeMs: decision.lastSeenAgeMs,
      movement: { scaleVelocity: decision.scaleVelocity, velocityX: decision.velocityX },
      poseQuality: decision.candidate?.poseQuality,
      previousState: decision.previousState,
      reason: decision.transitionReason,
      state: decision.state,
    })
  }
  syncPresenceIdleSuppression(decision)

  // A greeting alone does not reserve the kiosk for the old 45-second
  // customer idle timeout. Once its anonymous candidate leaves the grace
  // period, return to standby so the next passer can earn a new greeting.
  if (customerSessionState.value === 'active' && !hasCustomerActivity.value && !hasPendingWork.value && decision.state === 'EMPTY') {
    void endCustomerSession('idle').catch(error => console.error('Failed to release an unclaimed proactive greeting session:', error))
    return
  }

  const visionMode = props.deviceSettings?.presenceVisionMode ?? defaultDeviceSettingsValues.presenceVisionMode
  if (visionMode !== 'face_only' && customerSessionState.value === 'standby' && decision.greetingEligible && interactionTurn.canProactivelySpeak.value)
    void startProactiveGreeting(() => presenceWindow.claimGreeting())
}

/**
 * Camera geometry alone is intentionally not allowed to reserve a greeted
 * session forever. A real kiosk action upgrades the same ENGAGED state to
 * normal protection; otherwise the 15-second visual grace ends and restarts
 * the existing 45-second customer-session timer.
 */
function syncPresenceIdleSuppression(decision: ReturnType<typeof presenceWindow.decide> | undefined) {
  if (customerSessionState.value !== 'active') {
    visualEngagementProtectionStartedAtMs = undefined
    return
  }
  if (!decision?.idleSuppressed) {
    visualEngagementProtectionStartedAtMs = undefined
    customerSession.setPresenceIdleSuppressed(false)
    return
  }
  if (hasCustomerActivity.value || decision.state !== 'ENGAGED') {
    customerSession.setPresenceIdleSuppressed(true)
    return
  }

  visualEngagementProtectionStartedAtMs ??= Date.now()
  const visualProtectionExpired = Date.now() - visualEngagementProtectionStartedAtMs >= presenceSettings.visualEngagedIdleProtectionMs
  customerSession.setPresenceIdleSuppressed(!visualProtectionExpired)
}

async function startProactiveGreeting(onStarted?: () => void) {
  if (customerSessionState.value !== 'standby' || !interactionTurn.canProactivelySpeak.value)
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
    visualEngagementProtectionStartedAtMs = undefined
    await customerSession.begin()
    syncPresenceIdleSuppression(presenceDecision.value)
    if (!interactionTurn.isCurrent(turn))
      return
    onStarted?.()
    await interactionRecording.start(scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction')
    if (!interactionTurn.isCurrent(turn))
      return
    mediaCapture.startSessionCapture(effectiveMediaCaptureMode.value)
    const greetingEvent = await interactionRecording.append('service_event', 'proactive_greeting')
    if (!interactionTurn.isCurrent(turn))
      return
    if (effectiveMediaCaptureMode.value === 'snapshot')
      void mediaCapture.captureInteractionSnapshot(greetingEvent?.id)
    else if (effectiveMediaCaptureMode.value !== 'off')
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

async function recordCustomerActivity(source: 'asr_simulation' | 'manual' | 'scenario' | 'voice_input' | 'voice_transcript' | 'completed' = 'scenario') {
  // A System One Fast Path action may arrive while the Kiosk is waiting for a
  // session-end confirmation. Treat a verified action as real activity before
  // writing it, while an unverified transcript never reaches this boundary.
  if ((source === 'voice_input' || source === 'asr_simulation') && customerSessionState.value === 'awaiting-idle-confirmation')
    continueCurrentSession()
  if (customerSessionState.value === 'standby')
    visualEngagementProtectionStartedAtMs = undefined
  if (lastPresenceCandidate.value) {
    const decision = presenceWindow.decide(performance.now(), lastPresenceCandidate.value, true)
    presenceDecision.value = decision
  }
  await customerSession.recordActivity()
  syncPresenceIdleSuppression(presenceDecision.value)
  await interactionRecording.start(scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction')
  mediaCapture.startSessionCapture(effectiveMediaCaptureMode.value)
  const activity = await interactionRecording.append('service_event', 'customer_activity', { source })
  if (effectiveMediaCaptureMode.value === 'snapshot')
    void mediaCapture.captureInteractionSnapshot(activity?.id)
  else if (effectiveMediaCaptureMode.value !== 'off')
    mediaCapture.captureInteractionClip(activity?.id)
  assistanceReminderWindow.recordActivity(performance.now())
  return activity
}

async function simulateAsrTranscript(text: string) {
  const transcript = text.trim()
  if (!transcript || props.voiceConversationOnly)
    return
  const submission = utteranceQueue.submit({ source: 'simulation', text: transcript })
  asrSimulationStatus.value = submission.kind === 'ACCEPTED'
    ? `已收到模擬語句；目前排隊 ${utteranceQueueState.value.pending.length} 句。`
    : submission.kind === 'OVERLOADED'
      ? '語句佇列已滿，這句未送出；請稍後再試。'
      : undefined
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
      if (kind === 'greeting')
        playTransientMotion('greeting')
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

async function sendConversationMessage(
  text: string,
  existingTurn?: ReturnType<typeof interactionTurn.begin>,
  options: { appendUserMessage?: boolean, decisionEntryId?: number, decisionState?: KioskConversationDecisionState } = {},
) {
  // A new typed message is a deliberate correction, unlike unverified ambient
  // speech. Stop any audible reply before beginning the replacement turn.
  if (!existingTurn && interactionTurn.phase.value === 'speaking')
    interruptAssistantOutput()

  const turn = existingTurn ?? interactionTurn.begin('conversation', 'thinking')
  if (!existingTurn && !interactionTurn.isCurrent(turn))
    return
  if (existingTurn && !interactionTurn.advance(turn, 'thinking'))
    return

  let resolveReady!: () => void
  let resolveDone!: () => void
  const request: ActiveAgentRequest = {
    decisionEntryId: options.decisionEntryId,
    done: new Promise<void>(resolve => resolveDone = resolve),
    ready: new Promise<void>(resolve => resolveReady = resolve),
    resolveDone: () => resolveDone(),
    resolveReady: () => resolveReady(),
    stage: 'starting',
    text,
    turn,
  }
  activeAgentRequest = request
  const updateAgentStep = (step: string) => {
    if (options.decisionEntryId !== undefined)
      updateDecisionEntry(options.decisionEntryId, { agentStep: step })
  }
  updateAgentStep('Main Agent 準備中')

  if (options.appendUserMessage ?? true)
    conversationMessages.value = [...conversationMessages.value, { role: 'user', content: text }]
  retryableConversationRequest.value = undefined
  streamingAssistantMessage.value = undefined
  conversationWorkStatus.value = undefined
  conversationActivitySteps.value = []
  const startedAt = conversationDiagnosticsEnabled.value ? performance.now() : undefined
  let timingTimer: ReturnType<typeof setInterval> | undefined
  let longWaitTimer: ReturnType<typeof setTimeout> | undefined
  let mutationToolAttempted = false
  const updateExecutionDuration = () => {
    if (startedAt === undefined || !interactionTurn.isCurrent(turn))
      return
    conversationExecutionDurationMs.value = performance.now() - startedAt
  }
  const finishExecutionDuration = () => {
    if (timingTimer)
      clearInterval(timingTimer)
    updateExecutionDuration()
  }
  const clearLongWait = () => {
    if (longWaitTimer)
      clearTimeout(longWaitTimer)
  }
  if (startedAt === undefined) {
    conversationExecutionDurationMs.value = undefined
  }
  else {
    conversationExecutionDurationMs.value = 0
    timingTimer = setInterval(updateExecutionDuration, 100)
  }
  try {
    let decisionState = options.decisionState
    if (!decisionState) {
      // Typed turns bypass System One; read only the browser's current phase.
      // This separate host tool never issues or consumes a finite candidate.
      const stateTool = webMcpAdapter.tools.value.find(tool => tool.name === 'kiosk_interaction_state')
      if (stateTool) {
        try {
          decisionState = conversationDecisionStateFrom(await webMcpAdapter.execute(stateTool, {}))
        }
        catch {
          // Main Agent remains available when the embedded ordering page is not.
        }
      }
    }
    if (!interactionTurn.isCurrent(turn))
      return
    const reply = await interactionRecording.send(
      scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction',
      text,
      activeTools.value,
      {
        ...(decisionState ? { decisionState } : {}),
        onTurnStarted: () => {
          if (!interactionTurn.isCurrent(turn))
            return
          // The SSE turn-started event also appears after browser tool results.
          // Once any tool was requested, keep the Agent non-interruptible until
          // its whole tool/result loop settles; otherwise a later ASR could
          // cancel the continuation and leave an uncertain order state.
          if (request.stage === 'starting')
            request.stage = 'thinking'
          updateAgentStep('Main Agent 理解需求中')
          request.resolveReady()
          const label = '正在理解您的需求…'
          startConversationProgress(turn.id, label)
          conversationWorkStatus.value = label
          clearLongWait()
          longWaitTimer = setTimeout(extendConversationProgressWait, conversationLongWaitMs, turn.id)
        },
        onToolRequested: (toolName) => {
          if (!interactionTurn.isCurrent(turn))
            return
          request.stage = 'tool_requested'
          updateAgentStep(`Main Agent 已選擇 ${toolName}`)
          interactionTurn.advance(turn, 'using-tool')
          const label = describeToolActivity(toolName, 'selected')
          selectConversationProgressTool(turn.id, toolName, label)
          conversationWorkStatus.value = label
          conversationActivitySteps.value = [
            ...conversationActivitySteps.value.filter(step => step.toolName !== toolName),
            { label, state: 'selected' as const, toolName },
          ].slice(-3)
          if (import.meta.env.DEV)
            console.info('[kiosk-tools]', { phase: 'llm-selected', toolName })
        },
        onToolActivity: (toolName, state) => {
          if (!interactionTurn.isCurrent(turn))
            return
          interactionTurn.advance(turn, 'using-tool')
          if (state === 'executing' && !isKioskConversationRetrySafeTool(toolName))
            mutationToolAttempted = true
          if (state === 'executing' && !isKioskConversationRetrySafeTool(toolName))
            request.stage = 'mutating'
          updateAgentStep(`${toolName}：${state === 'executing' ? '網頁執行中' : state === 'done' ? '已完成' : '執行失敗'}`)
          const label = describeToolActivity(toolName, state)
          selectConversationProgressTool(turn.id, toolName, label)
          conversationWorkStatus.value = label
          conversationActivitySteps.value = [
            ...conversationActivitySteps.value.filter(step => step.toolName !== toolName),
            { label, state, toolName },
          ].slice(-3)
          if (import.meta.env.DEV)
            console.info('[kiosk-tools]', { phase: 'browser-execution', state, toolName })
          if (state === 'done' && ['menu_recommend', 'menu_show_recommendations'].includes(toolName))
            playTransientMotion('presentRecommendations')
          if (state === 'done' && ['order_add_item', 'cart_add_item', 'cart_remove_item', 'cart_set_line_quantity', 'order_set_fulfillment'].includes(toolName))
            playTransientMotion('acknowledge')
        },
        onAssistantDelta: (delta) => {
          if (!interactionTurn.isCurrent(turn))
            return
          finishConversationProgress(turn.id)
          updateAgentStep('Main Agent 回覆中')
          clearLongWait()
          conversationWorkStatus.value = undefined
          const previous = streamingAssistantMessage.value?.content ?? ''
          streamingAssistantMessage.value = {
            role: 'assistant',
            content: `${previous}${delta}`,
            slices: [],
            tool_results: [],
          }
        },
        signal: turn.signal,
      },
    )
    finishExecutionDuration()
    if (!interactionTurn.isCurrent(turn))
      return
    const answer = reply?.answer
    conversationMessages.value = [
      ...conversationMessages.value,
      answer
        ? { role: 'assistant', content: answer, slices: [], tool_results: [] }
        : { role: 'error', content: mutationToolAttempted ? '暫時無法確認這次操作結果，請先確認畫面上的購物車或訂單。' : '這次處理時間較久，您可以再試一次。' },
    ]
    if (!answer && !mutationToolAttempted)
      retryableConversationRequest.value = text
    updateAgentStep(answer ? 'Main Agent 已完成' : 'Main Agent 未能完成')
    streamingAssistantMessage.value = undefined
    request.resolveDone()
    if (activeAgentRequest === request)
      activeAgentRequest = undefined
    if (answer) {
      interactionTurn.advance(turn, 'speaking')
      await speakAssistantReply(answer, turn)
    }
  }
  finally {
    request.resolveReady()
    request.resolveDone()
    if (activeAgentRequest === request)
      activeAgentRequest = undefined
    finishExecutionDuration()
    clearLongWait()
    finishConversationProgress(turn.id)
    if (interactionTurn.isCurrent(turn))
      streamingAssistantMessage.value = undefined
    if (interactionTurn.isCurrent(turn)) {
      interactionTurn.complete(turn)
      conversationWorkStatus.value = undefined
    }
  }
}

function retryConversationMessage() {
  const text = retryableConversationRequest.value
  if (!text || conversationSending.value)
    return

  retryableConversationRequest.value = undefined
  const lastMessage = conversationMessages.value.at(-1)
  if (lastMessage?.role === 'error')
    conversationMessages.value = conversationMessages.value.slice(0, -1)
  void sendConversationMessage(text, undefined, { appendUserMessage: false })
}

function describeToolActivity(toolName: string, state: 'executing' | 'done' | 'error' | 'selected') {
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
  streamingAssistantMessage.value = undefined
  retryableConversationRequest.value = undefined
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
  customerResetError.value = undefined
  try {
    mediaCapture.stopContinuousCapture()
    await interactionRecording.append('service_event', 'customer_requested_restart')
    await interactionRecording.end('idle')
    await customerSession.end('staff')
    conversationMessages.value = []
    streamingAssistantMessage.value = undefined
    retryableConversationRequest.value = undefined
  }
  catch (error) {
    customerResetError.value = '無法重新開始，請確認連線後再試。'
    console.error('[stage-kiosk] failed to restart the customer session:', error)
  }
}

async function startOrRestartCustomerSession() {
  if (customerSessionState.value === 'standby') {
    await recordCustomerActivity('manual')
    return
  }
  await restartCustomerSession()
}

function reloadKiosk() {
  // Entering the PIN-protected maintenance panel is an explicit operator
  // takeover. Camera presence cannot distinguish that operator from a
  // customer, so do not add a second customer-state confirmation here.
  window.location.reload()
}

function closeAdminPanel() {
  const { admin: _admin, ...query } = route.query
  void router.replace({ query })
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
  if (transientMotionTimer)
    clearTimeout(transientMotionTimer)
  releaseChatPendingWork?.()
  stopMenuActivityListener?.()
  stopMenuCompletionListener?.()
  mediaCapture.stopContinuousCapture()
})
</script>

<template>
  <main :class="['kiosk-scene', `is-${orientation}`]">
    <KioskAudioStatusOverlay
      v-if="showIdleDiagnostics"
      v-bind="audioInputIndicator"
      :interruptible="assistantOutputInterruptible"
      :position="audioStatusPosition"
      @interrupt="interruptSpokenReply"
      @move="audioStatusPosition = $event"
    />
    <KioskAdminAccess class="kiosk-admin-access">
      <span class="i-solar:settings-outline h-4 w-4" aria-hidden="true" />
      <span>設定</span>
    </KioskAdminAccess>

    <aside v-if="adminPanelOpen" class="kiosk-admin-panel-layer">
      <KioskAdminPanel
        v-model:camera-preview-enabled="cameraPreviewEnabled"
        v-model:conversation-font-size="conversationFontSize"
        v-model:paused="paused"
        :device="props.device"
        :session-ending="customerSessionState === 'resetting'"
        @close="closeAdminPanel"
        @end-session="restartCustomerSession"
        @reload="reloadKiosk"
      >
        <template #device-settings>
          <DeviceSettingsPanel :endpoint="deviceSettingsEndpoint" mode="local" @updated="emit('deviceSettingsUpdated')" />
        </template>
      </KioskAdminPanel>
    </aside>

    <section :class="['service-hero', `is-${orientation}`]" :style="stageBackgroundStyle">
      <section :class="['stage-region', `is-${assistantPresence.mode}`]" aria-label="虛擬服務員">
        <WidgetStage
          class="stage-model"
          :cursor-position="cursorPosition"
          :enable-orbit-controls="false"
          :idle-animation="activeMotionAnimation"
          :animation-loop="activeMotionLoop"
          :paused="paused"
          :thinking="conversationSending"
          :external-audio-source="assistantAudioNode"
        />
      </section>
      <KioskAssistantThoughtBubble :progress="conversationProgress" />
      <KioskConversation
        class="conversation-region"
        :activity-status="conversationActivityStatus"
        :activity-steps="conversationActivitySteps"
        :execution-duration-ms="conversationDiagnosticsEnabled ? conversationExecutionDurationMs : undefined"
        :fast-path-simulation-status="asrSimulationStatus"
        :fast-path-simulation-trace="asrSimulationTrace"
        :assistant-presence="assistantPresence"
        :messages="conversationMessages"
        :streaming-assistant-message="streamingAssistantMessage"
        :pending-transcript="pendingTranscript"
        :retry-available="Boolean(retryableConversationRequest)"
        :sending="conversationSending"
        :font-size="conversationFontSize"
        :voice-conversation-only="props.voiceConversationOnly"
        @activity="recordCustomerActivity"
        @retry-message="retryConversationMessage"
        @send-message="sendConversationMessage"
        @simulate-asr="simulateAsrTranscript"
      />
    </section>

    <ScenarioSurface class="menu-region" />

    <button
      v-if="customerSessionState === 'active' || customerSessionState === 'standby'"
      type="button"
      class="customer-restart"
      :disabled="conversationSending"
      @click="startOrRestartCustomerSession"
    >
      <span class="i-solar:restart-bold h-4 w-4" aria-hidden="true" />
      {{ customerSessionButtonLabel }}
    </button>

    <KioskIdleDiagnostics
      v-if="showIdleDiagnostics"
      :idle-deadline-at="idleDeadlineAt"
      :pending-work="hasPendingWork"
      :presence-idle-protection="presenceIdleProtection"
      :state="customerSessionState"
    />
    <KioskPresenceDiagnostics
      v-if="showIdleDiagnostics && presenceDecision"
      :decision="presenceDecision"
      :diagnostics="presenceDiagnostics"
      :vision-mode="props.deviceSettings?.presenceVisionMode ?? defaultDeviceSettingsValues.presenceVisionMode"
    />
    <KioskVoiceDiagnostics
      v-if="voiceDiagnosticsEnabled"
      :entries="voiceDiagnosticEntries"
    />
    <KioskDecisionInspector
      v-if="showIdleDiagnostics || conversationDiagnosticsEnabled"
      :entries="decisionEntries"
      :pending-count="utteranceQueueState.pending.length"
    />
    <KioskSessionNotice :message="sessionNotice" />
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
    <KioskCameraPreview
      v-if="cameraPreviewEnabled && cameraStream"
      :decision="presenceDecision"
      :diagnostics="presenceDiagnostics"
      :stream="cameraStream"
      :vision-mode="props.deviceSettings?.presenceVisionMode ?? defaultDeviceSettingsValues.presenceVisionMode"
      :zone="proactiveSettings.observation.detectionZone"
    />
  </main>
</template>

<style scoped>
.kiosk-scene { display: grid; width: 100vw; height: 100dvh; grid-template-columns: minmax(0, 1fr); padding: 1.25rem; overflow: hidden; background: radial-gradient(circle at 12% 0%, rgb(59 79 63 / 24%), transparent 38%), linear-gradient(135deg, #111a17, #15211d); row-gap: 1rem; }
.kiosk-scene.is-landscape { grid-template-rows: minmax(0, .32fr) minmax(0, .68fr); }
.kiosk-scene.is-portrait { grid-template-rows: minmax(0, .36fr) minmax(0, .64fr); }
.service-hero { position: relative; display: grid; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid rgb(230 255 250 / 10%); border-radius: 1.125rem; background: radial-gradient(ellipse at 24% 16%, rgb(238 205 148 / 10%), transparent 25%), linear-gradient(105deg, #24352d 0%, #1a2922 43%, #101a16 100%); grid-column: 1; grid-row: 1; }.service-hero.is-landscape { grid-template-columns: minmax(14rem, .37fr) minmax(0, .63fr); }.service-hero.is-portrait { grid-template-columns: minmax(10rem, .40fr) minmax(0, .60fr); }
.stage-region { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: transparent; transition: box-shadow .2s ease; }.stage-region.is-hearing-speech, .stage-region.is-listening { box-shadow: inset 0 0 1.4rem rgb(50 201 181 / 7%); }.stage-region.is-processing, .stage-region.is-transcribing { box-shadow: inset 0 0 1.6rem rgb(255 180 76 / 8%); }.stage-region.is-speaking { box-shadow: inset 0 0 1.6rem rgb(117 157 255 / 8%); }
/* Keep the upper-body gestures prominent in the narrow hero column. Scaling from
   the bottom and shifting down together keeps the face at the same height while
   letting the lower skirt fall outside the stage viewport. */
.stage-model { position: relative; z-index: 1; width: 100%; height: 100%; transform: translate3d(2%, 10%, 0) scale(1.16); transform-origin: center bottom; transition: transform .3s ease; }
.kiosk-admin-panel-layer { position: fixed; z-index: 90; inset: 0; display: grid; overflow: auto; padding: 1.5rem; background: rgb(1 12 15 / 72%); backdrop-filter: blur(.4rem); }
/* Keep the administrator hold target available without exposing controls in the customer-facing composition. */
:global(.kiosk-admin-access) { position: fixed; z-index: 100; top: 1.75rem; left: 1.75rem; display: inline-flex; height: 2.25rem; align-items: center; gap: .35rem; border: 1px solid rgb(217 250 246 / 28%); border-radius: .7rem; padding: 0 .7rem; color: #d9faf6; background: rgb(1 17 20 / 92%); box-shadow: 0 .35rem 1rem rgb(0 0 0 / 28%); opacity: 0; transition: opacity .16s ease, background .16s ease; }
:global(.kiosk-admin-access:hover), :global(.kiosk-admin-access:focus-visible) { background: #153f43; opacity: 1; }
.conversation-region { min-width: 0; min-height: 0; }
.menu-region { min-width: 0; min-height: 0; grid-column: 1; grid-row: 2; }
.proactive-camera { position: fixed; width: 1px; height: 1px; pointer-events: none; opacity: 0; }
.customer-restart { position: fixed; z-index: 20; bottom: 1.15rem; left: 1.15rem; display: inline-flex; align-items: center; gap: .45rem; border: 1px solid rgb(207 250 254 / 48%); border-radius: .7rem; padding: .6rem .8rem; color: #ecfeff; background: rgb(8 47 73 / 90%); font-size: .8rem; font-weight: 700; box-shadow: 0 .35rem 1rem rgb(0 0 0 / 28%); transition: background .16s ease, opacity .16s ease; }.customer-restart:hover:not(:disabled) { background: rgb(14 116 144 / 94%); }.customer-restart:disabled { cursor: wait; opacity: .55; }

@media (max-width: 700px) {
  .kiosk-scene { padding: .6rem; row-gap: .6rem; }
  .service-hero.is-landscape { grid-template-columns: minmax(7rem, .37fr) minmax(0, .63fr); }
}
</style>
