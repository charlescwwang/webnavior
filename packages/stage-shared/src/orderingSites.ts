import type { InferOutput } from 'valibot'

import { array, check, maxLength, minLength, object, optional, pipe, regex, string, url } from 'valibot'

/** Administrator labels aid discovery only; current merchant facts retain purchase authority. */
const catalogLabelSchema = object({
  name: pipe(string(), minLength(1), maxLength(200)),
  aliases: pipe(array(pipe(string(), minLength(1), maxLength(100))), maxLength(20)),
  category: pipe(string(), maxLength(100)),
})

/** One administrator-configured page binding; the ID owns its catalog and operation adapter. */
export const orderingSiteSchema = object({
  id: pipe(string(), minLength(1), maxLength(120), regex(/^[a-z][a-z0-9-]*$/)),
  title: pipe(string(), minLength(1), maxLength(120)),
  description: pipe(string(), maxLength(500)),
  url: pipe(string(), url(), maxLength(2000), check(value => ['http:', 'https:'].includes(new URL(value).protocol), 'Ordering pages require HTTP or HTTPS')),
  catalogLabels: optional(pipe(array(catalogLabelSchema), maxLength(200), check(labels => new Set(labels.map(label => label.name)).size === labels.length, 'Each product name needs only one label row.'))),
})
/** Labels are immutable in published snapshots; editors replace rows rather than mutating releases. */
export interface CatalogLabel {
  readonly name: string
  readonly aliases: readonly string[]
  readonly category: string
}

export type OrderingSite = Omit<InferOutput<typeof orderingSiteSchema>, 'catalogLabels'> & { catalogLabels?: readonly CatalogLabel[] }

/**
 * Joins labels to unique exact names in the current merchant catalog. Renamed,
 * absent or duplicate-name products receive no configured labels; no price,
 * option, availability or product identity can be overridden by this metadata.
 */
export function labelCatalog<T extends { name: string }>(products: readonly T[], labels: NonNullable<OrderingSite['catalogLabels']> = []) {
  const counts = new Map<string, number>()
  for (const product of products)
    counts.set(product.name, (counts.get(product.name) ?? 0) + 1)
  return products.map((product) => {
    const label = counts.get(product.name) === 1 ? labels.find(label => label.name === product.name) : undefined
    return { ...product, aliases: label?.aliases ?? [], category: label?.category ?? '' }
  })
}

/** Lists the default merchant first; optional additional merchants are distinct bindings. */
export function orderingSites(profile: { interactiveService: OrderingSite, orderingSites?: readonly OrderingSite[] }): OrderingSite[] {
  const sites = [profile.interactiveService, ...profile.orderingSites ?? []]
  if (new Set(sites.map(site => site.id)).size !== sites.length)
    throw new Error('Ordering site IDs must be unique')
  return sites
}

/** Resolves a saved device choice strictly; a removed merchant must not silently select another. */
export function selectOrderingSite(profile: { interactiveService: OrderingSite, orderingSites?: readonly OrderingSite[] }, id?: string): OrderingSite {
  const sites = orderingSites(profile)
  if (!id)
    return profile.interactiveService
  const site = sites.find(site => site.id === id)
  if (!site)
    throw new Error('The selected ordering site is no longer published')
  return site
}
