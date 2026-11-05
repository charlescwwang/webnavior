import type { PriceChoice, PriceConditions, PriceEvidence } from '../../../server/src/services/domain/kiosk-interaction-decision/priceContracts'

import { parseNumericSlot } from './numericSlots'

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
    labels.push(`${conditions.minPriceExclusive ? '高於' : '至少'} ${conditions.minPrice}元`)
  if (conditions.maxPrice !== undefined)
    labels.push(`${conditions.maxPriceExclusive ? '低於' : '不超過'} ${conditions.maxPrice}元`)
  if (conditions.priceOrder)
    labels.push('價格由低到高')
  return labels.join('、')
}

const priceAmountFrom = (text: string) => parseNumericSlot(text, true)

// Clause punctuation may precede a new amount. Only punctuation joining numeric
// fragments is a malformed amount; a leading minus remains non-executable.
function brokenAmountBoundary(before: string, after: string): boolean {
  return /-\s*$/.test(before)
    || /[0-9零〇一二兩两三四五六七八九十百千萬万億亿][.,]\s*$/.test(before)
    || /^[.,]\d/.test(after)
}

/**
 * Finds currency literals, price/comparison amounts and numeric ranges without
 * requiring a currency unit, then offers interpretations for Jev to qualify. Explicit quantity or
 * time ranges are not money; a bare range is evidence, never filter authority.
 * Approximation and total-order allocation intentionally have no executable choice.
 */
export function priceEvidence(transcript: string): PriceEvidence | undefined {
  transcript = transcript.normalize('NFKC')
  const amounts: PriceEvidence['amounts'] = []
  let malformed = /\d[.,]\d+\s*[元塊块]|(?:NT)?\$\s*\d+[.,]\d+/i.test(transcript)
  // The integer catalog cannot represent spoken fractional currency. Do not
  // retain only the whole-dollar prefix of 十二塊五 or 一百元半. Serving counts
  // after the currency remain separate quantities rather than fractional prices.
  for (const match of transcript.matchAll(/[元塊块]\s*(?:半|[0-9零〇一二兩两三四五六七八九十百千萬万]+)/g)) {
    const after = transcript.slice(match.index! + match[0].length)
    if (!/^\s*[份位人碗杯顆個个]/.test(after))
      malformed = true
  }
  malformed ||= /[0-9零〇一二兩两三四五六七八九十百千萬万]+[多來来][元塊块]/.test(transcript)
  const consumed: Array<[number, number]> = []
  const range = /([0-9零〇一二兩两三四五六七八九十百千萬万億亿]+)(?:\s*[元塊块][錢钱]?)?\s*[到至~–-]\s*([0-9零〇一二兩两三四五六七八九十百千萬万億亿]+)(?:\s*[元塊块][錢钱]?)?/g
  for (const match of transcript.matchAll(range)) {
    const before = transcript.slice(0, match.index)
    const after = transcript.slice(match.index! + match[0].length)
    // Do not turn clock fragments or explicit serving/party-size ranges into
    // money. Semantic price polarity still belongs to Jev, including NONE.
    if (before.endsWith(':') || after.startsWith(':') || (!/[元塊块]/.test(match[0]) && /^\s*(?:[份位人碗杯顆個个]|分鐘|分钟|小時|小时)/.test(after)))
      continue
    if (brokenAmountBoundary(before, after))
      malformed = true
    consumed.push([match.index!, match.index! + match[0].length])
    for (const text of [match[1]!, match[2]!]) {
      const amount = priceAmountFrom(text)
      if (amount !== undefined && Number.isSafeInteger(amount))
        amounts.push({ text, amount })
      else malformed = true
    }
  }
  // A hyphen inside an accepted range is a separator, not a negative amount.
  for (const match of transcript.matchAll(/-\s*\d+\s*[元塊块]/g)) {
    if (!consumed.some(([start, end]) => match.index! >= start && match.index! < end))
      malformed = true
  }
  {
    const money = /([0-9零〇一二兩两三四五六七八九十百千萬万億亿]+)\s*[元塊块][錢钱]?|(?:NT)?\$\s*([0-9零〇一二兩两三四五六七八九十百千萬万億亿]+)|(?:價格|价格|價錢|价钱|價位|价位|預算|预算|不到|低於|低于|少於|少于|高於|高于|超過|超过|大於|大于|至少|至多|最多|最少|上限|下限|剛好|刚好|正好|等於|等于|[<>≤≥]=?)\s*([0-9零〇一二兩两三四五六七八九十百千萬万億亿]+)|([0-9零〇一二兩两三四五六七八九十百千萬万億亿]+)\s*(?=以下|以內|以内|以上|左右|起)/gi
    for (const match of transcript.matchAll(money)) {
      // Each alternative captures exactly one literal. Check its own span:
      // a prefix like 價格 may start before an already-consumed range.
      const text = match.slice(1).find(value => value !== undefined)!
      const start = match.index! + match[0].indexOf(text)
      if (consumed.some(([from, end]) => start >= from && start < end))
        continue
      const before = transcript.slice(0, start)
      const after = transcript.slice(start + text.length)
      if (before.endsWith(':') || after.startsWith(':') || /^\s*(?:[份位人碗杯顆個个]|分鐘|分钟|小時|小时)/.test(after))
        continue
      if (brokenAmountBoundary(before, after))
        malformed = true
      const amount = priceAmountFrom(text)
      if (amount !== undefined && Number.isSafeInteger(amount))
        amounts.push({ text: match[0], amount })
      else malformed = true
    }
  }
  const sorting = /便宜|低價|最低|低到高/.test(transcript)
  const unsupportedOrder = /高到低|[貴贵]到便宜|最[貴贵]的|[貴贵]的先/.test(transcript)
  if (!amounts.length && !malformed && !sorting && !unsupportedOrder && !/價格|價錢|價位|預算|多少錢|幾塊/.test(transcript))
    return undefined
  const choices: PriceChoice[] = [
    { id: 'INFORMATION', kind: 'information', description: '只詢問已知餐點價格，展示品項與真實售價；不是價格篩選，不新增訂購。' },
    { id: 'NONE', kind: 'none', description: '價格詞或金額只是品名、敘述或背景，本句沒有詢價或價格條件。' },
    { id: 'UNSUPPORTED', kind: 'unsupported', description: '價格需求無法完整表示：模糊／相對預算、整筆訂單或多份總預算、未提供的排序、衝突、多個不同預算或其他未提供條件；需釐清，不忽略條件。' },
  ]
  const unsupported = malformed || unsupportedOrder || /左右|大概|差不多|總共|總預算|總計|合計|加起來|加起来|共\s*[0-9一二兩两三四五六七八九十百千]|便宜一點|更便宜|比.+便宜/.test(transcript) || amounts.length > 2
  if (!unsupported) {
    const add = (id: string, conditions: PriceConditions) => {
      // Make inclusion explicit for the small classifier. Merely contrasting
      // 不超過 with 低於 caused 不到 to select the inclusive bound confidently.
      const boundaries: string[] = []
      if (conditions.minPrice !== undefined && conditions.minPrice === conditions.maxPrice) {
        boundaries.push(`剛好／正好／等於${conditions.minPrice}，只能是這個價格，不是上限或下限`)
      }
      else {
        if (conditions.minPrice !== undefined)
          boundaries.push(conditions.minPriceExclusive ? `超過／高於${conditions.minPrice}；${conditions.minPrice}本身不可以` : `${conditions.minPrice}以上／至少${conditions.minPrice}，可接受更貴的價格；${conditions.minPrice}本身也可以`)
        if (conditions.maxPrice !== undefined)
          boundaries.push(conditions.maxPriceExclusive ? `不到／低於${conditions.maxPrice}；${conditions.maxPrice}本身不可以` : `${conditions.maxPrice}以下／以內／不超過${conditions.maxPrice}，可接受更便宜的價格；${conditions.maxPrice}本身也可以`)
      }
      const scope = boundaries.length ? `單份售價${boundaries.join('，而且')}。` : '未指定價格上下限。'
      choices.push({ id, kind: 'condition', conditions, description: `${scope}${conditions.priceOrder ? '要求便宜的先／先看便宜的／由低到高／最便宜優先排序。' : '未要求價格排序。'}不新增訂購。` })
      if (sorting && !conditions.priceOrder)
        choices.push({ id: `${id}_ASC`, kind: 'condition', conditions: { ...conditions, priceOrder: 'ASC' }, description: `${scope}另要求便宜的先／先看便宜的／由低到高／最便宜優先排序。不新增訂購。` })
    }
    if (amounts.length === 1) {
      const amount = amounts[0]!.amount
      add('UPPER_INCLUSIVE', { maxPrice: amount })
      add('UPPER_EXCLUSIVE', { maxPrice: amount, maxPriceExclusive: true })
      add('LOWER_INCLUSIVE', { minPrice: amount })
      add('LOWER_EXCLUSIVE', { minPrice: amount, minPriceExclusive: true })
      add('EXACT', { minPrice: amount, maxPrice: amount })
    }
    if (amounts.length === 2 && amounts[0]!.amount <= amounts[1]!.amount) {
      add('RANGE', { minPrice: amounts[0]!.amount, maxPrice: amounts[1]!.amount })
      if (amounts[0]!.amount < amounts[1]!.amount) {
        add('RANGE_MIN_EXCLUSIVE', { minPrice: amounts[0]!.amount, minPriceExclusive: true, maxPrice: amounts[1]!.amount })
        add('RANGE_MAX_EXCLUSIVE', { minPrice: amounts[0]!.amount, maxPrice: amounts[1]!.amount, maxPriceExclusive: true })
        add('RANGE_EXCLUSIVE', { minPrice: amounts[0]!.amount, minPriceExclusive: true, maxPrice: amounts[1]!.amount, maxPriceExclusive: true })
      }
    }
    if (sorting)
      add('ASC', { priceOrder: 'ASC' })
  }
  return { amounts: amounts.slice(0, 2), choices }
}
