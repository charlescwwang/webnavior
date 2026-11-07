import type { CatalogItem } from './contracts'

import { array, finite, minLength, minValue, number, object, pipe, safeParse, string } from 'valibot'

import { normalizeOrderingPrices } from '../../../../packages/stage-shared/src/kioskConversation'

const priceSourceSchema = object({ items: array(object({
  id: pipe(string(), minLength(1)),
  name: pipe(string(), minLength(1)),
  price: pipe(number(), finite(), minValue(0)),
  description: string(),
})) })

/** Maintenance warnings request merchant review; contextual prices are not necessarily wrong. */
export interface CatalogPriceWarning {
  itemId: CatalogItem['id']
  name: CatalogItem['name']
  price: CatalogItem['price']
  mentionedAmount: number
  kind: 'conflicting-base-price' | 'promotion-price' | 'bundle-price' | 'option-price' | 'unclassified-price'
  clause: string
}

/** Bounded, read-only diagnostics for source JSON and the vendor-neutral POS catalog. */
export function inspectCatalogPrices(input: unknown) {
  const parsed = safeParse(priceSourceSchema, input)
  if (!parsed.success)
    return { valid: false as const, checkedItems: 0, warningCount: 0, warnings: [] as CatalogPriceWarning[], truncated: false }
  const warnings: CatalogPriceWarning[] = []
  let warningCount = 0
  for (const item of parsed.output.items) {
    // Commas inside a grouped amount are not clause separators. NFKC is used
    // only for detection; neither the source catalog nor its description changes.
    const clauses = item.description.normalize('NFKC').split(/[，。；;\n]|,(?!\d{3}(?:\D|$))/u)
    for (const clause of clauses) {
      const normalized = normalizeOrderingPrices(clause)
      const amounts = [...normalized.matchAll(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*元/gu)]
      const compact = normalized.replaceAll(/\s/gu, '')
      const standalone = /^(?:(?:單份基本售價|單份售價|售價|每份|一份|單價|價格)[:：]?)?\d+(?:,\d{3})*(?:\.\d+)?元$/u.test(compact)
      for (const amount of amounts) {
        const mentionedAmount = Number(amount[1]!.replaceAll(',', ''))
        if (!Number.isFinite(mentionedAmount))
          continue
        let kind: CatalogPriceWarning['kind']
        // Explicit context takes precedence over interpreting an amount as a
        // base price. An option/bundle/promotion must be reviewed, never rewritten.
        if (/加購|加價|加料|升級|選配|另加/u.test(clause)) {
          kind = 'option-price'
        }
        else if (/原價|原售價|優惠|特價|促銷|折扣|折價|活動/u.test(clause)) {
          kind = 'promotion-price'
        }
        else if (standalone) {
          if (mentionedAmount === item.price)
            continue // The existing presentation policy already omits this exact duplicate.
          kind = 'conflicting-base-price'
        }
        // A standalone 一份80元 is a base price, not a bundle.
        else if (/(?:\d+|[一二三四五六七八九十兩]+)[份碗組盒]/u.test(clause)) {
          kind = 'bundle-price'
        }
        else {
          kind = 'unclassified-price'
        }
        warningCount++
        // Keep large supplier feeds from producing an unbounded API/log payload.
        // warningCount still counts every finding; truncation is explicit.
        if (warnings.length < 100)
          warnings.push({ itemId: item.id, name: item.name, price: item.price, mentionedAmount, kind, clause: clause.trim().slice(0, 240) })
      }
    }
  }
  return { valid: true as const, checkedItems: parsed.output.items.length, warningCount, warnings, truncated: warningCount > warnings.length }
}
