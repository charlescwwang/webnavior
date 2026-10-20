import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

import CheckoutPayment from './CheckoutPayment.vue'

describe('checkout payment screen', () => {
  it('offers methods before a customer chooses one', async () => {
    const html = await renderToString(createSSRApp(CheckoutPayment, { total: '$130' }))
    expect(html).toContain('選擇付款方式')
    expect(html).toContain('LINE Pay')
    expect(html).toContain('街口支付')
    expect(html).not.toContain('模擬掃碼付款完成')
  })

  // Report: this chat, 2026-10-18 — choosing a method should enter the scan step directly.
  it.each([{ method: 'linepay', label: 'LINE Pay' }, { method: 'jkopay', label: '街口支付' }] as const)('opens the scan step immediately after choosing $label', async ({ method, label }) => {
    const html = await renderToString(createSSRApp(CheckoutPayment, { method, total: '$130' }))
    expect(html).toContain(`${label} 掃碼付款`)
    expect(html).toContain('等待掃碼，尚未付款')
    expect(html).toContain('測試專用・非真實付款')
    expect(html).toContain('正在產生測試 QR Code')
    expect(html).toContain('倒數 5 秒後自動模擬完成')
    expect(html).not.toContain('模擬掃碼付款完成')
    expect(html).toContain('更換付款方式')
    expect(html).toContain('payment-options')
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain('確認使用')
    expect(html).not.toContain('使用 LINE Pay 模擬付款')
  })

  it.each(['pending', 'authorized', 'uncertain'] as const)('prevents another simulated scan or method change while %s', async (status) => {
    const html = await renderToString(createSSRApp(CheckoutPayment, { method: 'linepay', status, total: '$130' }))
    expect(html).not.toContain('模擬掃碼付款完成')
    expect(html).not.toContain('更換付款方式')
    expect(html).not.toContain('payment-options')
    expect(html).not.toContain('測試專用・非真實付款')
    expect(html).toMatch(/<button[^>]*disabled/)
  })
})
