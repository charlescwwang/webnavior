import process from 'node:process'

import { chromium } from 'playwright'
import { expect, it } from 'vitest'

import { basePath } from './catalog.js'

const origin = process.env.PB_LAB_URL
if (origin && origin !== 'http://127.0.0.1:5188')
  throw new Error('Native reset acceptance requires the exact local fixture.')
const test = it.skipIf(!origin)
const serviceModule = new URL('../../packages/stage-ui/src/services/pbBrowserService.ts', import.meta.url).pathname

// Report: this chat, Nov15 — PB returns Error/403 before the first table entry.
test('defers admission only for the actual missing-table response, then reads the cart after Start', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(`${origin}${basePath}/menu/select-table`)
    await page.getByRole('button', { name: '開始點餐', exact: true }).waitFor()
    const rejectCart = route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'X-Inertia': 'true' }, body: JSON.stringify({ component: 'Error', url: `${basePath}/orders/create`, props: { code: 403, message: '請掃描桌上 QR Code 點餐' } }) })
    await page.route(`**${basePath}/orders/create`, rejectCart)
    // NOTICE: Browser-side import avoids Vite SSR rewriting serialized callbacks.
    await page.evaluate(`(async () => { const { createPbService } = await import(${JSON.stringify(`/@fs${serviceModule}`)}); window.tableAdmissionService = createPbService() })()`)
    const before = await page.evaluate(async () => {
      const service = window.tableAdmissionService
      const binding = service.discover({ version: 1, connectionId: crypto.randomUUID(), challenge: crypto.randomUUID() })
      window.tableAdmissionBinding = binding
      return (await service.execute({ connectionId: binding.connectionId, documentId: binding.documentId, toolsRevision: binding.toolsRevision, operationId: crypto.randomUUID(), name: 'browser_cart_get', input: { includeCatalog: false, forAdmission: true } })).result
    })
    expect(before.ok).toBe(true)
    expect(before.page).toBe('table')
    expect(before.cartAdmission).toBe('after-table-entry')
    expect(before).not.toHaveProperty('cart')
    await page.unroute(`**${basePath}/orders/create`, rejectCart)
    await page.getByRole('button', { name: '開始點餐', exact: true }).click()
    await page.getByRole('button', { name: /^魚丸湯/ }).waitFor()
    const after = await page.evaluate(async () => {
      const binding = window.tableAdmissionBinding
      return (await window.tableAdmissionService.execute({ connectionId: binding.connectionId, documentId: binding.documentId, toolsRevision: binding.toolsRevision, operationId: crypto.randomUUID(), name: 'browser_cart_get', input: { includeCatalog: false, forAdmission: true } })).result
    })
    expect(after.ok).toBe(true)
    expect(after.cart.lines).toHaveLength(0)
    expect(after).not.toHaveProperty('cartAdmission')
  }
  finally { await browser.close() }
}, 30_000)

// Report: this chat, Nov15 — both Restart buttons stayed blocked by a cart
// marker retained from a retired document. Exercise the actual native service,
// fixture HTTP state and DOM controls without an operator profile or merchant IO.
test.each([false, true])('explicitly discards a retired cart marker after verified clear (occupied=%s)', async (occupied) => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.goto(`${origin}${basePath}/menu/select-table`)
    await page.getByRole('button', { name: '開始點餐', exact: true }).waitFor()
    if (occupied) {
      await page.getByRole('button', { name: '開始點餐', exact: true }).click()
      await page.getByRole('button', { name: /^魚丸湯/ }).click()
      await page.locator('.dialog-footer button').click()
      await page.waitForFunction(async () => (await fetch('/__lab/state').then(response => response.json())).state.cart.length === 1)
      await page.goto(`${origin}${basePath}/menu/select-table`)
      await page.getByRole('button', { name: '開始點餐', exact: true }).waitFor()
    }
    // NOTICE: Vite SSR rewrites imports inside serialized Playwright callbacks.
    // Evaluate the native browser import as browser code, using the same public
    // source module already imported by the fixture compatibility checker.
    await page.evaluate(`(async () => { const { createPbService } = await import(${JSON.stringify(`/@fs${serviceModule}`)}); window.createPbResetService = createPbService })()`)
    const result = await page.evaluate(async ({ basePath }) => {
      const markerKey = `webnavior:pb:cart-pending:${basePath}/`
      const marker = crypto.randomUUID()
      localStorage.setItem(markerKey, marker)
      const service = window.createPbResetService()
      const binding = service.discover({ version: 1, connectionId: crypto.randomUUID(), challenge: crypto.randomUUID() })
      const call = async (name, input = {}) => (await service.execute({ connectionId: binding.connectionId, documentId: binding.documentId, toolsRevision: binding.toolsRevision, operationId: crypto.randomUUID(), name, input })).result
      const before = await call('browser_recovery_context')
      const stillMarkedBeforeReset = localStorage.getItem(markerKey) === marker
      const current = await call('browser_cart_get', { includeCatalog: false, forAdmission: true })
      if (current.cart.lines.length)
        await call('browser_start_ordering', { name: current.selectedTable, forReset: true })
      const reset = await call('browser_customer_reset')
      const after = await call('browser_cart_get', { includeCatalog: false, forAdmission: true })
      const recovery = await call('browser_recovery_context')
      return { before, stillMarkedBeforeReset, reset, after, recovery, remainingMarker: localStorage.getItem(markerKey), orders: (await fetch('/__lab/state').then(response => response.json())).state.orders.length }
    }, { basePath })
    expect(result.before.canRetry).toBe(false)
    expect(result.before.canReset).toBe(true)
    expect(result.stillMarkedBeforeReset).toBe(true)
    expect(result.reset.ok).toBe(true)
    expect(result.reset.cartCleared).toBe(true)
    expect(result.after.cart.lines).toHaveLength(0)
    expect(result.after.cart.subtotal).toBe(0)
    expect(result.remainingMarker).toBeNull()
    expect(result.recovery.canRetry).toBe(true)
    expect(result.orders).toBe(0)
    expect(result.reset.execution.steps.filter(step => step.effect === 'cart')).toHaveLength(occupied ? 1 : 0)
  }
  finally { await browser.close() }
}, 30_000)

test('retains an uncertain order-submission marker when Restart is requested', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.goto(`${origin}${basePath}/menu/select-table`)
    await page.getByRole('button', { name: '開始點餐', exact: true }).waitFor()
    // NOTICE: Vite SSR rewrites imports inside serialized Playwright callbacks.
    // Evaluate the native browser import as browser code, using the same public
    // source module already imported by the fixture compatibility checker.
    await page.evaluate(`(async () => { const { createPbService } = await import(${JSON.stringify(`/@fs${serviceModule}`)}); window.createPbResetService = createPbService })()`)
    const result = await page.evaluate(async ({ basePath }) => {
      const markerKey = `webnavior:pb:cart-pending:${basePath}/`
      const marker = `order:${crypto.randomUUID()}`
      localStorage.setItem(markerKey, marker)
      const service = window.createPbResetService()
      const binding = service.discover({ version: 1, connectionId: crypto.randomUUID(), challenge: crypto.randomUUID() })
      const call = async name => (await service.execute({ connectionId: binding.connectionId, documentId: binding.documentId, toolsRevision: binding.toolsRevision, operationId: crypto.randomUUID(), name, input: {} })).result
      const before = await call('browser_recovery_context')
      const reset = await call('browser_customer_reset')
      return { before, reset, preserved: localStorage.getItem(markerKey) === marker }
    }, { basePath })
    expect(result.before.canRetry).toBe(false)
    expect(result.before.canReset).toBe(false)
    expect(result.reset.ok).toBe(false)
    expect(result.preserved).toBe(true)
  }
  finally { await browser.close() }
}, 30_000)

test.each(['before', 'after'])('keeps the cart marker when native clear fails %s dispatch', async (failure) => {
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
    await page.getByRole('button', { name: '清空', exact: true }).waitFor()
    if (failure === 'before')
      await page.getByRole('button', { name: '清空', exact: true }).evaluate(button => button.disabled = true)
    else
      await page.route('**/__lab/state', route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"deliberate test write failure"}' }) : route.continue())
    // NOTICE: Keep the import in browser code; SSR imports cannot be serialized
    // into a Playwright callback. The imported production entry is unchanged.
    await page.evaluate(`(async () => { const { createPbService } = await import(${JSON.stringify(`/@fs${serviceModule}`)}); window.createPbResetService = createPbService })()`)
    const result = await page.evaluate(async ({ basePath }) => {
      const markerKey = `webnavior:pb:cart-pending:${basePath}/`
      const marker = crypto.randomUUID()
      localStorage.setItem(markerKey, marker)
      const service = window.createPbResetService()
      const binding = service.discover({ version: 1, connectionId: crypto.randomUUID(), challenge: crypto.randomUUID() })
      const call = async name => (await service.execute({ connectionId: binding.connectionId, documentId: binding.documentId, toolsRevision: binding.toolsRevision, operationId: crypto.randomUUID(), name, input: {} })).result
      const reset = await call('browser_customer_reset')
      const recovery = await call('browser_recovery_context')
      return { reset, recovery, preserved: localStorage.getItem(markerKey) !== null, resetMarker: localStorage.getItem(markerKey)?.startsWith('reset:'), remainingCart: (await fetch('/__lab/state').then(response => response.json())).state.cart.length }
    }, { basePath })
    expect(result.reset.ok).toBe(false)
    expect(result.reset.status).toBe(failure === 'before' ? 'rejected' : 'unknown')
    expect(result.preserved).toBe(true)
    expect(result.resetMarker).toBe(failure === 'after')
    expect(result.remainingCart).toBe(1)
    expect(result.recovery.canRetry).toBe(false)
    expect(result.recovery.canReset).toBe(failure === 'before')
    if (failure === 'after') {
      await page.reload()
      await page.getByRole('button', { name: '清空', exact: true }).waitFor()
      await page.evaluate(`(async () => { const { createPbService } = await import(${JSON.stringify(`/@fs${serviceModule}`)}); window.createPbResetService = createPbService })()`)
      const reloaded = await page.evaluate(async () => {
        const service = window.createPbResetService()
        const binding = service.discover({ version: 1, connectionId: crypto.randomUUID(), challenge: crypto.randomUUID() })
        return (await service.execute({ connectionId: binding.connectionId, documentId: binding.documentId, toolsRevision: binding.toolsRevision, operationId: crypto.randomUUID(), name: 'browser_recovery_context', input: {} })).result
      })
      expect(reloaded.canRetry).toBe(false)
      expect(reloaded.canReset).toBe(false)
    }
  }
  finally { await browser.close() }
}, 30_000)
