import type { DeviceSettingsSnapshot, KioskVoiceVadSettings } from '@proj-airi/kiosk-proactive'

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
    idleMotion?: {
      format: 'vrma'
      id: string
      name: string
      sha256: string
    }
    characterCard?: {
      description: string
      personality: string
      postHistoryInstructions: string
      scenario: string
      systemPrompt: string
    }
    greetingPrompt: string
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

/** Retrieves the device authenticated by the browser's HttpOnly kiosk cookie. */
export async function fetchKioskBootstrap() {
  return await request<{ device: KioskDevice, deviceSettings: DeviceSettingsSnapshot, mediaCapturePolicy: { mode: KioskMediaCaptureMode }, performanceProfile: KioskPerformanceProfile, proactiveVlmEnabled: boolean, profile?: KioskProfile, voiceVadSettings: KioskVoiceVadSettings }>('/api/kiosk/bootstrap')
}

/** Reads the current policy only for the device identified by its HttpOnly cookie. */
export function fetchDeviceSettings(signal?: AbortSignal) {
  return request<DeviceSettingsSnapshot>('/api/kiosk/settings', { signal })
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
  metadata?: Record<string, unknown>
  visitorSessionId: string
}) {
  return await request<{ entry: { id: string } }>(`/api/kiosk/visitor-sessions/${input.visitorSessionId}/entries`, {
    method: 'POST',
    body: JSON.stringify({ content: input.content, kind: input.kind, metadata: input.metadata ?? {} }),
  })
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

/** Sends visitor text through the Server-owned Provider Gateway for this visitor session. */
export async function sendKioskConversationMessage(input: {
  content?: string
  signal?: AbortSignal
  toolResults?: Array<{ content: string, name: string, toolCallId: string }>
  tools: KioskToolDefinition[]
  visitorSessionId: string
}) {
  return await request<{ answer?: string, toolCalls: KioskToolCall[] }>(`/api/kiosk/visitor-sessions/${input.visitorSessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content: input.content, toolResults: input.toolResults ?? [], tools: input.tools }),
    signal: input.signal,
  })
}

/** Asks the Server Gateway to create one Profile-controlled proactive assistant turn. */
export async function sendKioskAssistantAction(input: {
  frame?: string
  kind: 'greeting' | 'reminder'
  signal?: AbortSignal
  visitorSessionId: string
}) {
  return await request<{ answer: string }>(`/api/kiosk/visitor-sessions/${input.visitorSessionId}/assistant-actions`, {
    method: 'POST',
    body: JSON.stringify({ frame: input.frame, kind: input.kind }),
    signal: input.signal,
  })
}

/** Stores the limited, non-personal result emitted by the current approved ordering service. */
export async function recordKioskOrderResult(input: {
  fulfillmentMode: 'dine-in' | 'takeout'
  id: string
  itemCount: number
  simulated: boolean
  total: number
  visitorSessionId: string
}) {
  return await request(`/api/kiosk/visitor-sessions/${input.visitorSessionId}/order-results`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** Builds the multipart request body for the device-authenticated ASR gateway. */
export function createKioskTranscriptionBody(recording: Blob) {
  const body = new FormData()
  // useAudioRecorder serializes microphone samples as WAV/PCM. The filename
  // is part of the ASR protocol: providers may choose a decoder from it.
  body.set('file', recording, 'recording.wav')
  return body
}

/** Sends microphone bytes to the device-authenticated ASR gateway. */
export async function transcribeKioskAudio(recording: Blob, signal?: AbortSignal) {
  const body = createKioskTranscriptionBody(recording)
  const response = await requestAudio('/api/kiosk/audio/transcriptions', { body, method: 'POST', signal })
  return await response.json() as { text: string }
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

/** Requests speech from the Site policy without exposing its model or voice. */
export async function synthesizeKioskSpeech(input: { locale: string, text: string, signal?: AbortSignal }) {
  const response = await requestAudio('/api/kiosk/audio/speech', {
    body: JSON.stringify({ locale: input.locale, text: input.text }),
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
