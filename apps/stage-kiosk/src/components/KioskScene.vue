<script setup lang="ts">
import type { DeviceSettingsSnapshot, DeviceSettingsValues, KioskVoiceVadSettings, PresenceCandidate } from '@proj-airi/kiosk-proactive'
import type { BrowserConversation } from '@proj-airi/stage-shared/browser-conversation'
import type { InteractionLifecycleMessage } from '@proj-airi/stage-shared/interaction-lifecycle'
import type { VADEvents } from '@proj-airi/stage-ui/libs/audio/vad'
import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import type { KioskMotionName } from '../composables/useKioskCharacterMotion'
import type { KioskInteractionTurn } from '../composables/useKioskInteractionTurn'
import type { CustomerRequestStatus } from '../services/conversationMessages'
import type { CustomerTarget } from '../services/customerTarget'
import type { KioskConversationDecisionState, KioskDevice, KioskMediaCaptureMode, KioskPerformanceProfile } from '../services/kiosk-device'
import type { ConversationRetry } from '../services/kioskConversationRetry'
import type { KioskUtterance, KioskUtteranceReservation, KioskUtteranceTicket } from '../services/kioskUtteranceQueue'
import type { KioskAssistantPresenceMode } from './KioskAssistantPresence.vue'
import type { KioskDecisionEntry } from './KioskDecisionInspector.vue'
import type { KioskVoiceDiagnosticEntry } from './KioskVoiceDiagnostics.vue'

import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { errorMessageFrom } from '@moeru/std'
import { createAssistanceReminderWindow, createInteractionWindow, createPresenceWindow, defaultDeviceSettingsValues, defaultPresenceSettings, observationSettings } from '@proj-airi/kiosk-proactive'
import { conversationContextSchema, serviceContextKey, serviceRecoveryLimits } from '@proj-airi/stage-shared/kiosk-conversation'
import { labelCatalog } from '@proj-airi/stage-shared/ordering-sites'
import { availableOrderingTools, orderingTools } from '@proj-airi/stage-shared/ordering-tools'
import { serviceOperationSchema } from '@proj-airi/stage-shared/service-operation'
import { CustomerSessionCompletion, CustomerSessionIdleConfirmation } from '@proj-airi/stage-ui/components'
import { DeviceSettingsPanel } from '@proj-airi/stage-ui/components/scenarios/kiosk/deviceSettings'
import { WidgetStage } from '@proj-airi/stage-ui/components/scenes'
import { InputGain, measurePcmLevel } from '@proj-airi/stage-ui/libs/audio/inputGain'
import { useVAD } from '@proj-airi/stage-ui/stores/ai/models/vad'
import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useLlmToolsStore } from '@proj-airi/stage-ui/stores/llm-tools'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { Button } from '@proj-airi/ui'
import { useIntervalFn, useMouse, useWindowSize } from '@vueuse/core'
import { executeTool } from '@xsai/shared-chat'
import { storeToRefs } from 'pinia'
import { parse, safeParse } from 'valibot'
import { computed, nextTick, onMounted, onScopeDispose, onUnmounted, shallowReactive, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import KioskActivityGlow from './KioskActivityGlow.vue'
import KioskAdminAccess from './KioskAdminAccess.vue'
import KioskAdminPanel from './KioskAdminPanel.vue'
import KioskAgentControl from './KioskAgentControl.vue'
import KioskAssistantThoughtBubble from './KioskAssistantThoughtBubble.vue'
import KioskCameraPreview from './KioskCameraPreview.vue'
import KioskConversation from './KioskConversation.vue'
import KioskDecisionInspector from './KioskDecisionInspector.vue'
import KioskIdleDiagnostics from './KioskIdleDiagnostics.vue'
import KioskPresenceDiagnostics from './KioskPresenceDiagnostics.vue'
import KioskSessionNotice from './KioskSessionNotice.vue'
import KioskVoiceDiagnostics from './KioskVoiceDiagnostics.vue'
import PaymentReturnButton from './PaymentReturnButton.vue'
import ScenarioSurface from './ScenarioSurface.vue'

import { arrayCaptureConstraints, standardCaptureConstraints } from '../audio/microphoneInput'
import { connectPlaybackReference } from '../audio/playbackReference'
import { useArrayMicrophone } from '../composables/useArrayMicrophone'
import { useFeedbackInvitationSettings } from '../composables/useFeedbackInvitationSettings'
import { useKioskCameraPreview } from '../composables/useKioskCameraPreview'
import { useKioskCharacterMotion } from '../composables/useKioskCharacterMotion'
import { useKioskConversationFontSize } from '../composables/useKioskConversationFontSize'
import { useKioskConversationProgress } from '../composables/useKioskConversationProgress'
import { useKioskCustomerSession } from '../composables/useKioskCustomerSession'
import { useKioskDecisionProgress } from '../composables/useKioskDecisionProgress'
import { useKioskDiagnostics } from '../composables/useKioskDiagnostics'
import { useKioskInteractionRecording } from '../composables/useKioskInteractionRecording'
import { useKioskInteractionTurn } from '../composables/useKioskInteractionTurn'
import { useKioskInteractiveServices } from '../composables/useKioskInteractiveServices'
import { useKioskMediaCapture } from '../composables/useKioskMediaCapture'
import { useKioskMicrophone } from '../composables/useKioskMicrophone'
import { useKioskProactiveVision } from '../composables/useKioskProactiveVision'
import { useKioskProcessingCue } from '../composables/useKioskProcessingCue'
import { useKioskServiceRecovery } from '../composables/useKioskServiceRecovery'
import { useKioskStreamingReply } from '../composables/useKioskStreamingReply'
import { useKioskVoiceTest } from '../composables/useKioskVoiceTest'
import { usePaidOrderCompletion } from '../composables/usePaidOrderCompletion'
import { setKioskLocale } from '../modules/i18n'
import { endKioskAdminSession, isKioskAdminSessionActive } from '../services/admin-session'
import { beginBrowserCartTask, cancelBrowserItemSelection, executeBrowserCartTool, executeBrowserQuantityQuestion, prepareBrowserQuestionAnswer, readBrowserConversation } from '../services/browserCartTask'
import { createBrowserDialogue } from '../services/browserDialogue'
import { createBrowserFastPathSource } from '../services/browserFastPath'
import { createBrowserOrderingTools } from '../services/browserOrderingTools'
import { createBrowserPresentation } from '../services/browserPresentation'
import { offerCheckout } from '../services/checkoutInvitation'
import { requestMessageId } from '../services/conversationMessages'
import { createFixedGreetings, createGreetingDelivery, readGreetingPhase } from '../services/fixedGreetings'
import { interactiveServiceClient } from '../services/interactiveServiceClient'
import { transcribeKioskUtterance } from '../services/kiosk-audio'
import { admitBrowserPlan, decideBrowserAnswer, decideKioskInteraction, isKioskFastPathEnabled, KioskDeviceRequestError, synthesizeKioskSpeech, transcribeKioskAudio } from '../services/kiosk-device'
import { conversationDecisionStateFrom, conversationSource, createDecisionFeedback, createIncompleteAsrSession, refreshConversationState, runFastPath, shouldShowDecisionRetry } from '../services/kiosk-fast-path'
import { kioskPerformanceSettings } from '../services/kiosk-performance'
import { createKioskStartupPermissionGate, prepareKioskMicrophonePermission } from '../services/kiosk-startup-permission-gate'
import { applyAudioOutput } from '../services/kioskAudioOutput'
import { BrowserRecoveryBlocked, BrowserRestartBlocked, isKioskConversationRetrySafeTool, readConversationRetryContext, recoverConversationService, resumeConversationRetry } from '../services/kioskConversationRetry'
import { createSpeechPlayer } from '../services/kioskSpeech'
import { createUtteranceTiming } from '../services/kioskTiming'
import { createKioskUtteranceQueue } from '../services/kioskUtteranceQueue'
import { createMouthActivityGate } from '../services/mouthActivity'
import { chooseGateway, gatewayPage, paymentChoiceFromSpeech, paymentOptionsReply, requestsPaymentReturn, switchPayment } from '../services/paymentChoice'
import { browserRecoveryReply, createInvitationWindow, createMenuReplyWindow, createServiceClarificationWindow, operationReplyFrom, questionReceiptFrom, replyFromConversation, replyFromReceipt, replyWithQuestion, requestsReadingStop } from '../services/questionPresentation'
import { scenarioRegistry } from '../services/scenario-registry'
import { createSpeechInterruption } from '../services/speechInterruption'
import { createVoicePresenceGate } from '../services/voicePresence'
import { describeWebnaviorKioskToolActivity, loadWebnaviorKioskActivityManifest } from '../services/webnaviorKioskActivity'

const props = defineProps<{
  device?: KioskDevice
  deviceSettings?: DeviceSettingsValues
  greetingPhrases?: readonly string[]
  idleAnimation?: string
  motionAnimations?: Partial<Record<KioskMotionName, string>>
  sceneBackgroundUrl?: string
  mediaCaptureMode: KioskMediaCaptureMode
  performanceProfile: KioskPerformanceProfile
  proactiveVlmEnabled: boolean
  voiceConversationOnly: boolean
  voiceVadSettings: KioskVoiceVadSettings
}>()

const emit = defineEmits<{ deviceSettingsUpdated: [snapshot: DeviceSettingsSnapshot] }>()

const { t, locale } = useI18n()

type KioskOrientation = 'landscape' | 'portrait'

interface FastPathInput {
  id?: number
  deadlineAt?: number
  signal?: AbortSignal
  recording?: Blob
  recognitionMode?: KioskUtterance['recognitionMode']
  source: 'asr' | 'simulation'
  text: string
}

const conversationLongWaitMs = 5_000
const asrSimulationStatus = shallowRef<string>()
const asrSimulationTrace = shallowRef<string>()
const decisionEntries = shallowRef<KioskDecisionEntry[]>([])
const asrSimulationTiming = computed(() => decisionEntries.value.filter(entry => entry.source === 'simulation').at(-1)?.timing)
const incompleteAsrSession = createIncompleteAsrSession()
const serviceClarificationWindow = createServiceClarificationWindow()
const decisionProgress = useKioskDecisionProgress()
const decisionStatus = decisionProgress.state
const fastPathProgress = shallowRef<{ utteranceId: number, text: string }>()

const route = useRoute()
const router = useRouter()
const adminPanelOpen = computed(() => route.query.admin === 'true')
const adminVoiceTestEnabled = shallowRef(false)
const adminVoiceTestActive = computed(() => adminPanelOpen.value && adminVoiceTestEnabled.value)

const desktopHost = Boolean(window.airiKioskDesktop)
const textConsoleFloating = shallowRef(false)
const deviceSettingsEndpoint = new URL('/api/kiosk/settings', import.meta.env.VITE_API_SERVER_URL ?? 'http://localhost:5168').href

const configuredOrientation = import.meta.env.VITE_KIOSK_ORIENTATION as KioskOrientation | undefined
const { width, height } = useWindowSize()
const orientation = computed<KioskOrientation>(() => configuredOrientation ?? (width.value >= height.value ? 'landscape' : 'portrait'))
const paused = shallowRef(false)

const settingsAudioDeviceStore = useSettingsAudioDevice()
const { language } = storeToRefs(useSettings())
const fixedGreetings = createFixedGreetings(synthesizeKioskSpeech)
const greetingDelivery = createGreetingDelivery()
const { enabled, stream: rawMicrophoneStream } = storeToRefs(settingsAudioDeviceStore)
const microphone = useKioskMicrophone()
// Electron's Chromium owns microphone permission and tracks, as in November master.
const browserCaptureMode = computed(() => microphone.settings.value.inputMode === 'standard' ? 'standard' as const : 'raw' as const)
watch(browserCaptureMode, (mode) => {
  settingsAudioDeviceStore.browserCaptureEnabled = true
  settingsAudioDeviceStore.inputConstraints = mode === 'standard' ? standardCaptureConstraints : arrayCaptureConstraints
}, { immediate: true, flush: 'sync' })
onScopeDispose(() => {
  settingsAudioDeviceStore.inputConstraints = undefined
  settingsAudioDeviceStore.browserCaptureEnabled = true
})
const audioInputStarted = shallowRef(false)
const arrayDiagnostics = shallowRef<{ inputDb: number, outputDb: number, peak: number, limitedPercent: number, lagMs: number, referenceSignalFrames: number, inputFrames: number, outputFrames: number }>()
let arrayLevels = { inputDb: -Infinity, outputDb: -Infinity, peak: 0, limited: 0, samples: 0 }
let audioCaptureController: AbortController | undefined
let audioCaptureAttempt = 0
const mouthAssistanceEnabled = computed(() => props.deviceSettings?.mouthDetectionEnabled ?? defaultDeviceSettingsValues.mouthDetectionEnabled)
const visualSpeechRequired = computed(() => mouthAssistanceEnabled.value)
let discardSpeechUntilBoundary = false
let captureRecognitionSignal: AbortSignal | undefined
// Include the configured silence tail so a normal end-of-sentence closure is
// valid, while sustained visual inactivity cannot authorize background speech.
const mouthActivity = createMouthActivityGate({ enabled: () => mouthAssistanceEnabled.value, maxMotionGapMs: () => props.voiceVadSettings.minSilenceDurationMs + 350 })
const mouthStartAllowed = shallowRef(false)
let activeMouthLease: number | undefined
const speechInterruption = createSpeechInterruption()
const interruptionDiagnostic = shallowRef(speechInterruption.snapshot())
const customerTarget = shallowRef<CustomerTarget>()
const backgroundSpeechMode = computed(() => props.deviceSettings?.backgroundSpeechMode ?? defaultDeviceSettingsValues.backgroundSpeechMode)
let targetCaptureController = new AbortController()

function resetVisualSpeech() {
  customerTarget.value = undefined
  // Target changes retire only unsubmitted capture/ASR evidence, never accepted
  // utterances, the visitor reception, the cart, or an in-flight merchant tool.
  targetCaptureController.abort()
  targetCaptureController = new AbortController()
  mouthActivity.reset()
  mouthStartAllowed.value = false
  speechInterruption.reset()
  interruptionDiagnostic.value = speechInterruption.snapshot()
}
const { askPermission: requestMicrophonePermission } = settingsAudioDeviceStore
const chatSessionStore = useChatSessionStore()
const { audioContext } = useAudioContext()
const assistantAudioNode = shallowRef<AudioNode>()
const { activeTools } = storeToRefs(useLlmToolsStore())
const { activeCardId } = storeToRefs(useAiriCardStore())
const conversationMessages = shallowRef<ChatHistoryItem[]>([])
const requestStatuses = shallowRef<Record<number, CustomerRequestStatus>>({})
function setRequestStatus(id: number | undefined, status: CustomerRequestStatus) {
  if (id !== undefined && conversationMessages.value.some(message => message.id === requestMessageId(id, 'user')))
    requestStatuses.value = { ...requestStatuses.value, [id]: status }
}
function showCustomerUtterance(utterance: KioskUtterance) {
  if (conversationMessages.value.some(message => message.id === requestMessageId(utterance.id, 'user')))
    return
  const messages = [...conversationMessages.value]
  const next = messages.findIndex(message => message.role === 'user' && Number(message.id?.match(/^utterance:(\d+):user$/)?.[1]) > utterance.id)
  messages.splice(next < 0 ? messages.length : next, 0, { role: 'user', id: requestMessageId(utterance.id, 'user'), content: utterance.text })
  conversationMessages.value = messages
}
const conversationWorkStatus = shallowRef<string>()
const serviceRecoveryBlocked = shallowRef(false)
const serviceRecovering = shallowRef(false)
watch([scenarioRegistry.activeScenarioId, scenarioRegistry.iframeRevision], () => serviceRecoveryBlocked.value = false)
const conversationExecutionDurationMs = shallowRef<number>()
const retryableConversationRequest = shallowRef<ConversationRetry>()
const {
  extendWait: extendConversationProgressWait,
  finish: finishConversationProgress,
  progress: conversationProgress,
  selectTool: selectConversationProgressTool,
  start: startConversationProgress,
} = useKioskConversationProgress()
const streamingReply = useKioskStreamingReply()
const streamingAssistantMessage = streamingReply.message
const pendingTranscript = shallowRef<string>()
const customerResetError = shallowRef<string>()
const voiceDiagnosticEntries = shallowRef<KioskVoiceDiagnosticEntry[]>([])
let nextVoiceDiagnosticId = 0
const voiceDiagnosticByUtterance = new Map<number, number>()
const toolActivityManifest = shallowRef<Awaited<ReturnType<typeof loadWebnaviorKioskActivityManifest>>>()
let receptionGeneration = 0
const interactionRecording = useKioskInteractionRecording()
const productPresentation = createBrowserPresentation(interactiveServiceClient, () => interactionRecording.visitorSessionId.value)
const interactionTurn = useKioskInteractionTurn(() => productPresentation.beginTurn())
const transcriptionCount = shallowRef(0)
const speechPreparationCount = shallowRef(0)
const audioStartupError = shallowRef<string>()
const processingSpeechActive = shallowRef(false)
const arrayActive = computed(() => enabled.value && (props.voiceConversationOnly || adminVoiceTestActive.value))
const arrayRoute = useArrayMicrophone(rawMicrophoneStream, arrayActive, processingSpeechActive, {
  mode: browserCaptureMode,
  requestStandardCapture: () => {
    // The master fallback must reacquire the SAME selected device when Chromium
    // cannot restore AEC with applyConstraints after a raw acquisition.
    microphone.settings.value.inputMode = 'standard'
    settingsAudioDeviceStore.stopStream()
    void nextTick().then(() => settingsAudioDeviceStore.startStream()).catch((error) => {
      audioStartupError.value = errorMessageFrom(error) ?? 'Microphone could not restart.'
    })
  },
})
const { stream } = arrayRoute
const arrayMicrophone = computed(() => arrayRoute.mode.value === 'mask')
const arrayProcessingLabel = computed(() => arrayMicrophone.value ? `Spatial Mask · ${arrayRoute.dynamicProcessing.value ? 'Dynamic' : 'Soft'}` : undefined)

// Decision progress is display-only, so an unverified utterance cannot own or
// cancel an interaction turn. Agent progress takes precedence during handoff.
const presentingVoiceReply = computed(() => props.voiceConversationOnly && (Boolean(streamingAssistantMessage.value) || interactionTurn.phase.value === 'speaking'))
const visibleProgress = computed(() => conversationProgress.value ?? (decisionStatus.value?.pending
  ? { phase: 'understanding' as const, message: t(`stage.kiosk.service-recovery.${decisionStatus.value.messageKey}`) }
  : undefined) ?? (fastPathProgress.value
  ? { phase: 'understanding' as const, message: fastPathProgress.value.text }
  : undefined))
watch([
  () => props.device?.id,
  () => JSON.stringify(props.greetingPhrases),
  () => props.deviceSettings?.greetingEnabled,
  () => props.proactiveVlmEnabled,
  language,
  locale,
], () => {
  interactionTurn.cancelProactive('greeting-settings-changed')
  if (!props.device || !props.deviceSettings?.greetingEnabled || props.proactiveVlmEnabled) {
    void fixedGreetings.prepare(undefined)
    return
  }
  void fixedGreetings.prepare({
    locale: language.value,
    // An unset bank deliberately selects shared localized openings, rather
    // than speaking the Profile's model instructions as customer-facing text.
    openings: props.greetingPhrases ?? [
      t('stage.kiosk.welcome.first'),
      t('stage.kiosk.welcome.second'),
      t('stage.kiosk.welcome.third'),
    ],
    entryHint: t('stage.kiosk.welcome.phone-hint'),
  })
}, { immediate: true })
const invitationWindow = createInvitationWindow()
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
// Maps are bounded with the inspector history and cleared at customer reset.
// A turn points at the same clock across Jev, Main, native steps and speech.
const utteranceTimings = new Map<number, ReturnType<typeof createUtteranceTiming>>()
const turnTimings = new Map<number, ReturnType<typeof createUtteranceTiming>>()
// A provisional service receipt owns progress only. Promotion happens after the
// ordinary decision/operation gate; queue cleanup retires unpromoted turns.
const firstResponseTurns = new Map<number, KioskInteractionTurn>()
// Tag speech at receipt, before the FIFO can delay it past a touch answer.
// A phrase received by an idle question must never become a later meal order.
const idleUtterances = new Map<number, { deadline?: number, generation: number }>()

const utteranceQueue = createKioskUtteranceQueue({
  onReady: (utterance) => {
    rememberIdleQuestion(utterance.id)
    showCustomerUtterance(utterance)
    setRequestStatus(utterance.id, 'queued')
  },
  onDrop: (utterance) => {
    idleUtterances.delete(utterance.id)
    setRequestStatus(utterance.id, 'cancelled')
    finishVoiceDiagnostic(utterance.id, 'failed')
    if (utterance.source === 'simulation')
      asrSimulationStatus.value = '會話已重設，待處理語句已取消。'
  },
  onError: (utterance, error) => {
    setRequestStatus(utterance.id, 'failed')
    finishVoiceDiagnostic(utterance.id, 'failed')
    console.error('Failed to process kiosk utterance:', error)
    if (utterance.source === 'simulation')
      asrSimulationStatus.value = '無法確認這句是否已操作成功，請先查看購物車或訂單，不要直接重試。'
    else
      pendingTranscript.value = '無法確認操作結果，請先查看購物車或訂單。'
  },
  onState: state => utteranceQueueState.value = state,
  process: async (utterance, ticket) => {
    setRequestStatus(utterance.id, 'processing')
    try {
      await processKioskUtterance(utterance, ticket)
    }
    finally {
      idleUtterances.delete(utterance.id)
      if (!ticket.isCurrent()) {
        setRequestStatus(utterance.id, 'cancelled')
      }
      else if (activeAgentRequest?.decisionEntryId !== utterance.id && requestStatuses.value[utterance.id] === 'processing') {
        const route = decisionEntries.value.find(entry => entry.id === utterance.id)?.route
        setRequestStatus(utterance.id, route === 'ignored' ? 'cancelled' : ['unavailable', 'execution_failed', 'incomplete'].includes(route ?? '') ? 'failed' : 'completed')
      }
      const receipt = firstResponseTurns.get(utterance.id)
      if (receipt) {
        interactionTurn.complete(receipt)
        turnTimings.delete(receipt.id)
        firstResponseTurns.delete(utterance.id)
      }
      if (!ticket.isCurrent())
        decisionProgress.cancel(utterance.id)
      else
        decisionProgress.finish(utterance.id, { kind: 'UNAVAILABLE', reason: 'PROVIDER_FAILURE' })
      if (fastPathProgress.value?.utteranceId === utterance.id)
        fastPathProgress.value = undefined
    }
  },
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
const conversationSending = computed(() => (
  Boolean(fastPathProgress.value) || interactionTurn.phase.value === 'thinking' || interactionTurn.phase.value === 'using-tool'
))
const { animation: activeMotionAnimation, loop: activeMotionLoop, play: playTransientMotion } = useKioskCharacterMotion({
  animations: () => props.motionAnimations,
  idleAnimation: () => props.idleAnimation,
  phase: interactionTurn.phase,
  busy: conversationSending,
  client: interactiveServiceClient,
})
const voiceDiagnosticsEnabled = computed(() => Boolean(props.deviceSettings?.voiceDiagnosticsEnabled) || adminVoiceTestActive.value)
const conversationDiagnosticsEnabled = computed(() => Boolean(props.deviceSettings?.conversationDiagnosticsEnabled))
const stageBackgroundStyle = computed(() => props.sceneBackgroundUrl
  ? { backgroundImage: `linear-gradient(180deg, rgb(4 16 18 / 14%), rgb(3 12 14 / 52%)), url("${props.sceneBackgroundUrl}")` }
  : undefined,
)

watch(conversationDiagnosticsEnabled, (enabled) => {
  if (!enabled)
    conversationExecutionDurationMs.value = undefined
})

function startVoiceDiagnostic(status: KioskVoiceDiagnosticEntry['status'] = 'recognizing', reason?: string) {
  const id = ++nextVoiceDiagnosticId
  if (!voiceDiagnosticsEnabled.value)
    return id
  const entry: KioskVoiceDiagnosticEntry = { id, status, reason, events: [{ status, at: Date.now() }] }
  voiceDiagnosticEntries.value = [
    ...voiceDiagnosticEntries.value,
    entry,
  ].slice(-8)
  return id
}

function updateVoiceDiagnostic(id: number, patch: Omit<Partial<KioskVoiceDiagnosticEntry>, 'id'>) {
  if (!voiceDiagnosticsEnabled.value)
    return
  voiceDiagnosticEntries.value = voiceDiagnosticEntries.value.map(entry => entry.id === id ? { ...entry, ...patch, events: patch.status && patch.status !== entry.status ? [...(entry.events ?? []), { status: patch.status, at: Date.now() }] : entry.events } : entry)
}
const interactionActivityStatus = computed(() => {
  if (interactionTurn.phase.value === 'hearing-speech')
    return '正在聆聽…'
  if (interactionTurn.phase.value === 'transcribing')
    return '正在辨識語音…'
  if (interactionTurn.phase.value === 'using-tool')
    return conversationWorkStatus.value ?? '正在確認資訊…'
  if (interactionTurn.phase.value === 'thinking')
    return conversationWorkStatus.value ?? '已收到你的需求，正在處理…'
  return undefined
})
const interactiveServices = useKioskInteractiveServices()
const activeCatalogLabels = computed(() => interactiveServices.value.find(service => service.id === scenarioRegistry.activeScenario.value?.id && service.serviceUrl === scenarioRegistry.activeScenario.value?.serviceUrl)?.catalogLabels)
const browserDialogue = createBrowserDialogue({
  owner: () => interactionRecording.visitorSessionId.value,
  documentId: () => interactiveServiceClient.getDocumentId(),
  catalogLabels: () => activeCatalogLabels.value,
  answer: async (answer) => {
    const owner = interactionRecording.visitorSessionId.value
    if (!owner)
      return { kind: 'UNCERTAIN', provider: 'unavailable' }
    return decideBrowserAnswer(owner, answer, AbortSignal.timeout(serviceRecoveryLimits.turnMs))
  },
})
const agentOrderOwner = shallowRef<string>()
// BEGIN can succeed in Menu before its reply is lost. Retain the issued owner
// separately from acknowledged control so recovery can end only our own task.
const pendingAgentOrderOwner = shallowRef<string>()
watch(interactiveServiceClient.availability, (availability, previousAvailability) => {
  if (previousAvailability === 'manual-payment')
    conversationWorkStatus.value = undefined
  if (availability === 'unavailable' && (agentOrderOwner.value || pendingAgentOrderOwner.value))
    serviceRecoveryBlocked.value = true
})
// Native operations hold restart until their receipts settle. Model IO alone
// does not: an explicit restart cancels its turn before admitting a new visitor.
// operationId correlates completion; sessionId isolates late diagnostic events.
const activeServiceOperations = shallowReactive(new Map<string, { sessionId: string | undefined, utteranceId: number | undefined, started: number, toolName: string }>())
// Replaced connections can discard their late completion events. Retire those
// owners here so an old document cannot keep the next reception's button locked.
watch([interactiveServiceClient.availability, () => interactiveServiceClient.getDocumentId(), interactionRecording.visitorSessionId], () => activeServiceOperations.clear(), { flush: 'sync' })
// Read-only state polling stays quiet; activity reflects actual page controls
// and item presentation, correlated with their in-flight operation owners.
const pageOperating = computed(() => [...activeServiceOperations.values()].some(operation => !['browser_cart_get', 'browser_state_get', 'browser_recovery_context', 'browser_observe'].includes(operation.toolName)))
const stopToolDiagnostics = interactiveServiceClient.onExecution((event) => {
  if (event.phase === 'called') {
    activeServiceOperations.set(event.operationId, { sessionId: interactionRecording.visitorSessionId.value, utteranceId: currentAgentRequest()?.decisionEntryId ?? fastPathProgress.value?.utteranceId, started: performance.now(), toolName: event.tool.name })
  }
  const owner = activeServiceOperations.get(event.operationId)
  if (event.phase !== 'called')
    activeServiceOperations.delete(event.operationId)
  if (!owner || owner.sessionId !== interactionRecording.visitorSessionId.value)
    return
  if (event.phase === 'resolved' && ['browser_customer_reset', 'browser_reception_reset'].includes(event.tool.name)
    && event.result && typeof event.result === 'object' && 'ok' in event.result && event.result.ok === true
    && 'retiredOperation' in event.result && ['order', 'reset', 'cart'].includes(String(event.result.retiredOperation))) {
    // append captures the ending visitor now, before customer-session cleanup
    // closes it. This historical warning has no authority over the next visitor.
    void interactionRecording.append('service_event', JSON.stringify({ kind: 'browser_previous_operation_retired', operationKind: event.result.retiredOperation, resolution: event.tool.name === 'browser_reception_reset' ? 'host-only-initialization' : 'explicit-reception-reset', editableCartCleared: event.tool.name === 'browser_customer_reset', documentId: event.documentId, resetOperationId: event.operationId }), { source: 'browser_previous_operation_retired' })
  }
  if (event.phase === 'resolved' && event.result && typeof event.result === 'object'
    && 'source' in event.result && event.result.source === 'browser'
    && 'status' in event.result && event.result.status === 'unknown') {
    serviceRecoveryBlocked.value = true
  }
  const execution = safeParse(serviceOperationSchema, event.result && typeof event.result === 'object' && 'execution' in event.result ? event.result.execution : undefined)
  void interactionRecording.append('service_event', JSON.stringify({
    kind: 'browser_tool_metrics',
    ...(execution.success ? { execution: execution.output } : {}),
    connectionId: event.connectionId,
    documentId: event.documentId,
    operationId: event.operationId,
    utteranceId: owner.utteranceId,
    durationMs: performance.now() - owner.started,
    toolName: event.tool.name,
    phase: event.phase,
    ...(event.phase === 'failed' ? { error: event.error?.slice(0, 500) } : {}),
    ...(event.phase === 'resolved' && event.result && typeof event.result === 'object' && 'ok' in event.result && event.result.ok === false
      ? { receiptFailure: { ...('status' in event.result ? { status: event.result.status } : {}), ...('code' in event.result ? { code: event.result.code } : {}), ...('error' in event.result && typeof event.result.error === 'string' ? { error: event.result.error.slice(0, 500) } : {}) } }
      : {}),
  }), { source: 'browser_tool_metrics', utteranceId: owner.utteranceId })
})

onUnmounted(() => {
  stopToolDiagnostics()
  productPresentation.dispose()
})
const manualControlPending = shallowRef(false)
const paymentNavigationBusy = shallowRef(false)

function paymentReturnOwner() {
  const page = gatewayPage.value
  const generation = receptionGeneration
  return () => !!page && generation === receptionGeneration && !manualControlPending.value
    && scenarioRegistry.activeScenario.value?.id === page.serviceId && page.documentKey === `${page.serviceId}:${scenarioRegistry.iframeRevision.value}`
}

function showPaymentReply(message: string) {
  conversationMessages.value = [...conversationMessages.value, { role: 'assistant', content: message, slices: [], tool_results: [] }]
}

function requestManualOrderControl() {
  manualControlPending.value = true
  utteranceQueue.reset()
  decisionProgress.cancel()
  // Keep this turn current so its last accepted receipt can still be presented.
  // Speech may not replace it while ownership is being returned.
  if (activeAgentRequest)
    activeAgentRequest.stage = 'mutating'
  interactionRecording.requestManualControl()
}
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
const conversationFontSize = useKioskConversationFontSize()
const cameraStream = shallowRef<MediaStream>()
const {
  continueCurrentSession,
  hasCustomerActivity,
  hasPendingWork,
  idleDeadlineAt,
  notice,
  startNewCustomerSession: resetForNewCustomer,
  state: customerSessionState,
} = customerSession
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
  if (fastPathProgress.value || interactionTurn.phase.value === 'thinking' || interactionTurn.phase.value === 'using-tool') {
    return {
      description: fastPathProgress.value?.text ?? '我正在幫你確認菜單與點餐內容。',
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
    description: t('stage.kiosk.ordering-hint.description'),
    mode: 'listening',
    title: t('stage.kiosk.ordering-hint.title'),
  }
})
function rememberIdleQuestion(utteranceId: number) {
  if (customerSessionState.value === 'awaiting-idle-confirmation')
    idleUtterances.set(utteranceId, { deadline: idleDeadlineAt.value, generation: receptionGeneration })
}
const sessionNotice = computed(() => {
  if (customerSessionState.value === 'resetting')
    return t('stage.kiosk.restarting-order')
  return customerResetError.value ?? notice.value
})
const customerSessionButtonLabel = computed(() => (
  customerSessionState.value === 'standby' ? '開始新交談／新訂單' : '重新開始／新訂單'
))
const { idleDiagnosticsEnabled, presenceDiagnosticsEnabled, decisionDiagnosticsEnabled } = useKioskDiagnostics()
const feedbackInvitationSettings = useFeedbackInvitationSettings()
const orderContinuationUrl = shallowRef<string>()
watch(customerSessionState, (state) => {
  if (state === 'standby')
    orderContinuationUrl.value = undefined
})
const proactiveSettings = computed(() => observationSettings(props.deviceSettings ?? defaultDeviceSettingsValues))
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
// Agent-originated completion travels in the interactive service tool result. Direct
// customer interaction continues to use the iframe lifecycle event registered
// below, so both routes converge on the same session transition.
watch(interactiveServiceClient.completionRevision, (revision, previousRevision) => {
  if (revision > previousRevision)
    handleScenarioCompleted()
})
usePaidOrderCompletion(interactiveServiceClient, () => {
  if (customerSessionState.value === 'resetting' || customerSessionState.value === 'completing')
    return
  if (customerSessionState.value === 'awaiting-idle-confirmation')
    continueCurrentSession()
  void handleScenarioCompleted()
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
const voicePresence = createVoicePresenceGate()
const lastPresenceCandidate = shallowRef<Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'>>()
let visualEngagementProtectionStartedAtMs: number | undefined
const presenceDiagnostics = shallowRef<{ cadenceTier: 'idle' | 'boost' | 'stable', faceActive: boolean, poseIntervalMs: number }>({ cadenceTier: 'idle', faceActive: false, poseIntervalMs: performanceSettings.value.detectionIntervalMs })
const avatarState = shallowRef<'pending' | 'loading' | 'mounted'>('pending')
let avatarLoadingAt = performance.now()
watch(avatarState, (state) => {
  if (state === 'loading') {
    avatarLoadingAt = performance.now()
    console.info('[webnavior-performance]', JSON.stringify({ kind: 'model', model: 'avatar', phase: 'start', durationMs: 0 }))
  }
  else if (state === 'mounted') {
    console.info('[webnavior-performance]', JSON.stringify({ kind: 'model', model: 'avatar', phase: 'ready', durationMs: Math.round(performance.now() - avatarLoadingAt) }))
  }
})
const localObservationRequired = computed(() => {
  // Voice admission also needs live inference in standby, including devices
  // whose greetings and reminders are disabled. No VLM request is involved.
  return proactiveSettings.value.observation.enabled
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
// KioskScene wires admission; the camera owns observations, mouthActivity owns
// visual continuity, and VAD owns bounded PCM and whole-phrase segmentation.
const mouthTrackingRequired = computed(() => mouthAssistanceEnabled.value && props.voiceConversationOnly && enabled.value && !adminPanelOpen.value)
const proactiveVision = useKioskProactiveVision({
  detectionConfidence: () => props.deviceSettings?.faceDetectionConfidence ?? defaultDeviceSettingsValues.faceDetectionConfidence,
  detectionEnabled: () => localObservationRequired.value || mouthTrackingRequired.value,
  mouthTrackingEnabled: () => mouthTrackingRequired.value,
  onMouthObservation: (timeMs, mouth) => {
    mouthActivity.observe(timeMs, mouth)
    mouthStartAllowed.value = mouthActivity.allowsStart(timeMs)
  },
  onTargetChange: resetVisualSpeech,
  onTarget: target => customerTarget.value = target,
  detectionZone: () => proactiveSettings.value.observation.detectionZone,
  interactionZone: () => presenceSettings.interactionRoi,
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
    voicePresence.reset()
    mouthActivity.reset()
    mouthStartAllowed.value = false
    cameraStream.value = stream
    mediaCapture.attachCameraStream(stream)
  },
  onObservation: observation => void handleProactiveObservation(observation),
  onPresenceCandidate: candidate => handlePresenceCandidate(candidate),
  onDiagnostics: diagnostics => presenceDiagnostics.value = diagnostics,
})
const cameraRequired = computed(() => mouthTrackingRequired.value || localObservationRequired.value || effectiveMediaCaptureMode.value !== 'off')
function voiceBlockReason(): string | undefined {
  if (adminPanelOpen.value)
    return adminVoiceTestActive.value ? undefined : 'admin-paused'
  if (!props.voiceConversationOnly)
    return 'text-mode'
  if (customerSessionState.value === 'completing' || customerSessionState.value === 'resetting')
    return 'reception-reset'
  if (!allowsObservedVoice(visualSpeechRequired.value))
    return 'presence-required'
}
function allowsObservedVoice(requireVisualPresence = true) {
  if (adminPanelOpen.value || !props.voiceConversationOnly)
    return false
  if (customerSessionState.value === 'completing' || customerSessionState.value === 'resetting')
    return false
  // Proactive greetings still require observation. Ordinary speech may opt out
  // without disabling the independent camera/presence policy for greetings.
  return voicePresence.allows({ enabled: requireVisualPresence && localObservationRequired.value, observing: proactiveVision.status.value === 'observing', nowMs: performance.now() })
}
const { x, y } = useMouse()
const cursorPosition = computed(() => ({ x: x.value, y: y.value }))
let stopAssistantAudio: (() => void) | undefined
let activeVoiceCandidate: ReturnType<typeof interactionTurn.beginCustomerVoiceCandidate> | undefined
watch(adminPanelOpen, (open) => {
  adminVoiceTestEnabled.value = false
  if (open) {
    cancelReceptionWork()
    if (activeVoiceCandidate)
      interactionTurn.completeVoiceCandidate(activeVoiceCandidate)
    activeVoiceCandidate = undefined
  }
}, { flush: 'sync' })

let captureDuringPlayback = false
let captureDiagnosticId: number | undefined
const adminVoiceTest = useKioskVoiceTest({
  active: adminVoiceTestActive,
  locale: () => language.value,
  testText: () => t('stage.kiosk.voice-debug.test-text'),
  transcribe: transcribeKioskAudio,
  synthesize: synthesizeKioskSpeech,
  onResult: (result) => {
    const id = startVoiceDiagnostic(result.status)
    updateVoiceDiagnostic(id, result)
  },
})
const processingCue = useKioskProcessingCue(
  () => speechPreparationCount.value > 0 || transcriptionCount.value > 0 || Boolean(utteranceQueueState.value.active) || utteranceQueueState.value.pending.length > 0 || Boolean(currentAgentRequest()),
  () => paused.value || adminPanelOpen.value || serviceRecoveryBlocked.value || customerSessionState.value === 'completing' || customerSessionState.value === 'resetting',
  () => processingSpeechActive.value,
  () => transcriptionCount.value > 0 || utteranceQueueState.value.pending.length > 0,
)
const voiceEvents = {
  onSpeechStart: () => {
    if (discardSpeechUntilBoundary)
      return
    captureDuringPlayback = processingSpeechActive.value
    const blocked = adminVoiceTestActive.value ? undefined : voiceBlockReason()
    captureDiagnosticId = startVoiceDiagnostic(blocked ? 'blocked' : 'speech-start', blocked ?? ((adminVoiceTest.speaking.value || interactionTurn.phase.value === 'speaking') ? 'tts-overlap' : undefined))
    if (adminVoiceTestActive.value) {
      adminVoiceTest.interrupt()
      return
    }
    if (!allowsObservedVoice(visualSpeechRequired.value))
      return
    activeMouthLease = mouthActivity.begin(performance.now())
    if (activeMouthLease === undefined)
      return
    // Retiring audio settings cancels unsubmitted ASR as well as its partial
    // capture; already accepted queue entries keep their ordering ownership.
    captureRecognitionSignal = AbortSignal.any([...(mouthAssistanceEnabled.value ? [targetCaptureController.signal] : []), ...(audioCaptureController ? [audioCaptureController.signal] : [])])
    // Enforce retains semantic admission. Off/observe may stop only playback
    // through local VAD evidence, without cancelling this Agent/tool turn.
    activeVoiceCandidate = interactionTurn.beginCustomerVoiceCandidate()
    speechInterruption.begin(activeVoiceCandidate.id)
  },
  onSpeechProbability: (probability: number, timeMs: number) => {
    if (adminVoiceTestActive.value)
      return
    const interrupt = speechInterruption.observe(activeVoiceCandidate?.id, timeMs, probability, props.voiceVadSettings.threshold, !discardSpeechUntilBoundary && !voiceBlockReason() && mouthActivity.complete(activeMouthLease, timeMs), backgroundSpeechMode.value)
    interruptionDiagnostic.value = speechInterruption.snapshot()
    if (interrupt) {
      interruptAssistantOutput()
      updateVoiceDiagnostic(captureDiagnosticId ?? startVoiceDiagnostic(), { status: 'interrupted', reason: 'local-interruption' })
    }
  },
  onSpeechEnd: () => {
    if (captureDiagnosticId !== undefined)
      updateVoiceDiagnostic(captureDiagnosticId, { status: 'speech-end' })
  },
  onSpeechReady: (event: VADEvents['speech-ready']) => {
    const { buffer } = event
    if (discardSpeechUntilBoundary) {
      discardSpeechUntilBoundary = event.truncated === true
      return
    }
    if (adminVoiceTestActive.value) {
      void adminVoiceTest.transcribe(buffer)
      return
    }
    // Release this capture slot before ASR so another final utterance can be
    // transcribed independently while the first is waiting for a decision.
    const candidate = activeVoiceCandidate
    activeVoiceCandidate = undefined
    if (!candidate)
      return
    if (captureRecognitionSignal?.aborted) {
      speechInterruption.release(candidate.id)
      interactionTurn.completeVoiceCandidate(candidate)
      return
    }
    if (!allowsObservedVoice(visualSpeechRequired.value)) {
      speechInterruption.release(candidate.id)
      interactionTurn.completeVoiceCandidate(candidate)
      return
    }
    const mouthLease = activeMouthLease
    activeMouthLease = undefined
    if (!mouthActivity.complete(mouthLease, performance.now()) || event.truncated) {
      // A lost/replaced target revokes the entire phrase, even if that target
      // reappears before ASR. Truncated tails cannot become another order.
      discardSpeechUntilBoundary = event.truncated === true
      const message = t(event.truncated ? 'stage.kiosk-agent.voice-capture-incomplete' : 'stage.kiosk-agent.voice-capture-mouth')
      pendingTranscript.value = message
      updateVoiceDiagnostic(captureDiagnosticId ?? startVoiceDiagnostic(), { status: 'ignored', text: message })
      interactionTurn.completeVoiceCandidate(candidate)
      speechInterruption.release(candidate.id)
      return
    }
    const reservation = utteranceQueue.reserve('asr', captureDuringPlayback)
    if (reservation.kind === 'OVERLOADED') {
      speechInterruption.release(candidate.id)
      interactionTurn.completeVoiceCandidate(candidate)
      pendingTranscript.value = '目前語句太多，請稍後再說一次。'
      return
    }
    void processVoiceCandidate(buffer, candidate, reservation, captureDiagnosticId, captureRecognitionSignal)
  },
}
const { dispose, inferenceError, init, loaded, start, processAudio, isSpeech: vadIsSpeech, isSpeechProb: vadProbability } = useVAD(workletUrl, {
  externalPCM: arrayMicrophone,
  // Customer ASR uses optional visual onset admission; the administrator's
  // microphone test bypasses it. A discarded
  // tail still runs VAD until silence, but can never create a customer candidate.
  canStartSpeech: () => adminVoiceTestActive.value || discardSpeechUntilBoundary || (!voiceBlockReason() && mouthActivity.allowsStart(performance.now())),
  threshold: computed(() => props.voiceVadSettings.threshold),
  minSpeechDurationMs: computed(() => props.voiceVadSettings.minSpeechDurationMs),
  maxSpeechDurationS: computed(() => props.voiceVadSettings.maxSpeechDurationS),
  minSilenceDurationMs: computed(() => props.voiceVadSettings.minSilenceDurationMs),
  // Two 10 fps visual observations can arrive after audio onset. Keep at least
  // 400 ms of source PCM, while preserving a larger operator-configured pad.
  speechPadMs: computed(() => adminVoiceTestActive.value ? props.voiceVadSettings.speechPadMs : Math.max(400, props.voiceVadSettings.speechPadMs)),
  ...voiceEvents,
})
const isSpeech = computed(() => vadIsSpeech.value)
const isSpeechProb = computed(() => vadProbability.value)

// Poll only while operator diagnostics are visible; samples themselves remain
// owned by the capture/VAD path and are never retained for this snapshot.
useIntervalFn(() => {
  if (!adminPanelOpen.value || !arrayRoute.pcmSource.value)
    return
  const statistics = arrayRoute.pcmSource.value.statistics
  arrayDiagnostics.value = {
    inputDb: arrayLevels.inputDb,
    outputDb: arrayLevels.outputDb,
    peak: arrayLevels.peak,
    limitedPercent: arrayLevels.samples ? arrayLevels.limited * 100 / arrayLevels.samples : 0,
    lagMs: statistics.lagSeconds * 1000,
    referenceSignalFrames: 0,
    inputFrames: statistics.inputFrames,
    outputFrames: statistics.outputFrames,
  }
}, 250)
const isAudioListening = computed(() => enabled.value && audioInputStarted.value && !inferenceError.value && customerSessionState.value !== 'completing' && customerSessionState.value !== 'resetting')

// Diagnostic snapshots contain lifecycle state only, never audio, images or
// device identifiers. An existing visitor session owns each persisted snapshot.
watch([interactionRecording.visitorSessionId, () => JSON.stringify({
  enabled: enabled.value,
  mode: 'asr',
  processing: arrayMicrophone.value ? 'master-spatial-mask' : 'browser-vad',
  vadLoaded: loaded.value,
  listening: isAudioListening.value,
  microphoneTracks: stream.value?.getAudioTracks().map(track => ({ state: track.readyState, muted: track.muted })) ?? [],
  captureSource: 'browser',
  physicalChannels: arrayRoute.channelCount.value,
  inputFailure: settingsAudioDeviceStore.inputError,
  inputConstraints: settingsAudioDeviceStore.inputConstraints,
  microphonePermission: settingsAudioDeviceStore.permissionState,
  error: ((settingsAudioDeviceStore.inputError?.message || inferenceError.value) || audioStartupError.value)?.slice(0, 300),
})], ([sessionId, snapshot]) => {
  if (sessionId && voiceDiagnosticsEnabled.value)
    void interactionRecording.append('service_event', snapshot, { source: 'audio_runtime' })
})

async function startAudioInteraction() {
  stopAudioInteraction()
  const attempt = ++audioCaptureAttempt
  const controller = new AbortController()
  audioCaptureController = controller
  const input = stream.value
  audioStartupError.value = undefined
  try {
    if (controller.signal.aborted || attempt !== audioCaptureAttempt || !input || input !== stream.value || !enabled.value || (!props.voiceConversationOnly && !adminVoiceTestActive.value))
      return
    const modelStartedAt = loaded.value ? undefined : performance.now()
    if (modelStartedAt !== undefined)
      console.info('[webnavior-performance]', JSON.stringify({ kind: 'model', model: 'vad', phase: 'start', durationMs: 0 }))
    try {
      await init()
    }
    finally {
      if (modelStartedAt !== undefined)
        console.info('[webnavior-performance]', JSON.stringify({ kind: 'model', model: 'vad', phase: loaded.value ? 'ready' : 'failed', durationMs: Math.round(performance.now() - modelStartedAt) }))
    }
    if (!loaded.value)
      throw new Error(inferenceError.value || 'VAD initialization failed.')
    const pcm = arrayRoute.pcmSource.value
    if (pcm) {
      const gain = new InputGain()
      const origin = performance.now()
      let outputFrames = 0
      pcm.start(async (samples) => {
        if (controller.signal.aborted || attempt !== audioCaptureAttempt)
          return
        const result = gain.process(samples, arrayRoute.inputGainDb.value)
        const inputLevel = measurePcmLevel(samples)
        const outputLevel = measurePcmLevel(result.samples)
        arrayLevels.inputDb = inputLevel.rmsDbfs ?? -Infinity
        arrayLevels.outputDb = outputLevel.rmsDbfs ?? -Infinity
        arrayLevels.peak = outputLevel.peakDbfs === null ? 0 : 10 ** (outputLevel.peakDbfs / 20)
        arrayLevels.limited += result.clippedSamples
        arrayLevels.samples += result.samples.length
        outputFrames += result.samples.length
        await processAudio(result.samples, origin + outputFrames / 16, result.samples)
      })
    }
    else {
      await start(input)
    }
    if (!controller.signal.aborted && attempt === audioCaptureAttempt)
      audioInputStarted.value = true
  }
  catch (error) {
    if (!controller.signal.aborted && attempt === audioCaptureAttempt)
      throw error
  }
}

async function processVoiceCandidate(
  buffer: Float32Array,
  candidate: NonNullable<ReturnType<typeof interactionTurn.beginCustomerVoiceCandidate>>,
  reservation: Extract<KioskUtteranceReservation, { kind: 'ACCEPTED' }>,
  captureId?: number,
  recognitionSignal?: AbortSignal,
) {
  if (buffer.length === 0 || !allowsObservedVoice(visualSpeechRequired.value)) {
    speechInterruption.release(candidate.id)
    reservation.cancel()
    interactionTurn.completeVoiceCandidate(candidate)
    return
  }
  const diagnosticId = captureId ?? startVoiceDiagnostic()
  updateVoiceDiagnostic(diagnosticId, { status: 'recognizing' })
  voiceDiagnosticByUtterance.set(reservation.id, diagnosticId)
  let submitted = false
  let disposition = 'recognition-failed'
  let recognizedCharacters: number | undefined
  const startedAt = performance.now()
  const sessionId = interactionRecording.visitorSessionId.value
  const serviceId = scenarioRegistry.activeScenario.value?.id
  const transcriptionContext = serviceId ? { serviceId, menuNames: productPresentation.menuNames() } : undefined
  let requestMs: number | undefined
  // Capture stays silent until semantic admission. Empty ASR and background
  // IGNORE results must never produce a receipt or waiting music.
  transcriptionCount.value++
  if (sessionId)
    void interactionRecording.append('service_event', 'voice_recognition_started', { utteranceId: reservation.id, source: 'asr' })
  try {
    const signal = AbortSignal.any([candidate.signal, reservation.signal, ...(recognitionSignal ? [recognitionSignal] : [])])
    const { recording, text } = await transcribeKioskUtterance(buffer, {
      signal,
      transcribe: (recording, signal, chunk) => transcribeKioskAudio(recording, signal, chunk, transcriptionContext),
    })
    requestMs = performance.now() - startedAt
    recognizedCharacters = text.trim().length
    signal.throwIfAborted()
    if (!allowsObservedVoice(visualSpeechRequired.value)) {
      disposition = 'presence-changed'
      updateVoiceDiagnostic(diagnosticId, { status: 'blocked', reason: disposition })
      return
    }
    if (!text.trim()) {
      disposition = 'empty-transcript'
      updateVoiceDiagnostic(diagnosticId, { status: 'unrecognized' })
      return
    }
    updateVoiceDiagnostic(diagnosticId, { status: 'recognized', text })
    if (!interactionTurn.isCurrentVoiceCandidate(candidate)) {
      // Capture ownership is retired by cancellation/reset, not elapsed time.
      disposition = 'retired-capture'
      updateVoiceDiagnostic(diagnosticId, { status: 'interrupted', reason: disposition })
      return
    }
    if (sessionId && sessionId === interactionRecording.visitorSessionId.value)
      void interactionRecording.recordTranscript({ id: reservation.id, text, source: 'asr', recognitionMode: 'legacy' })
    reservation.complete({ recording, text, recognitionMode: 'legacy' })
    submitted = true
    disposition = 'submitted'
    pendingTranscript.value = undefined
  }
  catch (error) {
    const cancelled = candidate.signal.aborted || reservation.signal.aborted || recognitionSignal?.aborted
    disposition = cancelled ? 'cancelled' : 'recognition-failed'
    updateVoiceDiagnostic(diagnosticId, { status: cancelled ? 'interrupted' : 'failed', reason: disposition })
    if (!cancelled) {
      pendingTranscript.value = t(error instanceof KioskDeviceRequestError && error.status === 413 ? 'stage.kiosk-agent.audio-too-large' : 'stage.kiosk-agent.audio-failed')
      console.error('Failed to process kiosk voice candidate:', error)
    }
  }
  finally {
    speechInterruption.release(candidate.id)
    interruptionDiagnostic.value = speechInterruption.snapshot()
    transcriptionCount.value--
    if (sessionId && sessionId === interactionRecording.visitorSessionId.value) {
      // This clock covers the ASR request, separately from the existing
      // decision/tool clock. No customer audio or text is added to this event.
      void interactionRecording.append('service_event', JSON.stringify({ kind: 'voice_recognition_timing', mode: 'asr', elapsedMs: performance.now() - startedAt, requestMs, audioMs: buffer.length / 16, submitted, disposition, recognizedCharacters, backgroundSpeechMode: backgroundSpeechMode.value }), { source: 'voice_recognition_timing', utteranceId: reservation.id })
    }
    reservation.cancel()
    if (!submitted)
      voiceDiagnosticByUtterance.delete(reservation.id)
    interactionTurn.completeVoiceCandidate(candidate)
  }
}

/** One final ASR utterance enters the same decision path in live and test mode. */
async function processKioskUtterance(utterance: KioskUtterance, ticket: KioskUtteranceTicket) {
  if (!ticket.isCurrent() || customerSessionState.value === 'completing' || customerSessionState.value === 'resetting')
    return
  const idleOwner = idleUtterances.get(utterance.id)
  if (idleOwner && (customerSessionState.value !== 'awaiting-idle-confirmation' || idleOwner.deadline !== idleDeadlineAt.value || idleOwner.generation !== receptionGeneration))
    return
  const timing = createUtteranceTiming(utterance.id, utterance.capturedAt)
  utteranceTimings.set(utterance.id, timing)
  if (utteranceTimings.size > 20)
    utteranceTimings.delete(utteranceTimings.keys().next().value!)
  if (turnTimings.size > 40)
    turnTimings.delete(turnTimings.keys().next().value!)
  timing.mark('admitted')
  // Background speech must not abort an accepted compound operation. Required
  // browser work supersedes passive cues through the document's FIFO executor.
  // A captured utterance may have waited behind a tool round. Recheck before
  // Jev/Main, without cancelling already-issued commerce work or touch input.
  if (utterance.source === 'asr' && !allowsObservedVoice(visualSpeechRequired.value)) {
    finishVoiceDiagnostic(utterance.id, 'ignored')
    return
  }
  // VAD can already have silenced playback by the time the queued transcript arrives.
  if (requestsReadingStop(utterance.text, utterance.source === 'simulation' ? processingSpeechActive.value : !!utterance.duringPlayback)) {
    interruptAssistantOutput()
    const generation = receptionGeneration
    let question = ''
    if (customerSessionState.value === 'awaiting-idle-confirmation') {
      question = t('stage.kiosk-agent.continue-session-question')
    }
    else {
      const browser = conversationSource(interactiveServiceClient.tools.value) === 'browser'
      const tool = interactiveServiceClient.tools.value.find(tool => tool.name === (browser ? 'browser_cart_get' : 'kiosk_interaction_state'))
      if (tool) {
        try {
          const facts = await interactiveServiceClient.execute(tool, browser ? { includeCatalog: true } : {})
          if (!ticket.isCurrent() || generation !== receptionGeneration)
            return
          question = browser ? browserDialogue.readingFollowUp(facts) : conversationDecisionStateFrom(facts)?.waitingFor?.question ?? ''
        }
        catch {
          // Keep the screen usable even if the embedded service cannot return its current question.
        }
      }
    }
    if (!ticket.isCurrent() || generation !== receptionGeneration)
      return
    const message = t('stage.kiosk-agent.reading-stopped', { question: question || t('stage.kiosk-agent.next-request') })
    conversationMessages.value = [...conversationMessages.value, { role: 'assistant', content: message, slices: [], tool_results: [] }]
    finishVoiceDiagnostic(utterance.id, 'decided')
    if (utterance.source === 'simulation')
      asrSimulationStatus.value = message
    await recordUtteranceEvidence({ ...utterance, signal: ticket.signal })
    return
  }
  if (customerSessionState.value === 'awaiting-idle-confirmation') {
    const deadline = idleDeadlineAt.value
    const visitor = interactionRecording.visitorSessionId.value
    if (!deadline || deadline <= Date.now())
      return
    const choices = [{ id: 'session:continue', description: '繼續目前點餐，不新增或修改餐點。' }, { id: 'session:end', description: '結束目前接待，清除未送出的購物車並返回選桌頁。' }]
    const questionId = `idle:${receptionGeneration}:${deadline}`
    const isCurrent = () => ticket.isCurrent() && customerSessionState.value === 'awaiting-idle-confirmation' && idleDeadlineAt.value === deadline && interactionRecording.visitorSessionId.value === visitor && Date.now() < deadline
    try {
      const decision = await decideKioskInteraction({
        transcript: utterance.text,
        candidates: choices,
        visitorSessionId: visitor,
        utteranceId: utterance.id,
        decisionState: { phase: 'idle_confirmation', waitingFor: { questionId, purpose: 'idle-confirmation', question: '要繼續點餐嗎？', choices, expiresAt: deadline } },
        signal: AbortSignal.any([ticket.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]),
        isCurrent,
      })
      if (!isCurrent())
        return
      if (decision.kind === 'FAST_ACTION' && decision.answeredQuestionId === questionId) {
        if (decision.actionId === 'session:continue')
          continueCurrentSession()
        else if (decision.actionId === 'session:end')
          await restartCustomerSession()
      }
      else {
        asrSimulationStatus.value = '請先選擇繼續點餐或結束。剛才的其他需求未執行。'
      }
    }
    catch {
      // No website operation was dispatched. Keep the original countdown and
      // touch choices; never hand this speech to ordinary ordering or requeue it.
      if (isCurrent())
        asrSimulationStatus.value = '請在畫面選擇繼續點餐或結束。'
    }
    return
  }
  const cashier = gatewayPage.value
  if (cashier?.gatewayOrder && interactiveServiceClient.availability.value === 'manual-payment') {
    const choice = requestsPaymentReturn(utterance.text) ? 'back' : paymentChoiceFromSpeech(utterance.text)
    const guidance = choice ? undefined : paymentOptionsReply(utterance.text, undefined, true)
    if ((!choice && !guidance) || manualControlPending.value || paymentNavigationBusy.value) {
      finishVoiceDiagnostic(utterance.id, 'ignored')
      return
    }
    const generation = receptionGeneration
    await currentAgentRequest()?.done
    const current = () => ticket.isCurrent() && generation === receptionGeneration && !manualControlPending.value
      && scenarioRegistry.activeScenario.value?.id === cashier.serviceId && cashier.documentKey === `${cashier.serviceId}:${scenarioRegistry.iframeRevision.value}`
    if (!current())
      return
    if (paymentNavigationBusy.value || !current()) {
      finishVoiceDiagnostic(utterance.id, 'ignored')
      return
    }
    paymentNavigationBusy.value = true
    let result
    try {
      result = guidance ? { ok: true, customerMessage: guidance } : await switchPayment(cashier, choice!, current)
    }
    finally {
      paymentNavigationBusy.value = false
    }
    if (!current())
      return
    const message = result.customerMessage
    finishVoiceDiagnostic(utterance.id, result.ok ? 'decided' : 'failed')
    conversationMessages.value = [...conversationMessages.value, { role: 'assistant', content: message, slices: [], tool_results: [] }]
    if (utterance.source === 'simulation')
      asrSimulationStatus.value = message
    const turn = interactionTurn.begin('voice', 'speaking')
    try {
      await speakAssistantReply(message, turn)
    }
    finally {
      if (interactionTurn.isCurrent(turn))
        interactionTurn.complete(turn)
    }
    return
  }
  const input: FastPathInput = { ...utterance, deadlineAt: Date.now() + serviceRecoveryLimits.turnMs, signal: AbortSignal.any([ticket.signal, AbortSignal.timeout(serviceRecoveryLimits.turnMs)]) }
  const entry: KioskDecisionEntry = {
    id: utterance.id,
    route: 'deciding',
    source: utterance.source,
    startedAt: utterance.capturedAt,
    transcript: utterance.text,
  }
  decisionEntries.value = [...decisionEntries.value, entry].slice(-20)
  let serviceRecoveryUsed = false
  let recordedFastPathInput = false
  let admittedBrowserDemand = false
  let latestDecisionTrace: unknown
  // These totals belong to this utterance, across re-decisions/read review.
  // Repeated execution trace notifications must not count the same call twice.
  let requestDurationMs = 0
  let modelDurationMs: number | undefined = 0
  let modelCalls: number | undefined = 0
  let modelQuestions: number | undefined = 0
  let firstResultDurationMs: number | undefined
  let shownInput = true
  let earlyReplyIndex: number | undefined
  const earlyReadMessages: string[] = []
  if (utterance.source === 'simulation') {
    // Explicit test input needs evidence even when admission stays silent or
    // fails. ASR diagnostics are not customer dialogue or write authorization.
    await interactionRecording.start(scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction')
    if (!ticket.isCurrent())
      return
    await recordUtteranceEvidence(utterance)
    recordedFastPathInput = true
  }
  for (let attempt = 0; attempt < 3 && ticket.isCurrent(); attempt++) {
    decisionProgress.start(utterance.id, utterance.source, input.deadlineAt! - serviceRecoveryLimits.turnMs)
    if (utterance.source === 'simulation') {
      void nextTick(() => {
        if (ticket.isCurrent())
          timing.markFirst('input-receipt-dom-ready')
      })
    }
    const active = currentAgentRequest()
    let selectedTurn: ReturnType<typeof interactionTurn.begin> | undefined
    const acknowledgeService = () => {
      timing.markFirst('service-admitted')
      if (!ticket.isCurrent() || input.signal?.aborted || (utterance.source === 'asr' && !allowsObservedVoice(visualSpeechRequired.value)))
        return
      if (utterance.source === 'asr' && utterance.recognitionMode === 'legacy')
        processingCue.acknowledge({ utteranceId: utterance.id, recognitionMode: 'legacy', stage: 'service' })
      // Retain service speech once admitted; unrelated background captures do
      // not start new visitor recordings merely because ASR finished.
      void recordUtteranceEvidence(input).catch(error => console.error('Failed to record admitted speech:', error))
      // Admission is not permission to interrupt accepted work. A neutral
      // receipt may replace idle/proactive speech, never an existing order owner.
      if (currentAgentRequest() || agentOrderOwner.value || pendingAgentOrderOwner.value || manualControlPending.value)
        return
      const previous = firstResponseTurns.get(utterance.id)
      if (previous) {
        if (interactionTurn.isCurrent(previous))
          selectedTurn = previous
        return
      }
      interruptAssistantOutput()
      const turn = interactionTurn.begin('voice', 'thinking')
      selectedTurn = turn
      firstResponseTurns.set(utterance.id, turn)
      turnTimings.set(turn.id, timing)
      fastPathProgress.value = { utteranceId: utterance.id, text: t('stage.kiosk.wait.receipt') }
      void nextTick(() => {
        if (ticket.isCurrent() && interactionTurn.isCurrent(turn))
          timing.markFirst('first-response-dom-ready', undefined, 'progress')
      })
    }
    // Keep the owner when a failed/native navigation clears discovered tools.
    const browserOrdering = conversationSource(interactiveServiceClient.tools.value) === 'browser'
    const result = await runFastPath({
      isEnabled: isKioskFastPathEnabled,
      source: browserOrdering
        ? createBrowserFastPathSource({
            tools: interactiveServiceClient.tools.value,
            read: async (tool, args) => {
              await interactionRecording.start(scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction')
              return interactiveServiceClient.execute(tool, args)
            },
            hasPendingQuestion: browserDialogue.hasPending,
            canAnswerLocally: (raw, transcript) => browserDialogue.canAnswerLocally(raw, transcript),
            previousRecommendations: refs => productPresentation.filterRecommendations(refs),
            shownRecommendations: () => productPresentation.shownRecommendations(),
            recommendationPool: products => browserDialogue.recommendations.filter(labelCatalog(products, activeCatalogLabels.value)).map(product => product.ref),
            pendingQuestion: raw => browserDialogue.conversation(raw).waitingFor,
            checkoutStep: raw => browserDialogue.checkoutStep(raw),
            releaseService: (raw, questionId) => browserDialogue.releaseService(raw, questionId),
            catalogLabels: () => activeCatalogLabels.value,
            execute: async (tool, args) => {
              await interactionRecording.start(scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction')
              if (!admittedBrowserDemand) {
                const entry = await interactionRecording.append('user_text', utterance.text, { source: 'fast_path_browser', utteranceId: utterance.id })
                if (!entry || !ticket.isCurrent())
                  throw new Error('Current browser demand could not be recorded.')
                admittedBrowserDemand = true
              }
              const release = beginBrowserCartTask(utterance.text, {
                selectGateway: chooseGateway,
                intentSource: 'jev',
                utteranceId: utterance.id,
                informationUnavailable: () => t('stage.kiosk.information-unavailable'),
                servicePolicyReply: kind => t(`stage.kiosk.service-policy.${kind}`),
                checkoutGuidance: empty => t(`stage.kiosk.checkout-guidance.${empty ? 'empty' : 'ready'}`),
                dialogue: browserDialogue,
                presentation: productPresentation,
                catalogLabels: () => activeCatalogLabels.value,

                isCurrent: ticket.isCurrent,
                decide: async (proposal, plan) => {
                  const sessionId = interactionRecording.visitorSessionId.value
                  if (!sessionId)
                    throw new Error('Browser task requires the current visitor session.')
                  // Main records user_text before tool IO. The finite PB path
                  // must establish the same current-turn evidence before the
                  // Server may authorize its effect; ASR diagnostics are not it.
                  if (!admittedBrowserDemand) {
                    const entry = await interactionRecording.append('user_text', utterance.text, { source: 'fast_path_browser', utteranceId: utterance.id })
                    if (!entry)
                      throw new Error('Current browser demand could not be recorded.')
                    admittedBrowserDemand = true
                  }
                  timing.mark('plan-admission')
                  return admitBrowserPlan(sessionId, { effect: proposal, source: 'system-one', ...plan }, input.signal)
                },
              })
              try {
                timing.mark('browser-start', tool.name)
                let result: unknown
                if (tool.name === 'browser_add_items') {
                  const executed = await executeTool({ captureToolErrors: false, messages: [], tools: createBrowserOrderingTools(interactiveServiceClient), toolCall: { id: crypto.randomUUID(), type: 'function', function: { name: 'add_items_to_cart', arguments: JSON.stringify(args) } } })
                  if (typeof executed.message.content !== 'string')
                    throw new Error('Browser batch returned no receipt.')
                  result = JSON.parse(executed.message.content)
                }
                else {
                  result = tool.name === 'browser_answer_question'
                    ? await (await prepareBrowserQuestionAnswer(interactiveServiceClient, args))?.() ?? { ok: false, source: 'browser', effect: 'none', needsAssistant: true }
                    : tool.name === 'browser_ask_quantity'
                      ? await executeBrowserQuantityQuestion(interactiveServiceClient, args)
                      : tool.name === 'browser_close_product'
                        ? await cancelBrowserItemSelection(interactiveServiceClient)
                        : await executeBrowserCartTool(interactiveServiceClient, tool, args)
                }
                timing.mark('browser-finished', tool.name)
                return result
              }
              finally { release() }
            },
          })
        : undefined,
      serviceClarification: state => serviceClarificationWindow.current(state),
      activeRequest: active ? { stage: active.stage, text: active.text.slice(0, 240) } : undefined,
      decide: async (request) => {
        await interactionRecording.flush()
        const startedAt = performance.now()
        timing.mark('jev-start')
        let progressCalls = 0
        let progressDuration = 0
        // Each decision owns its checkpoints; retries cannot borrow admission.
        const admitFeedback = createDecisionFeedback()
        try {
          const decision = await decideKioskInteraction({ ...request, decisionState: invitationWindow.decisionState(request.decisionState, Date.now()), isCurrent: ticket.isCurrent, visitorSessionId: interactionRecording.visitorSessionId.value, utteranceId: utterance.id, recoveryUsed: serviceRecoveryUsed || request.recoveryUsed, budgetMs: Math.max(1, input.deadlineAt! - Date.now()), signal: request.signal ? AbortSignal.any([input.signal!, request.signal]) : input.signal, onProgress: (stage) => {
            if (!ticket.isCurrent())
              return
            firstResultDurationMs ??= requestDurationMs + performance.now() - startedAt
            if (stage.kind === 'SERVICE_RECOVERY_PROGRESS') {
              decisionProgress.recovery(utterance.id, stage)
              if (stage.status === 'completed' && stage.admission === 'service')
                acknowledgeService()
              updateDecisionEntry(utterance.id, { systemOneStep: stage.stage === 'adjudication' ? 'Main 有限裁決' : 'Main 完整理解' })
              return
            }
            progressCalls++
            progressDuration += stage.durationMs
            let systemOneStep = '正在確認回答關係或需求條件'
            if (stage.question === 'serviceRequest')
              systemOneStep = '服務需求判斷完成'
            else if (stage.question === 'recipient' || stage.question === 'service')
              systemOneStep = '服務對象判斷完成'
            else if (stage.question === 'route')
              systemOneStep = '意圖判斷完成'
            updateDecisionEntry(utterance.id, {
              systemOneStep,
              timing: { transcript: utterance.text, requestDurationMs: requestDurationMs + performance.now() - startedAt, modelCalls: modelCalls === undefined ? undefined : modelCalls + progressCalls, modelQuestions: modelQuestions === undefined ? undefined : modelQuestions + progressCalls, modelDurationMs: modelDurationMs === undefined ? undefined : modelDurationMs + progressDuration, firstResultDurationMs },
            })
            // Progress is provisional. Append customer text only on the final
            // accepted path or a real read receipt, so silent outcomes leave
            // no unanswered customer bubble behind.
            const admitted = admitFeedback(stage)
            if (admitted)
              acknowledgeService()
            decisionProgress.admit(utterance.id, admitted)
            if ((admitted || shownInput) && !currentAgentRequest())
              fastPathProgress.value = { utteranceId: utterance.id, text: t('stage.kiosk.wait.confirming') }
            else if (fastPathProgress.value?.utteranceId === utterance.id)
              fastPathProgress.value = undefined
          } })
          serviceRecoveryUsed ||= decision.recovery?.status === 'completed' || decision.recovery?.status === 'failed'
          if (ticket.isCurrent())
            invitationWindow.resolve(decision)
          modelCalls = modelCalls !== undefined && decision.modelCalls !== undefined ? modelCalls + decision.modelCalls : undefined
          modelQuestions = modelQuestions !== undefined && decision.modelQuestions !== undefined ? modelQuestions + decision.modelQuestions : undefined
          const trace = decision.trace && typeof decision.trace === 'object' ? decision.trace as Record<string, unknown> : {}
          if (modelDurationMs !== undefined && Array.isArray(trace.exchanges)) {
            for (const exchange of trace.exchanges) {
              if (!exchange || typeof exchange !== 'object' || typeof exchange.durationMs !== 'number' || !Number.isFinite(exchange.durationMs) || exchange.durationMs < 0) {
                modelDurationMs = undefined
                break
              }
              modelDurationMs += exchange.durationMs
            }
          }
          else {
            modelDurationMs = undefined
          }
          return decision
        }
        catch (error) {
          // A failed client request cannot tell whether Jev was called, nor
          // provide its duration. Do not label unknown work as zero seconds.
          modelDurationMs = undefined
          modelCalls = undefined
          modelQuestions = undefined
          throw error
        }
        finally {
          timing.mark('jev-finished')
          requestDurationMs += performance.now() - startedAt
        }
      },
      onExecuted: async (result) => {
        if (!result || typeof result !== 'object')
          return
        const payload = result as Record<string, unknown>
        const trace = payload.decisionTrace as { operationPlan?: { toolName?: string, input?: unknown }, authorize?: { kind?: string } } | undefined
        const readMessage = replyFromReceipt(result)
        if (ticket.isCurrent() && readMessage && trace?.operationPlan?.toolName && ['menu_get', 'menu_recommend', 'menu_show_recommendations'].includes(trace.operationPlan.toolName) && ('continuation' in payload || earlyReplyIndex !== undefined)) {
          // Display a verified read receipt before optional review. Reuse one
          // bubble for the at-most-one supplementary read; never show a draft
          // as an executed result or duplicate the final receipt afterward.
          if (!shownInput) {
            conversationMessages.value = [...conversationMessages.value, { role: 'user', content: utterance.text }]
            shownInput = true
          }
          earlyReadMessages.push(readMessage)
          if (earlyReplyIndex === undefined) {
            earlyReplyIndex = conversationMessages.value.length
            conversationMessages.value = [...conversationMessages.value, { role: 'assistant', id: requestMessageId(utterance.id, 'reply'), content: readMessage, slices: [], tool_results: [] }]
          }
          else {
            conversationMessages.value = conversationMessages.value.map((message, index) => index === earlyReplyIndex ? { ...message, content: earlyReadMessages.join('\n') } : message)
          }
          fastPathProgress.value = { utteranceId: utterance.id, text: '已取得結果，正在確認是否需要補充…' }
        }
        await interactionRecording.start(scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction')
        if (!recordedFastPathInput) {
          await recordUtteranceEvidence(utterance)
          recordedFastPathInput = true
        }
        if (trace?.operationPlan?.toolName) {
          if (latestDecisionTrace && utterance.source !== 'simulation')
            await interactionRecording.append('service_event', JSON.stringify({ kind: 'system_one_decision', trace: latestDecisionTrace }), { decisionRoute: 'fast_path', source: utterance.source })
          await interactionRecording.append('tool_call', JSON.stringify(trace.operationPlan.input ?? {}), { decisionRoute: 'fast_path', name: trace.operationPlan.toolName })
          await interactionRecording.append('tool_result', JSON.stringify(payload), { decisionRoute: 'fast_path', name: trace.operationPlan.toolName })
        }
      },
      isCurrent: () => ticket.isCurrent() && (utterance.source !== 'asr' || allowsObservedVoice(visualSpeechRequired.value)),
      onActionSelected: async () => {
        fastPathProgress.value = { utteranceId: utterance.id, text: t('stage.kiosk.wait.operating') }
        timing.mark('feedback-visible')
        if (utterance.source === 'asr' && !allowsObservedVoice(visualSpeechRequired.value))
          return 'DEFER'
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
        if (!ticket.isCurrent() || (utterance.source === 'asr' && !allowsObservedVoice(visualSpeechRequired.value)))
          return 'DEFER'
        const receipt = firstResponseTurns.get(utterance.id)
        if (!receipt || !interactionTurn.isCurrent(receipt))
          interruptAssistantOutput()
        selectedTurn = receipt && interactionTurn.isCurrent(receipt) ? receipt : interactionTurn.begin('voice', 'thinking')
        turnTimings.set(selectedTurn.id, timing)
        timing.markFirst('service-admitted')
        void nextTick(() => {
          if (ticket.isCurrent() && selectedTurn && interactionTurn.isCurrent(selectedTurn))
            timing.markFirst('first-response-dom-ready', undefined, 'progress')
        })
      },
      onTrace: (trace) => {
        if (!ticket.isCurrent())
          return
        latestDecisionTrace = trace
        const context = trace.browserContext && typeof trace.browserContext === 'object' ? trace.browserContext as Record<string, unknown> : {}
        const rawCandidates = Array.isArray(context.candidates) ? context.candidates : []
        const rawReferences = Array.isArray(context.references) ? context.references : []
        const execution = trace.executionResult && typeof trace.executionResult === 'object' ? trace.executionResult as Record<string, unknown> : {}
        const decisionTrace = execution.decisionTrace && typeof execution.decisionTrace === 'object' ? execution.decisionTrace as Record<string, unknown> : {}
        const operation = decisionTrace.operationPlan && typeof decisionTrace.operationPlan === 'object' ? decisionTrace.operationPlan as Record<string, unknown> : {}
        const authorization = decisionTrace.authorize && typeof decisionTrace.authorize === 'object' ? decisionTrace.authorize as Record<string, unknown> : {}
        const previous = decisionEntries.value.find(entry => entry.id === utterance.id)
        const modelTrace = trace.decision.trace && typeof trace.decision.trace === 'object' ? trace.decision.trace as Record<string, unknown> : {}
        updateDecisionEntry(utterance.id, {
          ...(requestDurationMs > 0 ? { timing: { transcript: utterance.text, requestDurationMs, modelDurationMs, modelCalls, modelQuestions, firstResultDurationMs } } : {}),
          decisionStages: [...(previous?.decisionStages ?? []), { decision: trace.decision.kind, ...(typeof operation.toolName === 'string' ? { operation: operation.toolName } : {}), ...(typeof authorization.kind === 'string' ? { authorization: authorization.kind } : {}) }],
          ...(typeof modelTrace.decisionState === 'string' ? { modelContext: modelTrace.decisionState } : {}),
          ...(Array.isArray(modelTrace.exchanges) ? { modelExchanges: JSON.stringify(modelTrace.exchanges, null, 2) } : {}),
          ...(trace.decision.modelCalls !== undefined ? { modelCalls: trace.decision.modelCalls } : {}),
          ...(trace.decision.reason ? { reason: trace.decision.reason } : {}),
          phase: typeof context.phase === 'string' ? context.phase : previous?.phase,
          references: rawReferences.flatMap((reference: unknown) => reference && typeof reference === 'object' && typeof (reference as Record<string, unknown>).label === 'string' ? [(reference as Record<string, string>).label] : []),
          candidates: rawCandidates.flatMap((candidate: unknown) => candidate && typeof candidate === 'object' && typeof (candidate as Record<string, unknown>).description === 'string' ? [(candidate as Record<string, string>).description] : []),
          decision: trace.decision.kind,
          confidence: 'confidence' in trace.decision ? trace.decision.confidence : undefined,
          operation: typeof operation.toolName === 'string' ? operation.toolName : previous?.operation,
          authorization: typeof authorization.kind === 'string' ? authorization.kind : previous?.authorization,
        })
        if (utterance.source === 'simulation')
          asrSimulationTrace.value = JSON.stringify({ ...trace, timing: { transcript: utterance.text, requestDurationMs, modelDurationMs, modelCalls, modelQuestions, firstResultDurationMs } }, null, 2)
      },
      presenceState: presenceDecision.value?.state,
      session: incompleteAsrSession,
      transcript: utterance.text,
      webMcp: { availability: serviceRecoveryBlocked.value ? 'unavailable' : interactiveServiceClient.availability.value, execute: interactiveServiceClient.execute, tools: interactiveServiceClient.tools.value, waitUntilReady: () => interactiveServiceClient.waitUntilReady() },
    })
    if (!ticket.isCurrent())
      return
    if (utterance.source === 'simulation') {
      await interactionRecording.append('service_event', JSON.stringify({ kind: 'system_one_decision', utteranceId: utterance.id, attempt: attempt + 1, result: result.kind, reason: result.reason, trace: latestDecisionTrace ?? null }), { source: utterance.source, utteranceId: utterance.id })
    }
    if (result.kind !== 'DEFERRED') {
      decisionProgress.finish(utterance.id, result)
      if (result.kind !== 'SERVICE_CLARIFICATION')
        serviceClarificationWindow.reset()
    }
    // Do not escalate a late decision after the visitor has left. Accepted or
    // uncertain execution receipts still settle normally, without retrying.
    if (utterance.source === 'asr' && !allowsObservedVoice(visualSpeechRequired.value) && result.kind !== 'FAST_ACTION' && result.kind !== 'EXECUTION_FAILED') {
      if (selectedTurn && interactionTurn.isCurrent(selectedTurn))
        interactionTurn.complete(selectedTurn)
      finishVoiceDiagnostic(utterance.id, 'ignored')
      updateDecisionEntry(utterance.id, { route: 'ignored', reason: 'LOCAL_PRESENCE_REQUIRED' })
      return
    }

    if (result.kind === 'DEFERRED') {
      updateDecisionEntry(utterance.id, { route: 'deferred' })
      const request = currentAgentRequest()
      if (request)
        await (request.stage === 'starting' ? request.ready : request.done)
      continue
    }
    if (result.kind === 'EXECUTION_FAILED') {
      const receipt = result.result && typeof result.result === 'object' ? result.result as Record<string, unknown> : undefined
      const partialMessage = receipt?.effect === 'partial' ? operationReplyFrom(receipt) : undefined
      const knownRejection = !result.uncertain && typeof receipt?.customerMessage === 'string'
      const execution = safeParse(serviceOperationSchema, receipt?.execution)
      const orderUnconfirmed = execution.success && execution.output.steps.some(step => step.effect === 'order' && step.state === 'unknown')
      const recovery = browserOrdering ? browserRecoveryReply({ receipt, operationAttempted: result.uncertain, orderUnconfirmed, verifiedMessage: partialMessage ?? (knownRejection ? String(receipt.customerMessage).slice(0, 2_000) : undefined) }) : undefined
      const message = recovery?.content ?? (partialMessage
        ? `${partialMessage} 請先核對購物車，避免重複加入。`
        : knownRejection
          ? String(receipt.customerMessage).slice(0, 2_000)
          : result.uncertain
            ? '暫時無法確認這次操作結果，請先確認畫面上的購物車或訂單，不要重複付款。'
            : '這次操作未完成，請確認畫面後再試一次或使用螢幕操作。')
      const response: ChatHistoryItem = recovery || knownRejection || partialMessage
        ? { role: 'assistant', content: message, slices: [], tool_results: [] }
        : { role: 'error', content: message }
      conversationMessages.value = [...conversationMessages.value, ...(!shownInput ? [{ role: 'user' as const, content: utterance.text }] : []), { ...response, id: requestMessageId(utterance.id, 'reply') }]
      await recordUtteranceEvidence(utterance)
      await interactionRecording.append('service_event', JSON.stringify({ kind: 'webmcp_execution_failed', uncertain: result.uncertain, result: result.result, trace: latestDecisionTrace }), { decisionRoute: 'execution_failed', utteranceId: utterance.id })
      updateDecisionEntry(utterance.id, { route: 'execution_failed', reason: result.uncertain ? 'RESULT_UNKNOWN' : 'REJECTED' })
      if (recovery || knownRejection || partialMessage) {
        await interactionRecording.append('assistant_text', message, { source: recovery ? 'service_recovery_guidance' : 'page_rejection', utteranceId: utterance.id })
        if (selectedTurn && interactionTurn.isCurrent(selectedTurn)) {
          interactionTurn.advance(selectedTurn, 'speaking')
          await speakAssistantReply(message, selectedTurn)
        }
      }
      if (selectedTurn && interactionTurn.isCurrent(selectedTurn))
        interactionTurn.complete(selectedTurn)
      if (utterance.source === 'simulation')
        asrSimulationStatus.value = message
      if (recovery)
        setRequestStatus(utterance.id, 'review')
      finishVoiceDiagnostic(utterance.id, 'failed')
      return
    }
    if (result.kind === 'SERVICE_UNAVAILABLE') {
      // Keep the existing recovery status visible. Repeated speech while paused
      // must not add the same generic fallback to every customer turn.
      if (browserOrdering && !serviceRecoveryBlocked.value) {
        const recovery = browserRecoveryReply({ operationAttempted: false })
        conversationMessages.value = [...conversationMessages.value, ...(!shownInput ? [{ role: 'user' as const, content: utterance.text }] : []), { role: 'assistant', id: requestMessageId(utterance.id, 'reply'), content: recovery.content, slices: [], tool_results: [] }]
        await recordUtteranceEvidence(utterance)
        await interactionRecording.append('assistant_text', recovery.content, { source: 'service_recovery_guidance', utteranceId: utterance.id })
        setRequestStatus(utterance.id, 'review')
      }
      serviceRecoveryBlocked.value = true
      pendingTranscript.value = t('stage.kiosk-agent.service-unavailable')
      asrSimulationStatus.value = pendingTranscript.value
      updateDecisionEntry(utterance.id, { route: 'unavailable', agentStep: pendingTranscript.value })
      finishVoiceDiagnostic(utterance.id, 'failed')
      return
    }
    if (result.kind === 'IGNORE' || result.kind === 'INCOMPLETE' || result.kind === 'UNAVAILABLE') {
      const retryMessage = result.browserContextError ? t('stage.kiosk.service-recovery.browser-unavailable') : t('stage.kiosk-agent.decision-uncertain')
      // A social response or unfinished fragment does not warrant a retry.
      if (shouldShowDecisionRetry(result) && !result.recovery && shownInput) {
        conversationMessages.value = [
          ...conversationMessages.value,
          ...(!shownInput ? [{ role: 'user' as const, content: utterance.text }] : []),
          { role: 'error', id: requestMessageId(utterance.id, 'reply'), content: retryMessage },
        ]
        shownInput = true
        await recordUtteranceEvidence(utterance)
        await interactionRecording.append('service_event', JSON.stringify({ kind: 'decision_not_completed', result: result.kind, trace: latestDecisionTrace }), { decisionRoute: 'unavailable', utteranceId: utterance.id })
      }
      finishVoiceDiagnostic(utterance.id, shouldShowDecisionRetry(result) ? 'failed' : 'decided')
      updateDecisionEntry(utterance.id, { route: result.kind === 'IGNORE' ? 'ignored' : result.kind === 'INCOMPLETE' ? 'incomplete' : 'unavailable' })
      if (shouldShowDecisionRetry(result) && utterance.source === 'asr' && shownInput)
        pendingTranscript.value = retryMessage
      if (utterance.source === 'simulation') {
        if (result.browserContextError)
          asrSimulationStatus.value = retryMessage
        else if (result.kind === 'IGNORE')
          asrSimulationStatus.value = 'System One：背景或無關語句，未執行。'
        else if (result.kind === 'INCOMPLETE')
          asrSimulationStatus.value = 'System One：語句尚未完成，等待下一句。'
        else
          asrSimulationStatus.value = retryMessage
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
      if (utterance.source === 'asr' && utterance.recognitionMode === 'legacy')
        processingCue.acknowledge({ utteranceId: utterance.id, recognitionMode: 'legacy', stage: 'service' })
      turnTimings.set(turn.id, timing)
      updateDecisionEntry(utterance.id, { route: 'main_agent' })
      if (utterance.source === 'simulation')
        asrSimulationStatus.value = 'System One：相關補充已中斷尚未操作工具的 AI 回合，正在重新處理。'
      void persistAssistantEscalation(input)
      void sendConversationMessage(utterance.text, turn, { appendUserMessage: !shownInput, deadlineAt: input.deadlineAt, decisionEntryId: utterance.id, utteranceId: utterance.id, decisionState: conversationDecisionStateFrom(result.decisionState) })
        .catch(error => console.error('Failed to restart Main Agent with kiosk follow-up:', error))
      finishVoiceDiagnostic(utterance.id, 'decided')
      return
    }

    // A delayed result cannot acquire a fresh turn after the customer moved on.
    if (selectedTurn && !interactionTurn.isCurrent(selectedTurn))
      return
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
    if (utterance.source === 'asr' && utterance.recognitionMode === 'legacy')
      processingCue.acknowledge({ utteranceId: utterance.id, recognitionMode: 'legacy', stage: 'service' })
    // The real decision path adopts the same turn so Main cannot repeat the
    // receipt or cut off its in-flight audio. Failed/silent paths remain unclaimed.
    firstResponseTurns.delete(utterance.id)
    turnTimings.set(turn.id, timing)
    if (fastPathProgress.value?.utteranceId === utterance.id)
      fastPathProgress.value = undefined
    updateDecisionEntry(utterance.id, { route: result.kind === 'CUSTOMER_ENTRY_REQUIRED' ? 'customer_entry' : result.kind === 'GREET' ? 'greeting' : result.kind === 'FAST_ACTION' ? 'fast_path' : (result.kind === 'CLARIFICATION' || result.kind === 'SERVICE_CLARIFICATION') ? 'clarification' : 'main_agent' })
    if (utterance.source === 'simulation') {
      asrSimulationStatus.value = result.kind === 'CUSTOMER_ENTRY_REQUIRED'
        ? '請先填寫手機號碼或選擇略過，再推薦或點餐。'
        : result.kind === 'GREET'
          ? 'System One：招呼回應，未修改訂單。'
          : result.kind === 'FAST_ACTION'
            ? `System One 已執行：${result.action.id}。`
            : result.kind === 'CLARIFICATION'
              ? `System One：${result.prompt}`
              : result.reason === 'SYSTEM_ONE_DISABLED'
                ? 'Fast Path 已停用，已交給 AI 助手處理。'
                : result.reason === 'SERVICE_CAPABILITY_UNAVAILABLE'
                  ? t('stage.kiosk.product-presentation.capability-unavailable')
                  : result.reason === 'PROVIDER_FAILURE'
                    ? 'System One 服務故障，已交給 AI 助手處理。'
                    : 'System One：需要 AI 助手，已轉交處理。'
    }
    // Persist and show the completed browser action before dequeuing another
    // utterance. Only TTS/Agent streaming continues asynchronously afterward.
    let spokenReply: string | undefined
    try {
      spokenReply = await presentFastPathResult(input, result, turn, recordedFastPathInput, shownInput, earlyReplyIndex, earlyReadMessages)
    }
    catch (error) {
      if (interactionTurn.isCurrent(turn))
        interactionTurn.complete(turn)
      throw error
    }
    if (result.kind !== 'NEEDS_ASSISTANT') {
      if (spokenReply && interactionTurn.advance(turn, 'speaking')) {
        void speakAssistantReply(spokenReply, turn).finally(() => {
          if (interactionTurn.isCurrent(turn))
            interactionTurn.complete(turn)
        })
      }
      else if (interactionTurn.isCurrent(turn)) {
        interactionTurn.complete(turn)
      }
    }
    finishVoiceDiagnostic(utterance.id, 'decided')
    return
  }
  if (utterance.source === 'simulation')
    asrSimulationStatus.value = '目前仍有操作在進行，這句未執行；請稍後重試。'
  updateDecisionEntry(utterance.id, { route: 'deferred' })
  finishVoiceDiagnostic(utterance.id, 'failed')
}

const savedUtteranceAudio = new Set<number>()
async function recordUtteranceEvidence(input: FastPathInput) {
  if (input.id === undefined)
    return
  const generation = receptionGeneration
  await interactionRecording.start(scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction')
  if (generation !== receptionGeneration || input.signal?.aborted)
    return
  const saved = await interactionRecording.recordTranscript({ id: input.id, text: input.text, source: input.source, recognitionMode: input.recognitionMode })
  if (saved && input.recording && generation === receptionGeneration && !savedUtteranceAudio.has(input.id)) {
    savedUtteranceAudio.add(input.id)
    mediaCapture.saveAudio(input.recording, saved.entry.id, saved.visitorSessionId)
  }
}

async function presentFastPathResult(
  input: FastPathInput,
  result: Awaited<ReturnType<typeof runFastPath>>,
  turn: ReturnType<typeof interactionTurn.begin>,
  recordedInput = false,
  shownInput = false,
  earlyReplyIndex?: number,
  earlyReadMessages: string[] = [],
) {
  if (!interactionTurn.isCurrent(turn))
    return

  if (result.kind === 'FAST_ACTION' || result.kind === 'GREET' || result.kind === 'CUSTOMER_ENTRY_REQUIRED') {
    await recordCustomerActivity(input.source === 'asr' ? 'voice_input' : 'asr_simulation')
    if (!interactionTurn.isCurrent(turn))
      return
    if (!recordedInput)
      await recordUtteranceEvidence(input)
    if (!interactionTurn.isCurrent(turn))
      return
    // A greeting is a conversational receipt, never an ordering command or
    // acknowledgement of the pending operation question.
    let question = result.kind === 'FAST_ACTION' ? await validatedQuestionReceipt(result.result) : undefined
    let answer: string
    if (result.kind === 'CUSTOMER_ENTRY_REQUIRED')
      answer = t('stage.kiosk.customer-entry.complete-first')
    else if (result.kind === 'GREET')
      answer = '您好！'
    else if (earlyReadMessages.length)
      answer = replyWithQuestion(earlyReadMessages.join('\n'), question)
    else
      answer = replyFromReceipt(result.result, question) ?? '已完成你剛剛指定的操作。'
    const receipt = result.kind === 'FAST_ACTION' && result.result && typeof result.result === 'object' ? result.result as Record<string, unknown> : undefined
    if (!question && (earlyReadMessages.length || Array.isArray(receipt?.items)))
      answer = await replyWithCustomerEntryGate(answer, turn)
    if (!interactionTurn.isCurrent(turn))
      return
    conversationMessages.value = earlyReplyIndex !== undefined
      ? conversationMessages.value.map((message, index) => index === earlyReplyIndex ? { ...message, content: answer } : message)
      : [
          ...conversationMessages.value,
          ...(!shownInput ? [{ role: 'user' as const, content: input.text }] : []),
          { role: 'assistant', id: requestMessageId(input.id, 'reply'), content: answer, slices: [], tool_results: [] },
        ]
    turnTimings.get(turn.id)?.mark('reply-text-visible', undefined, 'reply')
    if (!question && result.kind === 'FAST_ACTION') {
      const replyIndex = earlyReplyIndex ?? conversationMessages.value.length - 1
      question = await offerCheckout(interactiveServiceClient, browserDialogue, result.result, () => interactionTurn.isCurrent(turn))
      if (!interactionTurn.isCurrent(turn))
        return
      if (question) {
        answer = replyWithQuestion(answer, question)
        conversationMessages.value = conversationMessages.value.map((message, index) => index === replyIndex ? { ...message, content: answer } : message)
      }
    }
    await interactionRecording.append('assistant_text', answer, { decisionRoute: 'fast_path', utteranceId: input.id })
    if (result.kind === 'FAST_ACTION')
      await acknowledgePresentedReply(answer, () => interactionTurn.isCurrent(turn), question)
    if (!interactionTurn.isCurrent(turn))
      return
    if (result.kind === 'GREET')
      playTransientMotion('greeting')
    // PB gestures already follow the correlated service receipt. Owned Menu
    // keeps its existing fast-action acknowledgement path.
    else if (conversationSource(interactiveServiceClient.tools.value) !== 'browser')
      playTransientMotion('acknowledge')
    return answer
  }

  if (result.kind === 'CLARIFICATION') {
    await recordCustomerActivity(input.source === 'asr' ? 'voice_input' : 'asr_simulation')
    if (!interactionTurn.isCurrent(turn))
      return
    if (!recordedInput)
      await recordUtteranceEvidence(input)
    // The browser keeps the answer buttons available after a repeated unclear
    // answer. Do not keep speaking the same question over the customer.
    if (result.silent)
      return undefined
    await interactionRecording.append('assistant_text', result.prompt, { decisionRoute: 'fast_path', utteranceId: input.id })
    if (!interactionTurn.isCurrent(turn))
      return
    conversationMessages.value = [
      ...conversationMessages.value,
      ...(!shownInput ? [{ role: 'user' as const, content: input.text }] : []),
      { role: 'assistant', id: requestMessageId(input.id, 'reply'), content: result.prompt, slices: [], tool_results: [] },
    ]
    return result.prompt
  }

  if (result.kind === 'SERVICE_CLARIFICATION') {
    const entryPhase = await readCustomerEntryPhase(turn)
    if (!interactionTurn.isCurrent(turn))
      return
    const content = entryPhase === 'customer_entry' ? t('stage.kiosk.customer-entry.complete-first') : result.question.question
    if (entryPhase !== 'customer_entry')
      serviceClarificationWindow.present(result.question)
    if (!recordedInput)
      await recordUtteranceEvidence(input)
    await interactionRecording.append('assistant_text', content, { utteranceId: input.id, source: 'service_clarification', questionId: result.question.questionId })
    if (!interactionTurn.isCurrent(turn))
      return
    conversationMessages.value = [...conversationMessages.value, ...(!shownInput ? [{ role: 'user' as const, content: input.text }] : []), { role: 'assistant', id: requestMessageId(input.id, 'reply'), content, slices: [], tool_results: [] }]
    return content
  }

  const decisionState = conversationDecisionStateFrom(invitationWindow.decisionState(result.decisionState, Date.now()), result, conversationSource(interactiveServiceClient.tools.value))

  if (result.kind === 'NEEDS_ASSISTANT') {
    if (earlyReadMessages.length)
      await interactionRecording.append('assistant_text', earlyReadMessages.join('\n'), { decisionRoute: 'fast_path', utteranceId: input.id })
    // A semantic handoff, disabled Fast Path or provider fault starts the same
    // guarded Agent flow. A fallback is not proof of intent or tool authority.
    void persistAssistantEscalation(input)
    void sendConversationMessage(input.text, turn, { appendUserMessage: !shownInput, decisionEntryId: input.id, utteranceId: input.id, deadlineAt: input.deadlineAt, decisionState, clarifyOrder: result.reason === 'UNCERTAIN_OPERATION' })
      .catch(error => console.error('Failed to forward kiosk request to Main Agent:', error))
  }

  // Semantic uncertainty stays blocked; provider failures were explicitly
  // converted to a guarded handoff before reaching this presentation step.
}

/** The runtime promotes only a known question that was actually displayed. */
async function acknowledgePresentedReply(content: string, isCurrent: () => boolean, question?: ReturnType<typeof questionReceiptFrom>, interruptsQuestion = false) {
  if (!isCurrent())
    return
  const questionId = question?.questionId
  if (question) {
    // Final checkout invitations are issued after tool execution. Persist the
    // actual structured question so semantic answers can resolve the same ID.
    await interactionRecording.append('service_event', JSON.stringify({ kind: 'browser_question_presented', source: 'browser', pendingCustomerChoice: question }), { questionId })
  }
  if (!isCurrent())
    return
  // Text mode has no playback callback: begin optional cues only after this
  // reply has been appended. Voice mode cues follow actual playback segments.
  if (!props.voiceConversationOnly)
    void productPresentation.speak(content, { revealMenu: true })
  const tool = interactiveServiceClient.tools.value.find(tool => tool.name === 'kiosk_dialogue_presented')
  if (tool) {
    // Presentation bookkeeping must not hide an already completed reply.
    await interactiveServiceClient.execute(tool, { content, ...(questionId ? { questionId } : {}), ...(interruptsQuestion ? { interruptsQuestion: true } : {}) }).catch(error => console.error('Failed to record presented kiosk reply:', error))
  }
}

async function validatedQuestionReceipt(result: unknown) {
  const question = questionReceiptFrom(result)
  if (!question)
    return undefined
  if (['browser-product-choice', 'browser-order-quantity', 'browser-order-slot', 'browser-confirm-add', 'browser-service-question', 'browser-table-confirmation'].includes(question.purpose)) {
    const read = interactiveServiceClient.tools.value.find(tool => tool.name === 'browser_cart_get')
    if (!read)
      return undefined
    try {
      return browserDialogue.validate(await interactiveServiceClient.execute(read, { includeCatalog: true }), question.questionId)
    }
    catch { return undefined }
  }
  const tool = interactiveServiceClient.tools.value.find(tool => tool.name === 'kiosk_question_validate')
  if (!tool)
    return undefined
  try {
    return questionReceiptFrom(await interactiveServiceClient.execute(tool, { questionId: question.questionId }))
  }
  catch {
    return undefined
  }
}

/** Read live entry state before presenting a result; resets restore the phone gate. */
async function readCustomerEntryPhase(turn: ReturnType<typeof interactionTurn.begin>) {
  const tool = interactiveServiceClient.tools.value.find(tool => tool.name === 'kiosk_interaction_state')
  if (!tool)
    return undefined
  // When unavailable, retain the verified receipt; the runtime still enforces entry before execution.
  const result = await interactiveServiceClient.execute(tool, {}).catch(() => undefined)
  if (!interactionTurn.isCurrent(turn) || !interactiveServiceClient.tools.value.includes(tool))
    return undefined
  return conversationDecisionStateFrom(result)?.phase
}

async function replyWithCustomerEntryGate(content: string, turn: ReturnType<typeof interactionTurn.begin>) {
  return await readCustomerEntryPhase(turn) === 'customer_entry' ? t('stage.kiosk.customer-entry.complete-first') : content
}

async function persistAssistantEscalation(input: FastPathInput) {
  try {
    await recordCustomerActivity(input.source === 'asr' ? 'voice_input' : 'asr_simulation')
    await recordUtteranceEvidence(input)
  }
  catch (error) {
    // The deliberate escalation still reaches the Agent; persistence failure is
    // observable in development but must not turn a customer action into a noop.
    console.error('[stage-kiosk] failed to persist assistant escalation:', error)
  }
}

function interruptAssistantOutput() {
  stopAssistantAudio?.()
}

function cancelReceptionWork() {
  greetingDelivery.cancel()
  proactiveVision.resetTarget()
  mouthActivity.reset()
  mouthStartAllowed.value = false
  activeMouthLease = undefined
  processingCue.reset()
  discardSpeechUntilBoundary = false
  // Completion/reset closes all customer work immediately, before merchant
  // cleanup awaits. ASR/Jev/Main/TTS callbacks retain their old turn/ticket.
  receptionGeneration++
  requestStatuses.value = Object.fromEntries(Object.entries(requestStatuses.value).map(([id, status]) => [id, status === 'queued' || status === 'processing' ? 'cancelled' : status]))
  savedUtteranceAudio.clear()
  activeVoiceCandidate = undefined
  utteranceQueue.reset()
  decisionProgress.cancel()
  incompleteAsrSession.discard()
  interactionTurn.cancel()
  interruptAssistantOutput()
  void productPresentation.cancel()
}

watch(customerSessionState, (state) => {
  if (state === 'completing' || state === 'resetting')
    cancelReceptionWork()
}, { flush: 'sync' })

function clearConversationPresentation() {
  cancelReceptionWork()
  invitationWindow.reset()
  browserDialogue.reset()
  fastPathProgress.value = undefined
  serviceClarificationWindow.reset()
  utteranceTimings.clear()
  turnTimings.clear()
  firstResponseTurns.clear()
  voiceDiagnosticByUtterance.clear()
  voiceDiagnosticEntries.value = []
  conversationMessages.value = []
  requestStatuses.value = {}
  streamingReply.clear()
  conversationWorkStatus.value = undefined
  retryableConversationRequest.value = undefined
  pendingTranscript.value = undefined
  asrSimulationStatus.value = undefined
  asrSimulationTrace.value = undefined
  decisionEntries.value = []
}

let activeSpeechTiming: { clock: ReturnType<typeof createUtteranceTiming>, channel: 'progress' | 'reply' } | undefined
const speechPlayer = createSpeechPlayer({
  synthesize: synthesizeKioskSpeech,
  onSynthesis: index => activeSpeechTiming?.clock.mark('tts-request', index + 1, activeSpeechTiming.channel),
  onReady: () => activeSpeechTiming?.clock.mark('tts-ready', undefined, activeSpeechTiming.channel),
  onPlaying: (text, first) => {
    processingSpeechActive.value = true
    if (props.voiceConversationOnly)
      void productPresentation.speak(text)
    if (first && activeSpeechTiming) {
      activeSpeechTiming.clock.mark('first-audio', undefined, activeSpeechTiming.channel)
      activeSpeechTiming.clock.markFirst('first-response-audio', undefined, activeSpeechTiming.channel)
      void interactionRecording.append('service_event', JSON.stringify(activeSpeechTiming.clock.snapshot('speech', 'running')), { source: 'utterance_timing', utteranceId: activeSpeechTiming.clock.utteranceId })
    }
  },
  onStopped: () => processingSpeechActive.value = false,
  onSource: async (player) => {
    if (!player || !audioContext)
      return
    await applyAudioOutput(audioContext)
    const source = audioContext.createMediaElementSource(player)
    assistantAudioNode.value = source
    source.connect(audioContext.destination)
    const disconnectReference = connectPlaybackReference(source)
    return () => {
      disconnectReference()
      if (assistantAudioNode.value === source)
        assistantAudioNode.value = undefined
      source.disconnect()
    }
  },
})

async function speakAssistantReply(text: string, turn: ReturnType<typeof interactionTurn.begin>, preparedAudio?: Blob, signal = turn.signal, channel: 'progress' | 'reply' = 'reply'): Promise<'completed' | 'cancelled' | 'failed' | 'blocked'> {
  if (backgroundSpeechMode.value !== 'enforce' && speechInterruption.blocksPlayback())
    return 'blocked'
  if (turn.kind === 'proactive' && (isSpeech.value || activeVoiceCandidate || transcriptionCount.value > 0))
    return 'blocked'
  if (customerSessionState.value === 'completing' || customerSessionState.value === 'resetting' || signal.aborted || !interactionTurn.isCurrent(turn) || (turn.kind === 'proactive' && !allowsObservedVoice()))
    return signal.aborted ? 'cancelled' : 'blocked'
  interruptAssistantOutput()
  const stop = () => speechPlayer.stop()
  stopAssistantAudio = stop
  const timing = turnTimings.get(turn.id)
  const sessionId = interactionRecording.visitorSessionId.value
  const owner = timing ? { clock: timing, channel } : undefined
  activeSpeechTiming = owner
  timing?.mark('tts-start', undefined, channel)
  let outcome: 'completed' | 'cancelled' | 'failed' = 'failed'
  speechPreparationCount.value++
  try {
    outcome = await speechPlayer.play({ text, locale: language.value, signal, preparedAudio })
  }
  catch (error) {
    if (!signal.aborted)
      console.error('Failed to synthesize kiosk reply:', error)
    outcome = signal.aborted ? 'cancelled' : 'failed'
  }
  finally {
    speechPreparationCount.value--
    timing?.mark('speech-finished', signal.aborted ? 'cancelled' : outcome, channel)
    if (timing && sessionId === interactionRecording.visitorSessionId.value)
      void interactionRecording.append('service_event', JSON.stringify(timing.snapshot('speech', signal.aborted ? 'cancelled' : outcome)), { source: 'utterance_timing', utteranceId: timing.utteranceId })
    if (activeSpeechTiming === owner)
      activeSpeechTiming = undefined
    // Progress playback must not discard the clock needed by the final reply.
    if (channel === 'reply')
      turnTimings.delete(turn.id)
    if (stopAssistantAudio === stop)
      stopAssistantAudio = undefined
  }
  return outcome
}

function stopAudioInteraction() {
  resetVisualSpeech()
  mouthActivity.reset()
  mouthStartAllowed.value = false
  activeMouthLease = undefined
  if (activeVoiceCandidate)
    interactionTurn.completeVoiceCandidate(activeVoiceCandidate)
  activeVoiceCandidate = undefined
  audioCaptureAttempt++
  audioCaptureController?.abort()
  audioCaptureController = undefined
  arrayDiagnostics.value = undefined
  arrayLevels = { inputDb: -Infinity, outputDb: -Infinity, peak: 0, limited: 0, samples: 0 }
  dispose()
  audioInputStarted.value = false
}

// Changing optional visual admission retires its current phrase lease. The
// master browser DSP keeps its generation; it must not be started twice.
watch(mouthAssistanceEnabled, (assisted, previouslyAssisted) => {
  if (assisted === previouslyAssisted)
    return
  discardSpeechUntilBoundary = props.voiceConversationOnly && isSpeech.value
  if (activeVoiceCandidate)
    interactionTurn.completeVoiceCandidate(activeVoiceCandidate)
  activeVoiceCandidate = undefined
}, { flush: 'sync' })

watch([arrayActive, stream, arrayRoute.pcmSource], async ([active]) => {
  if (active) {
    await startAudioInteraction().catch((error) => {
      audioStartupError.value = errorMessageFrom(error) ?? 'Microphone startup failed.'
      console.error('Failed to start kiosk audio interaction:', error)
    })
  }
  else {
    stopAudioInteraction()
  }
}, { immediate: true })

// Voice-only mode is the explicit microphone consent mode. It asks before
// optional camera work begins, while text kiosks never request microphone use.
let microphonePreparation = 0
async function prepareMicrophone() {
  const attempt = ++microphonePreparation
  if (!props.voiceConversationOnly && !adminVoiceTestActive.value) {
    // A profile can change from voice-only to text mode while this browser
    // retains its previous local preference. Keep that stale preference from
    // starting the audio pipeline in the text-only experience.
    enabled.value = false
    initialMicrophonePermission.settle()
    return
  }

  try {
    audioStartupError.value = undefined
    await prepareKioskMicrophonePermission({
      audioInputEnabled: enabled.value,
      requestPermission: requestMicrophonePermission,
      startAudioInput: async () => {
        if (attempt === microphonePreparation && (props.voiceConversationOnly || adminVoiceTestActive.value) && !stream.value)
          await settingsAudioDeviceStore.startStream()
      },
      setAudioInputEnabled: (nextEnabled) => {
        if (attempt === microphonePreparation && (props.voiceConversationOnly || adminVoiceTestActive.value))
          enabled.value = nextEnabled
      },
      voiceConversationOnly: props.voiceConversationOnly || adminVoiceTestActive.value,
    })
  }
  catch (error) {
    enabled.value = false
    audioStartupError.value = errorMessageFrom(error) ?? 'Microphone permission was not granted.'
    console.error('Kiosk microphone permission was not granted:', error)
  }
  finally {
    // Camera observation is optional. It starts only after the microphone
    // prompt settles, so closing a camera prompt can never block voice input.
    initialMicrophonePermission.settle()
  }
}

watch([() => props.voiceConversationOnly, adminVoiceTestActive], () => void prepareMicrophone(), { immediate: true })

watch(language, locale => setKioskLocale(locale), { immediate: true })

watch(() => JSON.stringify(proactiveSettings.value), () => {
  voicePresence.reset()
  proactiveWindow = createInteractionWindow(proactiveSettings.value.proactiveGreeting)
  assistanceReminderWindow = createAssistanceReminderWindow(proactiveSettings.value.assistanceReminder)
  presenceWindow = createPresenceWindow({
    ...defaultPresenceSettings,
    greetingRoi: proactiveSettings.value.observation.detectionZone,
  }, proactiveSettings.value.proactiveGreeting)
  presenceDecision.value = undefined
  if (customerSessionState.value === 'active')
    assistanceReminderWindow.start(performance.now())
})

async function syncProactiveVision() {
  // Reactive mode changes can reach this function before onMounted's gate.
  // Never overlap a camera prompt with acquisition of the owned microphone.
  await initialMicrophonePermission.wait()
  if (!cameraRequired.value) {
    proactiveVision.stop()
    return
  }

  if (proactiveCamera.value)
    await proactiveVision.start(proactiveCamera.value)
}

watch([cameraRequired, localObservationRequired, mouthTrackingRequired, () => JSON.stringify([
  props.deviceSettings?.faceDetectionConfidence,
  props.deviceSettings?.presenceVisionMode,
  performanceSettings.value.camera,
  performanceSettings.value.maxFaces,
  effectiveMediaCaptureMode.value,
])], () => {
  // Only camera/model/capture policy changes restart vision. Unrelated remote
  // settings must not reset presence and cut off an already playing welcome.
  interactionTurn.cancelProactive('vision-reconfigured')
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
  fixedGreetings.dispose()
  stopAudioInteraction()
  utteranceQueue.reset()
  serviceClarificationWindow.reset()
  decisionProgress.cancel()
  incompleteAsrSession.discard()
  interactionTurn.cancel()
  interruptAssistantOutput()
  proactiveVision.stop()
  void interactionRecording.end('cancelled')
})

async function handleProactiveObservation(observation: Parameters<typeof proactiveWindow.decide>[0]) {
  if (!localObservationRequired.value)
    return
  if (customerSessionState.value === 'active') {
    if (!allowsObservedVoice() || !interactionTurn.canProactivelySpeak.value)
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
  // Face-only dwell is claimed by decide(). If admission failed while still
  // in standby, allow a fresh dwell instead of losing this visitor's welcome.
  if (customerSessionState.value === 'standby')
    proactiveWindow.reset()
}

function handlePresenceCandidate(candidate: Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'> | undefined) {
  // Optional mouth assistance can use the camera while proactive observation
  // is disabled; it must not re-enable greetings or idle policy.
  if (!localObservationRequired.value)
    return
  voicePresence.observe(performance.now(), candidate, proactiveSettings.value.observation.detectionZone)
  const serviceBlocked = !allowsObservedVoice(false)
  if (serviceBlocked || voicePresence.shouldCancelProactive({ enabled: localObservationRequired.value, observing: proactiveVision.status.value === 'observing', nowMs: performance.now() }))
    interactionTurn.cancelProactive(serviceBlocked ? 'admission-changed' : 'presence-expired')
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

  const visionMode = props.deviceSettings?.presenceVisionMode ?? defaultDeviceSettingsValues.presenceVisionMode
  if (visionMode !== 'face_only' && customerSessionState.value === 'standby' && decision.greetingEligible && interactionTurn.canProactivelySpeak.value)
    void startProactiveGreeting(() => presenceWindow.claimGreeting())
}

/**
 * Camera geometry alone is intentionally not allowed to reserve a greeted
 * session forever. A real kiosk action upgrades the same ENGAGED state to
 * normal protection; otherwise the 15-second visual grace ends and restarts
 * the three-minute customer-session timer.
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

async function startProactiveGreeting(onStarted?: () => void, retry = false) {
  const generation = receptionGeneration
  const eligibleSession = () => retry
    ? customerSessionState.value === 'active' && !hasCustomerActivity.value && greetingDelivery.canRetry(generation, performance.now())
    : customerSessionState.value === 'standby'
  const customerBusy = () => isSpeech.value || Boolean(activeVoiceCandidate) || transcriptionCount.value > 0 || Boolean(currentAgentRequest()) || Boolean(utteranceQueueState.value.active) || utteranceQueueState.value.pending.length > 0
  if (!allowsObservedVoice() || !eligibleSession() || !interactionTurn.canProactivelySpeak.value || customerBusy())
    return

  // Discovery/loading failures must leave the visitor unclaimed so a later
  // presence frame can try again once the service can report its actual phase.
  const phase = await readGreetingPhase(interactiveServiceClient, browserDialogue.hasPending).catch((error) => {
    console.warn('[stage-kiosk] skipped welcome because service state is unavailable:', error)
    return undefined
  })
  if (generation !== receptionGeneration || !allowsObservedVoice() || !phase || !eligibleSession() || !interactionTurn.canProactivelySpeak.value || customerBusy())
    return

  const frame = props.proactiveVlmEnabled ? captureProactiveCameraFrame(proactiveCamera.value) : undefined
  if (props.proactiveVlmEnabled && !frame)
    return
  const attempt = greetingDelivery.claim(generation, performance.now())
  if (!attempt)
    return
  let result: ProactiveDeliveryResult = { status: 'cancelled', reason: 'setup-cancelled' }
  let recordingSession: string | undefined

  // Claim the proactive slot before asynchronous session setup. Otherwise a
  // customer utterance could start between setup awaits and be superseded by
  // this delayed greeting request.
  const turn = interactionTurn.begin('proactive', 'thinking')
  try {
    // Begin before asking the LLM so another camera frame cannot create a
    // second greeting while the selected provider is still streaming.
    visualEngagementProtectionStartedAtMs = undefined
    if (!retry)
      await customerSession.begin()
    syncPresenceIdleSuppression(presenceDecision.value)
    if (!interactionTurn.isCurrent(turn))
      return
    onStarted?.()
    await interactionRecording.start(scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction')
    recordingSession = interactionRecording.visitorSessionId.value
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
      result = await sendAssistantAction('greeting', frame, turn)
      if (result.status === 'completed')
        assistanceReminderWindow.start(performance.now())
    }
    finally {
      releasePendingWork()
    }
  }
  catch (error) {
    result = { status: turn.signal.aborted ? 'cancelled' : 'failed', reason: turn.signal.aborted && typeof turn.signal.reason === 'string' ? turn.signal.reason : errorMessageFrom(error) || 'greeting-failed' }
    if (!turn.signal.aborted)
      console.error('[stage-kiosk] failed to create proactive greeting:', error)
  }
  finally {
    if (turn.signal.aborted && result.status !== 'completed')
      result = { status: 'cancelled', reason: typeof turn.signal.reason === 'string' ? turn.signal.reason : 'turn-cancelled' }
    const sameReception = generation === receptionGeneration
    greetingDelivery.finish(attempt, result.status === 'completed' ? 'delivered' : sameReception && !hasCustomerActivity.value ? 'retry' : 'closed', performance.now())
    // Never attach an old terminal result to a replacement visitor session.
    if (voiceDiagnosticsEnabled.value && recordingSession && recordingSession === interactionRecording.visitorSessionId.value) {
      void interactionRecording.append('service_event', JSON.stringify({ attemptId: attempt.id, reception: generation, retry, ...result, interruption: speechInterruption.snapshot(), presenceState: presenceDecision.value?.state, presenceCandidate: lastPresenceCandidate.value, retryPending: sameReception && greetingDelivery.canRetry(generation, performance.now() + 1500) }), { source: 'greeting_delivery' })
    }
    if (interactionTurn.isCurrent(turn))
      interactionTurn.complete(turn)
  }
}

watch(hasCustomerActivity, (active) => {
  if (active)
    greetingDelivery.cancel()
}, { flush: 'sync' })

// Retries keep the same reception and re-read the live browser phase; they
// cannot reset a cart, welcome over a question, or displace customer work.
useIntervalFn(() => {
  if (props.deviceSettings?.greetingEnabled && !hasCustomerActivity.value && customerSessionState.value === 'active' && interactionTurn.canProactivelySpeak.value && greetingDelivery.canRetry(receptionGeneration, performance.now()))
    void startProactiveGreeting(undefined, true)
}, 500)

// Without observation there is no presence edge to trigger an enabled welcome.
// Welcome once when an idle entry is admitted; optional camera use must not
// re-enable observation or welcome over an unresolved previous cart.
let entryWelcomeRunning = false
watch([isAudioListening, localObservationRequired, () => props.deviceSettings?.greetingEnabled, interactiveServiceClient.availability, serviceRecoveryBlocked, customerSessionState, adminPanelOpen], () => {
  if (entryWelcomeRunning || !isAudioListening.value || localObservationRequired.value || !props.deviceSettings?.greetingEnabled || interactiveServiceClient.availability.value !== 'ready' || serviceRecoveryBlocked.value || customerSessionState.value !== 'standby' || adminPanelOpen.value)
    return
  entryWelcomeRunning = true
  void startProactiveGreeting().finally(() => entryWelcomeRunning = false)
}, { immediate: true })

async function recordCustomerActivity(source: 'asr_simulation' | 'manual' | 'scenario' | 'voice_input' | 'voice_transcript' | 'completed' = 'scenario') {
  if (customerSessionState.value === 'completing' || customerSessionState.value === 'resetting')
    return
  const generation = receptionGeneration
  if (source === 'manual')
    void productPresentation.cancel()
  // A real touch takes precedence over a welcome that is warming or playing.
  // Cancelling only the proactive turn preserves unrelated customer work.
  if (source === 'manual' || source === 'scenario' || source === 'completed')
    interactionTurn.cancelProactive('customer-activity')
  if (customerSessionState.value === 'standby')
    visualEngagementProtectionStartedAtMs = undefined
  if (lastPresenceCandidate.value) {
    const decision = presenceWindow.decide(performance.now(), lastPresenceCandidate.value, true)
    presenceDecision.value = decision
  }
  await customerSession.recordActivity()
  if (generation !== receptionGeneration)
    return
  syncPresenceIdleSuppression(presenceDecision.value)
  await interactionRecording.start(scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction')
  if (generation !== receptionGeneration)
    return
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
  if (!transcript || props.voiceConversationOnly || customerSessionState.value === 'completing' || customerSessionState.value === 'resetting')
    return
  // An explicit correction can replace pre-operation service recovery. Never
  // use ambient speech or this path to cancel an accepted browser mutation.
  if (decisionProgress.recovering.value !== undefined && !currentAgentRequest() && !agentOrderOwner.value) {
    utteranceQueue.reset()
    decisionProgress.cancel()
    serviceClarificationWindow.reset()
  }
  const submission = utteranceQueue.submit({ source: 'simulation', text: transcript })
  if (submission.kind === 'ACCEPTED')
    processingCue.acknowledge()
  if (submission.kind === 'OVERLOADED')
    pendingTranscript.value = '語句佇列已滿，這句未送出；請稍後再試。'
  asrSimulationStatus.value = submission.kind === 'ACCEPTED'
    ? `已收到模擬語句；目前排隊 ${utteranceQueueState.value.pending.length} 句。`
    : undefined
}

interface ProactiveDeliveryResult {
  status: 'completed' | 'cancelled' | 'failed' | 'blocked'
  reason: string
}

async function sendAssistantAction(
  kind: 'greeting' | 'reminder',
  capturedFrame?: string,
  existingTurn?: ReturnType<typeof interactionTurn.begin>,
): Promise<ProactiveDeliveryResult> {
  if (!allowsObservedVoice())
    return { status: 'blocked', reason: 'presence-unavailable' }
  const serviceId = scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction'
  // The effective device policy selects fixed openings or a vision request.
  // Fixed mode never captures a frame for welcome generation.
  const frame = props.proactiveVlmEnabled ? capturedFrame ?? captureProactiveCameraFrame(proactiveCamera.value) : undefined
  if (props.proactiveVlmEnabled && !frame) {
    console.warn('[stage-kiosk] skipped proactive assistant action because the camera frame is unavailable')
    return { status: 'blocked', reason: 'camera-frame-unavailable' }
  }
  const turn = existingTurn ?? interactionTurn.begin('proactive', 'thinking')
  if (!interactionTurn.isCurrent(turn))
    return { status: 'cancelled', reason: 'turn-cancelled' }
  conversationWorkStatus.value = kind === 'greeting' ? t('stage.kiosk.welcome.preparing') : '正在觀察現場…'
  try {
    const phase = await readGreetingPhase(interactiveServiceClient, browserDialogue.hasPending, kind)
    if (!interactionTurn.isCurrent(turn) || !phase || currentAgentRequest())
      return { status: 'blocked', reason: !phase ? 'service-phase-unavailable' : 'customer-work' }
    if (kind === 'greeting' && !props.proactiveVlmEnabled) {
      const welcome = await fixedGreetings.next(phase, AbortSignal.any([turn.signal, AbortSignal.timeout(10_000)]))
      if (!interactionTurn.isCurrent(turn))
        return { status: 'cancelled', reason: 'turn-cancelled' }
      // TTS may still be cold. Re-read browser state so late audio cannot
      // welcome over a new checkout page or an unresolved customer question.
      const latest = await readGreetingPhase(interactiveServiceClient, browserDialogue.hasPending, kind)
      if (!allowsObservedVoice() || !interactionTurn.isCurrent(turn) || latest !== phase || currentAgentRequest())
        return { status: 'blocked', reason: latest !== phase ? 'service-phase-changed' : 'admission-changed' }
      await interactionRecording.append('assistant_text', welcome.text, { source: 'fixed_greeting' })
      if (!allowsObservedVoice() || !interactionTurn.isCurrent(turn))
        return { status: 'blocked', reason: 'admission-changed' }
      conversationMessages.value = [...conversationMessages.value, { role: 'assistant', content: welcome.text, slices: [], tool_results: [] }]
      playTransientMotion('greeting')
      interactionTurn.advance(turn, 'speaking')
      const status = await speakAssistantReply(welcome.text, turn, welcome.audio)
      return { status, reason: `playback-${status}` }
    }
    // Entry welcomes do not invite a meal choice before the phone decision.
    // Contextual reminders remain limited to the ordering screen.
    if (kind === 'reminder' && phase !== 'ordering')
      return { status: 'blocked', reason: 'service-phase-unavailable' }
    const response = await interactionRecording.runAssistantAction(serviceId, kind, frame, turn.signal, kind === 'reminder', phase)
    const answer = response?.answer
    if (!allowsObservedVoice() || !interactionTurn.isCurrent(turn))
      return { status: 'blocked', reason: 'admission-changed' }
    if (kind === 'greeting') {
      const latest = await readGreetingPhase(interactiveServiceClient, browserDialogue.hasPending, kind)
      if (!allowsObservedVoice() || !interactionTurn.isCurrent(turn) || latest !== phase || currentAgentRequest())
        return { status: 'blocked', reason: latest !== phase ? 'service-phase-changed' : 'admission-changed' }
    }
    if (answer) {
      const invitation = questionReceiptFrom(response)
      if (invitation)
        invitationWindow.present(invitation)
      conversationMessages.value = [
        ...conversationMessages.value,
        { role: 'assistant', content: answer, slices: [], tool_results: [] },
      ]
      if (kind === 'greeting')
        playTransientMotion('greeting')
      interactionTurn.advance(turn, 'speaking')
      const status = await speakAssistantReply(answer, turn)
      return { status, reason: `playback-${status}` }
    }
  }
  finally {
    if (interactionTurn.isCurrent(turn)) {
      interactionTurn.complete(turn)
      conversationWorkStatus.value = undefined
    }
  }
  return { status: 'blocked', reason: 'empty-response' }
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
  options: { deadlineAt?: number, appendUserMessage?: boolean, decisionEntryId?: number, decisionState?: KioskConversationDecisionState, utteranceId?: number, clarifyOrder?: boolean } = {},
) {
  if (customerSessionState.value === 'completing' || customerSessionState.value === 'resetting')
    return
  if (interactiveServiceClient.availability.value === 'manual-payment') {
    conversationWorkStatus.value = t('stage.kiosk-agent.manual-payment')
    return
  }
  if (serviceRecoveryBlocked.value || interactiveServiceClient.availability.value !== 'ready') {
    serviceRecoveryBlocked.value = true
    conversationWorkStatus.value = t('stage.kiosk-agent.service-unavailable')
    return
  }
  // A new typed message is a deliberate correction, unlike unverified ambient
  // speech. Stop any audible reply before beginning the replacement turn.
  if (!existingTurn && interactionTurn.phase.value === 'speaking')
    interruptAssistantOutput()

  const turn = existingTurn ?? interactionTurn.begin('conversation', 'thinking')
  const timing = options.utteranceId ? utteranceTimings.get(options.utteranceId) : turnTimings.get(turn.id)
  if (timing)
    turnTimings.set(turn.id, timing)
  timing?.mark('main-start')
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
  startConversationProgress(turn.id, t('stage.kiosk.wait.confirming'))
  void nextTick(() => {
    if (interactionTurn.isCurrent(turn))
      timing?.markFirst('first-response-dom-ready', undefined, 'progress')
  })
  const updateAgentStep = (step: string) => {
    if (options.decisionEntryId !== undefined)
      updateDecisionEntry(options.decisionEntryId, { agentStep: step })
  }
  updateAgentStep('Main Agent 準備中')

  if (options.appendUserMessage ?? true)
    conversationMessages.value = [...conversationMessages.value, { role: 'user', id: requestMessageId(options.utteranceId, 'user'), content: text }]
  retryableConversationRequest.value = undefined
  streamingReply.clear()
  conversationWorkStatus.value = undefined
  const startedAt = conversationDiagnosticsEnabled.value ? performance.now() : undefined
  let timingTimer: ReturnType<typeof setInterval> | undefined
  let longWaitTimer: ReturnType<typeof setTimeout> | undefined
  let browserEffectAttempted = false
  let browserRequestComplete = false
  // Capture the protocol owner before navigation can replace its tool list.
  const browserOrdering = conversationSource(interactiveServiceClient.tools.value) === 'browser'
  const serviceReply = options.decisionState?.serviceReply === true || /^(?:你好|您好|嗨|哈囉|哈啰|hello|hi)[！!。.?？\s]*$/i.test(text)
  let browserPage: BrowserConversation['page']
  let customerRecoveryPresented = false
  // Isolated to this Agent turn. Interrupted turns cannot publish another
  // turn's question; subsequent results replace an earlier operational offer.
  let questionReceipt: ReturnType<typeof questionReceiptFrom>
  let operationReply: string | undefined
  const menuReply = createMenuReplyWindow({ sourceUtterance: text })
  const taskTool = interactiveServiceClient.tools.value.find(tool => tool.name === 'kiosk_agent_task')
  const taskId = `agent:${turn.id}`
  let taskBound = false
  const releaseOrderControl = async () => {
    if (!taskBound || !taskTool)
      return
    const released = await interactiveServiceClient.execute(taskTool, { action: 'END', taskId })
    if (!released || typeof released !== 'object' || !('ok' in released) || released.ok !== true)
      throw new Error('The browser did not acknowledge returning order control.')
    if ('presentationFailed' in released && released.presentationFailed === true && 'customerMessage' in released && typeof released.customerMessage === 'string')
      operationReply = [operationReply, released.customerMessage].filter(Boolean).join('')
    taskBound = false
    if (agentOrderOwner.value === taskId) {
      agentOrderOwner.value = undefined
      manualControlPending.value = false
    }
  }
  const updateExecutionDuration = () => {
    if (startedAt === undefined || !interactionTurn.isCurrent(turn))
      return
    conversationExecutionDurationMs.value = options.deadlineAt ? Math.max(0, Date.now() - (options.deadlineAt - serviceRecoveryLimits.turnMs)) : performance.now() - startedAt
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
  let retryCaptured = false
  const taskSessionId = interactionRecording.visitorSessionId.value
  let taskOutcome: 'completed' | 'failed' = 'failed'
  let retryContextKey: string | undefined
  let releaseBrowserCartTask: (() => void) | undefined
  try {
    let decisionState = options.decisionState
    if (!decisionState || (taskTool && decisionState.menuRevision === undefined)) {
      // Typed turns bypass System One; read only the browser's current phase.
      // This separate host tool never issues or consumes a finite candidate.
      const stateTool = interactiveServiceClient.tools.value.find(tool => tool.name === 'kiosk_interaction_state')
      if (stateTool) {
        try {
          const snapshot = conversationDecisionStateFrom(await interactiveServiceClient.execute(stateTool, {}))
          decisionState = decisionState ? { ...snapshot, ...decisionState, menuRevision: snapshot?.menuRevision } : snapshot
        }
        catch {
          // Main Agent remains available when the embedded ordering page is not.
        }
      }
    }
    if (!interactionTurn.isCurrent(turn))
      return
    if (taskTool && decisionState?.menuRevision !== undefined) {
      pendingAgentOrderOwner.value = taskId
      const binding = await interactiveServiceClient.execute(taskTool, {
        action: 'BEGIN',
        transcript: text,
        taskId,
        expectedMenuRevision: decisionState.menuRevision,
        readOnly: decisionState.readOnly === true,
        ...(decisionState.handoff ? { handoff: decisionState.handoff } : {}),
        constraints: { excludeIngredients: decisionState.constraints?.exclude ?? [], includeIngredients: decisionState.constraints?.include ?? [], ...(decisionState.constraints?.dietary ? { dietary: decisionState.constraints.dietary } : {}), ...decisionState.constraints?.price, ...(decisionState.constraints?.unresolvedPrice || (decisionState.priceEvidence && !decisionState.constraints) ? { unresolvedPrice: true } : {}) },
      })
      if (!binding || typeof binding !== 'object' || !('ok' in binding) || binding.ok !== true) {
        pendingAgentOrderOwner.value = undefined
        throw new Error('Agent task could not be bound to the current menu.')
      }
      taskBound = true
      agentOrderOwner.value = taskId
      pendingAgentOrderOwner.value = undefined
      manualControlPending.value = false
      if (!interactionTurn.isCurrent(turn))
        return
    }
    if (conversationSource(interactiveServiceClient.tools.value) === 'browser') {
      releaseBrowserCartTask = beginBrowserCartTask(text, {
        selectGateway: chooseGateway,
        utteranceId: options.utteranceId,
        informationUnavailable: () => t('stage.kiosk.information-unavailable'),
        servicePolicyReply: kind => t(`stage.kiosk.service-policy.${kind}`),
        checkoutGuidance: empty => t(`stage.kiosk.checkout-guidance.${empty ? 'empty' : 'ready'}`),
        onRequestComplete: () => { browserRequestComplete = true },
        readOnly: decisionState?.readOnly === true || decisionState?.context?.readOnly === true,
        clarifyOrder: options.clarifyOrder,
        dialogue: browserDialogue,
        presentation: productPresentation,
        catalogLabels: () => activeCatalogLabels.value,

        isCurrent: () => interactionTurn.isCurrent(turn) && !turn.signal.aborted && (!options.deadlineAt || Date.now() < options.deadlineAt),
        decide: async (proposal, plan) => {
          const sessionId = interactionRecording.visitorSessionId.value
          if (!sessionId)
            throw new Error('Browser task requires the current visitor session.')
          return admitBrowserPlan(sessionId, { effect: proposal, source: 'main', ...plan }, turn.signal)
        },
      })
    }
    const reply = await interactionRecording.send(
      scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction',
      text,
      activeTools.value,
      {
        taskId,
        utteranceId: options.utteranceId,
        budgetMs: options.deadlineAt ? Math.max(1, options.deadlineAt - Date.now()) : undefined,
        ...(decisionState ? { decisionState } : {}),
        prepareRound: async (signal) => {
          // Table Start acknowledges dispatch before the replacement document
          // loads. Never read its context or reuse table tools in that interval.
          if (interactiveServiceClient.availability.value === 'loading')
            await interactiveServiceClient.waitUntilReady(signal)
          // External browser tools observe their own document. They cannot supply
          // the owned Menu's revision, task, POS, or finite-candidate contracts.
          if (browserOrdering) {
            if (!interactionTurn.isCurrent(turn) || interactiveServiceClient.availability.value !== 'ready')
              throw new Error('External browser document is unavailable.')
            const browserTools = activeTools.value.filter(tool => Object.hasOwn(orderingTools, tool.function.name))
            const observed = await readBrowserConversation(interactiveServiceClient, taskId, interactiveServiceClient.tools.value.map(tool => tool.name), (key) => {
              if (!retryCaptured) {
                retryContextKey = key
                retryCaptured = true
              }
            })
            const browserContext = { ...observed, allowedToolNames: availableOrderingTools(observed) }
            if (!interactionTurn.isCurrent(turn))
              throw new Error('External browser context belongs to a superseded task.')
            browserPage = browserContext.page
            decisionState = { ...decisionState, phase: decisionState?.phase ?? 'ordering', browserContext }
            const allowed = new Set<string>(browserContext.allowedToolNames)
            return { decisionState, tools: browserTools.filter(tool => allowed.has(tool.function.name)) }
          }
          const contextTool = interactiveServiceClient.tools.value.find(tool => tool.name === 'kiosk_conversation_context')
          if (!contextTool || !interactionTurn.isCurrent(turn))
            throw new Error('Current Menu context is unavailable.')
          const includeCatalog = decisionState?.readOnly !== true || decisionState.requireMenuRead === true
          const context = parse(conversationContextSchema, await interactiveServiceClient.execute(contextTool, { includeCatalog }))
          if (!interactionTurn.isCurrent(turn) || context.taskId !== taskId)
            throw new Error('The Menu context belongs to a different task.')
          decisionState = refreshConversationState(context, decisionState)
          retryContextKey = serviceContextKey(context)
          const allowed = new Set(context.allowedToolNames)
          return { decisionState, tools: activeTools.value.filter(tool => allowed.has(tool.function.name)) }
        },
        isRequestComplete: () => browserRequestComplete && interactionTurn.isCurrent(turn),
        prepareQuestionAnswer: () => prepareBrowserQuestionAnswer(interactiveServiceClient),
        onToolResult: (name, content) => {
          if (interactionTurn.isCurrent(turn)) {
            questionReceipt = questionReceiptFrom(content)
            menuReply.record(name, content)
            if (!isKioskConversationRetrySafeTool(name) || questionReceipt)
              operationReply = menuReply.browserOutcome() ?? operationReplyFrom(content) ?? operationReply
            if (questionReceipt || operationReply)
              streamingReply.clear()
          }
        },
        onTurnStarted: () => {
          if (!interactionTurn.isCurrent(turn))
            return
          streamingReply.begin(turn.id, requestMessageId(options.utteranceId, 'reply'))
          timing?.mark('main-round')
          // The SSE turn-started event also appears after browser tool results.
          // Once any tool was requested, keep the Agent non-interruptible until
          // its whole tool/result loop settles; otherwise a later ASR could
          // cancel the continuation and leave an uncertain order state.
          if (request.stage === 'starting')
            request.stage = 'thinking'
          updateAgentStep('Main Agent 理解需求中')
          request.resolveReady()
          if (conversationProgress.value?.turnId !== turn.id)
            startConversationProgress(turn.id, t('stage.kiosk.wait.confirming'))
          if (!longWaitTimer)
            longWaitTimer = setTimeout(extendConversationProgressWait, conversationLongWaitMs, turn.id)
        },
        onToolRequested: (toolName) => {
          if (!interactionTurn.isCurrent(turn))
            return
          streamingReply.clear()
          request.stage = 'tool_requested'
          request.resolveReady()
          updateAgentStep(`Main Agent 已選擇 ${toolName}`)
          interactionTurn.advance(turn, 'using-tool')
          const label = describeToolActivity(toolName, 'selected')
          selectConversationProgressTool(turn.id, toolName, label)
          conversationWorkStatus.value = label
          if (import.meta.env.DEV)
            console.info('[kiosk-tools]', { phase: 'llm-selected', toolName })
        },
        onToolActivity: (toolName, state) => {
          timing?.mark(`browser-${state}`, toolName)
          if (!interactionTurn.isCurrent(turn))
            return
          interactionTurn.advance(turn, 'using-tool')
          if (state === 'executing' && !isKioskConversationRetrySafeTool(toolName)) {
            if (browserOrdering)
              menuReply.beginOperation(toolName, { maySubmit: browserDialogue.hasSubmissionQuestion() })
            browserEffectAttempted = true
            retryCaptured = true
            retryContextKey = undefined
            request.stage = 'mutating'
          }
          updateAgentStep(`${toolName}：${state === 'executing' ? '網頁執行中' : state === 'done' ? '已完成' : '執行失敗'}`)
          const label = describeToolActivity(toolName, state)
          selectConversationProgressTool(turn.id, toolName, label)
          conversationWorkStatus.value = label
          if (import.meta.env.DEV)
            console.info('[kiosk-tools]', { phase: 'browser-execution', state, toolName })
          if (state === 'done' && ['menu_recommend', 'menu_show_recommendations'].includes(toolName))
            playTransientMotion('presentRecommendations')
          if (state === 'done' && ['order_add_item', 'cart_add_item', 'cart_remove_item', 'cart_set_line_quantity', 'order_set_fulfillment'].includes(toolName))
            playTransientMotion('acknowledge')
        },
        onReplyProgress: () => {
          if (!interactionTurn.isCurrent(turn) || questionReceipt || operationReply)
            return
          const message = t('stage.kiosk.wait.generating')
          updateAgentStep(message)
          conversationWorkStatus.value = message
          // This event proves output has started, not that any operation succeeded.
          startConversationProgress(turn.id, message)
        },
        onAssistantDelta: (text) => {
          if (!interactionTurn.isCurrent(turn) || questionReceipt || operationReply)
            return
          updateAgentStep('Main Agent 回覆中')
          // Server emits text only for rounds that need no operation/receipt
          // validation. Keep progress and defer history/TTS until completion.
          streamingReply.append(turn.id, text)
        },
        signal: turn.signal,
      },
    )
    finishExecutionDuration()
    // Release after the tool loop settles, before question presentation or TTS.
    await releaseOrderControl()
    if (!interactionTurn.isCurrent(turn))
      return
    questionReceipt = await validatedQuestionReceipt({ pendingCustomerChoice: questionReceipt })
    if (!interactionTurn.isCurrent(turn))
      return
    if (!reply)
      return
    timing?.mark('main-finished')
    if (reply.reason === 'manual-control') {
      finishConversationProgress(turn.id)
      conversationWorkStatus.value = undefined
      streamingReply.clear()
      const message = [operationReply, t('stage.kiosk-agent.manual-control')].filter(Boolean).join(' ')
      conversationMessages.value = [...conversationMessages.value, { role: 'assistant', id: requestMessageId(options.utteranceId, 'reply'), content: message, slices: [], tool_results: [] }]
      await interactionRecording.append('assistant_text', message, { source: 'verified_reply', utteranceId: options.utteranceId })
      updateAgentStep(message)
      return
    }
    const entryPhase = await readCustomerEntryPhase(turn)
    if (!interactionTurn.isCurrent(turn))
      return
    const entryPrompt = t('stage.kiosk.customer-entry.complete-first')
    let replyContext: KioskConversationDecisionState['context']
    if (reply.requestedTools.every(name => name === 'kiosk_session_history')) {
      const contextTool = interactiveServiceClient.tools.value.find(tool => tool.name === 'kiosk_conversation_context')
      if (contextTool)
        replyContext = parse(conversationContextSchema, await interactiveServiceClient.execute(contextTool, { includeCatalog: true }))
      if (!interactionTurn.isCurrent(turn))
        return
    }
    const presented = replyFromConversation(reply, {
      menu: menuReply,
      requireMenuRead: decisionState?.requireMenuRead,
      // A complete bare greeting is a service exchange even with System One off.
      serviceReply,
      handoff: decisionState?.handoff,
      context: replyContext,
      outcome: operationReply,
      question: questionReceipt,
      ...(browserOrdering ? { browserRecovery: { operationAttempted: browserEffectAttempted, page: browserPage } } : {}),
      failureMessage: t(`stage.kiosk-agent.${reply.reason ?? 'no-reply'}`),
      customerEntry: { phase: entryPhase, prompt: entryPrompt },
    })
    if (entryPhase === 'customer_entry' && presented.content === entryPrompt)
      questionReceipt = undefined
    let answer = presented.role === 'assistant' ? presented.content : undefined
    customerRecoveryPresented = presented.recovery === true
    taskOutcome = answer && !customerRecoveryPresented ? 'completed' : 'failed'
    const replyKind = presented.clarification ? 'clarification' : reply.reply?.kind
    if (!interactionTurn.isCurrent(turn))
      return
    void interactionRecording.append('service_event', JSON.stringify({ kind: 'main_presentation_metrics', taskId, status: presented.role === 'assistant' ? 'presented' : 'rejected', ...(replyKind ? { replyKind } : {}), ...(presented.clarification ? { recovery: 'presentation-clarification' } : {}), ...(presented.recovery ? { recovery: menuReply.orderUnconfirmed() ? 'verify-order' : menuReply.effectState() ?? (browserEffectAttempted ? 'unknown' : 'read-failed') } : {}), ...(presented.role === 'error' || presented.recovery ? { reason: reply.reason ?? 'unverified-reply' } : {}) }), { source: 'main_presentation_metrics' })
    if (!interactionTurn.isCurrent(turn))
      return
    finishConversationProgress(turn.id)
    conversationWorkStatus.value = undefined
    conversationMessages.value = [
      ...conversationMessages.value,
      answer
        ? { role: 'assistant', id: requestMessageId(options.utteranceId, 'reply'), content: answer, slices: [], tool_results: [] }
        : { role: 'error', id: requestMessageId(options.utteranceId, 'reply'), content: presented.content },
    ]
    timing?.mark('reply-text-visible', undefined, 'reply')
    if (answer && browserOrdering && reply.status === 'completed' && !presented.recovery && !questionReceipt) {
      const replyIndex = conversationMessages.value.length - 1
      questionReceipt = await offerCheckout(interactiveServiceClient, browserDialogue, menuReply.cartChange(), () => interactionTurn.isCurrent(turn))
      if (!interactionTurn.isCurrent(turn))
        return
      if (questionReceipt) {
        const content = replyWithQuestion(answer, questionReceipt)
        answer = content
        conversationMessages.value = conversationMessages.value.map((message, index) => index === replyIndex ? { ...message, content } : message)
      }
    }
    if (!answer && !browserEffectAttempted)
      retryableConversationRequest.value = retryContextKey && interactionRecording.visitorSessionId.value ? { state: 'available', text, sessionId: interactionRecording.visitorSessionId.value, iframeRevision: scenarioRegistry.iframeRevision.value, originalUtteranceId: options.utteranceId, requestId: turn.id, contextKey: retryContextKey } : undefined
    updateAgentStep(reply.status === 'completed' && answer && !presented.recovery ? 'Main Agent 已完成' : presented.content)
    streamingReply.clear()
    request.resolveDone()
    if (activeAgentRequest === request)
      activeAgentRequest = undefined
    if (answer) {
      // A repaired clarification owns the next answer just like recovery's
      // service question. Bare assent must not fall through to an older purchase.
      if (replyKind === 'clarification' && replyContext && entryPhase !== 'customer_entry') {
        serviceClarificationWindow.present({ questionId: crypto.randomUUID(), question: answer, sourceUtterance: text, contextKey: serviceContextKey(replyContext), expiresAt: Date.now() + 30_000 })
      }
      interactionTurn.advance(turn, 'speaking')
      // The server keeps operation prose only as an internal draft. Record
      // the validated customer reply once, even if the draft used the same words.
      await interactionRecording.append('assistant_text', answer, { questionId: questionReceipt?.questionId, source: presented.recovery ? 'service_recovery_guidance' : 'verified_reply', utteranceId: options.utteranceId })
      // Information does not answer or revoke the browser's pending ordering
      // question. A selected clarification retains its real question ID above.
      await acknowledgePresentedReply(answer, () => interactionTurn.isCurrent(turn), questionReceipt, !presented.recovery && !replyContext && !browserEffectAttempted && !questionReceipt)
      await speakAssistantReply(answer, turn)
    }
  }
  catch (error) {
    if (interactionTurn.isCurrent(turn)) {
      if (browserOrdering) {
        const recovery = browserRecoveryReply({ operationAttempted: browserEffectAttempted, effect: menuReply.effectState(), orderUnconfirmed: menuReply.orderUnconfirmed(), page: browserPage, verifiedMessage: operationReply ?? menuReply.browserOutcome() })
        customerRecoveryPresented = true
        conversationMessages.value = [...conversationMessages.value, { role: 'assistant', id: requestMessageId(options.utteranceId, 'reply'), content: recovery.content, slices: [], tool_results: [] }]
        // Recording can be the failed boundary. Do not let a second recorder
        // failure remove the visible guidance or affect the next reception.
        void interactionRecording.append('service_event', JSON.stringify({ kind: 'main_request_failed', taskId, operationAttempted: browserEffectAttempted, error: errorMessageFrom(error) }), { utteranceId: options.utteranceId }).catch(error => console.error('Failed to record request failure:', error))
        void interactionRecording.append('assistant_text', recovery.content, { source: 'service_recovery_guidance', utteranceId: options.utteranceId }).catch(error => console.error('Failed to record recovery guidance:', error))
        updateAgentStep(recovery.content)
      }
      else {
        conversationMessages.value = [...conversationMessages.value, { role: 'error', id: requestMessageId(options.utteranceId, 'reply'), content: t(`stage.kiosk-agent.${browserEffectAttempted ? 'result-unknown' : 'reply-incomplete'}`) }]
        if (!browserEffectAttempted && retryContextKey && interactionRecording.visitorSessionId.value)
          retryableConversationRequest.value = { state: 'available', text, sessionId: interactionRecording.visitorSessionId.value, iframeRevision: scenarioRegistry.iframeRevision.value, originalUtteranceId: options.utteranceId, requestId: turn.id, contextKey: retryContextKey }
        updateAgentStep('Main Agent 未能完成')
      }
    }
  }
  finally {
    // Handled guidance closes the message's spinner, not the order. Internal
    // task metrics retain failure; unknown merchant effects are never retried.
    setRequestStatus(options.utteranceId, turn.signal.aborted ? 'cancelled' : customerRecoveryPresented ? 'review' : taskOutcome === 'completed' ? 'completed' : 'failed')
    timing?.mark('task-finished')
    if (timing && taskSessionId === interactionRecording.visitorSessionId.value)
      void interactionRecording.append('service_event', JSON.stringify(timing.snapshot('task', turn.signal.aborted ? 'cancelled' : taskOutcome)), { source: 'utterance_timing', utteranceId: timing.utteranceId })
    turnTimings.delete(turn.id)
    releaseBrowserCartTask?.()
    if (taskBound && taskTool) {
      try {
        await releaseOrderControl()
      }
      catch {
        // A closed iframe cannot acknowledge release. Keep the lock visible;
        // restart replaces the document, and old END cannot clear a new task.
        updateAgentStep('Main Agent 已結束；網頁任務連線已中斷')
      }
    }
    request.resolveReady()
    request.resolveDone()
    if (activeAgentRequest === request)
      activeAgentRequest = undefined
    finishExecutionDuration()
    clearLongWait()
    finishConversationProgress(turn.id)
    streamingReply.clear(turn.id)
    if (interactionTurn.isCurrent(turn)) {
      interactionTurn.complete(turn)
      conversationWorkStatus.value = undefined
    }
  }
}

async function retryConversationMessage() {
  if (decisionStatus.value?.retryable && !conversationSending.value) {
    const entry = decisionEntries.value.find(entry => entry.id === decisionStatus.value?.utteranceId)
    if (entry) {
      decisionProgress.cancel()
      void simulateAsrTranscript(entry.transcript)
      return
    }
  }
  const retry = retryableConversationRequest.value
  if (!retry || conversationSending.value)
    return

  retryableConversationRequest.value = undefined
  const lastMessage = conversationMessages.value.at(-1)
  if (lastMessage?.role === 'error')
    conversationMessages.value = conversationMessages.value.slice(0, -1)
  try {
    const resumed = await resumeConversationRetry(retry, {
      current: async () => {
        const contextKey = await readConversationRetryContext(interactiveServiceClient)
        return { sessionId: interactionRecording.visitorSessionId.value ?? '', iframeRevision: scenarioRegistry.iframeRevision.value, contextKey }
      },
      enqueue: text => utteranceQueue.submit({ source: 'simulation', text }),
      record: event => interactionRecording.append('service_event', JSON.stringify(event), { source: 'conversation_retry' }),
    })
    if (resumed.kind === 'STALE')
      pendingTranscript.value = t('stage.kiosk-agent.retry-stale')
    else if (resumed.kind === 'OVERLOADED')
      pendingTranscript.value = t('stage.kiosk-agent.retry-busy')
  }
  catch {
    pendingTranscript.value = t('stage.kiosk-agent.service-unavailable')
  }
}

const serviceRecoveryContext = computed(() => JSON.stringify([interactionRecording.visitorSessionId.value, scenarioRegistry.activeScenarioId.value, scenarioRegistry.iframeRevision.value, scenarioRegistry.activeScenario.value?.serviceUrl]))

async function recoverOrderingService(isCurrent: () => boolean = () => true) {
  if (serviceRecovering.value || currentAgentRequest())
    return
  const context = serviceRecoveryContext.value
  const current = () => isCurrent() && context === serviceRecoveryContext.value
  serviceRecovering.value = true
  serviceRecoveryBlocked.value = true
  try {
    await recoverConversationService(interactiveServiceClient, [agentOrderOwner.value, pendingAgentOrderOwner.value])
    if (!current())
      return
    if (!current())
      return
    agentOrderOwner.value = undefined
    pendingAgentOrderOwner.value = undefined
    manualControlPending.value = false
    retryableConversationRequest.value = undefined
    serviceRecoveryBlocked.value = false
    pendingTranscript.value = t('stage.kiosk-agent.service-recovered')
    conversationWorkStatus.value = undefined
  }
  catch (error) {
    if (!current())
      return
    const blocked = error instanceof BrowserRecoveryBlocked
    conversationWorkStatus.value = blocked ? error.message : t(interactiveServiceClient.availability.value === 'ready' ? 'stage.kiosk-agent.operation-unconfirmed' : 'stage.kiosk-agent.service-unavailable')
    if (blocked)
      pendingTranscript.value = error.message
    void interactionRecording.append('service_event', JSON.stringify({ kind: 'browser_service_recovery', status: blocked ? 'operation-blocked' : 'unavailable', availability: interactiveServiceClient.availability.value, error: errorMessageFrom(error)?.slice(0, 500) }), { source: 'browser_service_recovery' }).catch(error => console.error('Failed to record browser recovery:', error))
    console.warn('[stage-kiosk] ordering recovery remains paused:', error)
  }
  finally { serviceRecovering.value = false }
}

const automaticServiceRecovery = useKioskServiceRecovery({
  blocked: () => serviceRecoveryBlocked.value || interactiveServiceClient.availability.value === 'unavailable',
  busy: () => conversationSending.value || serviceRecovering.value || activeServiceOperations.size > 0,
  context: () => serviceRecoveryContext.value,
  recover: recoverOrderingService,
})

function describeToolActivity(toolName: string, state: 'executing' | 'done' | 'error' | 'selected') {
  if (toolName === 'browser_question_answer')
    return t(`stage.kiosk.wait.answer-${state === 'selected' ? 'executing' : state}`)
  return describeWebnaviorKioskToolActivity(toolActivityManifest.value, toolName, state)
}

async function handleScenarioCompleted(message?: InteractionLifecycleMessage) {
  if (message?.orderContinuationUrl)
    orderContinuationUrl.value = message.orderContinuationUrl
  if (customerSessionState.value === 'completing')
    return
  // A direct iframe click may emit `activity` and `completed` back-to-back.
  // Establish the anonymous session here as well so completion cannot outrun
  // the asynchronous activity handler and disappear without a customer screen.
  const generation = receptionGeneration
  await recordCustomerActivity('completed')
  if (generation !== receptionGeneration)
    return
  await interactionRecording.append('service_event', 'completed')
  if (message?.orderResult)
    await interactionRecording.recordOrderResult(message.orderResult)
  if (generation === receptionGeneration && customerSession.completeOrder())
    await interactionRecording.append('service_event', 'feedback_invitation_shown')
}

async function finishCustomerSessionCompletion() {
  await interactionRecording.append('service_event', 'feedback_invitation_dismissed')
  mediaCapture.stopContinuousCapture()
  try {
    await customerSession.end('completed')
  }
  catch (error) {
    customerResetError.value = error instanceof BrowserRestartBlocked ? error.message : t('stage.kiosk.cart-handoff.restart-failed')
    console.error('[stage-kiosk] failed to finish the paid customer session:', error)
  }
}

async function startNewCustomerSession() {
  customerResetError.value = undefined
  mediaCapture.stopContinuousCapture()
  try {
    await resetForNewCustomer()
  }
  catch (error) {
    customerResetError.value = error instanceof BrowserRestartBlocked ? error.message : t('stage.kiosk.cart-handoff.restart-failed')
    console.error('[stage-kiosk] failed to start the next customer session:', error)
  }
}

async function restartCustomerSession() {
  const customer = customerSession.customer.value?.sessionId

  // This is an explicit customer reset, not an order completion. It bypasses
  // `completeOrder`, so no thank-you screen or feedback invitation is shown.
  customerResetError.value = undefined
  try {
    mediaCapture.stopContinuousCapture()
    // append captures the old visitor immediately. Its network acknowledgement
    // must not delay entering resetting, which cancels ASR/Jev/Main/TTS now.
    void interactionRecording.append('service_event', 'customer_requested_restart')
    await customerSession.end('staff')
    // resetInteractiveSurface owns presentation cleanup. Do not clear it again
    // here: a new customer may already have started by this continuation.
  }
  catch (error) {
    // A failed reset restores the same anonymous customer; only that customer
    // may see its error. A late reset failure cannot mark a new one failed.
    if (customer !== customerSession.customer.value?.sessionId)
      return
    customerResetError.value = error instanceof BrowserRestartBlocked ? error.message : t('stage.kiosk.cart-handoff.restart-failed')
    console.error('[stage-kiosk] failed to restart the customer session:', error)
    void interactionRecording.append('service_event', JSON.stringify({ kind: 'browser_customer_restart_failed', error: errorMessageFrom(error)?.slice(0, 500) }), { source: 'browser_cart_preparation' })
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
  void endKioskAdminSession().catch(() => console.warn('Could not clear local administrator grant; it will expire automatically.'))
  const { admin: _admin, ...query } = route.query
  void router.replace({ query })
}

let stopMenuActivityListener: (() => void) | undefined
let stopMenuCompletionListener: (() => void) | undefined

onMounted(() => {
  stopMenuActivityListener = scenarioRegistry.on('activity', () => void recordCustomerActivity('scenario'))
  stopMenuCompletionListener = scenarioRegistry.on('completed', message => void handleScenarioCompleted(message))
  void syncProactiveVision()
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
  <main :class="['kiosk-scene', `is-${orientation}`, { 'has-native-console': desktopHost && !props.voiceConversationOnly && !textConsoleFloating }]">
    <KioskAdminAccess class="kiosk-admin-access">
      <span class="i-solar:settings-outline h-4 w-4" aria-hidden="true" />
      <span>設定</span>
    </KioskAdminAccess>

    <aside v-if="adminPanelOpen" class="kiosk-admin-panel-layer">
      <KioskAdminPanel
        v-model:voice-test-enabled="adminVoiceTestEnabled"
        v-model:camera-preview-enabled="cameraPreviewEnabled"
        v-model:conversation-font-size="conversationFontSize"
        v-model:decision-diagnostics-enabled="decisionDiagnosticsEnabled"
        v-model:idle-diagnostics-enabled="idleDiagnosticsEnabled"
        v-model:presence-diagnostics-enabled="presenceDiagnosticsEnabled"
        v-model:paused="paused"
        :device="props.device"
        :text-only-mode="!props.voiceConversationOnly"
        :session-ending="customerSessionState === 'resetting'"
        @test-speech="adminVoiceTest.play()"
        @close="closeAdminPanel"
        @end-session="restartCustomerSession"
        @reload="reloadKiosk"
      >
        <template #device-settings>
          <Button
            v-if="serviceRecoveryBlocked || interactiveServiceClient.availability.value === 'unavailable'"
            :disabled="serviceRecovering || conversationSending"
            :label="t('stage.kiosk-agent.service-reconnect')"
            @click="recoverOrderingService()"
          />
          <DeviceSettingsPanel :endpoint="deviceSettingsEndpoint" mode="local" @updated="emit('deviceSettingsUpdated', $event)" />
        </template>
      </KioskAdminPanel>
    </aside>

    <section :class="['service-hero', `is-${orientation}`]" :style="stageBackgroundStyle">
      <KioskActivityGlow :active="isAudioListening && isSpeech" mode="listening" />
      <section :class="['stage-region', `is-${assistantPresence.mode}`]" aria-label="虛擬服務員">
        <KioskActivityGlow :active="processingSpeechActive || adminVoiceTest.speaking.value" mode="speaking" />
        <WidgetStage
          v-model:state="avatarState"
          class="stage-model"
          :cursor-position="cursorPosition"
          :enable-orbit-controls="false"
          :idle-animation="activeMotionAnimation"
          :animation-loop="activeMotionLoop"
          :paused="paused"
          :thinking="conversationSending"
          :external-audio-source="assistantAudioNode"
        />
        <PaymentReturnButton
          v-if="gatewayPage?.gatewayOrder && interactiveServiceClient.availability.value === 'manual-payment'"
          v-model:busy="paymentNavigationBusy"
          class="customer-restart"
          :disabled="manualControlPending"
          :label="t('stage.kiosk-agent.return-payment')"
          :owner="paymentReturnOwner"
          @result="showPaymentReply"
        />
        <button
          v-else-if="customerSessionState === 'active' || customerSessionState === 'standby'"
          type="button"
          :class="['customer-restart']"
          :disabled="(interactiveServiceClient.availability.value !== 'ready' && !interactiveServiceClient.editorRetired.value) || activeServiceOperations.size > 0"
          @click="startOrRestartCustomerSession"
        >
          <span :class="['i-solar:restart-bold h-4 w-4 shrink-0']" aria-hidden="true" />
          <span>{{ customerSessionButtonLabel }}</span>
        </button>
      </section>
      <KioskAssistantThoughtBubble
        :progress="presentingVoiceReply ? undefined : visibleProgress"
        :recognizing="props.voiceConversationOnly && transcriptionCount > 0"
        :voice-activity="props.voiceConversationOnly && !presentingVoiceReply ? interactionActivityStatus : undefined"
      />
      <KioskConversation
        :service-recovery-blocked="serviceRecoveryBlocked || interactiveServiceClient.availability.value === 'unavailable'"
        :service-recovering="serviceRecovering"
        :service-recovery-exhausted="automaticServiceRecovery.exhausted.value"
        class="conversation-region"
        :execution-duration-ms="adminPanelOpen && isKioskAdminSessionActive ? decisionStatus?.elapsedMs ?? (conversationDiagnosticsEnabled ? conversationExecutionDurationMs : undefined) : undefined"
        :fast-path-simulation-status="asrSimulationStatus"
        :fast-path-simulation-trace="asrSimulationTrace"
        :fast-path-simulation-timing="asrSimulationTiming"
        :assistant-presence="assistantPresence"
        :messages="conversationMessages"
        :request-statuses="requestStatuses"
        :streaming-assistant-message="streamingAssistantMessage"
        :pending-transcript="pendingTranscript"
        :recognizing-count="transcriptionCount"
        :retry-available="!serviceRecoveryBlocked && interactiveServiceClient.availability.value === 'ready' && (Boolean(retryableConversationRequest) || decisionStatus?.retryable === true)"
        :sending="conversationSending"
        :font-size="conversationFontSize"
        :voice-conversation-only="props.voiceConversationOnly"
        :text-console-target="desktopHost && !props.voiceConversationOnly ? '#kiosk-text-console-dock' : undefined"
        @retry-message="retryConversationMessage"
        @simulate-asr="simulateAsrTranscript"
        @text-console-floating="textConsoleFloating = $event"
      />
      <KioskVoiceDiagnostics
        v-if="adminPanelOpen && isKioskAdminSessionActive && voiceDiagnosticsEnabled"
        :entries="voiceDiagnosticEntries"
        :mode="adminVoiceTestActive ? 'admin' : props.voiceConversationOnly ? 'customer' : 'text'"
        :microphone="enabled && audioInputStarted"
        :capturing="isSpeech"
        :probability="isSpeechProb"
        :processing="arrayProcessingLabel"
        :lag-ms="arrayDiagnostics?.lagMs"
        :reference-frames="arrayDiagnostics?.referenceSignalFrames"
        :input-db="arrayDiagnostics?.inputDb"
        :output-db="arrayDiagnostics?.outputDb"
        :limited-percent="arrayDiagnostics?.limitedPercent"
        :blocked-reason="voiceBlockReason()"
        :error="(settingsAudioDeviceStore.inputError?.message || inferenceError) || audioStartupError"
        :target="customerTarget"
        :interruption="interruptionDiagnostic"
        :background-speech-mode="backgroundSpeechMode"
      />
    </section>

    <div v-if="desktopHost && !props.voiceConversationOnly" v-show="!textConsoleFloating" id="kiosk-text-console-dock" :class="['native-text-console']" />
    <ScenarioSurface :operating="pageOperating" :listening="isAudioListening" :occluded="adminPanelOpen" :class="['menu-region']" @activity="!productPresentation.introducing.value && recordCustomerActivity('manual')" />
    <KioskAgentControl
      v-if="agentOrderOwner"
      :releasing="manualControlPending"
      @manual="requestManualOrderControl"
    />

    <KioskIdleDiagnostics
      v-if="adminPanelOpen && isKioskAdminSessionActive && idleDiagnosticsEnabled"
      :idle-deadline-at="idleDeadlineAt"
      :pending-work="hasPendingWork"
      :presence-idle-protection="presenceIdleProtection"
      :state="customerSessionState"
    />
    <KioskPresenceDiagnostics
      v-if="adminPanelOpen && isKioskAdminSessionActive && presenceDiagnosticsEnabled && presenceDecision"
      :decision="presenceDecision"
      :diagnostics="presenceDiagnostics"
      :vision-mode="props.deviceSettings?.presenceVisionMode ?? defaultDeviceSettingsValues.presenceVisionMode"
      :target="customerTarget"
    />

    <KioskDecisionInspector
      v-if="adminPanelOpen && isKioskAdminSessionActive && decisionDiagnosticsEnabled"
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
      :order-continuation-url="orderContinuationUrl"
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
.kiosk-scene { display: grid; box-sizing: border-box; width: 100vw; height: 100dvh; grid-template-columns: minmax(0, 1fr); padding: 1.25rem; overflow: hidden; background: radial-gradient(circle at 12% 0%, rgb(59 79 63 / 24%), transparent 38%), linear-gradient(135deg, #111a17, #15211d); row-gap: 1rem; }
.kiosk-scene.is-landscape { grid-template-rows: minmax(0, .25fr) minmax(0, .75fr); }
.kiosk-scene.is-portrait { grid-template-rows: minmax(0, .25fr) minmax(0, .75fr); }
.kiosk-scene.has-native-console.is-landscape { grid-template-rows: minmax(120px, .25fr) auto minmax(180px, .75fr); }
.kiosk-scene.has-native-console.is-portrait { grid-template-rows: minmax(120px, .25fr) auto minmax(180px, .75fr); }
.native-text-console { position: relative; z-index: 60; min-width: 0; min-height: 0; grid-column: 1; grid-row: 2; }
.has-native-console .menu-region { grid-row: 3; }
.service-hero { position: relative; display: grid; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid rgb(230 255 250 / 10%); border-radius: 1.125rem; background: radial-gradient(ellipse at 24% 16%, rgb(238 205 148 / 10%), transparent 25%), linear-gradient(105deg, #24352d 0%, #1a2922 43%, #101a16 100%); grid-column: 1; grid-row: 1; }.service-hero.is-landscape { grid-template-columns: minmax(5.5rem, .24fr) minmax(0, .76fr); }.service-hero.is-portrait { grid-template-columns: minmax(5.5rem, .24fr) minmax(0, .76fr); }
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
/* Keep the action inside the avatar column, clear of both messages and the native website. */
.customer-restart { position: absolute; z-index: 2; bottom: .75rem; left: .75rem; display: inline-flex; max-width: calc(100% - 1.5rem); min-height: 2.75rem; align-items: center; gap: .4rem; border: 1px solid rgb(217 250 246 / 20%); border-radius: 999px; padding: .45rem .75rem; color: #d9e9e1; background: rgb(16 26 22 / 72%); font-size: .75rem; font-weight: 500; backdrop-filter: blur(.5rem); transition: background .16s ease, opacity .16s ease; }.customer-restart:hover:not(:disabled) { background: rgb(36 53 45 / 94%); }.customer-restart:focus-visible { outline: 2px solid #99f6e4; outline-offset: 2px; }.customer-restart:disabled { cursor: wait; opacity: .55; }

@media (max-width: 700px) {
  .kiosk-scene { padding: .6rem; row-gap: .6rem; }
  .service-hero.is-landscape { grid-template-columns: minmax(5rem, .24fr) minmax(0, .76fr); }
}
</style>
