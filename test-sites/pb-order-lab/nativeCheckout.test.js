import process from 'node:process'

import { chromium } from 'playwright'
import { expect, it } from 'vitest'

import { basePath } from './catalog.js'

const origin = process.env.PB_LAB_URL
if (origin && origin !== 'http://127.0.0.1:5188')
  throw new Error('Native checkout acceptance requires the exact local fixture.')
const test = it.skipIf(!origin)
const serviceModule = new URL('../../packages/stage-ui/src/services/pbBrowserService.ts', import.meta.url).pathname

// Exercises the production module in the browser, including real fetch and DOM.
async function readState(page) {
  return page.evaluate(`(async () => {
    const { createPbService } = await import(${JSON.stringify(`/@fs${serviceModule}`)})
    window.stateService ??= createPbService()
    window.stateBinding ??= window.stateService.discover({ version: 1, connectionId: crypto.randomUUID(), challenge: crypto.randomUUID() })
    const result = await window.stateService.execute({ connectionId: window.stateBinding.connectionId, documentId: window.stateBinding.documentId, toolsRevision: window.stateBinding.toolsRevision, operationId: crypto.randomUUID(), name: 'browser_state_get', input: { includeCatalog: false } })
    return { tools: window.stateBinding.tools.map(tool => tool.name), state: result.result }
  })()`)
}

// Report: this chat, Nov17 — the simulator banner disappeared after scrolling and resembled the merchant page.
test('keeps the simulation banner visible while browsing and reviewing the cart', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 700 } })
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.goto(`${origin}${basePath}/menu/select-table`)
    await page.getByRole('button', { name: '開始點餐', exact: true }).click()
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    const banner = page.getByRole('note', { name: '自建測試環境' })
    expect(await banner.textContent()).toContain('非商家正式網站')
    expect((await banner.boundingBox()).y).toBeGreaterThanOrEqual(0)
    await page.goto(`${origin}${basePath}/orders/create`)
    expect(await banner.isVisible()).toBe(true)
    expect(await banner.textContent()).toContain('不會扣款或傳送店家訂單')
  }
  finally { await browser.close() }
}, 30_000)

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
    const cancelled = await readState(page)
    expect(cancelled.state, JSON.stringify(cancelled.state)).toMatchObject({ ok: true })
    expect(cancelled.state.order.paymentStatus).toBe('cancelled')
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
    const pending = await readState(page)
    expect(pending.tools).toEqual(['browser_state_get'])
    expect(pending.state, JSON.stringify(pending.state)).toMatchObject({ ok: true })
    expect(pending.state.order.paymentStatus).toBe('pending')
    expect(pending.state.order.paymentMethods).toEqual(['LINE Pay', '信用卡'])
    expect(pending.state).not.toHaveProperty('cart')
    expect(pending.state.execution.steps).toHaveLength(0)
    const denied = await page.evaluate(async () => (await window.stateService.execute({ connectionId: window.stateBinding.connectionId, documentId: window.stateBinding.documentId, toolsRevision: window.stateBinding.toolsRevision, operationId: crypto.randomUUID(), name: 'browser_cart_get', input: { includeCatalog: false } })).result)
    expect(denied.ok).toBe(false)
    expect(denied.effect).toBe('none')

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
    const paid = await readState(page)
    expect(paid.state.order.paymentStatus).toBe('paid')
    expect(paid.state.order.paymentMethod).toBe('LinePay')
    expect(paid.state.order.reference).toBe(before.props.order.hash)
    expect(paid.state.order.paymentMethods).toEqual([])

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
      await page.getByPlaceholder(placeholder, { exact: true }).fill('abcd')
      const invalid = await call('browser_state_get', { includeCatalog: false })
      expect(invalid.checkout.fields.find(field => field.kind === method).valid).toBe(false)
      expect(invalid.checkout.ready).toBe(false)
      expect(invalid.checkout.confirmationToken).toBeUndefined()
      await page.getByPlaceholder(placeholder, { exact: true }).fill(code)
      await page.getByPlaceholder(placeholder, { exact: true }).focus()
    }
    const fresh = await call('browser_state_get', { includeCatalog: false })
    expect(fresh.checkout.methods.find(item => item.selected).method).toBe(method)
    if (placeholder)
      expect(fresh.checkout.fields.find(field => field.kind === method).value).toBe(code)
    expect(fresh.execution.steps).toHaveLength(0)
    const changed = await call('browser_cart_quantity', { version: fresh.cart.version, lineRef: fresh.cart.lines[0].ref, quantity: 2 })
    expect(changed.ok, JSON.stringify(changed)).toBe(true)
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

// Report: this chat, Nov17 — missing payment evidence must not become success or permission to retry.
test.each(['failed', 'uncertain'])('keeps unverified %s payment results read-only and unknown', async (outcome) => {
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
    await page.getByTestId('payment-card').click()
    await page.getByTestId(`simulate-${outcome}`).click()
    const result = await readState(page)
    expect(result.state.order.paymentStatus).toBe('unknown')
    expect(result.tools).toEqual(['browser_state_get'])
    expect((await page.evaluate(() => window.pbTest.getState())).orders).toHaveLength(1)
  }
  finally { await browser.close() }
}, 30_000)

// Report: this chat, Nov17 cases 4/12 — production Host workflow must continue actual DOM entry after ticket invalidation.
test('continues donation and contact entry after manual edits and renews edited final consent without submitting', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.goto(`${origin}${basePath}/menu/select-table`)
    await page.getByRole('button', { name: '開始點餐', exact: true }).click()
    await page.getByRole('button', { name: /^魚丸湯/ }).click()
    await page.locator('.dialog-footer button').click()
    const dialogueModule = new URL('../../apps/stage-kiosk/src/services/browserDialogue.ts', import.meta.url).pathname
    const taskModule = new URL('../../apps/stage-kiosk/src/services/browserCartTask.ts', import.meta.url).pathname
    const started = await page.evaluate(`(async () => {
      const { createPbService } = await import(${JSON.stringify(`/@fs${serviceModule}`)})
      const { createBrowserDialogue } = await import(${JSON.stringify(`/@fs${dialogueModule}`)})
      const task = await import(${JSON.stringify(`/@fs${taskModule}`)})
      const service = createPbService()
      const binding = service.discover({ version: 1, connectionId: crypto.randomUUID(), challenge: crypto.randomUUID() })
      const calls = []
      const client = { tools: { value: binding.tools.map(tool => ({ ...tool, origin: location.origin })) }, execute: async (tool, input) => {
        calls.push(tool.name)
        return (await service.execute({ connectionId: binding.connectionId, documentId: binding.documentId, toolsRevision: binding.toolsRevision, operationId: crypto.randomUUID(), name: tool.name, input })).result
      } }
      const dialogue = createBrowserDialogue({ owner: () => 'TEST-customer', documentId: () => binding.documentId, answer: async () => { throw new Error('This literal completion requires no model.') } })
      const flow = { task, client, dialogue, calls, release: undefined }
      flow.begin = text => {
        flow.release?.()
        flow.release = task.beginBrowserCartTask(text, { dialogue, isCurrent: () => true, decide: async () => { throw new Error('No cart write should be proposed.') } })
      }
      flow.begin('我要用捐贈發票')
      window.hostWorkflow = flow
      return task.executeBrowserCheckout(client, 'invoice', { method: 'donation' })
    })()`)
    expect(started.ok, JSON.stringify(started)).toBe(true)
    expect(started.customerMessage).toContain('捐贈')
    const answer = text => page.evaluate(async (text) => {
      const flow = window.hostWorkflow
      flow.begin(text)
      const resume = await flow.task.prepareBrowserQuestionAnswer(flow.client)
      if (!resume)
        throw new Error('The current entry step was lost.')
      return resume()
    }, text)
    expect(await page.getByTestId('invoice-donation').isChecked()).toBe(true)
    await page.getByPlaceholder('請輸入3~7碼數字', { exact: true }).fill('12')
    const invalid = await answer('好了')
    expect(invalid.customerMessage).toContain('捐贈')
    expect(invalid.customerMessage).toContain('格式不正確')
    expect(invalid.customerMessage).not.toContain('通知手機')
    await page.getByPlaceholder('請輸入3~7碼數字', { exact: true }).fill('123')
    await page.getByText('訂單備註', { exact: true }).click()
    await page.getByTestId('order-note').fill('測試備註')
    const contact = await answer('好了')
    expect(contact.customerMessage).toContain('通知手機')
    expect(contact.customerMessage).not.toContain('發票要用哪種方式')
    await page.getByTestId('invoice-phone').fill('0912345678')
    const summary = await answer('好了')
    expect(summary.customerMessage).toContain('確認送出')
    expect(summary.customerMessage).toContain('0912345678')
    await page.evaluate(async () => {
      const flow = window.hostWorkflow
      await flow.client.execute(flow.client.tools.value.find(tool => tool.name === 'browser_checkout_prepare'), { focus: 'next' })
    })
    const retrySummary = await answer('好')
    expect(retrySummary.customerMessage).toContain('尚未送出')
    expect(retrySummary.customerMessage).toContain('確認送出')
    expect((await page.evaluate(() => window.pbTest.getState())).orders).toHaveLength(0)
    await page.getByTestId('invoice-phone').fill('0987654321')
    const renewed = await answer('好')
    expect(renewed.customerMessage).toContain('0987654321')
    expect(renewed.pendingCustomerChoice.questionId).not.toBe(summary.pendingCustomerChoice.questionId)
    expect(await page.evaluate(() => window.hostWorkflow.calls.filter(name => name === 'browser_invoice_select').length)).toBe(1)
    expect(await page.evaluate(() => window.hostWorkflow.calls.filter(name => name === 'browser_order_submit').length)).toBe(1)
    expect((await page.evaluate(() => window.pbTest.getState())).orders).toHaveLength(0)
  }
  finally { await browser.close() }
}, 60_000)

// Report: this chat, Nov17 cases 7/11 — use the production Host reset on result-only native tools.
test.each(['paid', 'cancelled', 'uncertain', 'paid-with-barrier'])('restarts a %s reception only after verified terminal payment and without changing the old order', async (outcome) => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.goto(`${origin}${basePath}/menu/select-table`)
    await page.getByRole('button', { name: '開始點餐', exact: true }).click()
    await page.getByRole('button', { name: /^魚丸湯/ }).click()
    await page.locator('.dialog-footer button').click()
    await page.waitForFunction(async () => (await fetch('/__lab/state').then(response => response.json())).state.cart.length === 1)
    await page.goto(`${origin}${basePath}/orders/create`)
    await page.locator('#phone').fill('0912345678')
    await page.locator('#phone').press('Tab')
    await page.getByRole('button', { name: '送出訂單', exact: true }).click()
    await page.getByRole('dialog', { name: '確認訂單', exact: true }).getByRole('button', { name: '確定', exact: true }).click()
    await page.waitForURL('**/choosePayment')
    const hostModule = new URL('../../apps/stage-kiosk/src/services/kioskConversationRetry.ts', import.meta.url).pathname
    await page.evaluate(`(async () => { window.resetHostReception = (await import(${JSON.stringify(`/@fs${hostModule}`)})).resetConversationService; window.createRestartNative = (await import(${JSON.stringify(`/@fs${serviceModule}`)})).createPbService })()`)
    const attempt = () => page.evaluate(async () => {
      // Use the same native journal across repeated attempts in this document.
      window.restartService ??= window.createRestartNative()
      window.restartBinding ??= window.restartService.discover({ version: 1, connectionId: crypto.randomUUID(), challenge: crypto.randomUUID() })
      const binding = window.restartBinding
      const names = []
      let lastState
      const client = {
        tools: { value: binding.tools },
        getDocumentId: () => binding.documentId,
        execute: async (tool, input) => {
          names.push(tool.name)
          lastState = (await window.restartService.execute({ connectionId: binding.connectionId, documentId: binding.documentId, toolsRevision: binding.toolsRevision, operationId: crypto.randomUUID(), name: tool.name, input })).result
          return lastState
        },
        refresh: () => { throw new Error('Must not refresh result editor tools') },
        waitUntilReady: async () => {},
      }
      try {
        return { result: await window.resetHostReception(client), names, documentId: binding.documentId, lastState }
      }
      catch (error) { return { error: error.message, names, documentId: binding.documentId, lastState } }
    })
    // A new-order request cannot silently cancel or abandon the unpaid order.
    const pendingUrl = page.url()
    expect((await attempt()).error).toContain('尚未付款')
    expect((await attempt()).error).toContain('尚未付款')
    expect(page.url()).toBe(pendingUrl)
    if (outcome === 'cancelled') {
      await page.getByRole('button', { name: '放棄付款', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: '放棄付款', exact: true }).click()
    }
    else {
      await page.getByTestId('payment-card').click()
      await page.getByTestId(`simulate-${outcome === 'uncertain' ? 'uncertain' : 'succeeded'}`).click()
    }
    await page.waitForURL(url => new RegExp(`^${basePath}/orders/[\\w-]+$`).test(url.pathname))
    const oldOrders = (await page.evaluate(() => window.pbTest.getState())).orders
    if (outcome === 'paid-with-barrier')
      await page.evaluate(basePath => localStorage.setItem(`webnavior:pb:cart-pending:${basePath}/`, 'order:unresolved-operation'), basePath)
    const result = await attempt()
    expect(result.names).toEqual(['browser_state_get'])
    if (outcome === 'uncertain' || outcome === 'paid-with-barrier') {
      expect(result.error).toContain('確認')
      expect(result.result).toBeUndefined()
      await page.reload()
      await page.evaluate(`(async () => { window.resetHostReception = (await import(${JSON.stringify(`/@fs${hostModule}`)})).resetConversationService; window.createRestartNative = (await import(${JSON.stringify(`/@fs${serviceModule}`)})).createPbService })()`)
      expect((await attempt()).error).toContain('確認')
    }
    else {
      expect(result, JSON.stringify(result)).toMatchObject({ result: 'reload' })
      // ScenarioSurface reloads this configured entry, never the result URL.
      await page.goto(`${origin}${basePath}/menu/select-table`)
      const fresh = await readState(page)
      expect(fresh.state.page).toBe('table')
      expect(fresh.state.documentId).not.toBe(result.documentId)
      expect(fresh.tools).toContain('browser_customer_reset')
      await page.getByRole('button', { name: '開始點餐', exact: true }).click()
      await page.getByRole('button', { name: /^魚丸湯/ }).click()
      await page.locator('.dialog-footer button').click()
      await page.waitForFunction(async () => (await fetch('/__lab/state').then(response => response.json())).state.cart.length === 1)
    }
    expect((await page.evaluate(() => window.pbTest.getState())).orders).toEqual(oldOrders)
  }
  finally { await browser.close() }
}, 30_000)
