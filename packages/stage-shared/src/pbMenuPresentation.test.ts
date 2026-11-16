import { expect, it } from 'vitest'

import { describePbMeal, parsePbDumplingServings, pbDumplingExtraCount, pbProductName } from './pbMenuPresentation'

it('covers complete literal dumpling servings and leaves other requests intact', () => {
  expect(parsePbDumplingServings('我要水餃十顆兩份', '周氏水餃(最低8顆)', '水餃')).toEqual({ piecesPerServing: 10, quantity: 2, extra: 2 })
  expect(parsePbDumplingServings('水餃兩份每份十二顆', '周氏水餃(最低8顆)', '水餃')).toEqual({ piecesPerServing: 12, quantity: 2, extra: 4 })
  expect(parsePbDumplingServings('水餃十顆', '周氏水餃(最低8顆)', '水餃')).toBeUndefined()
  expect(parsePbDumplingServings('水餃兩份每份七顆', '周氏水餃(最低8顆)', '水餃')).toBeUndefined()
  expect(parsePbDumplingServings('水餃十顆兩份不要蔥', '周氏水餃(最低8顆)', '水餃')).toBeUndefined()
})

it('converts total pieces per serving without treating them as meal quantities', () => {
  expect(pbDumplingExtraCount('周氏水餃(最低8顆)', 8)).toBe(0)
  expect(pbDumplingExtraCount('周氏水餃(最低8顆)', 10)).toBe(2)
  expect(() => pbDumplingExtraCount('周氏水餃(最低8顆)', 7)).toThrow()
  expect(() => pbDumplingExtraCount('其他水餃', 10)).toThrow()
})

// Report: this chat, Nov12; read actual pieces/servings instead of the minimum notice.
it('formats the observed PB base and added dumplings without changing serving counts', () => {
  expect(describePbMeal({ name: '周氏水餃(最低8顆)', quantity: 1, unitPrice: 64, options: [] })).toBe('周氏水餃 每份 8 顆，1 份')
  expect(describePbMeal({ name: '周氏水餃(最低8顆)', quantity: 2, unitPrice: 80, options: [{ name: '水餃1顆', quantity: 2 }], note: '不要蔥' })).toBe('周氏水餃 每份 10 顆，2 份（備註「不要蔥」）')
})

it('does not infer pieces for other products, changed prices or unreadable options', () => {
  expect(pbProductName('另一款水餃(最低8顆)')).toBe('另一款水餃(最低8顆)')
  expect(describePbMeal({ name: '周氏水餃(最低8顆)', quantity: 1, unitPrice: 70, options: [] })).toBe('周氏水餃 1 份')
  expect(describePbMeal({ name: '周氏水餃(最低8顆)', quantity: 1, unitPrice: 64, description: '未知配置' })).toBe('周氏水餃 1 份（未知配置）')
})

it('omits empty option text and retains actual customization and notes', () => {
  expect(describePbMeal({ name: '炸雞腿便當', quantity: 1, unitPrice: 130, options: [] })).toBe('炸雞腿便當 1 份')
  expect(describePbMeal({ name: '炸雞腿便當', quantity: 1, unitPrice: 140, options: [{ name: '加蛋', quantity: 1 }], note: '飯少' })).toBe('炸雞腿便當 1 份（加蛋 每份 1 個；備註「飯少」）')
})
