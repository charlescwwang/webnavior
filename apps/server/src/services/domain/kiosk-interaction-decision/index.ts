import type { SystemOnePolicyInput, SystemOneQuestion } from '../kiosk-system-one'

import { createDecisionInstructions } from './prompt'

export interface KioskActionCandidate {
  description: string
  id: string
  requiresHighConfidence?: boolean
}

export interface KioskDecisionState {
  allowedPaymentMethods?: readonly string[]
  checkoutSnapshot?: unknown
  constraints?: { exclude: readonly string[] }
  interactionState?: { lastAddedItemName?: string, matchingCartLines: number, pendingAction?: string, pendingIntent?: string, selectedItemName?: string }
  paymentState?: string
  phase: string
  references?: readonly { label: string, refId: string }[]
}

export interface KioskDecisionTrace {
  candidateIntents: readonly KioskActionCandidate[]
  decisionState: string
  rawAnswer?: unknown
  transcript: string
}

export type KioskInteractionDecision
  = | { kind: 'CLARIFICATION', confidence?: number }
    | { kind: 'FAST_ACTION', actionId: string, confidence?: number }
    | { kind: 'INCOMPLETE', confidence?: number }
    | { kind: 'IGNORE', confidence?: number }
    | { kind: 'NEEDS_ASSISTANT', confidence?: number }
    | { kind: 'UNAVAILABLE' }

interface DecisionInput {
  candidates: readonly KioskActionCandidate[]
  decisionState?: KioskDecisionState
  includeTrace?: boolean
  invoke: (state: string, questions: Record<string, SystemOneQuestion>) => Promise<{ answers?: Record<string, unknown> }>
  maxActionCandidates?: number
  policy: SystemOnePolicyInput
  presenceState?: string
  transcript: string
}

/** Converts the current eligible action set into a finite System One choice. */
export async function decideInteraction(input: DecisionInput): Promise<KioskInteractionDecision> {
  // Application-side shaping must fit the model budget. Silent truncation can
  // remove the one correct semantic option and turn a valid utterance into IGNORE.
  if (input.candidates.length > (input.maxActionCandidates ?? 253))
    return { kind: 'UNAVAILABLE' }
  const eligibleCandidates = input.candidates
  const phase = input.decisionState?.phase
  const followUp = phase === 'clarification' || phase === 'pending_confirmation'
  const criteria: Record<string, string> = followUp
    ? { IGNORE: '顧客沒有明確回答目前待決定的選項。' }
    : {
        INCOMPLETE: '顧客正在說一個可點餐操作但語句尚未完成；Kiosk 會安靜等待下一句，不能執行操作。',
        IGNORE: '顧客沒有對本點餐 Kiosk 提出明確且可直接執行的要求，或語意不完整、泛泛而談、閒聊、招呼、與點餐無關，或需要猜測時選此項。',
        MULTI_ACTION: '顧客這一句明確要求兩個以上獨立的狀態變更；單一步驟無法完整完成，應保留整句交給 Main Agent，不可只執行其中一步。',
        NEEDS_ASSISTANT: '顧客提出複雜的菜單理解、推薦、比較或限制需求；Kiosk 會保留這句已辨識語音並自動轉交 Main Agent。',
      }
  for (const candidate of eligibleCandidates) criteria[candidate.id] = candidate.description
  try {
    const state = createDecisionState(input)
    const instructions = phase === 'clarification'
      ? '目前只在釐清上一句已確定的意圖。只能從列出的真實 target 候選中選擇顧客這句明確指的那一個；不可重新判斷意圖或創造 target。若無法唯一對應，選 IGNORE。'
      : phase === 'pending_confirmation'
        ? '目前只在確認上一項具體操作。顧客明確同意才選確認，明確拒絕才選取消；其餘選 IGNORE。不可決定其他操作。'
        : createDecisionInstructions(input.policy)
    const result = await input.invoke(state, {
      route: { type: 'choice', instructions, criteria },
    })
    const answer = result.answers?.route as { choice?: unknown, confidence?: unknown } | undefined
    const confidence = typeof answer?.confidence === 'number' ? answer.confidence : undefined
    const trace = input.includeTrace ? { trace: { candidateIntents: eligibleCandidates, decisionState: state, rawAnswer: answer, transcript: input.transcript } satisfies KioskDecisionTrace } : {}
    if (answer?.choice === 'IGNORE')
      return { kind: 'IGNORE', ...(confidence === undefined ? {} : { confidence }), ...trace }
    if (answer?.choice === 'INCOMPLETE')
      return { kind: 'INCOMPLETE', ...(confidence === undefined ? {} : { confidence }), ...trace }
    if (answer?.choice === 'NEEDS_ASSISTANT')
      return { kind: 'NEEDS_ASSISTANT', ...(confidence === undefined ? {} : { confidence }), ...trace }
    if (answer?.choice === 'MULTI_ACTION')
      return { kind: 'NEEDS_ASSISTANT', ...(confidence === undefined ? {} : { confidence }), ...trace }
    if (typeof answer?.choice === 'string') {
      const selected = eligibleCandidates.find(candidate => candidate.id === answer.choice)
      if (selected) {
        // A low-confidence mutation goes to Main Agent for safety, even when
        // Jev's semantic choice is correct. Do not count this as an intent
        // classification success or silently discard the original utterance.
        if (selected.requiresHighConfidence && confidence !== undefined && confidence < 0.5)
          return { kind: 'NEEDS_ASSISTANT', confidence, ...trace }
        return { kind: 'FAST_ACTION', actionId: answer.choice, ...(confidence === undefined ? {} : { confidence }), ...trace }
      }
    }
    return { kind: 'UNAVAILABLE', ...trace }
  }
  catch { return { kind: 'UNAVAILABLE' } }
}

function createDecisionState(input: Pick<DecisionInput, 'decisionState' | 'presenceState' | 'transcript'>) {
  const rawCheckout = input.decisionState?.checkoutSnapshot
  const checkout = rawCheckout && typeof rawCheckout === 'object' && !Array.isArray(rawCheckout)
    ? rawCheckout as Record<string, unknown>
    : undefined
  const checkoutSummary = checkout
    ? {
        stage: typeof checkout.stage === 'string' ? checkout.stage : input.decisionState?.phase,
        invoiceMethod: typeof checkout.invoiceMethod === 'string' ? checkout.invoiceMethod : undefined,
        hasCarrier: typeof checkout.carrierCode === 'string' && checkout.carrierCode.length > 0,
        hasTaxId: typeof checkout.taxId === 'string' && /^\d{8}$/.test(checkout.taxId),
      }
    : undefined
  return [
    `顧客語音：${input.transcript}`,
    `現場 presence：${input.presenceState ?? '未知'}`,
    `目前 phase：${input.decisionState?.phase ?? 'unknown'}`,
    `付款狀態：${input.decisionState?.paymentState ?? 'unknown'}`,
    `結帳畫面摘要：${JSON.stringify(checkoutSummary ?? {})}`,
    `允許的付款方式：${JSON.stringify(input.decisionState?.allowedPaymentMethods ?? [])}`,
    `真實 domain references：${JSON.stringify(input.decisionState?.references ?? [])}`,
    `互動焦點：${JSON.stringify(input.decisionState?.interactionState ?? {})}`,
    `已解析限制：${JSON.stringify(input.decisionState?.constraints ?? { exclude: [] })}`,
  ].join('\n')
}
