import { normalizeSlotNumbers } from './orderingSlots'

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

/** Closed literal coverage for Jev; incomplete or mixed requests remain with Main. */
export function parsePbDumplingServings(transcript: string, productName: string, spokenLabel: string) {
  if (productName !== '周氏水餃(最低8顆)' || !spokenLabel || transcript.split(spokenLabel).length !== 2)
    return
  const slots = normalizeSlotNumbers(transcript.replace(spokenLabel, '')).replaceAll(/[\s，,。！!]/g, '')
  const match = slots.match(/^(?:請幫我|請給我|幫我|給我|我要|我想要|再加|再來|[請要加來再多])?(?:要|加)?(?:(\d+)顆(\d+)份|(\d+)份(?:每份)?(\d+)顆|每份(\d+)顆(?:要|共)?(\d+)份)(?:謝謝)?$/)
  if (!match)
    return
  const piecesPerServing = Number(match[1] ?? match[4] ?? match[5])
  const quantity = Number(match[2] ?? match[3] ?? match[6])
  if (piecesPerServing < 8 || piecesPerServing > 108 || quantity < 1 || quantity > 99)
    return
  return { piecesPerServing, quantity, extra: pbDumplingExtraCount(productName, piecesPerServing) }
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
  // optional 水餃 at 8 dollars each (2026-11-12 menu + 加量 attributes).
  // This is a merchant-specific presentation rule, never a general inference
  // from a minimum notice. A changed price or unknown option keeps serving units.
  const counted = meal.name === '周氏水餃(最低8顆)' && options !== undefined
    && options.every(option => option.name === '水餃' && Number.isInteger(option.quantity) && option.quantity > 0)
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
