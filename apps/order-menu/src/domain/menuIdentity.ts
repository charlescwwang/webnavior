import type { MenuItem } from './order-machine'

import { ratio, WRatio } from 'fuzzball'

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
  // A side dish mentioned in a description does not make the whole meal that
  // product kind (e.g. a bento with soup is not a soup offering). Ingredient
  // requirements use composition filters; literal discovery uses menu labels.
  return [item.name, ...(item.aliases ?? []), item.category]
    .some(value => value.toLocaleLowerCase().replace(/\s/g, '').includes(normalized))
}

/**
 * Ranks a concrete unmatched Menu query. This is discovery evidence only;
 * raw utterance routing and exact identity resolution never call this scorer.
 */
export function findMenuCandidates(menu: readonly MenuItem[], query: string) {
  const normalized = query.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
  if (normalized.length < 3 || normalized.length > 120 || resolveMenuItems(menu, query).length)
    return []
  // NOTICE: fuzzball defaults to ASCII-stripping preprocessing. Disable it so
  // Chinese names remain intact; normalize only the bounded query/name here.
  // WRatio ranks proposals, not identity probability. Full ratio also prevents
  // a shared short suffix (e.g. 便當) dominating a long unrelated query.
  // Source: https://github.com/nol13/fuzzball.js#pre-processing
  const options = { full_process: false, force_ascii: false }
  const ranked = menu.filter(item => item.available !== false).map((item, index) => {
    let score = 0
    let full = 0
    for (const name of [item.name, ...(item.aliases ?? [])]) {
      const candidate = name.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
      const similarity = ratio(normalized, candidate, options)
      const weighted = WRatio(normalized, candidate, options)
      if (similarity >= 60 && weighted > score) {
        score = weighted
        full = similarity
      }
    }
    return { item, score, full, index }
  }).filter(value => value.score >= 70).sort((left, right) => right.score - left.score || right.full - left.full || left.index - right.index)
  const best = ranked[0]?.score ?? 0
  // These are conservative candidate cutoffs, not calibrated acceptance rates;
  // every retained candidate still requires customer confirmation.
  const scored = ranked.filter(value => value.score >= best - 12).map(value => value.item)
  // Short existing fragments (e.g. 排骨飯 -> 炸排骨便當) can have a low
  // whole-name score. Retain that bounded discovery policy after scored hits;
  // long unrelated queries cannot qualify by a common suffix alone.
  const fragments = normalized.length <= 3 ? possibleMenuItems(menu.filter(item => item.available !== false), query) : []
  return [...new Map([...scored, ...fragments].map(item => [item.id, item])).values()].slice(0, 3)
}
