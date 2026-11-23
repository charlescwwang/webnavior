import type { PbJourney } from '@proj-airi/stage-shared/pb-journey'

import { isPbJourneyPage } from '@proj-airi/stage-shared/pb-journey'
import { array, looseObject, parse, string } from 'valibot'

const methods = {
  'shopping.menu.categories': 'GET',
  'shopping.getAttrByProduct': 'GET',
  'shopping.orders.details.store': 'POST',
  'shopping.orders.details.destroy': 'DELETE',
  'shopping.orders.details.update': 'PUT',
} as const

/** Only the PB operations verified by the ordering adapter may resolve a route. */
export type RouteName = keyof typeof methods

/** Resolves PB's declared route data without evaluating its main-world route() helper. */
export function resolveRoute(name: RouteName, parameters: readonly string[], expected: URL, scripts: Iterable<string>): URL {
  // PB publishes a JSON Ziggy constant before its route helper. Parse only that
  // data; an absent, ambiguous or changed declaration must stop the operation.
  const declarations = [...scripts].flatMap((source) => {
    const match = source.match(/^\s*const Ziggy=(\{.*?\});/s)
    return match ? [match[1]] : []
  })
  if (declarations.length !== 1)
    throw new Error('PB route declaration is unavailable or ambiguous.')
  const registry = parse(looseObject({ url: string(), routes: looseObject({}) }), JSON.parse(declarations[0]))
  const route = parse(looseObject({ uri: string(), methods: array(string()), parameters: array(string()) }), registry.routes[name])
  if (registry.url !== `${expected.origin}/order` || !route.methods.includes(methods[name]) || parameters.length > route.parameters.length)
    throw new Error('PB route declaration changed.')
  const values = new Map(route.parameters.map((key, index) => [key, parameters[index]]))
  const path = route.uri.replace(/\/\{([a-z_]+)(\?)?\}/g, (_token, key: string, optional: string | undefined) => {
    const value = values.get(key)
    if (value === undefined) {
      if (optional)
        return ''
      throw new Error('PB route parameter is missing.')
    }
    return `/${encodeURIComponent(value)}`
  })
  const url = new URL(`${registry.url}/${path}`)
  if (url.href !== expected.href || url.username || url.password)
    throw new Error('PB route is outside the approved store.')
  return url
}

/** Accepts PB's same-menu table canonicalization without admitting login/store redirects. */
export function matchesPageResponseUrl(journey: PbJourney, requested: URL, receivedUrl: string): boolean {
  const menu = new URL(journey.menuPath, journey.origin)
  if (!isPbJourneyPage(menu.href, requested.href) || ![journey.menuPath, journey.cartPath].includes(requested.pathname))
    return false
  const received = new URL(receivedUrl)
  if (received.href === requested.href)
    return true
  // PB redirects a cart's bare menu link to menu?table=<current signed token>.
  // The browser follows this normally. Only this canonical read target is
  // accepted; replacing an explicit table or redirecting cart reads is rejected.
  return Boolean(journey.tablePath && requested.pathname === journey.menuPath && !requested.search
    && received.origin === journey.origin && received.pathname === journey.menuPath
    && !received.username && !received.password && !received.hash
    && [...received.searchParams.keys()].length === 1 && received.searchParams.has('table')
    && received.searchParams.get('table')?.trim())
}
