import type { Context } from 'hono'

import type { KioskProfileSnapshot } from '../../schemas/kiosk'
import type { KioskService } from '../../services/domain/kiosk'
import type { HonoEnv } from '../../types/hono'

import { randomInt } from 'node:crypto'

import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { boolean, integer, maxLength, minValue, number, object, picklist, pipe, regex, safeParse, string } from 'valibot'

import { createBadRequestError, createUnauthorizedError } from '../../utils/error'

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

const conversationMessageSchema = object({
  content: pipe(string(), regex(/\S/), maxLength(8_000)),
})

const orderResultSchema = object({
  fulfillmentMode: picklist(['dine-in', 'takeout']),
  id: pipe(string(), regex(/^[\w-]+$/), maxLength(120)),
  itemCount: pipe(number(), integer(), minValue(0)),
  simulated: boolean(),
  total: pipe(number(), minValue(0)),
})

const assistantActionSchema = object({
  kind: picklist(['greeting', 'reminder']),
})

/** Dependencies that configure the kiosk device enrollment transport. */
export interface KioskRoutesOptions {
  /** Enables the development-only number enrollment route. Never enable in production. */
  developmentRegistrationEnabled: boolean
  kioskService: KioskService
  /** Server-owned default model selection and Provider dispatch boundary. */
  llmGateway: {
    complete: (input: { body: Record<string, unknown>, modelName: string }) => Promise<Response>
    getDefaultModel: () => Promise<string>
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

    const content = result.output.content.trim()
    await options.kioskService.appendDeviceInteraction({
      content,
      kind: 'user_text',
      deviceId: device.id,
      visitorSessionId: transcript.session.id,
    })
    const answer = await completeKioskReply({
      content,
      kioskService: options.kioskService,
      llmGateway: options.llmGateway,
      profile,
      transcript,
    })
    await options.kioskService.appendDeviceInteraction({
      content: answer,
      kind: 'assistant_text',
      deviceId: device.id,
      visitorSessionId: transcript.session.id,
    })
    return c.json({ answer })
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

    const actionPrompt = result.output.kind === 'greeting'
      ? profile.snapshot.greetingPrompt
      : profile.snapshot.assistanceReminderPrompt
    const answer = await completeKioskReply({
      actionPrompt,
      kioskService: options.kioskService,
      llmGateway: options.llmGateway,
      profile,
      transcript,
    })
    await options.kioskService.appendDeviceInteraction({
      content: answer,
      kind: 'assistant_text',
      metadata: { action: result.output.kind },
      deviceId: device.id,
      visitorSessionId: transcript.session.id,
    })
    return c.json({ answer })
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

async function parseAssistantReply(response: Response) {
  if (!response.ok)
    throw createBadRequestError('LLM Provider did not return a successful response', 'LLM_PROVIDER_ERROR')

  const payload: unknown = await response.json()
  if (!isChatCompletion(payload))
    throw createBadRequestError('LLM Provider response is invalid', 'LLM_PROVIDER_INVALID_RESPONSE')
  return payload.choices[0].message.content
}

async function completeKioskReply(input: {
  actionPrompt?: string
  content?: string
  kioskService: KioskService
  llmGateway: KioskRoutesOptions['llmGateway']
  profile: { siteId: string, snapshot: KioskProfileSnapshot }
  transcript: Awaited<ReturnType<KioskService['getVisitorSessionForDevice']>>
}) {
  const overrides = await input.kioskService.getSiteModelOverrides(input.profile.siteId)
  const modelName = overrides.llm ?? await input.llmGateway.getDefaultModel()
  const response = await input.llmGateway.complete({
    modelName,
    body: {
      model: modelName,
      messages: [
        { role: 'system', content: createCharacterInstructions(input.profile.snapshot) },
        ...input.transcript.entries
          .filter(entry => entry.kind === 'user_text' || entry.kind === 'assistant_text')
          .map(entry => ({
            role: entry.kind === 'user_text' ? 'user' : 'assistant',
            content: entry.content,
          })),
        ...(input.actionPrompt ? [{ role: 'system', content: input.actionPrompt }] : []),
        ...(input.content ? [{ role: 'user', content: input.content }] : []),
      ],
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
    card.postHistoryInstructions && `持續互動原則：${card.postHistoryInstructions}`,
    snapshot.agentInstructions && `店別補充指示：${snapshot.agentInstructions}`,
  ].filter(Boolean).join('\n\n')
}

function isChatCompletion(value: unknown): value is { choices: [{ message: { content: string } }] } {
  if (!value || typeof value !== 'object' || !('choices' in value) || !Array.isArray(value.choices))
    return false
  const choice = value.choices[0]
  return !!choice
    && typeof choice === 'object'
    && 'message' in choice
    && !!choice.message
    && typeof choice.message === 'object'
    && 'content' in choice.message
    && typeof choice.message.content === 'string'
}
