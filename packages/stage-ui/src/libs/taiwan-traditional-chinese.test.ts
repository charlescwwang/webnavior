import { describe, expect, it } from 'vitest'

import { toTaiwanTraditionalChinese } from './taiwan-traditional-chinese'

describe('toTaiwanTraditionalChinese', () => {
  it('converts simplified text and Taiwan-specific phrases', () => {
    expect(toTaiwanTraditionalChinese('请使用自行车软件菜单')).toBe('請使用腳踏車軟體選單')
  })

  it('leaves already Traditional Chinese text unchanged', () => {
    expect(toTaiwanTraditionalChinese('請確認您的訂單。')).toBe('請確認您的訂單。')
  })
})
