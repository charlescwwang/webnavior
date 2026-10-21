import type { KioskInteractionDecision } from './contracts'
import type { PriceEvidence } from './priceContracts'

import { array, literal, object, safeParse, strictObject, string } from 'valibot'

const choiceSchema = strictObject({ choice: string() })
const responseSchema = object({ choices: array(object({ message: object({ tool_calls: array(object({ function: object({ name: literal('resolve_price_choice'), arguments: string() }) })) }) })) })

/** Lets Main resolve issued price semantics before the browser binds an unresolved read task. */
export async function resolvePriceHandoff(decision: KioskInteractionDecision, transcript: string, evidence: PriceEvidence | undefined, complete: (body: Record<string, unknown>) => Promise<Response>): Promise<KioskInteractionDecision> {
  if (!evidence?.choices.length || decision.kind !== 'NEEDS_ASSISTANT' || decision.priceChoiceId || !['UNCERTAIN_FILTER', 'UNSUPPORTED_PRICE'].includes(decision.reason ?? ''))
    return decision
  const startedAt = performance.now()
  let choice: string | undefined
  try {
    // Main receives the complete utterance and finite browser-issued choices,
    // never the weak Jev proposal or permission to invent amounts/operations.
    const response = await complete({ temperature: 0, messages: [
      { role: 'system', content: '獨立理解顧客完整原句的價格需求，只選提供的解讀。單純詢問餐點多少錢選 information；沒有價格需求選 none；明確單份售價條件選完整符合原句邊界與排序的 condition。整筆／多份預算、相對價格或未提供的解讀選 unsupported。不猜價格、不省略條件、不下單。無法確定選 UNCERTAIN。只呼叫 resolve_price_choice。' },
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
