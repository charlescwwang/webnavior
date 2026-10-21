import { array, literal, object, picklist, safeParse, string } from 'valibot'

const choiceSchema = object({ choice: picklist(['SKIP_PHONE', 'KEEP_PHONE', 'UNCERTAIN']) })
const responseSchema = object({ choices: array(object({ message: object({ tool_calls: array(object({ function: object({ name: literal('resolve_phone_choice'), arguments: string() }) })) }) })) })

/** Re-evaluates only the voluntary phone choice with Main; never exposes commerce tools. */
export async function resolvePhoneChoice(transcript: string, complete: (body: Record<string, unknown>) => Promise<Response>) {
  const startedAt = performance.now()
  let choice: 'SKIP_PHONE' | 'KEEP_PHONE' | 'UNCERTAIN' = 'UNCERTAIN'
  try {
    const response = await complete({ temperature: 0, messages: [
      { role: 'system', content: '目前畫面是自願電話登記。獨立理解顧客原句最後仍成立的意思，只判斷顧客是否明確向本機選擇略過電話。叫同伴名字對他說話或背景對話，即使出現「略過」也選 KEEP_PHONE；無法確認對象選 UNCERTAIN。SKIP_PHONE：現在略過、不留電話、不使用會員，或明確要求跳過登記直接點餐；在這個畫面單說「略過」也是完整選擇。KEEP_PHONE：沒有要求略過電話，包含詢問用途／能否略過、要求填寫電話、點餐、撤回餐點或拒絕推薦。否定的對象必須正確：不要某餐點不等於不要電話登記，撤回訂購不能推成直接點餐或略過電話。UNCERTAIN：無法確定。只呼叫 resolve_phone_choice，不回答、不執行任何操作。' },
      { role: 'user', content: JSON.stringify({ customerUtterance: transcript }) },
    ], tools: [{ type: 'function', function: { name: 'resolve_phone_choice', description: '判斷本句是否明確要求略過目前自願電話登記。', parameters: { type: 'object', properties: { choice: { type: 'string', enum: ['SKIP_PHONE', 'KEEP_PHONE', 'UNCERTAIN'] } }, required: ['choice'], additionalProperties: false } } }], tool_choice: 'required' })
    const parsed = safeParse(responseSchema, await response.json())
    const calls = parsed.success ? parsed.output.choices[0]?.message.tool_calls : undefined
    if (response.ok && calls?.length === 1) {
      const resolution = safeParse(choiceSchema, JSON.parse(calls[0]!.function.arguments))
      if (resolution.success)
        choice = resolution.output.choice
    }
  }
  catch {
    // A failed or malformed Main proposal preserves the existing decision,
    // including a silent service abstention; it never becomes permission to skip or replay an operation.
  }
  return { choice, durationMs: performance.now() - startedAt }
}
