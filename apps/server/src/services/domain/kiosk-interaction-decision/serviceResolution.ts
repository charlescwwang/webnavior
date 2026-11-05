import type { DecisionConversation, ServiceRecipient } from './context'
import type { KioskDecisionState, KioskInteractionDecision } from './contracts'

import { serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { array, literal, object, picklist, safeParse, strictObject, string } from 'valibot'

import { orderingInstructions } from '../kiosk-conversation-skills'
import { buildDecisionMessages, recipientParameter, recipientSchema } from './context'
import { serviceDomainInstruction } from './prompt'

const serviceChoices = ['SERVICE_INFORMATION_ONLY', 'MENU_INFORMATION_ONLY', 'ORDER_INFORMATION_ONLY', 'ORDER_MUTATION', 'ACKNOWLEDGEMENT', 'KEEP_ORDER', 'IDLE', 'BACKGROUND', 'CLARIFY_SERVICE', 'UNCERTAIN'] as const
const choiceSchema = strictObject({ recipient: recipientSchema, choice: picklist(serviceChoices) })
const responseSchema = object({ choices: array(object({ message: object({ tool_calls: array(object({ function: object({ name: literal('resolve_service_scope'), arguments: string() }) })) }) })) })

/** Resolves generic Main handoffs without weakening evidence requirements for food or orders. */
export async function resolveServiceHandoff(decision: KioskInteractionDecision, transcript: string, state: KioskDecisionState | undefined, complete: (body: Record<string, unknown>) => Promise<Response>, conversation?: DecisionConversation): Promise<KioskInteractionDecision> {
  const mentions = state?.catalogEvidence
  const previouslyInterpreted = decision.resolvedBy === 'main-skill'
  // Review establishes recipient/service evidence, not the final purpose.
  // Its proposed question (or held answer) must pass this same scope boundary
  // before it can restart a conversation or suppress a real menu continuation.
  const clarificationProposal = (decision.kind === 'SERVICE_CLARIFICATION' && !state?.serviceClarification)
    || (decision.kind === 'UNAVAILABLE' && decision.reason === 'UNCERTAIN_OPERATION'
      && decision.recovery?.status === 'completed' && decision.recovery.admission === 'service' && decision.recovery.disposition === 'clarify')
  const uncertainMeaning = clarificationProposal || (decision.reason === 'UNCERTAIN_OPERATION' && !previouslyInterpreted
    && !state?.readOnly && decision.recovery?.readOnly !== true)
  const unqualifiedHandoff = (decision.kind === 'NEEDS_ASSISTANT' || clarificationProposal) && !decision.requestScope && !previouslyInterpreted
  const ungroundedRead = decision.kind === 'FAST_ACTION' && ['intent:search-menu', 'intent:search-all-menu', 'intent:recommend', 'intent:recommend-more'].includes(decision.actionId)
  const unfinished = decision.kind === 'INCOMPLETE'
  const unsupportedTopic = Boolean(state?.unavailableConditionReferences?.length)
  const genericRequest = decision.reason === undefined || decision.reason === 'NEW_REQUEST' || uncertainMeaning || ungroundedRead || unfinished || unsupportedTopic
  if ((!ungroundedRead && !unfinished && !clarificationProposal && decision.kind !== 'NEEDS_ASSISTANT') || !genericRequest || state?.phase === 'customer_entry' || (!unqualifiedHandoff && !uncertainMeaning && !unsupportedTopic && (mentions?.products.length || mentions?.categories.length)))
    return decision
  // Topic detection is lexical evidence only. A focused Main decision checks
  // whether the topic is an actual requirement, without dropping it for a
  // separately understood budget or confusing a spicy dish name with a filter.
  if (unsupportedTopic) {
    try {
      const response = await complete({ temperature: 0, messages: [
        { role: 'system', content: '只核對未提供資料的條件是否是顧客本句仍成立的要求。REQUIREMENT：明確要求符合該條件，例如不要辣／過敏安全保證，即使另有預算也不能略過。MENTION：只是品名、被否定的要求或背景提及，不是條件。UNCERTAIN：無法確認。只呼叫resolve_condition_support，不推薦或操作。' },
        { role: 'user', content: JSON.stringify({ customerUtterance: transcript, unavailableConditions: state?.unavailableConditionReferences }) },
      ], tools: [{ type: 'function', function: { name: 'resolve_condition_support', parameters: { type: 'object', properties: { choice: { type: 'string', enum: ['REQUIREMENT', 'MENTION', 'UNCERTAIN'] } }, required: ['choice'], additionalProperties: false } } }], tool_choice: 'required' })
      const data = await response.json()
      const envelope = safeParse(object({ choices: array(object({ message: object({ tool_calls: array(object({ function: object({ name: literal('resolve_condition_support'), arguments: string() }) })) }) })) }), data)
      const calls = envelope.success && envelope.output.choices.length === 1 ? envelope.output.choices[0]?.message.tool_calls : undefined
      const selection = calls?.length === 1 ? safeParse(strictObject({ choice: picklist(['REQUIREMENT', 'MENTION', 'UNCERTAIN']) }), JSON.parse(calls[0]!.function.arguments)) : undefined
      if (!response.ok || !selection?.success)
        return { ...decision, kind: 'UNAVAILABLE', reason: response.ok ? 'INVALID_CHOICE' : 'PROVIDER_FAILURE' }
      if (selection.output.choice !== 'MENTION') {
        const unavailableConditions = [...state!.unavailableConditionReferences!]
        const question = selection.output.choice === 'REQUIREMENT'
          ? `目前菜單未提供可確認的${unavailableConditions.map(condition => condition.label).join('、')}。請先詢問店員確認；您還想了解什麼？`
          : '請再說明您要求的餐點條件；目前資料不足以確認是否符合。'
        return { ...decision, kind: 'SERVICE_CLARIFICATION', question: { questionId: crypto.randomUUID(), question, sourceUtterance: transcript, unavailableConditions, contextKey: serviceContextKey(state!), expiresAt: Date.now() + 30000 } }
      }
    }
    catch {
      // A missing qualification cannot release a potentially unsupported condition.
      return { ...decision, kind: 'UNAVAILABLE', reason: 'PROVIDER_FAILURE' }
    }
  }
  const startedAt = performance.now()
  let failure: KioskInteractionDecision['reason'] = 'PROVIDER_FAILURE'
  let validChoice = false
  let recipient: ServiceRecipient | undefined
  let choice: typeof serviceChoices[number] = 'UNCERTAIN'
  try {
    const response = await complete({ temperature: 0, messages: buildDecisionMessages(`${orderingInstructions('qualification')}
${serviceDomainInstruction}
只選本句完整目的，不操作或產生回覆。先結合近期對話理解省略、追問與改口，再按以下順序判斷：
1. 上述共用範圍以外的要求，以及無服務請求的敘述、技術評論、同伴聊天，選BACKGROUND。不能將其他領域指令改寫成餐廳的含糊求助；對象或完整求助尚不能確認選UNCERTAIN。Jev與目前畫面都不是服務資格。明確求助但意思不明不是背景。
2. 本句有清楚的資訊問題，即使帶「先不要操作」或資料未知，也按問題選資訊種類，不選CLARIFY_SERVICE或只回KEEP_ORDER。SERVICE_INFORMATION_ONLY：本機能力、身分、店家資訊、付款方式、位置路線、營業時間；包含對本機剛才答覆的追問／質疑。MENU_INFORMATION_ONLY：餐點、價格、成分、比較、推薦、換批；可承接前文省略品名，不等於購買。ORDER_INFORMATION_ONLY：核對、查看或顯示購物車／訂單內容與狀態，顯示只改畫面不改餐點；不順帶結帳、刪餐或取消結帳。
3. ORDER_MUTATION：完整原句有明確新增、修改、更換、取消、用餐方式、有效操作問題回答，或實際畫面導覽需求（唯讀顯示購物車除外）；若同句還要資訊，仍保留全部需求。返回訂單／上一頁／離開結帳是畫面操作，不能改成唯讀查訂單。缺份數或必要規格仍交Menu補問，不是服務目的未明。沒有購買或修改授權就不能選此項。
4. CLARIFY_SERVICE：本句明確向本機求助，已能確認是在請本機提供服務，但缺品名或具體目的；命令語氣不證明服務領域，領域／對象未知選UNCERTAIN，不把任意指令改寫成點餐求助。不能以此取代已清楚的資訊問題。
5. 沒有其他問題或操作才考慮：KEEP_ORDER＝明確保持現況／撤回未執行訂購，不能刪除已存在餐點；ACKNOWLEDGEMENT＝對本機單純了解、附和；IDLE＝自行先看看或稍後再說。沒有有效操作問題時，好／對不能當成結帳或任選操作。
資訊未知不等於目的未知；查詢不授權購買；問題存在不代表本句回答它；多項需求不能壓成第一項。只呼叫resolve_service_scope。`, { phase: state?.phase, references: state?.references ?? [], productResolution: state?.productResolution, catalogEvidence: state?.catalogEvidence, interactionState: state?.interactionState, unavailableConditions: state?.unavailableConditionReferences ?? [], waitingFor: state?.waitingFor && state.waitingFor.expiresAt > Date.now() ? state.waitingFor : null, retainedRequests: state?.retainedRequests ?? [], ...(conversation ? { recentDialogue: conversation.messages.slice(-6) } : {}) }, transcript), tools: [{ type: 'function', function: { name: 'resolve_service_scope', description: '依完整原句區分服務資訊、純查詢、明確操作、背景與未明需求；不執行操作或產生餐點答案。', parameters: { type: 'object', properties: { recipient: recipientParameter, choice: { type: 'string', enum: serviceChoices } }, required: ['recipient', 'choice'], additionalProperties: false } } }], tool_choice: 'required' })
    if (response.ok)
      failure = 'INVALID_CHOICE'
    const parsed = safeParse(responseSchema, await response.json())
    const calls = parsed.success && parsed.output.choices.length === 1 ? parsed.output.choices[0]?.message.tool_calls : undefined
    if (response.ok && calls?.length === 1) {
      const selected = safeParse(choiceSchema, JSON.parse(calls[0]!.function.arguments))
      if (selected.success) {
        validChoice = true
        choice = selected.output.choice
        recipient = selected.output.recipient
      }
    }
  }
  catch {
    // A failed qualifier never releases the original handoff.
  }
  const trace = decision.trace && typeof decision.trace === 'object' ? { trace: { ...decision.trace, serviceResolution: { recipient, choice, durationMs: performance.now() - startedAt } } } : {}
  const { actionId: _action, question: _question, ...handoff } = { actionId: undefined, question: undefined, ...decision }
  if (!validChoice)
    return { ...handoff, kind: 'UNAVAILABLE', reason: failure, ...trace }
  if (recipient === 'other')
    return { ...handoff, kind: 'IGNORE', reason: undefined, ...trace }
  if (recipient === 'uncertain')
    return { ...handoff, kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
  if (validChoice && choice === 'CLARIFY_SERVICE') {
    // The original question already asks for the missing target or purpose.
    // Scope qualification cannot reopen it after an uninterpreted answer.
    const cue = state?.serviceClarification
    if (cue && cue.expiresAt > Date.now() && cue.contextKey === serviceContextKey(state!))
      return { ...handoff, kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
    const question = '請再說明您想詢問或調整什麼，我會接著協助您。'
    return { ...handoff, kind: 'SERVICE_CLARIFICATION', question: { questionId: crypto.randomUUID(), question, sourceUtterance: transcript, contextKey: serviceContextKey(state ?? { phase: 'unknown' }), expiresAt: Date.now() + 30000 }, ...trace }
  }
  // Not having finished a form is not an unfinished utterance. Main's
  // explicit keep-order decision may acknowledge that complete refusal,
  // while genuine fragments and uncertain proposals remain incomplete.
  if (unfinished && (!validChoice || choice !== 'KEEP_ORDER'))
    return { ...decision, ...trace }
  // An explicit pause answers a live service interaction. Acknowledge it
  // without consuming the question or cancelling the retained meal draft.
  // Standalone idle/background still stays quiet.
  if (choice === 'IDLE' && state?.waitingFor && state.waitingFor.expiresAt > Date.now())
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION', ...trace }
  if (choice === 'BACKGROUND' || choice === 'IDLE')
    return { ...handoff, kind: 'IGNORE', reason: undefined, ...trace }
  if (choice === 'ORDER_MUTATION')
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: state?.intentRecovery?.kind === 'answer' ? 'UNCERTAIN_OPERATION' : 'NEW_REQUEST', resolvedBy: 'main-service', requestScope: 'order-operation', ...trace }
  // CLARIFY_SERVICE establishes a real request with unclear meaning. UNCERTAIN
  // establishes neither the recipient nor a complete request, so stay silent.
  if (validChoice && choice === 'UNCERTAIN')
    return { ...handoff, kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST', ...trace }
  if (choice === 'ORDER_INFORMATION_ONLY')
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', resolvedBy: 'main-service', requestScope: 'order-information', ...trace }
  if (choice === 'MENU_INFORMATION_ONLY' && decision.kind !== 'FAST_ACTION')
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', resolvedBy: 'main-service', requestScope: 'menu-information', ...trace }
  return choice === 'SERVICE_INFORMATION_ONLY' || choice === 'ACKNOWLEDGEMENT' || choice === 'KEEP_ORDER' ? { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION', ...trace } : { ...decision, ...trace }
}
