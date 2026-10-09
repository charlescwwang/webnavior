import type { DecisionConversation } from '../../../server/src/services/domain/kiosk-interaction-decision/context'
import type { SystemOneQuestion } from '../../../server/src/services/domain/kiosk-system-one'
import type { DecisionContext, Resolution } from '../kiosk-intents'

import { authorize, compileOperationPlan, resolveIntent } from '../kiosk-intents'

/** Finite semantic findings about a supplied hypothesis, never tool arguments. */
export const coverageChoices = {
  COVERED: '候選效果符合整句唯一需求。所問資訊有提供的事實支持；新增缺必要數量／品項選擇時，合法釐清仍可承接同一需求。',
  WRONG_EFFECT: '本句是另一個效果：查詢／查看不是新增；修改不是重複加點；拒絕不是同意。候選即使合法也不能執行。',
  MULTIPLE_REQUESTS: '本句有多個獨立要求，候選只處理其中一部分。一次菜單查詢能回答的價格與販售問題，不必拆成多個操作。',
  UNSUPPORTED_REQUEST: '本句要求未提供的資訊或能力，例如何種成分／口味／營養／客製設定；找到同名餐點不等於回答原問題。',
  UNRESOLVED_REFERENCE: '本句指定的指代／序號尚未綁定到實際target；若已提供序號對象，不可退化成任意品項釐清或默選。',
  UNCERTAIN: '語句未完成、反悔未定，或无法可靠判斷完整需求與候選效果是否一致。不要補完，不把信心不足當同意。',
} as const

/** Advisory result. Even a checked hypothesis still needs fresh domain authorization. */
export interface CoverageFinding {
  kind: 'CHECKED_HYPOTHESIS' | 'REFER'
  reason: keyof typeof coverageChoices | 'MISSING_EFFECT' | 'DOMAIN_UNRESOLVED' | 'INVALID_ANSWER' | 'LOW_CONFIDENCE' | 'PROVIDER_FAILURE' | 'DOMAIN_BLOCKED'
  confidence?: number
  resolution?: Resolution
  authorization?: ReturnType<typeof authorize>
  rawAnswer?: unknown
  question?: SystemOneQuestion
  state?: string
}

/**
 * Independent PoC: inspects one application-issued effect without performing it.
 * Neither classifier output nor model-generated target/slots enter this interface.
 * The application owns the resolution; the provider can only accept or reject its
 * semantic coverage. This is not a production authority or an execution ticket.
 */
export async function inspectEffect(input: {
  candidateId: string
  context: DecisionContext
  conversation: DecisionConversation
  threshold: number
  invoke: (state: string, questions: Record<string, SystemOneQuestion>) => Promise<{ answers?: Record<string, unknown> }>
}): Promise<CoverageFinding> {
  if (!Number.isFinite(input.threshold) || input.threshold < 0 || input.threshold > 1)
    throw new Error('Invalid coverage threshold')
  const candidate = input.context.candidates.find(candidate => candidate.id === input.candidateId)
  if (!candidate)
    return { kind: 'REFER', reason: 'MISSING_EFFECT' }
  const resolution = resolveIntent(candidate, input.context)
  if (!['PLAN', 'CONFIGURATION', 'CLARIFICATION'].includes(resolution.kind))
    return { kind: 'REFER', reason: 'DOMAIN_UNRESOLVED', resolution }
  const authorization = resolution.kind === 'PLAN'
    ? authorize(compileOperationPlan(resolution.plan), input.context)
    : undefined
  if (authorization?.kind === 'BLOCKED')
    return { kind: 'REFER', reason: 'DOMAIN_BLOCKED', resolution, authorization }
  // Facts are positive capabilities, not lexical topic coverage. Missing recipe
  // data stays unknown even when no finite ingredient word matched the utterance.
  const state = JSON.stringify({
    utterance: input.context.transcript,
    recentDialogue: input.conversation.messages,
    currentQuestion: input.context.waitingFor ?? null,
    hypothesis: { id: candidate.id, effect: candidate.intent, description: candidate.description },
    proposedResolution: resolution,
    phase: input.context.phase,
    cart: input.context.cart,
    selection: input.context.selectedItem ?? null,
    presentedItemIds: input.context.presentationItemIds ?? [],
    menuFacts: input.context.menu.map(item => ({ id: item.id, name: item.name, aliases: item.aliases ?? [], category: item.category, price: item.price, available: item.available !== false, composition: item.composition ?? null, optionGroups: item.optionGroups })),
    capabilityLimits: '只有提供的名稱、分類、價格、供應、成分及合法選項是事實。composition:null表示成分／口味／營養未知；空optionGroups表示沒有客製能力。計畫不是已執行結果。',
  })
  const question: SystemOneQuestion = {
    type: 'choice',
    instructions: '檢查最後顧客語句與候選效果，候選只是待驗證假設，不是已同意的操作。先看有無未完成／反悔或多個獨立要求，再檢查是否選錯效果、資料／能力是否足以處理整句、指定reference是否已綁定。歷史只解釋語境，不強制回答舊問題。不要維持錯誤的第一輪選擇，不因商品存在或plan合法就判COVERED。缺數量或分類多品項可以合法釐清，不等於語句未完成。你不選商品、參數或工具，也不授權付款；只能選提供的檢查結果。',
    criteria: coverageChoices,
  }
  let rawAnswer: unknown
  try {
    rawAnswer = (await input.invoke(state, { coverage: question })).answers?.coverage
  }
  catch {
    return { kind: 'REFER', reason: 'PROVIDER_FAILURE', resolution, authorization, state, question }
  }
  const evidence = { rawAnswer, resolution, authorization, state, question }
  if (!rawAnswer || typeof rawAnswer !== 'object')
    return { kind: 'REFER', reason: 'INVALID_ANSWER', ...evidence }
  const answer = rawAnswer as { type?: unknown, choice?: unknown, confidence?: unknown }
  if (answer.type !== 'choice' || typeof answer.choice !== 'string' || !Object.hasOwn(coverageChoices, answer.choice)
    || typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence)
    || answer.confidence < 0 || answer.confidence > 1) {
    return { kind: 'REFER', reason: 'INVALID_ANSWER', ...evidence }
  }
  const reason = answer.choice as keyof typeof coverageChoices
  if (reason !== 'COVERED')
    return { kind: 'REFER', reason, confidence: answer.confidence, ...evidence }
  if (answer.confidence < input.threshold)
    return { kind: 'REFER', reason: 'LOW_CONFIDENCE', confidence: answer.confidence, ...evidence }
  return { kind: 'CHECKED_HYPOTHESIS', reason, confidence: answer.confidence, ...evidence }
}
