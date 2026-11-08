import type { DeviceSettingsSnapshot, KioskVoiceVadSettings, PresenceState } from '@proj-airi/kiosk-proactive'
import type { AudioWarning, KioskAudioChunk } from '@proj-airi/stage-shared/kiosk-audio'
import type { ContextReply, ServiceRecoveryProgress } from '@proj-airi/stage-shared/kiosk-conversation'
import type { OrderingContext } from '@proj-airi/stage-shared/kiosk-service-mode'
import type { OrderingSite } from '@proj-airi/stage-shared/ordering-sites'

import type { KioskReplyFailureReason } from '../../../server/src/services/domain/kiosk-agent-interaction'
import type { DecisionStageResult, KioskConversationDecisionState, KioskDecisionState, PresentedQuestion } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'
import type { GreetingPhase, InteractionMetadata } from '../../../server/src/services/domain/kiosk/interactionContracts'

import { normalizeOrderingPrices, serviceRecoveryLimits } from '@proj-airi/stage-shared/kiosk-conversation'
import { toOrderingTraditionalChinese } from '@proj-airi/stage-ui/libs/taiwan-traditional-chinese'

import { decisionQuestionBudget } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'

export type { KioskConversationDecisionState } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'

/** A registered kiosk browser installation returned by the Server bootstrap endpoint. */
export interface KioskDevice {
  id: string
  label: string
  registrationMethod: 'development' | 'qr_code'
  siteId: string
}

/** Immutable Profile configuration that the server assigned to this device. */
export interface KioskProfile {
  name: string
  releaseId: string
  snapshot: {
    assistanceReminderPrompt: string
    agentInstructions: string
    characterName: string
    characterAsset?: {
      format: 'live2d_zip' | 'vrm'
      id: string
      name: string
      sha256: string
    }
    sceneBackground?: {
      format: 'jpeg' | 'png' | 'webp'
      id: string
      name: string
      sha256: string
    }
    idleMotion?: {
      format: 'vrma'
      id: string
      name: string
      sha256: string
    }
    motionPack?: Partial<Record<'acknowledge' | 'greeting' | 'idle' | 'listening' | 'presentRecommendations' | 'thinking', {
      format: 'vrma'
      id: string
      name: string
      sha256: string
    }>>
    characterCard?: {
      description: string
      personality: string
      postHistoryInstructions: string
      scenario: string
      systemPrompt: string
    }
    greetingPrompt: string
    greetingPhrases?: readonly string[]
    orderingSites?: readonly OrderingSite[]
    interactiveService: { description: string, id: string, title: string, url: string }
    surveyUrl: string
    version: 1
    voiceConversationOnly: boolean
  }
}

/** Server-owned interaction session created for the currently authenticated kiosk. */
export interface KioskVisitorSession {
  id: string
  state: 'active' | 'completed' | 'cancelled' | 'idle'
}

export type KioskMediaCaptureMode = 'off' | 'snapshot' | 'triggered' | 'continuous'
export type KioskPerformanceProfile = 'constrained' | 'balanced' | 'high'

export type KioskInteractionEntryKind = 'user_text' | 'assistant_text' | 'asr_transcript' | 'tool_call' | 'tool_result' | 'service_event' | 'order_result'
export type KioskVisitorMediaKind = 'audio_recording' | 'triggered_image' | 'triggered_video' | 'continuous_video'

export interface KioskToolDefinition {
  function: { description?: string, name: string, parameters: unknown }
  type: 'function'
}

export interface KioskToolCall {
  function: { arguments: string, name: string }
  id: string
  type: 'function'
}

/** The Server's non-destructive guidance state for the active ordering interaction. */
export type KioskAgentInteractionMode = 'active' | 'decision_guidance' | 'touch_preferred'

/** Customer-safe progress emitted by the Server-owned Kiosk reply stream. */
export type KioskConversationStreamEvent
  = | { type: 'turn-started' }
    | { text: string, type: 'assistant-delta' }
    | { toolCall: KioskToolCall, type: 'tool-requested' }
    | { agentMode: KioskAgentInteractionMode, answer?: string, reply?: ContextReply, toolCalls: KioskToolCall[], type: 'turn-finished' }
    | { message: string, reason: KioskReplyFailureReason, type: 'turn-failed' }

const apiBaseUrl = (import.meta.env.VITE_API_SERVER_URL ?? 'http://localhost:5168').replace(/\/$/, '')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok)
    throw new KioskDeviceRequestError(response.status, await response.text())

  return await response.json() as T
}

async function requestAudio(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: 'include',
  })
  if (!response.ok)
    throw new KioskDeviceRequestError(response.status, await response.text())
  return response
}

/** Advances the authenticated POS round before the host clears or reloads its Menu. */
export async function resetKioskOrderingContext() {
  const { context } = await request<{ context: OrderingContext }>('/api/kiosk/pos/v1/ordering-context', { cache: 'no-store', signal: AbortSignal.timeout(5_000) })
  return await request<{ context: OrderingContext }>('/api/kiosk/pos/v1/ordering-context', { method: 'POST', body: JSON.stringify({ previousId: context.id }), signal: AbortSignal.timeout(5_000) })
}

/** Retrieves the device authenticated by the browser's HttpOnly kiosk cookie. */
export async function fetchKioskBootstrap() {
  return await request<{ device: KioskDevice, deviceSettings: DeviceSettingsSnapshot, mediaCapturePolicy: { mode: KioskMediaCaptureMode }, performanceProfile: KioskPerformanceProfile, proactiveVlmEnabled: boolean, profile?: KioskProfile, voiceVadSettings: KioskVoiceVadSettings }>('/api/kiosk/bootstrap')
}

/** Best-effort device diagnostics, independent of visitor sessions and model dialogue. */
export function reportKioskAudioWarning(warning: AudioWarning) {
  return request<{ accepted: true }>('/api/kiosk/audio/warnings', {
    method: 'POST',
    body: JSON.stringify(warning),
    signal: AbortSignal.timeout(5000),
  })
}

/** Reads the current policy only for the device identified by its HttpOnly cookie. */
export function fetchDeviceSettings(signal?: AbortSignal) {
  return request<DeviceSettingsSnapshot>('/api/kiosk/settings', { signal })
}

/** Exchanges the operator PIN for an HttpOnly grant scoped to this enrolled device. */
export function unlockKioskAdmin(pin: string, signal?: AbortSignal) {
  return request<{ expiresAt: number }>('/api/kiosk/admin/session', { method: 'POST', body: JSON.stringify({ pin }), signal })
}

/** Revokes this browser's local settings grant when the operator closes the panel. */
export function lockKioskAdmin() {
  return request<{ locked: boolean }>('/api/kiosk/admin/session', { method: 'DELETE' })
}

/** Enrolls this browser as a development kiosk when the Server explicitly permits it. */
export async function registerDevelopmentKiosk(registrationCode: string) {
  return await request<{ device: KioskDevice }>('/api/kiosk/development/register', {
    method: 'POST',
    body: JSON.stringify({ registrationCode }),
  })
}

/** Starts one durable visitor interaction using this device's assigned Profile. */
export async function startKioskVisitorSession(serviceId: string) {
  return await request<{ session: KioskVisitorSession }>('/api/kiosk/visitor-sessions', {
    method: 'POST',
    body: JSON.stringify({ serviceId }),
  })
}

/** Adds an ordered transcript turn or interaction lifecycle record to a visitor session. */
export async function appendKioskInteraction(input: {
  content: string
  kind: KioskInteractionEntryKind
  metadata?: InteractionMetadata
  visitorSessionId: string
}) {
  return await request<{ entry: { id: string } }>(`/api/kiosk/visitor-sessions/${input.visitorSessionId}/entries`, {
    method: 'POST',
    body: JSON.stringify({ content: input.content, kind: input.kind, metadata: input.metadata ?? {} }),
  })
}

/** Reads a bounded page of text from the authenticated visitor's own session. */
export async function fetchKioskSessionHistory(input: { before?: number, visitorSessionId: string }) {
  const cursor = input.before === undefined ? '' : `?before=${input.before}`
  return await request<{ entries: Array<{ content: string, index: number, role: 'assistant' | 'user' }>, nextBefore?: number, total: number }>(`/api/kiosk/visitor-sessions/${input.visitorSessionId}/history${cursor}`)
}

/** Records the terminal reason for a visitor interaction. */
export async function endKioskVisitorSession(input: {
  state: 'completed' | 'cancelled' | 'idle'
  visitorSessionId: string
}) {
  return await request<{ session: KioskVisitorSession }>(`/api/kiosk/visitor-sessions/${input.visitorSessionId}/end`, {
    method: 'POST',
    body: JSON.stringify({ state: input.state }),
  })
}

/**
 * Reads one Server-owned LLM reply as SSE while preserving the device cookie
 * and keeping provider credentials outside the browser.
 */
export async function streamKioskConversationMessage(
  input: {
    content?: string
    utteranceId?: number
    decisionState?: KioskConversationDecisionState
    signal?: AbortSignal
    toolResults?: Array<{ content: string, name: string, toolCallId: string }>
    tools: KioskToolDefinition[]
    visitorSessionId: string
  },
  onEvent: (event: KioskConversationStreamEvent) => void,
) {
  const response = await fetch(`${apiBaseUrl}/api/kiosk/visitor-sessions/${input.visitorSessionId}/messages`, {
    method: 'POST',
    credentials: 'include',
    signal: input.signal,
    headers: {
      'Accept': 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: input.content, utteranceId: input.utteranceId, decisionState: input.decisionState, toolResults: input.toolResults ?? [], tools: input.tools }),
  })
  if (!response.ok || !response.body)
    throw new KioskDeviceRequestError(response.status, await response.text())

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished: Extract<KioskConversationStreamEvent, { type: 'turn-finished' }> | undefined

  const consumeEvent = (rawEvent: string) => {
    const data = rawEvent.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
    if (!data)
      return
    const event = JSON.parse(data) as KioskConversationStreamEvent
    onEvent(event)
    if (event.type === 'turn-finished')
      finished = event
    if (event.type === 'turn-failed')
      throw new Error(event.message)
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    let eventBoundary = /\r?\n\r?\n/.exec(buffer)
    while (eventBoundary?.index !== undefined) {
      consumeEvent(buffer.slice(0, eventBoundary.index))
      buffer = buffer.slice(eventBoundary.index + eventBoundary[0].length)
      eventBoundary = /\r?\n\r?\n/.exec(buffer)
    }
    if (done)
      break
  }
  if (buffer.trim())
    consumeEvent(buffer)
  if (!finished)
    throw new Error('Kiosk reply stream ended before completion.')
  return finished
}

/** Asks the Server Gateway to create one Profile-controlled proactive assistant turn. */
export async function sendKioskAssistantAction(input: {
  frame?: string
  invitationAllowed?: boolean
  kind: 'greeting' | 'reminder'
  phase?: GreetingPhase
  signal?: AbortSignal
  visitorSessionId: string
}) {
  return await request<{ answer: string, pendingCustomerChoice?: PresentedQuestion }>(`/api/kiosk/visitor-sessions/${input.visitorSessionId}/assistant-actions`, {
    method: 'POST',
    body: JSON.stringify({ frame: input.frame, kind: input.kind, phase: input.phase, invitationAllowed: input.invitationAllowed ?? false }),
    signal: input.signal,
  })
}

/** Stores the limited, non-personal result emitted by the current approved ordering service. */
export async function recordKioskOrderResult(input: {
  environment: 'test' | 'live'
  fulfillmentMode: 'dine-in' | 'takeout'
  id: string
  itemCount: number
  posOrderId?: string
  status: 'accepted'
  total: number
  visitorSessionId: string
}) {
  return await request(`/api/kiosk/visitor-sessions/${input.visitorSessionId}/order-results`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** Builds the multipart request body for the device-authenticated ASR gateway. */
export function createKioskTranscriptionBody(recording: Blob, chunk?: KioskAudioChunk) {
  const body = new FormData()
  // useAudioRecorder serializes microphone samples as WAV/PCM. The filename
  // is part of the ASR protocol: providers may choose a decoder from it.
  body.set('file', recording, 'recording.wav')
  if (chunk) {
    body.set('utteranceId', chunk.utteranceId)
    body.set('chunkIndex', String(chunk.index))
    body.set('sampleStart', String(chunk.sampleStart))
    body.set('sampleEnd', String(chunk.sampleEnd))
    body.set('finalChunk', String(chunk.final))
  }
  return body
}

/** Sends microphone bytes to the device-authenticated ASR gateway. */
export async function transcribeKioskAudio(recording: Blob, signal?: AbortSignal, chunk?: KioskAudioChunk) {
  const body = createKioskTranscriptionBody(recording, chunk)
  const response = await requestAudio('/api/kiosk/audio/transcriptions', { body, method: 'POST', signal })
  return await response.json() as { text: string }
}

/** Reads live activation without loading credentials, policy or the model. */
export async function isKioskFastPathEnabled() {
  const status = await request<{ enabled: boolean }>('/api/kiosk/interaction-decisions/status', { cache: 'no-store', signal: AbortSignal.timeout(5_000) })
  return status.enabled
}

/** Sends bounded choices; only provider failures, not semantic refusals, allow fallback. */
export async function decideKioskInteraction(input: {
  onProgress?: (stage: Extract<DecisionStageResult, { kind: 'DECISION_PROGRESS' }> | ServiceRecoveryProgress) => void
  maxQuestions?: number
  budgetMs?: number
  recoveryUsed?: boolean
  utteranceId?: number
  isCurrent?: () => boolean
  signal?: AbortSignal
  visitorSessionId?: string
  review?: { answer: string, observation: string }
  candidates: Array<{ description: string, id: string, requiresHighConfidence?: boolean }>
  decisionState?: KioskDecisionState
  includeTrace?: boolean
  presenceState?: PresenceState
  transcript: string
}) {
  let result = await request<DecisionStageResult>('/api/kiosk/interaction-decisions', {
    method: 'POST',
    signal: input.signal,
    body: JSON.stringify({ ...input, signal: undefined, onProgress: undefined, isCurrent: undefined, segmented: true }),
  })
  const consumed = new Set<string>()
  let jevQuestions = 0
  while (result.kind === 'DECISION_PROGRESS' || result.kind === 'SERVICE_RECOVERY_PROGRESS') {
    if (input.isCurrent?.() === false)
      throw new Error('Decision replaced before continuation')
    if (result.kind === 'DECISION_PROGRESS' && ++jevQuestions > decisionQuestionBudget)
      throw new Error('Jev question budget exhausted')
    if (consumed.size >= decisionQuestionBudget + serviceRecoveryLimits.progressEvents || consumed.has(result.continuationId) || result.expiresAt <= Date.now())
      throw new Error('Decision continuation expired or exceeded its budget')
    consumed.add(result.continuationId)
    input.onProgress?.(result)
    result = await request<DecisionStageResult>(`/api/kiosk/interaction-decisions/${encodeURIComponent(result.continuationId)}`, {
      method: 'POST',
      signal: input.signal,
      body: JSON.stringify({ visitorSessionId: input.visitorSessionId }),
    })
  }
  return result
}

/** Uploads private POC evidence for the active visitor session. */
export async function uploadKioskVisitorMedia(input: {
  endedAt?: Date
  interactionEntryId?: string
  kind: KioskVisitorMediaKind
  recording: Blob
  startedAt?: Date
  visitorSessionId: string
}) {
  const body = new FormData()
  const filename = input.kind === 'audio_recording'
    ? 'microphone.wav'
    : input.kind === 'triggered_image'
      ? 'camera.jpg'
      : 'camera.webm'
  body.set('file', input.recording, filename)
  body.set('kind', input.kind)
  if (input.interactionEntryId)
    body.set('interactionEntryId', input.interactionEntryId)
  if (input.startedAt)
    body.set('startedAt', input.startedAt.toISOString())
  if (input.endedAt)
    body.set('endedAt', input.endedAt.toISOString())
  await requestAudio(`/api/kiosk/visitor-sessions/${input.visitorSessionId}/media`, { body, method: 'POST' })
}

/** Requests speech with Taiwan Traditional text, using the Site's private model/voice policy. */
export async function synthesizeKioskSpeech(input: { locale: string, text: string, signal?: AbortSignal }) {
  const response = await requestAudio('/api/kiosk/audio/speech', {
    body: JSON.stringify({ locale: input.locale, text: toOrderingTraditionalChinese(normalizeOrderingPrices(input.text)) }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal: input.signal,
  })
  return await response.blob()
}

/** Carries a safe HTTP status for the route-level kiosk state machine. */
export class KioskDeviceRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
