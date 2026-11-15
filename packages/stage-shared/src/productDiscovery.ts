/** Observed catalog labels for discovery; inferred fragments never become aliases. */
export interface ProductLabel {
  name: string
  aliases?: readonly string[]
  category?: string
}

/**
 * Resolves literal catalog mentions, suppressing only shorter labels occupying
 * the same text. A generic alias inside A套餐 must not also select B套餐, while
 * separately spoken products and shared identical aliases remain ambiguous.
 * This establishes targets, never purchase intent or consent.
 */
export function productMentions<T extends ProductLabel>(menu: readonly T[], transcript: string): Array<{ product: T, label: string }> {
  const spans = menu.flatMap(product => [product.name, ...(product.aliases ?? [])].flatMap((label) => {
    if (!label)
      return []
    const matches: Array<{ product: T, label: string, start: number, end: number }> = []
    for (let start = transcript.indexOf(label); start >= 0; start = transcript.indexOf(label, start + 1))
      matches.push({ product, label, start, end: start + label.length })
    return matches
  }))
  const resolved = new Map<T, string>()
  // Earlier starts and longer equal-start labels establish containment in one
  // sweep. Identical spans remain separate targets rather than guessing one.
  spans.sort((left, right) => left.start - right.start || right.end - left.end)
  let coveringStart = -1
  let coveringEnd = -1
  for (const match of spans) {
    const contained = coveringEnd >= match.end && (coveringStart < match.start || coveringEnd > match.end)
    if (match.end > coveringEnd) {
      coveringStart = match.start
      coveringEnd = match.end
    }
    if (contained)
      continue
    if ((resolved.get(match.product)?.length ?? 0) < match.label.length)
      resolved.set(match.product, match.label)
  }
  return [...resolved].map(([product, label]) => ({ product, label }))
}

/** Longest literal fragment is discovery evidence only, never a configured alias. */
export function productFragment(item: ProductLabel, menu: readonly ProductLabel[], transcript: string) {
  const normalized = transcript.toLocaleLowerCase().replace(/\s/g, '')
  // Some external catalogs omit category labels. Only actual supplied labels
  // can exclude category fragments; missing metadata is not an invented alias.
  const categories = new Set(menu.flatMap(item => item.category ? [item.category.toLocaleLowerCase(), ...(item.category.endsWith('食') ? [item.category.slice(0, -1).toLocaleLowerCase()] : [])] : []))
  const fragments = [item.name, ...(item.aliases ?? [])].flatMap((name) => {
    const token = name.toLocaleLowerCase().replace(/\s/g, '')
    const matches: string[] = []
    for (let length = token.length; length >= 2; length--) {
      for (let start = 0; start <= token.length - length; start++) {
        const fragment = token.slice(start, start + length)
        if (!categories.has(fragment) && normalized.includes(fragment))
          matches.push(fragment)
      }
    }
    return matches
  })
  return fragments.sort((left, right) => right.length - left.length)[0]
}
