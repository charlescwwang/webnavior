import { readPbJourney } from '@proj-airi/stage-shared/pb-journey'
import { expect, it } from 'vitest'

import { matchesPageResponseUrl, resolveRoute } from './pbRoutes'

const scope = 'https://app.esgpb.com/order/store/1kgJeql/pick_up/'
function declaration(uri = 'store/{store_hash}/{flow_type}/getAttrByProduct/{product}/{product_price?}', methods = ['GET', 'HEAD']) {
  return `const Ziggy=${JSON.stringify({ url: 'https://app.esgpb.com/order', routes: { 'shopping.getAttrByProduct': { uri, methods, parameters: ['store_hash', 'flow_type', 'product', 'product_price'] } } })};throw new Error('must never execute vendor code');`
}

it('resolves daily product IDs from declared data without a vendor JavaScript global', () => {
  expect(resolveRoute('shopping.getAttrByProduct', ['1kgJeql', 'pick_up', '123'], new URL(`${scope}getAttrByProduct/123`), [declaration()]).href).toBe(`${scope}getAttrByProduct/123`)
  expect(resolveRoute('shopping.getAttrByProduct', ['1kgJeql', 'pick_up', '456'], new URL(`${scope}getAttrByProduct/456`), [declaration()]).href).toBe(`${scope}getAttrByProduct/456`)
})

it('rejects changed routes, verbs, missing parameters and duplicate declarations', () => {
  const expected = new URL(`${scope}getAttrByProduct/123`)
  expect(() => resolveRoute('shopping.getAttrByProduct', ['1kgJeql', 'pick_up', '123'], expected, [declaration('admin/{product}')])).toThrow('approved store')
  expect(() => resolveRoute('shopping.getAttrByProduct', ['1kgJeql', 'pick_up', '123'], expected, [declaration(undefined, ['POST'])])).toThrow('declaration changed')
  expect(() => resolveRoute('shopping.getAttrByProduct', ['1kgJeql', 'pick_up'], expected, [declaration()])).toThrow('parameter is missing')
  expect(() => resolveRoute('shopping.getAttrByProduct', ['1kgJeql', 'pick_up', '123'], expected, [declaration(), declaration()])).toThrow('ambiguous')
  expect(() => resolveRoute('shopping.getAttrByProduct', ['1kgJeql', 'pick_up', '123'], expected, [])).toThrow('unavailable')
})

// Report: this chat, 2026-11-23 — three live menu→cart cycles showed a working
// PB page but full-context reads rejected its normal 302 menu table redirect.
it('accepts a bare menu read canonicalized with the current table token', () => {
  const journey = readPbJourney('https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table')!
  const menu = new URL(journey.menuPath, journey.origin)
  const target = `${menu.href}?table=observed-table-token`
  expect(matchesPageResponseUrl(journey, menu, target)).toBe(true)
  expect(matchesPageResponseUrl(journey, new URL(target), target)).toBe(true)
  expect(matchesPageResponseUrl(journey, menu, menu.href)).toBe(true)
})

it('rejects authentication, store, page, extra-query and explicit-table redirects', () => {
  const journey = readPbJourney('https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table')!
  const menu = new URL(journey.menuPath, journey.origin)
  const cart = new URL(journey.cartPath, journey.origin)
  expect(matchesPageResponseUrl(journey, menu, `${journey.origin}/login`)).toBe(false)
  expect(matchesPageResponseUrl(journey, menu, `${journey.origin}${journey.tablePath}`)).toBe(false)
  expect(matchesPageResponseUrl(journey, menu, menu.href.replace('1kgJeql', 'another-store'))).toBe(false)
  expect(matchesPageResponseUrl(journey, menu, menu.href.replace(journey.origin, 'https://example.com'))).toBe(false)
  expect(matchesPageResponseUrl(journey, menu, `${menu.href}?table=one&table=two`)).toBe(false)
  expect(matchesPageResponseUrl(journey, menu, `${menu.href}?table=one&other=value`)).toBe(false)
  expect(matchesPageResponseUrl(journey, menu, `${menu.href}?table=`)).toBe(false)
  expect(matchesPageResponseUrl(journey, menu, `${menu.href}?table=one#unapproved`)).toBe(false)
  expect(matchesPageResponseUrl(journey, new URL(`${menu.href}?table=one`), `${menu.href}?table=two`)).toBe(false)
  expect(matchesPageResponseUrl(journey, cart, `${menu.href}?table=one`)).toBe(false)
})
