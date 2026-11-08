import type { BackgroundSpeechMode } from '@proj-airi/stage-shared/kiosk-service-mode'

import type { DecisionConversation, ServiceRecipient } from './context'
import type { KioskDecisionState, KioskInteractionDecision } from './contracts'

import { assistanceQuestion, serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { array, literal, object, picklist, safeParse, strictObject, string } from 'valibot'

import { orderingInstructions } from '../kiosk-conversation-skills'
import { buildDecisionMessages, recipientParameter, recipientSchema } from './context'
import { serviceDomainInstruction } from './prompt'

const serviceChoices = ['SERVICE_INFORMATION_ONLY', 'MENU_INFORMATION_ONLY', 'ORDER_INFORMATION_ONLY', 'ORDER_REVIEW', 'OUT_OF_SCOPE', 'ORDER_MUTATION', 'ACKNOWLEDGEMENT', 'KEEP_ORDER', 'IDLE', 'BACKGROUND', 'CLARIFY_SERVICE', 'UNCERTAIN'] as const
const choiceSchema = strictObject({ recipient: recipientSchema, choice: picklist(serviceChoices) })
const responseSchema = object({ choices: array(object({ message: object({ tool_calls: array(object({ function: object({ name: literal('resolve_service_scope'), arguments: string() }) })) }) })) })

/** Resolves generic Main handoffs without weakening evidence requirements for food or orders. */
export async function resolveServiceHandoff(decision: KioskInteractionDecision, transcript: string, state: KioskDecisionState | undefined, complete: (body: Record<string, unknown>) => Promise<Response>, conversation?: DecisionConversation, backgroundSpeechMode: BackgroundSpeechMode = 'off'): Promise<KioskInteractionDecision> {
  const filterBackground = backgroundSpeechMode === 'enforce'
  const offeredChoices = serviceChoices.filter(choice => filterBackground || choice !== 'BACKGROUND')
  const meaningSchema = strictObject({ choice: picklist(offeredChoices) })
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
  const reviewableOrder = state?.phase === 'pending_confirmation' || state?.intentRecovery?.candidateIds.some(id => ['intent:view-cart', 'intent:start-checkout'].includes(id))
  const genericRequest = decision.reason === undefined || decision.reason === 'NEW_REQUEST' || (decision.reason === 'GENERAL_QUESTION' && reviewableOrder) || uncertainMeaning || ungroundedRead || unfinished || unsupportedTopic
  if ((!ungroundedRead && !unfinished && !clarificationProposal && decision.kind !== 'NEEDS_ASSISTANT') || !genericRequest || state?.phase === 'customer_entry' || (!unqualifiedHandoff && !uncertainMeaning && !unsupportedTopic && (mentions?.products.length || mentions?.categories.length)))
    return decision
  // Topic detection is lexical evidence only. A focused Main decision checks
  // whether the topic is an actual requirement, without dropping it for a
  // separately understood budget or confusing a spicy dish name with a filter.
  if (unsupportedTopic) {
    // Preparation has to be checked against the actual dish/options by Menu.
    // Qualifying it here can hide an absent/fuzzy dish before identity lookup.
    if (state!.unavailableConditionReferences!.every(reference => ['spice', 'preparation'].includes(reference.id)))
      return { ...decision, kind: 'NEEDS_ASSISTANT', reason: state?.phase === 'ordering' ? 'NEW_REQUEST' : undefined, resolvedBy: 'main-service' }
    try {
      const response = await complete({ temperature: 0, messages: [
        { role: 'system', content: '只核對未提供資料的條件是否是顧客本句仍成立的要求。REQUIREMENT：明確要求符合該條件，例如不要辣／過敏安全保證，即使另有預算也不能略過。MENTION：只是品名、被否定的要求或背景提及，不是條件。UNCERTAIN：無法確認。只呼叫resolve_condition_support，不推薦或操作。' },
        { role: 'user', content: JSON.stringify({ customerUtterance: transcript, unavailableConditions: state?.unavailableConditionReferences, products: state?.catalogEvidence?.products }) },
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
          ? assistanceQuestion(unavailableConditions)
          : '您想依哪項條件挑選餐點？'
        return { ...decision, kind: 'SERVICE_CLARIFICATION', question: { ...(selection.output.choice === 'REQUIREMENT' ? { purpose: 'staff-assistance' as const } : {}), questionId: crypto.randomUUID(), question, sourceUtterance: transcript, unavailableConditions, contextKey: serviceContextKey(state!), expiresAt: Date.now() + 30000 } }
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
${filterBackground ? serviceDomainInstruction : '背景過濾未啟用，不分類背景或對象。一般問題仍交助手回應或引導，不視為缺少服務資格。'}
ORDER_REVIEW：顧客表示已點完，或要進入結帳／送出訂單的下一階段（含改口離開舊問題）。只要本句要求結束選餐、結帳或送出，就選這項，無論目前在問清空、內外帶或其他問題；此項包含送單意圖，但不代表程式可略過送單前核對。先展示核對訂單與下一步問題。此情況選ORDER_REVIEW而非ORDER_MUTATION，不是供餐方式說明、閒置、單純附和，不授權付款或送單，也不能回答舊問題。份數／客製視窗內只表示當前設定完成，不能越過尚未完成的餐點。OUT_OF_SCOPE：一般知識、工作閒聊等沒有點餐內容；過濾關閉時仍回應服務範圍，不選供餐方式或替顧客回答舊問題。
只選本句完整目的，不操作或產生回覆。整句只要包含新增餐點、改份數、換餐等餐點修改，即使還有售價／資訊問題也選ORDER_MUTATION，不能用資訊類丟掉操作；ORDER_REVIEW只代表結束選餐進入核對／結帳，不包含新增餐點。MENU_INFORMATION_ONLY與ORDER_INFORMATION_ONLY必須是整句完全不改單。先結合近期對話理解省略、追問與改口，再按以下順序判斷：
${filterBackground ? '1. 明確對同伴說話或沒有向本機提出需求的背景對話選BACKGROUND，對象未知選UNCERTAIN。向本機提出的職責外問題選SERVICE_INFORMATION_ONLY，交助手說明限制，不授權操作。' : '1. 背景過濾未啟用，不分類背景或對象。一般資訊與閒聊問題選SERVICE_INFORMATION_ONLY；意思不清楚選CLARIFY_SERVICE，不授權操作。'}
2. 本句有清楚的資訊問題，即使帶「先不要操作」或資料未知，也按問題選資訊種類，不選CLARIFY_SERVICE或只回KEEP_ORDER。SERVICE_INFORMATION_ONLY：顧客確實詢問本機能力、身分、店家資訊、付款方式、位置路線、營業時間；沒有詢問本機／店家資訊、只是工作或日常閒聊敘述，必須選OUT_OF_SCOPE而非此項；包含對本機剛才答覆的追問／質疑。MENU_INFORMATION_ONLY：餐點、價格、成分、比較、推薦、換批；還沒決定吃什麼、請系統挑選，或只表達想吃某個分類，也屬於完整的餐點探索需求，沒有品名／份數不代表意思未明；可承接前文省略品名，不等於購買。ORDER_INFORMATION_ONLY：僅查看已在購物車裡的內容、總價或訂單狀態。新增／加點不是此項；問未點餐點的售價是MENU_INFORMATION_ONLY；同句任何加餐或改單都選ORDER_MUTATION。顯示只改畫面不改餐點，不順帶結帳、刪餐或取消結帳。
3. 先核對ORDER_REVIEW：點完後要求結帳／送出，尤其舊問題仍在問清空而顧客改說送出，選ORDER_REVIEW先核對並反問，不是ORDER_MUTATION或同意清空。其餘ORDER_MUTATION：只處理修改餐點或設定，絕不包含結束選餐、結帳、送出（都選ORDER_REVIEW）。完整原句有明確新增、修改、更換、取消、用餐方式、有效操作問題回答，或實際畫面導覽需求（唯讀顯示購物車除外）；若同句還要資訊，仍保留全部需求。返回訂單／上一頁／離開結帳是畫面操作，不能改成唯讀查訂單。缺份數或必要規格仍交Menu補問，不是服務目的未明。沒有購買或修改授權就不能選此項。
4. CLARIFY_SERVICE：本句明確向本機求助，已能確認是在請本機提供服務，但缺品名或具體目的；命令語氣不證明服務領域，領域／對象未知選UNCERTAIN，不把任意指令改寫成點餐求助。不能以此取代已清楚的資訊問題。
5. 沒有其他問題或操作才考慮：KEEP_ORDER＝明確保持現況／撤回未執行訂購，不能刪除已存在餐點；ACKNOWLEDGEMENT＝對本機單純了解、附和；IDLE＝自行先看看或稍後再說。沒有有效操作問題時，好／對不能當成結帳或任選操作。
資訊未知不等於目的未知；查詢不授權購買；問題存在不代表本句回答它；多項需求不能壓成第一項。只呼叫resolve_service_scope。`, { phase: state?.phase, references: state?.references ?? [], productResolution: state?.productResolution, catalogEvidence: state?.catalogEvidence, interactionState: state?.interactionState, unavailableConditions: state?.unavailableConditionReferences ?? [], waitingFor: state?.waitingFor && state.waitingFor.expiresAt > Date.now() ? state.waitingFor : null, retainedRequests: state?.retainedRequests ?? [], ...(conversation ? { recentDialogue: conversation.messages.slice(-6) } : {}) }, transcript), tools: [{ type: 'function', function: { name: 'resolve_service_scope', description: '依完整原句區分服務資訊、純查詢、明確操作、背景與未明需求；不執行操作或產生餐點答案。', parameters: { type: 'object', properties: { ...(filterBackground ? { recipient: recipientParameter } : {}), choice: { type: 'string', enum: offeredChoices } }, required: filterBackground ? ['recipient', 'choice'] : ['choice'], additionalProperties: false } } }], tool_choice: 'required' })
    if (response.ok)
      failure = 'INVALID_CHOICE'
    const parsed = safeParse(responseSchema, await response.json())
    const calls = parsed.success && parsed.output.choices.length === 1 ? parsed.output.choices[0]?.message.tool_calls : undefined
    if (response.ok && calls?.length === 1) {
      const args = JSON.parse(calls[0]!.function.arguments)
      const selected = filterBackground ? safeParse(choiceSchema, args) : safeParse(meaningSchema, args)
      if (selected.success) {
        validChoice = true
        choice = selected.output.choice
        const resolvedRecipient = safeParse(recipientSchema, 'recipient' in selected.output ? selected.output.recipient : undefined)
        recipient = resolvedRecipient.success ? resolvedRecipient.output : undefined
      }
    }
  }
  catch {
    // A failed qualifier never releases the original handoff.
  }
  const trace = decision.trace && typeof decision.trace === 'object' ? { trace: { ...decision.trace, serviceResolution: { backgroundSpeechMode, recipient, choice, durationMs: performance.now() - startedAt } } } : {}
  const { actionId: _action, question: _question, ...handoff } = { actionId: undefined, question: undefined, ...decision }
  if (!validChoice)
    return { ...handoff, kind: 'UNAVAILABLE', reason: failure, ...trace }
  if (filterBackground && recipient === 'other')
    return { ...handoff, kind: 'IGNORE', reason: undefined, ...trace }
  if (filterBackground && recipient === 'uncertain')
    return { ...handoff, kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
  if (validChoice && choice === 'CLARIFY_SERVICE') {
    // The original question already asks for the missing target or purpose.
    // Scope qualification cannot reopen it after an uninterpreted answer.
    const cue = state?.serviceClarification
    if (cue && cue.expiresAt > Date.now() && cue.contextKey === serviceContextKey(state!))
      return { ...handoff, kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
    const question = '請再說明您想查詢的餐點，或要調整的訂單內容。'
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
  if ((filterBackground && choice === 'BACKGROUND') || choice === 'IDLE')
    return { ...handoff, kind: 'IGNORE', reason: undefined, ...trace }
  if (choice === 'ORDER_MUTATION')
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: state?.intentRecovery?.kind === 'answer' ? 'UNCERTAIN_OPERATION' : 'NEW_REQUEST', resolvedBy: 'main-service', requestScope: 'order-operation', ...trace }
  // CLARIFY_SERVICE establishes a real request with unclear meaning. UNCERTAIN
  // establishes neither the recipient nor a complete request, so stay silent.
  if (validChoice && choice === 'UNCERTAIN')
    return { ...handoff, kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST', ...trace }
  if (choice === 'OUT_OF_SCOPE')
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION', resolvedBy: 'main-service', requestScope: 'service-information', ...trace }
  if (choice === 'ORDER_INFORMATION_ONLY' || choice === 'ORDER_REVIEW')
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', resolvedBy: 'main-service', requestScope: 'order-information', ...trace }
  if (choice === 'MENU_INFORMATION_ONLY' && (decision.kind !== 'FAST_ACTION' || decision.actionId === 'intent:search-menu'))
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', resolvedBy: 'main-service', requestScope: 'menu-information', ...trace }
  return choice === 'SERVICE_INFORMATION_ONLY' || choice === 'ACKNOWLEDGEMENT' || choice === 'KEEP_ORDER' ? { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION', ...trace } : { ...decision, ...trace }
}
