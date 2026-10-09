import { describe, expect, it } from 'vitest'

import { partySizeSlot, tableChoices } from './seating'

const snapshot = { revision: 0, tables: Array.from({ length: 5 }, (_, index) => ({ id: `T${index + 1}`, label: `${index + 1} 號桌`, capacity: 4, status: 'free' as const })) }

describe('current dine-in choices', () => {
  it('offers single available tables, never occupies extra tables for a small party', () => {
    expect(tableChoices(snapshot, 4)).toHaveLength(5)
    expect(tableChoices(snapshot, 2)[0]).toEqual({ id: 'TABLE_CHOICE_1', label: '1 號桌', tableIds: ['T1'], splitRequired: false })
    expect(tableChoices({ ...snapshot, tables: snapshot.tables.map(table => ({ ...table, status: 'held' })) }, 1)).toEqual([])
  })
  it('offers only minimal real groups with explicit split consent', () => {
    const choices = tableChoices(snapshot, 5)
    expect(choices).toHaveLength(10)
    expect(choices.every(choice => choice.splitRequired && choice.tableIds.length === 2)).toBe(true)
    expect(tableChoices(snapshot, 20)[0]?.tableIds).toEqual(['T1', 'T2', 'T3', 'T4', 'T5'])
    expect(tableChoices(snapshot, 21)).toEqual([])
    expect(tableChoices(snapshot, undefined)).toEqual([])
  })
  it('parses person-count slots without classifying meal quantity or background numbers', () => {
    expect(partySizeSlot('五位', false)).toBe(5)
    expect(partySizeSlot('十二人', false)).toBe(12)
    expect(partySizeSlot('二十位', false)).toBe(20)
    expect(partySizeSlot('２人', false)).toBe(2)
    expect(partySizeSlot('兩份水餃', false)).toBeUndefined()
    expect(partySizeSlot('5', false)).toBeUndefined()
    expect(partySizeSlot('5', true)).toBe(5)
    expect(partySizeSlot('21位', true)).toBeUndefined()
  })
})
