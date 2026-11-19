import process from 'node:process'

import { chromium } from 'playwright'
import { expect, it } from 'vitest'

import { basePath } from './catalog.js'

const origin = process.env.PB_LAB_URL
if (origin && origin !== 'http://127.0.0.1:5188')
  throw new Error('Quantity acceptance requires the isolated local fixture.')
const test = it.skipIf(!origin)
const serviceModule = new URL('../../packages/stage-ui/src/services/pbBrowserService.ts', import.meta.url).pathname

// Report: this chat, Nov18 — click-only fixture buttons hid the native mousedown contract.
test('requires a mouse press or Enter for servings and options, without counting click twice', async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.VITEST_BROWSER_CHANNEL })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.goto(`${origin}${basePath}/menu/select-table`)
    await page.getByRole('button', { name: '開始點餐', exact: true }).click()
    await page.getByRole('button', { name: /^周氏水餃/ }).click()
    for (const [field, label] of [['quantity', '份數'], ['extra', '加量水餃顆數']]) {
      const input = page.locator(`#${field}`)
      const before = Number(await input.inputValue())
      const increase = page.getByRole('button', { name: `增加${label}`, exact: true })
      await increase.evaluate(element => element.click())
      expect(await input.inputValue()).toBe(String(before))
      await increase.click()
      expect(await input.inputValue()).toBe(String(before + 1))
      await increase.press('Enter')
      expect(await input.inputValue()).toBe(String(before + 2))
      await page.getByRole('button', { name: `減少${label}`, exact: true }).click()
      expect(await input.inputValue()).toBe(String(before + 1))
    }
    expect((await page.evaluate(() => window.pbTest.getState())).cart).toHaveLength(0)
  }
  finally { await browser.close() }
}, 30_000)

test('repeats a held press and stops on release or removal of the product dialog', async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.VITEST_BROWSER_CHANNEL })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.goto(`${origin}${basePath}/menu/select-table`)
    await page.getByRole('button', { name: '開始點餐', exact: true }).click()
    await page.getByRole('button', { name: /^炸排骨便當/ }).click()
    const increase = page.getByRole('button', { name: '增加份數', exact: true })
    const bounds = await increase.boundingBox()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.waitForFunction(() => Number(document.querySelector('#quantity').value) >= 3)
    await page.mouse.up()
    const released = await page.locator('#quantity').inputValue()
    // More than two repeat intervals: a leaked hold timer would change the value.
    await page.waitForTimeout(250)
    expect(await page.locator('#quantity').inputValue()).toBe(released)
    await increase.dispatchEvent('mousedown', { button: 0 })
    await page.getByRole('button', { name: '關閉此對話框', exact: true }).click()
    await page.waitForTimeout(750)
    await page.getByRole('button', { name: /^炸排骨便當/ }).click()
    expect(await page.locator('#quantity').inputValue()).toBe('1')
    const decrease = page.getByRole('button', { name: '減少份數', exact: true })
    expect(await decrease.getAttribute('aria-disabled')).toBe('true')
    await decrease.dispatchEvent('mousedown', { button: 0 })
    await page.mouse.up()
    expect(await page.locator('#quantity').inputValue()).toBe('1')
  }
  finally { await browser.close() }
}, 30_000)

test('disables cart quantity controls until the real fixture write settles', async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.VITEST_BROWSER_CHANNEL })
  const gate = Promise.withResolvers()
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.goto(`${origin}${basePath}/menu/select-table`)
    await page.getByRole('button', { name: '開始點餐', exact: true }).click()
    await page.getByRole('button', { name: /^炸排骨便當/ }).click()
    await page.getByTestId('add-to-cart').click()
    await page.getByTestId('checkout').click()
    let writes = 0
    await page.route('**/__lab/state', async (route) => {
      if (route.request().method() === 'PUT') {
        writes++
        await gate.promise
      }
      await route.continue()
    })
    const increase = page.getByRole('button', { name: '增加炸排骨便當份數', exact: true })
    await increase.click()
    await expect.poll(() => writes).toBe(1)
    expect(await page.getByTestId('line-quantity').isDisabled()).toBe(true)
    expect(await increase.getAttribute('aria-disabled')).toBe('true')
    await increase.dispatchEvent('mousedown', { button: 0 })
    await page.mouse.up()
    gate.resolve()
    await expect.poll(() => page.getByTestId('line-quantity').inputValue()).toBe('2')
    await expect.poll(() => page.getByTestId('line-quantity').isDisabled()).toBe(false)
    expect(writes).toBe(1)
    expect(await page.getByTestId('order-total').textContent()).toBe('$260')
  }
  finally {
    gate.resolve()
    await browser.close()
  }
}, 30_000)

test('runs the production executor through two bentos, cart increments/decrements and a covered cart route', async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.VITEST_BROWSER_CHANNEL })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.goto(`${origin}${basePath}/menu/select-table`)
    await page.getByRole('button', { name: '開始點餐', exact: true }).click()
    // NOTICE: This is browser-owned code, not a Node import. As in nativeCheckout,
    // evaluate the module load in the page so Vitest's SSR transform cannot
    // inject its Node-only import helper into the serialized browser function.
    await page.evaluate(`(async () => { const { createPbService } = await import(${JSON.stringify(`/@fs${serviceModule}`)}); window.quantityService = createPbService() })()`)
    const result = await page.evaluate(async () => {
      const service = window.quantityService
      const binding = service.discover({ version: 1, connectionId: crypto.randomUUID(), challenge: crypto.randomUUID() })
      const call = async (name, input = {}) => {
        const receipt = await service.execute({ connectionId: binding.connectionId, documentId: binding.documentId, toolsRevision: binding.toolsRevision, operationId: crypto.randomUUID(), name, input })
        if (!receipt.result.ok)
          throw new Error(JSON.stringify(receipt.result))
        return receipt.result
      }
      let current = await call('browser_cart_get', { includeCatalog: true })
      const product = current.products.find(product => product.name === '炸排骨便當')
      const configuration = product.configurations[0]
      await call('browser_cart_add', { version: current.cart.version, productRef: product.ref, unitPrice: 130, quantity: 2, note: '', selection: { version: configuration.version, variantRef: configuration.variantRef, choices: [] } })
      const carts = [(await call('browser_cart_get', { includeCatalog: false })).cart]
      for (const quantity of [3, 1, 2]) {
        current = await call('browser_cart_get', { includeCatalog: false })
        await call('browser_cart_quantity', { version: current.cart.version, lineRef: current.cart.lines[0].ref, quantity })
        carts.push((await call('browser_cart_get', { includeCatalog: false })).cart)
      }
      await call('browser_open_product', { name: '炸排骨便當' })
      const review = await call('browser_cart_review')
      return { carts: carts.map(cart => ({ quantity: cart.lines[0].quantity, subtotal: cart.subtotal })), steps: review.execution.steps.map(step => step.action), orders: window.pbTest.getState().orders.length }
    })
    expect(result.carts).toEqual([{ quantity: 2, subtotal: 260 }, { quantity: 3, subtotal: 390 }, { quantity: 1, subtotal: 130 }, { quantity: 2, subtotal: 260 }])
    expect(result.steps).toEqual(['close-product', 'navigate'])
    expect(result.orders).toBe(0)
  }
  finally { await browser.close() }
}, 60_000)
