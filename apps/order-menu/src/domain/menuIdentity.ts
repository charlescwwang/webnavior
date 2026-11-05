import type { MenuItem } from './order-machine'

/** Only known catalog names and merchant-provided aliases can identify items. */
export function resolveMenuItems(menu: readonly MenuItem[], transcript: string) {
  const normalized = transcript.toLocaleLowerCase().replace(/\s/g, '')
  const occurrences = menu.flatMap((item) => {
    return [item.name, ...(item.aliases ?? [])].flatMap((name) => {
      const token = name.toLocaleLowerCase().replace(/\s/g, '')
      if (!token)
        return []
      const matches: Array<{ end: number, item: MenuItem, start: number }> = []
      for (let start = normalized.indexOf(token); start >= 0; start = normalized.indexOf(token, start + 1)) matches.push({ end: start + token.length, item, start })
      return matches
    })
  })
  // Prefer the longest real catalog name at an overlapping location, while
  // retaining separately spoken products elsewhere in the same utterance.
  const chosen: typeof occurrences = []
  for (const match of occurrences.sort((left, right) => (right.end - right.start) - (left.end - left.start))) {
    if (chosen.some(existing => existing.item.id === match.item.id))
      continue
    if (chosen.some(existing => match.start < existing.end && existing.start < match.end && (match.start !== existing.start || match.end !== existing.end)))
      continue
    chosen.push(match)
  }
  return menu.filter(item => chosen.some(match => match.item.id === item.id))
}

/** Proposes literal catalog fragments, never a fuzzy match accepted as an item ID. */
export function possibleMenuItems(menu: readonly MenuItem[], transcript: string) {
  return menu.filter(item => productFragment(item, menu, transcript) !== undefined)
}

/** Longest literal fragment is discovery evidence only, never a configured alias. */
export function productFragment(item: MenuItem, menu: readonly MenuItem[], transcript: string) {
  const normalized = transcript.toLocaleLowerCase().replace(/\s/g, '')
  const categories = new Set(menu.flatMap(item => [item.category.toLocaleLowerCase(), ...(item.category.endsWith('食') ? [item.category.slice(0, -1).toLocaleLowerCase()] : [])]))
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

export function resolveCategories(menu: readonly MenuItem[], transcript: string) {
  const normalized = transcript.toLocaleLowerCase().replace(/\s/g, '')
  const matches = [...new Set(menu.map(item => item.category))].filter((category) => {
    const name = category.toLocaleLowerCase()
    return normalized.includes(name) || (name.endsWith('食') && normalized.includes(name.slice(0, -1)))
  })
  const best = Math.max(0, ...matches.map(category => category.length))
  return matches.filter(category => category.length === best)
}

/** Literal query matching shares merchant aliases with intent resolution; fragments remain discovery only. */
export function itemMatchesQuery(item: MenuItem, query: string) {
  const normalized = query.toLocaleLowerCase().replace(/\s/g, '')
  return [item.id, item.name, ...(item.aliases ?? []), item.description, item.category]
    .some(value => value.toLocaleLowerCase().replace(/\s/g, '').includes(normalized))
}
