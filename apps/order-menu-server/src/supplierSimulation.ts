import type { CatalogSnapshot } from './domain/contracts'

import source from './fixtures/supplierMenu.json'

import { parseComposition } from './domain/composition'

/** A separate simulated merchant, with user-confirmed prices and dumpling add-on rules. */
export const supplierCatalog: CatalogSnapshot = {
  ...source,
  store: { ...source.store, fulfillmentModes: [{ id: 'dine-in', label: '內用' }, { id: 'takeout', label: '自取' }] },
  items: source.items.map(item => ({ ...item, composition: parseComposition(item.composition), recommendationTags: [] })),
}
