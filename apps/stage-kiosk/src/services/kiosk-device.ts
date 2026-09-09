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
    greetingPrompt: string
    interactiveService: { description: string, id: string, title: string, url: string }
    surveyUrl: string
    version: 1
  }
}

/** Server-owned interaction session created for the currently authenticated kiosk. */
export interface KioskVisitorSession {
  id: string
  state: 'active' | 'completed' | 'cancelled' | 'idle'
}

export type KioskInteractionEntryKind = 'user_text' | 'assistant_text' | 'asr_transcript' | 'tool_call' | 'tool_result' | 'service_event' | 'order_result'

const apiBaseUrl = (import.meta.env.VITE_API_SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '')

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

/** Retrieves the device authenticated by the browser's HttpOnly kiosk cookie. */
export async function fetchKioskBootstrap() {
  return await request<{ device: KioskDevice, profile?: KioskProfile }>('/api/kiosk/bootstrap')
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
  return await request(`/api/kiosk/visitor-sessions/${input.visitorSessionId}/entries`, {
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
export async function sendKioskConversationMessage(input: { content: string, visitorSessionId: string }) {
  return await request<{ answer: string }>(`/api/kiosk/visitor-sessions/${input.visitorSessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content: input.content }),
  })
}

/** Asks the Server Gateway to create one Profile-controlled proactive assistant turn. */
export async function sendKioskAssistantAction(input: { kind: 'greeting' | 'reminder', visitorSessionId: string }) {
  return await request<{ answer: string }>(`/api/kiosk/visitor-sessions/${input.visitorSessionId}/assistant-actions`, {
    method: 'POST',
    body: JSON.stringify({ kind: input.kind }),
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

/** Carries a safe HTTP status for the route-level kiosk state machine. */
export class KioskDeviceRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
