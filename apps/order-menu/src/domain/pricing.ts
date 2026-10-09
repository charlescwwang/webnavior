import type { PriceChoice, PriceConditions, PriceEvidence } from '../../../server/src/services/domain/kiosk-interaction-decision/priceContracts'

/** Safe clarification when no complete single-dish price interpretation exists. */
export const priceClarification = '請指定單份餐點的價格上限或範圍，例如「100 元以下」。整筆預算、左右或更便宜的需求，目前需要先確認單份價格條件。'

export const priceProperties = {
  minPrice: { type: 'integer', minimum: 0, description: '單份基本售價下限，POS 售價單位；不是整筆預算。' },
  maxPrice: { type: 'integer', minimum: 0, description: '單份基本售價上限，POS 售價單位；不是整筆預算。' },
  minPriceExclusive: { type: 'boolean', description: 'true 表示不含下限，必須搭配 minPrice。' },
  maxPriceExclusive: { type: 'boolean', description: 'true 表示不含上限，必須搭配 maxPrice。' },
  priceOrder: { type: 'string', enum: ['ASC'], description: '按真實單份基本售價由低到高；同價保留原菜單順序。' },
} as const

/** Validates the same bounded price contract for all menu tools and model handoffs. */
export function priceConditions(input: Record<string, unknown>): PriceConditions {
  const result: PriceConditions = {}
  for (const key of ['minPrice', 'maxPrice'] as const) {
    const value = input[key]
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
        throw new Error('Invalid price bound: use non-negative catalog currency integers.')
      result[key] = value
    }
  }
  for (const key of ['minPriceExclusive', 'maxPriceExclusive'] as const) {
    const value = input[key]
    if (value !== undefined) {
      if (typeof value !== 'boolean' || result[key === 'minPriceExclusive' ? 'minPrice' : 'maxPrice'] === undefined)
        throw new Error('Invalid price exclusivity without its bound.')
      if (value)
        result[key] = true
    }
  }
  if (input.priceOrder !== undefined) {
    if (input.priceOrder !== 'ASC')
      throw new Error('Unsupported price ordering.')
    result.priceOrder = 'ASC'
  }
  if (result.minPrice !== undefined && result.maxPrice !== undefined && (result.minPrice > result.maxPrice || (result.minPrice === result.maxPrice && (result.minPriceExclusive || result.maxPriceExclusive))))
    throw new Error('Invalid price range.')
  return result
}

/** Intersects prices before ranking/limiting; never relaxes bounds to fill a batch. */
export function filterPrices<T extends { price: number }>(items: readonly T[], conditions: PriceConditions): T[] {
  const matches = items.filter(item => Number.isFinite(item.price)
    && (conditions.minPrice === undefined || (conditions.minPriceExclusive ? item.price > conditions.minPrice : item.price >= conditions.minPrice))
    && (conditions.maxPrice === undefined || (conditions.maxPriceExclusive ? item.price < conditions.maxPrice : item.price <= conditions.maxPrice)))
  return conditions.priceOrder === 'ASC' ? matches.sort((a, b) => a.price - b.price) : matches
}

/** An Agent may narrow verified task bounds, never replace or relax them. */
export function intersectPrices(verified: PriceConditions, supplied: PriceConditions): PriceConditions {
  const result: PriceConditions = { ...verified }
  for (const bound of ['minPrice', 'maxPrice'] as const) {
    const exclusive = bound === 'minPrice' ? 'minPriceExclusive' : 'maxPriceExclusive'
    const value = supplied[bound]
    const current = result[bound]
    if (value === undefined)
      continue
    if (current === undefined || (bound === 'minPrice' ? value > current : value < current)) {
      result[bound] = value
      delete result[exclusive]
      if (supplied[exclusive])
        result[exclusive] = true
    }
    else if (value === current && supplied[exclusive]) {
      result[exclusive] = true
    }
  }
  if (!result.priceOrder && supplied.priceOrder)
    result.priceOrder = supplied.priceOrder
  return priceConditions({ ...result })
}

/** Stable customer-facing labels also serve batch-state descriptions, not spoken prices. */
export function priceDescription(conditions: PriceConditions): string {
  const labels: string[] = []
  if (conditions.minPrice !== undefined)
    labels.push(`${conditions.minPriceExclusive ? '高於' : '至少'} NT$${conditions.minPrice}`)
  if (conditions.maxPrice !== undefined)
    labels.push(`${conditions.maxPriceExclusive ? '低於' : '不超過'} NT$${conditions.maxPrice}`)
  if (conditions.priceOrder)
    labels.push('價格由低到高')
  return labels.join('、')
}

function amountFrom(text: string) {
  const normalized = text.normalize('NFKC')
  if (/^\d+$/.test(normalized))
    return Number(normalized)
  // Shorthand such as 一百二 can mean 120 or 102. Accept only explicit
  // positional numerals rather than choosing a budget on the customer's behalf.
  if (!/^(?:[一二兩两三四五六七八九]千)?(?:[一二兩两三四五六七八九]百)?(?:[零〇]?[一二兩两三四五六七八九]?十)?(?:[零〇]?[一二兩两三四五六七八九])?$/.test(normalized)
    || /[百千][一二兩两三四五六七八九]$/.test(normalized)) {
    return undefined
  }
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }
  let total = 0
  let digit = 0
  for (const character of normalized) {
    if (character in digits) {
      digit = digits[character]!
    }
    else if (character in units) {
      total += (digit || 1) * units[character]!
      digit = 0
    }
    else { return undefined }
  }
  return total + digit
}

/**
 * Finds currency literals, including a shared-unit range, and offers bounded
 * interpretations. Quantities/party sizes without money units are never money.
 * Approximation and total-order allocation intentionally have no executable choice.
 */
export function priceEvidence(transcript: string): PriceEvidence | undefined {
  transcript = transcript.normalize('NFKC')
  const amounts: PriceEvidence['amounts'] = []
  let malformed = /\d[.,]\d+\s*[元塊块]|(?:NT)?\$\s*\d+[.,]\d+|-\s*\d+\s*[元塊块]/i.test(transcript)
  const consumed: Array<[number, number]> = []
  const range = /([0-9零〇一二兩两三四五六七八九十百千]+)(?:\s*[元塊块][錢钱]?)?\s*[到至~–-]\s*([0-9零〇一二兩两三四五六七八九十百千]+)\s*[元塊块][錢钱]?/g
  for (const match of transcript.matchAll(range)) {
    consumed.push([match.index!, match.index! + match[0].length])
    for (const text of [match[1]!, match[2]!]) {
      const amount = amountFrom(text)
      if (amount !== undefined && Number.isSafeInteger(amount))
        amounts.push({ text, amount })
      else malformed = true
    }
  }
  {
    const money = /([0-9零〇一二兩两三四五六七八九十百千]+)\s*[元塊块][錢钱]?|(?:NT)?\$\s*([0-9零〇一二兩两三四五六七八九十百千]+)/gi
    for (const match of transcript.matchAll(money)) {
      if (consumed.some(([start, end]) => match.index! >= start && match.index! < end))
        continue
      const text = match[1] ?? match[2]!
      const amount = amountFrom(text)
      if (amount !== undefined && Number.isSafeInteger(amount))
        amounts.push({ text: match[0], amount })
      else malformed = true
    }
  }
  const sorting = /便宜|低價|最低|低到高/.test(transcript)
  if (!amounts.length && !malformed && !sorting && !/價格|價錢|價位|預算|多少錢|幾塊/.test(transcript))
    return undefined
  const choices: PriceChoice[] = [
    { id: 'INFORMATION', kind: 'information', description: '只詢問已知餐點價格，展示品項與真實售價；不是價格篩選，不新增訂購。' },
    { id: 'NONE', kind: 'none', description: '價格詞或金額只是品名、敘述或背景，本句沒有詢價或價格條件。' },
    { id: 'UNSUPPORTED', kind: 'unsupported', description: '價格需求無法完整表示：模糊／相對預算、整筆訂單或多份總預算、衝突、多個不同預算或其他未提供條件；需釐清，不忽略條件。' },
  ]
  const unsupported = malformed || /左右|大概|差不多|總共|總預算|總計|合計|共\s*[0-9一二兩两三四五六七八九十百千]|便宜一點|更便宜|比.+便宜/.test(transcript) || amounts.length > 2
  if (!unsupported) {
    const add = (id: string, conditions: PriceConditions) => {
      choices.push({ id, kind: 'condition', conditions, description: `只要求單份基本售價${priceDescription(conditions)}，不新增訂購。` })
      if (sorting && !conditions.priceOrder)
        choices.push({ id: `${id}_ASC`, kind: 'condition', conditions: { ...conditions, priceOrder: 'ASC' }, description: `單份基本售價${priceDescription({ ...conditions, priceOrder: 'ASC' })}，不新增訂購。` })
    }
    if (amounts.length === 1) {
      const amount = amounts[0]!.amount
      add('UPPER_INCLUSIVE', { maxPrice: amount })
      add('UPPER_EXCLUSIVE', { maxPrice: amount, maxPriceExclusive: true })
      add('LOWER_INCLUSIVE', { minPrice: amount })
      add('LOWER_EXCLUSIVE', { minPrice: amount, minPriceExclusive: true })
      add('EXACT', { minPrice: amount, maxPrice: amount })
    }
    if (amounts.length === 2 && amounts[0]!.amount <= amounts[1]!.amount)
      add('RANGE', { minPrice: amounts[0]!.amount, maxPrice: amounts[1]!.amount })
    if (sorting)
      add('ASC', { priceOrder: 'ASC' })
  }
  return { amounts: amounts.slice(0, 2), choices }
}
