import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

import TakeoutChange from './takeoutChange.vue'

describe('pickup change confirmation', () => {
  it('offers the change without claiming it has already happened', async () => {
    const html = await renderToString(createSSRApp(TakeoutChange, { busy: false, confirming: false, table: 'A08' }))
    expect(html).toContain('改為自取')
    expect(html).toContain('未修改外部點餐或 POS 系統')
    expect(html).not.toContain('確認改為自取')
    expect(html).not.toContain('已模擬改為自取')
  })

  it.each([undefined, 'A08'])('asks for confirmation with bound table %s and allows keeping dine-in', async (table) => {
    const html = await renderToString(createSSRApp(TakeoutChange, { busy: false, confirming: true, table }))
    expect(html).toContain('確認改為自取')
    expect(html).toContain('保留內用')
    expect(html).toContain('原訂單與付款紀錄會保留')
    if (table)
      expect(html).toContain('解除 A08 桌的綁定')
    else
      expect(html).toContain('將不再綁定桌號')
  })

  it('disables both decisions while the change request is pending', async () => {
    const html = await renderToString(createSSRApp(TakeoutChange, { busy: true, confirming: true, table: 'A08' }))
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(2)
  })
})
