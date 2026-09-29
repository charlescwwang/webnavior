import type { PresenceState } from '@proj-airi/kiosk-proactive'
import type { WebMcpTool } from '@proj-airi/stage-ui/services/webmcp-adapter'

import type { KioskConversationDecisionState } from './kiosk-device'

import { errorMessageFrom } from '@moeru/std'

export interface FastPathCandidate {
  description: string
  id: string
  requiresHighConfidence?: boolean
}

export interface FastPathDecisionState {
  allowedPaymentMethods?: Array<'card' | 'mobile'>
  checkoutSnapshot?: unknown
  constraints?: { exclude: string[] }
  interactionState?: { lastAddedItemName?: string, matchingCartLines: number, pendingAction?: string, pendingIntent?: string, selectedItemName?: string }
  paymentState?: string
  phase: string
  references?: Array<{ label: string, refId: string }>
}

export type FastPathDecision
  = | { actionId: string, confidence?: number, kind: 'FAST_ACTION', trace?: unknown }
    | { confidence?: number, kind: 'CLARIFICATION', trace?: unknown }
    | { confidence?: number, kind: 'INCOMPLETE', trace?: unknown }
    | { confidence?: number, kind: 'IGNORE', trace?: unknown }
    | { confidence?: number, kind: 'NEEDS_ASSISTANT', trace?: unknown }
    | { kind: 'UNAVAILABLE', trace?: unknown }

export type FastPathResult = {
  decisionState?: FastPathDecisionState
} & (
  | { action: FastPathCandidate, kind: 'FAST_ACTION', result: unknown }
  | { confidence?: number, kind: 'CLARIFICATION', prompt: string }
  | { confidence?: number, kind: 'INCOMPLETE' }
  | { confidence?: number, kind: 'IGNORE' }
  | { confidence?: number, kind: 'NEEDS_ASSISTANT' }
  | { kind: 'UNAVAILABLE' }
)

export interface IncompleteAsrSession {
  /** Retains diagnostics only; a later ASR result is always resolved afresh. */
  discard: () => void
  retain: (transcript: string) => void
  snapshot: () => { expiresAt: number, transcript: string } | undefined
}

/**
 * Holds one unfinished speech turn for at most three seconds. It deliberately
 * never joins transcripts: the following speech may belong to another person
 * or a completely different request.
 */
export function createIncompleteAsrSession(now: () => number = () => Date.now()): IncompleteAsrSession {
  let incomplete: { expiresAt: number, transcript: string } | undefined

  return {
    discard() {
      incomplete = undefined
    },
    retain(transcript) {
      incomplete = { expiresAt: now() + 3_000, transcript }
    },
    snapshot() {
      if (incomplete && incomplete.expiresAt <= now())
        incomplete = undefined
      return incomplete
    },
  }
}

interface WebMcpBridge {
  execute: (tool: WebMcpTool, input: Record<string, unknown>) => Promise<unknown>
  tools: readonly WebMcpTool[]
}

const candidateToolName = 'kiosk_fast_path_context'
const executeToolName = 'kiosk_fast_path_execute'

/**
 * Executes one Dasein-selected operation against the same WebMCP runtime as
 * the visible menu. The model only receives candidate IDs and descriptions;
 * input arguments always come back from the browser-produced candidate set.
 */
export async function runFastPath(input: {
  decide: (request: { candidates: FastPathCandidate[], decisionState?: FastPathDecisionState, includeTrace?: boolean, presenceState?: PresenceState, transcript: string }) => Promise<FastPathDecision>
  onTrace?: (trace: { browserContext: unknown, decision: FastPathDecision, decisionSource?: 'application' | 'system-one', executionResult?: unknown, transcript: string }) => void
  onActionSelected?: (action: FastPathCandidate) => Promise<void> | void
  presenceState?: PresenceState
  session?: IncompleteAsrSession
  transcript: string
  webMcp: WebMcpBridge
}): Promise<FastPathResult> {
  const candidateTool = input.webMcp.tools.find(tool => tool.name === candidateToolName)
  if (!candidateTool)
    return { kind: 'UNAVAILABLE' }

  let browserContext: unknown
  let decisionState: FastPathDecisionState | undefined
  try {
    const rawCandidates = await input.webMcp.execute(candidateTool, { transcript: input.transcript })
    browserContext = rawCandidates
    decisionState = decisionStateFrom(rawCandidates)
    const candidates = candidatesFrom(rawCandidates)
    if (candidates.length === 0)
      return { kind: 'UNAVAILABLE', ...(decisionState ? { decisionState } : {}) }

    const resolvedCandidateId = rawCandidates && typeof rawCandidates === 'object' && 'resolvedCandidateId' in rawCandidates
      ? (rawCandidates as Record<string, unknown>).resolvedCandidateId
      : undefined
    const applicationResolved = typeof resolvedCandidateId === 'string' && candidates.some(candidate => candidate.id === resolvedCandidateId)
    const decision: FastPathDecision = applicationResolved
      ? { actionId: resolvedCandidateId, kind: 'FAST_ACTION' }
      : await input.decide({
          candidates,
          decisionState,
          includeTrace: true,
          ...(input.presenceState ? { presenceState: input.presenceState } : {}),
          transcript: input.transcript,
        })
    const decisionSource = applicationResolved ? 'application' : 'system-one'
    input.onTrace?.({ browserContext: rawCandidates, decision, decisionSource, transcript: input.transcript })
    if (decisionState?.phase === 'clarification' && decision.kind !== 'FAST_ACTION')
      return { kind: 'CLARIFICATION', prompt: '這次無法確認你指的是哪一筆，請改用螢幕選擇。', decisionState }
    if (decision.kind === 'INCOMPLETE') {
      input.session?.retain(input.transcript)
      return { ...decision, ...(decisionState ? { decisionState } : {}) }
    }
    // Ambiguous targets are resolved by the browser against real references;
    // the model cannot create a free-form clarification turn.
    if (decision.kind === 'CLARIFICATION')
      return { kind: 'UNAVAILABLE', ...(decisionState ? { decisionState } : {}) }
    // Any complete turn replaces, rather than extends, unfinished speech.
    input.session?.discard()
    if (decision.kind !== 'FAST_ACTION')
      return { ...decision, ...(decisionState ? { decisionState } : {}) }

    const action = candidates.find(candidate => candidate.id === decision.actionId)
    if (!action)
      return { kind: 'UNAVAILABLE', ...(decisionState ? { decisionState } : {}) }
    const executeTool = input.webMcp.tools.find(tool => tool.name === executeToolName)
    if (!executeTool)
      return { kind: 'UNAVAILABLE', ...(decisionState ? { decisionState } : {}) }

    // A barge-in can replace an active Main Agent turn. Let the Kiosk cancel
    // that turn before this browser mutation starts, so two planners never
    // race to modify the cart.
    await input.onActionSelected?.(action)

    const result = await input.webMcp.execute(executeTool, { candidateId: action.id })
    input.onTrace?.({ browserContext: rawCandidates, decision, decisionSource, executionResult: result, transcript: input.transcript })
    if (result && typeof result === 'object' && (result as Record<string, unknown>).needsAssistant === true)
      return { kind: 'NEEDS_ASSISTANT', ...(decisionState ? { decisionState } : {}) }
    return {
      action,
      kind: 'FAST_ACTION',
      result,
      ...(decisionState ? { decisionState } : {}),
    }
  }
  catch (error) {
    input.onTrace?.({ browserContext: { snapshot: browserContext, error: errorMessageFrom(error) ?? 'Fast Path unavailable' }, decision: { kind: 'UNAVAILABLE' }, transcript: input.transcript })
    // The caller preserves this utterance and escalates it to Main Agent.
    // Returning the browser snapshot, when available, lets that Agent see
    // the current phase without treating a failed decision as user intent.
    return { kind: 'UNAVAILABLE', ...(decisionState ? { decisionState } : {}) }
  }
}

/** Projects a browser-owned state snapshot into a non-sensitive conversation hint. */
export function conversationDecisionStateFrom(value: unknown): KioskConversationDecisionState | undefined {
  const state = decisionStateFrom(value)
  if (!state)
    return undefined
  const interactionState = state.interactionState
  return {
    phase: state.phase,
    ...(state.paymentState ? { paymentState: state.paymentState } : {}),
    ...(state.allowedPaymentMethods ? { allowedPaymentMethods: state.allowedPaymentMethods } : {}),
    ...(interactionState && Number.isInteger(interactionState.matchingCartLines) && interactionState.matchingCartLines >= 0
      ? { interactionState: {
          matchingCartLines: interactionState.matchingCartLines,
          ...(typeof interactionState.lastAddedItemName === 'string' ? { lastAddedItemName: interactionState.lastAddedItemName } : {}),
          ...(typeof interactionState.selectedItemName === 'string' ? { selectedItemName: interactionState.selectedItemName } : {}),
          ...(typeof interactionState.pendingAction === 'string' ? { pendingAction: interactionState.pendingAction } : {}),
          ...(typeof interactionState.pendingIntent === 'string' ? { pendingIntent: interactionState.pendingIntent } : {}),
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
  return {
    phase: state.phase,
    ...(typeof state.paymentState === 'string' ? { paymentState: state.paymentState } : {}),
    ...(Array.isArray(state.allowedPaymentMethods) ? { allowedPaymentMethods: state.allowedPaymentMethods.filter((method): method is 'card' | 'mobile' => method === 'card' || method === 'mobile') } : {}),
    ...(Array.isArray(state.references) ? { references: state.references as Array<{ label: string, refId: string }> } : {}),
    ...(state.constraints && typeof state.constraints === 'object' ? { constraints: state.constraints as { exclude: string[] } } : {}),
    ...(state.interactionState && typeof state.interactionState === 'object' ? { interactionState: state.interactionState as { lastAddedItemName?: string, matchingCartLines: number, pendingAction?: string, pendingIntent?: string, selectedItemName?: string } } : {}),
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
