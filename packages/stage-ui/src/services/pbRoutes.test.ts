import { expect, it } from 'vitest'

import { resolveRoute } from './pbRoutes'

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
