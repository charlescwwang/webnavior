import type { PresenceState } from '@proj-airi/kiosk-proactive'
import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'
import type { ConversationContext, ConversationHandoff, ConversationQuestion as PresentedQuestion, ServiceClarification, ServiceRecovery } from '@proj-airi/stage-shared/kiosk-conversation'

import type { DecisionStageResult, KioskInteractionDecision as FastPathDecision, KioskDecisionState as FastPathDecisionState, InteractionState } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'
import type { KioskConversationDecisionState } from './kiosk-device'

import { errorMessageFrom } from '@moeru/std'
import { conversationRequestSchema, handoffSchema, intentRecoverySchema, serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { array, parse } from 'valibot'

import { priceClarification } from '../../../order-menu/src/domain/pricing'
import { normalizeTranscript } from '../../../server/src/services/domain/kiosk-interaction-decision/context'
import { decisionQuestionBudget } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'
import { presentedQuestionFrom } from './questionPresentation'

export interface FastPathCandidate {
  description: string
  id: string
  requiresHighConfidence?: boolean
}

/** Per-utterance request timing; missing provider accounting is unknown, not zero. */
export interface FastPathTiming {
  transcript: string
  /** Client API round trips, excluding queue, recording flush, tools and TTS. */
  requestDurationMs: number
  /** Server-to-Jev round trips, including network time, not isolated GPU time. */
  modelDurationMs?: number
  modelCalls?: number
  modelQuestions?: number
  /** Time until the first server-owned checkpoint; not permission to execute. */
  firstResultDurationMs?: number
}

export type { KioskInteractionDecision as FastPathDecision, KioskDecisionState as FastPathDecisionState } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'

export type FastPathResult = {
  handoff?: ConversationHandoff
  priceChoiceId?: FastPathDecision['priceChoiceId']
  requestScope?: FastPathDecision['requestScope']
  resolvedBy?: FastPathDecision['resolvedBy']
  recovery?: ServiceRecovery
  decisionState?: FastPathDecisionState
  reason?: FastPathDecision['reason']
} & (
  | { action: FastPathCandidate, kind: 'FAST_ACTION', result: unknown }
  | { confidence?: number, kind: 'CLARIFICATION', prompt: string, question?: PresentedQuestion, silent?: boolean }
  | { confidence?: number, kind: 'INCOMPLETE' }
  | { confidence?: number, kind: 'IGNORE' }
  | { confidence?: number, kind: 'GREET' }
  | { confidence?: number, kind: 'CUSTOMER_ENTRY_REQUIRED' }
  | { confidence?: number, kind: 'FOLLOW_UP_ACTIVE', requestText: string }
  | { kind: 'DEFERRED' }
  | { confidence?: number, kind: 'NEEDS_ASSISTANT' }
  | { kind: 'SERVICE_CLARIFICATION', question: ServiceClarification }
  | { kind: 'UNAVAILABLE' }
  | { kind: 'SERVICE_UNAVAILABLE' }
  | { kind: 'EXECUTION_FAILED', uncertain: boolean, result?: unknown }
)

/** Only failed service decisions warrant a retry prompt; social uncertainty stays silent. */
export function shouldShowDecisionRetry(result: Pick<FastPathResult, 'kind' | 'reason' | 'recovery'>): boolean {
  return result.kind === 'UNAVAILABLE' && ((result.recovery?.status === 'failed' && result.recovery.failure !== 'cancelled') || result.reason === 'PROVIDER_FAILURE' || result.reason === 'INVALID_CHOICE' || result.reason === 'CANDIDATE_BUDGET' || result.reason === 'SYSTEM_ONE_DISABLED')
}

/** Owns checkpoint admission for one decision, never execution or transcript admission. */
export function createDecisionFeedback(): (stage: Extract<DecisionStageResult, { kind: 'DECISION_PROGRESS' }>) => boolean {
  let serviceMeaning = false
  let recipient = false
  return (stage) => {
    const confident = typeof stage.confidence === 'number' && Number.isFinite(stage.confidence) && stage.confidence >= 0.6 && stage.confidence <= 1
    if (stage.question === 'admission') {
      // The new gate checks recipient and service relevance together. The
      // server's SLM marker permits progress feedback, never a browser action.
      const admitted = (confident || stage.selectionMode === 'unscored') && stage.choice === 'SERVICE'
      serviceMeaning = admitted
      recipient = admitted
    }
    if (stage.question === 'route')
      serviceMeaning = confident && (stage.choice?.startsWith('intent:') === true || ['GENERAL_QUESTION', 'MENU_QUERY', 'MULTI_ACTION', 'NEEDS_ASSISTANT'].includes(stage.choice ?? ''))
    if (stage.question === 'recipient' || stage.question === 'service')
      recipient = confident && (stage.choice === 'KIOSK' || stage.choice === 'REQUEST')
    // This recovery question checks relevance and recipient together. A pure
    // recipient answer cannot rescue a weak intent, as in everyday chatter.
    if (stage.question === 'serviceRequest') {
      serviceMeaning = confident && stage.choice === 'REQUEST'
      recipient = serviceMeaning
    }
    return serviceMeaning && recipient
  }
}

export interface IncompleteAsrSession {
  /** The next utterance may claim this separate fragment only in the same state. */
  discard: () => void
  retain: (transcript: string, state?: FastPathDecisionState) => void
  snapshot: () => { expiresAt: number, transcript: string, stateKey?: string } | undefined
}

/**
 * Holds one unfinished speech turn for at most three seconds. It deliberately
 * never joins transcripts: the following speech may belong to another person
 * or a completely different request.
 */
export function createIncompleteAsrSession(now: () => number = () => Date.now()): IncompleteAsrSession {
  let incomplete: { expiresAt: number, transcript: string, stateKey?: string } | undefined

  return {
    discard() {
      incomplete = undefined
    },
    retain(transcript, state) {
      incomplete = { expiresAt: now() + 3_000, transcript, ...(state ? { stateKey: unfinishedStateKey(state) } : {}) }
    },
    snapshot() {
      if (incomplete && incomplete.expiresAt <= now())
        incomplete = undefined
      return incomplete
    },
  }
}

function unfinishedStateKey(state: FastPathDecisionState) {
  return JSON.stringify({ phase: state.phase, revisions: state.revisions, questionId: state.waitingFor?.questionId })
}

interface WebMcpBridge {
  availability?: 'idle' | 'loading' | 'ready' | 'unavailable'
  execute: (tool: ServiceTool, input: Record<string, unknown>) => Promise<unknown>
  tools: readonly ServiceTool[]
}

const candidateToolName = 'kiosk_fast_path_context'
const executeToolName = 'kiosk_fast_path_execute'

/**
 * Executes one Dasein-selected operation against the same Menu runtime as
 * the visible menu. The model only receives candidate IDs and descriptions;
 * input arguments always come back from the browser-produced candidate set.
 */
export async function runFastPath(input: {
  /** Uncached server activation check before any candidate or direct action. */
  isEnabled: () => Promise<boolean>
  activeRequest?: { stage: 'starting' | 'thinking' | 'tool_requested' | 'mutating', text: string }
  decide: (request: { candidates: FastPathCandidate[], decisionState?: FastPathDecisionState, includeTrace?: boolean, maxQuestions?: number, presenceState?: PresenceState, review?: { answer: string, observation: string }, signal?: AbortSignal, recoveryUsed?: boolean, transcript: string }) => Promise<FastPathDecision>
  onUtteranceAccepted?: () => Promise<void> | void
  onExecuted?: (result: unknown) => Promise<void>
  onTrace?: (trace: { browserContext: unknown, decision: FastPathDecision, decisionSource?: 'application' | 'system-one' | 'main-skill', executionResult?: unknown, rawTranscript?: string, transcript: string }) => void
  onActionSelected?: (action: FastPathCandidate) => Promise<'DEFER' | void> | 'DEFER' | void
  isCurrent?: () => boolean
  presenceState?: PresenceState
  session?: IncompleteAsrSession
  serviceClarification?: (state: FastPathDecisionState) => ServiceClarification | undefined
  transcript: string
  webMcp: WebMcpBridge
}): Promise<FastPathResult> {
  const transcript = normalizeTranscript(input.transcript)
  const onTrace = input.onTrace
  input = { ...input, transcript: transcript.normalized, onTrace: trace => onTrace?.({ ...trace, rawTranscript: transcript.raw }) }
  if (!input.transcript)
    return { kind: 'IGNORE' }
  // Missing tools after a transport failure are not an administrator disabling
  // System One. Do not admit ambient speech into a Main task without Menu IO.
  if (input.webMcp.availability !== undefined && input.webMcp.availability !== 'ready')
    return { kind: 'SERVICE_UNAVAILABLE' }
  let browserContext: unknown
  let recoveryUsed = false
  let utteranceAccepted = false
  let staffAnswerResolved = false
  let decisionState: FastPathDecisionState | undefined
  const handoff = async (reason: 'SYSTEM_ONE_DISABLED' | 'PROVIDER_FAILURE', failedDecision?: FastPathDecision): Promise<FastPathResult> => {
    if (input.isCurrent?.() === false)
      return { kind: 'DEFERRED' }
    // The host-only snapshot does not issue/consume candidates or clear the
    // pending question. Main Agent may obtain its own evidence if it is absent.
    if (!decisionState) {
      const stateTool = input.webMcp.tools.find(tool => tool.name === 'kiosk_interaction_state')
      if (stateTool) {
        try {
          browserContext = await input.webMcp.execute(stateTool, {})
          decisionState = decisionStateFrom(browserContext)
        }
        catch {
          // Losing optional context cannot turn a provider failure into an
          // authorized operation. The Agent still needs real tool validation.
        }
      }
    }
    if (input.isCurrent?.() === false)
      return { kind: 'DEFERRED' }
    if (decisionState?.phase === 'query_scope' && decisionState.waitingFor)
      return { kind: 'CLARIFICATION', prompt: decisionState.waitingFor.question, question: decisionState.waitingFor, decisionState }
    const decision: FastPathDecision = { kind: 'NEEDS_ASSISTANT', reason, ...(failedDecision?.trace ? { trace: failedDecision.trace } : {}), ...(failedDecision?.modelCalls !== undefined ? { modelCalls: failedDecision.modelCalls } : {}), ...(failedDecision?.modelQuestions !== undefined ? { modelQuestions: failedDecision.modelQuestions } : {}) }
    input.onTrace?.({ browserContext, decision, decisionSource: 'application', transcript: input.transcript })
    return { ...decision, ...(decisionState ? { decisionState } : {}) }
  }
  let enabled: boolean
  try {
    enabled = await input.isEnabled()
  }
  catch {
    return await handoff('PROVIDER_FAILURE')
  }
  if (input.isCurrent?.() === false)
    return { kind: 'DEFERRED' }
  if (!enabled)
    return await handoff('SYSTEM_ONE_DISABLED')

  // Catch only the external decision call. Browser execution errors remain a
  // separate outcome so a lost mutation receipt cannot cause an Agent replay.
  const decide = async (request: Parameters<typeof input.decide>[0]): Promise<FastPathDecision> => {
    const cue = request.decisionState && input.serviceClarification?.(request.decisionState)
    if (cue && decisionState)
      decisionState = { ...decisionState, serviceClarification: cue }
    // A live staff offer owns a bare yes/no answer. Requalifying it as a
    // fresh order can turn 好啊 into “arrange this meal”. Keep this handoff
    // read-only; Main still interprets acceptance/refusal and owns the reply.
    // Whole-utterance matching excludes compound orders and addressed speech.
    const staffAnswer = /^(?:[好對是]|好啊|好的|是的|可以|不用|不需要|不要|不用了)[\s，。！？,.!?]*$/u.test(input.transcript.trim())
    if (cue?.purpose === 'staff-assistance' && !input.activeRequest && staffAnswer
      && cue.contextKey === serviceContextKey(request.decisionState!)) {
      if (!utteranceAccepted) {
        await input.onUtteranceAccepted?.()
        utteranceAccepted = true
      }
      staffAnswerResolved = true
      return { kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION', requestScope: 'service-information', modelCalls: 0, modelQuestions: 0 }
    }
    let result: FastPathDecision
    try {
      result = await input.decide({ ...request, recoveryUsed, ...(cue ? { decisionState: { ...request.decisionState!, serviceClarification: cue } } : {}) })
    }
    catch {
      return { kind: 'UNAVAILABLE', reason: 'PROVIDER_FAILURE' }
    }
    // History admission is a Host side effect, not a provider response. A local
    // recording failure must not be relabeled as model failure and replayed.
    if (!utteranceAccepted && ['SCOPE_CHOICE', 'FAST_ACTION', 'NEEDS_ASSISTANT', 'GREET', 'FOLLOW_UP_ACTIVE', 'CLARIFICATION', 'NEEDS_CLARIFICATION', 'SERVICE_CLARIFICATION'].includes(result.kind)) {
      await input.onUtteranceAccepted?.()
      utteranceAccepted = true
    }
    recoveryUsed ||= result.recovery?.status === 'completed' || result.recovery?.status === 'failed'
    return result
  }
  const candidateTool = input.webMcp.tools.find(tool => tool.name === candidateToolName)
  if (!candidateTool) {
    browserContext = { error: 'Kiosk semantic context tool is unavailable.' }
    return await handoff('SYSTEM_ONE_DISABLED')
  }

  let executionStarted = false
  const notifyExecuted = async (result: unknown) => {
    try {
      await input.onExecuted?.(result)
    }
    catch (error) {
      // Recording/presentation observers cannot revoke an accepted browser
      // receipt or cause its mutation to be retried as an unavailable decision.
      input.onTrace?.({ browserContext: { error: errorMessageFrom(error) ?? 'Receipt observer failed' }, decision: { kind: 'UNAVAILABLE' }, executionResult: result, transcript: input.transcript })
    }
  }
  try {
    let rawCandidates: unknown
    // Refresh a failed read once within the same turn. Never replay a write.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        rawCandidates = await input.webMcp.execute(candidateTool, { transcript: input.transcript })
        if (!rawCandidates || typeof rawCandidates !== 'object' || !('ok' in rawCandidates) || rawCandidates.ok !== false)
          break
      }
      catch (error) {
        if (attempt === 1)
          throw error
      }
      if (input.isCurrent?.() === false)
        return { kind: 'DEFERRED' }
    }
    browserContext = rawCandidates
    decisionState = decisionStateFrom(rawCandidates)
    let candidates = candidatesFrom(rawCandidates)
    const fragment = input.session?.snapshot()
    const unfinished = fragment && decisionState && fragment.stateKey === unfinishedStateKey(decisionState) ? fragment : undefined
    // A real locked phase has no writable candidates, but still admits a
    // bounded information/background decision. A missing snapshot does not.
    if ((rawCandidates && typeof rawCandidates === 'object' && 'ok' in rawCandidates && rawCandidates.ok === false)
      || (candidates.length === 0 && !decisionState && !input.activeRequest)) {
      // A failed/missing browser snapshot is a technical failure, not evidence
      // that this utterance is background speech. Preserve it in the fault UI.
      const decision: FastPathDecision = { kind: 'UNAVAILABLE', recovery: { status: 'failed', failure: 'invalid' } }
      input.onTrace?.({ browserContext: rawCandidates, decision, transcript: input.transcript })
      return { ...decision, ...(decisionState ? { decisionState } : {}) }
    }

    const resolvedCandidateId = rawCandidates && typeof rawCandidates === 'object' && 'resolvedCandidateId' in rawCandidates
      ? (rawCandidates as Record<string, unknown>).resolvedCandidateId
      : undefined
    const applicationResolved = (!decisionState || !input.serviceClarification?.(decisionState)) && typeof resolvedCandidateId === 'string' && candidates.some(candidate => candidate.id === resolvedCandidateId)
    let decision: FastPathDecision = applicationResolved
      ? { actionId: resolvedCandidateId, kind: 'FAST_ACTION' }
      : await decide({
          candidates,
          decisionState: decisionState || input.activeRequest ? { ...(decisionState ?? { phase: 'unknown' }), ...(input.activeRequest ? { activeRequest: input.activeRequest } : {}), ...(unfinished ? { incompleteSpeech: { transcript: unfinished.transcript, expiresAt: unfinished.expiresAt } } : {}) } : undefined,
          includeTrace: true,
          ...(input.presenceState ? { presenceState: input.presenceState } : {}),
          transcript: input.transcript,
        })
    if (decision.recovery?.contextKey) {
      // Revalidation reads state only. The decision producer renews answer
      // leases, which would invalidate this same utterance's recovered result.
      const stateTool = input.webMcp.tools.find(tool => tool.name === 'kiosk_interaction_state')
      const current = stateTool ? decisionStateFrom(await input.webMcp.execute(stateTool, {})) : undefined
      // Menu omits an older question from an issued independent-request scope.
      // A read-only snapshot still includes that displayed question; compare
      // the same request scope while retaining every revision/freshness check.
      const currentScope = current && !decisionState?.waitingFor && decisionState?.intentRecovery?.kind === 'request'
        ? { ...current, waitingFor: undefined }
        : current
      if (!current || !currentScope || serviceContextKey(currentScope) !== serviceContextKey(decisionState ?? { phase: 'unknown' }) || input.isCurrent?.() === false)
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST', decisionState }
      if (decision.kind === 'SERVICE_CLARIFICATION')
        decision = { ...decision, question: { ...decision.question, contextKey: serviceContextKey(current) } }
    }
    if (decision.kind === 'SCOPE_CHOICE') {
      const scopeTool = input.webMcp.tools.find(tool => tool.name === 'kiosk_query_scope')
      const questionId = decisionState?.waitingFor?.questionId
      if (!scopeTool || !questionId || input.isCurrent?.() === false)
        return { kind: 'UNAVAILABLE', decisionState }
      const receipt = await input.webMcp.execute(scopeTool, { questionId, choice: decision.choice, transcript: input.transcript })
      input.onTrace?.({ browserContext: rawCandidates, decision, decisionSource: 'application', executionResult: receipt, transcript: input.transcript })
      const outcome = receipt as { status?: string, pendingCustomerChoice?: PresentedQuestion, customerMessage?: string }
      if (outcome.status === 'NEW_REQUEST') {
        rawCandidates = await input.webMcp.execute(candidateTool, { transcript: input.transcript })
        decisionState = decisionStateFrom(rawCandidates)
        candidates = candidatesFrom(rawCandidates)
        decision = await decide({ candidates, decisionState, transcript: input.transcript, includeTrace: true })
      }
      else {
        if (outcome.status === 'IGNORE')
          return { kind: 'IGNORE', decisionState }
        await notifyExecuted(receipt)
        if (outcome.pendingCustomerChoice)
          return { kind: 'CLARIFICATION', prompt: outcome.pendingCustomerChoice.question, question: outcome.pendingCustomerChoice, decisionState }
        return { kind: 'FAST_ACTION', action: { id: 'query-scope', description: '依確認範圍查詢餐點' }, result: receipt, decisionState }
      }
    }
    let spent = applicationResolved ? 0 : decision.modelQuestions
    if (decisionState?.phase === 'query_scope' && decisionState.waitingFor && decision.kind !== 'SCOPE_CHOICE')
      return { kind: 'CLARIFICATION', prompt: decisionState.waitingFor.question, question: decisionState.waitingFor, decisionState }
    if (decision.reason === 'PROVIDER_FAILURE' || decision.reason === 'SYSTEM_ONE_DISABLED')
      return await handoff(decision.reason, decision)
    // Defer fragment expiry-by-state until a real semantic result exists;
    // an infrastructure failure must not consume the pending speech fragment.
    if (fragment && !unfinished)
      input.session?.discard()
    if (decision.kind === 'CONTINUE_INCOMPLETE' && unfinished) {
      if (spent === undefined || spent >= decisionQuestionBudget)
        return { kind: 'NEEDS_ASSISTANT', decisionState }
      // The model established relation, not a joined transcript. The browser
      // resolves catalog targets and slots from the two separate fragments.
      rawCandidates = await input.webMcp.execute(candidateTool, { transcript: input.transcript, previousTranscript: unfinished.transcript })
      const current = decisionStateFrom(rawCandidates)
      if (!current || !decisionState || unfinishedStateKey(current) !== unfinishedStateKey(decisionState)) {
        input.session?.discard()
        return { kind: 'UNAVAILABLE', decisionState: current }
      }
      decisionState = { ...current, incompleteSpeech: { transcript: unfinished.transcript, expiresAt: unfinished.expiresAt, related: true } }
      candidates = candidatesFrom(rawCandidates)
      decision = await decide({ candidates, decisionState: { ...current, incompleteSpeech: { transcript: unfinished.transcript, expiresAt: unfinished.expiresAt, related: true } }, includeTrace: true, maxQuestions: decisionQuestionBudget - spent, transcript: input.transcript })
      spent = decision.modelQuestions === undefined ? undefined : spent + decision.modelQuestions
      if (decision.reason === 'PROVIDER_FAILURE' || decision.reason === 'SYSTEM_ONE_DISABLED')
        return await handoff(decision.reason, decision)
      input.session?.discard()
    }
    if (decision.kind === 'CONTINUE_INCOMPLETE')
      return { kind: 'UNAVAILABLE', decisionState }
    const decisionSource = applicationResolved || staffAnswerResolved ? 'application' : decision.resolvedBy === 'main-skill' ? 'main-skill' : 'system-one'
    decisionState = resolvedPriceState(decisionState, decision)
    if (decision.reason === 'UNSUPPORTED_PRICE')
      return { kind: 'CLARIFICATION', prompt: priceClarification, decisionState }
    input.onTrace?.({ browserContext: rawCandidates, decision, decisionSource, transcript: input.transcript })
    if (decisionState?.phase === 'clarification' && decision.kind === 'CLARIFICATION') {
      const question = decisionState.waitingFor
      if (!question)
        return { kind: 'UNAVAILABLE', decisionState }
      // The server admitted a reply to this kiosk, but no unique target yet.
      // Keep the owned choices and identity; only explicit cancellation
      // may retire this request. Do not turn another question into a cart write.
      return { kind: 'CLARIFICATION', prompt: question.question, question, decisionState }
    }
    if (decision.kind === 'INCOMPLETE') {
      input.session?.retain(input.transcript, decisionState)
      return { ...decision, ...(decisionState ? { decisionState } : {}) }
    }
    // Ambiguous targets are resolved by the browser against real references;
    // the model cannot create a free-form clarification turn.
    if (decision.kind === 'CLARIFICATION')
      return { kind: 'UNAVAILABLE', ...(decisionState ? { decisionState } : {}) }
    // Any complete turn replaces, rather than extends, unfinished speech.
    const needsNewDecision = decision.kind === 'NEEDS_ASSISTANT' && decision.reason === 'NEW_REQUEST' && ['configuration', 'clarification', 'meal_confirmation'].includes(decisionState?.phase ?? '')
    if (decision.kind !== 'IGNORE' && !needsNewDecision)
      input.session?.discard()
    if (needsNewDecision) {
      const question = decisionState?.waitingFor
      if (!question || spent === undefined || spent >= decisionQuestionBudget)
        return { kind: 'UNAVAILABLE', decisionState }
      if (input.isCurrent?.() === false)
        return { kind: 'DEFERRED', decisionState }
      // One route-qualified topic change, using the same utterance and ticket.
      // Queries leave the old draft intact; only a verified new meal replaces it.
      rawCandidates = await input.webMcp.execute(candidateTool, { transcript: input.transcript, newRequestQuestionId: question.questionId })
      decisionState = decisionStateFrom(rawCandidates)
      if (!decisionState || ['configuration', 'clarification', 'meal_confirmation', 'pending_confirmation'].includes(decisionState.phase))
        return { kind: 'UNAVAILABLE', decisionState }
      candidates = candidatesFrom(rawCandidates)
      decision = await decide({ transcript: input.transcript, candidates, decisionState, includeTrace: true, ...(input.presenceState ? { presenceState: input.presenceState } : {}), maxQuestions: decisionQuestionBudget - spent })
      if (decision.reason === 'PROVIDER_FAILURE' || decision.reason === 'SYSTEM_ONE_DISABLED')
        return await handoff(decision.reason, decision)
      if (decision.kind !== 'IGNORE')
        input.session?.discard()
      decisionState = resolvedPriceState(decisionState, decision)
      if (decision.reason === 'UNSUPPORTED_PRICE')
        return { kind: 'CLARIFICATION', prompt: priceClarification, decisionState }
      spent = decision.modelQuestions === undefined ? undefined : spent + decision.modelQuestions
      input.onTrace?.({ browserContext: rawCandidates, decision, decisionSource: 'system-one', transcript: input.transcript })
      if (decision.kind === 'INCOMPLETE')
        input.session?.retain(input.transcript, decisionState)
      if (decision.kind === 'CONTINUE_INCOMPLETE' || decision.kind === 'CLARIFICATION')
        return { kind: 'UNAVAILABLE', decisionState }
    }
    if (decision.kind === 'NEEDS_ASSISTANT' && decision.reason === 'NEW_REQUEST' && decisionState?.phase === 'pending_confirmation') {
      const cancel = candidates.find(candidate => candidate.id.startsWith('intent:cancel-confirmation:'))
      const executeTool = input.webMcp.tools.find(tool => tool.name === executeToolName)
      const stateTool = input.webMcp.tools.find(tool => tool.name === 'kiosk_interaction_state')
      if (!cancel || !executeTool || !stateTool)
        return { kind: 'UNAVAILABLE', decisionState }
      if (input.isCurrent?.() === false)
        return { kind: 'DEFERRED', decisionState }
      // Revoke only this exact financial/destructive confirmation. The runtime
      // rejects stale IDs; no new demand inherits the old authorization.
      const revoked = await input.webMcp.execute(executeTool, { candidateId: cancel.id })
      if (revoked && typeof revoked === 'object' && 'ok' in revoked && revoked.ok === false)
        return { kind: 'UNAVAILABLE', decisionState }
      input.onTrace?.({ browserContext: rawCandidates, decision, decisionSource: 'application', executionResult: revoked, transcript: input.transcript })
      decisionState = decisionStateFrom(await input.webMcp.execute(stateTool, {}))
    }
    if (decision.kind === 'NEEDS_CLARIFICATION') {
      const clarifyTool = input.webMcp.tools.find(tool => tool.name === 'kiosk_fast_path_clarify')
      const questionId = decisionState?.phase === 'meal_confirmation' ? decisionState.waitingFor?.questionId : decisionState?.clarificationOffer?.id
      if (!clarifyTool || !questionId || input.isCurrent?.() === false)
        return { kind: 'UNAVAILABLE', decisionState }
      const receipt = await input.webMcp.execute(clarifyTool, { questionId })
      const question = receipt && typeof receipt === 'object' ? presentedQuestionFrom((receipt as Record<string, unknown>).pendingCustomerChoice) : undefined
      if (!question)
        return { kind: 'UNAVAILABLE', decisionState }
      input.onTrace?.({ browserContext: rawCandidates, decision, decisionSource: 'system-one', executionResult: receipt, transcript: input.transcript })
      await notifyExecuted(receipt)
      return { kind: 'CLARIFICATION', prompt: question.question, question, silent: Boolean(receipt && typeof receipt === 'object' && 'silent' in receipt && receipt.silent === true), decisionState }
    }
    if (decision.kind === 'SCOPE_CHOICE')
      return { kind: 'UNAVAILABLE', decisionState }
    if (decision.kind === 'FOLLOW_UP_ACTIVE') {
      if (input.activeRequest?.stage !== 'thinking')
        return { kind: 'DEFERRED', decisionState }
      // No browser tool has run. The replacement task owns both accepted
      // utterances, in order; history alone does not bind unfinished intent.
      return { ...decision, decisionState, requestText: `${input.activeRequest.text}\n${input.transcript}` }
    }
    if (decision.kind !== 'FAST_ACTION')
      return decision.kind === 'COMPLETE' ? { kind: 'UNAVAILABLE', decisionState } : { ...decision, ...(decisionState ? { decisionState } : {}) }

    const action = candidates.find(candidate => candidate.id === decision.actionId)
    if (!action)
      return { kind: 'UNAVAILABLE', ...(decisionState ? { decisionState } : {}) }
    const executeTool = input.webMcp.tools.find(tool => tool.name === executeToolName)
    if (!executeTool)
      return { kind: 'UNAVAILABLE', ...(decisionState ? { decisionState } : {}) }

    // A barge-in can replace an active Main Agent turn. Let the Kiosk cancel
    // that turn before this browser mutation starts, so two planners never
    // race to modify the cart.
    const selectedDisposition = await input.onActionSelected?.(action)
    if (selectedDisposition === 'DEFER' || input.isCurrent?.() === false)
      return { kind: 'DEFERRED', ...(decisionState ? { decisionState } : {}) }

    // These finite candidates only read/present menu or cart facts. A lost
    // read receipt must not be treated as an unknown purchase. Unknown/new
    // action kinds retain the conservative write policy.
    const mayChangeOrder = !['intent:search-menu', 'intent:search-all-menu', 'intent:recommend', 'intent:recommend-more', 'intent:view-cart', 'intent:return-menu'].includes(action.id)
    executionStarted = mayChangeOrder
    let result = await input.webMcp.execute(executeTool, { candidateId: action.id, ...(decision.priceChoiceId ? { priceChoiceId: decision.priceChoiceId } : {}), ...(decision.searchInterpretation ? { searchInterpretation: decision.searchInterpretation } : {}), ...(decision.ingredientFilters ? { ingredientFilters: decision.ingredientFilters } : {}) })
    executionStarted = false
    input.onTrace?.({ browserContext: rawCandidates, decision, decisionSource, executionResult: result, transcript: input.transcript })
    if (result && typeof result === 'object' && 'ok' in result && result.ok === false) {
      const knownUnexecuted = ('executed' in result && result.executed === false) || ('rejection' in result && result.rejection === 'item-selection')
      return { kind: 'EXECUTION_FAILED', uncertain: mayChangeOrder && !knownUnexecuted, result, decisionState }
    }
    decisionState = completedReadState(decisionState, result)
    await notifyExecuted(result)
    if (result && typeof result === 'object' && (result as Record<string, unknown>).needsAssistant === true)
      return { kind: 'NEEDS_ASSISTANT', ...(decisionState ? { decisionState } : {}), ...(typeof result === 'object' && result && 'handoff' in result ? { handoff: parse(handoffSchema, result.handoff) } : {}) }
    // There is at most one extra browser-issued read. The final review has
    // only COMPLETE/NEEDS_ASSISTANT, so it cannot create another read loop.
    if (result && typeof result === 'object' && 'continuation' in result) {
      const unresolvedReviewState = (review: FastPathDecision) => {
        const rejectedUnderstanding = review.kind === 'UNAVAILABLE' || review.reason === 'DEVIATED' || review.reason === 'UNCERTAIN_REVIEW'
        return rejectedUnderstanding && decisionState ? { ...decisionState, constraints: undefined } : decisionState
      }
      if (spent === undefined || spent >= decisionQuestionBudget)
        return { kind: 'NEEDS_ASSISTANT', decisionState }
      const continuation = (result as { continuation?: { answer: string, candidates: FastPathCandidate[], observation: string } }).continuation
      const continueTool = input.webMcp.tools.find(tool => tool.name === 'kiosk_fast_path_continue')
      if (continuation && continueTool && input.isCurrent?.() !== false) {
        const next = await decide({ candidates: continuation.candidates, decisionState, includeTrace: true, maxQuestions: decisionQuestionBudget - spent, review: { answer: continuation.answer, observation: JSON.stringify({ actualResult: continuation.observation, understanding: { intent: action.id, searchInterpretation: decision.searchInterpretation, conditions: decision.ingredientFilters, price: decisionState?.constraints?.price } }).slice(0, 4_000) }, signal: AbortSignal.timeout(5_000), transcript: input.transcript })
        input.onTrace?.({ browserContext: { ...decisionState, candidates: continuation.candidates, review: continuation }, decision: next, transcript: input.transcript })
        if (next.reason === 'PROVIDER_FAILURE' || next.reason === 'SYSTEM_ONE_DISABLED')
          return await handoff(next.reason, next)
        if (next.kind === 'FAST_ACTION' && continuation.candidates.some(candidate => candidate.id === next.actionId) && input.isCurrent?.() !== false) {
          try {
            const continued = await input.webMcp.execute(continueTool, { candidateId: next.actionId })
            if (continued && typeof continued === 'object' && 'ok' in continued && continued.ok === false)
              return { kind: 'NEEDS_ASSISTANT', decisionState }
            result = continued
            decisionState = completedReadState(decisionState, result)
            await notifyExecuted(result)
            input.onTrace?.({ browserContext: rawCandidates, decision: next, executionResult: result, transcript: input.transcript })
            if (result && typeof result === 'object' && 'needsAssistant' in result && result.needsAssistant === true)
              return { kind: 'NEEDS_ASSISTANT', decisionState }
            if (next.modelQuestions === undefined || spent + next.modelQuestions >= decisionQuestionBudget)
              return { kind: 'NEEDS_ASSISTANT', decisionState }
            const finalReview = await decide({ candidates: [], decisionState, includeTrace: true, maxQuestions: decisionQuestionBudget - spent - next.modelQuestions, review: {
              answer: customerMessageFromResult(result),
              observation: JSON.stringify(decisionState?.completedReads?.map(receipt => ({ customerMessage: receipt.customerMessage })) ?? []).slice(0, 4_000),
            }, signal: AbortSignal.timeout(5_000), transcript: input.transcript })
            input.onTrace?.({ browserContext: { ...decisionState, candidates: [] }, decision: finalReview, executionResult: result, transcript: input.transcript })
            if (finalReview.reason === 'PROVIDER_FAILURE' || finalReview.reason === 'SYSTEM_ONE_DISABLED')
              return await handoff(finalReview.reason, finalReview)
            if (finalReview.kind !== 'COMPLETE')
              return { kind: 'NEEDS_ASSISTANT', decisionState: unresolvedReviewState(finalReview) }
          }
          catch (error) {
            // The first lookup already succeeded. A stale or failed optional
            // read must not erase its answer or retry the original operation.
            input.onTrace?.({ browserContext: { error: errorMessageFrom(error) ?? 'Read continuation unavailable' }, decision: { kind: 'UNAVAILABLE' }, transcript: input.transcript })
            return { kind: 'NEEDS_ASSISTANT', decisionState }
          }
        }
        else if (next.kind !== 'COMPLETE') {
          // A rejected understanding is not a mandatory customer condition.
          // Preserve read receipts, but Main Agent must resolve the original
          // utterance rather than inherit this model's filter as a fact.
          return { kind: 'NEEDS_ASSISTANT', decisionState: unresolvedReviewState(next) }
        }
        // COMPLETE ends the read here; every other result hands off the
        // verified receipt instead of repeating the successful lookup.
      }
      else {
        return { kind: 'NEEDS_ASSISTANT', decisionState }
      }
    }
    return {
      action,
      kind: 'FAST_ACTION',
      result,
      ...(decisionState ? { decisionState } : {}),
    }
  }
  catch (error) {
    const decision: FastPathDecision = { kind: 'UNAVAILABLE', recovery: { status: 'failed', failure: 'provider-error' } }
    input.onTrace?.({ browserContext: { snapshot: browserContext, error: errorMessageFrom(error) ?? 'Fast Path unavailable' }, decision, transcript: input.transcript })
    // Show a technical fault without treating it as permission to invoke Main
    // or retry an operation whose execution may already have started.
    return executionStarted ? { kind: 'EXECUTION_FAILED', uncertain: true, decisionState } : { ...decision, ...(decisionState ? { decisionState } : {}) }
  }
}

function customerMessageFromResult(result: unknown) {
  return result && typeof result === 'object' && 'customerMessage' in result && typeof result.customerMessage === 'string' ? result.customerMessage.slice(0, 2_000) : ''
}

// Only a selection from this turn's browser evidence may survive a handoff.
// Unknown/unsupported interpretations keep the task guarded against broad reads.
function resolvedPriceState(state: FastPathDecisionState | undefined, decision: FastPathDecision) {
  if (!state?.priceEvidence)
    return state
  const choice = state.priceEvidence.choices.find(choice => choice.id === decision.priceChoiceId)
  return { ...state, constraints: { ...(state.constraints ?? { exclude: [] }), ...(choice?.conditions ? { price: choice.conditions } : {}), unresolvedPrice: !choice || choice.kind === 'unsupported' } }
}

/** Only successful executed reads can become handoff facts, never a model plan. */
function completedReadState(state: FastPathDecisionState | undefined, result: unknown) {
  if (!result || typeof result !== 'object')
    return state
  const receipt = result as Record<string, unknown>
  const executed = receipt.decisionTrace as { operationPlan?: { toolName?: string } } | undefined
  const toolName = executed?.operationPlan?.toolName
  if (!toolName || !['menu_get', 'menu_recommend', 'menu_show_recommendations'].includes(toolName) || receipt.ok === false)
    return state
  const filters = receipt.appliedFilters as { excludeIngredients?: unknown, includeIngredients?: unknown, dietary?: unknown } | undefined
  const validFilters = filters && Array.isArray(filters.excludeIngredients) && filters.excludeIngredients.every(id => typeof id === 'string') && Array.isArray(filters.includeIngredients) && filters.includeIngredients.every(id => typeof id === 'string')
  return {
    ...(state ?? { phase: 'unknown' }),
    ...(validFilters ? { constraints: { ...state?.constraints, exclude: filters.excludeIngredients as string[], include: filters.includeIngredients as string[], ...(filters.dietary === 'vegetarian' ? { dietary: 'vegetarian' as const } : {}), ...(receipt.appliedPriceConditions && typeof receipt.appliedPriceConditions === 'object' ? { price: receipt.appliedPriceConditions as NonNullable<FastPathDecisionState['constraints']>['price'] } : {}) } } : {}),
    completedReads: [...(state?.completedReads ?? []), { toolName, customerMessage: customerMessageFromResult(receipt) }].slice(-2),
  }
}

/** Replaces live facts while retaining only the current task's semantic authority. */
export function refreshConversationState(context: ConversationContext, task?: KioskConversationDecisionState): KioskConversationDecisionState {
  const { excludeIngredients, includeIngredients, dietary, ...price } = context.constraints
  const invitation = task?.serviceClarification
  if (invitation?.unavailableConditions?.length && invitation.contextKey === serviceContextKey(context))
    context = { ...context, unavailableConditions: invitation.unavailableConditions }
  if (invitation?.purpose === 'order-assistance' && invitation.contextKey === serviceContextKey(context))
    context = { ...context, orderAssistance: { questionId: invitation.questionId, expiresAt: invitation.expiresAt } }
  if (invitation?.purpose === 'staff-assistance' && invitation.contextKey === serviceContextKey(context))
    context = { ...context, staffAssistance: { questionId: invitation.questionId, expiresAt: invitation.expiresAt } }
  return {
    ...task,
    context,
    phase: context.phase,
    menuRevision: context.revisions.menu,
    readOnly: task?.readOnly === true || context.readOnly,
    serviceMode: context.serviceMode,
    handoff: context.handoff ?? task?.handoff,
    constraints: { exclude: excludeIngredients, include: includeIngredients, ...(dietary ? { dietary } : {}), ...(Object.keys(price).length ? { price } : {}), ...(task?.constraints?.unresolvedPrice ? { unresolvedPrice: true } : {}) },
    retainedRequests: context.retainedRequests,
    intentRecovery: context.intentRecovery,
    waitingFor: context.waitingFor,
    paymentState: context.paymentState,
    allowedPaymentMethods: context.allowedPaymentMethods,
    fulfillmentModes: context.fulfillmentModes.filter((mode): mode is { id: 'dine-in' | 'takeout', label: string } => mode.id === 'dine-in' || mode.id === 'takeout'),
    // Current screen/selection/cart live in context. An omitted question or
    // focus retires the old one, rather than inheriting a historical snapshot.
    interactionState: undefined,
  }
}

export function conversationDecisionStateFrom(value: unknown, decision?: Pick<FastPathDecision, 'reason' | 'recovery' | 'resolvedBy' | 'requestScope' | 'priceChoiceId'> & { handoff?: ConversationHandoff }): KioskConversationDecisionState | undefined {
  const state = decisionStateFrom(value)
  if (!state)
    return undefined
  const interactionState = state.interactionState
  // A catalog-grounded meal handoff still needs menu evidence when its reason
  // is replacement, ambiguity or compound work rather than MENU_QUERY. Cart
  // references/recent focus alone are not current-utterance food evidence.
  const hasMealEvidence = (Array.isArray(state.catalogEvidence?.products) && state.catalogEvidence.products.length > 0)
    || (Array.isArray(state.catalogEvidence?.categories) && state.catalogEvidence.categories.length > 0)
  // Phone-stage menu requests stop at the fill/skip prerequisite. This read
  // contract applies to inquiries admitted after entry has completed.
  // An unresolved read can have no catalog match at all. Its fallback still
  // needs a lookup; absence of a known product is not permission for free prose.
  const unresolvedQuery = ['MENU_QUERY', 'UNCERTAIN_FILTER', 'UNRESOLVED_FILTER'].includes(decision?.reason ?? '')
  // An ordinary Agent handoff is not permission to invent menu facts merely
  // because literal catalog matching found nothing. General service questions
  // have an explicit reason; preserved task hints survive projection.
  const unclassifiedHandoff = Boolean(decision) && decision?.reason === undefined
  const uncertainMeaning = decision?.reason === 'UNCERTAIN_OPERATION'
  // A semantic abstention is not a menu query. Named meals may belong to a
  // withdrawn order or a compound edit, so Main must understand the whole turn
  // before deciding whether a factual lookup is needed.
  // Main has independently qualified the whole request as an operation. A
  // catalog mention must not force it through read-only lookup before editing.
  const qualifiedOperation = decision?.requestScope === 'order-operation'
  const orderInformation = decision?.requestScope === 'order-information'
  const serviceBoundary = decision?.requestScope === 'service-information' || decision?.requestScope === 'order-preservation'
  // A qualified price-information query can use the fresh complete Menu
  // catalog through the typed factual renderer; it is not a browse request.
  // Whole-request operations include any accompanying inquiry; they take
  // precedence over an earlier price-only interpretation of part of the turn.
  const priceInformation = !qualifiedOperation && decision?.priceChoiceId === 'INFORMATION' && hasMealEvidence
  const requireMenuRead = !priceInformation && !qualifiedOperation && !orderInformation && !serviceBoundary && !uncertainMeaning && (state.requireMenuRead === true || unresolvedQuery || (Boolean(decision) && state.phase !== 'customer_entry' && (hasMealEvidence || unclassifiedHandoff)))
  // Filter/price uncertainty permits clarification and factual lookup, never
  // a partial order edit. Keep that restriction through Agent continuations.
  // An uncertain phone choice grants conversation/read authority, never a
  // guessed skip, entered phone number or order. It need not query the menu.
  // Service admission says this utterance deserves a response, not which
  // mutation it authorizes. A resolved effect/target handoff retains its own
  // tool restrictions; otherwise uncertainty stays read-only in every phase.
  const protectedUncertainty = uncertainMeaning && !qualifiedOperation && !orderInformation && !serviceBoundary && !decision?.handoff
  const serviceAnswer = uncertainMeaning && state.serviceClarification && decision?.recovery?.readOnly === true
  const readOnly = priceInformation || orderInformation || decision?.requestScope === 'menu-information' || decision?.recovery?.readOnly === true || protectedUncertainty || ['GENERAL_QUESTION', 'MENU_QUERY', 'UNSUPPORTED_FILTER', 'UNCERTAIN_FILTER', 'UNRESOLVED_FILTER', 'UNSUPPORTED_PRICE'].includes(decision?.reason ?? '')
  const serviceQuestion = state.serviceClarification
  const assistanceQuestion = serviceQuestion && ['staff-assistance', 'order-assistance'].includes(serviceQuestion.purpose ?? '')
  const serviceAnswerAllowed = decision?.reason !== 'NEW_REQUEST' && decision?.requestScope !== 'order-operation'
    && (decision?.recovery?.readOnly === true || decision?.reason === 'GENERAL_QUESTION')
  return {
    ...(state.serviceMode ? { serviceMode: state.serviceMode } : {}),
    ...(decision?.requestScope ? { requestScope: decision.requestScope } : {}),
    ...(qualifiedOperation && decision?.priceChoiceId === 'INFORMATION' ? { priceInquiry: true } : {}),
    phase: state.phase,
    ...(state.revisions ? { revisions: state.revisions } : {}),
    // Unresolved meaning permits a conversational clarification, not a screen
    // transition. Service admission alone never grants browsing authority.
    ...(decision?.reason === 'GENERAL_QUESTION' || serviceAnswer || serviceBoundary ? { serviceReply: true } : {}),
    ...((protectedUncertainty && !requireMenuRead) || serviceBoundary ? { replyOnly: true } : {}),
    ...(serviceQuestion && !qualifiedOperation && (!assistanceQuestion || serviceAnswerAllowed) ? { serviceClarification: serviceQuestion } : {}),
    ...(decision?.handoff ? { handoff: decision.handoff } : {}),
    ...(requireMenuRead ? { requireMenuRead: true } : {}),
    // A fresh whole-turn operation qualification supersedes a generic
    // clarification's conservative read scope, not Menu's execution guards.
    ...(!qualifiedOperation && (readOnly || state.readOnly === true) ? { readOnly: true } : {}),
    ...(state.priceEvidence ? { priceEvidence: state.priceEvidence } : {}),
    ...((state.incompleteSpeech?.related || (uncertainMeaning && state.incompleteSpeech)) ? { incompleteSpeech: state.incompleteSpeech } : {}),
    ...(state.menuRevision !== undefined ? { menuRevision: state.menuRevision } : {}),
    ...(state.constraints ? { constraints: state.constraints } : {}),
    ...(state.completedReads ? { completedReads: state.completedReads } : {}),
    ...(state.unavailableConditionReferences ? { unavailableConditionReferences: state.unavailableConditionReferences } : {}),
    ...(state.fulfillmentModes ? { fulfillmentModes: state.fulfillmentModes } : {}),
    ...(state.retainedRequests ? { retainedRequests: state.retainedRequests } : {}),
    ...(state.intentRecovery ? { intentRecovery: state.intentRecovery } : {}),
    ...(state.waitingFor ? { waitingFor: state.waitingFor } : {}),
    ...(state.paymentState ? { paymentState: state.paymentState } : {}),
    ...(state.allowedPaymentMethods ? { allowedPaymentMethods: state.allowedPaymentMethods } : {}),
    ...(interactionState && Number.isInteger(interactionState.matchingCartLines) && interactionState.matchingCartLines >= 0
      ? { interactionState: {
          matchingCartLines: interactionState.matchingCartLines,
          ...(Number.isInteger(interactionState.cartItemCount) && Number(interactionState.cartItemCount) >= 0 ? { cartItemCount: Number(interactionState.cartItemCount) } : {}),
          ...(['menu', 'cart_review', 'item_configuration', 'request_confirmation', 'checkout'].includes(interactionState.screen ?? '') ? { screen: interactionState.screen } : {}),
          ...(typeof interactionState.lastAddedItemName === 'string' ? { lastAddedItemName: interactionState.lastAddedItemName } : {}),
          ...(typeof interactionState.selectedItemName === 'string' ? { selectedItemName: interactionState.selectedItemName } : {}),
          ...(typeof interactionState.pendingAction === 'string' ? { pendingAction: interactionState.pendingAction } : {}),
          ...(typeof interactionState.pendingIntent === 'string' ? { pendingIntent: interactionState.pendingIntent } : {}),
          ...(interactionState.seating && typeof interactionState.seating.ready === 'boolean' && typeof interactionState.seating.question === 'string' ? { seating: { ready: interactionState.seating.ready, question: interactionState.seating.question, ...(Number.isInteger(interactionState.seating.partySize) && Number(interactionState.seating.partySize) >= 1 && Number(interactionState.seating.partySize) <= 20 ? { partySize: interactionState.seating.partySize } : {}) } } : {}),
        } }
      : {}),
  }
}

function decisionStateFrom(value: unknown) {
  if (!value || typeof value !== 'object')
    return undefined
  const state = value as Record<string, unknown>
  if (typeof state.phase !== 'string')
    return undefined
  const waitingFor = presentedQuestionFrom(state.waitingFor)
  const serviceMode: FastPathDecisionState['serviceMode'] = state.serviceMode === 'kiosk' || state.serviceMode === 'table-service' ? state.serviceMode : undefined
  return {
    phase: state.phase,
    ...(state.intentRecovery !== undefined ? { intentRecovery: parse(intentRecoverySchema, state.intentRecovery) } : {}),
    ...(state.retainedRequests !== undefined ? { retainedRequests: parse(array(conversationRequestSchema), state.retainedRequests) } : {}),
    ...(state.serviceClarification && typeof state.serviceClarification === 'object' ? { serviceClarification: state.serviceClarification as ServiceClarification } : {}),
    ...(state.requireMenuRead === true ? { requireMenuRead: true } : {}),
    ...(state.readOnly === true ? { readOnly: true } : {}),
    ...(state.clarificationOffer && typeof state.clarificationOffer === 'object' && 'id' in state.clarificationOffer && typeof state.clarificationOffer.id === 'string' && 'label' in state.clarificationOffer && typeof state.clarificationOffer.label === 'string' ? { clarificationOffer: { id: state.clarificationOffer.id, label: state.clarificationOffer.label } } : {}),
    ...(state.priceEvidence && typeof state.priceEvidence === 'object' ? { priceEvidence: state.priceEvidence as FastPathDecisionState['priceEvidence'] } : {}),
    ...(state.catalogEvidence && typeof state.catalogEvidence === 'object' ? { catalogEvidence: state.catalogEvidence as FastPathDecisionState['catalogEvidence'] } : {}),
    ...(state.productResolution && typeof state.productResolution === 'object' ? { productResolution: state.productResolution as FastPathDecisionState['productResolution'] } : {}),
    ...(state.incompleteSpeech && typeof state.incompleteSpeech === 'object' ? { incompleteSpeech: state.incompleteSpeech as FastPathDecisionState['incompleteSpeech'] } : {}),
    ...(state.revisions && typeof state.revisions === 'object' ? { revisions: state.revisions as FastPathDecisionState['revisions'] } : {}),
    ...(Number.isInteger(state.menuRevision) && Number(state.menuRevision) >= 0 ? { menuRevision: Number(state.menuRevision) } : {}),
    ...(serviceMode ? { serviceMode } : {}),
    ...(Array.isArray(state.completedReads) ? { completedReads: state.completedReads as NonNullable<KioskConversationDecisionState['completedReads']> } : {}),
    ...(Array.isArray(state.fulfillmentModes) ? { fulfillmentModes: state.fulfillmentModes.filter((mode): mode is NonNullable<FastPathDecisionState['fulfillmentModes']>[number] => Boolean(mode && typeof mode === 'object' && (mode.id === 'dine-in' || mode.id === 'takeout') && typeof mode.label === 'string' && mode.label.trim())) } : {}),
    ...(Array.isArray(state.ingredientReferences) ? { ingredientReferences: state.ingredientReferences as Array<{ id: string, label: string }> } : {}),
    ...(Array.isArray(state.unavailableConditionReferences) ? { unavailableConditionReferences: state.unavailableConditionReferences as NonNullable<FastPathDecisionState['unavailableConditionReferences']> } : {}),
    ...(Array.isArray(state.dietaryReferences) ? { dietaryReferences: state.dietaryReferences.filter((reference): reference is { id: 'vegetarian', label: string } => Boolean(reference && typeof reference === 'object' && reference.id === 'vegetarian' && typeof reference.label === 'string')) } : {}),
    ...(waitingFor ? { waitingFor } : {}),
    ...(typeof state.paymentState === 'string' ? { paymentState: state.paymentState } : {}),
    ...(Array.isArray(state.allowedPaymentMethods) ? { allowedPaymentMethods: state.allowedPaymentMethods.filter((method): method is string => typeof method === 'string' && method.length > 0 && method.length <= 80) } : {}),
    ...(Array.isArray(state.references) ? { references: state.references as Array<{ label: string, refId: string }> } : {}),
    ...(state.constraints && typeof state.constraints === 'object' ? { constraints: state.constraints as FastPathDecisionState['constraints'] } : {}),
    ...(state.interactionState && typeof state.interactionState === 'object' ? { interactionState: state.interactionState as InteractionState } : {}),
    ...(state.checkoutSnapshot ? { checkoutSnapshot: state.checkoutSnapshot } : {}),
  }
}

function candidatesFrom(value: unknown): FastPathCandidate[] {
  if (!value || typeof value !== 'object')
    return []
  const rawCandidates = (value as Record<string, unknown>).candidates
  if (!Array.isArray(rawCandidates))
    return []

  return rawCandidates.flatMap((candidate: unknown): FastPathCandidate[] => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      return []
    const record = candidate as Record<string, unknown>
    if (
      typeof record.id !== 'string'
      || typeof record.description !== 'string'
    ) {
      return []
    }
    return [{
      description: record.description,
      id: record.id,
      ...(typeof record.requiresHighConfidence === 'boolean' ? { requiresHighConfidence: record.requiresHighConfidence } : {}),
    }]
  })
}
