import type { AudioWarning } from '@proj-airi/stage-shared/kiosk-audio'
import type { ContextReply, ConversationContext, ConversationToolCall, ServiceRecoveryProgress } from '@proj-airi/stage-shared/kiosk-conversation'
import type { Context } from 'hono'

import type { KioskProfileSnapshot } from '../../schemas/kiosk'
import type { createKioskPosGateway } from '../../services/adapters/kioskPos'
import type { KioskService } from '../../services/domain/kiosk'
import type { KioskAgentInteractionState, KioskReplyFailureReason } from '../../services/domain/kiosk-agent-interaction'
import type { KioskConversationDecisionState, KioskInteractionDecision } from '../../services/domain/kiosk-interaction-decision/contracts'
import type { KioskMediaService } from '../../services/domain/kiosk-media'
import type { createKioskSystemOneService } from '../../services/domain/kiosk-system-one'
import type { HonoEnv } from '../../types/hono'

import { createHash, randomInt, randomUUID } from 'node:crypto'

import { useLogger } from '@guiiai/logg'
import { audioWarningSchema } from '@proj-airi/stage-shared/kiosk-audio'
import { contextReplySchema, conversationContextSchema, conversationRequestSchema, customerReplySchema, handoffSchema, intentRecoverySchema, isServiceLimitationReply, serviceClarificationSchema, serviceContextKey, serviceRecoveryLimits } from '@proj-airi/stage-shared/kiosk-conversation'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { array, boolean, check, integer, literal, maxLength, maxValue, minLength, minValue, number, object, optional, picklist, pipe, regex, safeParse, string, unknown } from 'valibot'

import { rateLimiter } from '../../middlewares/rate-limit'
import { isPosRoute, isPublicPosRoute } from '../../services/adapters/kioskPos'
import { compactToolResultForModel, createInteractionInstructions, hasMenuReply, queryClarification, recordAssistantActions, recordCustomerInput, recordToolResults, selectBoundedConversationText } from '../../services/domain/kiosk-agent-interaction'
import { currentContextInstructions, preserveRequestedQuantities, readOnlyReplyTool, replyTool, reviewOperations, selectReply } from '../../services/domain/kiosk-agent-interaction/conversationContext'
import { orderingInstructions, orderingSkill, resolveOrderingIntent } from '../../services/domain/kiosk-conversation-skills'
import { decideInteraction } from '../../services/domain/kiosk-interaction-decision'
import { buildConversationContext, conversationEntries } from '../../services/domain/kiosk-interaction-decision/context'
import { createRecommendationInvitation } from '../../services/domain/kiosk-interaction-decision/contracts'
import { resolvePhoneChoice } from '../../services/domain/kiosk-interaction-decision/phoneResolution'
import { resolvePriceHandoff } from '../../services/domain/kiosk-interaction-decision/priceResolution'
import { scopeDecisionPolicy } from '../../services/domain/kiosk-interaction-decision/queryScopeContracts'
import { recoverServiceRequest } from '../../services/domain/kiosk-interaction-decision/serviceRecovery'
import { resolveServiceHandoff } from '../../services/domain/kiosk-interaction-decision/serviceResolution'
import { createDecisionStages } from '../../services/domain/kiosk-interaction-decision/stages'
import { decisionRoutes } from '../../services/domain/kiosk/interactionContracts'
import { ApiError, createBadRequestError, createForbiddenError, createUnauthorizedError } from '../../utils/error'
import { isLoopbackOrigin } from '../../utils/origin'
import { createLocalAdminAccess } from './localAdmin'

/** Cookie name shared by kiosk registration and bootstrap requests. */
export const kioskDeviceCookieName = 'airi_kiosk_device'

const developmentRegistrationSchema = object({
  registrationCode: pipe(string(), regex(/^\d{6}$/, 'registrationCode must contain exactly six digits')),
})

const visitorSessionSchema = object({
  serviceId: pipe(string(), regex(/^[a-z][a-z0-9-]*$/), maxLength(120)),
})

const interactionEntrySchema = object({
  content: pipe(string(), maxLength(1_000_000)),
  kind: picklist(['user_text', 'assistant_text', 'asr_transcript', 'tool_call', 'tool_result', 'service_event', 'order_result']),
  metadata: optional(object({
    utteranceId: optional(pipe(number(), integer(), minValue(1))),
    decisionRoute: optional(picklist(decisionRoutes)),
    questionId: optional(pipe(string(), minLength(1), maxLength(120))),
    name: optional(pipe(string(), regex(/^[\w:-]+$/), maxLength(120))),
    source: optional(pipe(string(), maxLength(80))),
  })),
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

const interactionStateSchema = object({
  screen: optional(picklist(['customer_entry', 'menu', 'cart_review', 'item_configuration', 'request_confirmation', 'checkout'])),
  lastAddedItemName: optional(pipe(string(), maxLength(120))),
  matchingCartLines: pipe(number(), integer(), minValue(0)),
  pendingAction: optional(pipe(string(), maxLength(80))),
  pendingIntent: optional(pipe(string(), maxLength(80))),
  selectedItemName: optional(pipe(string(), maxLength(120))),
  seating: optional(object({ partySize: optional(pipe(number(), integer(), minValue(1), maxValue(20))), ready: boolean(), question: pipe(string(), maxLength(500)) })),
})

const presentedQuestionSchema = object({
  questionId: pipe(string(), minLength(1), maxLength(120)),
  requestId: optional(pipe(string(), minLength(1), maxLength(200))),
  purpose: pipe(string(), minLength(1), maxLength(60)),
  question: pipe(string(), minLength(1), maxLength(500)),
  expiresAt: number(),
  choices: pipe(array(object({ id: pipe(string(), minLength(1), maxLength(120)), description: pipe(string(), maxLength(500)) })), maxLength(20)),
})

// HTTP carries browser-issued price choices; execution still compares their ID
// with the browser's one-use ticket, so these are evidence, never tool authority.
const priceConditionsSchema = object({
  minPrice: optional(pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER))),
  maxPrice: optional(pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER))),
  minPriceExclusive: optional(boolean()),
  maxPriceExclusive: optional(boolean()),
  priceOrder: optional(literal('ASC')),
})
const priceEvidenceSchema = object({
  amounts: pipe(array(object({ text: pipe(string(), maxLength(120)), amount: pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER)) })), maxLength(2)),
  choices: pipe(array(object({ id: pipe(string(), regex(/^[A-Z_]+$/), maxLength(40)), description: pipe(string(), maxLength(500)), kind: picklist(['condition', 'information', 'none', 'unsupported']), conditions: optional(priceConditionsSchema) })), minLength(3), maxLength(15)),
})

const conversationMessageSchema = object({
  utteranceId: optional(pipe(number(), integer(), minValue(1))),
  content: optional(pipe(string(), regex(/\S/), maxLength(8_000))),
  decisionState: optional(pipe(object({
    serviceMode: optional(picklist(['kiosk', 'table-service'])),
    serviceClarification: optional(serviceClarificationSchema),
    context: optional(conversationContextSchema),
    handoff: optional(handoffSchema),
    requireMenuRead: optional(boolean()),
    readOnly: optional(boolean()),
    priceEvidence: optional(priceEvidenceSchema),
    priceInquiry: optional(boolean()),
    incompleteSpeech: optional(object({ transcript: pipe(string(), maxLength(8_000)), expiresAt: number(), related: literal(true) })),
    menuRevision: optional(pipe(number(), integer(), minValue(0))),
    constraints: optional(object({ exclude: pipe(array(pipe(string(), maxLength(80))), maxLength(9)), include: optional(pipe(array(pipe(string(), maxLength(80))), maxLength(9))), dietary: optional(literal('vegetarian')), price: optional(priceConditionsSchema), unresolvedPrice: optional(boolean()) })),
    completedReads: optional(pipe(array(object({ toolName: pipe(string(), maxLength(80)), customerMessage: pipe(string(), maxLength(2_000)) })), maxLength(2))),
    unavailableConditionReferences: optional(pipe(array(object({ id: pipe(string(), regex(/^[a-z-]+$/), maxLength(80)), label: pipe(string(), maxLength(120)) })), maxLength(7))),
    fulfillmentModes: optional(pipe(array(object({ id: picklist(['dine-in', 'takeout']), label: pipe(string(), minLength(1), maxLength(80)) })), maxLength(2))),
    retainedRequests: optional(pipe(array(conversationRequestSchema), maxLength(20))),
    intentRecovery: optional(intentRecoverySchema),
    waitingFor: optional(presentedQuestionSchema),
    serviceReply: optional(boolean()),
    replyOnly: optional(boolean()),
    requestScope: optional(picklist(['menu-information', 'order-information', 'order-operation', 'service-information'])),
    allowedPaymentMethods: optional(pipe(array(pipe(string(), minLength(1), maxLength(80))), maxLength(20))),
    interactionState: optional(interactionStateSchema),
    paymentState: optional(pipe(string(), maxLength(40))),
    phase: pipe(string(), regex(/^[a-z_]+$/), maxLength(60)),
  }), check(value => !value.context || (value.phase === value.context.phase && (value.readOnly === undefined || value.readOnly === value.context.readOnly) && (value.menuRevision === undefined || value.menuRevision === value.context.revisions.menu)), 'Conversation state does not match its current context'))),
  toolResults: optional(array(kioskToolResultSchema), []),
  tools: optional(array(kioskToolSchema), []),
})

const orderResultSchema = object({
  serviceMode: optional(literal('table-service')),
  table: optional(object({ id: pipe(string(), regex(/^a0[1-9]$/)), label: pipe(string(), maxLength(40)) })),
  lines: optional(pipe(array(object({ name: pipe(string(), maxLength(200)), quantity: pipe(number(), integer(), minValue(1)), total: pipe(number(), minValue(0)) })), maxLength(200))),
  environment: picklist(['test', 'live']),
  fulfillmentMode: picklist(['dine-in', 'takeout']),
  id: pipe(string(), regex(/^[\w-]+$/), maxLength(120)),
  itemCount: pipe(number(), integer(), minValue(0)),
  pickupNumber: optional(pipe(string(), regex(/^[1-9]\d{2}$/))),
  posOrderId: optional(pipe(string(), regex(/^[\w-]+$/), maxLength(120))),
  status: literal('accepted'),
  total: pipe(number(), minValue(0)),
})

const assistantActionSchema = object({
  phase: optional(picklist(['customer_entry', 'ordering'])),
  invitationAllowed: optional(boolean(), false),
  // A downscaled JPEG from the live kiosk camera. It is inference-only and is
  // deliberately not persisted through the visitor-media route.
  frame: optional(pipe(string(), maxLength(700_000), regex(/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i, 'frame must be a JPEG data URL'))),
  kind: picklist(['greeting', 'reminder']),
})

const speechSchema = object({
  locale: optional(pipe(string(), minLength(2), maxLength(35)), 'zh-TW'),
  text: pipe(string(), regex(/\S/), maxLength(8_000)),
})

const interactionDecisionSchema = object({
  utteranceId: optional(pipe(number(), integer(), minValue(1))),
  recoveryUsed: optional(boolean()),
  budgetMs: optional(pipe(number(), integer(), minValue(1), maxValue(serviceRecoveryLimits.turnMs))),
  segmented: optional(boolean()),
  visitorSessionId: optional(pipe(string(), minLength(1), maxLength(120))),
  review: optional(object({ answer: pipe(string(), maxLength(2_000)), observation: pipe(string(), maxLength(4_000)) })),
  candidates: pipe(array(object({ description: pipe(string(), regex(/\S/), maxLength(500)), id: pipe(string(), regex(/^[\w:-]+$/), maxLength(120)), requiresHighConfidence: optional(boolean()) })), maxLength(253)),
  decisionState: optional(object({
    serviceMode: optional(picklist(['kiosk', 'table-service'])),
    clarificationOffer: optional(object({ id: pipe(string(), maxLength(120)), label: pipe(string(), maxLength(120)) })),
    priceEvidence: optional(priceEvidenceSchema),
    incompleteSpeech: optional(object({ transcript: pipe(string(), maxLength(8_000)), expiresAt: number(), related: optional(boolean()) })),
    productResolution: optional(object({ status: picklist(['exact', 'possible', 'none', 'overflow']), count: pipe(number(), integer(), minValue(0)), references: pipe(array(object({ label: pipe(string(), maxLength(120)), refId: pipe(string(), maxLength(120)) })), maxLength(5)) })),
    catalogEvidence: optional(object({
      products: pipe(array(object({ label: pipe(string(), maxLength(120)), matchedText: pipe(string(), minLength(1), maxLength(120)), source: picklist(['name', 'alias', 'fragment']) })), maxLength(5)),
      categories: pipe(array(object({ label: pipe(string(), maxLength(120)), matchedText: pipe(string(), minLength(1), maxLength(120)), itemCount: pipe(number(), integer(), minValue(0)) })), maxLength(5)),
    })),
    revisions: optional(object({ cart: number(), checkout: number(), selectedItem: number(), menu: optional(number()) })),
    completedReads: optional(pipe(array(object({ toolName: pipe(string(), maxLength(80)), customerMessage: pipe(string(), maxLength(2_000)) })), maxLength(2))),
    unavailableConditionReferences: optional(pipe(array(object({ id: pipe(string(), regex(/^[a-z-]+$/), maxLength(80)), label: pipe(string(), maxLength(120)) })), maxLength(7))),
    menuRevision: optional(pipe(number(), integer(), minValue(0))),
    fulfillmentModes: optional(pipe(array(object({ id: picklist(['dine-in', 'takeout']), label: pipe(string(), minLength(1), maxLength(80)) })), maxLength(2))),
    retainedRequests: optional(pipe(array(conversationRequestSchema), maxLength(20))),
    intentRecovery: optional(intentRecoverySchema),
    waitingFor: optional(presentedQuestionSchema),
    activeRequest: optional(object({ stage: picklist(['starting', 'thinking', 'tool_requested', 'mutating']), text: pipe(string(), regex(/\S/), maxLength(240)) })),
    allowedPaymentMethods: optional(pipe(array(pipe(string(), minLength(1), maxLength(80))), maxLength(20))),
    checkoutSnapshot: optional(unknown()),
    constraints: optional(object({ exclude: pipe(array(pipe(string(), maxLength(80))), maxLength(9)), include: optional(pipe(array(pipe(string(), maxLength(80))), maxLength(9))), dietary: optional(literal('vegetarian')), price: optional(priceConditionsSchema), unresolvedPrice: optional(boolean()) })),
    ingredientReferences: optional(pipe(array(object({ id: pipe(string(), regex(/^[a-z_-]+$/), maxLength(40)), label: pipe(string(), maxLength(40)) })), maxLength(9))),
    dietaryReferences: optional(pipe(array(object({ id: literal('vegetarian'), label: pipe(string(), maxLength(40)) })), maxLength(1))),
    serviceClarification: optional(serviceClarificationSchema),
    interactionState: optional(interactionStateSchema),
    paymentState: optional(pipe(string(), maxLength(40))),
    phase: pipe(string(), regex(/^[a-z_]+$/), maxLength(60)),
    references: optional(pipe(array(object({ label: pipe(string(), maxLength(120)), refId: pipe(string(), maxLength(120)) })), maxLength(32))),
  })),
  includeTrace: optional(boolean()),
  maxQuestions: optional(pipe(number(), integer(), minValue(1), maxValue(24))),
  presenceState: optional(picklist(['EMPTY', 'PASSING', 'DISTANT', 'APPROACHING', 'ENGAGED'])),
  transcript: pipe(string(), regex(/\S/), maxLength(8_000)),
})

/** Dependencies that configure the kiosk device enrollment transport. */
export interface KioskRoutesOptions {
  /** Enables the development-only number enrollment route. Never enable in production. */
  developmentRegistrationEnabled: boolean
  kioskService: KioskService
  /** Private media storage for internal POC recordings. */
  mediaService?: KioskMediaService
  /** Structured device-warning logging boundary; defaults to the Server logger. */
  audioWarningLogger?: (warning: AudioWarning & { deviceId: string, siteId: string }) => void
  /** Server-owned default model selection and Provider dispatch boundary. */
  llmGateway: {
    complete: (input: { abortSignal?: AbortSignal, body: Record<string, unknown>, modelName: string }) => Promise<Response>
  }
  /** Sole source for the system-wide Webnavior model choices. */
  runtimeModelPolicy: {
    modelFor: (capability: 'chat' | 'vision' | 'asr' | 'tts') => Promise<string | undefined>
  }
  /** Device-authenticated ASR/TTS transport; its configuration stays server-side. */
  audioGateway?: {
    speak: (input: { locale: string, modelName: string, text: string }) => Promise<Response>
    transcribe: (input: { audio: File, modelName: string }) => Promise<string>
  }
  systemOne?: Pick<ReturnType<typeof createKioskSystemOneService>, 'decide' | 'getPolicy' | 'isEnabled' | 'maxActionCandidates'>
  /** Development-only trace of the tool protocol; never include customer content or tool arguments. */
  toolTraceObserver?: { record: (input: { phase: 'browser-results' | 'llm-requests' | 'tools-provided', toolNames: string[], visitorSessionId: string }) => void }
  /** True when this deployment is HTTPS, so device credentials must be Secure cookies. */
  secureCookies: boolean
  /** Server-only PIN and signing secret; never exposed through bootstrap. */
  localAdmin?: { pin?: string, secret: string }
  /** Fixed upstream network boundary; no browser-supplied destinations. */
  posGateway?: ReturnType<typeof createKioskPosGateway>
  /** Exact public API origin for cookie-authenticated POS writes. */
  apiOrigin?: string
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
  const decisionStages = createDecisionStages()
  const localAdmin = createLocalAdminAccess({ ...options.localAdmin, secret: options.localAdmin?.secret ?? '', secureCookies: options.secureCookies, origin: options.apiOrigin })
  const pinLimiter = rateLimiter({ max: 5, windowSec: 60, routeLabel: 'kiosk.admin.pin', keyGenerator: c => createHash('sha256').update(getCookie(c, kioskDeviceCookieName) ?? 'unregistered').digest('hex') })

  routes.post('/admin/session', async (c, next) => {
    // Resolve before limiting so invented credentials cannot rotate valid buckets.
    await resolveAuthenticatedDevice(c, options.kioskService)
    return pinLimiter(c, next)
  }, async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const parsed = safeParse(object({ pin: pipe(string(), regex(/^\d{4,12}$/)) }), await c.req.json().catch(() => null))
    if (!parsed.success)
      throw createUnauthorizedError('Incorrect local administrator PIN')
    return c.json(await localAdmin.unlock(c, device.id, getCookie(c, kioskDeviceCookieName)!, parsed.output.pin))
  })
  routes.delete('/admin/session', async (c) => {
    await resolveAuthenticatedDevice(c, options.kioskService)
    localAdmin.lock(c)
    return c.json({ locked: true })
  })

  routes.all('/pos/*', async (c) => {
    const path = c.req.path.split('/pos/')[1] ?? ''
    if (!isPosRoute(path))
      return c.json({ error: 'Unknown POS route.' }, 404)
    if (!options.posGateway)
      return c.json({ error: 'POS Bridge unavailable.' }, 503)
    const origin = c.req.header('Origin')
    // Separate localhost Vite/API ports are an explicit development policy;
    // a public deployment accepts only its exact configured origin.
    const localDevelopmentOrigin = options.apiOrigin && origin && isLoopbackOrigin(options.apiOrigin) && isLoopbackOrigin(origin)
    if (options.apiOrigin && origin && origin !== options.apiOrigin && !localDevelopmentOrigin)
      throw createForbiddenError('Untrusted POS origin')
    if (!isPublicPosRoute(path))
      await resolveAuthenticatedDevice(c, options.kioskService)
    // A timeout may follow an upstream write. Never retry the request here.
    try {
      return await options.posGateway.forward({ path, method: c.req.method, credential: isPublicPosRoute(path) ? undefined : getCookie(c, kioskDeviceCookieName), body: c.req.method === 'GET' || c.req.method === 'HEAD' ? undefined : await c.req.arrayBuffer() })
    }
    catch { return c.json({ error: 'POS result unavailable; reconcile before retrying.' }, 503) }
  })

  // Payment verification must never run bootstrap's development-device
  // replacement lifecycle or issue a new device cookie.
  routes.get('/identity', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const { effective } = await options.kioskService.getDeviceSettings(device.id)
    return c.json({ device: { id: device.id, siteId: device.siteId }, serviceMode: effective.serviceMode })
  })

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
      voiceVadSettings: effective.voiceVadSettings,
    })
  })

  routes.get('/settings', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    return c.json(await options.kioskService.getDeviceSettings(device.id))
  })

  routes.put('/settings', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const credential = getCookie(c, kioskDeviceCookieName)!
    await localAdmin.authorize(c, device.id, credential)
    return c.json(await options.kioskService.updateDeviceSettings({
      deviceId: device.id,
      siteId: device.siteId,
      deviceCredential: credential,
      source: 'local-pin',
      body: await c.req.json().catch(() => null),
    }))
  })

  routes.post('/audio/warnings', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const result = safeParse(audioWarningSchema, await c.req.json().catch(() => null))
    if (!result.success)
      throw createBadRequestError('Invalid kiosk audio warning', 'INVALID_REQUEST', result.issues)
    // Available before any visitor session; never append to dialogue or invoke models.
    const warning = { ...result.output, deviceId: device.id, siteId: device.siteId }
    if (options.audioWarningLogger)
      options.audioWarningLogger(warning)
    else
      useLogger('kiosk-audio').useGlobalConfig().withFields(warning).warn('Kiosk microphone preprocessing degraded')
    return c.json({ accepted: true })
  })

  routes.post('/audio/transcriptions', async (c) => {
    await resolveAuthenticatedDevice(c, options.kioskService)
    const audio = (await c.req.formData()).get('file')
    if (!(audio instanceof File) || audio.size === 0)
      throw createBadRequestError('Kiosk transcription requires a non-empty audio file', 'INVALID_REQUEST')

    const modelName = await resolveKioskAudioModel(options.runtimeModelPolicy, 'asr')
    if (!options.audioGateway)
      throw createBadRequestError('Kiosk ASR gateway is unavailable', 'KIOSK_AUDIO_GATEWAY_UNAVAILABLE')
    const text = await options.audioGateway.transcribe({ audio, modelName })
    return c.json({ text })
  })

  routes.get('/interaction-decisions/status', async (c) => {
    await resolveAuthenticatedDevice(c, options.kioskService)
    // Read on each utterance; bootstrap/browser caches must not outlive an
    // administrator's activation change. This never probes the model.
    c.header('Cache-Control', 'no-store')
    return c.json({ enabled: options.systemOne ? await options.systemOne.isEnabled() : false })
  })

  routes.post('/interaction-decisions', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const result = safeParse(interactionDecisionSchema, await c.req.json().catch(() => null))
    if (!result.success)
      throw createBadRequestError('Invalid kiosk interaction decision request', 'INVALID_REQUEST', result.issues)
    const session = result.output.visitorSessionId
      ? await options.kioskService.getVisitorSessionForDevice({ deviceId: device.id, visitorSessionId: result.output.visitorSessionId })
      : undefined
    if (session && session.session.state !== 'active')
      throw createBadRequestError('Visitor session is not active', 'SESSION_INACTIVE')
    const { effective: decisionSettings } = await options.kioskService.getDeviceSettings(device.id)
    if (!result.output.review && result.output.decisionState?.phase === 'query_scope' && result.output.decisionState.waitingFor?.purpose === 'menu-query-scope') {
      const state = result.output.decisionState
      const scopePolicy = scopeDecisionPolicy(decisionSettings.backgroundSpeechMode)
      const modelName = await options.runtimeModelPolicy.modelFor('chat')
      if (!modelName)
        return c.json({ kind: 'SCOPE_CHOICE', choice: 'ASK' })
      // IDs and expiry belong to browser admission, not language semantics.
      // Exclude their arbitrary numbers from the scope/condition checkpoint.
      const response = await options.llmGateway.complete({ modelName, abortSignal: c.req.raw.signal, body: { model: modelName, temperature: 0, messages: [{ role: 'system', content: scopePolicy.instructions }, { role: 'user', content: JSON.stringify({ stage: 'answer', customerUtterance: result.output.transcript, confirmedConditions: state.constraints, question: { prompt: state.waitingFor!.question, options: state.waitingFor!.choices.map(choice => ({ id: choice.id, label: choice.description })) } }) }], tools: [scopePolicy.tool], tool_choice: 'required' } })
      const payload = await response.json().catch(() => null)
      const parsed = safeParse(object({ choices: array(object({ message: object({ tool_calls: array(object({ function: object({ name: string(), arguments: string() }) })) }) })) }), payload)
      const calls = parsed.success ? parsed.output.choices[0]?.message.tool_calls : undefined
      let choice: unknown
      if (response.ok && calls?.length === 1 && calls[0]!.function.name === 'scope_decide') {
        try {
          choice = JSON.parse(calls[0]!.function.arguments).choice
        }
        catch {
          /* An invalid proposal keeps the question pending. */
        }
      }
      return c.json({ kind: 'SCOPE_CHOICE', choice: scopePolicy.tool.function.parameters.properties.choice.enum.includes(String(choice)) ? choice : 'ASK' })
    }
    if (!options.systemOne || !await options.systemOne.isEnabled())
      return c.json({ kind: 'NEEDS_ASSISTANT', reason: 'SYSTEM_ONE_DISABLED' })
    const cue = result.output.decisionState?.serviceClarification
    if (cue && (cue.expiresAt <= Date.now() || cue.contextKey !== serviceContextKey(result.output.decisionState!)))
      delete result.output.decisionState!.serviceClarification
    const decisionInput = {
      backgroundSpeechMode: decisionSettings.backgroundSpeechMode,
      conversation: session ? buildConversationContext(session.entries, result.output.review ? result.output.transcript : undefined) : undefined,
      review: result.output.review,
      candidates: result.output.candidates,
      decisionState: result.output.decisionState,
      includeTrace: result.output.includeTrace,
      maxQuestions: result.output.maxQuestions,
      invoke: options.systemOne.decide,
      maxActionCandidates: await options.systemOne.maxActionCandidates(),
      policy: await options.systemOne.getPolicy(),
      presenceState: result.output.presenceState,
      transcript: result.output.transcript,
    }
    const decide = async (invoke: typeof decisionInput.invoke, progress?: (event: Omit<ServiceRecoveryProgress, 'continuationId' | 'expiresAt'>) => Promise<void>, signal: AbortSignal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(result.output.budgetMs ?? serviceRecoveryLimits.turnMs)])) => {
      const completeResolution = async (body: Record<string, unknown>) => {
        const modelName = await options.runtimeModelPolicy.modelFor('chat')
        if (!modelName)
          throw new Error('No Main model is configured for bounded resolution.')
        return await options.llmGateway.complete({ modelName, body: { ...body, model: modelName }, abortSignal: signal })
      }
      // Both Jev admission and later Main recovery must reach the same finite
      // phone-effect decision. Recovery admits a request; it does not perform it.
      const resolvePhone = async (decision: KioskInteractionDecision): Promise<KioskInteractionDecision> => {
        const skip = result.output.candidates.find(candidate => candidate.id === 'intent:skip-customer-entry')
        // Phone resolution is an effect decision, so it requires completed
        // service admission. An uncertain recipient cannot authorize a skip.
        const unresolvedPhone = decision.kind === 'NEEDS_ASSISTANT' && (decision.reason === 'UNCERTAIN_OPERATION' || (decision.reason === 'NEW_REQUEST' && decision.recovery?.admission === 'service')) && !decision.recovery?.readOnly
        const proposedSkip = decision.kind === 'FAST_ACTION' && decision.actionId === skip?.id
        if (!result.output.review && result.output.decisionState?.phase === 'customer_entry' && (unresolvedPhone || proposedSkip) && skip) {
          const modelName = await options.runtimeModelPolicy.modelFor('chat')
          if (modelName) {
            const resolution = await resolvePhoneChoice(result.output.transcript, body => options.llmGateway.complete({ modelName, body: { ...body, model: modelName }, abortSignal: signal }), decisionSettings.backgroundSpeechMode)
            const trace = result.output.includeTrace ? { trace: { ...(decision.trace && typeof decision.trace === 'object' ? decision.trace : {}), phoneResolution: resolution } } : {}
            if (decisionSettings.backgroundSpeechMode === 'enforce' && resolution.choice === 'BACKGROUND')
              return { kind: 'IGNORE', modelCalls: decision.modelCalls, modelQuestions: decision.modelQuestions, ...(decision.recovery ? { recovery: decision.recovery } : {}), ...trace }
            if (resolution.choice === 'SKIP_PHONE') {
              const waitingFor = result.output.decisionState.waitingFor
              return { kind: 'FAST_ACTION' as const, actionId: skip.id, modelCalls: decision.modelCalls, modelQuestions: decision.modelQuestions, ...(decision.recovery ? { recovery: decision.recovery } : {}), ...(waitingFor?.purpose === 'customer-entry' ? { answeredQuestionId: waitingFor.questionId } : {}), ...trace }
            }
            // A finite phone proposal is not consent. A failed/uncertain Main
            // verification must not preserve the original executable skip.
            decision = proposedSkip
              ? { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST', recovery: { status: 'eligible' }, modelCalls: decision.modelCalls, modelQuestions: decision.modelQuestions, ...trace }
              : { ...decision, ...trace }
          }
        }
        return decision
      }
      let bounded = await decideInteraction({ ...decisionInput, invoke, routing: 'staged' })
      if (decisionSettings.backgroundSpeechMode !== 'enforce' && bounded.kind === 'UNAVAILABLE' && bounded.reason === 'UNCERTAIN_SERVICE_REQUEST')
        bounded = { ...bounded, kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION', recovery: undefined }
      // Jev failure establishes no service intent. The same independent Main
      // admission used for semantic uncertainty must run before Agent fallback.
      if (bounded.kind === 'UNAVAILABLE' && bounded.reason === 'PROVIDER_FAILURE') {
        bounded = decisionSettings.backgroundSpeechMode === 'enforce'
          ? { ...bounded, reason: 'UNCERTAIN_SERVICE_REQUEST', recovery: { status: 'eligible' } }
          : { ...bounded, kind: 'NEEDS_ASSISTANT', reason: 'PROVIDER_FAILURE', recovery: undefined }
      }
      // A waiting question is not proof this utterance answers it. If Jev
      // abstained from the answer, qualify service intent before Main sees
      // executable answer choices; otherwise its old question anchors a guess.
      if (decisionSettings.backgroundSpeechMode === 'enforce' && !result.output.review && bounded.kind === 'NEEDS_ASSISTANT' && bounded.reason === 'UNCERTAIN_OPERATION'
        && result.output.decisionState?.waitingFor && bounded.recovery?.admission !== 'service') {
        bounded = { ...bounded, kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST', recovery: { status: 'eligible' } }
      }
      const priced = await resolvePriceHandoff(bounded, result.output.transcript, result.output.review ? undefined : result.output.decisionState?.priceEvidence, completeResolution)
      let decision = priced
      if (!result.output.review && bounded.recovery?.status !== 'eligible') {
        // A live Menu-issued answer is the smallest semantic decision. If Main
        // abstains, independently qualify the whole request; a diagnostic trace
        // alone never means its purpose was understood.
        decision = await resolveOrderingIntent(decision, decisionInput, completeResolution)
        decision = await resolveServiceHandoff(decision, result.output.transcript, result.output.decisionState, completeResolution, decisionInput.conversation, decisionSettings.backgroundSpeechMode)
        // Purpose resolution can newly establish a menu read after an earlier
        // question/abstention skipped price qualification. Issued price choices
        // are one-pass, so this cannot duplicate an already completed check.
        decision = await resolvePriceHandoff(decision, result.output.transcript, result.output.decisionState?.priceEvidence, completeResolution)
      }
      signal.throwIfAborted()
      decision = await resolvePhone(decision)
      if (result.output.review || result.output.recoveryUsed || decision.recovery?.status !== 'eligible')
        return decision
      const modelName = await options.runtimeModelPolicy.modelFor('chat')
      if (!modelName)
        return { ...decision, recovery: { status: 'failed' as const, failure: 'unavailable' as const } }
      const recovered = await recoverServiceRequest(decision, {
        backgroundSpeechMode: decisionSettings.backgroundSpeechMode,
        utteranceId: result.output.utteranceId,
        modelName,
        transcript: result.output.transcript,
        state: result.output.decisionState,
        conversation: decisionInput.conversation,
        progress,
        signal,
        complete: (body, abortSignal) => options.llmGateway.complete({ modelName, body, abortSignal }),
      })
      signal.throwIfAborted()
      // Recovery may be the first stage to admit this turn. Qualify its price
      // evidence now, before the Host binds an unresolved-price Menu task.
      // Already-issued choices skip the resolver, preserving the one-pass budget.
      let qualified = await resolvePhone(recovered)
      qualified = await resolvePriceHandoff(qualified, result.output.transcript, result.output.decisionState?.priceEvidence, completeResolution)
      // Recovery can be the first stage to understand a new named request.
      // Apply the same Menu-issued scope once after admission, rather than
      // permanently freezing an answer to a general service question as a read.
      const interpreted = qualified.resolvedBy === 'main-skill'
      if (!interpreted) {
        qualified = await resolveServiceHandoff(qualified, result.output.transcript, result.output.decisionState, completeResolution, decisionInput.conversation, decisionSettings.backgroundSpeechMode)
        qualified = await resolvePriceHandoff(qualified, result.output.transcript, result.output.decisionState?.priceEvidence, completeResolution)
        qualified = await resolveOrderingIntent(qualified, decisionInput, completeResolution)
      }
      signal.throwIfAborted()
      if (result.output.visitorSessionId && qualified.recovery?.rounds?.length)
        await options.kioskService.appendDeviceInteraction({ deviceId: device.id, visitorSessionId: result.output.visitorSessionId, kind: 'service_event', content: JSON.stringify({ kind: 'service_recovery_metrics', ...qualified.recovery }), metadata: { source: 'service_recovery_metrics', utteranceId: result.output.utteranceId } })
      return qualified
    }
    return c.json(result.output.segmented
      ? await decisionStages.start({ deviceId: device.id, visitorSessionId: result.output.visitorSessionId }, (checkpoint, progress, signal) => decide(checkpoint(options.systemOne!.decide), progress, signal), { signal: c.req.raw.signal, timeoutMs: result.output.budgetMs })
      : await decide(options.systemOne.decide))
  })

  routes.post('/interaction-decisions/:id', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const body = safeParse(object({ visitorSessionId: optional(pipe(string(), minLength(1), maxLength(120))) }), await c.req.json().catch(() => null))
    if (!body.success)
      throw createBadRequestError('Invalid decision continuation', 'INVALID_REQUEST')
    if (body.output.visitorSessionId) {
      const session = await options.kioskService.getVisitorSessionForDevice({ deviceId: device.id, visitorSessionId: body.output.visitorSessionId })
      if (session.session.state !== 'active')
        throw createBadRequestError('Visitor session is not active', 'SESSION_INACTIVE')
    }
    try {
      return c.json(await decisionStages.next({ deviceId: device.id, visitorSessionId: body.output.visitorSessionId }, c.req.param('id'), c.req.raw.signal))
    }
    catch {
      throw createBadRequestError('Decision continuation expired or unavailable', 'STALE_DECISION')
    }
  })

  routes.post('/audio/speech', async (c) => {
    await resolveAuthenticatedDevice(c, options.kioskService)
    const result = safeParse(speechSchema, await c.req.json().catch(() => null))
    if (!result.success)
      throw createBadRequestError('Invalid kiosk speech request', 'INVALID_REQUEST', result.issues)

    const modelName = await resolveKioskAudioModel(options.runtimeModelPolicy, 'tts')
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
    // Manual takeover skips model continuation, but its last settled receipt
    // must refresh the same working state as any other accepted browser result.
    if (entry.kind === 'tool_result' && (entry.metadata?.decisionRoute === 'fast_path' || entry.metadata?.source === 'manual_control') && typeof entry.metadata.name === 'string') {
      const transcript = await options.kioskService.getVisitorSessionForDevice({ deviceId: device.id, visitorSessionId: c.req.param('visitorSessionId') })
      const interaction = recordToolResults(transcript.session.agentInteraction, [{ content: entry.content, name: entry.metadata.name }])
      if (interaction !== transcript.session.agentInteraction)
        await options.kioskService.updateDeviceAgentInteraction({ deviceId: device.id, interaction, visitorSessionId: transcript.session.id })
    }
    return c.json({ entry }, 201)
  })

  routes.get('/visitor-sessions/:visitorSessionId/history', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const transcript = await options.kioskService.getVisitorSessionForDevice({ deviceId: device.id, visitorSessionId: c.req.param('visitorSessionId') })
    if (transcript.session.state !== 'active')
      throw createBadRequestError('Visitor session is not active', 'SESSION_INACTIVE')
    const conversation = conversationTextEntries(transcript.entries)
    const beforeQuery = c.req.query('before')
    const requestedBefore = beforeQuery === undefined ? conversation.length : Number(beforeQuery)
    if (!Number.isSafeInteger(requestedBefore) || requestedBefore < 0)
      throw createBadRequestError('History cursor must be a non-negative integer', 'INVALID_REQUEST')
    const before = Math.min(requestedBefore, conversation.length)
    const start = Math.max(0, before - 16)
    return c.json({
      entries: conversation.slice(start, before).map((entry, index) => ({ content: entry.content.slice(0, 2_000), index: start + index, role: entry.kind === 'user_text' ? 'user' : 'assistant' })),
      ...(start > 0 ? { nextBefore: start } : {}),
      total: conversation.length,
    })
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
    if (kind !== 'audio_recording' && kind !== 'triggered_image' && kind !== 'triggered_video' && kind !== 'continuous_video')
      throw createBadRequestError('Invalid kiosk media kind', 'INVALID_REQUEST')
    const { effective } = await options.kioskService.getDeviceSettings(device.id)
    const cameraMediaAllowed = kind === 'triggered_image'
      ? effective.mediaCaptureMode === 'snapshot'
      : kind === 'continuous_video'
        ? effective.mediaCaptureMode === 'continuous' && effective.performanceProfile !== 'constrained'
        : effective.mediaCaptureMode === 'triggered' || effective.mediaCaptureMode === 'continuous'
    if (kind !== 'audio_recording' && !cameraMediaAllowed) {
      throw createForbiddenError('Camera capture is disabled by device policy')
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

    if (result.output.tools.length > 0) {
      options.toolTraceObserver?.record({
        phase: 'tools-provided',
        toolNames: result.output.tools.map(tool => tool.function.name),
        visitorSessionId: transcript.session.id,
      })
    }
    if (result.output.toolResults.length > 0) {
      options.toolTraceObserver?.record({
        phase: 'browser-results',
        toolNames: result.output.toolResults.map(toolResult => toolResult.name),
        visitorSessionId: transcript.session.id,
      })
    }

    if (content) {
      await options.kioskService.appendDeviceInteraction({
        content,
        kind: 'user_text',
        metadata: result.output.utteranceId ? { utteranceId: result.output.utteranceId } : {},
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
    let agentInteraction = transcript.session.agentInteraction
    if (content)
      agentInteraction = recordCustomerInput(agentInteraction, content)
    if (result.output.toolResults.length > 0)
      agentInteraction = recordToolResults(agentInteraction, result.output.toolResults)
    if (agentInteraction !== transcript.session.agentInteraction) {
      await options.kioskService.updateDeviceAgentInteraction({
        deviceId: device.id,
        interaction: agentInteraction,
        visitorSessionId: transcript.session.id,
      })
    }
    if (c.req.header('accept')?.includes('text/event-stream')) {
      return c.body(createKioskReplyEventStream({
        agentInteraction,
        content,
        decisionState: result.output.decisionState,
        deviceId: device.id,
        kioskService: options.kioskService,
        llmGateway: options.llmGateway,
        runtimeModelPolicy: options.runtimeModelPolicy,
        profile,
        signal: c.req.raw.signal,
        toolTraceObserver: options.toolTraceObserver,
        toolResults: result.output.toolResults,
        tools: result.output.tools,
        transcript,
      }), 200, {
        'Cache-Control': 'no-cache',
        'Content-Type': 'text/event-stream',
      })
    }
    const answer = await completeKioskReply({
      agentInteraction,
      content,
      decisionState: result.output.decisionState,
      kioskService: options.kioskService,
      llmGateway: options.llmGateway,
      runtimeModelPolicy: options.runtimeModelPolicy,
      profile,
      transcript,
      toolResults: result.output.toolResults,
      tools: result.output.tools,
      abortSignal: c.req.raw.signal,
    })
    await recordRoundMetrics(options.kioskService, device.id, transcript.session.id, answer)
    if (answer.content) {
      await options.kioskService.appendDeviceInteraction({
        content: answer.content,
        // Operation prose is a draft; only the host's validated receipt is
        // customer dialogue. Do not feed a competing question back as history.
        kind: 'service_event',
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
    const nextAgentInteraction = recordAssistantActions(agentInteraction, answer.toolCalls)
    if (nextAgentInteraction !== agentInteraction) {
      agentInteraction = nextAgentInteraction
      await options.kioskService.updateDeviceAgentInteraction({
        deviceId: device.id,
        interaction: agentInteraction,
        visitorSessionId: transcript.session.id,
      })
    }
    if (agentInteraction.mode !== 'active') {
      await options.kioskService.appendDeviceInteraction({
        content: agentInteraction.mode === 'decision_guidance' ? 'agent.decision_guidance' : 'agent.touch_preferred',
        deviceId: device.id,
        kind: 'service_event',
        metadata: { mode: agentInteraction.mode, noProgressCount: agentInteraction.noProgressCount },
        visitorSessionId: transcript.session.id,
      })
    }
    return c.json({ agentInteraction: { mode: agentInteraction.mode }, answer: answer.content, ...(answer.reply ? { reply: answer.reply } : {}), toolCalls: answer.toolCalls })
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
      actionPrompt: `${result.output.kind === 'greeting'
        ? profile.snapshot.greetingPrompt
        : profile.snapshot.assistanceReminderPrompt}\n只寫簡短開場陳述，不提出問題、不列出餐點。Application 會在允許時附上具體推薦邀請。`,
      abortSignal: c.req.raw.signal,
      kioskService: options.kioskService,
      llmGateway: options.llmGateway,
      runtimeModelPolicy: options.runtimeModelPolicy,
      ...(proactiveVlmEnabled ? { modelCapability: 'vision' as const, sceneFrame: result.output.frame } : {}),
      profile,
      transcript,
      decisionState: result.output.phase ? { phase: result.output.phase } : undefined,
    })
    if (!answer.content)
      throw createBadRequestError('LLM Provider did not return a text reply', 'LLM_PROVIDER_INVALID_RESPONSE')
    const invitation = result.output.invitationAllowed ? createRecommendationInvitation(randomUUID(), Date.now()) : undefined
    // A generated question is not a second invitation contract. If the model
    // ignores the opening-only instruction, present one canonical invitation.
    let opening = answer.content
    if (invitation && /[?？]/u.test(opening))
      opening = result.output.kind === 'greeting' ? '您好，歡迎光臨。' : '我可以協助您繼續點餐。'
    const customerAnswer = invitation ? `${opening} ${invitation.question}` : opening
    await options.kioskService.appendDeviceInteraction({
      content: customerAnswer,
      kind: 'assistant_text',
      metadata: { action: result.output.kind, ...(invitation ? { questionId: invitation.questionId } : {}) },
      deviceId: device.id,
      visitorSessionId: transcript.session.id,
    })
    return c.json({ answer: customerAnswer, ...(invitation ? { pendingCustomerChoice: invitation } : {}) })
  })

  routes.post('/visitor-sessions/:visitorSessionId/order-results', async (c) => {
    const device = await resolveAuthenticatedDevice(c, options.kioskService)
    const body = await c.req.json().catch(() => null)
    const result = safeParse(orderResultSchema, body)
    if (!result.success)
      throw createBadRequestError('Invalid kiosk order result', 'INVALID_REQUEST', result.issues)

    const entry = await options.kioskService.appendDeviceInteraction({
      content: JSON.stringify({
        environment: result.output.environment,
        fulfillmentMode: result.output.fulfillmentMode,
        id: result.output.id,
        itemCount: result.output.itemCount,
        ...(result.output.serviceMode === 'table-service' ? { serviceMode: result.output.serviceMode, table: result.output.table, lines: result.output.lines } : {}),
        ...(result.output.pickupNumber ? { pickupNumber: result.output.pickupNumber } : {}),
        ...(result.output.posOrderId ? { posOrderId: result.output.posOrderId } : {}),
        status: result.output.status,
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

function parseOptionalMediaDate(value: unknown): Date | undefined | null {
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
  runtimeModelPolicy: KioskRoutesOptions['runtimeModelPolicy'],
  capability: 'asr' | 'tts',
) {
  const modelName = await runtimeModelPolicy.modelFor(capability)
  if (!modelName)
    throw createBadRequestError(`Kiosk 系統尚未設定 ${capability.toUpperCase()} 模型。`, 'KIOSK_AUDIO_POLICY_NOT_CONFIGURED')
  return modelName
}

/** VLM is explicit: an absent binding disables the feature instead of guessing. */
async function resolveKioskVisionModel(runtimeModelPolicy: KioskRoutesOptions['runtimeModelPolicy']) {
  const modelName = await runtimeModelPolicy.modelFor('vision')
  if (!modelName)
    throw createBadRequestError('Kiosk 系統尚未設定 VLM 模型。', 'KIOSK_VISION_POLICY_NOT_CONFIGURED')
  return modelName
}

type KioskToolCall = ConversationToolCall

type KioskAgentInteractionMode = 'active' | 'decision_guidance' | 'touch_preferred'

interface KioskCompletion {
  content?: string
  reply?: ContextReply
  replyRepairRequests?: number
  operationReviewRequests?: number
  toolCalls: KioskToolCall[]
  inputTokens?: number
  metrics?: { replyRepairRequests?: number, operationReviewRequests?: number, requestBytes: number, contextBytes: number, messageBytes: number, toolBytes: number, taskId?: string, durationMs: number, firstOutputMs?: number, inputTokens?: number }
}

// Completion review preserves the original request and its exact scoped tools;
// a draft success claim is never supplied as evidence or an operation plan.
const completionReviewInstruction = '先核對quantityPolicy：超量品項不能減量、拆單或加入；同句合法品項仍須照常加入。將同句合法與超量品項放在同一批工具提案，各自驗證；全部超量時使用respond_to_customer({"kind":"quantity-limit"})明說上限，不轉成clarification、不清空購物車。本輪尚未有完成顧客需求的工具回執。要求打開購物車須cart_get(display:true)；返回訂單須checkout_cancel；pending_confirmation的同意或取消須order_answer_confirmation，不能選發票代替。結束前，重新核對原始顧客需求、相關真實對話與最新情境：查到資料不代表已完成新增、修改或展示下一批推薦。顧客要求看餐點或換其他推薦時，即使完整菜單已在情境內，仍須呼叫 menu_recommend 等展示工具更新畫面，不能只在文字列出餐點，也不能把泛指「其他餐點」交給 menu-information 當品名。條件不變且還有下一批時只傳 {"action":"continue"}，可另加 limit，不能重填 maxPrice、category、excludeItemIds 或其他既有條件，條件由程式保留。承接顧客明確指涉的餐點與份數；資訊已足夠且本輪有授權時，呼叫正確工具完成尚未執行的需求，不要再查已確認的資料或重做已成功的操作。只使用本次提供的工具與參數，不擴大權限、不猜同意、不自行付款。若只是詢問資訊，或仍有必要歧義，使用 respond_to_customer 選擇相應資訊或 clarification；沒有操作成功回執不可宣稱完成。'

// Measure the actual serialized request after projection/compaction, not raw POS size.
function inputMetrics(body: { messages: unknown, tools?: unknown }, context?: KioskConversationDecisionState['context']) {
  const encoder = new TextEncoder()
  return {
    skillId: orderingSkill.id,
    skillVersion: orderingSkill.version,
    requestBytes: encoder.encode(JSON.stringify(body)).byteLength,
    messageBytes: encoder.encode(JSON.stringify(body.messages)).byteLength,
    toolBytes: body.tools ? encoder.encode(JSON.stringify(body.tools)).byteLength : 0,
    contextBytes: context ? encoder.encode(JSON.stringify(context)).byteLength : 0,
    // Retain readiness/capability evidence without recording invoice identifiers.
    // This distinguishes missing input from an omitted Main operation in the
    // deployed Host path; text receipts alone cannot establish either cause.
    ...(context?.checkout
      ? {
          checkoutStage: context.checkout.stage,
          invoiceDraftReady: context.checkout.invoiceDraftReady ?? null,
          invoiceConfirmationOffered: Array.isArray(body.tools) && body.tools.some(tool => ['checkout_confirm_invoice', 'checkout_confirm_tax_id'].includes(tool?.function?.name)),
        }
      : {}),
    ...(context?.taskId ? { taskId: context.taskId } : {}),
  }
}

// Usage is provider-reported. Missing usage is deliberately not estimated from bytes.
function promptTokens(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object' || !('usage' in payload))
    return undefined
  const usage = payload.usage
  if (!usage || typeof usage !== 'object' || !('prompt_tokens' in usage))
    return undefined
  const tokens = usage.prompt_tokens
  return typeof tokens === 'number' && Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : undefined
}

async function recordRoundMetrics(kioskService: KioskService, deviceId: string, visitorSessionId: string, answer: KioskCompletion) {
  if (!answer.metrics)
    return
  await kioskService.appendDeviceInteraction({
    deviceId,
    visitorSessionId,
    kind: 'service_event',
    content: JSON.stringify({ kind: 'main_round_metrics', ...answer.metrics }),
    metadata: { source: 'main_round_metrics' },
  })
}

async function parseAssistantReply(response: Response): Promise<KioskCompletion> {
  if (!response.ok)
    throw createBadRequestError('LLM Provider did not return a successful response', 'LLM_PROVIDER_ERROR')

  const payload: unknown = await response.json()
  if (!isChatCompletion(payload))
    throw createBadRequestError('LLM Provider response is invalid', 'LLM_PROVIDER_INVALID_RESPONSE')
  return {
    inputTokens: promptTokens(payload),
    content: payload.choices[0].message.content || undefined,
    toolCalls: payload.choices[0].message.tool_calls ?? [],
  }
}

async function completeKioskReply(input: {
  actionPrompt?: string
  agentInteraction?: KioskAgentInteractionState
  abortSignal?: AbortSignal
  content?: string
  decisionState?: KioskConversationDecisionState
  kioskService: KioskService
  llmGateway: KioskRoutesOptions['llmGateway']
  runtimeModelPolicy: KioskRoutesOptions['runtimeModelPolicy']
  modelCapability?: 'llm' | 'vision'
  profile: { siteId: string, snapshot: KioskProfileSnapshot }
  sceneFrame?: string
  transcript: Awaited<ReturnType<KioskService['getVisitorSessionForDevice']>>
  toolResults?: Array<{ content: string, name: string, toolCallId: string }>
  tools?: Array<{ function: { description?: string, name: string, parameters: unknown }, type: 'function' }>
}): Promise<KioskCompletion> {
  const clarification = queryClarification(input.toolResults ?? [])
  if (clarification)
    return { content: clarification, toolCalls: [] }
  const modelName = input.modelCapability === 'vision'
    ? await resolveKioskVisionModel(input.runtimeModelPolicy)
    : await input.runtimeModelPolicy.modelFor('chat')
  if (!modelName)
    throw createBadRequestError('Kiosk 系統尚未設定對話模型。', 'KIOSK_CHAT_POLICY_NOT_CONFIGURED')
  const systemInstructions = createKioskSystemInstructions(input)
  const catalogItemIds = input.decisionState?.context?.catalog ? new Set(input.decisionState.context.catalog.items.map(item => item.id)) : undefined
  const body = {
    model: modelName,
    messages: [
      { role: 'system', content: systemInstructions },
      ...toConversationMessages(input.transcript.entries, input.toolResults?.map(result => result.toolCallId), conversationScope(input.decisionState), Boolean(input.content), catalogItemIds),
      ...(input.toolResults ?? []).map(toolResult => ({
        role: 'tool',
        content: compactToolResultForModel(toolResult.name, toolResult.content, catalogItemIds),
        tool_call_id: toolResult.toolCallId,
      })),
      ...(input.content ? [{ role: 'user', content: input.content }] : []),
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
    ...replyToolPolicy(input),
  }
  const sizes = inputMetrics(body, input.decisionState?.context)
  const startedAt = performance.now()
  const response = await input.llmGateway.complete({ abortSignal: input.abortSignal, modelName, body })
  const answer = await finishConversationReply({ ...input, signal: input.abortSignal, tools: input.tools ?? [], toolResults: input.toolResults ?? [] }, await parseAssistantReply(response), modelName, async (instruction, atomicReplacement) => parseAssistantReply(await input.llmGateway.complete({
    abortSignal: input.abortSignal,
    modelName,
    body: { ...body, ...(atomicReplacement ? { tools: replacementTools('tools' in body ? body.tools : undefined, input.decisionState?.context) } : {}), stream: false, tool_choice: 'required', messages: body.messages.map((message, index) => index === 0 ? { role: 'system', content: `${systemInstructions}\n${instruction ?? completionReviewInstruction}` } : message) },
  })))
  return { ...answer, metrics: { ...sizes, replyRepairRequests: answer.replyRepairRequests ?? 0, operationReviewRequests: answer.operationReviewRequests ?? 0, durationMs: performance.now() - startedAt, ...(answer.inputTokens !== undefined ? { inputTokens: answer.inputTokens } : {}) } }
}

type KioskReplyEvent
  = | { type: 'turn-started' }
    | { text: string, type: 'assistant-delta' }
    | { toolCall: KioskToolCall, type: 'tool-requested' }
    | { agentMode: KioskAgentInteractionMode, answer?: string, reply?: ContextReply, toolCalls: KioskToolCall[], type: 'turn-finished' }
    | { message: string, reason: KioskReplyFailureReason, type: 'turn-failed' }

interface KioskReplyStreamInput {
  agentInteraction: KioskAgentInteractionState
  content?: string
  decisionState?: KioskConversationDecisionState
  deviceId: string
  kioskService: KioskService
  llmGateway: KioskRoutesOptions['llmGateway']
  profile: { siteId: string, snapshot: KioskProfileSnapshot }
  runtimeModelPolicy: KioskRoutesOptions['runtimeModelPolicy']
  signal: AbortSignal
  toolResults: Array<{ content: string, name: string, toolCallId: string }>
  toolTraceObserver?: KioskRoutesOptions['toolTraceObserver']
  tools: Array<{ function: { description?: string, name: string, parameters: unknown }, type: 'function' }>
  transcript: Awaited<ReturnType<KioskService['getVisitorSessionForDevice']>>
}

/**
 * Streams only customer-safe progress to the kiosk while retaining the model
 * credentials and authoritative transcript on the Server. Provider-specific
 * SSE never crosses this seam; the browser receives this stable event shape.
 */
function createKioskReplyEventStream(input: KioskReplyStreamInput) {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: KioskReplyEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        emit({ type: 'turn-started' })
        const answer = await streamKioskReply(input, (text) => {
          // Draft prose can contain false success claims. Context-owned turns
          // paint progress only; the Host renders their verified final outcome.
          if (!input.decisionState?.context)
            emit({ text, type: 'assistant-delta' })
        })
        await recordRoundMetrics(input.kioskService, input.deviceId, input.transcript.session.id, answer)

        if (answer.toolCalls.length > 0) {
          input.toolTraceObserver?.record({
            phase: 'llm-requests',
            toolNames: answer.toolCalls.map(toolCall => toolCall.function.name),
            visitorSessionId: input.transcript.session.id,
          })
        }

        if (answer.content) {
          await input.kioskService.appendDeviceInteraction({
            content: answer.content,
            kind: 'service_event',
            deviceId: input.deviceId,
            visitorSessionId: input.transcript.session.id,
          })
        }
        if (answer.toolCalls.length > 0) {
          await input.kioskService.appendDeviceInteraction({
            content: JSON.stringify(answer.toolCalls),
            kind: 'tool_call',
            metadata: { toolCalls: answer.toolCalls },
            deviceId: input.deviceId,
            visitorSessionId: input.transcript.session.id,
          })
        }

        const agentInteraction = recordAssistantActions(input.agentInteraction, answer.toolCalls)
        if (agentInteraction !== input.agentInteraction) {
          await input.kioskService.updateDeviceAgentInteraction({
            deviceId: input.deviceId,
            interaction: agentInteraction,
            visitorSessionId: input.transcript.session.id,
          })
        }
        if (agentInteraction.mode !== 'active') {
          await input.kioskService.appendDeviceInteraction({
            content: agentInteraction.mode === 'decision_guidance' ? 'agent.decision_guidance' : 'agent.touch_preferred',
            deviceId: input.deviceId,
            kind: 'service_event',
            metadata: { mode: agentInteraction.mode, noProgressCount: agentInteraction.noProgressCount },
            visitorSessionId: input.transcript.session.id,
          })
        }

        for (const toolCall of answer.toolCalls)
          emit({ toolCall, type: 'tool-requested' })
        emit({ agentMode: agentInteraction.mode, answer: answer.content, ...(answer.reply ? { reply: answer.reply } : {}), toolCalls: answer.toolCalls, type: 'turn-finished' })
      }
      catch (error) {
        if (!input.signal.aborted) {
          const reason = error instanceof ApiError && error.statusCode === 504 ? 'timeout' : 'provider-error'
          emit({ message: '點餐助手暫時無法回覆。', reason, type: 'turn-failed' })
        }
      }
      finally {
        controller.close()
      }
    },
  })
}

/** Converts an OpenAI-compatible provider SSE response into the kiosk event contract. */
async function streamKioskReply(input: KioskReplyStreamInput, onTextDelta: (text: string) => void): Promise<KioskCompletion> {
  const clarification = queryClarification(input.toolResults)
  if (clarification) {
    onTextDelta(clarification)
    return { content: clarification, toolCalls: [] }
  }
  const modelName = await input.runtimeModelPolicy.modelFor('chat')
  if (!modelName)
    throw createBadRequestError('Kiosk 系統尚未設定對話模型。', 'KIOSK_CHAT_POLICY_NOT_CONFIGURED')

  const catalogItemIds = input.decisionState?.context?.catalog ? new Set(input.decisionState.context.catalog.items.map(item => item.id)) : undefined
  const systemInstructions = createKioskSystemInstructions(input)
  const body = {
    model: modelName,
    messages: [
      { role: 'system', content: systemInstructions },
      ...toConversationMessages(input.transcript.entries, input.toolResults.map(result => result.toolCallId), conversationScope(input.decisionState), Boolean(input.content), catalogItemIds),
      ...input.toolResults.map(toolResult => ({
        role: 'tool',
        content: compactToolResultForModel(toolResult.name, toolResult.content, catalogItemIds),
        tool_call_id: toolResult.toolCallId,
      })),
      ...(input.content ? [{ role: 'user', content: input.content }] : []),
    ],
    ...replyToolPolicy(input),
    stream: true,
  }
  const sizes = inputMetrics(body, input.decisionState?.context)
  const startedAt = performance.now()
  let firstOutputMs: number | undefined
  const response = await input.llmGateway.complete({ abortSignal: input.signal, modelName, body })
  const answer = await finishConversationReply(input, await parseKioskReplyStream(response, onTextDelta, () => {
    firstOutputMs ??= performance.now() - startedAt
  }), modelName, async (instruction, atomicReplacement) => parseAssistantReply(await input.llmGateway.complete({
    abortSignal: input.signal,
    modelName,
    body: { ...body, ...(atomicReplacement ? { tools: replacementTools('tools' in body ? body.tools : undefined, input.decisionState?.context) } : {}), stream: false, tool_choice: 'required', messages: body.messages.map((message, index) => index === 0 ? { role: 'system', content: `${systemInstructions}\n${instruction ?? completionReviewInstruction}` } : message) },
  })))
  return { ...answer, metrics: { ...sizes, replyRepairRequests: answer.replyRepairRequests ?? 0, operationReviewRequests: answer.operationReviewRequests ?? 0, durationMs: performance.now() - startedAt, ...(firstOutputMs !== undefined ? { firstOutputMs } : {}), ...(answer.inputTokens !== undefined ? { inputTokens: answer.inputTokens } : {}) } }
}

/** Consumes only the Server reply tool; browser effects still use their own receipts. */
async function finishConversationReply(
  input: Pick<KioskReplyStreamInput, 'content' | 'decisionState' | 'toolResults' | 'tools' | 'llmGateway' | 'kioskService' | 'transcript'> & { signal?: AbortSignal },
  answer: KioskCompletion,
  modelName: string,
  review: (instruction?: string, atomicReplacement?: boolean) => Promise<KioskCompletion>,
): Promise<KioskCompletion> {
  const context = input.decisionState?.context
  if (!context)
    return answer
  const reads = new Set(['kiosk_session_history', 'menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get', 'seating_get'])
  // A bounded review precedes execution when a read proposal invents a category
  // equivalence or requests an unchanged update. Both are semantic ambiguities,
  // not permission for the program to guess a different query action.
  let queryReview: string | undefined
  let inferredCategory: string | undefined
  if (context.taskId && context.sourceUtterance) {
    for (const call of answer.toolCalls) {
      if (call.function.name !== 'menu_recommend' || !context.allowedToolNames.includes(call.function.name))
        continue
      try {
        const args = JSON.parse(call.function.arguments)
        const categoryNeedsReview = typeof args.category === 'string' && !context.sourceUtterance.includes(args.category)
        if (categoryNeedsReview)
          inferredCategory = args.category
        const saved = context.queryState && { category: context.queryState.category, ...context.queryState.prices, ...context.queryState.filters }
        const unchangedUpdate = args.action === 'update' && saved && Object.entries(args).every(([key, value]) => key === 'action' || key === 'limit' || (key in saved && JSON.stringify(value) === JSON.stringify(saved[key as keyof typeof saved])))
        const withdrawnPreference = Array.isArray(args.clear) && args.clear.includes('includeIngredients') && Boolean(context.queryState?.filters.includeIngredients.length)
        if (withdrawnPreference)
          queryReview = `這個查詢提案尚未執行：${JSON.stringify(args)}。核對完整sourceUtterance，不能只撤回舊include而遺漏新的排除。「不想吃某食材」須excludeIngredients排除該食材並clear衝突include；只有「不限定」才只clear。沿用現有queryState保留其他限制，重新產生符合完整原句的唯讀查詢。不能宣稱已執行。`
        if (categoryNeedsReview || unchangedUpdate)
          queryReview = `這個查詢提案尚未執行：${JSON.stringify(args)}。請獨立核對本句${JSON.stringify(context.sourceUtterance)}與完整菜單及queryState。${categoryNeedsReview ? '提案使用的分類不在顧客原句；分類相近不代表結果符合，務必核對餐點本身是否屬於顧客所問種類。沒有符合的種類時，保留原詞用menu_get query查證或釐清，不能以最近的分類代替。' : ''}${unchangedUpdate ? '提案update沒有變更任何保存條件。顧客要求其他時必須continue，已耗盡也用continue回報無更多；若只是重看原結果才保留update，不把重提分類當新條件。' : ''}只產生正確的本輪唯讀工具，不宣稱已執行。`
      }
      catch {
        // Malformed arguments remain the owned input validator's responsibility.
      }
    }
  }
  const queryReviewed = input.transcript.entries.some(entry => entry.kind === 'service_event' && entry.metadata?.source === 'main_query_review' && entry.metadata.taskId === context.taskId)
  if (queryReview && !queryReviewed) {
    await input.kioskService.appendDeviceInteraction({ deviceId: input.transcript.session.deviceId, visitorSessionId: input.transcript.session.id, kind: 'service_event', content: 'agent.query_review', metadata: { source: 'main_query_review', taskId: context.taskId } })
    if (inferredCategory) {
      const response = await input.llmGateway.complete({ modelName, abortSignal: input.signal, body: { temperature: 0, messages: [
        { role: 'system', content: '只判斷提出的餐點是否符合顧客實際詢問的食物種類。FIT須有品名／描述的明確依據；分類字義接近或同屬食物不足以證明符合。UNCONFIRMED表示不符合、沒有依據或無法確認。只呼叫verify_menu_kind，不推薦或操作。' },
        { role: 'user', content: JSON.stringify({ customerUtterance: context.sourceUtterance, proposedCategory: inferredCategory, proposedItems: context.catalog?.items.filter(item => item.category === inferredCategory).map(item => ({ name: item.name, description: item.description })) ?? [] }) },
      ], tools: [{ type: 'function', function: { name: 'verify_menu_kind', parameters: { type: 'object', properties: { choice: { type: 'string', enum: ['FIT', 'UNCONFIRMED'] } }, required: ['choice'], additionalProperties: false } } }], tool_choice: 'required' } })
      const verification = await parseAssistantReply(response)
      const call = verification.toolCalls.length === 1 ? verification.toolCalls[0] : undefined
      let fits = false
      try {
        const selected = call?.function.name === 'verify_menu_kind' ? safeParse(object({ choice: picklist(['FIT', 'UNCONFIRMED']) }), JSON.parse(call.function.arguments)) : undefined
        fits = response.ok && selected?.success === true && selected.output.choice === 'FIT'
      }
      catch {
        // A malformed review cannot establish that an inferred category fits.
      }
      if (!fits)
        answer = { toolCalls: [{ id: crypto.randomUUID(), type: 'function', function: { name: replyTool.function.name, arguments: '{"kind":"clarification","topic":"menu-kind"}' } }] }
    }
    else {
      answer = await review(queryReview)
      // Reviewing a read proposal cannot introduce a new mutation. Any later
      // order effect still belongs to the ordinary whole-request tool loop.
      if (answer.toolCalls.some(call => !reads.has(call.function.name) && call.function.name !== replyTool.function.name))
        answer = { toolCalls: [{ id: crypto.randomUUID(), type: 'function', function: { name: replyTool.function.name, arguments: '{"kind":"clarification"}' } }] }
    }
  }
  let clarificationRequested = false
  if (answer.toolCalls.length === 1 && answer.toolCalls[0]!.function.name === replyTool.function.name) {
    try {
      const selected = safeParse(contextReplySchema, JSON.parse(answer.toolCalls[0]!.function.arguments))
      clarificationRequested = selected.success && (['clarification', 'quantity-limit'].includes(selected.output.kind) || isServiceLimitationReply(selected.output))
    }
    catch {
      // Malformed selectors still use the bounded reply repair below.
    }
  }
  // Only the latest customer task may be resumed. A previous customer's effect
  // must neither suppress this review nor be repeated as part of this request.
  const { entries: taskEntries, results: taskReadReceipts } = taskReceipts(input)
  // Selection/configuration only prepares a draft. It is not a cart write and
  // must not suppress the single completion review for an unexecuted purchase.
  const preparation = new Set(['menu_select_item', 'menu_set_item_option', 'menu_set_quantity'])
  const effectAttempted = input.toolResults.some(result => !reads.has(result.name) && !preparation.has(result.name)) || taskEntries.some(entry => entry.kind === 'tool_result' && typeof entry.metadata?.name === 'string' && !reads.has(entry.metadata.name) && !preparation.has(entry.metadata.name))
  const reviewed = input.transcript.entries.some(entry => entry.kind === 'service_event' && entry.metadata?.source === 'main_completion_review' && entry.metadata.taskId === context.taskId)
  const hasOperations = input.tools.some(tool => context.allowedToolNames.includes(tool.function.name) && !reads.has(tool.function.name) && !['customer_skip_phone', 'order_ask_question'].includes(tool.function.name))
  let completionReviewed = false
  // A read-only semantic handoff can also draft a recommendation without
  // presenting it. Review with its original read tools before the reply-only
  // selector removes that capability; the same task marker bounds both paths.
  const cartReadCompleted = !input.decisionState?.requireMenuRead && input.toolResults.some(result => result.name === 'cart_get')
  const unpresentedRead = input.decisionState?.requireMenuRead === true && context.readOnly && !cartReadCompleted && !answer.toolCalls.some(call => call.function.name !== replyTool.function.name) && !hasMenuReply(input.toolResults) && input.tools.some(tool => context.allowedToolNames.includes(tool.function.name) && ['menu_get', 'menu_recommend'].includes(tool.function.name))
  const unfinishedOperation = !context.readOnly && !input.decisionState?.readOnly && hasOperations
  // Invoice entry has the same unexecuted-operation risk as ordering: prose
  // repair removes browser tools, so review first while the valid draft's
  // confirmation remains available. Main still decides whether this utterance
  // confirms, declines, edits or asks; readiness never authorizes submission.
  const invoiceConfirmationAvailable = context.checkout?.invoiceDraftReady === true
    && ((context.phase === 'checkout_invoice' && context.allowedToolNames.includes('checkout_confirm_invoice'))
      || (context.phase === 'checkout_tax_id' && context.allowedToolNames.includes('checkout_confirm_tax_id')))
  // An independently qualified operation gets one completion check even when
  // Main prematurely calls it unclear. A real ambiguity may remain unclear;
  // the task marker prevents another attempt on later continuations.
  if (context.taskId && (context.phase === 'ordering' || context.phase === 'pending_confirmation' || context.allowedToolNames.includes('checkout_cancel') || invoiceConfirmationAvailable) && (unfinishedOperation || unpresentedRead) && !effectAttempted && !reviewed && (!clarificationRequested || (input.decisionState?.requestScope === 'order-operation' && unfinishedOperation)) && !answer.toolCalls.some(call => call.function.name !== replyTool.function.name)) {
    // Reserve the one review before the provider call. Later continuations of
    // this task cannot spend another review or restart an attempted operation.
    await input.kioskService.appendDeviceInteraction({ deviceId: input.transcript.session.deviceId, visitorSessionId: input.transcript.session.id, kind: 'service_event', content: 'agent.completion_review', metadata: { source: 'main_completion_review', taskId: context.taskId } })
    answer = await review()
    completionReviewed = true
  }
  let operationReviewRequests = 0
  let operationRepaired = false
  let operations = answer.toolCalls.filter(call => call.function.name !== replyTool.function.name)
  let preservedOperations: ConversationToolCall[] | undefined
  // A service-only response cannot acquire browser effects even if a provider
  // ignores the offered reply-only schema. Live-question proposals and cart
  // display/clear requests need consent review; ordinary item turns do not.
  if (operations.length && (input.decisionState?.serviceReply || input.decisionState?.replyOnly))
    return { ...answer, content: undefined, toolCalls: [], reply: { kind: 'clarification' }, operationReviewRequests }
  const changesCartScreen = operations.some((call) => {
    if (call.function.name === 'cart_clear')
      return true
    if (call.function.name !== 'cart_get')
      return false
    try {
      return JSON.parse(call.function.arguments).display !== false
    }
    catch {
      // The Menu input validator rejects malformed arguments.
      return false
    }
  })
  // The whole-turn qualifier already authorized this read-only review. A
  // second mutation-consent review mistook implicit ordering completion for
  // no authority to look at the cart. Reuse only that narrow read proof;
  // every write/confirmation and unqualified display still gets reviewed.
  const qualifiedCartReview = input.decisionState?.requestScope === 'order-information' && input.decisionState.readOnly === true
    && operations.length === 1 && operations[0]?.function.name === 'cart_get' && context.allowedToolNames.includes('cart_get')
  if (operations.length && !qualifiedCartReview && (context.waitingFor || changesCartScreen || operations.some(call => call.function.name === 'order_answer_confirmation'))) {
    const verify = async () => reviewOperations({ context, calls: operations, complete: (body) => {
      operationReviewRequests++
      return input.llmGateway.complete({ modelName, body: { ...body, model: modelName }, abortSignal: input.signal })
    } }).then(async (supported) => {
      if (!supported)
        return false
      // The quantity/target verifier can identify replacement intent even when
      // the general reviewer accepted only its removal step. Repair before any
      // browser effect, and reuse the checked calls rather than reviewing twice.
      preservedOperations = await preserveRequestedQuantities(context, operations, body => input.llmGateway.complete({ modelName, body: { ...body, model: modelName }, abortSignal: input.signal }))
      return preservedOperations !== undefined
    })
    let supported = await verify()
    // A qualified change-of-mind may be split into a destructive first step.
    // Nothing has executed. Permit one fresh atomic proposal for this task,
    // then independently verify it; never repair assent or cart-clear proposals.
    const repaired = input.transcript.entries.some(entry => entry.kind === 'service_event' && entry.metadata?.source === 'main_operation_repair' && entry.metadata.taskId === context.taskId)
    if (!supported && context.taskId && !repaired && input.decisionState?.requestScope === 'order-operation' && operations.some(call => call.function.name === 'cart_remove_item') && !operations.some(call => ['cart_clear', 'order_answer_confirmation', 'checkout_start'].includes(call.function.name))) {
      await input.kioskService.appendDeviceInteraction({ deviceId: input.transcript.session.deviceId, visitorSessionId: input.transcript.session.id, kind: 'service_event', content: 'agent.operation_repair', metadata: { source: 'main_operation_repair', taskId: context.taskId } })
      answer = await review('前一個工具提案未執行，獨立授權核對不通過。重新核對完整sourceUtterance及cart：若顧客要求換餐，必須以order_add_item(itemId,quantity,replaceLineId)原子替換，不能先cart_remove_item；若無法確定就respond_to_customer clarification。不要宣稱已執行，不增加顧客未要求的效果。', true)
      operationRepaired = true
      operations = answer.toolCalls.filter(call => call.function.name !== replyTool.function.name)
      supported = operations.length > 0 && await verify()
    }
    if (!supported)
      return { ...answer, content: undefined, toolCalls: [], reply: { kind: 'clarification' }, operationReviewRequests, replyRepairRequests: Number(operationRepaired) }
  }
  const proposedBrowserCalls = answer.toolCalls.filter(call => call.function.name !== replyTool.function.name)
  const browserCalls = preservedOperations ?? await preserveRequestedQuantities(context, proposedBrowserCalls, body => input.llmGateway.complete({ modelName, body: { ...body, model: modelName }, abortSignal: input.signal }))
  if (!browserCalls)
    return { toolCalls: [], reply: { kind: 'clarification' }, operationReviewRequests, replyRepairRequests: Number(operationRepaired) + Number(completionReviewed) }
  // A completed read review may be followed by a real presentation receipt.
  // Preserve that receipt for the Host instead of turning the task marker into
  // a synthetic clarification. Mutable tasks still require their effect review.
  // A named lookup does not complete a requested purchase. A rendered browse
  // presentation may survive later evidence reads in this same task, while an
  // unexecuted mutable demand still receives the bounded clarification below.
  const browsePresented = hasMenuReply(taskReadReceipts.filter(result => ['menu_recommend', 'menu_show_recommendations'].includes(result.name)))
  const presentedRead = browsePresented || (context.readOnly && hasMenuReply(taskReadReceipts))
  // Accepted Menu facts are customer-visible receipts. A generic Main
  // clarification cannot erase them or create a new service-question gate.
  const completedReceipt = input.toolResults.some((result) => {
    if (result.name === 'kiosk_session_history')
      return false
    try {
      const payload = JSON.parse(result.content)
      if (payload && typeof payload === 'object' && payload.executed === false)
        return false
    }
    catch {
      // An unparseable operation receipt retains its existing outcome policy;
      // it cannot establish that a write was safely left unexecuted.
    }
    // Cart evidence alone cannot complete a mutable, unbound order request.
    // Actual effects still use receipts; pure information reads retain theirs.
    return context.readOnly || (!reads.has(result.name) && !preparation.has(result.name))
  })
  if (browserCalls.length || presentedRead || (!clarificationRequested && !completionReviewed && !reviewed && completedReceipt))
    return { ...answer, toolCalls: browserCalls, replyRepairRequests: Number(operationRepaired) + Number(completionReviewed), operationReviewRequests }
  const selected = await selectReply({ repair: !completionReviewed && !reviewed, answer: answer.content, calls: answer.toolCalls, context, requireMenuRead: input.decisionState?.requireMenuRead === true && (input.decisionState.readOnly === true || !context.catalog?.complete), complete: body => input.llmGateway.complete({ modelName, body: { ...body, model: modelName }, abortSignal: input.signal }) })
  if (selected.reply.kind === 'staff-assistance' && selected.reply.action === 'accept' && context.staffAssistance) {
    const supported = await reviewOperations({ context: { ...context, waitingFor: { ...context.staffAssistance, purpose: 'operation-confirmation', question: '需要幫您呼叫工作人員嗎？', choices: [{ id: 'staff-assistance:accept', description: '僅顯示模擬工作人員協助提示，不修改訂單' }] } }, calls: [{ id: 'staff-assistance', type: 'function', function: { name: 'staff_assistance', arguments: '{"accepted":true}' } }], complete: (body) => {
      operationReviewRequests++
      return input.llmGateway.complete({ modelName, body: { ...body, model: modelName }, abortSignal: input.signal })
    } })
    if (!supported)
      return { ...answer, content: undefined, toolCalls: [], reply: { kind: 'clarification' }, operationReviewRequests }
  }
  return { ...answer, toolCalls: [], reply: selected.reply, operationReviewRequests, replyRepairRequests: Number(operationRepaired) + Number(completionReviewed) + Number(selected.repaired) }
}

// A rejected destructive first step may be replanned only as an atomic
// replacement. Narrow this model request, without altering Menu discovery or
// inferring consent; the ordinary target/quantity verifier still checks it.
function replacementTools(tools: Parameters<typeof completeKioskReply>[0]['tools'], context?: ConversationContext) {
  const lineIds = context?.cart.lines.map(line => line.id) ?? []
  const allowed = new Set(['order_add_item', 'menu_get', 'cart_get', 'seating_get', 'kiosk_session_history', replyTool.function.name])
  return tools?.filter(tool => allowed.has(tool.function.name) && (lineIds.length || tool.function.name !== 'order_add_item')).map((tool) => {
    if (tool.function.name !== 'order_add_item')
      return tool
    const parameters = tool.function.parameters
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters))
      return tool
    const properties = 'properties' in parameters && parameters.properties && typeof parameters.properties === 'object' ? parameters.properties : {}
    const required = 'required' in parameters && Array.isArray(parameters.required) ? parameters.required.filter((key): key is string => typeof key === 'string') : []
    return { ...tool, function: { ...tool.function, parameters: { ...parameters, properties: { ...properties, replaceLineId: { type: 'string', enum: lineIds, description: '既有餐點的原子替換目標；不能先刪再加。' } }, required: [...new Set([...required, 'replaceLineId'])] } } }
  })
}

// Saved receipts belong to the current visitor's latest user_text. A new
// content starts a task; continuations retain its receipts, with the incoming
// batch last so older model history cannot replace the newest Menu evidence.
function taskReceipts(input: Pick<Parameters<typeof completeKioskReply>[0], 'content' | 'transcript' | 'toolResults'>) {
  const entries = input.content ? [] : input.transcript.entries.slice(input.transcript.entries.findLastIndex(entry => entry.kind === 'user_text') + 1)
  const results = [...entries.flatMap(entry => entry.kind === 'tool_result' && typeof entry.metadata?.name === 'string' ? [{ name: entry.metadata.name, content: entry.content }] : []), ...input.toolResults ?? []]
  return { entries, results }
}

// A semantic food handoff must obtain a fresh read before any generated
// final answer or order change. Internal catalog reads do not finish presentation.
function replyToolPolicy(input: Pick<Parameters<typeof completeKioskReply>[0], 'tools' | 'toolResults' | 'decisionState' | 'content' | 'transcript'>) {
  // Read-only tool selection favors repeatable semantic decisions over prose variation.
  const generation = input.decisionState?.readOnly ? { temperature: 0 } : {}
  if (input.decisionState?.requestScope === 'service-information') {
    // Scope qualification established unrelated speech, not an answer to the
    // live order question. The typed service boundary must survive Main too.
    return { ...generation, tools: [{ ...replyTool, function: { ...replyTool.function, parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['service-information'] }, topic: { type: 'string', enum: ['out-of-scope'] } }, required: ['kind', 'topic'], additionalProperties: false } } }], tool_choice: 'required' }
  }
  // Phone entry allows service explanations, not menu reads or commerce.
  // Explicit skip is owned by the finite phone resolver/browser candidate.
  if (input.decisionState?.phase === 'customer_entry') {
    const history = [...(input.tools?.filter(tool => tool.function.name === 'kiosk_session_history') ?? []), ...(input.decisionState.context ? [replyTool] : [])]
    return history?.length ? { ...generation, tools: history } : generation
  }
  // Qualification already established a non-menu service response. Offering
  // browsing tools here lets a pause turn into an unrelated menu clarification.
  // Keep the same typed reply boundary used for factual service information.
  if ((input.decisionState?.serviceReply || input.decisionState?.replyOnly) && !input.decisionState.requireMenuRead && input.decisionState.context)
    return { ...generation, tools: [replyTool], tool_choice: 'required' as const }
  // A qualified inquiry stays read-only across every continuation. A fresh
  // customer request creates a new task; a menu receipt cannot grant writes.
  // Phone skip is exclusively owned by the finite phone resolver/browser
  // candidate. Keep it out of Main even when a continuation omits phase: an
  // old phone reminder must not prompt an INVALID_PHASE write before lookup.
  const currentTools = input.decisionState?.context?.allowedToolNames
  const receipts = taskReceipts(input).results
  const menuEvidence = receipts.filter(result => result.name === 'menu_get').flatMap((result) => {
    try {
      const parsed = safeParse(object({ dataOnly: optional(boolean()), possibleItems: optional(array(object({ id: string() }))), requestedQueries: optional(array(string())), customerReply: optional(customerReplySchema) }), JSON.parse(result.content))
      return parsed.success ? [parsed.output] : []
    }
    catch {
      // Malformed tool content cannot supply candidate IDs or claim a price answer.
      return []
    }
  })
  const proposalIds = menuEvidence.flatMap(result => result.possibleItems?.map(item => item.id) ?? [])
  const agentTools = input.tools?.filter(tool => !['customer_skip_phone', 'order_ask_question'].includes(tool.function.name) && (!currentTools || currentTools.includes(tool.function.name) || tool.function.name === 'kiosk_session_history')).map((tool) => {
    const unavailablePreparation = input.decisionState?.context?.unavailableConditions?.some(condition => ['spice', 'preparation'].includes(condition.id))
    const parameters = tool.function.parameters
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters))
      return tool
    const properties = 'properties' in parameters ? parameters.properties : undefined
    if (tool.function.name !== 'menu_confirm_item' || !properties || typeof properties !== 'object' || Array.isArray(properties))
      return tool
    // This narrows only the model request. Menu discovery and toolsRevision
    // stay stable across BEGIN/END, so an ordinary fuzzy proposal is not stale.
    return { ...tool, function: { ...tool.function, parameters: { ...parameters, properties: { ...properties, ...(!unavailablePreparation ? { originalRecipe: { type: 'boolean', enum: [false], description: '本輪沒有未支援製作要求，只能省略或填false；模糊品名不屬於原做法確認。' } } : {}), ...(proposalIds.length ? { itemId: { type: 'string', enum: [...new Set(proposalIds)], description: '只能使用本輪Menu回執中的模糊候選，不可另選其他餐點。' } } : {}) } } } }
  })
  const scopedTools = input.decisionState?.readOnly
    ? agentTools?.filter(tool => ['menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get', 'seating_get', 'order_ask_question'].includes(tool.function.name))
    : agentTools
  if (input.decisionState?.requestScope === 'order-information' && !receipts.some(result => result.name === 'cart_get')) {
    const cartTool = scopedTools?.find(tool => tool.function.name === 'cart_get')
    if (cartTool) {
      // The qualified scope authorizes a review, never checkout/clear. Let
      // Menu own the displayed cart and its version-bound next question.
      return { ...generation, tools: [{ ...cartTool, function: { ...cartTool.function, parameters: { type: 'object', properties: { display: { type: 'boolean', enum: [true] } }, required: ['display'], additionalProperties: false } } }], tool_choice: { type: 'function', function: { name: 'cart_get' } } }
    }
  }
  // A verified fuzzy purchase can only propose one of Menu's alternatives.
  // Require the proposal tool on this continuation so its enum/boolean schema
  // is applied; it creates a question, never a purchase or the customer's assent.
  const needsProposal = proposalIds.length && input.decisionState?.requestScope === 'order-operation' && !input.decisionState.readOnly && !input.decisionState.priceInquiry
    && !receipts.some(result => ['order_add_item', 'cart_add_item', 'cart_remove_item'].includes(result.name))
    && input.decisionState.context?.phase !== 'meal_confirmation' && !receipts.some(result => result.name === 'menu_confirm_item')
  if (needsProposal) {
    const proposalTool = scopedTools?.find(tool => tool.function.name === 'menu_confirm_item')
    if (proposalTool)
      return { ...generation, tools: [proposalTool], tool_choice: { type: 'function', function: { name: 'menu_confirm_item' } } }
  }
  // An accepted cart write cannot finish an independently qualified price
  // inquiry. Require its factual read, without re-offering a write or adding a
  // separate review-model request. A named absence/fuzzy read also settles
  // this boundary: asking the same missing-price lookup again would loop.
  const needsPriceRead = input.decisionState?.priceInquiry && input.decisionState.requestScope === 'order-operation'
    && receipts.some(result => ['order_add_item', 'cart_add_item', 'cart_remove_item', 'cart_set_line_quantity'].includes(result.name))
    && !menuEvidence.some(result => result.dataOnly !== true && Boolean(result.requestedQueries?.length || result.customerReply?.pricedItemIds?.length))
  if (needsPriceRead) {
    const priceTool = scopedTools?.find(tool => tool.function.name === 'menu_get')
    if (priceTool) {
      const candidateSchema = priceTool.function.parameters
      const schema = candidateSchema && typeof candidateSchema === 'object' && !Array.isArray(candidateSchema) ? candidateSchema : {}
      const properties = schema && typeof schema === 'object' && 'properties' in schema && schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
      const required = schema && typeof schema === 'object' && 'required' in schema && Array.isArray(schema.required) ? schema.required : []
      return { ...generation, tools: [{ ...priceTool, function: { ...priceTool.function, parameters: { ...schema, properties: { ...properties, display: { type: 'boolean', enum: [true] } }, required: [...new Set([...required, 'display'])] } } }], tool_choice: { type: 'function', function: { name: 'menu_get' } } }
    }
  }
  const bulkOrder = input.decisionState?.context?.catalog?.complete && !input.decisionState.readOnly && input.decisionState.context.quantityPolicy?.mentionedCounts?.some(count => count > input.decisionState!.context!.quantityPolicy!.maximum)
  // An admitted order containing oversized counts needs count validation or a
  // policy refusal. A recommendation/price question cannot resolve that order.
  // After a receipt, normal completion presentation remains available.
  const preparationConfirmation = !input.decisionState?.readOnly && currentTools?.includes('menu_confirm_item') && !currentTools.includes('menu_recommend') && input.decisionState?.context?.unavailableConditions?.some(condition => ['spice', 'preparation'].includes(condition.id))
  const policyReply = bulkOrder && !input.toolResults?.length
    ? { ...replyTool, function: { ...replyTool.function, parameters: { ...replyTool.function.parameters, properties: { ...replyTool.function.parameters.properties, kind: { type: 'string', enum: ['quantity-limit', 'clarification'] } } } } }
    : preparationConfirmation
      ? { ...replyTool, function: { ...replyTool.function, parameters: { ...replyTool.function.parameters, properties: { ...replyTool.function.parameters.properties, kind: { type: 'string', enum: ['payment-methods', 'fulfillment-modes', 'menu-information', 'hearing-check', 'service-information'] } } } } }
      : replyTool
  const available = [...(scopedTools?.filter(tool => !bulkOrder || !['menu_recommend', 'menu_show_recommendations'].includes(tool.function.name)) ?? []), ...(input.decisionState?.context ? [policyReply] : [])]
  if ((bulkOrder && !input.toolResults?.length) || preparationConfirmation)
    return { ...generation, tools: available, tool_choice: 'required' as const }
  if (!input.decisionState?.readOnly && input.decisionState?.context?.phase === 'meal_confirmation' && currentTools?.includes('order_answer_confirmation')) {
    // A presented original-recipe proposal has a real lifecycle. Merely saying
    // "cancelled" or acknowledging consent cannot close it or add the meal.
    // Keep factual queries/clarification available without allowing an empty ack.
    const confirmationTools = available.map(tool => tool.function.name === replyTool.function.name
      ? { ...replyTool, function: { ...replyTool.function, parameters: { ...replyTool.function.parameters, properties: { ...replyTool.function.parameters.properties, kind: { type: 'string', enum: ['payment-methods', 'fulfillment-modes', 'menu-information', 'clarification', 'hearing-check', 'service-information'] } } } } }
      : tool)
    return { ...generation, tools: confirmationTools, tool_choice: 'required' as const }
  }

  // Read-only inquiries need a presented result, while operation tasks retain
  // their existing read-before-write contract and may continue to cart tools.
  const readCompleted = input.decisionState?.readOnly ? hasMenuReply(input.toolResults ?? []) : Boolean(input.toolResults?.length)
  if (!input.decisionState?.requireMenuRead || readCompleted || (input.decisionState.context?.catalog?.complete && !input.decisionState.readOnly))
    return available?.length ? { ...generation, tools: available } : generation
  // A qualified menu query already has a service purpose. A generic prose
  // clarification cannot satisfy it before a lookup; Menu can still ask its
  // owned scope question through menu_recommend(action:clarify).
  const readTools = input.decisionState.requestScope === 'menu-information' ? ['menu_get', 'menu_recommend'] : ['menu_get', 'menu_recommend', replyTool.function.name]
  const tools = available?.filter(tool => readTools.includes(tool.function.name)).map(tool => tool.function.name === replyTool.function.name ? readOnlyReplyTool : tool) ?? []
  if (!tools.length)
    throw createBadRequestError('目前無法查詢菜單。', 'KIOSK_MENU_LOOKUP_UNAVAILABLE')
  return { ...generation, tools, tool_choice: 'required' as const }
}

async function parseKioskReplyStream(response: Response, onTextDelta: (text: string) => void, onOutput: () => void): Promise<KioskCompletion> {
  if (!response.ok)
    throw createBadRequestError('LLM Provider did not return a stream', 'LLM_PROVIDER_ERROR')
  // Some OpenAI-compatible providers accept `stream: true` but still return a
  // normal completion. Preserve a usable reply instead of producing an empty
  // turn; only genuine SSE responses can provide progressive presentation.
  if (response.headers.get('Content-Type')?.includes('application/json'))
    return await parseAssistantReply(response)
  if (!response.body)
    throw createBadRequestError('LLM Provider stream has no body', 'LLM_PROVIDER_INVALID_RESPONSE')

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let buffer = ''
  let content = ''
  let receivedPayload = false
  let inputTokens: number | undefined
  const toolCalls: Array<Partial<KioskToolCall>> = []

  const consumeEvent = (rawEvent: string) => {
    const data = rawEvent.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
    if (!data || data === '[DONE]')
      return
    const parsed: unknown = JSON.parse(data)
    inputTokens = promptTokens(parsed) ?? inputTokens
    if (!parsed || typeof parsed !== 'object' || !('choices' in parsed) || !Array.isArray(parsed.choices))
      return
    receivedPayload = true
    const delta = parsed.choices[0]?.delta
    if (!delta || typeof delta !== 'object')
      return
    if (typeof delta.content === 'string') {
      if (delta.content)
        onOutput()
      content += delta.content
      onTextDelta(delta.content)
    }
    if (!Array.isArray(delta.tool_calls))
      return
    for (const partial of delta.tool_calls) {
      if (!partial || typeof partial !== 'object' || typeof partial.index !== 'number')
        continue
      onOutput()
      const existing = toolCalls[partial.index] ?? { function: { arguments: '', name: '' }, id: '', type: 'function' }
      const functionDelta = partial.function
      toolCalls[partial.index] = {
        ...existing,
        ...(typeof partial.id === 'string' ? { id: partial.id } : {}),
        ...(typeof partial.type === 'string' ? { type: partial.type } : {}),
        function: {
          arguments: `${existing.function?.arguments ?? ''}${functionDelta && typeof functionDelta === 'object' && typeof functionDelta.arguments === 'string' ? functionDelta.arguments : ''}`,
          name: `${existing.function?.name ?? ''}${functionDelta && typeof functionDelta === 'object' && typeof functionDelta.name === 'string' ? functionDelta.name : ''}`,
        },
      }
    }
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
  if (!receivedPayload)
    throw createBadRequestError('LLM Provider stream contained no completion events', 'LLM_PROVIDER_INVALID_RESPONSE')

  const completedToolCalls = toolCalls.filter((toolCall): toolCall is KioskToolCall => (
    typeof toolCall.id === 'string'
    && toolCall.type === 'function'
    && typeof toolCall.function?.name === 'string'
    && typeof toolCall.function.arguments === 'string'
  ))
  return { content: content || undefined, toolCalls: completedToolCalls, inputTokens }
}

/**
 * Creates the portable instruction envelope for Kiosk chat requests.
 *
 * Ollama and OpenAI-compatible servers commonly implement model chat
 * templates that only accept `system` at the beginning of a conversation.
 * Keep instructions in their original precedence order, but serialize them
 * into one leading message so the same request shape works across providers.
 */
function createKioskSystemInstructions(input: Pick<Parameters<typeof completeKioskReply>[0], 'actionPrompt' | 'agentInteraction' | 'decisionState' | 'profile'>) {
  const interaction = input.agentInteraction && input.decisionState?.context
    ? { ...input.agentInteraction, cartSummary: undefined, recentMenuSubjects: [], recentAgentAction: undefined }
    : input.agentInteraction
  let readAuthority: string | undefined
  if (input.decisionState?.readOnly) {
    if (!input.decisionState.requireMenuRead)
      readAuthority = '本輪可以理解原句、確認、釐清與必要的唯讀查詢。不得填寫或略過電話、變更訂單、進入結帳或消耗未確認的操作問題。先理解整句最後仍成立的需求；撤回點餐只需確認先不點，不因提到品名就查詢菜單。前一個判定或待確認提案不是顧客已同意的事實。'
    else
      readAuthority = '本輪僅授權查詢菜單資訊，不能新增、刪除、更換餐點、變更用餐方式、回答舊問題或進入結帳。有具體品名時依原名查證，不把其他相近餐點說成顧客問的品項；泛指或更正語句先理解指涉，不能直接當商品關鍵字。'
  }
  const fragment = input.decisionState?.incompleteSpeech
  let fragmentInstructions: string | undefined
  if (fragment) {
    if (fragment.related)
      fragmentInstructions = `本次需求承接的未完成顧客語句（與這一句是同一需求，保留兩段原文，不視為兩筆訂單）：${JSON.stringify(fragment.transcript)}`
    else
      fragmentInstructions = `先前未完成的顧客語句（與本句的關聯尚未確認，不能直接合併、補數量或視為另一筆訂單；先理解或釐清）：${JSON.stringify(fragment.transcript)}`
  }
  return [
    { content: createCharacterInstructions(input.profile.snapshot), title: '角色與店別設定' },
    input.decisionState?.serviceReply && !input.decisionState.requireMenuRead
      ? { content: '本輪已確認為非餐點操作的服務回應。只用respond_to_customer回答當句，不另查詢、推薦或改問價位／種類。依完整當句仍成立的目的選kind：只有暫緩或附和才選acknowledgement，保留草稿與待答問題；同句另有資訊問題必須回答該問題，例如確認收音選hearing-check、身分選service-information。不能因前半句拒絕操作就忽略後半句問題。', title: '已確認的服務回應範圍' }
      : undefined,
    interaction ? { content: createInteractionInstructions(interaction, conversationScope(input.decisionState)), title: '本次點餐互動規則' } : undefined,
    input.decisionState?.context ? { content: currentContextInstructions(input.decisionState.context, input.decisionState.requireMenuRead === true), title: '目前有效點餐情境' } : undefined,
    input.decisionState?.requestScope === 'order-operation' && input.decisionState.priceInquiry === true
      ? { title: '同句訂購與查價', content: '本輪同時包含操作與查價。完成加餐不是完成整句；分別處理顧客指定的操作及查價對象，不重複已成功操作。針對價格問題用menu_get查詢實際品名取得售價回執，不能只回acknowledgement或只問取餐方式，也不能把另一道的查價當成訂購。' }
      : undefined,
    input.decisionState && !input.decisionState.context
      ? {
          content: [
            `目前 Kiosk 畫面：${input.decisionState.phase}`,
            input.decisionState.phase === 'customer_entry' ? '目前是自願電話登記頁，不要求會員。顧客必須先觸控填寫有效手機，或明確說略過，才能開始任何菜單查詢、餐點介紹、推薦、選餐、購物車、結帳或付款操作。手機本身仍是選填，不可要求一定提供。詢問賣什麼、有沒有、價格、成分或要求點餐時，簡短回覆「請先填寫手機號碼，或說『略過』，就可以開始看菜單與點餐。」不呼叫任何菜單／訂單工具、不介紹具體餐點、不替顧客略過。仍可依店別設定回答店名、營業時間、付款方式、發票、點餐／取餐管道，以及電話用途、本機身分／能力；這些是服務說明，不變更畫面或訂單。同句撤回點餐後沒有剩餘操作，只需確認先不點，保留電話頁，不查菜單或要求完成已撤回的點餐。' : undefined,
            `本次已解析條件（不得省略或自行放寬）：${JSON.stringify(input.decisionState.constraints ?? { exclude: [] })}`,
            input.decisionState.requireMenuRead ? '本輪是餐點需求：先查菜單再回答。條件不變且尚有下一批時，換其他推薦使用 menu_recommend action:continue；原條件已無其他結果而新範圍不明時，使用 menu_recommend action:clarify 語音釐清，不必先查資料。顧客質疑先前品項不存在或是否真的有時，用 menu_get 的 query／queries 核對具體品名並指定 verifyClaim:true，不以換推薦或請顧客自行看畫面代替。確實介紹錯就明確承認、更正，依回傳品項回答。' : undefined,
            readAuthority,
            input.decisionState.priceEvidence ? '本句涉及價格。只使用已解析的單份基本售價條件；未解析時先詢問明確單份上限或範圍，不自行猜預算、分配總額或忽略價格。價格以工具真實售價顯示在畫面即可，不必口頭逐項唸價。' : undefined,
            `本次已完成的查詢（不要重複已完成操作）：${JSON.stringify(input.decisionState.completedReads ?? [])}`,
            fragmentInstructions,
            `本句提及但目前資料不能驗證的條件主題（提及不一定是要求；若確為要求，不可聲稱已符合）：${JSON.stringify(input.decisionState.unavailableConditionReferences ?? [])}`,
            `POS 目前提供的用餐方式（只能使用這些名稱）：${JSON.stringify(input.decisionState.fulfillmentModes ?? [])}`,
            `付款狀態：${input.decisionState.paymentState ?? 'unknown'}`,
            `目前可選付款方式：${input.decisionState.allowedPaymentMethods?.join('、') || '無'}`,
            input.decisionState.waitingFor && input.decisionState.waitingFor.expiresAt > Date.now() ? `目前真正等待顧客回答的操作問題與回答效果：${JSON.stringify(input.decisionState.waitingFor)}` : undefined,
            input.decisionState.interactionState?.screen ? `目前可見畫面：${input.decisionState.interactionState.screen}` : undefined,
            input.decisionState.interactionState?.selectedItemName ? `目前選取餐點：${input.decisionState.interactionState.selectedItemName}` : undefined,
            input.decisionState.interactionState?.lastAddedItemName ? `最近加入餐點：${input.decisionState.interactionState.lastAddedItemName}` : undefined,
            input.decisionState.interactionState?.pendingAction ? `目前等待顧客確認：${input.decisionState.interactionState.pendingAction}` : undefined,
            input.decisionState.interactionState?.pendingIntent ? `目前等待顧客釐清：${input.decisionState.interactionState.pendingIntent}` : undefined,
            input.decisionState.interactionState?.seating ? `內用桌位：${JSON.stringify(input.decisionState.interactionState.seating)}` : undefined,
            '這是本輪開始時的畫面摘要；執行操作前仍以點餐工具的最新狀態為準。',
          ].filter(Boolean).join('\n'),
          title: '目前點餐畫面',
        }
      : undefined,
    input.profile.snapshot.characterCard?.postHistoryInstructions
      ? { content: input.profile.snapshot.characterCard.postHistoryInstructions, title: '每次回覆都必須遵守的角色規則' }
      : undefined,
    input.actionPrompt ? { content: createAssistantActionInstructions(input.actionPrompt), title: '本次主動互動任務' } : undefined,
    input.decisionState?.serviceClarification ? { content: `目前服務釐清只是理解線索，不授權操作或回答舊 Menu 問題：${JSON.stringify(input.decisionState.serviceClarification)}`, title: '服務釐清' } : undefined,
    { content: '只依本輪點餐需求及已提供的可靠資料回覆，不把角色或店家補充設定當成額外能力。沒有提供的資訊明確說明無法確認，不自行捏造或轉介店員。服務介紹不是操作授權；實際可選付款與用餐方式、即時訂單狀態以最新工具回傳為準。未滿足的要求須先說明並確認使用者意願，不略過後直接送單。', title: '服務資訊與即時操作分界' },
    { content: orderingInstructions(), title: '已載入的點餐技能' },
    { content: '操作問題由點餐系統依 POS 與目前狀態產生。工具回傳 pendingCustomerChoice 時，不另寫或重複詢問問題，由畫面呈現該問題。用餐方式名稱必須取自最新 POS fulfillmentModes，不自行將 takeout 解讀成外帶。環境、資料來源與測試標記僅供內部紀錄，不向顧客敘述；只回報工具證實的訂單與付款狀態。pending 或 uncertain 不可宣稱付款或訂單成功。', title: '顧客回覆與操作問題分界' },
  ].filter((section): section is { content: string, title: string } => Boolean(section?.content)).map(section => `【${section.title}】\n${section.content}`).join('\n\n')
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

// Use the browser phase for both typed and ASR turns; quoted dialogue cannot
// move a customer into checkout or revive a former confirmation.
function conversationScope(state: KioskConversationDecisionState | undefined): 'ordering' | 'checkout' {
  return state?.phase.startsWith('checkout_') || state?.phase === 'payment_locked' || state?.interactionState?.screen === 'checkout' ? 'checkout' : 'ordering'
}

function toConversationMessages(
  entries: Awaited<ReturnType<KioskService['getVisitorSessionForDevice']>>['entries'],
  pendingToolCallIds: string[] = [],
  scope: 'ordering' | 'checkout' = 'ordering',
  hasCurrentInput = false,
  catalogItemIds?: ReadonlySet<string>,
) {
  // New customer input starts a fresh task: past tool payloads remain durable
  // for audit, while only their compact working summary reaches the model.
  const conversation = scope === 'checkout' && hasCurrentInput ? [] : selectBoundedConversationText(conversationTextEntries(entries), scope)
  if (hasCurrentInput || pendingToolCallIds.length === 0)
    return conversation

  // A continuation needs every completed exchange of THIS request, not only
  // the newest receipt. Otherwise a cart read erases the preceding menu lookup
  // and the Agent repeats reads or loses track of a multi-effect correction.
  // Pair by toolCallId within the latest customer turn; never borrow results
  // from another task or send an unresolved historical tool call to a provider.
  const taskEntries = entries.slice(entries.findLastIndex(entry => entry.kind === 'user_text') + 1)
  const pendingIds = new Set(pendingToolCallIds)
  const results = new Map(taskEntries.filter(entry => entry.kind === 'tool_result' && typeof entry.metadata?.toolCallId === 'string').map(entry => [entry.metadata!.toolCallId as string, entry]))
  const batches = taskEntries.flatMap((entry) => {
    if (entry.kind !== 'tool_call' || !Array.isArray(entry.metadata?.toolCalls))
      return []
    const calls = entry.metadata.toolCalls as KioskToolCall[]
    if (!calls.length || calls.some(call => !pendingIds.has(call.id) && !results.has(call.id)))
      return []
    return [calls]
  }).slice(-4)
  const exchanges: Array<
    | { content: string, role: 'assistant', tool_calls: KioskToolCall[] }
    | { content: string, role: 'tool', tool_call_id: string }
  > = []
  // Match the host's four tool batches and sixteen-call budget, keeping each
  // selected batch intact so a provider never receives an orphaned result.
  let callCount = 0
  for (const calls of batches.toReversed()) {
    callCount += calls.length
    if (callCount > 16)
      break
    const batch: typeof exchanges = [{ role: 'assistant', content: '', tool_calls: calls }]
    for (const call of calls) {
      const result = results.get(call.id)
      if (!pendingIds.has(call.id) && result)
        batch.push({ role: 'tool', content: compactToolResultForModel(call.function.name, result.content, catalogItemIds), tool_call_id: call.id })
    }
    exchanges.unshift(...batch)
  }
  return [...conversation, ...exchanges]
}

function conversationTextEntries(entries: Awaited<ReturnType<KioskService['getVisitorSessionForDevice']>>['entries']) {
  return conversationEntries(entries)
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
