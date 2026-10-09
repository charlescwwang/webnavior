import type { SeatingSnapshot } from '../../../order-menu-server/src/domain/seatingContracts'

/** Customer-visible choices never contain the private POS hold capability. */
export interface TableChoice { id: string, label: string, tableIds: string[], splitRequired: boolean }
export interface SeatingContext { revision: number, partySize?: number, ready: boolean, choices: TableChoice[] }

/** Enumerates only available minimal-capacity groups; no automatic split consent. */
export function tableChoices(snapshot: SeatingSnapshot, partySize: number | undefined): TableChoice[] {
  if (!partySize || !Number.isInteger(partySize) || partySize < 1 || partySize > 20)
    return []
  const free = snapshot.tables.filter(table => table.status === 'free')
  const needed = Math.ceil(partySize / 4)
  const groups: typeof free[] = []
  function choose(start: number, group: typeof free) {
    if (group.length === needed) {
      groups.push(group)
      return
    }
    for (let index = start; index <= free.length - (needed - group.length); index++)
      choose(index + 1, [...group, free[index]!])
  }
  choose(0, [])
  return groups.map((group, index) => ({ id: `TABLE_CHOICE_${index + 1}`, label: group.map(table => table.label).join('、'), tableIds: group.map(table => table.id), splitRequired: needed > 1 }))
}

/** Parses a finite numeric slot, not the customer's operation intent. */
export function partySizeSlot(transcript: string, answeringPartySize: boolean) {
  const digits: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const normalized = transcript.replace(/[\uFF10-\uFF19]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
  const match = /(?:^|[^\d一二兩三四五六七八九十])(20|1\d|[1-9]|二十|十[一二三四五六七八九]?|[一二兩三四五六七八九])\s*(?:[人位]|$)/.exec(normalized)
  if (!match || (!/[人位]/.test(match[0]) && !answeringPartySize))
    return undefined
  const token = match[1]!
  const value = token === '二十' ? 20 : token.startsWith('十') ? 10 + (digits[token.slice(1)] ?? 0) : digits[token] ?? Number(token)
  return Number.isInteger(value) && value >= 1 && value <= 20 ? value : undefined
}
