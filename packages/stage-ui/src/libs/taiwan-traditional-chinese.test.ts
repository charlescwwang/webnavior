import { describe, expect, it } from 'vitest'

import { toOrderingTraditionalChinese, toTaiwanTraditionalChinese } from './taiwan-traditional-chinese'

describe('toTaiwanTraditionalChinese', () => {
  it('converts simplified text and Taiwan-specific phrases', () => {
    expect(toTaiwanTraditionalChinese('请使用自行车软件菜单')).toBe('請使用腳踏車軟體選單')
  })

  it('leaves already Traditional Chinese text unchanged', () => {
    expect(toTaiwanTraditionalChinese('請確認您的訂單。')).toBe('請確認您的訂單。')
  })
})

// Report: this chat, Nov5; food menus must stay 菜單 after OpenCC conversion.
it('preserves restaurant vocabulary without changing software menus', () => {
  expect(toOrderingTraditionalChinese('您好，需要点餐或查询菜单吗？')).toBe('您好，需要點餐或查詢菜單嗎？')
  expect(toTaiwanTraditionalChinese('软件菜单')).toBe('軟體選單')
})
