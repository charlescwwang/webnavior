import { expect, it } from 'vitest'

import { resolveTableName } from './tableNames'

it('resolves case, leading zeros and spoken digits without confusing A1 and A10', () => {
  expect(resolveTableName('a3', ['A03 桌', 'A10 桌'])).toBe('A03 桌')
  expect(resolveTableName('A03', ['A3 桌'])).toBe('A3 桌')
  expect(resolveTableName('A三桌', ['A03 桌'])).toBe('A03 桌')
  expect(resolveTableName('A1', ['A10 桌'])).toBeUndefined()
  expect(resolveTableName('櫃台取餐', ['A03 桌', '櫃台取餐'])).toBe('櫃台取餐')
})
it('does not guess between equivalent available table names', () => {
  expect(resolveTableName('A3', ['A3 桌', 'A03 桌'])).toBeUndefined()
})

// Report: this chat, 2026-11-14 — B3 吧檯 was falsely reported absent.
it('resolves counter seats and takeaway language to actual current choices', () => {
  const choices = ['櫃台取餐', 'A02', 'B3 吧檯']
  expect(resolveTableName('b3', choices)).toBe('B3 吧檯')
  expect(resolveTableName('B03 吧台', choices)).toBe('B3 吧檯')
  expect(resolveTableName('我要外帶', choices)).toBe('櫃台取餐')
  expect(resolveTableName('我要自取', choices)).toBe('櫃台取餐')
  expect(resolveTableName('我想外帶', choices)).toBe('櫃台取餐')
  expect(resolveTableName('請幫我自取', choices)).toBe('櫃台取餐')
  expect(resolveTableName('不要外帶', choices)).toBeUndefined()
  expect(resolveTableName('我要外送', choices)).toBeUndefined()
})
