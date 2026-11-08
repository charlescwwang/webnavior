<script setup lang="ts">
import type { DeviceSettingsSnapshot, DeviceSettingsValues, KioskVoiceVadSettings, PresenceCandidate } from '@proj-airi/kiosk-proactive'
import type { InteractionLifecycleMessage, InteractiveServiceOrderResult } from '@proj-airi/stage-shared/interaction-lifecycle'
import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import type { SpatialInput } from '../audio/spatialInput'
import type { KioskConversationDecisionState, KioskDevice, KioskMediaCaptureMode, KioskPerformanceProfile } from '../services/kiosk-device'
import type { ConversationRetry } from '../services/kioskConversationRetry'
import type { KioskUtterance, KioskUtteranceReservation, KioskUtteranceTicket } from '../services/kioskUtteranceQueue'
import type { VoicePresenceDecision } from '../services/voicePresence'
import type { KioskAssistantPresenceMode } from './KioskAssistantPresence.vue'
import type { KioskDecisionEntry } from './KioskDecisionInspector.vue'
import type { KioskVoiceDiagnosticEntry } from './KioskVoiceDiagnostics.vue'

import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { errorMessageFrom } from '@moeru/std'
import { createAssistanceReminderWindow, createInteractionWindow, createPresenceWindow, defaultDeviceSettingsValues, defaultPresenceSettings, observationSettings } from '@proj-airi/kiosk-proactive'
import { conversationContextSchema, replyFromContext, serviceContextKey, serviceRecoveryLimits } from '@proj-airi/stage-shared/kiosk-conversation'
import { CustomerSessionCompletion, CustomerSessionIdleConfirmation } from '@proj-airi/stage-ui/components'
import { canShowFeedbackInvitation } from '@proj-airi/stage-ui/components/scenarios/feedback-invitation/settings'
import { DeviceSettingsPanel } from '@proj-airi/stage-ui/components/scenarios/kiosk/deviceSettings'
import { WidgetStage } from '@proj-airi/stage-ui/components/scenes'
import { useVAD } from '@proj-airi/stage-ui/stores/ai/models/vad'
import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useLlmToolsStore } from '@proj-airi/stage-ui/stores/llm-tools'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { useIntervalFn, useMouse, useWindowSize } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { parse } from 'valibot'
import { computed, nextTick, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import ArrayMicrophoneSettings from './arrayMicrophoneSettings.vue'
import KioskAdminAccess from './KioskAdminAccess.vue'
import KioskAdminPanel from './KioskAdminPanel.vue'
import KioskAgentControl from './KioskAgentControl.vue'
import KioskAssistantThoughtBubble from './KioskAssistantThoughtBubble.vue'
import KioskAudioStatusOverlay from './KioskAudioStatusOverlay.vue'
import KioskCameraPreview from './KioskCameraPreview.vue'
import KioskConversation from './KioskConversation.vue'
import KioskDecisionInspector from './KioskDecisionInspector.vue'
import KioskIdleDiagnostics from './KioskIdleDiagnostics.vue'
import KioskMicrophoneSetup from './KioskMicrophoneSetup.vue'
import KioskPresenceDiagnostics from './KioskPresenceDiagnostics.vue'
import KioskServiceFault from './KioskServiceFault.vue'
import KioskSessionNotice from './KioskSessionNotice.vue'
import KioskVoiceDiagnostics from './KioskVoiceDiagnostics.vue'
import ScenarioSurface from './ScenarioSurface.vue'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { useArrayMicrophone } from '../composables/useArrayMicrophone'
import { useFeedbackInvitationSettings } from '../composables/useFeedbackInvitationSettings'
import { useKioskAudioStatusPosition } from '../composables/useKioskAudioStatusPosition'
import { useKioskCameraPreview } from '../composables/useKioskCameraPreview'
import { useKioskConversationFontSize } from '../composables/useKioskConversationFontSize'
import { useKioskConversationProgress } from '../composables/useKioskConversationProgress'
import { useKioskCustomerSession } from '../composables/useKioskCustomerSession'
import { useKioskDecisionProgress } from '../composables/useKioskDecisionProgress'
import { useKioskDiagnostics } from '../composables/useKioskDiagnostics'
import { useKioskInteractionRecording } from '../composables/useKioskInteractionRecording'
import { useKioskInteractionTurn } from '../composables/useKioskInteractionTurn'
import { useKioskInteractiveServices } from '../composables/useKioskInteractiveServices'
import { useKioskMediaCapture } from '../composables/useKioskMediaCapture'
import { useKioskMicrophoneSelection } from '../composables/useKioskMicrophoneSelection'
import { useKioskProactiveVision } from '../composables/useKioskProactiveVision'
import { useKioskProcessingCue } from '../composables/useKioskProcessingCue'
import { useKioskServiceFault } from '../composables/useKioskServiceFault'
import { useKioskWaitSpeech } from '../composables/useKioskWaitSpeech'
import { setKioskLocale } from '../modules/i18n'
import { endKioskAdminSession } from '../services/admin-session'
import { createFixedGreetings, greetingPhase } from '../services/fixedGreetings'
import { interactiveServiceClient } from '../services/interactiveServiceClient'
import { transcribeKioskUtterance } from '../services/kiosk-audio'
import { decideKioskInteraction, isKioskFastPathEnabled, KioskDeviceRequestError, reportKioskAudioWarning, resetKioskOrderingContext, synthesizeKioskSpeech, transcribeKioskAudio } from '../services/kiosk-device'
import { conversationDecisionStateFrom, createDecisionFeedback, createIncompleteAsrSession, refreshConversationState, runFastPath, shouldShowDecisionRetry } from '../services/kiosk-fast-path'
import { kioskPerformanceSettings } from '../services/kiosk-performance'
import { createKioskStartupPermissionGate, prepareKioskMicrophonePermission } from '../services/kiosk-startup-permission-gate'
import { isKioskConversationRetrySafeTool, requiresOrderReconciliation, resumeConversationRetry } from '../services/kioskConversationRetry'
import { playKioskAudio } from '../services/kioskPlayback'
import { createKioskUtteranceQueue } from '../services/kioskUtteranceQueue'
import { createInvitationWindow, createMenuReplyWindow, createServiceClarificationWindow, operationRejectionMessage, operationReplyFrom, orderAssistanceFromRejection, questionReceiptFrom, replyFromConversation, replyFromReceipt, replyWithQuestion } from '../services/questionPresentation'
import { scenarioRegistry } from '../services/scenario-registry'
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
type KioskMotionName = 'acknowledge' | 'greeting' | 'idle' | 'listening' | 'presentRecommendations' | 'thinking'

interface FastPathInput {
  id?: number
  deadlineAt?: number
  signal?: AbortSignal
  recording?: Blob
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
const deviceSettingsEndpoint = new URL('/api/kiosk/settings', import.meta.env.VITE_API_SERVER_URL ?? 'http://localhost:5168').href

const configuredOrientation = import.meta.env.VITE_KIOSK_ORIENTATION as KioskOrientation | undefined
const { width, height } = useWindowSize()
const orientation = computed<KioskOrientation>(() => configuredOrientation ?? (width.value >= height.value ? 'landscape' : 'portrait'))
const paused = shallowRef(false)

const settingsAudioDeviceStore = useSettingsAudioDevice()
const microphoneSelection = useKioskMicrophoneSelection()
const microphoneChoice = microphoneSelection.microphone
const { language } = storeToRefs(useSettings())
const fixedGreetings = createFixedGreetings(synthesizeKioskSpeech)
const { enabled, stream: rawMicrophoneStream, permissionState } = storeToRefs(settingsAudioDeviceStore)
const chatSessionStore = useChatSessionStore()
const audioContext = shallowRef<AudioContext>()
const assistantAudioNode = shallowRef<AudioNode>()
const { activeTools } = storeToRefs(useLlmToolsStore())
const { activeCardId } = storeToRefs(useAiriCardStore())
const conversationMessages = shallowRef<ChatHistoryItem[]>([])
const conversationWorkStatus = shallowRef<string>()
const conversationActivitySteps = shallowRef<Array<{ label: string, state: 'done' | 'error' | 'executing' | 'selected', toolName: string }>>([])
const serviceRecoveryBlocked = shallowRef(false)
const serviceFault = useKioskServiceFault(conversationMessages)
const serviceFaultLocked = serviceFault.locked
const faultRecoveryBusy = shallowRef(false)
const processingSpeechActive = shallowRef(false)
const speechPreparationCount = shallowRef(0)
let speechGeneration = 0
const transcriptionCount = shallowRef(0)
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
const streamingAssistantMessage = shallowRef<ChatHistoryItem>()
const pendingTranscript = shallowRef<string>()
const recognizedTranscripts = shallowRef<Array<{ id: number, text: string, waiting?: boolean }>>([])
const customerResetError = shallowRef<string>()
const voiceDiagnosticEntries = shallowRef<KioskVoiceDiagnosticEntry[]>([])
let nextVoiceDiagnosticId = 0
const voiceDiagnosticByUtterance = new Map<number, number>()
const toolActivityManifest = shallowRef<Awaited<ReturnType<typeof loadWebnaviorKioskActivityManifest>>>()
const interactionTurn = useKioskInteractionTurn()
const waitSpeech = useKioskWaitSpeech({
  synthesize: synthesizeKioskSpeech,
  play: (audio, turn, signal) => speakAssistantReply('', turn, audio, signal),
})
// Decision progress is display-only, so an unverified utterance cannot own or
// cancel an interaction turn. Agent progress takes precedence during handoff.
const visibleProgress = computed(() => conversationProgress.value ?? (decisionStatus.value?.pending
  ? { phase: 'understanding' as const, message: t(`stage.kiosk.service-recovery.${decisionStatus.value.messageKey}`) }
  : undefined) ?? (fastPathProgress.value
  ? { phase: 'understanding' as const, message: fastPathProgress.value.text }
  : undefined))
watch([
  () => props.device?.id,
  () => props.greetingPhrases,
  () => props.deviceSettings?.greetingEnabled,
  () => props.proactiveVlmEnabled,
  language,
  locale,
], () => {
  interactionTurn.cancelProactive()
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
const interactionRecording = useKioskInteractionRecording()
// Admission survives across decision callbacks until this queue item settles.
// Correlate by utterance ID, never by equal text from an earlier customer turn.
const shownUtteranceIds = new Set<number>()
const utteranceQueue = createKioskUtteranceQueue({
  onReceived: (utterance) => {
    if (props.deviceSettings?.backgroundSpeechMode === 'off')
      recognizedTranscripts.value = [...recognizedTranscripts.value.filter(entry => entry.id !== utterance.id), { id: utterance.id, text: utterance.text, waiting: true }]
  },
  onDrop: (utterance, reason) => {
    const visible = recognizedTranscripts.value.some(entry => entry.id === utterance.id)
    recognizedTranscripts.value = recognizedTranscripts.value.filter(entry => entry.id !== utterance.id)
    if (visible) {
      conversationMessages.value = [...conversationMessages.value, { role: 'user', content: utterance.text }, { role: 'assistant', content: t(reason === 'expired' ? 'stage.kiosk-agent.queued-expired' : 'stage.kiosk-agent.queued-cancelled'), slices: [], tool_results: [] }]
    }
    finishVoiceDiagnostic(utterance.id, 'failed')
    if (utterance.source === 'simulation')
      asrSimulationStatus.value = reason === 'expired' ? '這句等待太久，未執行；請重新送出。' : '會話已重設，待處理語句已取消。'
    else if (reason === 'expired')
      pendingTranscript.value = '剛才語句等待太久，請再說一次。'
  },
  onError: (utterance, error) => {
    finishVoiceDiagnostic(utterance.id, 'failed')
    console.error('Failed to process kiosk utterance:', error)
    serviceFault.lock()
    if (utterance.source === 'simulation')
      asrSimulationStatus.value = '無法確認這句是否已操作成功，請先查看購物車或訂單，不要直接重試。'
    else
      pendingTranscript.value = '無法確認操作結果，請先查看購物車或訂單。'
  },
  onState: state => utteranceQueueState.value = state,
  process: async (utterance, ticket) => {
    try {
      await processKioskUtterance(utterance, ticket)
    }
    catch (cause) {
      if (ticket.isCurrent()) {
        serviceFault.failUtterance({ transcript: utterance.text, shownInput: shownUtteranceIds.has(utterance.id), message: t('stage.kiosk-agent.utterance-failed') })
        // Record a finite outcome only; client exception text/stack may contain
        // private runtime data and stays in the local console.
        void interactionRecording.append('service_event', JSON.stringify({ kind: 'utterance_processing_failed', utteranceId: utterance.id }), { source: 'utterance_processing_metrics', utteranceId: utterance.id })
      }
      throw cause
    }
    finally {
      shownUtteranceIds.delete(utterance.id)
      if (!ticket.isCurrent())
        decisionProgress.cancel(utterance.id)
      else
        decisionProgress.finish(utterance.id, { kind: 'UNAVAILABLE', reason: 'PROVIDER_FAILURE' })
      if (fastPathProgress.value?.utteranceId === utterance.id)
        fastPathProgress.value = undefined
    }
  },
})
const processingCue = useKioskProcessingCue(
  () => speechPreparationCount.value > 0 || transcriptionCount.value > 0 || Boolean(utteranceQueueState.value.active) || utteranceQueueState.value.pending.length > 0 || (['thinking', 'using-tool'].includes(interactionTurn.phase.value) && Boolean(currentAgentRequest())),
  () => serviceFaultLocked.value,
  () => processingSpeechActive.value,
  () => transcriptionCount.value > 0 || utteranceQueueState.value.pending.some(utterance => utterance.source === 'asr'),
)

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
  Boolean(fastPathProgress.value) || interactionTurn.phase.value === 'thinking' || interactionTurn.phase.value === 'using-tool'
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
  const entry: KioskVoiceDiagnosticEntry = { id, status: 'capturing', stage: 'speech_start' }
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
const conversationActivityStatus = computed(() => {
  if (utteranceQueueState.value.pending.some(utterance => utterance.source === 'simulation'))
    return t('stage.kiosk.service-recovery.queued')
  if (decisionStatus.value)
    return t(`stage.kiosk.service-recovery.${decisionStatus.value.messageKey}`)
  if (fastPathProgress.value)
    return fastPathProgress.value.text
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
const agentOrderOwner = shallowRef<string>()
// BEGIN can succeed in Menu before its reply is lost. Retain the issued owner
// separately from acknowledged control so recovery can end only our own task.
const pendingAgentOrderOwner = shallowRef<string>()
watch(interactiveServiceClient.availability, (availability) => {
  if (availability === 'unavailable' && (agentOrderOwner.value || pendingAgentOrderOwner.value))
    serviceRecoveryBlocked.value = true
})
const stopToolDiagnostics = interactiveServiceClient.onExecution((event) => {
  void interactionRecording.append('service_event', JSON.stringify({
    kind: 'browser_tool_metrics',
    connectionId: event.connectionId,
    documentId: event.documentId,
    operationId: event.operationId,
    taskId: agentOrderOwner.value,
    toolName: event.tool.name,
    phase: event.phase,
    // Context failures happen before Main. Retain only the bounded schema marker;
    // arbitrary RPC exception text may contain customer or provider data.
    ...(event.phase === 'failed' && event.tool.name === 'kiosk_conversation_context'
      ? { failureCode: 'CONTEXT_EXECUTION_FAILED', validationPaths: event.error?.match(/CONTEXT_INVALID:([\w.,-]{1,384})/iu)?.[1] }
      : {}),
  }), { source: 'browser_tool_metrics' })
})
onUnmounted(stopToolDiagnostics)
const manualControlPending = shallowRef(false)
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
const completionPending = shallowRef(false)
const completedOrderResult = shallowRef<InteractiveServiceOrderResult>()
const completedOrderReceiptUrl = shallowRef<string>()
const customerSession = useKioskCustomerSession({
  activeCardId,
  chatSession: chatSessionStore,
  resetOrderRound: async () => {
    // Other approved interactive services do not own a POS ordering context.
    // Keep their existing reload behavior; Menu completion also survives a
    // temporary tool-discovery outage until the round has safely advanced.
    if (completedOrderResult.value || interactiveServiceClient.tools.value.some(tool => tool.name === 'kiosk_conversation_context'))
      await resetKioskOrderingContext()
  },
  endVisitorSession: () => interactionRecording.end('idle'),
  resetConversation: clearConversationPresentation,
})
const voiceInputAllowed = computed(() => customerSession.acceptsVoiceInput.value && !completionPending.value)
const performanceSettings = computed(() => kioskPerformanceSettings[props.performanceProfile])
// The constrained profile intentionally cannot start continuous capture. The
// Server still retains the selected policy, but weak kiosk hardware always has
// a local safety ceiling instead of consuming its memory with long recordings.
const effectiveMediaCaptureMode = computed<KioskMediaCaptureMode>(() => (
  props.performanceProfile === 'constrained' && props.mediaCaptureMode === 'continuous'
    ? 'triggered'
    : props.mediaCaptureMode
))
// Pause the array graph with VAD; resuming creates a fresh input generation.
const arrayActive = computed(() => enabled.value && props.voiceConversationOnly && voiceInputAllowed.value)
const arrayMicrophone = useArrayMicrophone(rawMicrophoneStream, arrayActive, processingSpeechActive)
const { stream } = arrayMicrophone
// Device operations only: never present this warning in customer dialogue or TTS.
// One warning per failed generation; reporting has a deadline and never blocks VAD.
watch(arrayMicrophone.warning, (warning) => {
  if (warning)
    void reportKioskAudioWarning(warning).catch(() => console.warn('Kiosk audio diagnostic delivery failed.'))
})
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
const { idleDiagnosticsEnabled, presenceDiagnosticsEnabled, decisionDiagnosticsEnabled } = useKioskDiagnostics()
const showDevelopmentDiagnostics = import.meta.env.DEV
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
// Agent-originated completion travels in the interactive service tool result. Direct
// customer interaction continues to use the iframe lifecycle event registered
// below, so both routes converge on the same session transition.
watch(interactiveServiceClient.completionRevision, (revision, previousRevision) => {
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
const voicePresence = createVoicePresenceGate()
const lastPresenceCandidate = shallowRef<Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'>>()
let visualEngagementProtectionStartedAtMs: number | undefined
const presenceDiagnostics = shallowRef<{ cadenceTier: 'idle' | 'boost' | 'stable', faceActive: boolean, poseIntervalMs: number }>({ cadenceTier: 'idle', faceActive: false, poseIntervalMs: performanceSettings.value.detectionIntervalMs })
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
    voicePresence.reset()
    cameraStream.value = stream
    mediaCapture.attachCameraStream(stream)
  },
  onObservation: observation => void handleProactiveObservation(observation),
  onPresenceCandidate: candidate => handlePresenceCandidate(candidate),
  onDiagnostics: diagnostics => presenceDiagnostics.value = diagnostics,
})
const cameraRequired = computed(() => localObservationRequired.value || effectiveMediaCaptureMode.value !== 'off')
function readVoiceAdmission() {
  return voicePresence.inspect({ enabled: localObservationRequired.value, observing: proactiveVision.status.value === 'observing', nowMs: performance.now() })
}
function allowsObservedVoice() {
  return voiceInputAllowed.value && !serviceFaultLocked.value && readVoiceAdmission().allowed
}
const lastVoiceBlock = shallowRef<VoicePresenceDecision>()
const { x, y } = useMouse()
const cursorPosition = computed(() => ({ x: x.value, y: y.value }))
let audioGeneration = 0
let stopAssistantAudio: (() => void) | undefined
let activeVoiceCandidate: ReturnType<typeof interactionTurn.beginCustomerVoiceCandidate> | undefined
// One VAD segment owns one diagnostic ID even when admission rejects its start.
// This slot is independent of the customer candidate, which only exists if allowed.
let activeVoiceDiagnostic: { id: number, blocked: boolean } | undefined
function retireVoiceCaptureDiagnostic(reason: 'capture_stopped' | 'incomplete_segment') {
  if (activeVoiceDiagnostic && !activeVoiceDiagnostic.blocked)
    updateVoiceDiagnostic(activeVoiceDiagnostic.id, { status: 'blocked', reason, stage: 'capture' })
  activeVoiceDiagnostic = undefined
}

const recognitionInputGainDb = arrayMicrophone.inputGainDb
let voiceAdmissionCounts = { startBlocked: 0, endBlocked: 0, noCandidate: 0, overloaded: 0, asrRequests: 0 }
const { dispose, inferenceError, inputClippedSamples, getInputDiagnostics, init, loaded, start, processPcm } = useVAD(workletUrl, {
  inputGainDb: recognitionInputGainDb,
  threshold: computed(() => props.voiceVadSettings.threshold),
  minSpeechDurationMs: computed(() => props.voiceVadSettings.minSpeechDurationMs),
  maxSpeechDurationS: computed(() => props.voiceVadSettings.maxSpeechDurationS),
  minSilenceDurationMs: computed(() => props.voiceVadSettings.minSilenceDurationMs),
  speechPadMs: computed(() => props.voiceVadSettings.speechPadMs),
  onSpeechStart: () => {
    if (serviceFaultLocked.value || !voiceInputAllowed.value)
      return
    // Ordinary waiting music survives VAD events. Actual reply playback owns
    // the feedback mute boundary.
    retireVoiceCaptureDiagnostic('incomplete_segment')
    const diagnosticId = startVoiceDiagnostic()
    activeVoiceDiagnostic = { id: diagnosticId, blocked: false }
    const admission = readVoiceAdmission()
    if (!admission.allowed) {
      lastVoiceBlock.value = admission
      activeVoiceDiagnostic.blocked = true
      updateVoiceDiagnostic(diagnosticId, { status: 'blocked', reason: admission.reason, stage: 'speech_start' })
      voiceAdmissionCounts.startBlocked += 1
      return
    }
    activeVoiceCandidate = interactionTurn.beginCustomerVoiceCandidate()
    if (arrayMicrophone.earlyBargeIn.value && processingSpeechActive.value) {
      // Dynamic spatial output alone feeds the existing Silero VAD. Stop only
      // audible speech: cancelling the turn here would abort pending commerce
      // work or the newly captured candidate before its ordinary ASR flow.
      interruptAssistantOutput()
      console.info('Kiosk spatial barge-in', { generation: audioGeneration, ...arrayMicrophone.pcmSource.value?.statistics })
    }
    // Standard microphones and the disabled feature retain semantic interruption.
  },
  onSpeechReady: ({ buffer }) => {
    if (serviceFaultLocked.value || !voiceInputAllowed.value)
      return
    // Release this capture slot before ASR so another final utterance can be
    // transcribed independently while the first is waiting for a decision.
    const candidate = activeVoiceCandidate
    activeVoiceCandidate = undefined
    const diagnostic = activeVoiceDiagnostic
    activeVoiceDiagnostic = undefined
    const diagnosticId = diagnostic?.id ?? startVoiceDiagnostic()
    if (!candidate) {
      voiceAdmissionCounts.noCandidate += 1
      if (!diagnostic?.blocked)
        updateVoiceDiagnostic(diagnosticId, { status: 'blocked', reason: 'no_candidate', stage: 'speech_end' })
      return
    }
    const admission = readVoiceAdmission()
    if (!admission.allowed) {
      lastVoiceBlock.value = admission
      updateVoiceDiagnostic(diagnosticId, { status: 'blocked', reason: admission.reason, stage: 'speech_end' })
      voiceAdmissionCounts.endBlocked += 1
      interactionTurn.completeVoiceCandidate(candidate)
      return
    }
    const reservation = utteranceQueue.reserve('asr')
    if (reservation.kind === 'OVERLOADED') {
      updateVoiceDiagnostic(diagnosticId, { status: 'blocked', reason: 'queue_full', stage: 'speech_end' })
      voiceAdmissionCounts.overloaded += 1
      interactionTurn.completeVoiceCandidate(candidate)
      pendingTranscript.value = '目前語句太多，請稍後再說一次。'
      return
    }
    void processVoiceCandidate(buffer, candidate, reservation, diagnosticId)
  },
})

// Model and graph failures are operational diagnostics, never customer dialogue.
watch(inferenceError, (message) => {
  if (message)
    void reportKioskAudioWarning({ generation: Math.max(1, audioGeneration), stage: 'vad', outcome: 'unavailable', code: 'vad_error' }).catch(() => console.warn('Kiosk audio diagnostic delivery failed.'))
})
// Read metadata four times per second only while the operator panel is open.
// The DSP/VAD owners never retain waveform data for these diagnostics.
const inputDiagnostics = shallowRef<ReturnType<typeof getInputDiagnostics>>()
const spatialStatistics = shallowRef<SpatialInput['statistics']>()
const admissionCounts = shallowRef({ ...voiceAdmissionCounts })
const presenceAdmission = shallowRef<VoicePresenceDecision>()
useIntervalFn(() => {
  if (!adminPanelOpen.value)
    return
  inputDiagnostics.value = getInputDiagnostics()
  spatialStatistics.value = arrayMicrophone.pcmSource.value?.statistics
  admissionCounts.value = { ...voiceAdmissionCounts }
  presenceAdmission.value = readVoiceAdmission()
}, 250)
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

async function processVoiceCandidate(
  buffer: Float32Array,
  candidate: NonNullable<ReturnType<typeof interactionTurn.beginCustomerVoiceCandidate>>,
  reservation: Extract<KioskUtteranceReservation, { kind: 'ACCEPTED' }>,
  diagnosticId: number,
) {
  const admission = readVoiceAdmission()
  if (!voiceInputAllowed.value || buffer.length === 0 || !admission.allowed) {
    updateVoiceDiagnostic(diagnosticId, { status: 'blocked', reason: buffer.length === 0 ? 'empty_audio' : admission.reason, stage: 'before_asr' })
    voiceAdmissionCounts.endBlocked += 1
    reservation.cancel()
    interactionTurn.completeVoiceCandidate(candidate)
    return
  }
  updateVoiceDiagnostic(diagnosticId, { status: 'recognizing', stage: 'before_asr' })
  voiceDiagnosticByUtterance.set(reservation.id, diagnosticId)
  let submitted = false
  // Schedule the receipt sound before handing this complete voice segment to
  // ASR. Recognition proceeds without waiting for the short chime to finish.
  transcriptionCount.value += 1
  processingCue.acknowledge()
  try {
    const { recording, text } = await transcribeKioskUtterance(buffer, {
      signal: AbortSignal.any([candidate.signal, reservation.signal]),
      onChunkTranscribed: reservation.markTranscriptionProgress,
      transcribe: (...args) => {
        voiceAdmissionCounts.asrRequests += 1
        return transcribeKioskAudio(...args)
      },
    })
    const afterAsrAdmission = readVoiceAdmission()
    if (!voiceInputAllowed.value)
      return
    if (!afterAsrAdmission.allowed) {
      updateVoiceDiagnostic(diagnosticId, { status: 'ignored', text, reason: afterAsrAdmission.reason, stage: 'after_asr' })
      return
    }
    if (!text.trim()) {
      updateVoiceDiagnostic(diagnosticId, { status: 'unrecognized' })
      return
    }
    updateVoiceDiagnostic(diagnosticId, { status: 'recognized', text, stage: 'after_asr' })
    if (!interactionTurn.isCurrentVoiceCandidate(candidate))
      return
    recognizedTranscripts.value = [...recognizedTranscripts.value.filter(entry => entry.id !== reservation.id), { id: reservation.id, text }].slice(-16)
    reservation.complete({ recording, text })
    submitted = true
    pendingTranscript.value = undefined
  }
  catch (error) {
    updateVoiceDiagnostic(diagnosticId, { status: 'failed' })
    if (!candidate.signal.aborted && !reservation.signal.aborted) {
      pendingTranscript.value = t(error instanceof KioskDeviceRequestError && error.status === 413 ? 'stage.kiosk-agent.audio-too-large' : 'stage.kiosk-agent.audio-failed')
      console.error('Failed to process kiosk voice candidate:', error)
    }
  }
  finally {
    transcriptionCount.value -= 1
    reservation.cancel()
    if (!submitted)
      voiceDiagnosticByUtterance.delete(reservation.id)
    interactionTurn.completeVoiceCandidate(candidate)
  }
}

/** One final ASR utterance enters the same decision path in live and test mode. */
async function processKioskUtterance(utterance: KioskUtterance, ticket: KioskUtteranceTicket) {
  if (serviceFaultLocked.value || !voiceInputAllowed.value)
    return
  // A captured utterance may have waited behind a tool round. Recheck before
  // Jev/Main, without cancelling already-issued commerce work or touch input.
  if (utterance.source === 'asr' && !allowsObservedVoice()) {
    finishVoiceDiagnostic(utterance.id, 'ignored')
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
  let latestDecisionTrace: unknown
  // These totals belong to this utterance, across re-decisions/read review.
  // Repeated execution trace notifications must not count the same call twice.
  let requestDurationMs = 0
  let modelDurationMs: number | undefined = 0
  let modelCalls: number | undefined = 0
  let modelQuestions: number | undefined = 0
  let firstResultDurationMs: number | undefined
  let shownInput = false
  let acceptedInput = false
  // Visibility is independent of service admission. With background filtering
  // off, both typed simulation and ASR keep the submitted sentence even when
  // browser context/model processing fails before admission. This grants no
  // cart/tool authority and does not reset the customer-activity timer.
  if (props.deviceSettings?.backgroundSpeechMode === 'off') {
    shownInput = true
    shownUtteranceIds.add(utterance.id)
    conversationMessages.value = [...conversationMessages.value, { role: 'user', content: utterance.text }]
    recognizedTranscripts.value = recognizedTranscripts.value.filter(entry => entry.id !== utterance.id)
    await interactionRecording.append('asr_transcript', utterance.text, { source: `background_filter_off_${utterance.source}`, utteranceId: utterance.id })
    recordedFastPathInput = true
  }
  let earlyReplyIndex: number | undefined
  const earlyReadMessages: string[] = []
  for (let attempt = 0; attempt < 3 && ticket.isCurrent(); attempt++) {
    decisionProgress.start(utterance.id, utterance.source, input.deadlineAt! - serviceRecoveryLimits.turnMs)
    if (shownInput)
      decisionProgress.admit(utterance.id, true)
    const active = currentAgentRequest()
    let selectedTurn: ReturnType<typeof interactionTurn.begin> | undefined
    const result = await runFastPath({
      onUtteranceAccepted: async () => {
        if (acceptedInput || !ticket.isCurrent())
          return
        acceptedInput = true
        // Commit the confirmed customer turn before any browser write or Agent
        // completion. Utterance ID prevents retries/re-decisions adding it twice.
        if (!shownInput) {
          shownInput = true
          shownUtteranceIds.add(utterance.id)
          conversationMessages.value = [...conversationMessages.value, { role: 'user', content: utterance.text }]
          recognizedTranscripts.value = recognizedTranscripts.value.filter(entry => entry.id > utterance.id)
        }
        await recordCustomerActivity(utterance.source === 'asr' ? 'voice_input' : 'asr_simulation')
        if (!recordedFastPathInput) {
          await interactionRecording.append('asr_transcript', utterance.text, { decisionRoute: 'utterance_accepted', source: utterance.source, utteranceId: utterance.id })
          recordedFastPathInput = true
        }
      },
      isEnabled: isKioskFastPathEnabled,
      serviceClarification: state => serviceClarificationWindow.current(state),
      activeRequest: active ? { stage: active.stage, text: active.text.slice(0, 240) } : undefined,
      decide: async (request) => {
        await interactionRecording.flush()
        const startedAt = performance.now()
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
            shownUtteranceIds.add(utterance.id)
          }
          earlyReadMessages.push(readMessage)
          if (earlyReplyIndex === undefined) {
            earlyReplyIndex = conversationMessages.value.length
            conversationMessages.value = [...conversationMessages.value, { role: 'assistant', content: readMessage, slices: [], tool_results: [] }]
          }
          else {
            conversationMessages.value = conversationMessages.value.map((message, index) => index === earlyReplyIndex ? { ...message, content: earlyReadMessages.join('\n') } : message)
          }
          fastPathProgress.value = { utteranceId: utterance.id, text: '已取得結果，正在確認是否需要補充…' }
        }
        await interactionRecording.start(scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction')
        if (!recordedFastPathInput) {
          await interactionRecording.append('asr_transcript', utterance.text, { decisionRoute: 'fast_path', source: utterance.source, utteranceId: utterance.id })
          recordedFastPathInput = true
        }
        if (trace?.authorize?.kind === 'EXECUTE' && trace.operationPlan?.toolName) {
          if (latestDecisionTrace)
            await interactionRecording.append('service_event', JSON.stringify({ kind: 'system_one_decision', trace: latestDecisionTrace }), { decisionRoute: 'fast_path', source: utterance.source })
          await interactionRecording.append('tool_call', JSON.stringify(trace.operationPlan.input ?? {}), { decisionRoute: 'fast_path', name: trace.operationPlan.toolName })
          await interactionRecording.append('tool_result', JSON.stringify(payload), { decisionRoute: 'fast_path', name: trace.operationPlan.toolName })
        }
      },
      isCurrent: () => ticket.isCurrent() && (utterance.source !== 'asr' || allowsObservedVoice()),
      onActionSelected: async () => {
        if (utterance.source === 'asr' && !allowsObservedVoice())
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
          if (ticket.isCurrent() && (utterance.source !== 'asr' || allowsObservedVoice()))
            conversationMessages.value = [...conversationMessages.value, { role: 'assistant', content: t('stage.kiosk-agent.unstarted-replaced'), slices: [], tool_results: [] }]
        }
        if (!ticket.isCurrent() || (utterance.source === 'asr' && !allowsObservedVoice()))
          return 'DEFER'
        interruptAssistantOutput()
        selectedTurn = interactionTurn.begin('voice', 'thinking')
      },
      onTrace: (trace) => {
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
      webMcp: { availability: serviceRecoveryBlocked.value ? 'unavailable' : interactiveServiceClient.availability.value, execute: interactiveServiceClient.execute, tools: interactiveServiceClient.tools.value },
    })
    if (!ticket.isCurrent())
      return
    void interactionRecording.append('service_event', JSON.stringify({ kind: 'decision_returned', utteranceId: utterance.id, decision: result.kind, reason: result.reason, shownInput }), { source: 'utterance_processing_metrics', utteranceId: utterance.id })
    if (result.kind !== 'DEFERRED') {
      decisionProgress.finish(utterance.id, result)
      serviceClarificationWindow.settle(result)
    }
    // Do not escalate a late decision after the visitor has left. Accepted or
    // uncertain execution receipts still settle normally, without retrying.
    if (utterance.source === 'asr' && !allowsObservedVoice() && result.kind !== 'FAST_ACTION' && result.kind !== 'EXECUTION_FAILED') {
      if (selectedTurn && interactionTurn.isCurrent(selectedTurn))
        interactionTurn.complete(selectedTurn)
      const presence = readVoiceAdmission()
      void interactionRecording.append('service_event', JSON.stringify({ kind: 'decision_not_presented', utteranceId: utterance.id, decision: result.kind, shownInput, reason: 'LOCAL_PRESENCE_REQUIRED', presence, cameraStatus: proactiveVision.status.value }), { source: 'voice_admission_metrics', utteranceId: utterance.id })
      // The receipt gate remains closed. An already admitted customer turn
      // still needs a visible conclusion; do not speak to an absent visitor.
      if (shownInput)
        conversationMessages.value = [...conversationMessages.value, { role: 'assistant', content: t('stage.kiosk-agent.voice-presence-lost'), slices: [], tool_results: [] }]
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
      const rejectedMessage = operationRejectionMessage(result.result, result.uncertain)
      const knownRejection = Boolean(rejectedMessage)
      const assistance = orderAssistanceFromRejection(result.result, utterance.text, result.decisionState, result.uncertain)
      if (assistance)
        serviceClarificationWindow.present(assistance)
      const message = assistance?.question ?? (knownRejection
        ? rejectedMessage!
        : result.uncertain
          ? '暫時無法確認這次操作結果，請先確認畫面上的購物車或訂單，不要重複付款。'
          : '這次操作未完成，請確認畫面後再試一次或使用螢幕操作。')
      const response: ChatHistoryItem = knownRejection || !result.uncertain
        ? { role: 'assistant', content: message, slices: [], tool_results: [] }
        : { role: 'error', content: message }
      conversationMessages.value = [...conversationMessages.value, ...(!shownInput ? [{ role: 'user' as const, content: utterance.text }] : []), response]
      await interactionRecording.append('asr_transcript', utterance.text, { decisionRoute: 'execution_failed', source: utterance.source, utteranceId: utterance.id })
      await interactionRecording.append('service_event', JSON.stringify({ kind: 'webmcp_execution_failed', uncertain: result.uncertain, result: result.result, trace: latestDecisionTrace }), { decisionRoute: 'execution_failed', utteranceId: utterance.id })
      updateDecisionEntry(utterance.id, { route: 'execution_failed', reason: result.uncertain ? 'RESULT_UNKNOWN' : 'REJECTED' })
      if (knownRejection || !result.uncertain) {
        await interactionRecording.append('assistant_text', message, { source: 'page_rejection' })
        if (selectedTurn && interactionTurn.isCurrent(selectedTurn)) {
          interactionTurn.advance(selectedTurn, 'speaking')
          await speakAssistantReply(message, selectedTurn)
        }
      }
      if (selectedTurn && interactionTurn.isCurrent(selectedTurn))
        interactionTurn.complete(selectedTurn)
      if (utterance.source === 'simulation')
        asrSimulationStatus.value = message
      finishVoiceDiagnostic(utterance.id, 'failed')
      return
    }
    if (result.kind === 'SERVICE_UNAVAILABLE') {
      serviceRecoveryBlocked.value = true
      pendingTranscript.value = t('stage.kiosk-agent.service-unavailable')
      asrSimulationStatus.value = pendingTranscript.value
      updateDecisionEntry(utterance.id, { route: 'unavailable', agentStep: pendingTranscript.value })
      finishVoiceDiagnostic(utterance.id, 'failed')
      return
    }
    if (result.kind === 'IGNORE' || result.kind === 'INCOMPLETE' || result.kind === 'UNAVAILABLE') {
      if (result.kind !== 'INCOMPLETE')
        recognizedTranscripts.value = recognizedTranscripts.value.filter(entry => entry.id !== utterance.id)
      // Technical failure cannot depend on prior admission. Keep the original
      // speech and append an error so the existing service-pause owner opens
      // its staff-notification dialog and blocks further order operations.
      if (serviceFault.failDecision(result, { transcript: utterance.text, shownInput, message: t('stage.kiosk-agent.decision-failed') })) {
        shownInput = true
        shownUtteranceIds.add(utterance.id)
        await interactionRecording.append('asr_transcript', utterance.text, { decisionRoute: 'unavailable', source: utterance.source, utteranceId: utterance.id })
        await interactionRecording.append('service_event', JSON.stringify({ kind: 'decision_not_completed', result: result.kind, reason: result.reason, recovery: result.recovery, trace: latestDecisionTrace }), { decisionRoute: 'unavailable', utteranceId: utterance.id })
        if (!currentAgentRequest() && ticket.isCurrent()) {
          const failureTurn = interactionTurn.begin('voice', 'speaking')
          await speakAssistantReply(t('stage.kiosk-agent.decision-failed'), failureTurn)
          if (interactionTurn.isCurrent(failureTurn))
            interactionTurn.complete(failureTurn)
        }
      }
      else if (result.kind === 'UNAVAILABLE' && props.deviceSettings?.backgroundSpeechMode === 'off' && result.decisionState?.phase === 'ordering') {
        const question = serviceClarificationWindow.clarify(result.decisionState, utterance.text)
        const message = question?.question ?? t('stage.kiosk-agent.meaning-unresolved')
        conversationMessages.value = [...conversationMessages.value, { role: 'assistant', content: message, slices: [], tool_results: [] }]
        await interactionRecording.append('assistant_text', message, { source: 'bounded_meaning_repair', questionId: question?.questionId })
        if (!currentAgentRequest() && ticket.isCurrent()) {
          const repairTurn = interactionTurn.begin('voice', 'speaking')
          await speakAssistantReply(message, repairTurn)
          if (interactionTurn.isCurrent(repairTurn))
            interactionTurn.complete(repairTurn)
        }
      }
      finishVoiceDiagnostic(utterance.id, shouldShowDecisionRetry(result) ? 'failed' : 'decided')
      updateDecisionEntry(utterance.id, { route: result.kind === 'IGNORE' ? 'ignored' : result.kind === 'INCOMPLETE' ? 'incomplete' : 'unavailable' })
      if (shouldShowDecisionRetry(result) && utterance.source === 'asr' && shownInput)
        pendingTranscript.value = t('stage.kiosk-agent.decision-failed')
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
      conversationMessages.value = [...conversationMessages.value, { role: 'assistant', content: t('stage.kiosk-agent.unstarted-combined'), slices: [], tool_results: [] }]
      interruptAssistantOutput()
      const turn = interactionTurn.begin('conversation', 'thinking')
      updateDecisionEntry(utterance.id, { route: 'main_agent' })
      if (utterance.source === 'simulation')
        asrSimulationStatus.value = 'System One：相關補充已中斷尚未操作工具的 AI 回合，正在重新處理。'
      void persistAssistantEscalation(input, recordedFastPathInput)
      void sendConversationMessage(result.requestText, turn, { waitSpeech: true, appendUserMessage: !shownInput, deadlineAt: input.deadlineAt, decisionEntryId: utterance.id, decisionState: conversationDecisionStateFrom(result.decisionState) })
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
    if (spokenReply && interactionTurn.advance(turn, 'speaking')) {
      void speakAssistantReply(spokenReply, turn, undefined, turn.signal).finally(() => {
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
  else if (shownInput)
    conversationMessages.value = [...conversationMessages.value, { role: 'assistant', content: t('stage.kiosk-agent.utterance-deferred'), slices: [], tool_results: [] }]
  void interactionRecording.append('service_event', JSON.stringify({ kind: 'utterance_deferred_exhausted', utteranceId: utterance.id, shownInput }), { source: 'utterance_processing_metrics', utteranceId: utterance.id })
  updateDecisionEntry(utterance.id, { route: 'deferred' })
  finishVoiceDiagnostic(utterance.id, 'failed')
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
    const activity = await recordCustomerActivity(input.source === 'asr' ? 'voice_input' : 'asr_simulation')
    if (!interactionTurn.isCurrent(turn))
      return
    if (input.recording) {
      mediaCapture.saveAudio(input.recording, activity?.id)
    }
    if (!recordedInput)
      await interactionRecording.append('asr_transcript', input.text, { decisionRoute: 'fast_path', source: input.source })
    if (!interactionTurn.isCurrent(turn))
      return
    // A greeting is a conversational receipt, never an ordering command or
    // acknowledgement of the pending operation question.
    const question = result.kind === 'FAST_ACTION' ? await validatedQuestionReceipt(result.result) : undefined
    if (!interactionTurn.isCurrent(turn))
      return
    let answer: string
    if (result.kind === 'CUSTOMER_ENTRY_REQUIRED')
      answer = t('stage.kiosk.customer-entry.complete-first')
    else if (result.kind === 'GREET')
      answer = t('stage.kiosk-agent.greeting-reply')
    else if (earlyReadMessages.length)
      answer = replyWithQuestion(earlyReadMessages.join('\n'), question)
    else
      answer = replyFromReceipt(result.result, question) ?? '已完成你剛剛指定的操作。'
    answer = replyWithQuestion(answer, question, result.decisionState?.phase)
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
          { role: 'assistant', content: answer, slices: [], tool_results: [] },
        ]
    await interactionRecording.append('assistant_text', answer, { decisionRoute: 'fast_path' })
    if (result.kind === 'FAST_ACTION')
      await acknowledgePresentedReply(answer, question?.questionId)
    if (!interactionTurn.isCurrent(turn))
      return
    playTransientMotion(result.kind === 'GREET' ? 'greeting' : 'acknowledge')
    return answer
  }

  if (result.kind === 'CLARIFICATION') {
    const activity = await recordCustomerActivity(input.source === 'asr' ? 'voice_input' : 'asr_simulation')
    if (!interactionTurn.isCurrent(turn))
      return
    if (input.recording)
      mediaCapture.saveAudio(input.recording, activity?.id)
    if (!recordedInput)
      await interactionRecording.append('asr_transcript', input.text, { decisionRoute: 'fast_path', source: input.source })
    // The browser keeps the answer buttons available after a repeated unclear
    // answer. Do not keep speaking the same question over the customer.
    if (result.silent)
      return undefined
    await interactionRecording.append('assistant_text', result.prompt, { decisionRoute: 'fast_path' })
    if (!interactionTurn.isCurrent(turn))
      return
    conversationMessages.value = [
      ...conversationMessages.value,
      ...(!shownInput ? [{ role: 'user' as const, content: input.text }] : []),
      { role: 'assistant', content: result.prompt, slices: [], tool_results: [] },
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
    // A prior read may already have saved this utterance. Record the question
    // correlation too; server projection deduplicates the same utterance ID.
    await interactionRecording.append('asr_transcript', input.text, { decisionRoute: 'fast_path', source: 'service_clarification', utteranceId: input.id, questionId: result.question.questionId })
    await interactionRecording.append('assistant_text', content, { source: 'service_clarification', questionId: result.question.questionId, utteranceId: input.id })
    if (!interactionTurn.isCurrent(turn))
      return
    conversationMessages.value = [...conversationMessages.value, ...(!shownInput ? [{ role: 'user' as const, content: input.text }] : []), { role: 'assistant', content, slices: [], tool_results: [] }]
    return content
  }

  const decisionState = conversationDecisionStateFrom(invitationWindow.decisionState(result.decisionState, Date.now()), result)

  if (result.kind === 'NEEDS_ASSISTANT') {
    if (earlyReadMessages.length)
      await interactionRecording.append('assistant_text', earlyReadMessages.join('\n'), { decisionRoute: 'fast_path' })
    // A semantic handoff, disabled Fast Path or provider fault starts the same
    // guarded Agent flow. A fallback is not proof of intent or tool authority.
    void persistAssistantEscalation(input, recordedInput)
    void sendConversationMessage(input.text, turn, { waitSpeech: result.reason !== 'PROVIDER_FAILURE' && result.reason !== 'SYSTEM_ONE_DISABLED', appendUserMessage: !shownInput, decisionEntryId: input.id, utteranceId: input.id, deadlineAt: input.deadlineAt, decisionState })
      .catch(error => console.error('Failed to forward kiosk request to Main Agent:', error))
  }

  // Semantic uncertainty stays blocked; provider failures were explicitly
  // converted to a guarded handoff before reaching this presentation step.
}

/** The runtime promotes only a known question that was actually displayed. */
async function acknowledgePresentedReply(content: string, questionId?: string, interruptsQuestion = false) {
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

async function persistAssistantEscalation(input: FastPathInput, alreadyRecorded = false) {
  try {
    const activity = await recordCustomerActivity(input.source === 'asr' ? 'voice_input' : 'asr_simulation')
    if (!input.recording)
      return
    mediaCapture.saveAudio(input.recording, activity?.id)
    if (!alreadyRecorded)
      await interactionRecording.append('asr_transcript', input.text, { utteranceId: input.id })
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

function interruptSpokenReply() {
  if (interactionTurn.phase.value !== 'speaking')
    return

  // Cancelling the active turn also aborts speech synthesis when the audio
  // has not started yet; the player's abort listener pauses active playback.
  interactionTurn.cancelActiveTurn()
  interruptAssistantOutput()
}

function clearConversationPresentation() {
  invitationWindow.reset()
  fastPathProgress.value = undefined
  utteranceQueue.reset()
  serviceClarificationWindow.reset()
  decisionProgress.cancel()
  incompleteAsrSession.discard()
  retireVoiceCaptureDiagnostic('capture_stopped')
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

async function speakAssistantReply(text: string, turn: ReturnType<typeof interactionTurn.begin>, preparedAudio?: Blob, signal = turn.signal) {
  if (signal.aborted || !interactionTurn.isCurrent(turn))
    return
  if (turn.kind === 'proactive' && !allowsObservedVoice())
    return
  const generation = ++speechGeneration
  const preparationStartedAt = performance.now()
  let playbackStartRecorded = false
  interruptAssistantOutput()
  processingSpeechActive.value = false
  // Keep customer-request feedback during synthesis. Proactive speech follows
  // its own invitation policy and must not create a customer receipt window.
  let preparationPending = turn.kind !== 'proactive'
  if (preparationPending)
    speechPreparationCount.value += 1
  try {
    const audio = preparedAudio ?? await synthesizeKioskSpeech({ locale: language.value, signal, text })
    if (signal.aborted || !interactionTurn.isCurrent(turn))
      return
    if (turn.kind === 'proactive' && !allowsObservedVoice())
      return

    const playback = playKioskAudio(audio, signal, audioContext.value, {
      onStopped: () => {
        if (generation === speechGeneration)
          processingSpeechActive.value = false
      },
      onPlaying: () => {
        if (signal.aborted || !interactionTurn.isCurrent(turn))
          return
        if (!playbackStartRecorded) {
          playbackStartRecorded = true
          void interactionRecording.append('service_event', JSON.stringify({ kind: 'tts_playback_start', turnId: turn.id, preparationMs: Math.round(performance.now() - preparationStartedAt), preparedAudio: Boolean(preparedAudio) }), { source: 'tts_playback_metrics' })
        }
        // Native playback ducks waiting music without replacing its player.
        // The cue owner stops it only when this spoken reply finishes.
        processingSpeechActive.value = true
        if (preparationPending) {
          speechPreparationCount.value -= 1
          preparationPending = false
        }
      },
    })
    assistantAudioNode.value = playback.source
    stopAssistantAudio = playback.stop
    const outcome = await playback.finished
    if (stopAssistantAudio === playback.stop)
      stopAssistantAudio = undefined
    if (assistantAudioNode.value === playback.source)
      assistantAudioNode.value = undefined
    if (outcome.kind === 'failed' && !signal.aborted) {
      console.warn('Kiosk speech playback failed:', outcome.code, outcome.message)
      void reportKioskAudioWarning({ generation: Math.max(1, audioGeneration), stage: 'playback', outcome: 'unavailable', code: outcome.code }).catch(() => console.warn('Kiosk audio diagnostic delivery failed.'))
    }
  }
  catch (error) {
    if (!signal.aborted)
      console.error('Failed to synthesize kiosk reply:', error)
  }
  finally {
    if (preparationPending)
      speechPreparationCount.value -= 1
    if (generation === speechGeneration)
      processingSpeechActive.value = false
  }
}

function stopAudioInteraction() {
  dispose()
  audioInputStarted.value = false
}

const microphoneStarting = shallowRef(false)
const microphoneSetupOpen = shallowRef(false)
// Device acquisition and downstream DSP/VAD readiness are separate stages.
// Keep Apply disabled while the current generation is still attaching its VAD.
const microphoneBusy = computed(() => microphoneStarting.value || microphoneSelection.busy.value
  || (arrayActive.value && !audioInputStarted.value && !inferenceError.value && arrayMicrophone.status.value !== 'error'))
const microphoneCaptureError = shallowRef('')
const microphoneCaptureStatus = computed(() => {
  if (!props.voiceConversationOnly)
    return 'voice-disabled'
  if (microphoneStarting.value)
    return 'starting'
  if (!enabled.value)
    return 'disabled'
  return rawMicrophoneStream.value ? 'captured' : `no-stream (${permissionState.value})`
})
let microphoneStartGeneration = 0
let microphoneStartup: AbortController | undefined
function stopMicrophone() {
  microphoneStartup?.abort()
  ++microphoneStartGeneration
  microphoneStarting.value = false
  microphoneSelection.stop()
}

async function startMicrophoneStream() {
  await microphoneSelection.start(microphoneStartup?.signal)
  if (!rawMicrophoneStream.value?.getAudioTracks().some(track => track.readyState === 'live'))
    throw new Error('The browser did not provide a live microphone stream.')
}
async function requestMicrophoneDevices() {
  if (microphoneStarting.value || !props.voiceConversationOnly)
    return
  microphoneStartup?.abort()
  const startup = new AbortController()
  microphoneStartup = startup
  const ticket = ++microphoneStartGeneration
  microphoneStarting.value = true
  microphoneCaptureError.value = ''
  try {
    // Permission discovery is operator-initiated and never enables VAD/ASR.
    await microphoneSelection.requestDevices(microphoneStartup?.signal)
  }
  catch (cause) {
    if (ticket === microphoneStartGeneration && !startup.signal.aborted)
      microphoneCaptureError.value = errorMessageFrom(cause) ?? 'Microphone device list unavailable.'
  }
  finally {
    if (ticket === microphoneStartGeneration)
      microphoneStarting.value = false
  }
}
async function startOperatorMicrophone() {
  if (microphoneStarting.value || !props.voiceConversationOnly)
    return
  microphoneStartup?.abort()
  microphoneStartup = new AbortController()
  const ticket = ++microphoneStartGeneration
  microphoneStarting.value = true
  microphoneCaptureError.value = ''
  // Retire the old capture before requesting the selected device. The existing
  // device store owns tracks and deduplicates any concurrent startup request.
  enabled.value = false
  try {
    await nextTick()
    if (ticket !== microphoneStartGeneration)
      return
    await startMicrophoneStream()
    // The shared device store can outlive this scene; a retired scene must not
    // stop a stream that a new owner may already be using.
    if (ticket !== microphoneStartGeneration)
      return
    if (!props.voiceConversationOnly) {
      settingsAudioDeviceStore.stopStream()
      return
    }
    enabled.value = true
  }
  catch (cause) {
    if (ticket === microphoneStartGeneration) {
      enabled.value = false
      settingsAudioDeviceStore.stopStream()
      microphoneCaptureError.value = errorMessageFrom(cause) ?? 'Microphone capture could not start.'
      void reportKioskAudioWarning({ generation: Math.max(1, audioGeneration), stage: 'capture', outcome: 'unavailable' }).catch(() => console.warn('Kiosk audio diagnostic delivery failed.'))
    }
  }
  finally {
    if (ticket === microphoneStartGeneration)
      microphoneStarting.value = false
  }
}
onUnmounted(() => {
  microphoneStartup?.abort()
  ++microphoneStartGeneration
})

// Voice-only mode is the explicit microphone consent mode. It asks before
// optional camera work begins, while text kiosks never request microphone use.
async function prepareMicrophone(signal: AbortSignal) {
  if (!props.voiceConversationOnly) {
    // A profile can change from voice-only to text mode while this browser
    // retains its previous local preference. Keep that stale preference from
    // starting the audio pipeline in the text-only experience.
    enabled.value = false
    microphoneSetupOpen.value = false
    initialMicrophonePermission.settle()
    return
  }

  microphoneChoice.value = microphoneSelection.savedMicrophone.value
  microphoneSetupOpen.value = !microphoneSelection.hasSelection.value
  const ticket = ++microphoneStartGeneration
  microphoneStarting.value = true
  microphoneCaptureError.value = ''
  try {
    const result = await prepareKioskMicrophonePermission({
      hasSelectedMicrophone: microphoneSelection.hasSelection.value,
      requestDevices: () => microphoneSelection.requestDevices(signal),
      startStream: startMicrophoneStream,
      signal,
      setAudioInputEnabled: nextEnabled => enabled.value = nextEnabled,
      voiceConversationOnly: props.voiceConversationOnly,
    })
    if (ticket === microphoneStartGeneration && !signal.aborted)
      microphoneSetupOpen.value = result === 'selection-required'
  }
  catch (error) {
    if (signal.aborted || ticket !== microphoneStartGeneration)
      return
    enabled.value = false
    microphoneSetupOpen.value = true
    microphoneCaptureError.value = errorMessageFrom(error) ?? 'Microphone capture could not start.'
    console.error('Kiosk microphone capture could not start:', error)
  }
  finally {
    if (ticket === microphoneStartGeneration)
      microphoneStarting.value = false
    // Optional camera work waits for the automatic consent/acquisition attempt,
    // even when first-run input selection still needs operator confirmation.
    initialMicrophonePermission.settle()
  }
}

watch(() => props.voiceConversationOnly, (_voiceOnly, _previous, onCleanup) => {
  const startup = new AbortController()
  microphoneStartup = startup
  // A scene/profile change or an explicit operator stop retires this startup;
  // late permission/capture completion must not enable the old voice session.
  onCleanup(() => startup.abort())
  void prepareMicrophone(startup.signal)
}, { immediate: true })

watch(audioInputStarted, (ready) => {
  if (ready)
    microphoneSetupOpen.value = false
})

watch(language, locale => setKioskLocale(locale), { immediate: true })

let audioLifecycle = Promise.resolve()
watch([stream, enabled, () => props.voiceConversationOnly, arrayMicrophone.pcmSource, voiceInputAllowed], ([audioStream, isEnabled, voiceOnly, pcm, acceptsVoice]) => {
  const ticket = ++audioGeneration
  retireVoiceCaptureDiagnostic('capture_stopped')
  lastVoiceBlock.value = undefined
  voiceAdmissionCounts = { startBlocked: 0, endBlocked: 0, noCandidate: 0, overloaded: 0, asrRequests: 0 }
  dispose()
  if (activeVoiceCandidate)
    interactionTurn.completeVoiceCandidate(activeVoiceCandidate)
  activeVoiceCandidate = undefined
  audioInputStarted.value = false
  // Serialize VAD teardown/setup. Stale initialization cannot attach an old stream.
  audioLifecycle = audioLifecycle.then(async () => {
    dispose()
    activeVoiceCandidate = undefined
    audioInputStarted.value = false
    if (ticket !== audioGeneration || !audioStream || !isEnabled || !voiceOnly || !acceptsVoice)
      return
    await init(pcm ? 'pcm' : 'stream')
    if (ticket !== audioGeneration) {
      dispose()
      return
    }
    if (!loaded.value)
      return
    if (pcm)
      pcm.start(processPcm)
    else
      await start(audioStream)
    if (ticket === audioGeneration)
      audioInputStarted.value = loaded.value
  }).catch((error) => {
    if (ticket === audioGeneration)
      inferenceError.value = errorMessageFrom(error) ?? 'Kiosk VAD could not start.'
    console.error('Failed to connect kiosk VAD:', error)
  })
}, { immediate: true })
onUnmounted(() => {
  ++audioGeneration
})

watch(proactiveSettings, () => {
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

watch(voiceInputAllowed, (allowed) => {
  if (allowed)
    return
  // Invalidate queued and transcribing speech without undoing an issued order.
  // The submitting Agent may still finish presenting its accepted receipt.
  utteranceQueue.reset()
  decisionProgress.cancel()
  incompleteAsrSession.discard()
  interactionTurn.cancelProactive()
}, { flush: 'sync' })

watch(customerSessionState, (state) => {
  if (state !== 'active') {
    releaseChatPendingWork?.()
    releaseChatPendingWork = undefined
  }
  if (state === 'standby') {
    recognizedTranscripts.value = []
    assistanceReminderWindow.reset()
  }
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
  const observedAtMs = performance.now()
  const decision = presenceWindow.decide(observedAtMs, candidate)
  // Presence and voice share the same measured frame and ROI classification.
  // Rechecking only the greeting zone here falsely rejected ENGAGED customers.
  voicePresence.observe(observedAtMs, decision.candidate)
  if (!allowsObservedVoice())
    interactionTurn.cancelProactive()
  lastPresenceCandidate.value = candidate
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

async function startProactiveGreeting(onStarted?: () => void) {
  if (!allowsObservedVoice() || customerSessionState.value !== 'standby' || !interactionTurn.canProactivelySpeak.value)
    return

  const stateTool = interactiveServiceClient.tools.value.find(tool => tool.name === 'kiosk_interaction_state')
  // Discovery/loading failures must leave the visitor unclaimed so a later
  // presence frame can try again once the service can report its actual phase.
  const stateResult = stateTool
    ? await interactiveServiceClient.execute(stateTool, {}).catch((error) => {
        console.warn('[stage-kiosk] skipped welcome because service state is unavailable:', error)
        return undefined
      })
    : undefined
  const state = conversationDecisionStateFrom(stateResult)
  if (!allowsObservedVoice() || !greetingPhase(state) || customerSessionState.value !== 'standby' || !interactionTurn.canProactivelySpeak.value || currentAgentRequest())
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
  // A real touch takes precedence over a welcome that is warming or playing.
  // Cancelling only the proactive turn preserves unrelated customer work.
  if (source === 'manual' || source === 'scenario' || source === 'completed')
    interactionTurn.cancelProactive()
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
  if (serviceFaultLocked.value || !voiceInputAllowed.value || !transcript || props.voiceConversationOnly)
    return
  // An explicit correction can replace pre-operation service recovery. Never
  // use ambient speech or this path to cancel an accepted browser mutation.
  if (decisionProgress.recovering.value !== undefined && !currentAgentRequest() && !agentOrderOwner.value) {
    utteranceQueue.reset()
    decisionProgress.cancel()
    serviceClarificationWindow.reset()
  }
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
  if (!allowsObservedVoice())
    return false
  const serviceId = scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction'
  // The effective device policy selects fixed openings or a vision request.
  // Fixed mode never captures a frame for welcome generation.
  const frame = props.proactiveVlmEnabled ? capturedFrame ?? captureProactiveCameraFrame(proactiveCamera.value) : undefined
  if (props.proactiveVlmEnabled && !frame) {
    console.warn('[stage-kiosk] skipped proactive assistant action because the camera frame is unavailable')
    return
  }
  const turn = existingTurn ?? interactionTurn.begin('proactive', 'thinking')
  if (!interactionTurn.isCurrent(turn))
    return
  conversationWorkStatus.value = kind === 'greeting' ? t('stage.kiosk.welcome.preparing') : '正在觀察現場…'
  let delivered = false
  try {
    const stateTool = interactiveServiceClient.tools.value.find(tool => tool.name === 'kiosk_interaction_state')
    const state = stateTool ? conversationDecisionStateFrom(await interactiveServiceClient.execute(stateTool, {})) : undefined
    const phase = greetingPhase(state)
    if (!interactionTurn.isCurrent(turn) || !phase || currentAgentRequest())
      return false
    if (kind === 'greeting' && !props.proactiveVlmEnabled) {
      const welcome = await fixedGreetings.next(phase)
      if (!interactionTurn.isCurrent(turn))
        return false
      // TTS may still be cold. Re-read browser state so late audio cannot
      // welcome over a new checkout page or an unresolved customer question.
      const latest = stateTool ? conversationDecisionStateFrom(await interactiveServiceClient.execute(stateTool, {})) : undefined
      if (!allowsObservedVoice() || !interactionTurn.isCurrent(turn) || greetingPhase(latest) !== phase || currentAgentRequest())
        return false
      await interactionRecording.append('assistant_text', welcome.text, { source: 'fixed_greeting' })
      if (!allowsObservedVoice() || !interactionTurn.isCurrent(turn))
        return false
      conversationMessages.value = [...conversationMessages.value, { role: 'assistant', content: welcome.text, slices: [], tool_results: [] }]
      playTransientMotion('greeting')
      interactionTurn.advance(turn, 'speaking')
      await speakAssistantReply(welcome.text, turn, welcome.audio, turn.signal)
      return !turn.signal.aborted
    }
    // Entry welcomes do not invite a meal choice before the phone decision.
    // Contextual reminders remain limited to the ordering screen.
    if (kind === 'reminder' && phase !== 'ordering')
      return false
    const response = await interactionRecording.runAssistantAction(serviceId, kind, frame, turn.signal, kind === 'reminder', phase)
    const answer = response?.answer
    if (!allowsObservedVoice() || !interactionTurn.isCurrent(turn))
      return
    if (kind === 'greeting') {
      const latest = stateTool ? conversationDecisionStateFrom(await interactiveServiceClient.execute(stateTool, {})) : undefined
      if (!allowsObservedVoice() || !interactionTurn.isCurrent(turn) || greetingPhase(latest) !== phase || currentAgentRequest())
        return false
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
      await speakAssistantReply(answer, turn, undefined, turn.signal)
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
  options: { deadlineAt?: number, appendUserMessage?: boolean, decisionEntryId?: number, decisionState?: KioskConversationDecisionState, utteranceId?: number, waitSpeech?: boolean } = {},
) {
  if (serviceFaultLocked.value)
    return
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
  if (!processingCue.ready.value && (options.waitSpeech ?? !existingTurn))
    waitSpeech.start(turn, t('stage.kiosk.wait.spoken'), language.value)
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
  let browserEffectAttempted = false
  let orderEffectAttempted = false
  let orderEffectAttempts = 0
  let unexecutedOrderAttempts = 0
  // Isolated to this Agent turn. Interrupted turns cannot publish another
  // turn's question; subsequent results replace an earlier operational offer.
  let questionReceipt: ReturnType<typeof questionReceiptFrom>
  let operationReply: string | undefined
  const menuReply = createMenuReplyWindow()
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
  let retryContextKey: string | undefined
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
    const reply = await interactionRecording.send(
      scenarioRegistry.activeScenario.value?.id ?? 'kiosk-interaction',
      text,
      activeTools.value,
      {
        taskId,
        utteranceId: options.utteranceId,
        budgetMs: options.deadlineAt ? Math.max(1, options.deadlineAt - Date.now()) : undefined,
        ...(decisionState ? { decisionState } : {}),
        prepareRound: async () => {
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
        onToolResult: (name, content) => {
          if (interactionTurn.isCurrent(turn)) {
            questionReceipt = questionReceiptFrom(content)
            menuReply.record(name, content)
            if (!isKioskConversationRetrySafeTool(name) || questionReceipt)
              operationReply = operationReplyFrom(content) ?? operationReply
            if (questionReceipt || operationReply)
              streamingAssistantMessage.value = undefined
          }
        },
        onToolRejected: (name, knownUnexecuted) => {
          if (interactionTurn.isCurrent(turn) && knownUnexecuted && requiresOrderReconciliation(name)) {
            unexecutedOrderAttempts++
            orderEffectAttempted = orderEffectAttempts > unexecutedOrderAttempts
          }
        },
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
          if (conversationProgress.value?.turnId !== turn.id)
            startConversationProgress(turn.id, t('stage.kiosk.wait.confirming'))
          if (!longWaitTimer)
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
          if (state === 'executing' && !isKioskConversationRetrySafeTool(toolName)) {
            browserEffectAttempted = true
            if (requiresOrderReconciliation(toolName)) {
              orderEffectAttempts++
              orderEffectAttempted = true
            }
            request.stage = 'mutating'
          }
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
        onAssistantDelta: () => {
          if (!interactionTurn.isCurrent(turn) || questionReceipt || operationReply)
            return
          updateAgentStep('Main Agent 回覆中')
          // Draft text may precede a tool call. Keep the progress visible until
          // the whole loop and receipt validation finish, not each SSE delta.
        },
        signal: turn.signal,
      },
    )
    finishExecutionDuration()
    waitSpeech.finish(turn.id)
    // Release after the tool loop settles, before question presentation or TTS.
    await releaseOrderControl()
    if (!interactionTurn.isCurrent(turn))
      return
    questionReceipt = await validatedQuestionReceipt({ pendingCustomerChoice: questionReceipt })
    if (!interactionTurn.isCurrent(turn))
      return
    if (!reply)
      return
    if (reply.reason === 'manual-control') {
      finishConversationProgress(turn.id)
      conversationWorkStatus.value = undefined
      conversationActivitySteps.value = []
      streamingAssistantMessage.value = undefined
      const message = [operationReply, t('stage.kiosk-agent.manual-control')].filter(Boolean).join(' ')
      conversationMessages.value = [...conversationMessages.value, { role: 'assistant', content: message, slices: [], tool_results: [] }]
      await interactionRecording.append('assistant_text', message, { source: 'verified_reply' })
      updateAgentStep(message)
      return
    }
    const entryPhase = await readCustomerEntryPhase(turn)
    if (!interactionTurn.isCurrent(turn))
      return
    const entryPrompt = t('stage.kiosk.customer-entry.complete-first')
    let replyContext: KioskConversationDecisionState['context']
    if (reply.requestedTools.every(name => name === 'kiosk_session_history') || menuReply.needsClarification()) {
      const contextTool = interactiveServiceClient.tools.value.find(tool => tool.name === 'kiosk_conversation_context')
      if (contextTool)
        replyContext = refreshConversationState(parse(conversationContextSchema, await interactiveServiceClient.execute(contextTool, { includeCatalog: true })), decisionState).context
      if (!interactionTurn.isCurrent(turn))
        return
    }
    const renderedReply = reply.reply && replyContext ? replyFromContext(JSON.stringify(reply.reply), replyContext) : undefined
    if (!questionReceipt && replyContext?.waitingFor && renderedReply && !['clarification', 'staff-assistance'].includes(renderedReply.kind)) {
      questionReceipt = await validatedQuestionReceipt({ pendingCustomerChoice: replyContext.waitingFor })
      replyContext = { ...replyContext, waitingFor: questionReceipt }
      if (!interactionTurn.isCurrent(turn))
        return
    }
    const presented = replyFromConversation(reply, {
      menu: menuReply,
      requireMenuRead: decisionState?.requireMenuRead,
      // A complete bare greeting is a service exchange even with System One off.
      serviceReply: decisionState?.serviceReply === true || /^(?:你好|您好|嗨|哈囉|哈啰|hello|hi)[！!。.?？\s]*$/i.test(text),
      handoff: decisionState?.handoff,
      sourceUtterance: text,
      context: replyContext,
      outcome: operationReply,
      question: questionReceipt,
      failureMessage: t(`stage.kiosk-agent.${reply.reason ?? 'no-reply'}`),
      customerEntry: { phase: entryPhase, prompt: entryPrompt },
    })
    if (entryPhase === 'customer_entry' && presented.content === entryPrompt)
      questionReceipt = undefined
    const answer = presented.role === 'assistant' ? replyWithQuestion(presented.content, questionReceipt, replyContext?.phase) : undefined
    const replyKind = presented.clarification ? 'clarification' : renderedReply?.kind ?? reply.reply?.kind
    if (!interactionTurn.isCurrent(turn))
      return
    await interactionRecording.append('service_event', JSON.stringify({ kind: 'main_presentation_metrics', taskId, status: presented.role === 'assistant' ? 'presented' : 'rejected', ...(replyKind ? { replyKind } : {}), ...(reply.reply?.kind === 'staff-assistance' ? { assistanceAction: reply.reply.action, notificationMode: 'simulated' } : {}), ...(presented.clarification ? { recovery: 'presentation-clarification' } : {}), ...(presented.role === 'error' ? { reason: reply.reason ?? 'unverified-reply' } : {}) }), { source: 'main_presentation_metrics' })
    if (!interactionTurn.isCurrent(turn))
      return
    finishConversationProgress(turn.id)
    conversationWorkStatus.value = undefined
    conversationMessages.value = [
      ...conversationMessages.value,
      answer
        ? { role: 'assistant', content: answer, slices: [], tool_results: [] }
        : orderEffectAttempted
          ? { role: 'error', content: presented.content }
          : { role: 'assistant', content: presented.content, slices: [], tool_results: [] },
    ]
    if (!answer && !browserEffectAttempted)
      retryableConversationRequest.value = retryContextKey && interactionRecording.visitorSessionId.value ? { state: 'available', text, sessionId: interactionRecording.visitorSessionId.value, iframeRevision: scenarioRegistry.iframeRevision.value, originalUtteranceId: options.utteranceId, requestId: turn.id, contextKey: retryContextKey } : undefined
    updateAgentStep(reply.status === 'completed' && answer ? 'Main Agent 已完成' : presented.content)
    streamingAssistantMessage.value = undefined
    request.resolveDone()
    if (activeAgentRequest === request)
      activeAgentRequest = undefined
    if (answer) {
      // A repaired clarification owns the next answer just like recovery's
      // service question. Bare assent must not fall through to an older purchase.
      if (reply.reply?.kind === 'staff-assistance' && reply.reply.action === 'confirm-order' && replyContext && entryPhase !== 'customer_entry') {
        serviceClarificationWindow.present({ purpose: 'order-assistance', questionId: crypto.randomUUID(), question: answer, sourceUtterance: text, contextKey: serviceContextKey(replyContext), expiresAt: Date.now() + 30_000 })
      }
      else if (renderedReply?.kind === 'staff-assistance' && renderedReply.action === 'offer' && replyContext && entryPhase !== 'customer_entry') {
        serviceClarificationWindow.present({ purpose: 'staff-assistance', questionId: crypto.randomUUID(), question: answer, sourceUtterance: text, unavailableConditions: replyContext.unavailableConditions, contextKey: serviceContextKey(replyContext), expiresAt: Date.now() + 30_000 })
      }
      else if (replyKind === 'clarification' && replyContext && entryPhase !== 'customer_entry') {
        serviceClarificationWindow.present({ questionId: crypto.randomUUID(), question: answer, sourceUtterance: text, unavailableConditions: replyContext.unavailableConditions, contextKey: serviceContextKey(replyContext), expiresAt: Date.now() + 30_000 })
      }
      interactionTurn.advance(turn, 'speaking')
      // The server keeps operation prose only as an internal draft. Record
      // the validated customer reply once, even if the draft used the same words.
      await interactionRecording.append('assistant_text', answer, { questionId: questionReceipt?.questionId, source: 'verified_reply' })
      // Information does not answer or revoke the browser's pending ordering
      // question. A selected clarification retains its real question ID above.
      await acknowledgePresentedReply(answer, questionReceipt?.questionId, !replyContext && !browserEffectAttempted && !questionReceipt)
      await speakAssistantReply(answer, turn, undefined, turn.signal)
    }
  }
  catch {
    if (interactionTurn.isCurrent(turn)) {
      const failureMessage = t(`stage.kiosk-agent.${orderEffectAttempted ? 'result-unknown' : 'reply-incomplete'}`)
      conversationMessages.value = [...conversationMessages.value, orderEffectAttempted
        ? { role: 'error', content: failureMessage }
        : { role: 'assistant', content: failureMessage, slices: [], tool_results: [] }]
      if (!browserEffectAttempted && retryContextKey && interactionRecording.visitorSessionId.value)
        retryableConversationRequest.value = { state: 'available', text, sessionId: interactionRecording.visitorSessionId.value, iframeRevision: scenarioRegistry.iframeRevision.value, originalUtteranceId: options.utteranceId, requestId: turn.id, contextKey: retryContextKey }
      updateAgentStep('Main Agent 未能完成')
    }
  }
  finally {
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
    waitSpeech.finish(turn.id)
    clearLongWait()
    finishConversationProgress(turn.id)
    if (interactionTurn.isCurrent(turn))
      streamingAssistantMessage.value = undefined
    if (interactionTurn.isCurrent(turn)) {
      interactionTurn.complete(turn)
      conversationWorkStatus.value = undefined
      conversationActivitySteps.value = []
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
  const stateTool = interactiveServiceClient.tools.value.find(tool => tool.name === 'kiosk_interaction_state')
  if (!stateTool)
    return
  try {
    const resumed = await resumeConversationRetry(retry, {
      current: async () => {
        const current = conversationDecisionStateFrom(await interactiveServiceClient.execute(stateTool, {}))
        if (!current)
          throw new Error('Current retry context is unavailable.')
        return { sessionId: interactionRecording.visitorSessionId.value ?? '', iframeRevision: scenarioRegistry.iframeRevision.value, contextKey: serviceContextKey(current) }
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

async function recoverOrderingService() {
  if (serviceRecovering.value || currentAgentRequest())
    return
  serviceRecovering.value = true
  serviceRecoveryBlocked.value = true
  try {
    await interactiveServiceClient.recover()
    const contextTool = interactiveServiceClient.tools.value.find(tool => tool.name === 'kiosk_conversation_context')
    const taskTool = interactiveServiceClient.tools.value.find(tool => tool.name === 'kiosk_agent_task')
    if (!contextTool || !taskTool)
      throw new Error('Menu recovery tools are unavailable.')
    const context = parse(conversationContextSchema, await interactiveServiceClient.execute(contextTool, { includeCatalog: false }))
    if (context.taskId && context.taskId !== agentOrderOwner.value && context.taskId !== pendingAgentOrderOwner.value)
      throw new Error('The prior task belongs to another owner; keep ordering paused.')
    if (context.taskId) {
      const released = await interactiveServiceClient.execute(taskTool, { action: 'END', taskId: context.taskId })
      if (!released || typeof released !== 'object' || !('ok' in released) || released.ok !== true)
        throw new Error('The settled task could not release order control.')
    }
    agentOrderOwner.value = undefined
    pendingAgentOrderOwner.value = undefined
    manualControlPending.value = false
    retryableConversationRequest.value = undefined
    serviceRecoveryBlocked.value = false
    pendingTranscript.value = t('stage.kiosk-agent.service-recovered')
    conversationWorkStatus.value = undefined
  }
  catch (error) {
    conversationWorkStatus.value = t('stage.kiosk-agent.service-unavailable')
    console.warn('[stage-kiosk] ordering recovery remains paused:', error)
  }
  finally { serviceRecovering.value = false }
}

function describeToolActivity(toolName: string, state: 'executing' | 'done' | 'error' | 'selected') {
  return describeWebnaviorKioskToolActivity(toolActivityManifest.value, toolName, state)
}

async function handleScenarioCompleted(message?: InteractionLifecycleMessage) {
  if (completionPending.value || customerSessionState.value === 'completing')
    return
  // Close admission synchronously, before persistence or session creation awaits.
  completionPending.value = true
  let completed = false
  try {
    // A direct iframe click may emit `activity` and `completed` back-to-back.
    // Establish the anonymous session here as well so completion cannot outrun
    // the asynchronous activity handler and disappear without a customer screen.
    await recordCustomerActivity('completed')
    mediaCapture.stopContinuousCapture()
    completedOrderReceiptUrl.value = message?.orderContinuationUrl
    completedOrderResult.value = message?.orderResult
    completed = customerSession.completeOrder()
    await interactionRecording.append('service_event', 'completed')
    if (message?.orderResult)
      await interactionRecording.recordOrderResult(message.orderResult)
    if (completed) {
      await interactionRecording.append('service_event', 'order_completion_shown')
      if (canShowFeedbackInvitation(feedbackInvitationSettings.value))
        await interactionRecording.append('service_event', 'feedback_invitation_shown')
    }
  }
  finally {
    // Persistence failure must not reopen voice after an accepted completion.
    if (completed)
      completionPending.value = false
  }
}

async function finishCustomerSessionCompletion() {
  await interactionRecording.append('service_event', 'feedback_invitation_dismissed')
  mediaCapture.stopContinuousCapture()
  await customerSession.end('completed')
  completedOrderResult.value = undefined
  completedOrderReceiptUrl.value = undefined
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
    recognizedTranscripts.value = []
    conversationMessages.value = []
    streamingAssistantMessage.value = undefined
    retryableConversationRequest.value = undefined
  }
  catch (error) {
    customerResetError.value = '無法重新開始，請確認連線後再試。'
    console.error('[stage-kiosk] failed to restart the customer session:', error)
  }
}

function pauseForServiceFault() {
  // Stop new admission first. Aborting cannot undo issued POS operations;
  // their normal cleanup/reconciliation must settle before PIN recovery.
  utteranceQueue.reset()
  decisionProgress.cancel()
  waitSpeech.finish()
  interactionTurn.cancel()
  interruptAssistantOutput()
  retryableConversationRequest.value = undefined
  // This deployment intentionally simulates staff notification; no external message is sent.
  void interactionRecording.append('service_event', JSON.stringify({ kind: 'staff_notification', delivery: 'simulated' }), { source: 'service_fault' }).catch(error => console.warn('Could not record simulated staff notification:', errorMessageFrom(error)))
  const turn = interactionTurn.begin('conversation', 'speaking')
  void speakAssistantReply(t('stage.kiosk.service-fault.spoken'), turn).finally(() => interactionTurn.complete(turn))
}
watch(serviceFaultLocked, (locked) => {
  if (locked)
    pauseForServiceFault()
}, { flush: 'sync' })

async function unlockServiceFault() {
  if (faultRecoveryBusy.value)
    return
  faultRecoveryBusy.value = true
  customerResetError.value = undefined
  try {
    await activeAgentRequest?.done
    await utteranceQueue.idle()
    await recoverOrderingService()
    if (!serviceRecoveryBlocked.value)
      serviceFault.clear()
    else
      customerResetError.value = t('stage.kiosk-agent.service-unavailable')
  }
  finally { faultRecoveryBusy.value = false }
}

async function restartAfterServiceFault() {
  if (faultRecoveryBusy.value)
    return
  faultRecoveryBusy.value = true
  customerResetError.value = undefined
  try {
    await activeAgentRequest?.done
    await utteranceQueue.idle()
    await customerSession.end('staff')
    serviceFault.clear()
  }
  catch {
    customerResetError.value = '無法重新開始，請確認連線後再試。'
  }
  finally { faultRecoveryBusy.value = false }
}

async function startOrRestartCustomerSession() {
  if (customerSessionState.value === 'standby') {
    await resetForNewCustomer()
    completionPending.value = false
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

// Defer the shared playback context until real operator input. Creating it at
// scene setup caused an autoplay warning even when native playback was selected.
function activatePlaybackAudio(event: Event) {
  if (!event.isTrusted)
    return
  audioContext.value ??= useAudioContext().audioContext
  void audioContext.value.resume().catch(() => console.warn('Kiosk playback audio activation failed.'))
}
let stopMenuActivityListener: (() => void) | undefined
let stopMenuCompletionListener: (() => void) | undefined

onMounted(() => {
  window.addEventListener('pointerdown', activatePlaybackAudio, true)
  window.addEventListener('keydown', activatePlaybackAudio, true)
  stopMenuActivityListener = scenarioRegistry.on('activity', () => void recordCustomerActivity('scenario'))
  stopMenuCompletionListener = scenarioRegistry.on('completed', message => void handleScenarioCompleted(message))
  if (serviceFaultLocked.value)
    pauseForServiceFault()
  void initialMicrophonePermission.wait().then(syncProactiveVision)
})

onUnmounted(() => {
  window.removeEventListener('pointerdown', activatePlaybackAudio, true)
  window.removeEventListener('keydown', activatePlaybackAudio, true)
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
      v-if="showDevelopmentDiagnostics"
      v-bind="audioInputIndicator"
      :interruptible="assistantOutputInterruptible"
      :position="audioStatusPosition"
      @interrupt="interruptSpokenReply"
      @move="audioStatusPosition = $event"
    />
    <KioskMicrophoneSetup
      v-if="props.voiceConversationOnly && microphoneSetupOpen && !adminPanelOpen && !serviceFaultLocked"
      v-model="microphoneChoice"
      :devices="microphoneSelection.devices.value"
      :busy="microphoneBusy"
      :error="microphoneCaptureError || (inferenceError ? orderingMessages['zh-Hant'].arrayAudio.microphoneVadFailed : '')"
      @apply="startOperatorMicrophone"
      @permission="requestMicrophoneDevices"
      @stop="stopMicrophone"
    />
    <KioskAdminAccess v-if="!serviceFaultLocked" class="kiosk-admin-access">
      <span class="i-solar:settings-outline h-4 w-4" aria-hidden="true" />
      <span>設定</span>
    </KioskAdminAccess>

    <aside v-if="adminPanelOpen && !serviceFaultLocked" class="kiosk-admin-panel-layer">
      <KioskAdminPanel
        v-model:camera-preview-enabled="cameraPreviewEnabled"
        v-model:conversation-font-size="conversationFontSize"
        v-model:decision-diagnostics-enabled="decisionDiagnosticsEnabled"
        v-model:idle-diagnostics-enabled="idleDiagnosticsEnabled"
        v-model:presence-diagnostics-enabled="presenceDiagnosticsEnabled"
        v-model:paused="paused"
        :device="props.device"
        :session-ending="customerSessionState === 'resetting'"
        :text-only-mode="!props.voiceConversationOnly"
        @close="closeAdminPanel"
        @end-session="restartCustomerSession"
        @reload="reloadKiosk"
      >
        <template #device-settings>
          <ArrayMicrophoneSettings
            v-model:dynamic-processing="arrayMicrophone.dynamicProcessing.value"
            v-model:microphone="microphoneChoice"
            v-model:mapping="arrayMicrophone.mapping.value"
            v-model:radius="arrayMicrophone.radius.value"
            :devices="microphoneSelection.devices.value"
            :input-gain-db="recognitionInputGainDb"
            :input-diagnostics="inputDiagnostics"
            :spatial-statistics="spatialStatistics"
            :admission-counts="admissionCounts"
            :presence-admission="presenceAdmission"
            :last-voice-block="lastVoiceBlock"
            :camera-status="proactiveVision.status.value"
            :clipped-samples="inputClippedSamples"
            :capture-status="microphoneCaptureStatus"
            :capture-error="microphoneCaptureError || microphoneSelection.message.value"
            :captured-device="microphoneSelection.activeMicrophone.value ? rawMicrophoneStream?.getAudioTracks()[0]?.label ?? '' : ''"
            :starting="microphoneBusy"
            :voice-only="props.voiceConversationOnly"
            :has-stream="Boolean(rawMicrophoneStream?.getAudioTracks().some(track => track.readyState === 'live'))"
            :enabled="enabled"
            :mode="arrayMicrophone.mode.value"
            :channel-count="arrayMicrophone.channelCount.value"
            :status="arrayMicrophone.status.value"
            :error="arrayMicrophone.error.value"
            :vad-status="inferenceError ? 'error' : audioInputStarted ? 'ready' : loaded ? 'starting' : 'not-ready'"
            :vad-error="inferenceError ?? ''"
            :presence-status="presenceDecision?.state ?? proactiveVision.status.value"
            @permission="requestMicrophoneDevices"
            @start="startOperatorMicrophone"
            @stop="stopMicrophone"
          />
          <DeviceSettingsPanel :endpoint="deviceSettingsEndpoint" mode="local" @updated="emit('deviceSettingsUpdated', $event)">
            <template #reauthorize>
              <KioskAdminAccess single-tap>
                {{ t('deviceSettings.verifyPin') }}
              </KioskAdminAccess>
            </template>
          </DeviceSettingsPanel>
        </template>
      </KioskAdminPanel>
    </aside>

    <section :inert="serviceFaultLocked" :class="['service-hero', `is-${orientation}`]" :style="stageBackgroundStyle">
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
      <KioskAssistantThoughtBubble :progress="visibleProgress" />
      <KioskConversation
        :service-recovery-blocked="serviceRecoveryBlocked"
        :service-recovering="serviceRecovering"
        class="conversation-region"
        :activity-status="conversationActivityStatus"
        :activity-steps="conversationActivitySteps"
        :execution-duration-ms="decisionStatus?.elapsedMs ?? (conversationDiagnosticsEnabled ? conversationExecutionDurationMs : undefined)"
        :fast-path-simulation-status="asrSimulationStatus"
        :fast-path-simulation-trace="asrSimulationTrace"
        :fast-path-simulation-timing="asrSimulationTiming"
        :assistant-presence="assistantPresence"
        :messages="conversationMessages"
        :streaming-assistant-message="streamingAssistantMessage"
        :pending-transcript="pendingTranscript"
        :recognized-transcripts="recognizedTranscripts"
        :retry-available="!serviceRecoveryBlocked && interactiveServiceClient.availability.value === 'ready' && (Boolean(retryableConversationRequest) || decisionStatus?.retryable === true)"
        :sending="conversationSending"
        :font-size="conversationFontSize"
        :voice-conversation-only="props.voiceConversationOnly"
        @retry-message="retryConversationMessage"
        @recover-service="recoverOrderingService"
        @simulate-asr="simulateAsrTranscript"
      />
    </section>

    <ScenarioSurface :inert="serviceFaultLocked" :listening="isAudioListening && !serviceFaultLocked" class="menu-region" @activity="recordCustomerActivity('manual')" />
    <KioskAgentControl
      v-if="agentOrderOwner && !serviceFaultLocked"
      :releasing="manualControlPending"
      @manual="requestManualOrderControl"
    />

    <button
      v-if="!serviceFaultLocked && (customerSessionState === 'active' || customerSessionState === 'standby')"
      type="button"
      class="customer-restart"
      :disabled="conversationSending"
      @click="startOrRestartCustomerSession"
    >
      <span class="i-solar:restart-bold h-4 w-4" aria-hidden="true" />
      {{ customerSessionButtonLabel }}
    </button>

    <KioskIdleDiagnostics
      v-if="idleDiagnosticsEnabled"
      :idle-deadline-at="idleDeadlineAt"
      :pending-work="hasPendingWork"
      :presence-idle-protection="presenceIdleProtection"
      :state="customerSessionState"
    />
    <KioskPresenceDiagnostics
      v-if="presenceDiagnosticsEnabled"
      :decision="presenceDecision"
      :camera-status="proactiveVision.status.value"
      :camera-error="proactiveVision.error.value"
      :session-state="customerSessionState"
      :diagnostics="presenceDiagnostics"
      :vision-mode="props.deviceSettings?.presenceVisionMode ?? defaultDeviceSettingsValues.presenceVisionMode"
    />
    <KioskVoiceDiagnostics
      v-if="voiceDiagnosticsEnabled"
      :entries="voiceDiagnosticEntries"
    />
    <KioskDecisionInspector
      v-if="decisionDiagnosticsEnabled"
      :entries="decisionEntries"
      :pending-count="utteranceQueueState.pending.length"
    />
    <KioskServiceFault
      v-if="serviceFaultLocked"
      :busy="faultRecoveryBusy"
      :error="customerResetError"
      @restart="restartAfterServiceFault"
      @unlock="unlockServiceFault"
    />
    <KioskSessionNotice v-else :message="sessionNotice" />
    <CustomerSessionIdleConfirmation
      v-if="!serviceFaultLocked && customerSessionState === 'awaiting-idle-confirmation'"
      :deadline-at="idleDeadlineAt"
      @continue="continueCurrentSession"
      @new-customer="startNewCustomerSession"
    />
    <CustomerSessionCompletion
      v-if="!serviceFaultLocked && customerSessionState === 'completing'"
      :settings="feedbackInvitationSettings"
      :order-result="completedOrderResult"
      :order-continuation-url="completedOrderReceiptUrl"
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
