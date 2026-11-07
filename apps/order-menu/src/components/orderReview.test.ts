import { expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

import OrderReview from './OrderReview.vue'

it('shows uppercase table letters in a dedicated table badge', async () => {
  const html = await renderToString(createSSRApp(OrderReview, {
    serviceContext: { serviceMode: 'table-service', table: { id: 'a08', label: 'a08' }, directSubmissionSupported: true },
    fulfillmentModes: [],
    completed: false,
    fulfillmentMode: 'dine-in',
    lines: [],
    total: '100 元',
    completedLabel: '訂單已確認',
    seatingReady: true,
  }))
  expect(html).toContain('A08')
  expect(html).not.toContain('>a08<')
  expect(html).toContain('order-table')
})
