import { normalizeSlotNumbers } from './orderingSlots'

/** Store 1kgJeql's observed single-piece extra (cart editor, 2026-11-16). */
export const pbDumplingExtraName = '水餃1顆'

/** Customer wording never replaces PB's original product identity or selectors. */
export function pbProductName(name: string) {
  return name === '周氏水餃(最低8顆)' ? '周氏水餃' : name
}

/** This store's verified basic serving; changed products/prices need fresh verification. */
export function pbBasicServing(name: string, unitPrice: number | undefined) {
  return name === '周氏水餃(最低8顆)' && unitPrice === 64 ? '基本每份8顆，最少8顆，可以加量' : undefined
}

/** Converts this store's confirmed eight-piece serving into per-serving extras. */
export function pbDumplingExtraCount(name: string, piecesPerServing: number): number {
  if (name !== '周氏水餃(最低8顆)' || !Number.isInteger(piecesPerServing) || piecesPerServing < 8 || piecesPerServing > 108)
    throw new Error('每份顆數只適用基本8顆的周氏水餃，請確認顆數與加量上限。')
  return piecesPerServing - 8
}

/**
 * Parses complete piece/serving clauses for this verified product. A piece-only
 * request denotes one serving; different configurations retain separate spans.
 * An empty label is allowed only when the caller already owns a product question.
 * Parsing data does not establish purchase intent or authorize a cart mutation.
 */
export function parsePbDumplingOrder(transcript: string, productName: string, spokenLabel: string) {
  if (productName !== '周氏水餃(最低8顆)' || (spokenLabel && !transcript.includes(spokenLabel)))
    return
  function serving(evidence: string) {
    if (spokenLabel && evidence.split(spokenLabel).length > 2)
      return
    const labelAt = spokenLabel ? evidence.indexOf(spokenLabel) : -1
    const continuation = normalizeSlotNumbers(labelAt >= 0 ? evidence.slice(labelAt + spokenLabel.length) : evidence).replaceAll(/\s/g, '')
    if (/^(?:再加|多加|加量|增加|加)\d+顆/.test(continuation))
      return // Relative extras need their own scope; they are not a total-piece order.
    const slots = normalizeSlotNumbers(spokenLabel ? evidence.replace(spokenLabel, '') : evidence)
      .replaceAll(/[\s，,。！!]/g, '')
      .replace(/^(?:請幫我|請給我|幫我|給我|我要|我想要|再加|再來|[請要加來再多])?(?:要|加)?/, '')
      .replace(/謝謝$/, '')
    const match = slots.match(/^(?:(\d+)顆(?:(\d+)份)?|(\d+)份(?:每份)?(\d+)顆|每份(\d+)顆(?:要|共)?(\d+)份)$/)
    // "正常" applies only to an explicitly counted serving of this product;
    // it never copies a previous customer's optional extras.
    const basic = slots.match(/^(?:(\d+)份(?:正常|基本|原本)|(?:正常|基本|原本)(\d+)份)$/)
    if (!match && !basic)
      return
    const piecesPerServing = basic ? 8 : Number(match![1] ?? match![4] ?? match![5])
    const quantity = basic ? Number(basic[1] ?? basic[2]) : Number(match![2] ?? match![3] ?? match![6] ?? 1)
    if (piecesPerServing < 8 || piecesPerServing > 108 || quantity < 1 || quantity > 99)
      return
    return { evidence, piecesPerServing, quantity, extra: pbDumplingExtraCount(productName, piecesPerServing) }
  }
  // A pause inside "每份十顆，兩份" is still one configuration. Split only
  // when the whole utterance is not one complete piece/serving clause.
  const whole = serving(transcript)
  if (whole)
    return [whole]
  const clauses = transcript.split(/[，,、；;和與]|另外|還要|以及/).map(clause => clause.trim()).filter(Boolean)
  if (clauses.length < 2 || clauses.length > 10)
    return
  const order = clauses.map(serving)
  return order.every(item => item !== undefined) ? order : undefined
}

/** Closed single-configuration coverage for Jev; compound requests remain with Main. */
export function parsePbDumplingServings(transcript: string, productName: string, spokenLabel: string) {
  const order = parsePbDumplingOrder(transcript, productName, spokenLabel)
  if (order?.length !== 1)
    return
  const { piecesPerServing, quantity, extra } = order[0]
  return { piecesPerServing, quantity, extra }
}

/** Confirmed per-serving options; omission means the adapter could not prove them. */
export interface PbMeal {
  name: string
  quantity: number
  unitPrice: number
  options?: readonly { name: string, quantity: number }[]
  description?: string
  note?: string
}

/** Formats a verified meal for confirmation/readback without changing its quantities. */
export function describePbMeal(meal: PbMeal) {
  const options = meal.options
  const extra = options?.reduce((sum, option) => sum + option.quantity, 0) ?? 0
  // Store 1kgJeql's observed PB item 2589 is 8 dumplings/64 dollars, with
  // optional 水餃1顆 at 8 dollars each (2026-11-16 cart editor).
  // This is a merchant-specific presentation rule, never a general inference
  // from a minimum notice. A changed price or unknown option keeps serving units.
  const counted = meal.name === '周氏水餃(最低8顆)' && options !== undefined
    && options.every(option => option.name === pbDumplingExtraName && Number.isInteger(option.quantity) && option.quantity > 0)
    && Math.round(meal.unitPrice * 100) === (64 + extra * 8) * 100
  let customization: string | undefined
  if (counted)
    customization = undefined // The total per-serving piece count already includes the extra dumplings.
  else if (options)
    customization = options.map(option => `${option.name} 每份 ${option.quantity} 個`).join('、')
  else
    customization = meal.description // Unknown structured options must retain the vendor's observed text.
  const details = [customization, meal.note ? `備註「${meal.note}」` : undefined].filter(Boolean).join('；')
  const serving = counted ? `每份 ${8 + extra} 顆，${meal.quantity} 份` : `${meal.quantity} 份`
  return `${pbProductName(meal.name)} ${serving}${details ? `（${details}）` : ''}`
}
