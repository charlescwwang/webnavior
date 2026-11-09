import type { CartLine, MenuItem } from './domain/order-machine'

import { orderingMessages } from '../../../packages/i18n/src/orderingMessages'

const aliases: Record<string, string[]> = {
  'supplier-item-03': ['焢肉飯'],
  'supplier-item-08': ['周氏水餃', '水餃'],
  'supplier-item-09': ['紅燒牛肉麵'],
  'supplier-item-10': ['麻辣牛肉麵'],
}

/** Adds page-owned equivalent names and explicit dumpling consent without changing the POS catalog. */
export function applySupplierOrdering(items: readonly MenuItem[]): MenuItem[] {
  return items.map(item => ({
    ...item,
    aliases: [...new Set([...(item.aliases ?? []), ...(aliases[item.id] ?? [])])],
    optionGroups: item.id !== 'supplier-item-08'
      ? item.optionGroups
      : item.optionGroups.map(group => group.id !== 'extra-pieces'
          ? group
          : {
              ...group,
              required: true,
              label: orderingMessages['zh-Hant'].supplierExtraPiecesLabel,
              confirmationPrompt: orderingMessages['zh-Hant'].supplierExtraPiecesQuestion,
              presentation: 'piece-counter' as const,
            }),
  }))
}

/** Describes persisted cart quantities using the validated supplier option IDs, never catalog defaults alone. */
export function describeDumplingPortion(line: CartLine) {
  if (line.itemId !== 'supplier-item-08')
    return undefined
  // The POS supports omission of this optional add-on as zero. The page's
  // explicit confirmation step does not change that underlying order contract.
  const value = line.options['extra-pieces'] ?? 'extra-0'
  const extra = Number(value.slice('extra-'.length))
  const pieces = 8 + extra
  return orderingMessages['zh-Hant'].supplierPiecesDetail
    .replace('{pieces}', String(pieces))
    .replace('{extra}', String(extra))
    .replaceAll('{quantity}', String(line.quantity))
    .replace('{unitPrice}', String(line.unitPrice))
    .replace('{lineTotal}', String(line.unitPrice * line.quantity))
    .replace('{total}', String(pieces * line.quantity))
}
