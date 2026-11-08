import type { BackgroundSpeechMode } from '@proj-airi/stage-shared/kiosk-service-mode'

import type { DecisionConversation, ServiceRecipient } from './context'
import type { KioskDecisionState, KioskInteractionDecision } from './contracts'

import { assistanceQuestion, orderAssistanceQuestion, serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { array, literal, object, optional, picklist, safeParse, strictObject, string } from 'valibot'

import { orderingInstructions } from '../kiosk-conversation-skills'
import { buildDecisionMessages, recipientParameter, recipientSchema } from './context'
import { serviceDomainInstruction } from './prompt'

const serviceChoices = ['SERVICE_INFORMATION_ONLY', 'MENU_INFORMATION_ONLY', 'ORDER_INFORMATION_ONLY', 'ORDER_REVIEW', 'MENU_RETURN', 'ORDER_ASSISTANCE', 'OUT_OF_SCOPE', 'ORDER_ADDITION', 'ORDER_MUTATION', 'ACKNOWLEDGEMENT', 'KEEP_ORDER', 'IDLE', 'BACKGROUND', 'CLARIFY_SERVICE', 'UNCERTAIN'] as const
const choiceSchema = strictObject({ recipient: recipientSchema, choice: picklist(serviceChoices), subjects: optional(array(string())) })
const responseSchema = object({ choices: array(object({ message: object({ tool_calls: array(object({ function: object({ name: literal('resolve_service_scope'), arguments: string() }) })) }) })) })

/** Resolves generic Main handoffs without weakening evidence requirements for food or orders. */
export async function resolveServiceHandoff(decision: KioskInteractionDecision, transcript: string, state: KioskDecisionState | undefined, complete: (body: Record<string, unknown>) => Promise<Response>, conversation?: DecisionConversation, backgroundSpeechMode: BackgroundSpeechMode = 'off'): Promise<KioskInteractionDecision> {
  const filterBackground = backgroundSpeechMode === 'enforce'
  const offeredChoices = serviceChoices.filter(choice => filterBackground || choice !== 'BACKGROUND')
  const meaningSchema = strictObject({ choice: picklist(offeredChoices), subjects: optional(array(string())) })
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
  // A named/fragment meal can be proposed as a filter by Jev. Qualify its
  // whole purpose before making Main permanently read-only; Menu still owns
  // the original-name lookup and any later identity/quantity confirmation.
  const namedQueryHypothesis = decision.reason === 'MENU_QUERY' && Boolean(state?.catalogEvidence?.products.length)
  const genericRequest = namedQueryHypothesis || decision.reason === undefined || decision.reason === 'NEW_REQUEST' || (decision.reason === 'GENERAL_QUESTION' && reviewableOrder) || uncertainMeaning || ungroundedRead || unfinished || unsupportedTopic
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
  let subjects: string[] = []
  let validChoice = false
  let recipient: ServiceRecipient | undefined
  let choice: typeof serviceChoices[number] = 'UNCERTAIN'
  try {
    const response = await complete({ temperature: 0, messages: buildDecisionMessages(`${orderingInstructions('qualification')}
${filterBackground ? serviceDomainInstruction : '背景過濾未啟用，不分類背景或對象。一般問題仍交助手回應或引導，不視為缺少服務資格。'}
只分類最後一句顧客的完整目的，不執行工具、不產生回覆。近期對話只幫助理解指涉，不能把上一輪的需求當成本輪授權。
先核對撤回：interactionState.cartItemCount是實際購物車份數。為0且沒有selectedItemName或retainedRequests時，顧客只表示不要／不點某道餐點，必須KEEP_ORDER，包含ASR品名錯字。沒有已點對象可刪除，不是ORDER_MUTATION；也不是要把肉類排除後繼續推薦，不查品名。只有本句確實另有搜尋／推薦需求，才處理新查詢。
其餘依下列優先順序選唯一一項：
1. ORDER_ASSISTANCE：訂購整份菜單每款餐點，或超出本機支援的特殊／大量安排。先確認原需求，不以看全部菜單或普通加點代替。一般明確餐點與合法份數正常點餐，不算特殊需求。
2. ORDER_REVIEW：已點完、要求結帳／送出，先核對訂單並問下一步，不代表同意送出，也不是供餐方式說明。即使前一題問清空，現在改說結帳也屬此項。份數／客製視窗尚未完成時仍須處理當前餐點。
3. MENU_RETURN：本句只要求回全部菜單、離開推薦／購物車以繼續選餐。表示想繼續點餐而沒有指定新增餐點，也屬返回選餐，不是ORDER_ADDITION。保留現有餐點，不重新展示購物車、不回答舊送單問題。若另有加餐／刪餐等獨立需求，選ORDER_MUTATION保留完整需求。
4. ORDER_ADDITION：本句只要新增一或多道餐點，包含其中有菜單未知名稱，沒有要求替換或修改既有餐點，且沒有其他獨立需求。subjects必須逐一列出本句所有新增餐點的原文字串，不放份數、不自行修正品名，不可只列菜單認得的名稱；其他choice subjects填空陣列。可以省略份數，Menu會補問。只是想繼續點餐／回菜單而未要求任何餐點，不是新增。已有水餃而說要魚餐，只新增魚，不能把水餃換掉。
5. ORDER_MUTATION：其他明確改單／設定／操作，包含換餐、減量、移除、用餐方式、有效操作問題回答，或混合多項需求。取回訂單／離開結帳也屬此項。缺份數或匹配不唯一仍保留原需求，交Menu釐清；不能只做其中一項。單純撤回尚未存在的餐點則看KEEP_ORDER。
6. MENU_INFORMATION_ONLY：整句只有餐點查詢、價格、條件、比較或推薦；想吃某種類但尚未指定餐點是探索，不代表購買。可承接前文。查無資料不代表目的不清楚。
7. ORDER_INFORMATION_ONLY：整句只查看既有購物車內容、總價、狀態；不含加餐、改單、送單或返回選餐。
8. SERVICE_INFORMATION_ONLY：詢問本機／店家的身分、能力、如何點餐、付款、位置、營業時間、外送或預約；即使該功能不提供仍是明確問題，不選CLARIFY_SERVICE。回答前文服務問題的質疑也屬此項。
9. KEEP_ORDER：只保持現況／撤回未執行的訂購；cartItemCount為0且沒有未加入草稿時，不想點某道餐點也是此項，包含品名ASR錯字。不查品名、不展示推薦、不刪除既有餐點。同句另有新需求應按完整目的選其他項。
10. ACKNOWLEDGEMENT：只表示了解、附和；沒有有效操作問題時，好／對不能猜成加餐、結帳或清空。IDLE：明確自己先看／稍後再說。
11. OUT_OF_SCOPE：一般知識、工作或閒聊，沒有點餐內容；仍需自然說明服務範圍，不選取餐方式。
12. CLARIFY_SERVICE：確定向本機求助但不清楚要查詢或操作什麼。UNKNOWN資料不等於UNKNOWN目的；可辨認的品名、份數或菜單條件不因匹配失敗就選此項。UNCERTAIN：確實無法確定完整目的。
${filterBackground ? '先核對對象：明確對同伴說話或背景對話選BACKGROUND；對象不確定選UNCERTAIN。向本機詢問職責外問題選OUT_OF_SCOPE。' : '背景過濾關閉，不分類背景或對象、不選BACKGROUND；一般資訊與閒聊仍回應服務範圍，不忽略。'}
只能選本題候選。問題存在不代表本句回答它；多項需求不能壓成第一項。只呼叫resolve_service_scope。`, { phase: state?.phase, references: state?.references ?? [], productResolution: state?.productResolution, catalogEvidence: state?.catalogEvidence, interactionState: state?.interactionState, unavailableConditions: state?.unavailableConditionReferences ?? [], waitingFor: state?.waitingFor && state.waitingFor.expiresAt > Date.now() ? state.waitingFor : null, retainedRequests: state?.retainedRequests ?? [], ...(conversation ? { recentDialogue: conversation.messages.slice(-6) } : {}) }, transcript), tools: [{ type: 'function', function: { name: 'resolve_service_scope', description: '依完整原句區分服務資訊、純查詢、明確操作、背景與未明需求；不執行操作或產生餐點答案。', parameters: { type: 'object', properties: { ...(filterBackground ? { recipient: recipientParameter } : {}), choice: { type: 'string', enum: offeredChoices }, subjects: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 120 }, maxItems: 20, description: '只列新增餐點名稱，不含份數、量詞或動詞；含未知品項，每個名稱必須是原句子字串。例如烏龍麵兩份、三杯茶列為[烏龍麵,茶]，不是[烏龍麵兩份,三杯茶]。其他choice填空陣列。' } }, required: filterBackground ? ['recipient', 'choice', 'subjects'] : ['choice', 'subjects'], additionalProperties: false } } }], tool_choice: 'required' })
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
        subjects = [...new Set(selected.output.subjects ?? [])]
        if (choice === 'ORDER_ADDITION' && (!subjects.length || subjects.length > 20 || subjects.some(subject => !subject.trim() || subject.length > 120 || !transcript.includes(subject))))
          validChoice = false
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
  if (choice === 'ORDER_ASSISTANCE')
    return { ...handoff, kind: 'SERVICE_CLARIFICATION', question: { purpose: 'order-assistance', questionId: crypto.randomUUID(), question: orderAssistanceQuestion(transcript), sourceUtterance: transcript, contextKey: serviceContextKey(state ?? { phase: 'unknown' }), expiresAt: Date.now() + 30_000 }, ...trace }
  if (choice === 'ORDER_ADDITION')
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', resolvedBy: 'main-service', requestScope: 'order-operation', handoff: { intent: 'ADD_ONLY', subjects, status: 'ambiguous', itemIds: [], lineIds: [] }, ...trace }
  if (choice === 'MENU_RETURN')
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', resolvedBy: 'main-service', requestScope: 'order-operation', handoff: { intent: 'RETURN_MENU', status: 'resolved', itemIds: [], lineIds: [] }, ...trace }
  if (choice === 'ORDER_MUTATION')
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: state?.intentRecovery?.kind === 'answer' ? 'UNCERTAIN_OPERATION' : 'NEW_REQUEST', resolvedBy: 'main-service', requestScope: 'order-operation', ...trace }
  // CLARIFY_SERVICE establishes a real request with unclear meaning. UNCERTAIN
  // establishes neither the recipient nor a complete request, so stay silent.
  if (validChoice && choice === 'UNCERTAIN')
    return { ...handoff, kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST', ...trace }
  if (choice === 'OUT_OF_SCOPE')
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION', resolvedBy: 'main-service', requestScope: 'service-information', ...trace }
  if (choice === 'KEEP_ORDER' && state?.interactionState?.cartItemCount === 0 && !state.retainedRequests?.length && !state.interactionState.selectedItemName)
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION', resolvedBy: 'main-service', requestScope: 'order-preservation', ...trace }
  if (choice === 'ORDER_INFORMATION_ONLY' || choice === 'ORDER_REVIEW')
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', resolvedBy: 'main-service', requestScope: 'order-information', ...trace }
  if (choice === 'MENU_INFORMATION_ONLY' && (decision.kind !== 'FAST_ACTION' || decision.actionId === 'intent:search-menu'))
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', resolvedBy: 'main-service', requestScope: 'menu-information', ...trace }
  return choice === 'SERVICE_INFORMATION_ONLY' || choice === 'ACKNOWLEDGEMENT' || choice === 'KEEP_ORDER' ? { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION', ...trace } : { ...decision, ...trace }
}
