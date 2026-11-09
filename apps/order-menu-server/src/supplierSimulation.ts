import type { CatalogSnapshot } from './domain/contracts'

import source from './fixtures/supplierMenu.json'

import { parseComposition } from './domain/composition'

/** A separate simulated merchant, with user-confirmed prices and its currently offered items. */
export const supplierCatalog: CatalogSnapshot = {
  ...source,
  revision: 'supplier-menu-20261109-v2',
  store: { ...source.store, fulfillmentModes: [{ id: 'dine-in', label: '內用' }, { id: 'takeout', label: '自取' }] },
  // The captured source retains the retired item for historical regression
  // fixtures. Public catalog, pricing and ordering all use this reduced list.
  items: source.items.filter(item => item.id !== 'supplier-item-08').map(item => ({ ...item, composition: parseComposition(item.composition), recommendationTags: [] })),
}
