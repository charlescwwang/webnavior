import process from 'node:process'

import { chromium } from 'playwright'
import { expect, it } from 'vitest'

import { basePath } from './catalog.js'

const origin = process.env.PB_LAB_URL
if (origin && origin !== 'http://127.0.0.1:5188')
  throw new Error('Native checkout acceptance requires the exact local fixture.')
const test = it.skipIf(!origin)
const serviceModule = new URL('../../packages/stage-ui/src/services/pbBrowserService.ts', import.meta.url).pathname

// PB's published ChoosePayment code confirms before abandoning an unpaid order.
// This verifies the local branch, not an actual merchant cancellation sample.
test('requires confirmation to abandon an unpaid order and never labels it refunded', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.goto(`${origin}${basePath}/menu/select-table`)
    await page.getByRole('button', { name: '開始點餐', exact: true }).click()
    await page.getByRole('button', { name: /^魚丸湯/ }).click()
    await page.locator('.dialog-footer button').click()
    await page.goto(`${origin}${basePath}/orders/create`)
    await page.locator('#phone').fill('0912345678')
    await page.locator('#phone').press('Tab')
    await page.getByRole('button', { name: '送出訂單', exact: true }).click()
    await page.getByRole('dialog', { name: '確認訂單', exact: true }).getByRole('button', { name: '確定', exact: true }).click()
    await page.getByRole('button', { name: '放棄付款', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '返回', exact: true }).click()
    expect((await page.evaluate(() => window.pbTest.getState())).orders[0].vendorStatus).toBe(20)
    await page.getByRole('button', { name: '放棄付款', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '放棄付款', exact: true }).click()
    await page.getByTestId('fulfillment-status').waitFor()
    const result = await page.evaluate(async () => fetch(location.pathname, { headers: { 'X-Inertia': 'true' } }).then(response => response.json()))
    expect(result.props.order.status).toBe(79)
    expect(result.props.order.has_refunded_payment).toBe(false)
    expect(result.props.order.invoices).toEqual([])
    expect((await page.evaluate(() => window.pbTest.getState())).orders[0].payment.amount).toBe(0)
  }
  finally { await browser.close() }
}, 30_000)

// Report: this chat, Nov15 — real PB order4006 reached ChoosePayment20, then Show50 with an invoice.
test('retains submitted business data through payment, reload and a new reception', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.goto(`${origin}${basePath}/menu/select-table`)
    await page.getByRole('button', { name: '開始點餐', exact: true }).click()
    await page.getByRole('button', { name: /^魚丸湯/ }).click()
    await page.locator('.dialog-footer button').click()
    await page.goto(`${origin}${basePath}/orders/create`)
    await page.locator('#phone').fill('0912345678')
    await page.locator('#phone').press('Tab')
    await page.getByRole('button', { name: '送出訂單', exact: true }).click()
    await page.getByRole('dialog', { name: '確認訂單', exact: true }).getByRole('button', { name: '確定', exact: true }).click()
    await page.waitForURL('**/choosePayment')
    const before = await page.evaluate(async () => fetch(location.pathname, { headers: { 'X-Inertia': 'true' } }).then(response => response.json()))
    expect(before.component).toBe('Order/ChoosePayment')
    expect(before.props.order.status).toBe(20)
    expect(before.props.order.totalmoney).toBe(50)
    expect(before.props.order.number).not.toBe(before.props.order.hash)
    await page.getByTestId('payment-linepay').click()
    expect(new URL(page.url()).pathname).toBe(`/order/linepay/redirect/${before.props.order.hash}/LinePay`)
    await page.getByTestId('simulate-succeeded').click()
    await page.getByTestId('invoice-number').waitFor()
    expect(await page.getByTestId('fulfillment-status').textContent()).toContain('店家正在準備')
    const after = await page.evaluate(async () => fetch(location.pathname, { headers: { 'X-Inertia': 'true' } }).then(response => response.json()))
    expect(after.component).toBe('Order/Show')
    expect(after.props.order.status).toBe(50)
    expect(after.props.order.payment).toBe('LinePay')
    expect(after.props.order.CustomerPhone).toBe('0912345678')
    expect(after.props.order.invoices[0].no).toMatch(/^TEST/)
    expect(after.props.order.has_refunded_payment).toBe(false)
    expect(after.props.details[0].item.name).toBe('魚丸湯')
    await page.reload()
    expect(await page.getByTestId('invoice-number').textContent()).toContain(after.props.order.invoices[0].no)
    await page.getByTestId('new-order').click()
    await page.getByRole('button', { name: '開始點餐', exact: true }).waitFor()
    const next = await page.evaluate(() => window.pbTest.getState())
    expect(next.cart).toHaveLength(0)
    expect(next.orders).toHaveLength(1)
    expect(next.orders[0].invoice.phone).toBe('0912345678')
    expect(next.orders[0].payment.amount).toBe(50)
    expect(next.orders[0].invoices[0].no).toBe(after.props.order.invoices[0].no)
  }
  finally { await browser.close() }
}, 30_000)

// Report: this chat, Nov15 — a spoken cart summary navigated back to the menu.
// Each test owns a separate browser/session; no operator cart or merchant IO.
test('keeps passive reply cues on the cart and preserves an active menu search', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.goto(`${origin}${basePath}/menu/select-table`)
    await page.getByRole('button', { name: '開始點餐', exact: true }).click()
    await page.getByRole('button', { name: /^魚丸湯/ }).click()
    await page.locator('.dialog-footer button').click()
    await page.waitForFunction(async () => (await fetch('/__lab/state').then(response => response.json())).state.cart.length === 1)
    // NOTICE: Import as browser code; Vite SSR imports inside a serialized
    // Playwright callback would target the test runner rather than the page.
    await page.evaluate(`(async () => { const { createPbService } = await import(${JSON.stringify(`/@fs${serviceModule}`)}); window.checkoutService = createPbService(); window.checkoutBinding = window.checkoutService.discover({ version: 1, connectionId: crypto.randomUUID(), challenge: crypto.randomUUID() }) })()`)
    const call = (name, input = {}) => page.evaluate(async ({ name, input }) => (await window.checkoutService.execute({ connectionId: window.checkoutBinding.connectionId, documentId: window.checkoutBinding.documentId, toolsRevision: window.checkoutBinding.toolsRevision, operationId: crypto.randomUUID(), name, input })).result, { name, input })
    const facts = await call('browser_cart_get', { includeCatalog: true })
    const fish = facts.products.find(product => product.name === '魚丸湯')
    expect(fish).toBeDefined()
    const review = await call('browser_cart_review')
    expect(review.ok).toBe(true)
    expect(page.url()).toBe(`${origin}${basePath}/orders/create`)
    const cue = await call('browser_present', { productRefs: [fish.ref], mode: 'information', preservePage: true })
    expect(cue.ok).toBe(true)
    expect(cue.presentation.cue).toBe('cancelled')
    expect(cue.execution.steps).toHaveLength(0)
    expect(page.url()).toBe(`${origin}${basePath}/orders/create`)
    await call('browser_return_menu')
    await call('browser_search', { query: '水餃' })
    const hiddenCue = await call('browser_present', { productRefs: [fish.ref], mode: 'information', preservePage: true })
    expect(hiddenCue.ok).toBe(true)
    expect(hiddenCue.presentation.cue).toBe('cancelled')
    expect(hiddenCue.execution.steps).toHaveLength(0)
    const searched = await call('browser_cart_get', { includeCatalog: false })
    expect(searched.search).toBe('水餃')
    expect(searched.cart.subtotal).toBe(50)
    // Explicit customer-requested presentation may still reveal the item.
    const explicit = await call('browser_present', { productRefs: [fish.ref], mode: 'information' })
    expect(explicit.presentation.cue).toBe('shown')
    expect((await call('browser_cart_get', { includeCatalog: false })).search).toBe('')
  }
  finally { await browser.close() }
}, 30_000)

test.each([
  ['none', undefined, undefined],
  ['carrier', '請輸入共8碼編號', '/ABC1234'],
  ['citizen', '2碼英文字碼+14碼數字', 'AB12345678901234'],
  ['tax', '請輸入統一編號', '12345678'],
  ['donation', '請輸入3~7碼數字', '123'],
])('runs native %s invoice entry, focused-field cart modification and final confirmation without submission', async (method, placeholder, code) => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.goto(`${origin}${basePath}/menu/select-table`)
    await page.getByRole('button', { name: '開始點餐', exact: true }).click()
    await page.getByRole('button', { name: /^魚丸湯/ }).click()
    await page.locator('.dialog-footer button').click()
    await page.waitForFunction(async () => (await fetch('/__lab/state').then(response => response.json())).state.cart.length === 1)
    // NOTICE: Keep the production import in the browser execution context.
    await page.evaluate(`(async () => { const { createPbService } = await import(${JSON.stringify(`/@fs${serviceModule}`)}); window.checkoutService = createPbService(); window.checkoutBinding = window.checkoutService.discover({ version: 1, connectionId: crypto.randomUUID(), challenge: crypto.randomUUID() }) })()`)
    const call = (name, input = {}) => page.evaluate(async ({ name, input }) => (await window.checkoutService.execute({ connectionId: window.checkoutBinding.connectionId, documentId: window.checkoutBinding.documentId, toolsRevision: window.checkoutBinding.toolsRevision, operationId: crypto.randomUUID(), name, input })).result, { name, input })
    const review = await call('browser_cart_review')
    expect(review.ok).toBe(true)
    expect(review.checkout.methods).toHaveLength(5)
    const selected = await call('browser_invoice_select', { method })
    expect(selected.ok).toBe(true)
    expect(selected.checkout.methods.find(item => item.method === method).selected).toBe(true)
    expect((await call('browser_checkout_prepare')).checkout.confirmationToken).toBeUndefined()
    if (placeholder) {
      await page.getByPlaceholder(placeholder, { exact: true }).fill(code)
      await page.getByPlaceholder(placeholder, { exact: true }).focus()
    }
    const fresh = await call('browser_cart_get', { includeCatalog: false })
    const changed = await call('browser_cart_quantity', { version: fresh.cart.version, lineRef: fresh.cart.lines[0].ref, quantity: 2 })
    expect(changed.ok).toBe(true)
    expect(changed.cart.lines[0].quantity).toBe(2)
    expect(changed.cart.subtotal).toBe(100)
    await call('browser_cart_review')
    const notified = await call('browser_notification_phone', { phone: '0912345678' })
    expect(notified.ok).toBe(true)
    const prepared = await call('browser_checkout_prepare')
    expect(prepared.ok).toBe(true)
    expect(prepared.checkout.methods.find(item => item.selected).method).toBe(method)
    expect(prepared.checkout.fields.find(field => field.kind === 'phone').value).toBe('0912345678')
    if (placeholder)
      expect(prepared.checkout.fields.find(field => field.kind === method).value).toBe(code)
    expect(prepared.checkout.ready).toBe(true)
    expect(prepared.checkout.total).toBe(100)
    expect(prepared.checkout.confirmationToken).toBeTypeOf('string')
    expect((await page.evaluate(() => fetch('/__lab/state').then(response => response.json()))).state.orders).toHaveLength(0)
    expect(page.url()).toBe(`${origin}${basePath}/orders/create`)
    const beforeRemove = await call('browser_cart_get', { includeCatalog: false })
    const removed = await call('browser_cart_remove', { version: beforeRemove.cart.version, lineRef: beforeRemove.cart.lines[0].ref })
    expect(removed.ok).toBe(true)
    expect(removed.cart.lines).toHaveLength(0)
    expect(removed.cart.subtotal).toBe(0)
    expect(page.url()).toBe(`${origin}${basePath}/orders/create`)
  }
  finally { await browser.close() }
}, 45_000)

// Report: actual PB confirmation inspected Nov15; cancel emitted zero order POSTs.
test('cancels the native confirmation without ordering, then submits one confirmed local order through both buttons', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.goto(`${origin}${basePath}/menu/select-table`)
    await page.getByRole('button', { name: '開始點餐', exact: true }).click()
    await page.getByRole('button', { name: /^魚丸湯/ }).click()
    await page.locator('.dialog-footer button').click()
    await page.waitForFunction(async () => (await fetch('/__lab/state').then(response => response.json())).state.cart.length === 1)
    // NOTICE: Import the real native entry in the browser, not Vite's SSR runner.
    await page.evaluate(`(async () => { const { createPbService } = await import(${JSON.stringify(`/@fs${serviceModule}`)}); window.checkoutService = createPbService(); window.checkoutBinding = window.checkoutService.discover({ version: 1, connectionId: crypto.randomUUID(), challenge: crypto.randomUUID() }) })()`)
    const call = (name, input = {}) => page.evaluate(async ({ name, input }) => (await window.checkoutService.execute({ connectionId: window.checkoutBinding.connectionId, documentId: window.checkoutBinding.documentId, toolsRevision: window.checkoutBinding.toolsRevision, operationId: crypto.randomUUID(), name, input })).result, { name, input })
    await call('browser_cart_review')
    await call('browser_invoice_select', { method: 'none' })
    await call('browser_notification_phone', { phone: '0912345678' })
    await page.getByRole('button', { name: '送出訂單', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '確認訂單', exact: true })
    await dialog.waitFor()
    expect((await page.evaluate(() => window.pbTest.getState())).orders).toHaveLength(0)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    expect((await page.evaluate(() => window.pbTest.getState())).cart).toHaveLength(1)
    expect((await page.evaluate(() => window.pbTest.getState())).orders).toHaveLength(0)
    const prepared = await call('browser_checkout_prepare')
    const submitted = await call('browser_order_submit', { confirmationToken: prepared.checkout.confirmationToken })
    expect(submitted.ok).toBe(true)
    expect(submitted.code).toBe('order-submission-result')
    expect(submitted.status).toBe('accepted')
    expect(submitted.dispatch).toBe('dispatched')
    expect(submitted.effect).toBe('applied')
    expect(submitted).not.toHaveProperty('confirmationToken')
    expect(submitted.execution.steps.map(step => step.action)).toEqual(['option', 'submit'])
    expect(submitted.execution.steps.map(step => step.effect)).toEqual(['draft', 'order'])
    const state = await page.evaluate(() => window.pbTest.getState())
    expect(state.orders).toHaveLength(1)
    expect(state.orders[0].total).toBe(50)
    expect(submitted.order).toMatchObject({ hash: state.orders[0].orderId, total: 50 })
    expect(state.orders[0].payment.status).toBe('unpaid')
  }
  finally { await browser.close() }
}, 30_000)
