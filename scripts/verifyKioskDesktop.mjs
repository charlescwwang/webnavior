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
const loadingRequested = Promise.withResolvers()
let releaseLoadingPage
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  if (request.url.startsWith('/loading/')) {
    releaseLoadingPage = () => {
      // Both the assertion block and outer cleanup release a held response.
      if (!response.writableEnded)
        response.end('<!doctype html><h1>Loaded service</h1>')
    }
    loadingRequested.resolve()
    return
  }
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
  if (process.env.KIOSK_TEST_PORTRAIT === '1') {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1080, 1920))
    // A laptop display can clamp native window size. Portrait acceptance must
    // run on a sufficiently large virtual/physical display and assert content,
    // rather than confusing requested outer bounds with the actual viewport.
    await host.waitForFunction(() => innerWidth === 1080 && innerHeight === 1920)
    console.info('PASS: portrait Host content viewport is exactly 1080×1920.')
  }
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
  // User request (2026-11-11): the PB text console must float above native content.
  const openedConsole = await host.evaluate(() => {
    window.textConsolePopup = window.open('about:blank', 'airi-kiosk-text-console')
    return Boolean(window.textConsolePopup)
  })
  assert.equal(openedConsole, true, 'Trusted Kiosk must be able to open its owned floating text console.')
  const consolePage = app.windows().find(page => page !== host && page.url() === 'about:blank')
  assert(consolePage)
  await consolePage.waitForLoadState()
  // The normal-display fixture must not take the operator's keystrokes. A
  // portrait run uses its own virtual display, so keep its popup visible:
  // a hidden window there has no compositor frames for pointer stability.
  if (process.env.KIOSK_TEST_PORTRAIT !== '1')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getParentWindow()).hide())
  assert.equal(await consolePage.evaluate(() => typeof window.airiKioskDesktop), 'undefined')
  assert.equal(await consolePage.evaluate(() => typeof require), 'undefined')
  await host.evaluate(() => {
    const input = window.textConsolePopup.document.createElement('textarea')
    input.setAttribute('aria-label', 'Fixture input')
    const submit = window.textConsolePopup.document.createElement('button')
    submit.textContent = 'Submit fixture'
    window.consoleSubmissions = []
    submit.addEventListener('click', () => window.consoleSubmissions.push(input.value))
    window.textConsolePopup.document.body.append(input, submit)
  })
  await consolePage.getByRole('textbox', { name: 'Fixture input' }).fill('synthetic console input')
  await consolePage.getByRole('button', { name: 'Submit fixture' }).click()
  assert.deepEqual(await host.evaluate(() => window.consoleSubmissions), ['synthetic console input'])
  const consolePolicy = await app.evaluate(({ BrowserWindow }) => {
    const child = BrowserWindow.getAllWindows().find(window => window.getParentWindow())
    const parent = child.getParentWindow()
    const before = child.getBounds()
    child.setPosition(before.x + 30, before.y + 20)
    return { owned: parent.webContents.getURL().includes('/kiosk/'), moved: child.getBounds().x !== before.x, nativeVisible: parent.contentView.children.every(view => view.getVisible()) }
  })
  assert.equal(consolePolicy.owned, true)
  assert.equal(consolePolicy.moved, true)
  assert.equal(consolePolicy.nativeVisible, true)
  assert.equal(await consolePage.evaluate(() => Boolean(window.open('about:blank', 'nested-console'))), false)
  assert.equal(await site.evaluate(() => Boolean(window.open('about:blank', 'airi-kiosk-text-console'))), false)
  assert.equal(await host.evaluate(() => Boolean(window.open('https://attacker.example', 'unapproved-popup'))), false)
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.consoleNavigationAttempts = []
    const child = BrowserWindow.getAllWindows().find(window => window.getParentWindow())
    child.webContents.on('will-navigate', (_event, url) => globalThis.consoleNavigationAttempts.push(url))
  })
  // Reusing a named window returns its handle even when navigation is denied.
  await host.evaluate(() => {
    window.open('https://attacker.example', 'airi-kiosk-text-console')
  })
  await app.evaluate(async () => {
    for (let attempt = 0; attempt < 20 && globalThis.consoleNavigationAttempts.length === 0; attempt++)
      await new Promise(resolve => setTimeout(resolve, 25))
  })
  assert.deepEqual(await app.evaluate(() => globalThis.consoleNavigationAttempts), ['https://attacker.example/'])
  assert.equal(consolePage.url(), 'about:blank')
  const consoleClosed = consolePage.waitForEvent('close')
  await host.reload()
  await consoleClosed
  await host.waitForFunction(() => Boolean(window.airiKioskDesktop))
  await host.evaluate(input => window.airiKioskDesktop.updateSurface(input), request)
  console.info('PASS: owned floating console accepts real typing above the native site without a second ordering host or exposed desktop bridge.')
  // Report: this chat, 2026-11-14. Exercise OS clipboard in the disposable
  // desktop fixture, including an event handler created in the opener realm.
  await host.evaluate(() => {
    const copy = document.createElement('button')
    copy.textContent = 'Copy host fixture'
    copy.onclick = async () => {
      await navigator.clipboard.writeText('host-clipboard-fixture')
      copy.dataset.done = 'true'
    }
    document.body.append(copy)
  })
  await host.bringToFront()
  await host.getByRole('button', { name: 'Copy host fixture' }).click()
  await host.waitForFunction(() => document.querySelector('button').dataset.done === 'true')
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'host-clipboard-fixture')
  const popupCreated = app.waitForEvent('window')
  await host.evaluate(() => {
    const popup = window.open('about:blank', 'airi-kiosk-text-console')
    const button = popup.document.createElement('button')
    button.textContent = 'Copy popup fixture'
    button.onclick = async (event) => {
      await event.currentTarget.ownerDocument.defaultView.navigator.clipboard.writeText('popup-clipboard-fixture')
      button.dataset.done = 'true'
    }
    popup.document.body.append(button)
  })
  const popup = await popupCreated
  await popup.bringToFront()
  await popup.getByRole('button', { name: 'Copy popup fixture' }).click()
  await popup.waitForFunction(() => document.querySelector('button').dataset.done === 'true')
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'popup-clipboard-fixture')
  await popup.close()
  await host.bringToFront()
  await host.evaluate(() => {
    const text = document.createElement('textarea')
    text.setAttribute('aria-label', 'Clipboard keyboard fixture')
    text.value = 'keyboard-copy-fixture'
    document.body.append(text)
    text.focus()
    text.select()
  })
  await host.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c')
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'keyboard-copy-fixture')
  await host.getByRole('textbox', { name: 'Clipboard keyboard fixture' }).fill('')
  await host.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v')
  assert.equal(await host.getByRole('textbox', { name: 'Clipboard keyboard fixture' }).inputValue(), 'keyboard-copy-fixture')
  console.info('PASS: host/popup Copy writes OS clipboard and keyboard copy/paste round trips without Node in renderers.')

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
  // User report (2026-11-11): an unfinished native document covered the host
  // loading state with a blank View. Hold real HTTP, including a resize race.
  const loadingPlacement = { ...request, url: `${origin}/loading/`, documentKey: 'first:loading' }
  await host.evaluate((input) => {
    window.pendingPageLoad = window.airiKioskDesktop.updateSurface(input)
  }, loadingPlacement)
  await loadingRequested.promise
  try {
    const beforeLoad = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map(view => view.getVisible()))
    assert.deepEqual(beforeLoad, [true], 'Navigation must keep the native website visible without a Host loading cover.')
    await host.evaluate((input) => {
      window.pendingPageResize = window.airiKioskDesktop.updateSurface({ ...input, bounds: { ...input.bounds, width: 650 } })
    }, loadingPlacement)
    const duringResize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map(view => view.getVisible()))
    assert.deepEqual(duringResize, [true], 'Resize must preserve native visibility while loading.')
  }
  finally {
    releaseLoadingPage()
  }
  const loadedPlacement = await host.evaluate(() => window.pendingPageResize)
  assert.equal(loadedPlacement.state, 'visible')
  await host.evaluate(() => window.pendingPageLoad)
  await host.evaluate(input => window.airiKioskDesktop.updateSurface(input), request)
  console.info('PASS: a pending native document remains visible through navigation and resize without a Host loading cover.')
  // Synthetic PB-origin document: exercise the production isolated-world bundle
  // and preload RPC without authenticating or contacting a merchant endpoint.
  const pbUrl = 'https://app.esgpb.com/order/store/1kgJeql/pick_up/menu'
  const viewport = await host.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const pbPlacement = { ...request, bounds: { x: 20, y: 100, width: viewport.width - 40, height: viewport.height - 120 }, serviceId: 'pb-fixture', documentKey: 'pb-fixture:1', url: pbUrl }
  await app.evaluate(async ({ session }, { partition, url }) => {
    const base = new URL('.', url)
    globalThis.__pbFixtureCartPresent = true
    globalThis.__pbFixtureWrites = 0
    globalThis.__pbFixtureCatalogReads = 0
    globalThis.__pbFixtureCatalogSize = 1
    globalThis.__pbFixtureAuthenticated = true
    globalThis.__pbFixtureJsonPageReads = 0
    globalThis.__pbFixtureSnapshotFault = undefined
    const props = () => ({ storeHash: '1kgJeql', flowType: 'pick_up', auth: { user: globalThis.__pbFixtureAuthenticated ? { id: 'fixture' } : null }, subtotal: globalThis.__pbFixtureCartPresent ? 10 : 0, order: { hash: 'fixture-order', pick_up_date: '2026-11-01', pick_up_time: '12:00' }, details: globalThis.__pbFixtureCartPresent ? [{ id: 1, amount: 1, unit_price: 10, note: 'Fixture note', item_type: 'product', item: { id: 1, name: 'Fixture meal' }, product_prices: [{ item_type: 'product_price', item_id: 1, parent_id: null, product_attrs: [{ attr_id: 1, amount: 1, unit_price: 0, attr: { name: 'Fixture side' } }] }] }] : [], defaultPickUpDate: '2026-11-01', defaultPickUpTime: '12:00' })
    const routes = {
      'shopping.menu.categories': { uri: 'store/{store_hash}/{flow_type}/menu-categories', methods: ['GET', 'HEAD'], parameters: ['store_hash', 'flow_type'] },
      'shopping.getAttrByProduct': { uri: 'store/{store_hash}/{flow_type}/getAttrByProduct/{product}/{product_price?}', methods: ['GET', 'HEAD'], parameters: ['store_hash', 'flow_type', 'product', 'product_price'] },
      'shopping.orders.details.destroy': { uri: 'store/{store_hash}/{flow_type}/orders/{order}/details/{detail}', methods: ['DELETE'], parameters: ['store_hash', 'flow_type', 'order', 'detail'] },
    }
    const declaration = `const Ziggy=${JSON.stringify({ url: 'https://app.esgpb.com/order', routes })};throw new Error('Vendor code must not execute');`
    const html = () => `<!doctype html><script>${declaration}</script><div data-page='${JSON.stringify({ component: 'Menu/Show', url: new URL(url).pathname, version: 'fixture-assets', props: props() })}'></div><a title="回店家首頁" href="${url}">Fixture menu</a><input placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"><div class="menu-search-meta">共找到 1 項</div><main><button><h4>Fixture meal</h4>$10</button></main><span class="text-xl font-bold ms-2">$${props().subtotal}</span>`
    await session.fromPartition(partition).cookies.set({ url, name: 'XSRF-TOKEN', value: 'synthetic-test-token' })
    await session.fromPartition(partition).protocol.handle('https', async (request) => {
      const target = new URL(request.url)
      if (request.method === 'DELETE' && target.origin === base.origin && [`${base.pathname}orders/fixture-order/details/1`, `${base.pathname}orders/fixture-order/details/all`].includes(target.pathname)) {
        globalThis.__pbFixtureWrites++
        globalThis.__pbFixtureCartPresent = false
        return new Response(null, { status: 204 })
      }
      if (request.method !== 'GET' || target.origin !== base.origin)
        return new Response('Fixture blocks other writes and foreign requests.', { status: 404 })
      if ([new URL(url).pathname, `${base.pathname}orders/create`].includes(target.pathname) && request.headers.get('x-inertia') === 'true') {
        globalThis.__pbFixtureJsonPageReads++
        if (request.headers.get('x-inertia-version') !== 'fixture-assets' || globalThis.__pbFixtureSnapshotFault === 'version')
          return new Response(null, { status: 409 })
        const component = target.pathname.endsWith('/orders/create') ? 'Order/Create' : 'Menu/Show'
        const fields = request.headers.get('x-inertia-partial-data')?.split(',')
        if (request.headers.get('x-inertia-partial-component') !== component || !fields?.includes('auth') || !fields.includes('buyer') || !fields.includes('storeHash') || !fields.includes('flowType'))
          throw new Error('Snapshot must request the exact component and its ownership fields.')
        const page = { component, url: target.pathname + target.search, props: Object.fromEntries(Object.entries(props()).filter(([key]) => fields.includes(key))) }
        if (globalThis.__pbFixtureSnapshotFault === 'store')
          page.props.storeHash = 'other-store'
        if (globalThis.__pbFixtureSnapshotFault === 'url')
          page.url = '/order/store/other-store/pick_up/menu'
        if (globalThis.__pbFixtureSnapshotFault === 'component')
          page.component = 'Menu/SelectTable'
        return Response.json(page, { headers: { 'X-Inertia': 'true' } })
      }
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
        return Response.json({ categories: [{ id: 1, name: 'Fixture category', count: globalThis.__pbFixtureCatalogSize }] })
      }
      if (target.pathname === `${base.pathname}menu-category-items`)
        return Response.json({ products: Array.from({ length: globalThis.__pbFixtureCatalogSize }, (_, index) => ({ id: index + 1, name: index ? `Fixture option ${index}` : 'Fixture meal', price: 10 + index, price_type: 1 })), productGroups: [] })
      if (target.pathname === `${base.pathname}getAttrByProduct/1`)
        return Response.json({ 加購: [{ id: 774, name: 'Fixture rice', attr_group: { id: 256, required: false, amount: 1 }, attr_item: { price: 5 }, pivot: {} }] })
      if (/\/getAttrByProduct\/\d+$/.test(target.pathname))
        return Response.json({})
      return new Response('Fixture blocks all other requests.', { status: 404 })
    })
  }, { partition: `persist:service-${createHash('sha256').update(JSON.stringify([pbPlacement.serviceId, new URL(pbUrl).origin])).digest('hex')}`, url: pbUrl })
  await host.evaluate(input => window.airiKioskDesktop.updateSurface(input), pbPlacement)
  const invoke = (command, binding = pbPlacement) => host.evaluate(({ command, binding }) => window.airiKioskDesktop.invokeService({ serviceId: binding.serviceId, documentKey: binding.documentKey, command }), { command, binding })
  const discovery = await invoke({ kind: 'discover', request: { version: 1, connectionId: 'fixture-connection', challenge: 'fixture-challenge' } })
  assert.equal(discovery.challenge, 'fixture-challenge')
  assert(discovery.tools.some(tool => tool.name === 'browser_search'))
  const execute = { connectionId: discovery.connectionId, documentId: discovery.documentId, toolsRevision: discovery.toolsRevision, operationId: 'fixture-search', name: 'browser_search', input: { query: 'fixture query' } }
  const nativePage = app.context().pages().find(page => page.url() === pbUrl)
  assert(nativePage)
  await nativePage.evaluate(() => {
    document.querySelector('input[placeholder]').addEventListener('input', (event) => {
      if (!event.target.value.trim())
        return
      setTimeout(() => {
        document.querySelector('.menu-search-meta').textContent = '搜尋中...'
        setTimeout(() => document.querySelector('.menu-search-meta').textContent = `共找到 ${document.querySelectorAll('main h4').length} 項`, 25)
      }, 250)
    })
  })
  const searched = await invoke({ kind: 'execute', request: execute })
  assert.equal(searched.result.search, 'fixture query')
  serviceVideo = nativePage.video()
  console.info('PB fixture viewport:', await nativePage.evaluate(() => ({ width: innerWidth, height: innerHeight })))
  assert.equal(await nativePage.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').inputValue(), 'fixture query')
  assert.equal(await nativePage.evaluate(() => typeof globalThis.__webnaviorPbService), 'undefined')
  assert.equal(await nativePage.evaluate(() => typeof window.airiKioskDesktop), 'undefined')
  assert.equal(await nativePage.evaluate(() => typeof window.route), 'undefined')
  // Report: this chat, Nov11; a missing PB login became a generic tool rejection.
  await app.evaluate(() => globalThis.__pbFixtureAuthenticated = false)
  try {
    const signIn = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-sign-in-required', name: 'browser_observe', input: { includeDescriptions: true, purpose: 'information' } } })
    assert.equal(signIn.result.ok, false)
    assert.equal(signIn.result.code, 'sign-in-required')
    assert.equal(signIn.result.effect, 'none')
    assert.equal(signIn.result.status, 'rejected')
    assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 0)
  }
  finally {
    await app.evaluate(() => globalThis.__pbFixtureAuthenticated = true)
  }
  console.info('PASS: missing vendor login returns a typed sign-in requirement without a cart write; subsequent authenticated reads remain available.')
  const cart = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-catalog', name: 'browser_cart_get', input: { includeCatalog: true } } })
  assert.equal(cart.result.ok, true)
  assert.equal(cart.result.cart.lines[0].name, 'Fixture meal')
  assert.deepEqual(cart.result.cart.lines[0].options, [{ name: 'Fixture side', quantity: 1 }])
  assert.equal(cart.result.products[0].name, 'Fixture meal')
  // Report: this chat, Nov12; recommendations repeatedly fetched whole HTML
  // pages and hit the 8s timeout before presentation. Snapshot reads must use
  // the vendor's versioned JSON protocol instead of downloading dev assets.
  assert(await app.evaluate(() => globalThis.__pbFixtureJsonPageReads >= 2))
  console.info('PASS: isolated PB catalog/cart reads use declared route data without a vendor main-world helper.')
  // Report: this chat, Nov14 full Host audit; an off-screen passive cue was
  // reported without effect/status and became an unknown-operation warning.
  await nativePage.evaluate(() => document.querySelector('main button').style.cssText = 'position:fixed;top:-10000px;left:0')
  try {
    const failedCue = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-known-visual-failure', name: 'browser_present', input: { productRefs: [cart.result.products[0].ref], mode: 'information' } } })
    assert.equal(failedCue.result.ok, false)
    assert.equal(failedCue.result.status, 'rejected')
    assert.equal(failedCue.result.effect, 'none')
    const followingRead = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-read-after-visual-failure', name: 'browser_cart_get', input: { includeCatalog: false } } })
    assert.equal(followingRead.result.ok, true)
    assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 0)
  }
  finally {
    await nativePage.evaluate(() => document.querySelector('main button').removeAttribute('style'))
  }
  console.info('PASS: a passive presentation failure has a known no-cart-effect receipt and does not poison following reads.')
  for (const fault of ['version', 'store', 'url', 'component']) {
    await app.evaluate((_electron, value) => globalThis.__pbFixtureSnapshotFault = value, fault)
    try {
      const rejected = await invoke({ kind: 'execute', request: { ...execute, operationId: `snapshot-${fault}`, name: 'browser_cart_get', input: { includeCatalog: false } } })
      assert.equal(rejected.result.ok, false, JSON.stringify({ fault, result: rejected.result }))
      assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 0)
      if (fault === 'version')
        assert.match(rejected.result.error, /頁面已更新/)
    }
    finally { await app.evaluate(() => globalThis.__pbFixtureSnapshotFault = undefined) }
  }
  console.info('PASS: versioned partial JSON reads reject asset updates and mismatched store, URL or component without using stale DOM/cart facts.')

  // Report: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov2 S01/S11.
  // Read-back must retain the vendor's configuration labels, just as write receipts do.
  const readBack = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-cart-readback', name: 'browser_cart_get', input: { includeCatalog: false } } })
  assert.match(readBack.result.customerMessage, /Fixture side 每份 1 個/)
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

  // Report: this chat, Nov11; Main presented ten dishes on 還有嗎 and then requested thirteen.
  await app.evaluate(() => globalThis.__pbFixtureCatalogSize = 13)
  await nativePage.evaluate(() => {
    const search = document.querySelector('input[placeholder]')
    search.value = 'Fixture meal'
    // Model a vendor render that finishes after the input value changes. A
    // value-only acknowledgement must not claim these other cards are shown.
    window.__fixtureSearchRender = () => {
      setTimeout(() => {
        const count = window.__fixtureIncompleteMenu ? 1 : 13
        document.querySelector('main').innerHTML = Array.from({ length: count }, (_, index) => `<button><h4>${index ? `Fixture option ${index}` : 'Fixture meal'}</h4>$${10 + index}</button>`).join('')
      }, 250)
    }
    search.addEventListener('input', window.__fixtureSearchRender)
  })
  try {
    const all = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-full-menu-for-recommendations', name: 'browser_observe', input: { includeDescriptions: false, purpose: 'information' } } })
    assert.equal(all.result.products.length, 13)
    const refs = all.result.products.map(product => product.ref)
    // Report: this chat, 2026-11-14 — only the first recommendation was framed
    // while its floating label contained all three dish names.
    await nativePage.evaluate(() => {
      window.__shownDishBatches = []
      window.__dishObserver = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof HTMLElement && node.dataset.webnaviorPresentation && node.dataset.productNames) {
              if (JSON.parse(node.dataset.productNames).length)
                window.__shownDishBatches.push(JSON.parse(node.dataset.productNames))
            }
          }
        }
      })
      window.__dishObserver.observe(document.documentElement, { childList: true })
    })
    const prepared = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-prepare-before-reply', name: 'browser_present', input: { productRefs: refs, deferVisual: true } } })
    assert.equal(prepared.result.presentation.cue, 'prepared')
    assert.deepEqual(await nativePage.evaluate(() => window.__shownDishBatches), [])
    const small = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-small-recommendations', name: 'browser_present', input: { productRefs: refs } } })
    assert.deepEqual(await nativePage.evaluate(() => window.__shownDishBatches), [['Fixture meal'], ['Fixture option 1'], ['Fixture option 2']])
    await nativePage.evaluate(() => window.__dishObserver.disconnect())
    assert.equal(small.result.ok, true)
    assert.equal(small.result.presentation.products.length, 3)
    assert.equal(small.result.selectionTruncated, true)
    assert.equal(small.result.presentationLimit, 3)
    assert.equal(await nativePage.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').inputValue(), '')
    assert.equal(await nativePage.locator('main h4').count(), 13)
    assert.equal(small.result.presentation.cue, 'shown')
    assert.deepEqual(small.result.presentation.products.map(product => product.name), ['Fixture meal', 'Fixture option 1', 'Fixture option 2'])
    const invalid = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-invalid-fourth-ref', name: 'browser_present', input: { productRefs: [...refs.slice(0, 3), 'missing-ref'] } } })
    assert.equal(invalid.result.dataOnly, true)
    assert.deepEqual(invalid.result.unresolvedProductRefs, ['missing-ref'])
    assert.deepEqual(invalid.result.presentation.products, [])
    const oversizedComparison = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-no-truncated-comparison', name: 'browser_present', input: { productRefs: refs, mode: 'information' } } })
    assert.equal(oversizedComparison.result.dataOnly, true)
    assert.equal(oversizedComparison.result.status, 'proposal_rejected')
    const compared = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-explicit-five-product-comparison', name: 'browser_present', input: { productRefs: refs.slice(0, 5), mode: 'information' } } })
    assert.equal(compared.result.presentation.products.length, 5)
    await nativePage.evaluate(() => {
      document.querySelector('input[placeholder]').value = 'Fixture meal'
      document.querySelector('main').innerHTML = '<button><h4>Fixture meal</h4>$10</button>'
    })
    const cleared = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-reject-recommendations-show-all', name: 'browser_search', input: { query: '' } } })
    assert.equal(cleared.result.ok, true)
    assert.equal(cleared.result.products.length, 13)
    assert.equal(cleared.result.search, '')
    assert.match(cleared.result.customerMessage, /已清除搜尋.*完整菜單/)
    assert.doesNotMatch(cleared.result.customerMessage, /Fixture option/)
    await nativePage.evaluate(() => document.querySelector('input[placeholder]').value = 'abandoned-search')
    const returned = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-return-from-filtered-menu', name: 'browser_return_menu', input: {} } })
    assert.equal(returned.result.ok, true, JSON.stringify(returned.result))
    assert.equal(await nativePage.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').inputValue(), '')
    assert.match(returned.result.customerMessage, /已清除搜尋/)
    assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 0)

    // Report: this chat, Nov11; a valid first card hid missing later subjects.
    await nativePage.evaluate(() => {
      window.__fixtureIncompleteMenu = true
      document.querySelector('main').innerHTML = '<button><h4>Fixture meal</h4>$10</button>'
    })
    const unavailable = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-partially-missing-screen', name: 'browser_present', input: { productRefs: [refs[0], refs[12]], mode: 'information' } } })
    assert.equal(unavailable.result.ok, false)
    assert.equal(unavailable.result.effect, 'none')
    assert.equal(unavailable.result.presentation?.products?.length ?? 0, 0)
    assert.doesNotMatch(unavailable.result.customerMessage ?? '', /目前查到/)
    assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 0)
  }
  finally {
    await app.evaluate(() => globalThis.__pbFixtureCatalogSize = 1)
    await nativePage.evaluate(() => {
      document.querySelector('input[placeholder]').removeEventListener('input', window.__fixtureSearchRender)
      delete window.__fixtureSearchRender
      delete window.__fixtureIncompleteMenu
      document.querySelector('main').innerHTML = '<button><h4>Fixture meal</h4>$10</button>'
    })
  }
  console.info('PASS: stale search is cleared and all spoken subjects await rendered cards; incomplete screen cannot produce a success receipt; recommendations stay at three and comparisons retain five; no cart writes.')

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
  // This cancellation case has an already empty cart; the nonempty native
  // clear is exercised separately below, after the existing line-edit fixture.
  await app.evaluate(() => globalThis.__pbFixtureCartPresent = false)
  const resetCue = invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-reset-cue', name: 'browser_present', input: { productRefs: [cart.result.products[0].ref] } } })
  await nativePage.waitForFunction(previous => document.querySelector('[data-webnavior-presentation]') && document.querySelector('[data-webnavior-presentation]') !== previous, beforeResetCue)
  const immediateReset = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-reset-during-cue', name: 'browser_customer_reset', input: {} } })
  await resetCue
  assert.equal(immediateReset.result.status, 'customer-reset', JSON.stringify(immediateReset.result))
  assert.equal(immediateReset.result.cartCleared, true)
  assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 0)
  await app.evaluate(() => globalThis.__pbFixtureCartPresent = true)
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
  // Report: this chat, Nov14; Jev expected the dish name but cart_get only
  // supplied a boolean. Exercise the original native producer, not a fake receipt.
  const openContext = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-open-dialog-context', name: 'browser_cart_get', input: { includeCatalog: true } } })
  assert.equal(openContext.result.itemSelectionOpen, true)
  assert.deepEqual(openContext.result.productDialog, [{ name: 'Fixture meal' }])
  await invoke(openRequest)
  assert.equal(await nativePage.evaluate(() => window.__fixtureCardClicks), 1)
  await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-clear', name: 'browser_present', input: { productRefs: [] } } })
  const pendingCue = invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-interrupted-cue', name: 'browser_present', input: { productRefs: [cart.result.products[0].ref] } } })
  await nativePage.locator('[data-webnavior-presentation]').waitFor()
  await nativePage.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').click()
  assert.equal(await nativePage.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').evaluate(element => document.activeElement === element), false)
  assert.equal((await pendingCue).result.presentation.cue, 'shown')
  // Introduction input is locked only until the batch finishes. A subsequent
  // touch resumes normal manual control and retires the remaining frame.
  await nativePage.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').click()
  assert.equal(await nativePage.locator('[data-webnavior-presentation]').count(), 0)
  console.info('PASS: native introduction locks trusted touch until settled; explicit open clicks once with deduplication; manual control resumes afterward.')

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
      cart.innerHTML = '<div class="produce-item"><h3>Fixture meal <span>($10)</span></h3><input type="number" min="0" value="1"></div><a href="/order/store/1kgJeql/pick_up/menu">繼續點餐</a>'
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
      // PB's reviewed native quantity contract removes a line at zero. The
      // fixture must implement that input event, rather than an unused delete
      // button, or verification waits forever for a write the fixture ignored.
      cart.querySelector('input').addEventListener('change', async (event) => {
        if (event.target.value !== '0')
          return
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
  assert.equal(reset.result.cartCleared, true)
  assert.equal(await nativePage.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').inputValue(), '')
  console.info('PASS: queued customer reset excludes its own journal entry and verifies the already empty cart.')
  // Report: this chat, Nov11; every ended PB reception must clear unsubmitted rows.
  await app.evaluate(() => globalThis.__pbFixtureCartPresent = true)
  await nativePage.evaluate(() => {
    const menu = document.querySelector('main')
    const cart = document.createElement('section')
    cart.className = 'order-create'
    cart.innerHTML = '<button>清空</button><div class="produce-item">Fixture meal</div>'
    menu.replaceWith(cart)
    history.pushState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
    window.__fixtureClearClicks = 0
    cart.querySelector('button').addEventListener('click', async () => {
      window.__fixtureClearClicks++
      window.__fixtureCoveredAtClear = Boolean(document.querySelector('[data-webnavior-maintenance]'))
      window.__fixtureHandAtClear = Boolean(document.querySelector('[data-webnavior-presentation]'))
      await new Promise(resolve => window.__fixtureFinishClear = resolve)
      await fetch('/order/store/1kgJeql/pick_up/orders/fixture-order/details/all', { method: 'DELETE' })
      cart.innerHTML = '<h2>購物車是空的</h2><button>立即點餐</button>'
      cart.querySelector('button').addEventListener('click', () => {
        window.__fixtureCoveredAtReturn = Boolean(document.querySelector('[data-webnavior-maintenance]'))
        history.pushState({}, '', '/order/store/1kgJeql/pick_up/menu')
        cart.replaceWith(menu)
      })
    })
  })
  const clearRequest = { kind: 'execute', request: { ...execute, operationId: 'fixture-end-clears-unfinished-cart', name: 'browser_customer_reset', input: {} } }
  const clearing = invoke(clearRequest)
  await nativePage.waitForFunction(() => typeof window.__fixtureFinishClear === 'function')
  assert.equal(await nativePage.evaluate(() => window.__fixtureCoveredAtClear), false)
  assert.equal(await nativePage.evaluate(() => window.__fixtureHandAtClear), false)
  // No maintenance overlay or input trap may hide PB's actual clear control.
  assert.equal(await nativePage.getByRole('button', { name: '清空', exact: true }).evaluate((button) => {
    const bounds = button.getBoundingClientRect()
    return document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) === button
  }), true)
  assert.equal(await nativePage.evaluate(() => window.__fixtureClearClicks), 1)
  await nativePage.evaluate(() => window.__fixtureFinishClear())
  const cleared = await clearing
  assert.equal(cleared.result.cartCleared, true, JSON.stringify(cleared.result))
  assert.equal(cleared.result.status, 'customer-reset')
  assert.equal(await nativePage.evaluate(() => window.__fixtureClearClicks), 1)
  assert.equal(await app.evaluate(() => globalThis.__pbFixtureCartPresent), false)
  assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 2)
  assert.equal(await nativePage.locator('.order-create').count(), 0)
  assert.equal(await nativePage.evaluate(() => window.__fixtureCoveredAtReturn), false)
  assert.equal(await nativePage.locator('[data-webnavior-maintenance]').count(), 0)
  assert.equal(await nativePage.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').inputValue(), '')
  assert.deepEqual(await invoke(clearRequest), cleared)
  assert.equal(await nativePage.evaluate(() => window.__fixtureClearClicks), 1)
  console.info('PASS: ending reception exposes native controls without a maintenance cover, clears once, verifies empty and returns to menu; replay is deduplicated and login/document retained.')
  assert.deepEqual(await invoke({ kind: 'execute', request: execute }), searched)
  const inspection = await invoke({ kind: 'inspect', request: { connectionId: discovery.connectionId, documentId: discovery.documentId, operationIds: ['fixture-search'] } })
  assert.equal(inspection.operations[0].status, 'settled')
  await assert.rejects(invoke({ kind: 'execute', request: { ...execute, input: { query: 'different payload' } } }))
  await assert.rejects(invoke({ kind: 'discover', request: { version: 1, connectionId: 'new', challenge: 'new' } }, { ...pbPlacement, documentKey: 'stale-document' }))
  const denied = await invoke({ kind: 'execute', request: { ...execute, operationId: 'arbitrary-code', name: 'evaluate', input: { code: 'document.title = "bad"' } } })
  assert.equal(denied.result.ok, false)
  console.info('PASS: native PB peer discovers bounded tools, performs visible search, deduplicates/inspects receipts, rejects stale ownership and arbitrary code; vendor main world has no host bridge or Node.')
  // Report: this chat, Nov19 — a previous visitor's warning must not remain
  // a store-wide lock after an explicit, verified reset of the editable cart.
  const resetMarkerKey = 'webnavior:pb:cart-pending:/order/store/1kgJeql/pick_up/'
  await nativePage.evaluate(key => localStorage.setItem(key, 'order:11111111-1111-4111-8111-111111111111'), resetMarkerKey)
  const beforeRestart = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-previous-order-context', name: 'browser_recovery_context', input: {} } })
  assert.equal(beforeRestart.result.canRetry, false)
  assert.equal(beforeRestart.result.canReset, true)
  const retired = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-retire-previous-order', name: 'browser_customer_reset', input: {} } })
  assert.equal(retired.result.ok, true)
  assert.equal(retired.result.retiredOperation, 'order', 'Host records this on the ending visitor, never as new visitor authority.')
  assert.equal(retired.result.cartCleared, true)
  assert.equal(await nativePage.evaluate(key => localStorage.getItem(key), resetMarkerKey), null)
  assert.equal(await app.evaluate(() => globalThis.__pbFixtureWrites), 2, 'An already empty cart needs no further merchant write.')
  const afterRestart = await invoke({ kind: 'execute', request: { ...execute, operationId: 'fixture-new-order-context', name: 'browser_recovery_context', input: {} } })
  assert.equal(afterRestart.result.canRetry, true)
  assert.equal(afterRestart.result.blockedBy, undefined)
  console.info('PASS: explicit reset retires the previous order warning for audit, verifies the current draft empty, and admits the next visitor without replaying any merchant write.')
  await nativePage.goto('https://app.esgpb.com/outside-menu')
  await assert.rejects(invoke({ kind: 'execute', request: { ...execute, operationId: 'after-navigation' } }))
  console.info('PASS: native navigation outside the approved menu revokes operation admission.')

  // New RD guest/table contract, still entirely synthetic: this partition
  // intercepts every HTTPS request and never contacts the merchant.
  const guestUrl = 'https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table'
  const guestPlacement = { ...pbPlacement, serviceId: 'pb-guest-fixture', documentKey: 'pb-guest-fixture:1', url: guestUrl }
  await host.evaluate(() => {
    window.__nativeNavigations = []
    window.airiKioskDesktop.onNavigation(value => window.__nativeNavigations.push(value))
  })
  await app.evaluate(async ({ session }, { partition, url }) => {
    const base = new URL('../', url)
    globalThis.__pbGuestFixtureWrites = 0
    globalThis.__pbGuestTableRequests = 0
    globalThis.__pbGuestMenuRequested = Promise.withResolvers()
    const props = () => ({ storeHash: '1kgJeql', flowType: 'internal_use', auth: { user: null }, buyer: { type: 'cookie' }, diningTables: [{ name: '櫃台取餐', qr_token: 'private-fixture-counter' }, { name: 'A1 桌', qr_token: 'private-fixture-a1' }], diningTable: 'A1 桌', subtotal: 40, order: { hash: 'guest-fixture-order', pick_up_date: '2026-11-12', pick_up_time: '11:00' }, details: [{ id: 2, amount: 1, unit_price: 40, note: '', item_type: 'product', item: { id: 2, name: '蛋花湯' }, product_prices: [{ item_type: 'product_price', item_id: 2, parent_id: null, product_attrs: [] }] }] })
    await session.fromPartition(partition).protocol.handle('https', async (request) => {
      const target = new URL(request.url)
      if (request.method !== 'GET' || target.origin !== base.origin) {
        globalThis.__pbGuestFixtureWrites++
        return new Response('Guest fixture rejects all writes and foreign requests.', { status: 404 })
      }
      if (target.pathname === '/order/t/private-fixture-a1')
        return new Response(null, { status: 302, headers: { location: `${base.pathname}menu` } })
      const table = target.pathname.endsWith('/select-table')
      if (request.headers.get('x-inertia') === 'true') {
        if (request.headers.get('x-inertia-version') !== 'fixture-assets')
          throw new Error('Guest snapshot requires its current document asset version.')
        const fields = request.headers.get('x-inertia-partial-data').split(',')
        return Response.json({ component: target.pathname.endsWith('/orders/create') ? 'Order/Create' : 'Menu/Show', url: target.pathname + target.search, props: Object.fromEntries(Object.entries(props()).filter(([key]) => fields.includes(key))) }, { headers: { 'X-Inertia': 'true' } })
      }
      // Report: this chat; "我要櫃台取餐" failed before Jev because table context
      // fetched the already rendered page again and timed out. Reads must use
      // this document's correlated table metadata, then verify native controls.
      if (table && ++globalThis.__pbGuestTableRequests > 1)
        return new Response('Repeated table page reads are unavailable.', { status: 503 })
      // The real RD menu took over eight seconds after Start. Its successful
      // navigation must survive that delay without replay or a false rejection.
      if (target.pathname === `${base.pathname}menu`) {
        globalThis.__pbGuestMenuLoading = true
        globalThis.__pbGuestMenuRequested.resolve(true)
        await new Promise(resolve => setTimeout(resolve, 9000))
        globalThis.__pbGuestMenuLoading = false
      }
      const content = table
        ? '<div class="table-row__select"><input role="combobox" aria-controls="table-list" aria-expanded="false" readonly><div class="el-select__placeholder">櫃台取餐</div></div><button id="start-order">開始點餐</button>'
        : target.pathname.endsWith('/orders/create')
          ? '<form class="order-create"><label class="el-radio"><input type="radio" value="3" checked>手機載具<input placeholder="請輸入共8碼編號"></label><input id="notification-phone" type="email"><input id="notification-email" type="email"><button>送出訂單</button></form>'
          : '<input placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"><main><button><h4>蛋花湯</h4>$40</button></main>'
      return new Response(`<!doctype html><div data-page='${JSON.stringify({ component: table ? 'Menu/SelectTable' : 'Menu/Show', url: target.pathname, version: 'fixture-assets', props: props() })}'></div>${content}`, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': 'script-src \'none\'' } })
    })
  }, { partition: `persist:service-${createHash('sha256').update(JSON.stringify([guestPlacement.serviceId, new URL(guestUrl).origin])).digest('hex')}`, url: guestUrl })
  await host.evaluate(input => window.airiKioskDesktop.updateSurface(input), guestPlacement)
  const guestPage = app.context().pages().find(page => page.url() === guestUrl)
  assert(guestPage)
  await guestPage.evaluate(() => {
    const control = document.querySelector('[role=combobox]')
    control.addEventListener('click', () => {
      control.setAttribute('aria-expanded', 'true')
      const list = document.createElement('ul')
      list.id = 'table-list'
      for (const name of ['櫃台取餐', 'A1 桌']) {
        const option = document.createElement('li')
        option.setAttribute('role', 'option')
        option.textContent = name
        option.addEventListener('click', () => {
          document.querySelector('.el-select__placeholder').textContent = name
          control.setAttribute('aria-expanded', 'false')
          list.remove()
        })
        list.append(option)
      }
      document.body.append(list)
    })
    document.querySelector('#start-order').addEventListener('click', () => {
      location.href = '/order/t/private-fixture-a1'
    })
  })
  let guestDiscovery = await invoke({ kind: 'discover', request: { version: 1, connectionId: 'guest-connection', challenge: 'guest-challenge' } }, guestPlacement)
  let guestOperation = 0
  const guestExecute = (name, input) => invoke({ kind: 'execute', request: { connectionId: guestDiscovery.connectionId, documentId: guestDiscovery.documentId, toolsRevision: guestDiscovery.toolsRevision, operationId: `guest-operation-${++guestOperation}`, name, input } }, guestPlacement)
  const tableContext = await guestExecute('browser_cart_get', { includeCatalog: true })
  assert.equal(tableContext.result.code, 'table-selection-required')
  assert.equal(tableContext.result.cart, undefined)
  assert.equal(tableContext.result.selectedTable, '櫃台取餐')
  assert.deepEqual(tableContext.result.tableChoices, ['櫃台取餐', 'A1 桌'])
  assert.equal(await app.evaluate(() => globalThis.__pbGuestTableRequests), 1)
  assert(!JSON.stringify(tableContext).includes('private-fixture'))
  for (const change of [{ component: 'Menu/Index' }, { url: '/order/store/1kgJeql/internal_use/menu' }]) {
    const original = await guestPage.locator('[data-page]').getAttribute('data-page')
    await guestPage.locator('[data-page]').evaluate((element, change) => {
      element.setAttribute('data-page', JSON.stringify({ ...JSON.parse(element.getAttribute('data-page')), ...change }))
    }, change)
    const staleContext = await guestExecute('browser_cart_get', { includeCatalog: false })
    assert.equal(staleContext.result.ok, false)
    assert.equal(staleContext.result.tableChoices, undefined)
    await guestPage.locator('[data-page]').evaluate((element, original) => element.setAttribute('data-page', original), original)
  }
  await guestPage.getByRole('button', { name: 'A1 桌', exact: true }).waitFor()
  const counterSelected = await guestExecute('browser_table_select', { name: '櫃台取餐' })
  assert.equal(counterSelected.result.selectedTable, '櫃台取餐')
  const tableSelected = await guestExecute('browser_table_select', { name: 'A1 桌' })
  assert.equal(tableSelected.result.selectedTable, 'A1 桌')
  assert.equal(guestPage.url(), guestUrl)
  const afterSelection = await guestExecute('browser_cart_get', { includeCatalog: false })
  assert.equal(afterSelection.result.selectedTable, 'A1 桌')
  const oldGuestDocument = guestDiscovery.documentId
  const startResult = await guestExecute('browser_start_ordering', { name: 'A1 桌' })
  assert.equal(startResult.result.code, 'table-entry-starting')
  await app.evaluate(() => globalThis.__pbGuestMenuRequested.promise)
  assert.equal(await app.evaluate(() => globalThis.__pbGuestMenuLoading), true)
  const loadingUpdate = await host.evaluate(input => window.airiKioskDesktop.updateSurface({ ...input, bounds: { ...input.bounds, width: 650 } }), guestPlacement)
  assert.equal(loadingUpdate.state, 'loading', 'Placement must not mark the navigating menu ready.')
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map(view => view.getVisible())), [true])

  await guestPage.waitForURL(guestUrl.replace('/select-table', ''))
  await host.waitForFunction(() => window.__nativeNavigations.filter(value => value.serviceId === 'pb-guest-fixture' && value.state === 'ready').length >= 2)
  guestDiscovery = await invoke({ kind: 'discover', request: { version: 1, connectionId: 'guest-connection-after-start', challenge: 'guest-after-start' } }, guestPlacement)
  assert.notEqual(guestDiscovery.documentId, oldGuestDocument)
  const guestCart = await guestExecute('browser_cart_get', { includeCatalog: false })
  assert.equal(guestCart.result.ok, true)
  assert.equal(guestCart.result.cart.tableName, 'A1 桌')
  assert.equal(guestCart.result.menuReady, true)
  await guestPage.locator('main').evaluate(element => element.replaceChildren())
  const blankMenu = await guestExecute('browser_cart_get', { includeCatalog: false })
  assert.equal(blankMenu.result.ok, true)
  assert.equal(blankMenu.result.menuReady, false, 'A discovered document with no menu cards is not menu ready.')
  assert.equal(guestCart.result.cart.lines[0].name, '蛋花湯')
  console.info('PASS: guest counter/table selection uses the current document without HTTP re-fetch, rejects stale component/URL metadata, and Start reconnects after navigation with the selected table/cart and no login.')

  const invoiceRevision = await host.evaluate(() => Math.max(...window.__nativeNavigations.filter(value => value.serviceId === 'pb-guest-fixture').map(value => value.revision)))
  // Report: this chat, Nov19 01:27 — an earlier submission marker blocked a
  // fresh add before dispatch, but its receipt claimed this add was unknown.
  // Only this isolated fixture owns this synthetic marker; production barriers
  // must be reconciled against the original order, never deleted as a retry.
  const markerKey = 'webnavior:pb:cart-pending:/order/store/1kgJeql/internal_use/'
  const priorMarker = 'order:11111111-1111-4111-8111-111111111111'
  await guestPage.evaluate(({ key, marker }) => localStorage.setItem(key, marker), { key: markerKey, marker: priorMarker })
  try {
    const { result: refused } = await guestExecute('browser_cart_add', {})
    assert.equal(refused.ok, false)
    assert.equal(refused.status, 'rejected')
    assert.equal(refused.effect, 'none')
    assert.equal(refused.code, 'previous-operation-unconfirmed')
    assert.equal(refused.blockedBy, 'order')
    assert.equal(refused.execution.steps.length, 0)
    assert.equal(await guestPage.evaluate(key => localStorage.getItem(key), markerKey), priorMarker)
    // This guest fixture intentionally omits full pickup/catalog metadata.
    // The complete fixture above verifies recovery and explicit reset; here
    // only the pre-dispatch refusal and retained marker are under test.
    assert.equal(await app.evaluate(() => globalThis.__pbGuestFixtureWrites), 0)
  }
  finally { await guestPage.evaluate(key => localStorage.removeItem(key), markerKey) }
  console.info('PASS: an earlier order barrier rejects a new add with no effect and remains blocked without any write or automatic marker removal.')
  await guestPage.goto(guestUrl.replace('/menu/select-table', '/orders/create'))
  await host.waitForFunction(revision => window.__nativeNavigations.some(value => value.serviceId === 'pb-guest-fixture' && value.revision > revision && value.state === 'ready'), invoiceRevision)
  guestDiscovery = await invoke({ kind: 'discover', request: { version: 1, connectionId: 'guest-invoice', challenge: 'guest-invoice' } }, guestPlacement)
  await guestPage.evaluate(() => {
    window.__guestSubmissions = 0
    document.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault()
      window.__guestSubmissions++
    })
  })
  const carrier = guestPage.getByPlaceholder('請輸入共8碼編號')
  await carrier.pressSequentially('/ab12345')
  await carrier.press('Enter')
  assert.equal(await carrier.inputValue(), '/AB12345')
  assert.equal(await guestPage.evaluate(() => window.__guestSubmissions), 0)
  assert.equal(await guestPage.locator('#notification-phone').inputValue(), '')
  assert.equal(await guestPage.locator('#notification-email').inputValue(), '')
  assert.equal(await app.evaluate(() => globalThis.__pbGuestFixtureWrites), 0)
  console.info('PASS: real keyboard scanner input is normalized only in the selected carrier field; Enter cannot submit, notification fields stay untouched and no merchant write occurs.')

  // Report: Nov14 real Host idle reset; a renderer exit must not leave loading forever.
  await app.evaluate(({ webContents }, url) => {
    const targets = webContents.getAllWebContents().filter(contents => contents.getURL() === url)
    if (targets.length !== 1)
      throw new Error('Expected one owned guest fixture before the crash check.')
    targets[0].forcefullyCrashRenderer()
  }, guestPage.url())
  await host.waitForFunction(() => window.__nativeNavigations.some(value => value.serviceId === 'pb-guest-fixture' && value.state === 'failed'), undefined, { timeout: 2000 })
  await assert.rejects(guestExecute('browser_cart_get', { includeCatalog: false }))
  assert.equal(await app.evaluate(() => globalThis.__pbGuestFixtureWrites), 0)
  console.info('PASS: native renderer exit publishes failure and rejects further tools without replaying merchant writes.')

  await host.evaluate(() => {
    location.href = '/admin'
  })
  await host.waitForTimeout(150)
  assert.equal(new URL(host.url()).pathname, '/kiosk/')
  console.info('PASS: privileged Kiosk cannot navigate to Admin.')
}
finally {
  releaseLoadingPage?.()
  await app?.close()
  if (serviceVideo)
    console.info('Synthetic PB video:', await serviceVideo.path())
  await new Promise(resolve => server.close(resolve))
  await rm(profile, { recursive: true, force: true })
}
