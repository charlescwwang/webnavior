/// <reference path="../../../order-menu/src/toolValidators.d.ts" />

import type { CatalogSnapshot } from '../../../order-menu-server/src/domain/contracts'
import type { CheckoutSnapshot } from '../../../order-menu/src/domain/checkout-flow'
import type { ServiceObservation } from '../../../order-menu/src/evaluation/conversationOracle'
import type { MenuToolName } from '../../../order-menu/src/toolDefinitions'
import type { KioskRoutesOptions } from '../../../server/src/routes/kiosk'
import type { KioskConversationDecisionState, KioskInteractionDecision } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'
import type { ConversationRetry } from './kioskConversationRetry'

import { Buffer } from 'node:buffer'
import { appendFileSync, writeFileSync } from 'node:fs'

import validators from 'virtual:menu-tool-validators'

import { errorMessageFrom } from '@moeru/std'
import { conversationContextSchema, serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { rawTool } from '@xsai/tool'
import { array, object, optional, parse, safeParse, string, unknown } from 'valibot'
import { expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { createTableOrders } from '../../../order-menu-server/src/domain/tableOrders'
import { createInMemorySimulatorGateway, createPosSimulator } from '../../../order-menu-server/src/simulator'
import { beginCheckout, chooseInvoiceMethod, confirmInvoiceDraft, confirmTaxId, requestTaxId, setInvoiceDraft, setTaxIdDraft, skipMembership } from '../../../order-menu/src/domain/checkout-flow'
import { applyAcceptancePolicy } from '../../../order-menu/src/evaluation/conversationAcceptance'
import { conversationScripts } from '../../../order-menu/src/evaluation/conversationMatrix'
import { assessScriptTurn } from '../../../order-menu/src/evaluation/conversationOracle'
import { customizationCases } from '../../../order-menu/src/evaluation/customizationCases'
import { discoveryCases } from '../../../order-menu/src/evaluation/discoveryCases'
import { incidentConversationScripts, orderingIncidents, supersededConversationScripts } from '../../../order-menu/src/evaluation/orderingIncidents'
import { serviceModeCases } from '../../../order-menu/src/evaluation/serviceModeCases'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { createDrizzle } from '../../../server/src/libs/db'
import { mockDB } from '../../../server/src/libs/mock-db'
import { createKioskRoutes } from '../../../server/src/routes/kiosk'
import { createKioskService } from '../../../server/src/services/domain/kiosk'
import { resolveOrderingIntent } from '../../../server/src/services/domain/kiosk-conversation-skills'
import { buildConversationContext, conversationEntries } from '../../../server/src/services/domain/kiosk-interaction-decision/context'
import { createKioskSystemOneService } from '../../../server/src/services/domain/kiosk-system-one'
import { createEnvelopeCrypto } from '../../../server/src/utils/envelope-crypto'
import { useKioskInteractionRecording } from '../composables/useKioskInteractionRecording'
import { conversationDecisionStateFrom, refreshConversationState, runFastPath } from './kiosk-fast-path'
import { resumeConversationRetry } from './kioskConversationRetry'
import { createMenuReplyWindow, createServiceClarificationWindow, operationRejectionMessage, operationReplyFrom, questionReceiptFrom, replyFromConversation } from './questionPresentation'

import * as schema from '../../../server/src/schemas'

const api = vi.hoisted(() => ({ startKioskVisitorSession: vi.fn(), appendKioskInteraction: vi.fn(), streamKioskConversationMessage: vi.fn() }))
vi.mock('./kiosk-device', () => api)

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct30 budget flow.
// Opt-in: only profiles/policy are selected from live DB. All sessions, Menu,
// cart and profile copies are scratch; providers receive synthetic utterances.
const matrixId = process.env.KIOSK_CONVERSATION_SCRIPT
const modeCase = serviceModeCases.find(value => value.script.id === matrixId)
const incidentScript = matrixId ? incidentConversationScripts.find(value => value.id === matrixId) : undefined
const customizationCase = customizationCases.find(value => value.script.id === matrixId)
const inputChannel = customizationCase?.channel ?? modeCase?.channel ?? incidentScript?.channel ?? 'jev-main'
const historicalScript = discoveryCases.find(value => value.id === matrixId) ?? customizationCase?.script ?? modeCase?.script ?? incidentScript ?? (matrixId ? conversationScripts.find(value => value.id === matrixId) : undefined)
const acceptance = historicalScript ? applyAcceptancePolicy(historicalScript) : undefined
const script = acceptance?.script
if (matrixId && !script)
  throw new Error(`Unknown frozen conversation script: ${matrixId}`)

it.skipIf(process.env.KIOSK_BUDGET_ORDER_REPLAY !== '1')(`configured conversation: ${matrixId ?? 'budget-order'}`, async () => {
  const output = process.env.KIOSK_BUDGET_REPLAY_OUTPUT!
  if (!output)
    throw new Error('A new private output file is required.')
  writeFileSync(output, '', { flag: 'wx', mode: 0o600 })
  const record = (type: string, value: unknown) => appendFileSync(output, `${JSON.stringify({ type, value })}\n`)
  const live = createDrizzle({ DATABASE_URL: process.env.DATABASE_URL!, DB_POOL_MAX: 1, DB_POOL_CONNECTION_TIMEOUT_MS: 5000, DB_POOL_IDLE_TIMEOUT_MS: 10000, DB_POOL_KEEPALIVE_INITIAL_DELAY_MS: 0 })
  const envelopeCrypto = createEnvelopeCrypto({ masterKey: Buffer.from(process.env.LLM_ROUTER_MASTER_KEY!, 'base64') })
  const profiles = await (async () => {
    try {
      const active = await live.db.query.kioskSystemOneProfiles.findFirst({ where: (fields, { eq }) => eq(fields.isActive, true) })
      const selected = await live.db.query.webnaviorAiCapabilitySelections.findFirst({ where: (fields, { eq }) => eq(fields.capability, 'chat'), with: { providerProfile: true } })
      const sourceSession = await live.db.query.kioskVisitorSessions.findFirst({ orderBy: (fields, { desc }) => [desc(fields.createdAt)] })
      const profile = sourceSession && await live.db.query.kioskProfileReleases.findFirst({ where: (fields, { eq }) => eq(fields.id, sourceSession.profileReleaseId) })
      const policy = await createKioskSystemOneService({ db: live.db, envelopeCrypto }).getPolicy()
      if (!active || active.implementation === 'slm' || !selected?.providerProfile.modelId || !profile)
        throw new Error('Expected existing active JEV/Main and field profile; no configuration will be changed.')
      return { active, main: selected.providerProfile, profile, policy }
    }
    finally { await live.pool.end() }
  })()
  const { active, main, profile, policy } = profiles
  if (script?.kind === 'diagnostic') {
    if (process.env.KIOSK_CONVERSATION_DIAGNOSTIC !== 'seeded-entry')
      throw new Error(`Diagnostic evidence gap, never a passing historical replay: ${script.evidenceGap}`)
    record('diagnosticScope', { scriptId: script.id, evidenceGap: script.evidenceGap, seededEntry: script.initial.entry, historicalReplay: false })
  }
  const expectationRevision = supersededConversationScripts.find(revision => revision.replacementId === script?.id)
  if (expectationRevision) {
    record('expectationRevision', expectationRevision)
    record('previousScript', conversationScripts.find(previous => previous.id === expectationRevision.id))
  }
  record('historicalScript', historicalScript)
  record('acceptancePolicy', acceptance?.revision)
  record('script', script ?? { id: 'legacy-budget-probe' })
  record('inputChannel', { channel: inputChannel, finiteDecisionBypassed: inputChannel === 'main-direct' })
  record('configuration', { jev: { implementation: active.implementation, model: active.modelId, origin: new URL(active.baseURL).origin }, main: { model: main.modelId, origin: new URL(main.baseURL).origin, thinking: main.enableThinking }, personaRelease: profile.id, policy, persona: { instructions: profile.snapshot.agentInstructions, card: profile.snapshot.characterCard }, synthetic: true })
  const secret = main.apiKeyCiphertext ? envelopeCrypto.decryptKey(main.apiKeyCiphertext, { keyEntryId: 'default', modelName: `webnavior-ai:provider-profile:${main.id}` }) : undefined
  const startedAt = Date.now()
  let requests = 0
  let turn = 0
  const requestLimit = Number(process.env.KIOSK_BUDGET_REPLAY_REQUEST_LIMIT ?? 80)
  const durationLimit = Number(process.env.KIOSK_BUDGET_REPLAY_DURATION_LIMIT ?? 300_000)
  if (!Number.isInteger(requestLimit) || requestLimit < 1 || requestLimit > 80 || !Number.isFinite(durationLimit) || durationLimit < 1 || durationLimit > 300_000)
    throw new Error('Replay limits must remain within the authorized ceiling.')
  const budget = () => {
    if (requests >= requestLimit || Date.now() - startedAt > durationLimit)
      throw new Error('Frozen replay limit reached (80 requests/5 minutes).')
    requests++
  }
  let jevRequests = 0
  let jevFailures = 0
  const db = await mockDB(schema)
  await db.insert(schema.kioskSystemOneProfiles).values(active)
  const systemOne = createKioskSystemOneService({ db, envelopeCrypto, fetchImpl: async (...args) => {
    budget()
    return await fetch(...args)
  }, traceObserver: { record: (trace) => {
    if (trace.phase === 'request')
      jevRequests++
    if (trace.phase === 'failed' || (trace.phase === 'response' && trace.status >= 400))
      jevFailures++
    record('jev', { turn, trace })
  } } })
  await systemOne.savePolicy(policy)
  const gateway: KioskRoutesOptions['llmGateway'] = { complete: async ({ body, abortSignal }) => {
    budget()
    const request = { ...body, model: main.modelId, ...(main.kind === 'openai-compatible' ? { chat_template_kwargs: { enable_thinking: main.enableThinking } } : {}) }
    record('mainRequest', { turn, request })
    try {
      const response = await fetch(new URL('chat/completions', `${main.baseURL.replace(/\/+$/, '')}/`), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret.toString()}` } : {}) }, body: JSON.stringify(request), signal: AbortSignal.any([AbortSignal.timeout(main.timeoutMs), ...(abortSignal ? [abortSignal] : [])]) })
      record('mainResponse', { turn, status: response.status, body: await response.clone().text() })
      return response
    }
    catch (error) {
      // Preserve transport causes without logging authorization headers or keys.
      let cause: unknown
      if (error instanceof Error && error.cause instanceof AggregateError)
        cause = error.cause.errors.map(value => value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) : errorMessageFrom(value))
      record('mainFailure', { turn, message: errorMessageFrom(error), cause })
      throw error
    }
  } }
  const kioskService = createKioskService(db)
  const app = createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, systemOne, llmGateway: gateway, runtimeModelPolicy: { modelFor: async () => main.modelId! } })
  const registered = await app.request('/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
  expect(registered.status).toBe(201)
  const headers = { 'Cookie': registered.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
  const { device } = await registered.json() as { device: { id: string } }
  // Historical admission gold explicitly uses enforce; new service-mode cases
  // exercise the independent setting, including the new default off.
  const { settings } = await kioskService.getDeviceSettings(device.id)
  await db.update(schema.kioskDevices).set({ settings: { ...settings, overrides: { ...settings.overrides, serviceMode: modeCase?.serviceMode ?? 'kiosk', backgroundSpeechMode: modeCase?.backgroundSpeechMode ?? 'enforce' } } })
  const assigned = await kioskService.getDeviceProfile(device.id)
  expect(assigned).toBeDefined()
  await db.update(schema.kioskProfileReleases).set({ snapshot: { ...profile.snapshot, interactiveService: { ...profile.snapshot.interactiveService, id: 'development-ordering-service' } } })
  const start = await app.request('/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
  expect(start.status).toBe(201)
  const { session } = await start.json() as { session: { id: string } }
  const append = async (kind: string, content: string, metadata = {}) => {
    const response = await app.request(`/visitor-sessions/${session.id}/entries`, { method: 'POST', headers, body: JSON.stringify({ kind, content, metadata }) })
    expect(response.status).toBe(201)
  }
  const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  expect(catalog.items).toHaveLength(7)
  const queryScopeProbe = process.env.KIOSK_BUDGET_REPLAY_FLOW === 'query-continuation'
  const configurationOrderProbe = process.env.KIOSK_BUDGET_REPLAY_FLOW === 'configuration-order'
  if (configurationOrderProbe || ['sauce', 'both'].includes(script?.catalog ?? '')) {
    // Synthetic catalog variation for required-slot acceptance, never a POS edit.
    catalog.items = catalog.items.map(item => item.id === 'dumplings' ? { ...item, optionGroups: [{ id: 'sauce', label: '醬料', required: true, values: [{ id: 'plain', label: '不加醬', priceDelta: 0 }, { id: 'sesame', label: '芝麻醬', priceDelta: 5 }] }] } : item)
  }
  if (['spice', 'both'].includes(script?.catalog ?? '')) {
    catalog.items = catalog.items.map(item => item.id === 'beef-noodle-soup' ? { ...item, optionGroups: [{ id: 'spice', label: '辣度', required: true, values: [{ id: 'mild', label: '小辣', priceDelta: 0 }, { id: 'hot', label: '大辣', priceDelta: 0 }] }] } : item)
  }
  if (script?.catalog === 'unknown-composition')
    catalog.items = catalog.items.map(item => ({ ...item, composition: { ...item.composition, ingredients: [], complete: false } }))
  const confirmationOrderProbe = process.env.KIOSK_BUDGET_REPLAY_FLOW === 'confirmation-order'
  const contextOrderProbe = process.env.KIOSK_BUDGET_REPLAY_FLOW === 'context-order'
  const lookupPrefix = contextOrderProbe && process.env.KIOSK_CONTEXT_ORDER_LOOKUP_PREFIX === '1'
  const checkoutProbe = Boolean(script) || process.env.KIOSK_BUDGET_REPLAY_FLOW === 'checkout-entry' || contextOrderProbe || confirmationOrderProbe || configurationOrderProbe
  let checkoutState: CheckoutSnapshot | undefined
  let checkoutRevision = 0
  let checkoutStarts = 0
  let paymentSelections = 0
  const updateCheckout = (next: CheckoutSnapshot) => {
    checkoutRevision++
    checkoutState = next
    return next
  }
  let reviewOpen = false
  let entryReady = script?.initial.entry !== 'pending'
  const tableOrders = createTableOrders(createInMemorySimulatorGateway())
  const orderingContext = tableOrders.open(modeCase?.serviceMode ?? 'kiosk')
  let tableSubmissions = 0
  let confirmedTableOrder: Awaited<ReturnType<typeof tableOrders.submit>> | undefined
  const runtime = createMenuToolRuntime({ ...(modeCase ? { serviceContext: () => orderingContext } : {}), ...(modeCase?.serviceMode === 'table-service'
    ? { gateway: { submit: async (cart) => {
        tableSubmissions++
        if (!cart.catalogRevision)
          throw new Error('Synthetic fixture must load the catalog revision before submission.')
        confirmedTableOrder = await tableOrders.submit({ confirmedByUser: true, contextId: orderingContext.id, idempotencyKey: `synthetic-${orderingContext.id}`, cart: { ...cart, catalogRevision: cart.catalogRevision } })
        return confirmedTableOrder
      } } }
    : {}), ...(script?.group === 'checkout-navigation'
    ? { screen: () => checkoutState ? 'checkout' as const : reviewOpen ? 'cart_review' as const : 'menu' as const, onReviewRequested: () => {
        if (!checkoutState)
          reviewOpen = true
      } }
    : {}), orderingReady: () => entryReady, onCustomerEntrySkipped: () => entryReady = true, menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, ...(checkoutProbe
    ? { checkout: {
        snapshot: () => checkoutState,
        revision: () => checkoutRevision,
        paymentStatus: () => undefined,
        paymentMethods: ['linepay', 'jkopay'],
        assertCanRestart: () => {},
        restart: () => {
          checkoutState = undefined
          checkoutRevision++
        },
        cancel: () => {
          reviewOpen = true
          checkoutState = undefined
          checkoutRevision++
        },
        start: () => {
          checkoutStarts++
          return updateCheckout(beginCheckout('collected'))
        },
        skipMembership: () => updateCheckout(skipMembership(checkoutState!)),
        chooseInvoice: (method: Parameters<typeof chooseInvoiceMethod>[1]) => updateCheckout(chooseInvoiceMethod(checkoutState!, method)),
        requestTaxId: () => updateCheckout(requestTaxId(checkoutState!)),
        setTaxId: (value: string) => updateCheckout(setTaxIdDraft(checkoutState!, value)),
        confirmInvoice: () => updateCheckout(confirmInvoiceDraft(checkoutState!)),
        confirmTaxId: () => updateCheckout(confirmTaxId(checkoutState!)),
        selectPayment: async () => {
          paymentSelections++
          throw new Error('Payment is outside checkout-entry probe.')
        },
      } }
    : {}) })
  runtime.setMenu(catalog.items, catalog.revision)
  const snapshot = async () => parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const clarification = createServiceClarificationWindow()
  api.startKioskVisitorSession.mockResolvedValue({ session })
  api.appendKioskInteraction.mockImplementation(async entry => await app.request(`/visitor-sessions/${session.id}/entries`, { method: 'POST', headers, body: JSON.stringify(entry) }))
  api.streamKioskConversationMessage.mockImplementation(async ({ signal, ...body }) => {
    const response = await app.request(`/visitor-sessions/${session.id}/messages`, { method: 'POST', signal, headers, body: JSON.stringify(body) })
    expect(response.status).toBe(200)
    return await response.json()
  })
  const scope = effectScope()
  const recording = scope.run(() => useKioskInteractionRecording())!
  const seen = new Set<string>()
  let retry: ConversationRetry | undefined
  // This is a fixture precondition: entry already completed, no previous topic/cart.
  const utterances = ['我有一百元，可以吃什麼', '有其他的嗎', '改成兩百元以內，看看其他餐點', '還有其他的嗎', '我要水餃', '兩份']
  const skillProbe = process.env.KIOSK_BUDGET_REPLAY_FLOW === 'meal-skill'
  let stages = [1, 2, 3, 4, 5, 6]
  if (queryScopeProbe) {
    utterances.splice(0, utterances.length, '有其他的嗎', '我想看全部菜單')
    stages = [21, 22]
  }
  else if (configurationOrderProbe) {
    utterances.splice(0, utterances.length, '我要水餃兩份', '芝麻醬', '自取', '好')
    stages = [17, 18, 19, 20]
  }
  else if (confirmationOrderProbe) {
    utterances.splice(0, utterances.length, ...orderingIncidents.mealConfirmation.turns.map(step => step.customer), '內用', '好')
    stages = [12, 13, 14, 15, 16]
  }
  else if (contextOrderProbe) {
    utterances.push('好', '我想吃排骨便當', '那我要一份', '內用', '好')
    stages = lookupPrefix ? [9, 10, 11] : [8, 9, 10, 11]
  }
  else if (checkoutProbe) {
    utterances.push('好')
    stages = [7]
  }
  else if (skillProbe) {
    stages = [5]
  }
  else if (process.env.KIOSK_BUDGET_REPLAY_FLOW === 'core') {
    stages = [1, 2, 5, 6]
  }
  if (script)
    stages = script.steps.map((_, index) => 100 + index)
  record('flow', { stages, freshProviders: true, seededPrefix: !script && (queryScopeProbe || skillProbe || lookupPrefix || (checkoutProbe && !contextOrderProbe && !confirmationOrderProbe && !configurationOrderProbe)), injectedJevAbstention: checkoutProbe && process.env.KIOSK_CHECKOUT_MAIN_PROBE === '1' })
  try {
    if (script) {
      for (const line of script.initial.cart) {
        const receipt = await runtime.invoke('order_add_item', { ...line })
        record('fixturePrefix', { receipt, initialCart: true })
      }
      if (script.initial.fulfillment)
        await runtime.invoke('order_set_fulfillment', { mode: script.initial.fulfillment })
      if (incidentScript?.initial.checkout) {
        updateCheckout(beginCheckout('collected'))
        record('fixturePrefix', { checkoutEntry: true, synthetic: true, historicalReplay: false })
      }
      if (script.group === 'checkout-navigation' && !incidentScript?.initial.checkout)
        reviewOpen = false
      if (incidentScript?.initial.invoiceDraft) {
        const draft = incidentScript.initial.invoiceDraft
        updateCheckout(draft.method === 'tax-id'
          ? setTaxIdDraft(requestTaxId(beginCheckout('collected')), draft.code)
          : setInvoiceDraft(beginCheckout('collected'), draft.method, draft.code))
        record('fixturePrefix', { invoiceDraft: true, synthetic: true, historicalReplay: false })
      }
    }
    if (queryScopeProbe) {
      const receipt = await runtime.invoke('menu_recommend', { action: 'update', maxPrice: 100 })
      const message = operationReplyFrom(receipt)!
      await append('asr_transcript', '我有一百元，可以吃什麼')
      await append('assistant_text', message)
      await runtime.invoke('kiosk_dialogue_presented', { content: message })
      record('fixturePrefix', { receipt, retainedBudget: true })
    }
    if (lookupPrefix) {
      // Recreate the observed read-first branch, not the alternative first-turn
      // path that already asks quantity. Subsequent order/fulfillment/checkout
      // turns use real providers; this is explicitly a seeded-prefix probe.
      const receipt = await runtime.invoke('menu_get', { query: '炸排骨便當' })
      const message = operationReplyFrom(receipt)!
      await append('asr_transcript', '我想吃排骨便當')
      await append('assistant_text', message)
      await runtime.invoke('kiosk_dialogue_presented', { content: message })
      record('fixturePrefix', { receipt, readFirst: true })
    }
    if (!script && checkoutProbe && !contextOrderProbe && !confirmationOrderProbe && !configurationOrderProbe) {
      await runtime.invoke('order_add_item', { itemId: catalog.items.find(item => item.name === '炸排骨便當')!.id, quantity: 1 })
      const receipt = await runtime.invoke('order_set_fulfillment', { mode: 'dine-in' })
      const question = questionReceiptFrom(receipt)
      expect(question?.purpose).toBe('checkout-entry')
      await append('asr_transcript', '一個排骨便當')
      await append('assistant_text', '已將炸排骨便當加入購物車，共1份。請問要內用還是自取？')
      await append('asr_transcript', '內用')
      await append('assistant_text', operationReplyFrom(receipt)!)
      await runtime.invoke('kiosk_dialogue_presented', { content: operationReplyFrom(receipt)!, questionId: question!.questionId })
      record('fixturePrefix', { receipt, checkoutEntryOnly: true })
    }
    if (skillProbe) {
    // Reconstruct the two successful synthetic turns from core-cart as fixture
    // setup. Only the subsequent meal request uses live models; this is a
    // single-turn skill probe, never a full-flow live acceptance claim.
      const prefix = [
        { text: utterances[0]!, args: { action: 'update', maxPrice: 100 } },
        { text: utterances[1]!, args: { action: 'update', maxPrice: 100, excludeItemIds: ['dumplings'] } },
      ]
      for (const step of prefix) {
        const receipt = await runtime.invokeForAgent('menu_recommend', step.args)
        const message = receipt as { customerMessage: string }
        await append('asr_transcript', step.text, { decisionRoute: 'fast_path' })
        await append('assistant_text', message.customerMessage)
        await runtime.invoke('kiosk_dialogue_presented', { content: message.customerMessage })
        record('fixturePrefix', { text: step.text, receipt })
      }
    }
    for (const stage of stages) {
      const matrixStep = script?.steps[stage - 100]
      const text = matrixStep?.text ?? utterances[queryScopeProbe ? stage - 21 : configurationOrderProbe ? stage - 17 : confirmationOrderProbe ? stage - 12 : stage - 1]!
      turn++
      const turnDeadlineAt = Date.now() + 60_000
      let policyDecision: KioskInteractionDecision | undefined
      let recordedInput = false
      const before = await snapshot()
      const cueBefore = clarification.current(before)
      const historyBefore = await kioskService.getVisitorSessionForDevice({ deviceId: device.id, visitorSessionId: session.id })
      const tools: string[] = []
      if (matrixStep?.retry) {
        expect(retry).toBeDefined()
        const resumed = await resumeConversationRetry(retry!, { current: async () => ({ sessionId: session.id, iframeRevision: 1, contextKey: serviceContextKey(await snapshot()) }), enqueue: (utterance) => {
          expect(utterance).toBe(text)
          return { kind: 'ACCEPTED', id: turn }
        }, record: async event => record('retry', event) })
        expect(resumed.kind).toBe('ACCEPTED')
      }
      if (matrixStep?.fault === 'before-decision') {
        retry = { state: 'available', text, sessionId: session.id, iframeRevision: 1, requestId: turn, originalUtteranceId: turn, contextKey: serviceContextKey(before) }
        record('injectedFault', { turn, fault: matrixStep.fault, text, before, noProviderCall: true })
        continue
      }
      let faultDelivered = false
      if (matrixStep?.fault === 'stale-intent') {
        await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })).rejects.toThrow()
        faultDelivered = true
        record('injectedFault', { turn, fault: matrixStep.fault, oldIntentRejected: true, noReplay: true })
      }
      const execute = async (name: MenuToolName, input: Record<string, unknown> | undefined, agent = false) => {
        if (!faultDelivered && matrixStep?.fault === 'read-timeout' && (['menu_get', 'menu_recommend'].includes(name) || (name === 'kiosk_fast_path_execute' && ['intent:search-menu', 'intent:search-all-menu', 'intent:recommend', 'intent:recommend-more'].includes(String(input?.candidateId))))) {
          faultDelivered = true
          record('injectedFault', { turn, fault: matrixStep.fault, name, beforeEffect: true })
          throw new Error('Injected Menu read timeout')
        }
        // Use the same compiled contract as the Menu RPC boundary. Bypassing it
        // would falsely accept tool arguments rejected by the deployed iframe.
        if (agent) {
          const definition = runtime.toolDefinitions.find(tool => tool.name === name)!
          const enums = Object.fromEntries(Object.entries(definition.inputSchema.properties as Record<string, { enum?: unknown }>).filter(([, schema]) => schema.enum !== undefined).map(([key, schema]) => [key, schema.enum]))
          const validate = validators[name]
          if (!validate?.({ input: input ?? {}, enums }))
            return { ok: false, executed: false, toolName: name, error: 'INVALID_TOOL_INPUT', message: `尚未執行。請依工具參數契約修正：${JSON.stringify(validate?.errors ?? []).slice(0, 1600)}。不要重做已成功的操作。` }
        }
        let receipt: unknown
        try {
          receipt = agent ? await runtime.invokeForAgent(name, input) : await runtime.invoke(name, input)
        }
        catch (error) {
          record('toolFailure', { turn, name, input, error: errorMessageFrom(error) })
          throw error
        }
        if (!faultDelivered && matrixStep?.fault === 'lost-write-receipt' && ['order_add_item', 'kiosk_fast_path_execute'].includes(name)) {
          const current = await snapshot()
          if (current.cart.itemCount !== before.cart.itemCount) {
            faultDelivered = true
            record('injectedFault', { turn, fault: matrixStep.fault, name, afterEffect: true, receipt })
            throw new Error('Injected lost write receipt; outcome must not be replayed')
          }
        }
        return receipt
      }
      const fast = await runFastPath({ transcript: text, onUtteranceAccepted: async () => {
        if (!recordedInput) {
          await append('asr_transcript', text, { utteranceId: turn, decisionRoute: 'utterance_accepted' })
          recordedInput = true
          record('utteranceAccepted', { turn, toolsCompleted: tools.filter(name => !name.startsWith('kiosk_')).length })
        }
      }, onTrace: trace => record('fastTrace', { turn, trace }), isEnabled: async () => inputChannel !== 'main-direct' && await systemOne.isEnabled(), serviceClarification: state => clarification.current(state), decide: async ({ signal, ...request }) => {
        if (checkoutProbe && process.env.KIOSK_CHECKOUT_MAIN_PROBE === '1') {
          // Replay the observed admission abstention against the real Main, not
          // a lucky strong JEV result. This is a fault-injection probe, separate
          // from natural routing acceptance; all effects still run through Host.
          return await resolveOrderingIntent({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST', recovery: { status: 'eligible' } }, request, body => gateway.complete({ modelName: main.modelId!, body, abortSignal: signal }))
        }
        if (matrixStep?.fault === 'invalid-decision') {
          faultDelivered = true
          record('injectedFault', { turn, fault: matrixStep.fault, schemaFailure: true })
          return { kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE' }
        }
        const response = await app.request('/interaction-decisions', { method: 'POST', headers, signal, body: JSON.stringify({ ...request, includeTrace: Boolean(modeCase), utteranceId: turn, visitorSessionId: session.id }) })
        expect(response.status).toBe(200)
        policyDecision = await response.json() as KioskInteractionDecision
        return policyDecision
      }, onExecuted: async (result) => {
        record('fastReceipt', { turn, result })
        if (!recordedInput) {
          await append('asr_transcript', text, { utteranceId: turn, decisionRoute: 'fast_path' })
          recordedInput = true
        }
        const trace = safeParse(object({ decisionTrace: object({ operationPlan: object({ toolName: string(), input: unknown() }) }) }), result)
        if (trace.success) {
          const operation = trace.output.decisionTrace.operationPlan
          await append('tool_call', JSON.stringify(operation.input), { name: operation.toolName, decisionRoute: 'fast_path' })
          await append('tool_result', JSON.stringify(result), { name: operation.toolName, decisionRoute: 'fast_path' })
        }
      }, webMcp: { tools: runtime.toolDefinitions.map(t => ({ ...t, origin: 'https://ordering.test' })), execute: async (tool, input) => {
        tools.push(tool.name)
        return await execute(tool.name as MenuToolName, input)
      } } })
      record('decision', { turn, text, fast })
      if (modeCase && inputChannel !== 'main-direct') {
        const observed = safeParse(object({ backgroundObservation: object({ mode: string() }), exchanges: array(object({ answers: optional(object({ admission: optional(object({ choice: string() })) })) })) }), policyDecision?.trace)
        expect(observed.success, 'Policy trace must be present, not inferred from a reply').toBe(true)
        if (observed.success) {
          const admissionCalls = observed.output.exchanges.filter(exchange => exchange.answers?.admission).length
          record('backgroundPolicyAssessment', { turn, mode: modeCase.backgroundSpeechMode, admissionCalls, observation: observed.output.backgroundObservation })
          expect(observed.output.backgroundObservation.mode).toBe(modeCase.backgroundSpeechMode)
          expect(admissionCalls).toBe(modeCase.backgroundSpeechMode === 'off' ? 0 : 1)
        }
      }
      // Observe the final qualifier before falling back to earlier Jev evidence.
      // IGNORE alone is insufficient: a declined invitation is accepted service.
      const scoped = safeParse(object({ trace: object({ serviceResolution: object({ choice: string(), recipient: optional(string()) }) }) }), fast)
      const traced = safeParse(object({ trace: object({ exchanges: array(object({ answers: optional(object({ admission: optional(object({ choice: string() })) })) })) }) }), fast)
      const scope = scoped.success ? scoped.output.trace.serviceResolution.choice : undefined
      const proposed = traced.success ? traced.output.trace.exchanges.flatMap(exchange => exchange.answers?.admission?.choice ?? []).at(-1) : undefined
      const service: ServiceObservation = {}
      const finiteRecipient = safeParse(object({ trace: object({ mainSkill: object({ recipient: string() }) }) }), fast)
      const recipient = scoped.success ? scoped.output.trace.serviceResolution.recipient : finiteRecipient.success ? finiteRecipient.output.trace.mainSkill.recipient : undefined
      if (recipient === 'other' || recipient === 'uncertain') {
        service.admission = recipient === 'other' ? 'background' : 'uncertain'
      }
      else if (scope) {
        service.admission = scope === 'BACKGROUND' ? 'background' : scope === 'UNCERTAIN' ? 'uncertain' : 'service'
        if (['KEEP_ORDER', 'IDLE'].includes(scope))
          service.meaning = 'pause'
      }
      else if (fast.kind === 'FAST_ACTION' && fast.action.id === 'intent:defer-question') {
        service.admission = 'service'
        service.meaning = 'pause'
      }
      else if (fast.recovery?.status === 'completed') {
        service.admission = fast.recovery.admission
      }
      else if (fast.kind === 'IGNORE') {
        const answered = safeParse(object({ answeredQuestionId: string() }), fast).success
        service.admission = answered ? 'service' : 'background'
        if (answered)
          service.meaning = 'pause'
      }
      else if (proposed) {
        service.admission = proposed === 'BACKGROUND' ? 'background' : proposed === 'UNCERTAIN' ? 'uncertain' : 'service'
      }
      record('serviceObservation', { turn, ...service })
      clarification.settle(fast)
      let answer = ''
      let hostFailure: string | undefined
      let question: ReturnType<typeof questionReceiptFrom>
      if (fast.kind === 'NEEDS_ASSISTANT') {
        const state = conversationDecisionStateFrom(fast.decisionState, fast) ?? { phase: 'ordering' }
        const taskId = `budget-order-${turn}`
        await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId, transcript: text, expectedMenuRevision: before.revisions.menu, readOnly: state.readOnly === true, ...(state.handoff ? { handoff: state.handoff } : {}), constraints: { excludeIngredients: state.constraints?.exclude ?? [], includeIngredients: state.constraints?.include ?? [], ...state.constraints?.price, ...(state.constraints?.unresolvedPrice ? { unresolvedPrice: true } : {}) } })
        const receipts = createMenuReplyWindow()
        let outcome: string | undefined
        try {
          const result = await recording.send('development-ordering-service', text, [], { taskId, utteranceId: turn, budgetMs: Math.max(1, turnDeadlineAt - Date.now()), prepareRound: async () => {
            const context = await snapshot()
            const decisionState: KioskConversationDecisionState = refreshConversationState(context, state)
            return { decisionState, tools: runtime.toolDefinitions.filter(t => context.allowedToolNames.includes(t.name)).map(t => rawTool({ name: t.name, description: t.description, parameters: t.inputSchema, execute: async (args: Record<string, unknown>) => {
              const result = await execute(t.name, args, true)
              record('toolReceipt', { turn, name: t.name, args, result })
              return result
            } })) }
          }, onToolResult: (name, content) => {
            const result = JSON.parse(content)
            tools.push(name)
            receipts.record(name, result)
            question = questionReceiptFrom(result) ?? question
            if (!['menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get', 'seating_get'].includes(name))
              outcome = operationReplyFrom(result) ?? outcome
          } })
          const context = await snapshot()
          record('hostResult', { turn, result })
          // Record the resulting cart/history even when the Host could not finish.
          // An early assertion previously hid the wrong-cart snapshot in C12-A1.
          if (!matrixStep?.fault && !['completed', 'waiting'].includes(result?.status ?? ''))
            hostFailure = result?.reason ?? 'missing-host-result'
          const displayed = replyFromConversation(result!, { menu: receipts, context, question, outcome, handoff: state.handoff, requireMenuRead: state.requireMenuRead, serviceReply: state.serviceReply, failureMessage: '需求尚未完成。' })
          if (!matrixStep?.fault && displayed.role !== 'assistant')
            hostFailure ??= 'host-error-presentation'
          answer = displayed.content
          if (displayed.clarification || result?.reply?.kind === 'clarification')
            clarification.present({ questionId: crypto.randomUUID(), question: answer, sourceUtterance: text, contextKey: serviceContextKey(context), expiresAt: Date.now() + 30000 })
        }
        finally { await runtime.invoke('kiosk_agent_task', { action: 'END', taskId }) }
      }
      else {
        if ((!recordedInput && !['IGNORE', 'INCOMPLETE', 'UNAVAILABLE'].includes(fast.kind)) || fast.kind === 'SERVICE_CLARIFICATION') {
          await append('asr_transcript', text, fast.kind === 'SERVICE_CLARIFICATION'
            ? { utteranceId: turn, decisionRoute: 'fast_path', source: 'service_clarification', questionId: fast.question.questionId }
            : { utteranceId: turn })
        }
        if (fast.kind === 'FAST_ACTION') {
          answer = operationReplyFrom(fast.result) ?? ''
          question = questionReceiptFrom(fast.result)
        }
        else if (fast.kind === 'CUSTOMER_ENTRY_REQUIRED') {
          // KioskScene presents this existing localized entry reminder too.
          answer = '請先填寫手機號碼，或說「略過」，就可以開始看菜單與點餐。'
        }
        else if (fast.kind === 'EXECUTION_FAILED') {
          answer = operationRejectionMessage(fast.result, fast.uncertain) ?? ''
        }
        else if (fast.kind === 'CLARIFICATION') {
          answer = fast.prompt
          question = fast.question
        }
        else if (fast.kind === 'SERVICE_CLARIFICATION') {
          clarification.present(fast.question)
          answer = fast.question.question
        }
      }
      if (answer) {
        await append('assistant_text', answer, fast.kind === 'SERVICE_CLARIFICATION' ? { source: 'service_clarification', questionId: fast.question.questionId, utteranceId: turn } : {})
        await runtime.invoke('kiosk_dialogue_presented', { content: answer, ...(question ? { questionId: question.questionId } : {}) })
      }
      const after = await snapshot()
      const historyAfter = await kioskService.getVisitorSessionForDevice({ deviceId: device.id, visitorSessionId: session.id })
      record('admittedContext', { turn, messages: buildConversationContext(historyAfter.entries).messages, cue: clarification.current(after) })
      record('turn', { turn, text, answer, tools, before, after })
      console.info(JSON.stringify({ turn, text, answer, decision: fast.kind, tools, shown: after.presentation?.itemIds, itemCount: after.cart.itemCount, requests }))
      if (matrixStep && script) {
        const errors = assessScriptTurn(matrixStep, { before, after, menu: catalog.items, answer, shownHistory: seen, checkoutStarts, service, ...(fast.kind === 'UNAVAILABLE' && ['PROVIDER_FAILURE', 'INVALID_CHOICE', 'CANDIDATE_BUDGET', 'SYSTEM_ONE_DISABLED'].includes(fast.reason ?? '') ? { technicalFailure: fast.reason } : {}), ...(fast.recovery?.status === 'failed' ? { technicalFailure: fast.recovery.failure ?? 'service-recovery' } : {}), ...(hostFailure ? { technicalFailure: hostFailure } : {}) })
        if (matrixStep.silentOnly) {
          if (JSON.stringify(conversationEntries(historyAfter.entries)) !== JSON.stringify(conversationEntries(historyBefore.entries)))
            errors.push('Unadopted speech changed accepted dialogue history')
          if (JSON.stringify(clarification.current(after)) !== JSON.stringify(cueBefore && cueBefore.expiresAt > Date.now() ? cueBefore : undefined))
            errors.push('Unadopted speech changed or renewed the service cue')
          if (!tools.every(name => ['kiosk_fast_path_context', 'kiosk_fast_path_validate', 'kiosk_conversation_context', 'kiosk_interaction_state'].includes(name)))
            errors.push('Unadopted speech invoked a non-observation tool')
        }
        const draft = incidentScript?.initial.invoiceDraft
        if (draft) {
          const actualCode = draft.method === 'tax-id' ? checkoutState?.taxId : checkoutState?.stage === 'invoice' ? checkoutState.invoiceDraft?.code : draft.method === 'carrier' ? checkoutState?.carrierCode : checkoutState?.citizenCode
          if (actualCode !== draft.code)
            errors.push('Invoice identifier was changed or lost')
          if (paymentSelections !== 0)
            errors.push('Invoice confirmation selected a payment method')
        }
        if (matrixStep.fault && !faultDelivered)
          errors.push(`Fault injection never reached the declared boundary: ${matrixStep.fault}`)
        if (matrixStep.fault === 'invalid-decision' && fast.kind !== 'UNAVAILABLE')
          errors.push(`Invalid protocol output became semantic routing: ${fast.kind}`)
        record('assessment', { scriptId: script.id, turn, errors, passed: errors.length === 0 })
        expect(errors, `${script.id} turn ${turn}: ${text}`).toEqual([])
        for (const id of after.presentation?.itemIds ?? [])
          seen.add(id)
        continue
      }
      expect(answer).not.toBe('')
      expect(answer).not.toContain('剛才沒有理解清楚')
      if (stage === 1) {
        expect(after.presentation?.itemIds).toEqual(['dumplings'])
        expect(after.cart.itemCount).toBe(0)
        seen.add('dumplings')
      }
      if (stage === 2) {
        expect(after.cart.itemCount).toBe(0)
        expect(answer).toMatch(/沒有|找不到|調整|換.*(?:類|條件|價位)|想看.*(?:類|價位)/)
        for (const id of after.presentation?.itemIds ?? [])
          expect(catalog.items.find(item => item.id === id)!.price).toBeLessThanOrEqual(100)
      }
      if (stage === 3 || stage === 4) {
        const shown = after.presentation?.itemIds ?? []
        expect(shown.length).toBeGreaterThan(0)
        for (const id of shown) {
          expect(seen.has(id)).toBe(false)
          expect(catalog.items.find(item => item.id === id)!.price).toBeLessThanOrEqual(200)
          seen.add(id)
        }
        expect(after.cart.itemCount).toBe(0)
      }
      if (stage === 5) {
        expect(after.waitingFor?.purpose).toMatch(/quantity|configuration/)
        expect(after.cart.itemCount).toBe(0)
      }
      if (stage === 12)
        expect(after.cart.itemCount).toBe(0)
      if (stage === 13) {
        expect(after.phase).toBe('meal_confirmation')
        expect(after.cart.itemCount).toBe(0)
        expect(answer).toBe(orderingIncidents.mealConfirmation.turns[1].observedReply)
      }
      if (stage >= 14 && stage <= 16) {
        const expected = orderingIncidents.mealConfirmation.expectedCart
        expect(after.cart.lines).toMatchObject([{ itemId: expected.itemId, quantity: expected.quantity }])
        expect(after.cart.total).toBe(expected.total)
        expect(after.cart.itemCount).toBe(expected.quantity)
        expect(answer).not.toMatch(/調整價位|換餐點種類|推薦/)
      }
      if (stage === 15)
        expect(after.cart.fulfillmentMode).toBe('dine-in')
      if (stage === 8) {
        expect(after.cart.itemCount).toBe(0)
      }
      if (stage === 9 || stage === 10 || stage === 11) {
        const porkChop = catalog.items.find(item => item.name === '炸排骨便當')!
        expect(after.cart.lines).toMatchObject([{ itemId: porkChop.id, quantity: 1 }])
        expect(after.cart.itemCount).toBe(1)
        expect(after.cart.total).toBe(porkChop.price)
        expect(answer).not.toContain('推薦')
      }
      if (stage === 10)
        expect(after.cart.fulfillmentMode).toBe('dine-in')
      if (stage === 7 || stage === 11 || stage === 16) {
        expect(checkoutState?.stage).toBe('invoice')
        expect(checkoutStarts).toBe(1)
        expect(paymentSelections).toBe(0)
        expect(after.cart.itemCount).toBe(1)
        expect(answer).not.toContain('推薦')
        expect(answer).toContain('結帳')
        expect(after.phase).toBe('checkout_invoice')
      }
      if (stage === 17) {
        expect(after.cart.itemCount).toBe(0)
        expect(after.phase).toBe('configuration')
        expect(after.retainedRequests).toMatchObject([{ itemId: 'dumplings', quantity: 2, missing: { quantity: false, optionGroupIds: ['sauce'] } }])
        expect(after.waitingFor?.purpose).toBe('item-configuration')
      }
      if (stage >= 18 && stage <= 20) {
        expect(after.cart.lines).toMatchObject([{ itemId: 'dumplings', quantity: 2, unitPrice: 85, options: [{ groupId: 'sauce', valueId: 'sesame' }] }])
        expect(after.cart.total).toBe(170)
        expect(after.cart.itemCount).toBe(2)
        expect(answer).not.toContain('推薦')
      }
      if (stage === 19)
        expect(after.cart.fulfillmentMode).toBe('takeout')
      if (stage === 20) {
        expect(checkoutStarts).toBe(1)
        expect(paymentSelections).toBe(0)
        expect(after.phase).toBe('checkout_invoice')
      }
      if (stage === 21) {
        expect(after.cart.itemCount).toBe(0)
        expect(answer).toMatch(/沒有|找不到|調整|條件/)
        for (const id of after.presentation?.itemIds ?? [])
          expect(catalog.items.find(item => item.id === id)!.price).toBeLessThanOrEqual(100)
      }
      if (stage === 22) {
        expect(after.cart.itemCount).toBe(0)
        expect(after.presentation?.itemIds).toHaveLength(catalog.items.length)
      }
      if (stage === 6) {
        expect(after.cart.lines).toMatchObject([{ itemId: 'dumplings', quantity: 2 }])
        expect(after.cart.itemCount).toBe(2)
        expect(after.cart.total).toBe(2 * catalog.items.find(item => item.id === 'dumplings')!.price)
        expect(answer).not.toMatch(/推薦一項/)
      }
    }
    if (modeCase?.serviceMode === 'table-service') {
      expect(tableSubmissions).toBe(1)
      expect(confirmedTableOrder).toMatchObject({ serviceMode: 'table-service', table: orderingContext.table, receipt: { status: 'accepted' }, cart: { itemCount: 1, total: 80 } })
      expect(confirmedTableOrder?.receipt).not.toHaveProperty('pickupNumber')
      expect(checkoutStarts).toBe(0)
      expect(paymentSelections).toBe(0)
      record('tableSubmissionAssessment', { tableSubmissions, checkoutStarts, paymentSelections, order: confirmedTableOrder })
    }
    if (inputChannel !== 'main-direct') {
      expect(jevRequests, 'Jev/Main acceptance requires actual Jev requests').toBeGreaterThan(0)
      expect(jevFailures, 'Main fallback does not prove Jev acceptance').toBe(0)
    }
  }
  finally {
    scope.stop()
    secret?.fill(0)
    record('summary', { requests, jevRequests, jevFailures, durationMs: Date.now() - startedAt })
  }
}, 360_000)
