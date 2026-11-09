import { expect, it } from 'vitest'

import { historicalSupplierCatalog as supplierCatalog } from '../../../order-menu-server/src/fixtures/historicalSupplierCatalog'
import { applySupplierOrdering } from '../supplierOrdering'
import { optionSteps } from './optionSteps'

// Report: this chat Nov09 — dumpling add-ons use adjacent plus/minus controls, not option tags.
it('uses adjacent steps for increases, decreases and explicit zero confirmation', () => {
  const group = applySupplierOrdering(supplierCatalog.items).find(item => item.id === 'supplier-item-08')!.optionGroups[0]!
  expect(optionSteps(group, undefined, 'extra-0')).toEqual(['extra-0'])
  expect(optionSteps(group, 'extra-0', 'extra-3')).toEqual(['extra-1', 'extra-2', 'extra-3'])
  expect(optionSteps(group, 'extra-3', 'extra-1')).toEqual(['extra-2', 'extra-1'])
  expect(optionSteps(group, 'extra-2', 'extra-2')).toEqual([])
  expect(() => optionSteps(group, 'extra-2', 'extra-101')).toThrow('not available')
})
