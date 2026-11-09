import type { CatalogSnapshot } from '../domain/contracts'

import source from './supplierMenu.json'

import { parseComposition } from '../domain/composition'
import { supplierCatalog } from '../supplierSimulation'

/** Frozen pre-retirement catalog for regressions; never use for a public merchant. */
export const historicalSupplierCatalog: CatalogSnapshot = {
  ...supplierCatalog,
  revision: source.revision,
  items: source.items.map(item => ({ ...item, composition: parseComposition(item.composition), recommendationTags: [] })),
}
