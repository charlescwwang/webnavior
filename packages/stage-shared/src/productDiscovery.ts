/** Observed catalog labels for discovery; inferred fragments never become aliases. */
export interface ProductLabel {
  name: string
  aliases?: readonly string[]
  category?: string
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
