import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

import CheckoutInvoice from './CheckoutInvoice.vue'

describe('invoice selection screen', () => {
  // Report: this chat, Nov2; the visible invoice field was inaccessible to voice confirmation.
  it('renders the shared carrier draft and enables its confirmation control', async () => {
    const html = await renderToString(createSSRApp(CheckoutInvoice, { checkout: { stage: 'invoice', invoiceMethod: 'carrier', invoiceDraft: { method: 'carrier', code: '/PTGRJP2' } }, total: '$130' }))
    expect(html).toContain('value="/PTGRJP2"')
    // Scanner Enter must not submit; the existing explicit confirmation is a button.
    const confirm = html.match(/<button[^>]*class="invoice-confirm"[^>]*>/)?.[0]
    expect(confirm).toBeDefined()
    expect(confirm).toContain('type="button"')
    expect(confirm).not.toContain('disabled')
  })

  // Report: this chat, 2026-10-19 — move the skip/donation action below invoice entry.
  it('places skip and donation in the bottom actions before back', async () => {
    const html = await renderToString(createSSRApp(CheckoutInvoice, { checkout: { stage: 'invoice' }, total: '$130' }))
    const footer = html.match(/<footer[^>]*>(.*?)<\/footer>/s)?.[1] ?? ''
    expect(footer).toContain('略過，捐贈發票')
    expect(footer.indexOf('略過，捐贈發票')).toBeLessThan(footer.indexOf('返回上一頁'))
    expect(html.indexOf('</form>')).toBeLessThan(html.indexOf('<footer'))
    expect(html.match(/<div[^>]*class="invoice-options"[^>]*>(.*?)<\/div>/s)?.[1]).not.toContain('略過，捐贈發票')
  })
})
