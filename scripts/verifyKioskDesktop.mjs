import assert from 'node:assert/strict'
import process from 'node:process'

import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { _electron as electron } from 'playwright'

// Local-only lifecycle/IPC acceptance fixture: never logs in or contacts a real ordering site.
const runtime = process.env.ESGPB_ELECTRON_PATH
assert(runtime, 'Set ESGPB_ELECTRON_PATH to the inspected pilot runtime.')
const profile = await mkdtemp(resolve(tmpdir(), 'airi-kiosk-desktop-smoke-'))
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  if (request.url.startsWith('/slow/')) {
    setTimeout(() => response.end('<!doctype html><h1>Slow fixture</h1>'), 100)
    return
  }
  response.end(request.url.startsWith('/kiosk/')
    ? '<!doctype html><title>Kiosk fixture</title><h1>Kiosk host</h1><div style="margin-left:300px">Native surface</div>'
    : '<!doctype html><title>Service fixture</title><h1>Visible service</h1><button>Manual control</button>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert(address && typeof address !== 'string')
const origin = `http://127.0.0.1:${address.port}`
let app
let serviceVideo
try {
  app = await electron.launch({
    executablePath: runtime,
    timeout: 30_000,
    recordVideo: process.env.KIOSK_TEST_VIDEO_DIR ? { dir: process.env.KIOSK_TEST_VIDEO_DIR, size: { width: 1080, height: 1920 } } : undefined,
    // Fake devices exercise the real permission handlers without recording the operator.
    // Do not use fake-ui-for-media-stream: it would bypass the policy under test.
    args: [resolve('apps/stage-kiosk-desktop/out/main/index.js'), '--use-fake-device-for-media-stream'],
    env: { ...process.env, KIOSK_DESKTOP_URL: `${origin}/kiosk/`, KIOSK_DESKTOP_WINDOWED: '1', KIOSK_DESKTOP_USER_DATA: profile },
  })
  const host = await app.firstWindow()
  if (process.env.KIOSK_TEST_PORTRAIT === '1')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080, 1920))
  await host.waitForFunction(() => Boolean(window.airiKioskDesktop))
  const capture = await host.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    const kinds = stream.getTracks().map(track => track.kind).sort()
    stream.getTracks().forEach(track => track.stop())
    return kinds
  })
  assert.deepEqual(capture, ['audio', 'video'])
  console.info('PASS: trusted Kiosk main frame captures synthetic audio/video through real permission handlers.')
  const request = { serviceId: 'first', documentKey: 'first:1', url: `${origin}/service/`, bounds: { x: 300, y: 100, width: 700, height: 500 }, visible: true }
  const first = await host.evaluate(input => window.airiKioskDesktop.updateSurface(input), request)
  assert.equal(first.state, 'visible')
  const site = app.context().pages().find(page => page.url() === request.url)
  assert(site)
  assert.equal(await site.getByRole('heading', { name: 'Visible service' }).count(), 1)
  assert.equal(await site.evaluate(() => typeof window.airiKioskDesktop), 'undefined')
  assert.equal(await site.evaluate(() => typeof require), 'undefined')
  const deniedCapture = await site.evaluate(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(track => track.stop())
      return 'unexpected-grant'
    }
    catch (error) {
      return error.name
    }
  })
  assert.equal(deniedCapture, 'NotAllowedError')
  console.info('PASS: vendor native page cannot capture microphone audio.')
  await site.evaluate(() => localStorage.setItem('login-fixture', 'first-session'))
  console.info('PASS: trusted preload controls visible native site; remote page has no bridge or Node.')
  await host.evaluate(() => {
    window.receivedActivities = []
    window.airiKioskDesktop.onActivity(activity => window.receivedActivities.push(activity))
  })
  await site.getByRole('button', { name: 'Manual control' }).click()
  await host.waitForFunction(() => window.receivedActivities.length > 0)
  const activity = await host.evaluate(() => window.receivedActivities[0])
  assert.deepEqual(activity, { serviceId: 'first', documentKey: 'first:1' })
  console.info('PASS: native input forwards document-scoped activity without field contents.')
  const hidden = await host.evaluate(input => window.airiKioskDesktop.updateSurface(input), { ...request, visible: false })
  assert.equal(hidden.state, 'hidden')
  const views = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map(view => view.getVisible()))
  assert.deepEqual(views, [false])
  console.info('PASS: host overlay can hide the native View.')
  await host.evaluate(input => window.airiKioskDesktop.updateSurface(input), { ...request, serviceId: 'second', documentKey: 'second:1' })
  const second = app.context().pages().find(page => page.url() === request.url)
  assert(second)
  assert.equal(await second.evaluate(() => localStorage.getItem('login-fixture')), null)
  await host.evaluate(input => window.airiKioskDesktop.updateSurface(input), request)
  const restored = app.context().pages().find(page => page.url() === request.url)
  assert(restored)
  assert.equal(await restored.evaluate(() => localStorage.getItem('login-fixture')), 'first-session')
  console.info('PASS: service storage is isolated and retained when returning to the same service.')
  const raced = await host.evaluate(async (input) => {
    const slow = { ...input, url: input.url.replace('/service/', '/slow/'), documentKey: 'first:slow' }
    return Promise.all([
      window.airiKioskDesktop.updateSurface(slow),
      window.airiKioskDesktop.updateSurface({ ...slow, visible: false }),
    ])
  }, request)
  assert.equal(raced[0].state, 'superseded')
  assert.equal(raced[1].state, 'hidden')
  const hiddenAfterRace = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map(view => view.getVisible()))
  assert.deepEqual(hiddenAfterRace, [false])
  console.info('PASS: stale navigation completion cannot override a newer hide request.')
  // A retiring host may publish its final hide after navigation has started.
  // Its old preload counter must not make the new document's first placement stale.
  await host.evaluate(input => window.addEventListener('pagehide', () => {
    void window.airiKioskDesktop.updateSurface({ ...input, visible: false }).catch(() => {})
  }, { once: true }), request)
  await host.reload()
  await host.waitForFunction(() => Boolean(window.airiKioskDesktop))
  const reloaded = await host.evaluate(input => window.airiKioskDesktop.updateSurface(input), request)
  assert.equal(reloaded.state, 'visible')
  console.info('PASS: host reload resets preload sequencing without losing service login storage.')
  // Synthetic PB-origin document: exercise the production isolated-world bundle
  // and preload RPC without authenticating or contacting a merchant endpoint.
  const pbUrl = 'https://app.esgpb.com/order/store/1kgJeql/pick_up/menu'
  const viewport = await host.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const pbPlacement = { ...request, bounds: { x: 20, y: 100, width: viewport.width - 40, height: viewport.height - 120 }, serviceId: 'pb-fixture', documentKey: 'pb-fixture:1', url: pbUrl }
  await app.evaluate(async ({ session }, { partition, url }) => {
    const base = new URL('.', url)
    let cartPresent = true
    globalThis.__pbFixtureWrites = 0
    globalThis.__pbFixtureCatalogReads = 0
    const props = () => ({ auth: { user: { id: 'fixture' } }, subtotal: cartPresent ? 10 : 0, order: { hash: 'fixture-order', pick_up_date: '2026-11-01', pick_up_time: '12:00' }, details: cartPresent ? [{ id: 1, amount: 1, unit_price: 10, note: 'Fixture note', item_type: 'product', item: { id: 1, name: 'Fixture meal' }, product_prices: [{ item_type: 'product_price', item_id: 1, parent_id: null, product_attrs: [{ attr_id: 1, amount: 1, unit_price: 0, attr: { name: 'Fixture side' } }] }] }] : [], defaultPickUpDate: '2026-11-01', defaultPickUpTime: '12:00' })
    const routes = {
      'shopping.menu.categories': { uri: 'store/{store_hash}/{flow_type}/menu-categories', methods: ['GET', 'HEAD'], parameters: ['store_hash', 'flow_type'] },
      'shopping.getAttrByProduct': { uri: 'store/{store_hash}/{flow_type}/getAttrByProduct/{product}/{product_price?}', methods: ['GET', 'HEAD'], parameters: ['store_hash', 'flow_type', 'product', 'product_price'] },
      'shopping.orders.details.destroy': { uri: 'store/{store_hash}/{flow_type}/orders/{order}/details/{detail}', methods: ['DELETE'], parameters: ['store_hash', 'flow_type', 'order', 'detail'] },
    }
    const declaration = `const Ziggy=${JSON.stringify({ url: 'https://app.esgpb.com/order', routes })};throw new Error('Vendor code must not execute');`
    const html = () => `<!doctype html><script>${declaration}</script><div data-page='${JSON.stringify({ props: props() })}'></div><a title="回店家首頁" href="${url}">Fixture menu</a><input placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"><main><button><h4>Fixture meal</h4>$10</button></main><span class="text-xl font-bold ms-2">$${props().subtotal}</span>`
    await session.fromPartition(partition).cookies.set({ url, name: 'XSRF-TOKEN', value: 'synthetic-test-token' })
    await session.fromPartition(partition).protocol.handle('https', async (request) => {
      const target = new URL(request.url)
      if (request.method === 'DELETE' && target.origin === base.origin && target.pathname === `${base.pathname}orders/fixture-order/details/1`) {
        globalThis.__pbFixtureWrites++
        cartPresent = false
        return new Response(null, { status: 204 })
      }
      if (request.method !== 'GET' || target.origin !== base.origin)
        return new Response('Fixture blocks other writes and foreign requests.', { status: 404 })
      if ([new URL(url).pathname, `${base.pathname}orders/create`].includes(target.pathname))
        return new Response(html(), { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': 'script-src \'none\'' } })
      if (target.pathname === `${base.pathname}menu-categories`) {
        globalThis.__pbFixtureCatalogReads++
        const hold = globalThis.__pbFixtureCatalogHold
        if (hold && !hold.claimed) {
          hold.claimed = true
          hold.enter()
          await new Promise(resolve => hold.release = resolve)
        }
        return Response.json({ categories: [{ id: 1, name: 'Fixture category', count: 1 }] })
      }
      if (target.pathname === `${base.pathname}menu-category-items`)
        return Response.json({ products: [{ id: 1, name: 'Fixture meal', price: 10, price_type: 1 }], productGroups: [] })
      if (target.pathname === `${base.pathname}getAttrByProduct/1`)
        return Response.json({ 加購: [{ id: 774, name: 'Fixture rice', attr_group: { id: 256, required: false, amount: 1 }, attr_item: { price: 5 }, pivot: {} }] })
      return new Response('Fixture blocks all other requests.', { status: 404 })
    })
  }, { partition: `persist:service-${createHash('sha256').update(JSON.stringify([pbPlacement.serviceId, new URL(pbUrl).origin])).digest('hex')}`, url: pbUrl })
  await host.evaluate(input => window.airiKioskDesktop.updateSurface(input), pbPlacement)
  const invoke = (command, binding = pbPlacement) => host.evaluate(({ command, binding }) => window.airiKioskDesktop.invokeService({ serviceId: binding.serviceId, documentKey: binding.documentKey, command }), { command, binding })
  const discovery = await invoke({ kind: 'discover', request: { version: 1, connectionId: 'fixture-connection', challenge: 'fixture-challenge' } })
  assert.equal(discovery.challenge, 'fixture-challenge')
  assert(discovery.tools.some(tool => tool.name === 'browser_search'))
  const execute = { connectionId: discovery.connectionId, documentId: discovery.documentId, toolsRevision: discovery.toolsRevision, operationId: 'fixture-search', name: 'browser_search', input: { query: 'fixture query' } }
  const searched = await invoke({ kind: 'execute', request: execute })
  assert.equal(searched.result.search, 'fixture query')
  const nativePage = app.context().pages().find(page => page.url() === pbUrl)
  assert(nativePage)
  serviceVideo = nativePage.video()
  console.info('PB fixture viewport:', await nativePage.evaluate(() => ({ width: innerWidth, height: innerHeight })))
  assert.equal(await nativePage.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').inputValue(), 'fixture query')
  assert.equal(await nativePage.evaluate(() => typeof globalThis.__webnaviorPbService), 'undefined')
  assert.equal(await nativePage.evaluate(() => typeof window.airiKioskDesktop), 'undefined')
  assert.equal(await nativePage.evaluate(() => typeof window.route), 'undefined')
  const cart = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-catalog', name: 'browser_cart_get', input: { includeCatalog: true } } })
  assert.equal(cart.result.ok, true)
  assert.equal(cart.result.cart.lines[0].name, 'Fixture meal')
  assert.deepEqual(cart.result.cart.lines[0].options, [{ name: 'Fixture side', quantity: 1 }])
  assert.equal(cart.result.products[0].name, 'Fixture meal')
  console.info('PASS: isolated PB catalog/cart reads use declared route data without a vendor main-world helper.')

  // Report: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov2 S01/S11.
  // Read-back must retain the vendor's configuration labels, just as write receipts do.
  const readBack = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-cart-readback', name: 'browser_cart_get', input: { includeCatalog: false } } })
  assert.match(readBack.result.customerMessage, /Fixture side ×1/)
  assert.match(readBack.result.customerMessage, /Fixture note/)
  assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 0)
  console.info('PASS: native cart read-back retains the verified configuration without a write.')

  // Discovery is evidence for Main, not proof that a customer's filter was satisfied.
  const rawCatalog = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-menu-discovery', name: 'browser_observe', input: { includeDescriptions: true, purpose: 'information' } } })
  assert.equal(rawCatalog.result.dataOnly, true)
  assert.equal(rawCatalog.result.customerMessage, undefined)
  assert.equal(rawCatalog.result.products[0].ref, cart.result.products[0].ref)
  // Report: output/playwright/pb-electron/restored-S02-exclusion-before.json.
  // Model-facing names in the opaque-ref field must earn correction evidence,
  // not an empty success that repeats until the task reaches its tool limit.
  const wrongRefs = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-present-name-as-ref', name: 'browser_present', input: { productRefs: ['Fixture meal'] } } })
  assert.equal(wrongRefs.result.dataOnly, true)
  assert.equal(wrongRefs.result.status, 'proposal_rejected')
  assert.deepEqual(wrongRefs.result.unresolvedProductRefs, ['Fixture meal'])
  assert.deepEqual(wrongRefs.result.products, [{ ref: cart.result.products[0].ref, name: 'Fixture meal' }])
  assert.match(wrongRefs.result.explanation, /ref/)
  assert.equal(wrongRefs.result.customerMessage, undefined)
  assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 0)
  const selectedCatalog = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-menu-present', name: 'browser_present', input: { productRefs: [cart.result.products[0].ref] } } })
  assert.match(selectedCatalog.result.customerMessage, /Fixture meal/)
  assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 0)
  console.info('PASS: catalog discovery stays internal; explicit current-reference presentation supplies the menu receipt.')

  // Report: this chat, Oct31; add-on price inquiry returned only the base meal price.
  const configuration = cart.result.products[0].configurations[0]
  // Report: docs/plans/2026-10-28-windows-kiosk-electron.md, S04/S09.
  // Exercise the production descriptor/parser/coordinator boundary: retaining
  // the entire source row cannot silently become a full-row replacement.
  const invalidPartial = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-invalid-partial-replacement', name: 'browser_cart_replace', input: { version: readBack.result.cart.version, lineRef: readBack.result.cart.lines[0].ref, productRef: cart.result.products[0].ref, quantity: 1, retainQuantity: 1, unitPrice: 15, note: '', selection: { version: configuration.version, variantRef: configuration.variantRef, choices: [{ ref: configuration.groups[0].choices[0].ref, quantity: 1 }] } } } })
  assert.equal(invalidPartial.result.status, 'rejected')
  assert.match(invalidPartial.result.customerMessage, /保留份數/)
  assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 0)
  console.info('PASS: native partial-replacement arguments reach the cart coordinator and reject an invalid retained count without a write.')
  const invalidGroup = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-invalid-quantity-group', name: 'browser_cart_quantity', input: { version: readBack.result.cart.version, lineRef: readBack.result.cart.lines[0].ref, lineRefs: [readBack.result.cart.lines[0].ref, readBack.result.cart.lines[0].ref], quantity: 5 } } })
  assert.equal(invalidGroup.result.status, 'rejected')
  assert.match(invalidGroup.result.customerMessage, /合計調整/)
  assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 0)
  const configuredQuote = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-option-quote', name: 'browser_quote_selection', input: { productRef: cart.result.products[0].ref, quantity: 2, selection: { version: configuration.version, variantRef: configuration.variantRef, choices: [{ ref: configuration.groups[0].choices[0].ref, quantity: 1 }] } } } })
  assert.equal(configuredQuote.result.ok, true)
  assert.equal(configuredQuote.result.unitPrice, 15)
  assert.equal(configuredQuote.result.total, 30)
  // Report: output/playwright/pb-electron/restored-S01-price-breakdown-before.json.
  // A combined price alone does not answer the base price and add-on surcharge.
  assert.match(configuredQuote.result.customerMessage, /基本單價 10 元/)
  assert.match(configuredQuote.result.customerMessage, /Fixture rice 每個 5 元、每份 1 個/)
  assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 0)
  console.info('PASS: configured price includes per-serving add-ons without a merchant write.')

  // Report: output/playwright/pb-electron/restored-S06-instructions-sequence.json.
  // Hold only the passive cue's catalog response. A required cart read must
  // supersede that cue without waiting for the vendor's eight-second timeout.
  await app.evaluate(() => {
    let enter
    const ready = new Promise(resolve => enter = resolve)
    globalThis.__pbFixtureCatalogHold = { claimed: false, ready, enter, release: () => {} }
  })
  const blockedCue = invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-blocked-catalog-cue', name: 'browser_present', input: { productRefs: [cart.result.products[0].ref] } } })
  let requiredRead
  let readDeadline
  try {
    await app.evaluate(() => globalThis.__pbFixtureCatalogHold.ready)
    requiredRead = invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-context-supersedes-catalog', name: 'browser_cart_get', input: { includeCatalog: false } } })
    const read = await Promise.race([
      requiredRead,
      new Promise((_, reject) => readDeadline = setTimeout(() => reject(new Error('Required cart read waited behind a superseded catalog fetch.')), 1500)),
    ])
    assert.equal(read.result.ok, true)
    assert.equal(read.result.cart.lines.length, 1)
    assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 0)
  }
  finally {
    clearTimeout(readDeadline)
    await app.evaluate(() => {
      globalThis.__pbFixtureCatalogHold.release()
      delete globalThis.__pbFixtureCatalogHold
    })
    const cancelled = await blockedCue
    assert.equal(cancelled.result.ok, true)
    assert.equal(cancelled.result.presentation.cue, 'cancelled')
    await requiredRead
  }
  console.info('PASS: required cart read supersedes a blocked passive catalog fetch before its response is released.')

  // Restore the visible cue expected by the following movement/reset checks;
  // the blocked-catalog case intentionally cancels and removes its own cue.
  await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-after-blocked-cue', name: 'browser_present', input: { productRefs: [cart.result.products[0].ref] } } })

  // Report: this chat, Nov1 live consecutive requests. A passive speech cue
  // still moving must not make the next Main recovery read fail admission.
  const priorCue = await nativePage.locator('[data-webnavior-presentation]').elementHandle()
  const queuedCue = invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-queued-cue', name: 'browser_present', input: { productRefs: [cart.result.products[0].ref] } } })
  await nativePage.waitForFunction(previous => document.querySelector('[data-webnavior-presentation]') && document.querySelector('[data-webnavior-presentation]') !== previous, priorCue)
  const queuedContext = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-queued-context', name: 'browser_recovery_context', input: {} } })
  await queuedCue
  assert.equal(queuedContext.result.canRetry, true)
  console.info('PASS: a pending passive speech cue cannot reject the next required browser context read.')
  const beforeResetCue = await nativePage.evaluateHandle(() => document.querySelector('[data-webnavior-presentation]'))
  const resetCue = invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-reset-cue', name: 'browser_present', input: { productRefs: [cart.result.products[0].ref] } } })
  await nativePage.waitForFunction(previous => document.querySelector('[data-webnavior-presentation]') && document.querySelector('[data-webnavior-presentation]') !== previous, beforeResetCue)
  const immediateReset = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-reset-during-cue', name: 'browser_customer_reset', input: {} } })
  await resetCue
  assert.equal(immediateReset.result.status, 'customer-reset', JSON.stringify(immediateReset.result))
  assert.equal(immediateReset.result.cartPreserved, true)
  assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 0)
  console.info('PASS: customer reset settles a superseded passive cue before checking the operation journal.')

  await nativePage.evaluate(() => {
    window.__fixtureCardClicks = 0
    document.querySelector('main button').addEventListener('click', () => {
      window.__fixtureCardClicks++
      if (!document.querySelector('[role="dialog"]')) {
        const dialog = document.createElement('div')
        dialog.setAttribute('role', 'dialog')
        dialog.innerHTML = '<div class="menu-dialog"><h1>Fixture meal</h1><button class="el-dialog__headerbtn">Close</button></div>'
        dialog.querySelector('button').addEventListener('click', () => dialog.remove())
        document.body.append(dialog)
      }
    })
  })
  await nativePage.emulateMedia({ reducedMotion: 'reduce' })
  const presented = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-cue', name: 'browser_present', input: { productRefs: [cart.result.products[0].ref] } } })
  assert.equal(presented.result.presentation.cue, 'shown')
  assert(presented.result.presentation.durationMs < 500)
  await nativePage.emulateMedia({ reducedMotion: 'no-preference' })
  assert.equal(await nativePage.locator('[data-webnavior-presentation]').count(), 1)
  assert.equal(await nativePage.evaluate(() => window.__fixtureCardClicks), 0)
  const openRequest = { kind: 'execute', request: { ...execute, operationId: 'fixture-open', name: 'browser_open_product', input: { name: 'Fixture meal' } } }
  const opened = await invoke(openRequest)
  assert.equal(opened.result.ok, true)
  assert.equal(opened.result.execution.steps[0].action, 'open-product')
  assert.equal(opened.result.execution.steps[0].state, 'completed')
  await invoke(openRequest)
  assert.equal(await nativePage.evaluate(() => window.__fixtureCardClicks), 1)
  await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-clear', name: 'browser_present', input: { productRefs: [] } } })
  const pendingCue = invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-interrupted-cue', name: 'browser_present', input: { productRefs: [cart.result.products[0].ref] } } })
  await nativePage.locator('[data-webnavior-presentation]').waitFor()
  await nativePage.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').click()
  assert.equal((await pendingCue).result.presentation.cue, 'cancelled')
  assert.equal(await nativePage.locator('[data-webnavior-presentation]').count(), 0)
  console.info('PASS: native product cue/hand never clicks; explicit open clicks once with deduplication; trusted touch cancels movement.')

  await nativePage.evaluate(() => {
    const menu = document.querySelector('main')
    const footer = document.createElement('div')
    footer.className = 'cursor-pointer'
    footer.textContent = '$10 去結算'
    document.body.append(footer)
    footer.addEventListener('click', () => {
      history.pushState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
      const cart = document.createElement('section')
      cart.className = 'order-create'
      cart.innerHTML = '<div class="produce-item"><h3>Fixture meal <span>($10)</span></h3><input type="number" value="1"><button class="is-circle">Delete line</button></div><a href="/order/store/1kgJeql/pick_up/menu">繼續點餐</a>'
      menu.replaceWith(cart)
      const returnToMenu = (event) => {
        event.preventDefault()
        history.pushState({}, '', '/order/store/1kgJeql/pick_up/menu')
        cart.replaceWith(menu)
        // Inertia route readiness can precede Vue's shared cart footer render.
        setTimeout(() => {
          document.querySelector('span.text-xl').remove()
          footer.remove()
        }, 150)
      }
      cart.querySelector('a').addEventListener('click', returnToMenu)
      cart.querySelector('button').addEventListener('click', async () => {
        await fetch('/order/store/1kgJeql/pick_up/orders/fixture-order/details/1', { method: 'DELETE' })
        // PB's last-line removal changes the navigation control as well as rows.
        cart.innerHTML = '<h2>購物車是空的</h2><button>立即點餐</button>'
        cart.querySelector('button').addEventListener('click', returnToMenu)
      })
    })
  })
  const freshCart = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-cart-after-touch', name: 'browser_cart_get', input: { includeCatalog: false } } })
  assert.notEqual(freshCart.result.cart.version, cart.result.cart.version)
  const catalogReads = await app.evaluate(() => globalThis.__pbFixtureCatalogReads)
  const removed = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-remove', name: 'browser_cart_remove', input: { version: freshCart.result.cart.version, lineRef: '1' } } })
  // A receipt for a removed line already owns its name/ref; rereading the full
  // menu just to decorate that receipt adds unrelated network work to a write.
  assert.equal(await app.evaluate(() => globalThis.__pbFixtureCatalogReads), catalogReads)
  assert.equal(removed.result.ok, true, JSON.stringify(removed.result))
  assert.deepEqual(removed.result.cart.lines, [])
  assert.equal(await nativePage.locator('span.text-xl').count(), 0)
  assert.equal(removed.result.displayUpdated, true)
  assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 1)
  assert.equal(removed.result.presentation.cue, 'shown')
  console.info('PASS: verified synthetic cart mutation refreshes the visible subtotal without replaying the write or replacing the service document.')
  const reset = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-customer-reset', name: 'browser_customer_reset', input: {} } })
  assert.equal(reset.result.status, 'customer-reset')
  assert.equal(reset.result.cartPreserved, true)
  assert.equal(await nativePage.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').inputValue(), '')
  console.info('PASS: queued customer reset excludes its own pending journal entry and preserves the cart.')
  assert.deepEqual(await invoke({ kind: 'execute', request: execute }), searched)
  const inspection = await invoke({ kind: 'inspect', request: { connectionId: discovery.connectionId, documentId: discovery.documentId, operationIds: ['fixture-search'] } })
  assert.equal(inspection.operations[0].status, 'settled')
  await assert.rejects(invoke({ kind: 'execute', request: { ...execute, input: { query: 'different payload' } } }))
  await assert.rejects(invoke({ kind: 'discover', request: { version: 1, connectionId: 'new', challenge: 'new' } }, { ...pbPlacement, documentKey: 'stale-document' }))
  const denied = await invoke({ kind: 'execute', request: { ...execute, operationId: 'arbitrary-code', name: 'evaluate', input: { code: 'document.title = "bad"' } } })
  assert.equal(denied.result.ok, false)
  console.info('PASS: native PB peer discovers bounded tools, performs visible search, deduplicates/inspects receipts, rejects stale ownership and arbitrary code; vendor main world has no host bridge or Node.')
  await nativePage.goto('https://app.esgpb.com/outside-menu')
  await assert.rejects(invoke({ kind: 'execute', request: { ...execute, operationId: 'after-navigation' } }))
  console.info('PASS: native navigation outside the approved menu revokes operation admission.')
  await host.evaluate(() => {
    location.href = '/admin'
  })
  await host.waitForTimeout(150)
  assert.equal(new URL(host.url()).pathname, '/kiosk/')
  console.info('PASS: privileged Kiosk cannot navigate to Admin.')
}
finally {
  await app?.close()
  if (serviceVideo)
    console.info('Synthetic PB video:', await serviceVideo.path())
  await new Promise(resolve => server.close(resolve))
  await rm(profile, { recursive: true, force: true })
}
