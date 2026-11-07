import type { ProductConfiguration } from './pbProduct'

import { array, integer, looseObject, minValue, number, parse, pipe, string } from 'valibot'

import { describeConfiguration } from './pbProduct'

/** Product identity is vendor kind plus ID, independent of name or category order. */
export interface CatalogProduct {
  ref: string
  id: number
  kind: 'product' | 'group'
  categoryId: number
  categoryIds: number[]
  name: string
  price: number
  priceType: number
  pickup: { date: string, time: string }
  configurations: ProductConfiguration[]
}

/** All IO is ordinary vendor reads; implementations keep cookies inside the browser. */
export interface CatalogGateway {
  menu: () => Promise<unknown>
  category: (input: { categoryId: number, date: string, time: string }) => Promise<unknown>
  attributes: (productId: number) => Promise<unknown>
}

const id = pipe(number(), integer(), minValue(1))
const money = pipe(number(), minValue(0))
const productSchema = looseObject({ id, name: string(), price: money, price_type: number() })

/**
 * Reads every current category, retaining groups and stable references. One
 * read-only retry handles a menu changing during collection; incomplete data
 * never silently becomes a full catalog. Product facts are not cached across calls.
 */
export async function readCatalog(gateway: CatalogGateway, options: { scope: string, configurationRefs?: readonly string[], includeConfigurations?: boolean }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const menu = parse(looseObject({ menuCategories: array(looseObject({ id, name: string(), count: pipe(number(), integer(), minValue(0)) })), defaultPickUpDate: string(), defaultPickUpTime: string() }), await gateway.menu())
    const pickup = { date: menu.defaultPickUpDate, time: menu.defaultPickUpTime }
    const products = new Map<string, CatalogProduct>()
    const attributes = new Map<number, Promise<unknown>>()
    let complete = true
    if (new Set(menu.menuCategories.map(category => category.id)).size !== menu.menuCategories.length)
      throw new Error('PB 分類識別重複，請重新讀取菜單。')
    for (const category of menu.menuCategories) {
      const data = parse(looseObject({ products: array(productSchema), productGroups: array(looseObject({ id, name: string(), price: money })) }), await gateway.category({ categoryId: category.id, ...pickup }))
      const items = [...data.products.map(product => ({ ...product, kind: 'product' as const })), ...data.productGroups.map(group => ({ ...group, kind: 'group' as const, price_type: 1 }))]
      complete &&= category.count === items.length
      for (let offset = 0; offset < items.length; offset += 6) {
        const batch = await Promise.all(items.slice(offset, offset + 6).map(async (item): Promise<CatalogProduct> => {
          const ref = `${item.kind === 'product' ? 'p' : 'pg'}-${item.id}`
          const configurations: ProductConfiguration[] = []
          if (options.includeConfigurations !== false && item.kind === 'product' && item.price_type === 1 && (!options.configurationRefs || options.configurationRefs.includes(ref))) {
            let pending = attributes.get(item.id)
            if (!pending) {
              pending = gateway.attributes(item.id)
              attributes.set(item.id, pending)
            }
            configurations.push(await describeConfiguration({ productRef: ref, variantRef: '', name: item.name, unitPrice: item.price, scope: JSON.stringify([options.scope, pickup.date, pickup.time]) }, await pending))
          }
          return { ref, id: item.id, kind: item.kind, categoryId: category.id, categoryIds: [category.id], name: item.name, price: item.price, priceType: item.price_type, pickup, configurations }
        }))
        for (const product of batch) {
          const previous = products.get(product.ref)
          if (previous) {
            const { categoryId: _previousCategory, categoryIds: _previousCategories, ...previousFacts } = previous
            const { categoryId: _category, categoryIds: _categories, ...facts } = product
            if (JSON.stringify(previousFacts) !== JSON.stringify(facts))
              throw new Error('同一商品在分類間的規格或售價不一致，尚未操作。')
            previous.categoryIds.push(category.id)
          }
          else {
            products.set(product.ref, product)
          }
        }
      }
    }
    if (complete || attempt === 1)
      return { products: [...products.values()], pickup, complete, observedAt: Date.now(), source: 'pb-current-pickup-categories' as const }
  }
  throw new Error('PB 菜單讀取未完成。')
}
