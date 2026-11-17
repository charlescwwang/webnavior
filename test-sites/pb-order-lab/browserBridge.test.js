import process from 'node:process'

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium } from 'playwright'
import { build } from 'vite'
import { expect, it } from 'vitest'

const publicLive = process.env.PB_PUBLIC_LIVE === '1'
const origin = publicLive ? 'https://webnavior.aikcitri.qzz.io' : process.env.PB_LAB_URL
if (origin && origin !== 'http://127.0.0.1:5188' && !publicLive)
  throw new Error('Browser bridge acceptance requires the isolated local fixture.')

it.skipIf(!origin)('connects the browser Kiosk client to the owned PB iframe through table entry and a verified cart edit', async () => {
  const browser = await chromium.launch({ headless: true })
  let harnessDirectory
  try {
    // The test iframe is 1000px tall; keep its sticky checkout controls inside the parent viewport.
    const page = await browser.newPage({ viewport: { width: 1100, height: 1200 } })
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    if (publicLive) {
      // Only the test parent is served by interception. The iframe, assets and
      // simulator API use the actual public deployment and its browser cookies.
      harnessDirectory = await mkdtemp(join(tmpdir(), 'pb-kiosk-parent-'))
      await build({ configFile: false, root: new URL('.', import.meta.url).pathname, logLevel: 'silent', build: { outDir: harnessDirectory, rolldownOptions: { input: new URL('./kiosk/bridge-test.html', import.meta.url).pathname } } })
      await page.route(`${origin}/kiosk/bridge-test.html`, route => route.fulfill({ path: join(harnessDirectory, 'kiosk/bridge-test.html'), contentType: 'text/html' }))
      await page.route(`${origin}/assets/**`, async (route) => {
        const file = new URL(route.request().url()).pathname.split('/').at(-1)
        await route.fulfill({ body: await readFile(join(harnessDirectory, 'assets', file)), contentType: 'text/javascript' })
      })
    }
    await page.goto(`${origin}/kiosk/bridge-test.html`)
    await page.waitForFunction(() => window.fixtureClient?.availability.value === 'ready')
    const entry = await page.evaluate(async () => {
      const client = window.fixtureClient
      const call = (name, input) => client.execute(client.tools.value.find(tool => tool.name === name), input)
      const admission = await call('browser_cart_get', { includeCatalog: false, forAdmission: true })
      const selected = await call('browser_table_select', { name: 'A1 桌' })
      const started = await call('browser_start_ordering', { name: 'A1 桌' })
      return { admission, selected, started }
    })
    expect(entry.selected.ok, JSON.stringify(entry.selected)).toBe(true)
    expect(entry.started.ok, JSON.stringify(entry.started)).toBe(true)
    expect(entry.started.code, JSON.stringify(entry.started)).toBe('table-entry-starting')
    await page.waitForFunction(() => document.querySelector('iframe').contentWindow.location.pathname.endsWith('/menu'))
    const result = await page.evaluate(async () => {
      const client = window.fixtureClient
      const call = (name, input) => client.execute(client.tools.value.find(tool => tool.name === name), input)
      const menu = await call('browser_cart_get', { includeCatalog: true, forAdmission: true })
      if (!menu.products)
        throw new Error(JSON.stringify(menu))
      const product = menu.products.find(product => product.name === '魚丸湯')
      const added = await call('browser_cart_add', { version: menu.cart.version, productRef: product.ref, quantity: 1, unitPrice: 50, note: 'browser bridge test', selection: { version: product.configurations[0].version, variantRef: '', choices: [] } })
      const cart = await call('browser_cart_get', { includeCatalog: false })
      return { added, cart, documentId: client.getDocumentId() }
    })
    expect(entry.admission.ok).toBe(true)
    expect(entry.admission.page).toBe('table')
    expect(entry.selected.selectedTable).toBe('A1 桌')
    expect(entry.started.code).toBe('table-entry-starting')
    expect(result.added.ok).toBe(true)
    expect(result.cart.cart.lines).toHaveLength(1)
    expect(result.cart.cart.lines[0].name).toBe('魚丸湯')
    expect(result.cart.cart.subtotal).toBe(50)
    const frame = page.frameLocator('iframe')
    await frame.getByTestId('checkout').click()
    await frame.getByTestId('invoice-phone').fill('0912345678')
    await frame.getByTestId('invoice-phone').press('Tab')
    await frame.getByTestId('submit-order').click()
    await frame.getByRole('dialog', { name: '確認訂單', exact: true }).getByRole('button', { name: '確定', exact: true }).click()
    await frame.getByTestId('payment-card').waitFor()
    const payment = await page.evaluate(async () => {
      const client = window.fixtureClient
      return client.execute(client.tools.value.find(tool => tool.name === 'browser_state_get'), { includeCatalog: false })
    })
    expect(payment.ok, JSON.stringify(payment)).toBe(true)
    expect(payment.order.paymentStatus).toBe('pending')
    expect(payment.order.paymentMethods).toEqual(['LINE Pay', '信用卡'])
    expect(payment).not.toHaveProperty('cart')
    await page.reload()
    await page.waitForFunction(() => window.fixtureClient?.availability.value === 'ready')
    const documentId = await page.evaluate(() => window.fixtureClient.getDocumentId())
    expect(documentId).not.toBe(result.documentId)
    if (publicLive) {
      await page.screenshot({ path: '/tmp/pb-public-kiosk-bridge.png' })
      console.info('Public built PB iframe: table entry, verified cart addition and document rebinding passed.')
    }
  }
  finally {
    await browser.close()
    if (harnessDirectory)
      await rm(harnessDirectory, { recursive: true, force: true })
  }
}, 60_000)
