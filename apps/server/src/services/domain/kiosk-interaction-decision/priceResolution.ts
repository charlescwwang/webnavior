import type { KioskInteractionDecision } from './contracts'
import type { PriceEvidence } from './priceContracts'

import { array, literal, object, safeParse, strictObject, string } from 'valibot'

const choiceSchema = strictObject({ choice: string() })
const responseSchema = object({ choices: array(object({ message: object({ tool_calls: array(object({ function: object({ name: literal('resolve_price_choice'), arguments: string() }) })) }) })) })

/** Lets Main resolve issued price semantics before the browser binds an unresolved read task. */
export async function resolvePriceHandoff(decision: KioskInteractionDecision, transcript: string, evidence: PriceEvidence | undefined, complete: (body: Record<string, unknown>) => Promise<Response>): Promise<KioskInteractionDecision> {
  // These semantic handoffs have already admitted a service request, even
  // when Jev cannot choose its operation. Qualify the issued price evidence
  // before binding the task; provider failures remain unresolved. Recovery can
  // also admit a request after the ordinary pass skipped UNAVAILABLE.
  const recoveredService = decision.recovery?.status === 'completed' && decision.recovery.admission === 'service'
  const semanticHandoff = ['UNCERTAIN_FILTER', 'UNSUPPORTED_PRICE', 'UNCERTAIN_OPERATION', 'NEW_REQUEST', 'MENU_QUERY', 'UNRESOLVED_FILTER'].includes(decision.reason ?? '')
  if (!evidence?.choices.length || decision.kind !== 'NEEDS_ASSISTANT' || decision.priceChoiceId || (!recoveredService && !semanticHandoff))
    return decision
  const startedAt = performance.now()
  let choice: string | undefined
  try {
    // Main receives the complete utterance and finite browser-issued choices,
    // never the weak Jev proposal or permission to invent amounts/operations.
    const response = await complete({ temperature: 0, messages: [
      { role: 'system', content: '獨立理解顧客完整原句的價格部分，只選提供的解讀；同句的品名、成分、否定或其他飲食條件由後續完整需求處理，不能因有這些其他條件就選unsupported。明確品名加份數的點餐短句也屬現在訂購。已明確指定某餐點並要求份數，價格形容只是指代先前比較結果而沒有要求新增價格篩選時選none，仍保留訂購需求；相對找更便宜餐點才屬unsupported。單純詢問餐點多少錢選 information；沒有價格需求選 none；明確單份售價條件選完整符合原句邊界與排序的 condition。只有一個金額、在探索可吃哪一份餐點，且未要求多份合計或整張訂單分配時，該預算是單份售價上限，選包含該金額的上限 condition；例如「我有一百元，可以吃什麼」是找100元以內的單份選項，不承諾多份總價。明確多份／多人合計、整張訂單預算分配、相對價格或未提供的解讀選 unsupported。不猜價格、不省略條件、不下單。無法確定選 UNCERTAIN。只呼叫 resolve_price_choice。' },
      { role: 'user', content: JSON.stringify({ customerUtterance: transcript, amounts: evidence.amounts, choices: evidence.choices }) },
    ], tools: [{ type: 'function', function: { name: 'resolve_price_choice', description: '選擇本句完整的價格解讀，不執行菜單或訂單操作。', parameters: { type: 'object', properties: { choice: { type: 'string', enum: [...evidence.choices.map(choice => choice.id), 'UNCERTAIN'] } }, required: ['choice'], additionalProperties: false } } }], tool_choice: 'required' })
    const parsed = safeParse(responseSchema, await response.json())
    const calls = parsed.success && parsed.output.choices.length === 1 ? parsed.output.choices[0]?.message.tool_calls : undefined
    if (response.ok && calls?.length === 1) {
      const selected = safeParse(choiceSchema, JSON.parse(calls[0]!.function.arguments))
      if (selected.success && evidence.choices.some(choice => choice.id === selected.output.choice))
        choice = selected.output.choice
    }
  }
  catch {
    // Failure leaves the unresolved guard in place; it cannot authorize a read
    // under guessed price conditions or revive a proposed order mutation.
  }
  const trace = decision.trace && typeof decision.trace === 'object' ? { trace: { ...decision.trace, priceResolution: { choice: choice ?? 'UNCERTAIN', durationMs: performance.now() - startedAt } } } : {}
  if (!choice)
    return { ...decision, ...trace }
  const selected = evidence.choices.find(candidate => candidate.id === choice)!
  let reason = decision.reason
  if (selected.kind === 'unsupported')
    reason = 'UNSUPPORTED_PRICE'
  else if (reason === 'UNSUPPORTED_PRICE')
    reason = 'MENU_QUERY'
  return { ...decision, reason, priceChoiceId: choice, ...trace }
}
