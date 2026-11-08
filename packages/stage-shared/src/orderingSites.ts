import type { InferOutput } from 'valibot'

import { check, maxLength, minLength, object, pipe, regex, string, url } from 'valibot'

/** One administrator-configured page binding; the ID owns its catalog and operation adapter. */
export const orderingSiteSchema = object({
  id: pipe(string(), minLength(1), maxLength(120), regex(/^[a-z][a-z0-9-]*$/)),
  title: pipe(string(), minLength(1), maxLength(120)),
  description: pipe(string(), maxLength(500)),
  url: pipe(string(), url(), maxLength(2000), check(value => ['http:', 'https:'].includes(new URL(value).protocol), 'Ordering pages require HTTP or HTTPS')),
})
export type OrderingSite = InferOutput<typeof orderingSiteSchema>

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
