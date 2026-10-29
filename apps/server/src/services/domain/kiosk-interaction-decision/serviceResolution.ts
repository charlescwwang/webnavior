import type { KioskDecisionState, KioskInteractionDecision } from './contracts'

import { array, literal, object, picklist, safeParse, strictObject, string } from 'valibot'

const choiceSchema = strictObject({ choice: picklist(['SERVICE_INFO', 'MEAL_REQUEST', 'UNCERTAIN']) })
const responseSchema = object({ choices: array(object({ message: object({ tool_calls: array(object({ function: object({ name: literal('resolve_service_scope'), arguments: string() }) })) }) })) })

/** Resolves generic Main handoffs without weakening evidence requirements for food or orders. */
export async function resolveServiceHandoff(decision: KioskInteractionDecision, transcript: string, state: KioskDecisionState | undefined, complete: (body: Record<string, unknown>) => Promise<Response>): Promise<KioskInteractionDecision> {
  const mentions = state?.catalogEvidence
  const genericRequest = decision.reason === undefined || (decision.reason === 'NEW_REQUEST' && state?.phase === 'ordering')
  if (decision.kind !== 'NEEDS_ASSISTANT' || !genericRequest || state?.phase === 'customer_entry' || mentions?.products.length || mentions?.categories.length)
    return decision
  const startedAt = performance.now()
  let choice: 'SERVICE_INFO' | 'MEAL_REQUEST' | 'UNCERTAIN' = 'UNCERTAIN'
  try {
    const response = await complete({ temperature: 0, messages: [
      { role: 'system', content: '本輪已通過服務對象判斷，但尚未分類交給助手的需求。獨立讀完整原句，只確認能否單靠店家已提供的服務資訊回答。SERVICE_INFO 僅限純粹詢問本機身分／能力、電話用途、店名、營業時間、一般付款方式、發票政策、點餐管道或取餐／送餐方式。MEAL_REQUEST 包含任何餐點查詢、偏好、成分、價格、比較、推薦、購物車／訂單／即時付款或送餐狀態、操作或有效操作問題的回答；同句包含服務資訊和上述需求也選此項。不要把訂單取消、拒絕某食物或含糊飲食需求當成一般服務資訊。不能確定選 UNCERTAIN。只呼叫 resolve_service_scope，不回答、不查菜單、不執行或授權任何操作。' },
      { role: 'user', content: JSON.stringify({ customerUtterance: transcript, phase: state?.phase, waitingFor: state?.waitingFor && state.waitingFor.expiresAt > Date.now() ? state.waitingFor : null }) },
    ], tools: [{ type: 'function', function: { name: 'resolve_service_scope', description: '確認是否為純粹服務資訊問題；不產生操作或餐點答案。', parameters: { type: 'object', properties: { choice: { type: 'string', enum: ['SERVICE_INFO', 'MEAL_REQUEST', 'UNCERTAIN'] } }, required: ['choice'], additionalProperties: false } } }], tool_choice: 'required' })
    const parsed = safeParse(responseSchema, await response.json())
    const calls = parsed.success && parsed.output.choices.length === 1 ? parsed.output.choices[0]?.message.tool_calls : undefined
    if (response.ok && calls?.length === 1) {
      const selected = safeParse(choiceSchema, JSON.parse(calls[0]!.function.arguments))
      if (selected.success)
        choice = selected.output.choice
    }
  }
  catch {
    // An unavailable scope resolver cannot release the original menu guard.
  }
  const trace = decision.trace && typeof decision.trace === 'object' ? { trace: { ...decision.trace, serviceResolution: { choice, durationMs: performance.now() - startedAt } } } : {}
  return choice === 'SERVICE_INFO' ? { ...decision, reason: 'GENERAL_QUESTION', ...trace } : { ...decision, ...trace }
}
