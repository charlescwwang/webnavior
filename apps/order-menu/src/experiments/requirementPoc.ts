import type { DecisionConversation } from '../../../server/src/services/domain/kiosk-interaction-decision/context'
import type { SystemOneQuestion } from '../../../server/src/services/domain/kiosk-system-one'
import type { DecisionContext, KioskIntent, Resolution } from '../kiosk-intents'

import { authorize, compileOperationPlan, resolveIntent } from '../kiosk-intents'

const effects = {
  QUERY: '詢問販售、分類、價格、內容或其他餐點資訊，不訂購。',
  VIEW: '只查看或開啟某餐點，不新增訂購。',
  ADD: '提出新增訂購需求；商品類別不唯一、缺數量仍是訂購需求。',
  MODIFY_QUANTITY: '修改既有餐點份數，不重複新增。',
  MODIFY_OPTION: '修改既有或正在編輯的口味、配料、大小等設定。',
  REMOVE: '刪除已點餐點；食材排除不是刪除餐點。',
  REVERT: '反悔並回復原選擇，但此處不決定原選擇是什麼。',
  DECLINE: '拒絕／暫緩已提出的操作，不是同意，也不是取消整張訂單。',
  RECOMMEND: '要求系統挑餐點，不只是列有哪些。',
  CHECKOUT: '要求開始結帳，不是付款授權。',
  FULFILLMENT: '選擇或修改內用／外帶。',
  PARTY_SIZE: '提供或修改內用人數，不是餐點份數。',
  VIEW_CART: '查看已點餐點，不開始結帳。',
  REFERENCE: '明確有服務需求，但僅靠指代仍不能判斷要求何種效果。',
  CHAT: '沒有交易需求的閒聊或背景話語。',
  UNFINISHED: '本句未完成或尚未決定要做什麼；缺數量／唯一商品不是未完成。',
  UNCERTAIN: '不能可靠辨別效果，或需求超出這份有限詞彙。',
  NONE: '沒有這一個需求；第二欄常用，不能用來忽略第二個要求。',
} as const

/** Fixed two-atom semantic profile. No target, quantity, tool or authority fields. */
export interface RequirementProfile {
  first: keyof typeof effects
  second: keyof typeof effects
  count: 'ONE' | 'TWO' | 'MORE_THAN_TWO' | 'NONE' | 'UNFINISHED' | 'UNCERTAIN'
  information: 'NONE' | 'MENU_FACTS' | 'COMPOSITION' | 'NUTRITION' | 'OTHER_OR_MIXED' | 'UNCERTAIN'
  reference: 'EXPLICIT' | 'CONTEXTUAL' | 'UNCERTAIN'
}

/** Diagnostics, not a plan. Confidence is the minimum of five finite decisions. */
export interface RequirementFinding {
  kind: 'PARSED' | 'REFER'
  reason: 'PARSED' | 'INVALID_ANSWER' | 'INCONSISTENT' | 'LOW_CONFIDENCE' | 'PROVIDER_FAILURE'
  profile?: RequirementProfile
  confidence?: number
  rawAnswers?: Record<string, unknown>
  state: string
  questions: Record<string, SystemOneQuestion>
}

/**
 * Candidate-blind PoC extraction: only speech and conversational cues cross the
 * provider seam. The caller cannot pass candidate IDs, plans or menu facts here.
 * Two explicit atoms are a bounded diagnostic representation; overflow refers,
 * never truncates into an executable single effect.
 */
export async function extractRequirements(input: {
  utterance: string
  conversation: DecisionConversation
  questionText?: string
  threshold: number
  invoke: (state: string, questions: Record<string, SystemOneQuestion>) => Promise<{ answers?: Record<string, unknown> }>
}): Promise<RequirementFinding> {
  if (!Number.isFinite(input.threshold) || input.threshold < 0 || input.threshold > 1)
    throw new Error('Invalid requirement threshold')
  const state = JSON.stringify({ utterance: input.utterance, recentDialogue: input.conversation.messages, currentQuestionText: input.questionText ?? null })
  const instructions = '只拆最後一句顧客語音的需求，不選商品或工具、不填數量／參數、不授權操作。歷史與現有問題只解釋語境，不強迫回答舊問題。按本句順序辨識獨立要求；同餐點新增加上數量是一個需求，查同餐點販售與價格也可是一個查詢；兩個不同餐點新增、新增再結帳、查價格再訂另一項是多個需求，不合併同類效果。招呼／背景附句不算額外需求。語句反悔未定不能把前半段當確定訂購。超過兩個需求必須標記MORE_THAN_TWO，不因只提供兩欄就截斷。你沒有商品／菜單能力資料，不能猜target。'
  const questions: Record<string, SystemOneQuestion> = {
    first: { type: 'choice', instructions: `${instructions} 此題選本句第一個需求；若是閒聊選CHAT，尚未決定選UNFINISHED。`, criteria: effects },
    second: { type: 'choice', instructions: `${instructions} 此題選本句第二個獨立需求；沒有第二個選NONE，兩項新增應再選ADD。`, criteria: effects },
    count: { type: 'choice', instructions, criteria: { ONE: '只有一個完整服務需求；缺數量／target可釐清。', TWO: '兩個獨立需求，單一效果不能完整表示。', MORE_THAN_TWO: '至少三個独立需求；兩欄不能完整列出。', NONE: '沒有服務需求，只有背景或閒聊。', UNFINISHED: '顧客尚未說完／反悔未決，不是缺必要slot。', UNCERTAIN: '需求數量無法可靠判斷。' } },
    information: { type: 'choice', instructions: `${instructions} 只辨識本句真的詢問的資訊，不把菜名或排除設定當資訊問題。`, criteria: { NONE: '沒有資訊問題；新增／修改口味不是詢問。', MENU_FACTS: '只問供應、商品、分類或價格。', COMPOSITION: '詢問食材、醬料、過敏原或口味辣度。', NUTRITION: '詢問熱量或營養。', OTHER_OR_MIXED: '其他資訊，或混合上述多種範圍。', UNCERTAIN: '無法可靠辨識所問資訊。' } },
    reference: { type: 'choice', instructions: `${instructions} 只判是否必須交給reference／question resolver，不解析target或答案值。`, criteria: { EXPLICIT: '本句直接說出商品／分類或效果；沒有省略對象的指代。命名已點水餃再修改也屬此項。', CONTEXTUAL: '第二個、那個、剛剛那份、無對象的改兩份，或只回答好／一位等；需要前文／畫面／待答問題綁定。', UNCERTAIN: '不能可靠判斷是否有省略指代。' } },
  }
  let rawAnswers: Record<string, unknown> | undefined
  try {
    rawAnswers = (await input.invoke(state, questions)).answers
  }
  catch {
    return { kind: 'REFER', reason: 'PROVIDER_FAILURE', state, questions }
  }
  const profile: Record<string, string> = {}
  const confidences: number[] = []
  for (const [name, question] of Object.entries(questions)) {
    const raw = rawAnswers?.[name]
    if (!raw || typeof raw !== 'object')
      return { kind: 'REFER', reason: 'INVALID_ANSWER', rawAnswers, state, questions }
    const answer = raw as { type?: unknown, choice?: unknown, confidence?: unknown }
    if (answer.type !== 'choice' || typeof answer.choice !== 'string' || !Object.hasOwn(question.criteria!, answer.choice)
      || typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
      return { kind: 'REFER', reason: 'INVALID_ANSWER', rawAnswers, state, questions }
    }
    profile[name] = answer.choice
    confidences.push(answer.confidence)
  }
  // Every field was checked against its owning vocabulary, not a model object
  // cast into a domain plan. Extra provider fields never cross this seam.
  const parsed: RequirementProfile = {
    first: profile.first as RequirementProfile['first'],
    second: profile.second as RequirementProfile['second'],
    count: profile.count as RequirementProfile['count'],
    information: profile.information as RequirementProfile['information'],
    reference: profile.reference as RequirementProfile['reference'],
  }
  const evidence = { profile: parsed, confidence: Math.min(...confidences), rawAnswers, state, questions }
  if ((parsed.count === 'ONE' && (['NONE', 'CHAT', 'UNFINISHED'].includes(parsed.first) || parsed.second !== 'NONE'))
    || (['TWO', 'MORE_THAN_TWO'].includes(parsed.count) && [parsed.first, parsed.second].some(effect => ['NONE', 'CHAT', 'UNFINISHED'].includes(effect)))
    || (parsed.count === 'NONE' && (parsed.first !== 'CHAT' || parsed.second !== 'NONE'))
    || (parsed.count === 'UNFINISHED' && (parsed.first !== 'UNFINISHED' || parsed.second !== 'NONE'))) {
    return { kind: 'REFER', reason: 'INCONSISTENT', ...evidence }
  }
  if (evidence.confidence < input.threshold)
    return { kind: 'REFER', reason: 'LOW_CONFIDENCE', ...evidence }
  return { kind: 'PARSED', reason: 'PARSED', ...evidence }
}

/** Advisory comparison; no tools, slots from the model, or execution permission. */
export function compareEffect(input: { finding: RequirementFinding, candidateId: string, context: DecisionContext }): {
  kind: 'CHECKED_HYPOTHESIS' | 'REFER'
  reason: string
  resolution?: Resolution
  authorization?: ReturnType<typeof authorize>
} {
  if (input.finding.kind !== 'PARSED' || !input.finding.profile)
    return { kind: 'REFER', reason: input.finding.reason }
  const profile = input.finding.profile
  if (profile.count !== 'ONE')
    return { kind: 'REFER', reason: profile.count }
  if (profile.reference !== 'EXPLICIT')
    return { kind: 'REFER', reason: 'REFERENCE_REQUIRED' }
  if (!['NONE', 'MENU_FACTS'].includes(profile.information))
    return { kind: 'REFER', reason: 'UNSUPPORTED_INFORMATION' }
  const candidate = input.context.candidates.find(candidate => candidate.id === input.candidateId)
  if (!candidate)
    return { kind: 'REFER', reason: 'MISSING_EFFECT' }
  // Finite capability comparison, not phrase matching. Unimplemented effects
  // must refer; expanding the official intent vocabulary is outside this PoC.
  const effectsByIntent: Partial<Record<KioskIntent, RequirementProfile['first']>> = { SEARCH_MENU: 'QUERY', SELECT_ITEM: 'VIEW', ADD_ITEM: 'ADD', SET_QUANTITY: 'MODIFY_QUANTITY', SET_OPTION: 'MODIFY_OPTION', REMOVE_ITEM: 'REMOVE', RECOMMEND: 'RECOMMEND', START_CHECKOUT: 'CHECKOUT', SET_FULFILLMENT: 'FULFILLMENT', SET_PARTY_SIZE: 'PARTY_SIZE', VIEW_CART: 'VIEW_CART' }
  if (effectsByIntent[candidate.intent] !== profile.first)
    return { kind: 'REFER', reason: 'WRONG_EFFECT' }
  if ((profile.first === 'QUERY' && profile.information !== 'MENU_FACTS') || (profile.first !== 'QUERY' && profile.information !== 'NONE'))
    return { kind: 'REFER', reason: 'INFORMATION_EFFECT_MISMATCH' }
  const resolution = resolveIntent(candidate, input.context)
  if (!['PLAN', 'CONFIGURATION', 'CLARIFICATION'].includes(resolution.kind))
    return { kind: 'REFER', reason: 'DOMAIN_UNRESOLVED', resolution }
  const authorization = resolution.kind === 'PLAN' ? authorize(compileOperationPlan(resolution.plan), input.context) : undefined
  if (authorization?.kind === 'BLOCKED')
    return { kind: 'REFER', reason: 'DOMAIN_BLOCKED', resolution, authorization }
  return { kind: 'CHECKED_HYPOTHESIS', reason: 'EFFECT_MATCH', resolution, authorization }
}
