import type { DecisionConversation } from './context'
import type { KioskDecisionState, KioskInteractionDecision } from './contracts'

import { serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { array, literal, object, picklist, safeParse, strictObject, string } from 'valibot'

import { orderingInstructions } from '../kiosk-conversation-skills'
import { buildDecisionMessages } from './context'

const serviceChoices = ['SERVICE_INFORMATION_ONLY', 'MENU_INFORMATION_ONLY', 'ORDER_INFORMATION_ONLY', 'ORDER_MUTATION', 'ACKNOWLEDGEMENT', 'KEEP_ORDER', 'IDLE', 'BACKGROUND', 'CLARIFY_SERVICE', 'UNCERTAIN'] as const
const choiceSchema = strictObject({ choice: picklist(serviceChoices) })
const responseSchema = object({ choices: array(object({ message: object({ tool_calls: array(object({ function: object({ name: literal('resolve_service_scope'), arguments: string() }) })) }) })) })

/** Resolves generic Main handoffs without weakening evidence requirements for food or orders. */
export async function resolveServiceHandoff(decision: KioskInteractionDecision, transcript: string, state: KioskDecisionState | undefined, complete: (body: Record<string, unknown>) => Promise<Response>, conversation?: DecisionConversation): Promise<KioskInteractionDecision> {
  const mentions = state?.catalogEvidence
  const previouslyInterpreted = decision.resolvedBy === 'main-skill'
  const uncertainMeaning = decision.reason === 'UNCERTAIN_OPERATION' && !previouslyInterpreted
    && !state?.readOnly && decision.recovery?.readOnly !== true
  const unqualifiedHandoff = decision.kind === 'NEEDS_ASSISTANT' && !decision.requestScope && !previouslyInterpreted
  const ungroundedRead = decision.kind === 'FAST_ACTION' && ['intent:search-menu', 'intent:search-all-menu', 'intent:recommend', 'intent:recommend-more'].includes(decision.actionId)
  const unfinished = decision.kind === 'INCOMPLETE'
  const unsupportedTopic = Boolean(state?.unavailableConditionReferences?.length)
  const genericRequest = decision.reason === undefined || decision.reason === 'NEW_REQUEST' || uncertainMeaning || ungroundedRead || unfinished || unsupportedTopic
  if ((!ungroundedRead && !unfinished && decision.kind !== 'NEEDS_ASSISTANT') || !genericRequest || state?.phase === 'customer_entry' || (!unqualifiedHandoff && !uncertainMeaning && !unsupportedTopic && (mentions?.products.length || mentions?.categories.length)))
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
  let validChoice = false
  let choice: typeof serviceChoices[number] = 'UNCERTAIN'
  try {
    const response = await complete({ temperature: 0, messages: buildDecisionMessages(`${orderingInstructions('qualification')}
你只判斷本句完整目的，選一種交接，不選商品或執行操作。
SERVICE_INFORMATION_ONLY：本機身分能力、店家一般服務資訊、確認有沒有收到語音、了解／先問店員等非操作結束回應。
MENU_INFORMATION_ONLY：純餐點、成分、價格、推薦的資訊查詢。ORDER_INFORMATION_ONLY：核對購物車／訂單目前內容或狀態，保持唯讀，不設定用餐方式或開始結帳。改瀏覽價格、種類或換推薦批次仍是查詢，不是替換購物車。整句最後已否定或撤回的操作不能算仍成立；只問有沒有就保持查詢。「核對訂單／看訂單／查購物車」選ORDER_INFORMATION_ONLY且是唯讀，不能設內用或開始結帳。
ORDER_MUTATION：明確要求新增、修改、替換、取消、設定用餐方式或回答操作問題；混合資訊與操作仍保留全部明確操作。只有資料缺漏交Menu補問。
CLARIFY_SERVICE：確定向本機求助，但沒有說清服務目的；只有指代且當輪沒有可唯一解析對象時，先問指的是哪一道，不推薦替代、不從目錄猜選；已明確指定餐點但缺份數／規格仍交ORDER_MUTATION由Menu補問。包含含糊求助後只說先不要變更，不能因操作未明當成背景。
BACKGROUND：確定向同伴談話、引述或無本機需求的背景內容。Jev已判為服務的含糊求助不能僅因意思不明改成背景。
UNCERTAIN：無法確認服務對象，或尚未說完且沒有完整求助目的。
ACKNOWLEDGEMENT：目前對話中的單純了解或附和，沒有有效操作問題時的好／對不代表任選一項或結帳，也不是向同伴背景。KEEP_ORDER：向本機明確要求保持目前訂單、先不要新增或變更，沒有其他資訊問題；否定尚未加入或訂單不存在的餐點、只表示先保留現況也屬此項，不是結帳同意。取消訂單中已有餐點仍屬ORDER_MUTATION。應簡短回應保留現況，不執行取消或新增。IDLE：表示自己先看看或稍後再說，不再向本機要求處理，保持安靜。不能把明確要求先不要加餐或暫等當作自行瀏覽。選項列出的必要規格／份數回答屬ORDER_MUTATION，不是餐點資訊。只有實際要求資訊才選MENU_INFORMATION_ONLY；報品名加份數是在訂購時選ORDER_MUTATION。目前等待問題不代表本句一定在回答它。只呼叫resolve_service_scope。`, { phase: state?.phase, references: state?.references ?? [], productResolution: state?.productResolution, catalogEvidence: state?.catalogEvidence, interactionState: state?.interactionState, unavailableConditions: state?.unavailableConditionReferences ?? [], waitingFor: state?.waitingFor && state.waitingFor.expiresAt > Date.now() ? state.waitingFor : null, retainedRequests: state?.retainedRequests ?? [], ...(conversation ? { recentDialogue: conversation.messages.slice(-6) } : {}) }, transcript), tools: [{ type: 'function', function: { name: 'resolve_service_scope', description: '依完整原句區分服務資訊、純查詢、明確操作、背景與未明需求；不執行操作或產生餐點答案。', parameters: { type: 'object', properties: { choice: { type: 'string', enum: serviceChoices } }, required: ['choice'], additionalProperties: false } } }], tool_choice: 'required' })
    const parsed = safeParse(responseSchema, await response.json())
    const calls = parsed.success && parsed.output.choices.length === 1 ? parsed.output.choices[0]?.message.tool_calls : undefined
    if (response.ok && calls?.length === 1) {
      const selected = safeParse(choiceSchema, JSON.parse(calls[0]!.function.arguments))
      if (selected.success) {
        validChoice = true
        choice = selected.output.choice
      }
    }
  }
  catch {
    // An unavailable scope resolver cannot release the original menu guard.
  }
  const trace = decision.trace && typeof decision.trace === 'object' ? { trace: { ...decision.trace, serviceResolution: { choice, durationMs: performance.now() - startedAt } } } : {}
  const { actionId: _action, ...handoff } = { actionId: undefined, ...decision }
  if (validChoice && choice === 'CLARIFY_SERVICE') {
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
  if (validChoice && choice === 'UNCERTAIN' && (uncertainMeaning || ungroundedRead) && !state?.waitingFor) {
    // Main has understood that the purpose is still missing. Publish an owned
    // service clarification directly, instead of asking another model round
    // that could turn this into a stale price/category question.
    return { ...decision, kind: 'SERVICE_CLARIFICATION', question: { questionId: crypto.randomUUID(), question: '請再說明您想詢問或調整什麼，我會接著協助您。', sourceUtterance: transcript, contextKey: serviceContextKey(state ?? { phase: 'unknown' }), expiresAt: Date.now() + 30000 }, ...trace }
  }
  if (choice === 'ORDER_INFORMATION_ONLY')
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', resolvedBy: 'main-service', requestScope: 'order-information', ...trace }
  if (choice === 'MENU_INFORMATION_ONLY' && decision.kind !== 'FAST_ACTION')
    return { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', resolvedBy: 'main-service', requestScope: 'menu-information', ...trace }
  return choice === 'SERVICE_INFORMATION_ONLY' || choice === 'ACKNOWLEDGEMENT' || choice === 'KEEP_ORDER' ? { ...handoff, kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION', ...trace } : { ...decision, ...trace }
}
