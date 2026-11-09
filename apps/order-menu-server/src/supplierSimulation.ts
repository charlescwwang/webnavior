import type { CatalogSnapshot } from './domain/contracts'

import source from './fixtures/supplierMenu.json'

import { parseComposition } from './domain/composition'

// Retire stable IDs so display, discovery and final order checks share one menu.
const retiredItemIds = new Set(['supplier-item-03', 'supplier-item-05', 'supplier-item-06', 'supplier-item-08'])

/** A separate simulated merchant, with user-confirmed prices and its currently offered items. */
export const supplierCatalog: CatalogSnapshot = {
  ...source,
  revision: 'supplier-menu-20261109-v3',
  store: { ...source.store, fulfillmentModes: [{ id: 'dine-in', label: '內用' }, { id: 'takeout', label: '自取' }] },
  // The captured source retains the retired item for historical regression
  // fixtures. Public catalog, pricing and ordering all use this reduced list.
  items: source.items.filter(item => !retiredItemIds.has(item.id)).map(item => ({ ...item, composition: parseComposition(item.composition), recommendationTags: [] })),
}
