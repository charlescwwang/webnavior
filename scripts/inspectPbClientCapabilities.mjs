import assert from 'node:assert/strict'
import process from 'node:process'

import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { firefox } from 'playwright'

import { launchFirefox } from '../apps/stage-kiosk/scripts/firefoxBrowser.mjs'
import { prepareFirefoxIframeLogin } from '../apps/stage-kiosk/scripts/firefoxIframeLogin.mjs'
import { firefoxPrivacyPreferences } from '../apps/stage-kiosk/scripts/firefoxPreferences.mjs'

/**
 * Audits the actual Kiosk/PB connection without installing a PB bridge.
 * The disposable browser is an observer, not the proposed client controller.
 *
 * Call stack:
 *
 * inspectPbClientCapabilities (this script)
 *   -> existing Kiosk enrollment and ScenarioSurface
 *     -> existing interactiveServiceClient discovery
 */
const menuUrl = 'https://app.esgpb.com/order/store/1kgJeql/pick_up/menu'
const retained = process.argv.includes('--retained-profile')
const output = resolve(import.meta.dirname, '../output/playwright', retained ? 'pb-retained-capabilities' : 'pb-client-capabilities')
const browser = retained ? undefined : await firefox.launch({ channel: 'moz-firefox', headless: true, firefoxUserPrefs: firefoxPrivacyPreferences })
let context
try {
  // Retained mode uses only the authorized dedicated profile. Its existing
  // scoped Cookie policy can establish embedded login, without a PB listener.
  context = retained
    ? await launchFirefox(resolve(homedir(), '.webnavior/pb-prototype-firefox'), { headless: true })
    : await browser.newContext({ viewport: { width: 1080, height: 1920 }, locale: 'zh-TW' })
  const page = await context.newPage()
  let firstPartyAuthenticated
  let approvedCookiesPrepared = 0
  if (retained) {
    await page.goto(menuUrl, { waitUntil: 'networkidle' })
    firstPartyAuthenticated = await page.evaluate(() => {
      const raw = document.querySelector('[data-page]')?.getAttribute('data-page')
      return raw ? Boolean(JSON.parse(raw).props?.auth?.user) : false
    })
    if (firstPartyAuthenticated)
      approvedCookiesPrepared = (await prepareFirefoxIframeLogin(context)).prepared
  }
  const assets = []
  const pending = new Set()
  const vendorRequests = []
  let clientUrl
  let clientFactoryUrl
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin === 'https://app.esgpb.com')
      vendorRequests.push({ method: request.method(), path: url.pathname })
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin === 'http://localhost:5169' && url.pathname === '/kiosk/src/services/interactiveServiceClient.ts')
      clientUrl = response.url()
    if (url.origin === 'http://localhost:5169' && url.pathname.endsWith('/packages/stage-ui/src/services/interactiveServiceClient.ts'))
      clientFactoryUrl = response.url()
    if (url.origin !== 'https://app.esgpb.com' || response.request().resourceType() !== 'script' || !response.ok())
      return
    const capture = response.text().then((source) => {
      // Store only capability markers from public assets, never entire scripts,
      // document props, login identity, request bodies or response headers.
      const markers = Object.fromEntries(['modelContext', 'registerTool', 'discoverService', 'executeServiceTool', 'refresh_cart', 'postMessage', 'webnavior', 'xorder:menuReady', 'xorder:actionResult', 'xorder:searchProduct', 'a2-chat-status', 'chatFrame'].map(marker => [marker, source.includes(marker)]))
      const messageListeners = [...source.matchAll(/addEventListener\(\s*["']message["']/g)].length
      assets.push({ path: url.pathname, markers, messageListeners })
    }).catch(() => { assets.push({ path: url.pathname, readFailed: true }) }).finally(() => pending.delete(capture))
    pending.add(capture)
  })
  const bootstrap = page.waitForResponse(response => new URL(response.url()).pathname === '/api/kiosk/bootstrap' && response.request().method() === 'GET', { timeout: 30000 })
  void bootstrap.catch(() => {})
  await page.goto('http://localhost:5169/kiosk/#/', { waitUntil: 'domcontentloaded' })
  const identity = await bootstrap
  if (identity.status() === 401) {
    // Use the normal development UI, not a copied device credential.
    await page.getByRole('button', { name: '建立測試設備', exact: true }).click()
  }
  else {
    assert(identity.ok(), 'Existing Kiosk device bootstrap must succeed.')
  }
  await page.frameLocator('iframe').getByRole('heading', { name: /沙崙AI創新應用大樓店/ }).waitFor({ timeout: 90000 })
  const frame = page.frames().find(frame => frame.url().split('?')[0] === menuUrl)
  assert(frame, 'The actual Kiosk must display the approved original PB URL.')
  assert(clientUrl, 'The actual Kiosk client module must have loaded.')
  assert(clientFactoryUrl, 'The actual Kiosk client factory module must have loaded.')
  const clientModuleUrl = clientFactoryUrl
  const parentAccess = await page.evaluate(() => {
    const child = document.querySelector('iframe')
    let accessError
    try {
      void child.contentWindow.document
    }
    catch (error) { accessError = error.name }
    return { iframeUrl: child.src, contentDocumentAvailable: child.contentDocument !== null, accessError, nativeWebMcp: typeof document.modelContext?.getTools === 'function' }
  })
  // Browser evaluate here observes public runtime facts only. No executable
  // peer, message listener, tool or DOM mutation is installed in the PB page.
  const vendor = await frame.evaluate(() => {
    const raw = document.querySelector('[data-page]')?.getAttribute('data-page')
    return { bridgeInjected: document.documentElement.hasAttribute('data-webnavior-pb-bridge'), authenticated: raw ? Boolean(JSON.parse(raw).props?.auth?.user) : false, nativeWebMcp: typeof document.modelContext?.getTools === 'function', routeFunctionPresent: typeof window.route === 'function' }
  })
  assert.equal(vendor.bridgeInjected, false)
  const connection = await page.evaluate(async ({ url, menuUrl }) => {
    const { createInteractiveServiceClient } = await import(url)
    const client = createInteractiveServiceClient()
    // Invoke the public discovery boundary against the actual visible iframe;
    // this sends only its normal handshake, never an execution request.
    client.activate(menuUrl, document.querySelector('iframe').contentWindow)
    let reason
    try {
      await client.waitUntilReady()
    }
    catch (error) { reason = error.message }
    const result = { isolation: 'separate-discovery-lifetime', discoveryInitiatedByProbe: true, availability: client.availability.value, tools: client.tools.value.map(tool => tool.name), documentIdPresent: Boolean(client.getDocumentId()), reason }
    client.activate(undefined)
    return result
  }, { url: clientModuleUrl, menuUrl })
  const discoverySettled = ['ready', 'unavailable'].includes(connection.availability)
  const search = frame.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐', { exact: true })
  const originalQuery = await search.inputValue()
  // A search-field assignment can be checked even before category products
  // hydrate, or on an empty menu. No product identity or availability is guessed.
  const query = '__webnavior_read_only_probe__'
  await page.evaluate(() => {
    window.__pbNativeReplies = []
    const child = document.querySelector('iframe').contentWindow
    window.addEventListener('message', (event) => {
      if (event.origin === 'https://app.esgpb.com' && event.source === child)
        window.__pbNativeReplies.push({ received: true, dataType: typeof event.data })
    })
  })
  await page.evaluate(({ query, origin }) => {
    document.querySelector('iframe').contentWindow.postMessage({ action: 'search_product', data: { name: query } }, origin)
  }, { query, origin: new URL(menuUrl).origin })
  let searchApplied = false
  try {
    await frame.waitForFunction(query => document.querySelector('input[placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"]')?.value === query, query, { timeout: 5000 })
    searchApplied = true
  }
  catch { /* A loaded handler asset is not proof that its component is mounted. */ }
  const nativeMessages = { action: 'search_product', searchApplied, repliesToParent: await page.evaluate(() => window.__pbNativeReplies.length), runtime: await frame.evaluate(() => ({ chatFramePresent: Boolean(document.getElementById('chatFrame')), eventBufferPresent: Object.hasOwn(window, 'eventData'), bufferedAction: typeof window.eventData?.action === 'string' ? window.eventData.action : undefined })) }
  if (searchApplied) {
    await page.evaluate(({ query, origin }) => {
      document.querySelector('iframe').contentWindow.postMessage({ action: 'search_product', data: { name: query } }, origin)
    }, { query: originalQuery, origin: new URL(menuUrl).origin })
    await frame.waitForFunction(query => document.querySelector('input[placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"]')?.value === query, originalQuery)
  }
  await Promise.all(pending)
  const distinctAssets = [...new Map(assets.map(asset => [asset.path, asset])).values()]
  const report = { browser: context.browser().version(), originalPbUrl: menuUrl, mode: retained ? 'retained-controlled-profile-no-pb-injection' : 'ordinary-client-no-pb-injection', firstPartyAuthenticated, approvedCookiesPrepared, parentAccess, vendor, connection, discoverySettled, nativeMessages, assets: distinctAssets, vendorRequests, scope: { cartActionsDispatched: false, orderSubmitted: false, retainedLoginUsed: retained && vendor.authenticated, authenticatedInterfaceCoverage: vendor.authenticated ? 'current-embedded-page' : 'not-tested' } }
  await mkdir(output, { recursive: true })
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  console.info(JSON.stringify({ browser: report.browser, firstPartyAuthenticated, approvedCookiesPrepared, parentAccess, vendor, connection, nativeMessages, scriptsInspected: distinctAssets.length, messageListenerAssets: distinctAssets.filter(asset => asset.messageListeners > 0).map(asset => asset.path), reportPath: resolve(output, 'report.json') }, null, 2))
  assert(discoverySettled, 'Kiosk interrupted the discovery; the captured result is inconclusive, not an unsupported-site verdict.')
  assert(vendorRequests.every(request => ['GET', 'HEAD'].includes(request.method)), 'Read-only audit observed a non-read merchant request; inspect its method/path metadata.')
}
finally {
  await context?.close()
  await browser?.close()
}
