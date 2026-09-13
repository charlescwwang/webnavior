import type { Context } from 'hono'

import type { KioskProfileSnapshot } from '../../schemas/kiosk'
import type { KioskService } from '../../services/domain/kiosk'
import type { KioskMediaService } from '../../services/domain/kiosk-media'
import type { HonoEnv } from '../../types/hono'

import { randomInt } from 'node:crypto'

import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { array, boolean, integer, literal, maxLength, minLength, minValue, number, object, optional, picklist, pipe, regex, safeParse, string, unknown } from 'valibot'

import { createBadRequestError, createForbiddenError, createUnauthorizedError } from '../../utils/error'

/** Cookie name shared by kiosk registration and bootstrap requests. */
export const kioskDeviceCookieName = 'airi_kiosk_device'

const developmentRegistrationSchema = object({
  registrationCode: pipe(string(), regex(/^\d{6}$/, 'registrationCode must contain exactly six digits')),
})

const visitorSessionSchema = object({
  serviceId: pipe(string(), regex(/^[a-z][a-z0-9-]*$/), maxLength(120)),
})

const interactionEntrySchema = object({
  content: pipe(string(), maxLength(32_000)),
  kind: picklist(['user_text', 'assistant_text', 'asr_transcript', 'tool_call', 'tool_result', 'service_event', 'order_result']),
  metadata: object({}),
})

const endVisitorSessionSchema = object({
  state: picklist(['completed', 'cancelled', 'idle']),
})

const kioskToolSchema = object({
  function: object({
    description: optional(pipe(string(), maxLength(8_000))),
    name: pipe(string(), regex(/^[\w-]+$/), maxLength(128)),
    parameters: unknown(),
  }),
  type: literal('function'),
})

const kioskToolResultSchema = object({
  content: pipe(string(), maxLength(32_000)),
  name: pipe(string(), regex(/^[\w-]+$/), maxLength(128)),
  toolCallId: pipe(string(), minLength(1), maxLength(256)),
})

const conversationMessageSchema = object({
  content: optional(pipe(string(), regex(/\S/), maxLength(8_000))),
  toolResults: optional(array(kioskToolResultSchema), []),
  tools: optional(array(kioskToolSchema), []),
})

const orderResultSchema = object({
  fulfillmentMode: picklist(['dine-in', 'takeout']),
  id: pipe(string(), regex(/^[\w-]+$/), maxLength(120)),
  itemCount: pipe(number(), integer(), minValue(0)),
  simulated: boolean(),
  total: pipe(number(), minValue(0)),
})

const assistantActionSchema = object({
  // A downscaled JPEG from the live kiosk camera. It is inference-only and is
  // deliberately not persisted through the visitor-media route.
  frame: optional(pipe(string(), maxLength(700_000), regex(/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i, 'frame must be a JPEG data URL'))),
  kind: picklist(['greeting', 'reminder']),
})

const speechSchema = object({
  locale: optional(pipe(string(), minLength(2), maxLength(35)), 'zh-TW'),
  text: pipe(string(), regex(/\S/), maxLength(8_000)),
})

/** Dependencies that configure the kiosk device enrollment transport. */
export interface KioskRoutesOptions {
  /** Enables the development-only number enrollment route. Never enable in production. */
  developmentRegistrationEnabled: boolean
  kioskService: KioskService
  /** Private media storage for internal POC recordings. */
  mediaService?: KioskMediaService
  /** Server-owned default model selection and Provider dispatch boundary. */
  llmGateway: {
    complete: (input: { abortSignal?: AbortSignal, body: Record<string, unknown>, modelName: string }) => Promise<Response>
    getDefaultModel: () => Promise<string>
  }
  /** Device-authenticated ASR/TTS transport; its configuration stays server-side. */
  audioGateway?: {
    speak: (input: { locale: string, modelName: string, text: string }) => Promise<Response>
    transcribe: (input: { audio: File, modelName: string }) => Promise<string>
  }
  /** True when this deployment is HTTPS, so device credentials must be Secure cookies. */
  secureCookies: boolean
}

/**
 * Creates the device-facing kiosk transport.
 *
 * The development enrollment route is absent, rather than merely rejected,
 * when disabled. This prevents a production deployment from advertising a
 * weaker enrollment surface to unauthenticated clients.
 */
export function createKioskRoutes(options: KioskRoutesOptions) {
  const routes = new Hono<HonoEnv>()

  routes.get('/bootstrap', async (c) => {
    const credential = getCookie(c, kioskDeviceCookieName)
    if (!credential)
      throw createUnauthorizedError('Kiosk device registration is required')

    let device = await options.kioskService.resolveDeviceCredential(credential)
    if (!device)
      throw createUnauthorizedError('Kiosk device credential is invalid or revoked')

    if (options.developmentRegistrationEnabled && device.registrationMethod === 'development' && !await options.kioskService.isCurrentDevelopmentDevice(device.id)) {
      // A previous development build bound this browser to a separate POC Site.
      // Replace only that development credential so local testing follows the
      // configured Webnavior test Site without touching production devices.
      const replacement = await options.kioskService.registerDevelopmentDevice({ registrationCode: createDevelopmentRegistrationCode() })
      setCookie(c, kioskDeviceCookieName, replacement.credential, {
        httpOnly: true,
        path: '/api/kiosk',
        sameSite: 'Lax',
        secure: options.secureCookies,
      })
      device = replacement.device
    }

    const profile = await options.kioskService.getDeviceProfile(device.id)
    const deviceSettings = await options.kioskService.getDeviceSettings(device.id)
    const { effective } = deviceSettings
    return c.json({
      device: {
        id: device.id,
        label: device.label,
        registrationMethod: device.registrationMethod,
        siteId: device.siteId,
      },
      profile: profile && {
        releaseId: profile.id,
        name: profile.name,
        snapshot: profile.snapshot,
      },
      deviceSettings,
      mediaCapturePolicy: { mode: profile ? effective.mediaCaptureMode : 'off' },
      proactiveVlmEnabled: Boolean(profile && effective.proactiveVlmEnabled),
      performanceProfile: effective.performanceProfile,
      voiceVadThreshold: effective.voiceVadThreshold,
    })
  })

  routes.get('/settings', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    return c.json(await options.kioskService.getDeviceSettings(device.id))
  })

  routes.put('/settings', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const user = c.get('user')
    if (!user)
      throw createUnauthorizedError('Sign in as a site operator to change settings')
    return c.json(await options.kioskService.updateDeviceSettings({
      deviceId: device.id,
      siteId: device.siteId,
      userId: user.id,
      source: 'local',
      body: await c.req.json().catch(() => null),
    }))
  })

  routes.post('/audio/transcriptions', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const audio = (await c.req.formData()).get('file')
    if (!(audio instanceof File) || audio.size === 0)
      throw createBadRequestError('Kiosk transcription requires a non-empty audio file', 'INVALID_REQUEST')

    const modelName = await resolveKioskAudioModel(options.kioskService, device.id, 'asr')
    if (!options.audioGateway)
      throw createBadRequestError('Kiosk ASR gateway is unavailable', 'KIOSK_AUDIO_GATEWAY_UNAVAILABLE')
    const text = await options.audioGateway.transcribe({ audio, modelName })
    return c.json({ text })
  })

  routes.post('/audio/speech', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const result = safeParse(speechSchema, await c.req.json().catch(() => null))
    if (!result.success)
      throw createBadRequestError('Invalid kiosk speech request', 'INVALID_REQUEST', result.issues)

    const modelName = await resolveKioskAudioModel(options.kioskService, device.id, 'tts')
    if (!options.audioGateway)
      throw createBadRequestError('Kiosk TTS gateway is unavailable', 'KIOSK_AUDIO_GATEWAY_UNAVAILABLE')
    return await options.audioGateway.speak({
      locale: result.output.locale,
      modelName,
      text: result.output.text,
    })
  })

  routes.post('/visitor-sessions', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const body = await c.req.json().catch(() => null)
    const result = safeParse(visitorSessionSchema, body)
    if (!result.success)
      throw createBadRequestError('Invalid visitor session request', 'INVALID_REQUEST', result.issues)

    const profile = await options.kioskService.getDeviceProfile(device.id)
    if (!profile)
      throw createBadRequestError('Kiosk device has no assigned Profile', 'PROFILE_UNASSIGNED')

    const session = await options.kioskService.startVisitorSession({
      deviceId: device.id,
      profileReleaseId: profile.id,
      serviceId: result.output.serviceId,
    })
    return c.json({ session }, 201)
  })

  routes.post('/visitor-sessions/:visitorSessionId/entries', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const body = await c.req.json().catch(() => null)
    const result = safeParse(interactionEntrySchema, body)
    if (!result.success)
      throw createBadRequestError('Invalid kiosk interaction entry', 'INVALID_REQUEST', result.issues)

    const entry = await options.kioskService.appendDeviceInteraction({
      ...result.output,
      deviceId: device.id,
      visitorSessionId: c.req.param('visitorSessionId'),
    })
    return c.json({ entry }, 201)
  })

  routes.post('/visitor-sessions/:visitorSessionId/media', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const visitorSessionId = c.req.param('visitorSessionId')
    await options.kioskService.getVisitorSessionForDevice({ deviceId: device.id, visitorSessionId })
    if (!options.mediaService)
      throw createBadRequestError('Kiosk media storage is unavailable', 'KIOSK_MEDIA_UNAVAILABLE')

    const form = await c.req.formData()
    const file = form.get('file')
    const kind = form.get('kind')
    const interactionEntryId = form.get('interactionEntryId')
    if (!(file instanceof File) || file.size === 0 || file.size > 32 * 1024 * 1024)
      throw createBadRequestError('Kiosk media requires a file up to 32 MiB', 'INVALID_REQUEST')
    if (kind !== 'audio_recording' && kind !== 'triggered_video' && kind !== 'continuous_video')
      throw createBadRequestError('Invalid kiosk media kind', 'INVALID_REQUEST')
    const { effective } = await options.kioskService.getDeviceSettings(device.id)
    if (kind !== 'audio_recording' && (effective.mediaCaptureMode === 'off'
      || (kind === 'continuous_video' && (effective.mediaCaptureMode !== 'continuous' || effective.performanceProfile === 'constrained')))) {
      throw createForbiddenError('Camera recording is disabled by device policy')
    }
    if (interactionEntryId !== null && (typeof interactionEntryId !== 'string' || interactionEntryId.length === 0 || interactionEntryId.length > 120))
      throw createBadRequestError('Invalid kiosk media interaction reference', 'INVALID_REQUEST')

    const startedAt = parseOptionalMediaDate(form.get('startedAt'))
    const endedAt = parseOptionalMediaDate(form.get('endedAt'))
    if (startedAt === null || endedAt === null)
      throw createBadRequestError('Invalid kiosk media timestamp', 'INVALID_REQUEST')

    const media = await options.mediaService.save({
      data: new Uint8Array(await file.arrayBuffer()),
      ...(endedAt ? { endedAt } : {}),
      ...(interactionEntryId ? { interactionEntryId } : {}),
      kind,
      mimeType: file.type || 'application/octet-stream',
      ...(startedAt ? { startedAt } : {}),
      visitorSessionId,
    })
    return c.json({ media }, 201)
  })

  routes.post('/visitor-sessions/:visitorSessionId/end', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const body = await c.req.json().catch(() => null)
    const result = safeParse(endVisitorSessionSchema, body)
    if (!result.success)
      throw createBadRequestError('Invalid visitor session end request', 'INVALID_REQUEST', result.issues)

    const session = await options.kioskService.endDeviceVisitorSession({
      ...result.output,
      deviceId: device.id,
      visitorSessionId: c.req.param('visitorSessionId'),
    })
    return c.json({ session })
  })

  routes.post('/visitor-sessions/:visitorSessionId/messages', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const body = await c.req.json().catch(() => null)
    const result = safeParse(conversationMessageSchema, body)
    if (!result.success)
      throw createBadRequestError('Invalid kiosk conversation message', 'INVALID_REQUEST', result.issues)

    const transcript = await options.kioskService.getVisitorSessionForDevice({
      deviceId: device.id,
      visitorSessionId: c.req.param('visitorSessionId'),
    })
    if (transcript.session.state !== 'active')
      throw createBadRequestError('Visitor session is not active', 'SESSION_INACTIVE')

    const profile = await options.kioskService.getProfileRelease(transcript.session.profileReleaseId)
    if (!profile)
      throw createBadRequestError('Visitor session Profile was not found', 'PROFILE_NOT_FOUND')

    const content = result.output.content?.trim()
    if (!content && result.output.toolResults.length === 0)
      throw createBadRequestError('A message or tool result is required', 'INVALID_REQUEST')

    if (content) {
      await options.kioskService.appendDeviceInteraction({
        content,
        kind: 'user_text',
        deviceId: device.id,
        visitorSessionId: transcript.session.id,
      })
    }
    for (const toolResult of result.output.toolResults) {
      await options.kioskService.appendDeviceInteraction({
        content: toolResult.content,
        kind: 'tool_result',
        metadata: { name: toolResult.name, toolCallId: toolResult.toolCallId },
        deviceId: device.id,
        visitorSessionId: transcript.session.id,
      })
    }
    const answer = await completeKioskReply({
      content,
      kioskService: options.kioskService,
      llmGateway: options.llmGateway,
      profile,
      transcript,
      toolResults: result.output.toolResults,
      tools: result.output.tools,
      abortSignal: c.req.raw.signal,
    })
    if (answer.content) {
      await options.kioskService.appendDeviceInteraction({
        content: answer.content,
        kind: 'assistant_text',
        deviceId: device.id,
        visitorSessionId: transcript.session.id,
      })
    }
    if (answer.toolCalls.length > 0) {
      await options.kioskService.appendDeviceInteraction({
        content: JSON.stringify(answer.toolCalls),
        kind: 'tool_call',
        metadata: { toolCalls: answer.toolCalls },
        deviceId: device.id,
        visitorSessionId: transcript.session.id,
      })
    }
    return c.json({ answer: answer.content, toolCalls: answer.toolCalls })
  })

  routes.post('/visitor-sessions/:visitorSessionId/assistant-actions', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const body = await c.req.json().catch(() => null)
    const result = safeParse(assistantActionSchema, body)
    if (!result.success)
      throw createBadRequestError('Invalid kiosk assistant action', 'INVALID_REQUEST', result.issues)

    const transcript = await options.kioskService.getVisitorSessionForDevice({
      deviceId: device.id,
      visitorSessionId: c.req.param('visitorSessionId'),
    })
    if (transcript.session.state !== 'active')
      throw createBadRequestError('Visitor session is not active', 'SESSION_INACTIVE')

    const profile = await options.kioskService.getProfileRelease(transcript.session.profileReleaseId)
    if (!profile)
      throw createBadRequestError('Visitor session Profile was not found', 'PROFILE_NOT_FOUND')

    const { effective } = await options.kioskService.getDeviceSettings(device.id)
    if (!effective.observationEnabled || !(result.output.kind === 'greeting' ? effective.greetingEnabled : effective.reminderEnabled))
      throw createForbiddenError('Proactive action is disabled by device policy')
    const proactiveVlmEnabled = effective.proactiveVlmEnabled
    if (proactiveVlmEnabled && !result.output.frame)
      throw createBadRequestError('A camera frame is required for VLM', 'INVALID_REQUEST')
    const answer = await completeKioskReply({
      actionPrompt: result.output.kind === 'greeting'
        ? profile.snapshot.greetingPrompt
        : profile.snapshot.assistanceReminderPrompt,
      abortSignal: c.req.raw.signal,
      kioskService: options.kioskService,
      llmGateway: options.llmGateway,
      ...(proactiveVlmEnabled ? { modelCapability: 'vision' as const, sceneFrame: result.output.frame } : {}),
      profile,
      transcript,
    })
    if (!answer.content)
      throw createBadRequestError('LLM Provider did not return a text reply', 'LLM_PROVIDER_INVALID_RESPONSE')
    await options.kioskService.appendDeviceInteraction({
      content: answer.content,
      kind: 'assistant_text',
      metadata: { action: result.output.kind },
      deviceId: device.id,
      visitorSessionId: transcript.session.id,
    })
    return c.json({ answer: answer.content })
  })

  routes.post('/visitor-sessions/:visitorSessionId/order-results', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const body = await c.req.json().catch(() => null)
    const result = safeParse(orderResultSchema, body)
    if (!result.success)
      throw createBadRequestError('Invalid kiosk order result', 'INVALID_REQUEST', result.issues)

    const entry = await options.kioskService.appendDeviceInteraction({
      content: JSON.stringify({
        fulfillmentMode: result.output.fulfillmentMode,
        id: result.output.id,
        itemCount: result.output.itemCount,
        simulated: result.output.simulated,
        total: result.output.total,
      }),
      kind: 'order_result',
      deviceId: device.id,
      visitorSessionId: c.req.param('visitorSessionId'),
    })
    return c.json({ entry }, 201)
  })

  if (!options.developmentRegistrationEnabled)
    return routes

  routes.post('/development/register', async (c) => {
    const body = await c.req.json()
    const result = safeParse(developmentRegistrationSchema, body)
    if (!result.success)
      throw createBadRequestError('Invalid development registration request', 'INVALID_REQUEST', result.issues)

    const { credential, device } = await options.kioskService.registerDevelopmentDevice(result.output)
    setCookie(c, kioskDeviceCookieName, credential, {
      httpOnly: true,
      path: '/api/kiosk',
      sameSite: 'Lax',
      secure: options.secureCookies,
    })
    return c.json({
      device: {
        id: device.id,
        label: device.label,
        registrationMethod: device.registrationMethod,
        siteId: device.siteId,
      },
    }, 201)
  })

  return routes
}

function parseOptionalMediaDate(value: FormDataEntryValue | null): Date | undefined | null {
  if (value === null)
    return undefined
  if (typeof value !== 'string')
    return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function createDevelopmentRegistrationCode() {
  return String(randomInt(1_000_000)).padStart(6, '0')
}

async function resolveAuthenticatedDevice(c: Context<HonoEnv>, kioskService: KioskService) {
  const credential = getCookie(c, kioskDeviceCookieName)
  if (!credential)
    throw createUnauthorizedError('Kiosk device registration is required')

  const device = await kioskService.resolveDeviceCredential(credential)
  if (!device)
    throw createUnauthorizedError('Kiosk device credential is invalid or revoked')
  return device
}

/** Resolves a device's Site policy only after authenticating its opaque credential. */
async function resolveKioskAudioModel(
  kioskService: KioskService,
  deviceId: string,
  capability: 'asr' | 'tts',
) {
  const profile = await kioskService.getDeviceProfile(deviceId)
  if (!profile)
    throw createBadRequestError('Kiosk device has no assigned Profile', 'PROFILE_UNASSIGNED')

  const modelName = (await kioskService.getSiteModelOverrides(profile.siteId))[capability]
  if (!modelName)
    throw createBadRequestError(`Kiosk Site has no ${capability.toUpperCase()} model policy`, 'KIOSK_AUDIO_POLICY_NOT_CONFIGURED')
  return modelName
}

/** Resolves the VLM explicitly so proactive copy can never fall back to a static template. */
async function resolveKioskVisionModel(kioskService: KioskService, siteId: string) {
  const modelName = (await kioskService.getSiteModelOverrides(siteId)).vision
  if (!modelName)
    throw createBadRequestError('Kiosk Site has no VLM model policy', 'KIOSK_VISION_POLICY_NOT_CONFIGURED')
  return modelName
}

interface KioskToolCall {
  function: { arguments: string, name: string }
  id: string
  type: 'function'
}

interface KioskCompletion {
  content?: string
  toolCalls: KioskToolCall[]
}

async function parseAssistantReply(response: Response): Promise<KioskCompletion> {
  if (!response.ok)
    throw createBadRequestError('LLM Provider did not return a successful response', 'LLM_PROVIDER_ERROR')

  const payload: unknown = await response.json()
  if (!isChatCompletion(payload))
    throw createBadRequestError('LLM Provider response is invalid', 'LLM_PROVIDER_INVALID_RESPONSE')
  return {
    content: payload.choices[0].message.content || undefined,
    toolCalls: payload.choices[0].message.tool_calls ?? [],
  }
}

async function completeKioskReply(input: {
  actionPrompt?: string
  abortSignal?: AbortSignal
  content?: string
  kioskService: KioskService
  llmGateway: KioskRoutesOptions['llmGateway']
  modelCapability?: 'llm' | 'vision'
  profile: { siteId: string, snapshot: KioskProfileSnapshot }
  sceneFrame?: string
  transcript: Awaited<ReturnType<KioskService['getVisitorSessionForDevice']>>
  toolResults?: Array<{ content: string, name: string, toolCallId: string }>
  tools?: Array<{ function: { description?: string, name: string, parameters: unknown }, type: 'function' }>
}) {
  const overrides = await input.kioskService.getSiteModelOverrides(input.profile.siteId)
  const modelName = input.modelCapability === 'vision'
    ? await resolveKioskVisionModel(input.kioskService, input.profile.siteId)
    : overrides.llm ?? await input.llmGateway.getDefaultModel()
  const response = await input.llmGateway.complete({
    abortSignal: input.abortSignal,
    modelName,
    body: {
      model: modelName,
      messages: [
        { role: 'system', content: createCharacterInstructions(input.profile.snapshot) },
        ...toConversationMessages(input.transcript.entries),
        ...(input.toolResults ?? []).map(toolResult => ({ role: 'tool', content: toolResult.content, tool_call_id: toolResult.toolCallId })),
        ...(input.content ? [{ role: 'user', content: input.content }] : []),
        ...(input.profile.snapshot.characterCard?.postHistoryInstructions
          ? [{ role: 'system', content: input.profile.snapshot.characterCard.postHistoryInstructions }]
          : []),
        ...(input.actionPrompt ? [{ role: 'system', content: createAssistantActionInstructions(input.actionPrompt) }] : []),
        // Some OpenAI-compatible gateways reject a system-only conversation.
        // When VLM is off there is no scene-frame user turn, so represent the
        // proactive event explicitly without inventing visitor input.
        ...(input.actionPrompt && !input.sceneFrame
          ? [{ role: 'user', content: '請現在產生一則自然、簡短的繁體中文主動互動台詞。' }]
          : []),
        ...(input.sceneFrame
          ? [{
              role: 'user',
              content: [
                { type: 'text', text: '這是此刻的 kiosk 視訊畫面。請依畫面與上述場域指引，直接說出現在最適合的一句台詞。' },
                { type: 'image_url', image_url: { url: input.sceneFrame } },
              ],
            }]
          : []),
      ],
      ...(input.tools?.length ? { tools: input.tools } : {}),
    },
  })
  return await parseAssistantReply(response)
}

/** Combines imported Character Card v3 context with site-specific additions. */
function createCharacterInstructions(snapshot: KioskProfileSnapshot) {
  const card = snapshot.characterCard
  if (!card)
    return snapshot.agentInstructions

  return [
    `角色名稱：${snapshot.characterName}`,
    card.description && `角色介紹：${card.description}`,
    card.personality && `個性與語氣：${card.personality}`,
    card.scenario && `情境：${card.scenario}`,
    card.systemPrompt && `角色系統指示：${card.systemPrompt}`,
    snapshot.agentInstructions && `店別補充指示：${snapshot.agentInstructions}`,
  ].filter(Boolean).join('\n\n')
}

/**
 * Frames an autonomous kiosk reminder as an output action rather than a new
 * conversation turn. This prevents Character Card setup prose from leaking
 * into a customer-visible reply when no visitor has sent a message.
 */
function createAssistantActionInstructions(prompt: string) {
  return [
    '這是 Kiosk 的系統主動互動事件。根據接下來的現場影像，只輸出一則給眼前顧客看的、簡短自然的繁體中文台詞。',
    '不可直接重複、引用或輸出以下場域指引；不可說明或承認角色設定、系統指示、工具、菜單資料或尚未開始對話；不可辨識身分、年齡、性別或其他敏感特徵。',
    `本次互動的場域指引：${prompt}`,
  ].join('\n')
}

function toConversationMessages(entries: Awaited<ReturnType<KioskService['getVisitorSessionForDevice']>>['entries']) {
  return entries.flatMap((entry) => {
    if (entry.kind === 'user_text' || entry.kind === 'assistant_text')
      return [{ role: entry.kind === 'user_text' ? 'user' : 'assistant', content: entry.content }]
    if (entry.kind === 'tool_call') {
      const toolCalls = entry.metadata?.toolCalls
      return Array.isArray(toolCalls) ? [{ role: 'assistant', content: '', tool_calls: toolCalls }] : []
    }
    if (entry.kind === 'tool_result' && typeof entry.metadata?.toolCallId === 'string')
      return [{ role: 'tool', content: entry.content, tool_call_id: entry.metadata.toolCallId }]
    return []
  })
}

function isChatCompletion(value: unknown): value is { choices: [{ message: { content?: string | null, tool_calls?: KioskToolCall[] } }] } {
  if (!value || typeof value !== 'object' || !('choices' in value) || !Array.isArray(value.choices))
    return false
  const choice = value.choices[0]
  if (!choice || typeof choice !== 'object' || !('message' in choice) || !choice.message || typeof choice.message !== 'object')
    return false
  const message = choice.message
  return ('content' in message && (typeof message.content === 'string' || message.content === null))
    || ('tool_calls' in message && Array.isArray(message.tool_calls))
}
