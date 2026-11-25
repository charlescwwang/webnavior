import assert from 'node:assert/strict'
import process from 'node:process'

import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { _electron as electron } from 'playwright'

import { buildPaymentReturnFixture } from '../apps/stage-kiosk/scripts/buildPaymentReturnFixture.mjs'

// Every HTTPS request, including redirects, is served inside this isolated
// partition. No merchant, payment provider, real order or charge is contacted.
const runtime = process.env.ESGPB_ELECTRON_PATH
assert(runtime, 'Set ESGPB_ELECTRON_PATH to the inspected Electron runtime.')
const profile = await mkdtemp(resolve(tmpdir(), 'kiosk-payment-fixture-'))
const hostScript = await buildPaymentReturnFixture()
const server = createServer((request, response) => {
  if (request.url === '/kiosk/fixture.js') {
    response.setHeader('content-type', 'application/javascript; charset=utf-8')
    response.end(hostScript)
    return
  }
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.end('<!doctype html><div id="fixture"></div><script src="/kiosk/fixture.js"></script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const root = 'https://app.esgpb.com/order/store/1kgJeql/internal_use/'
const choose = `${root}orders/TEST/choosePayment`
const gateway = { line: 'https://web-pay.line.me/web/payment/wait?fixture=1', credit: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5' }
const placement = { sequence: 1, serviceId: 'payment-fixture', documentKey: 'payment-fixture:1', url: `${root}menu/select-table`, bounds: { x: 0, y: 80, width: 1050, height: 900 }, visible: true }
const choices = '<main class="order-pay"><div class="pay-method"><a id="line" href="/order/linepay/redirect/TEST/LinePay">LINE Pay</a><a id="credit" target="_blank" href="/order/ecpay/redirect/TEST/Credit">信用卡</a></div></main>'
const paymentPage = { component: 'Order/ChoosePayment', url: new URL(choose).pathname, version: 'fixture-assets-v1', props: { storeHash: '1kgJeql', flowType: 'internal_use', order: { hash: 'TEST', status: 20, totalmoney: 80, payment: null }, payMethods: [{ title: 'LINE Pay', url: '/order/linepay/redirect/TEST/LinePay' }, { title: '信用卡', url: '/order/ecpay/redirect/TEST/Credit' }] } }
const records = []
let app
let host
let site
try {
  app = await electron.launch({ executablePath: runtime, args: [resolve('apps/stage-kiosk-desktop/out/main/index.js')], env: { ...process.env, KIOSK_DESKTOP_URL: `http://127.0.0.1:${server.address().port}/kiosk/`, KIOSK_DESKTOP_WINDOWED: '1', KIOSK_DESKTOP_USER_DATA: profile } })
  const partition = `persist:service-${createHash('sha256').update(JSON.stringify([placement.serviceId, 'https://app.esgpb.com'])).digest('hex')}`
  await app.evaluate(({ session }, { partition, choose, choices, root, gateway, paymentPage }) => {
    globalThis.fixtureVersionReads = 0
    globalThis.fixtureCreditPostSeen = false
    // A partition protocol handler also owns HTTP redirect hops, which CDP
    // routing can miss in Electron. No request can escape to a real provider.
    session.fromPartition(partition).protocol.handle('https', async (request) => {
      const url = new URL(request.url)
      const htmlHeaders = { 'content-type': 'text/html; charset=utf-8' }
      if (url.origin === 'https://app.esgpb.com') {
        if (request.headers.get('x-inertia') === 'true') {
          if (request.headers.get('x-inertia-version') !== paymentPage.version)
            return new Response(null, { status: 409, headers: { 'x-inertia-location': request.url } })
          globalThis.fixtureVersionReads++
          const snapshot = structuredClone(paymentPage)
          if (globalThis.fixtureExpired)
            snapshot.props.order.status = 79
          return new Response(JSON.stringify(snapshot), { headers: { 'x-inertia': 'true', 'content-type': 'application/json' } })
        }
        if (url.pathname.includes('/linepay/redirect/'))
          return new Response(null, { status: 302, headers: { location: gateway.line } })
        if (url.pathname.includes('/ecpay/redirect/')) {
          if (globalThis.fixtureCreditPost)
            return new Response(`<form id="pay" target="_blank" method="post" action="${gateway.credit}"><input name="fixture" value="preserved"></form><script>document.getElementById("pay").submit()</script>`, { headers: htmlHeaders })
          return new Response(null, { status: 302, headers: { location: gateway.credit } })
        }
        const serialized = JSON.stringify(paymentPage).replaceAll('&', '&amp;').replaceAll('"', '&quot;')
        return new Response(`<!doctype html>${request.url === choose ? `<div data-page="${serialized}">${choices}</div>` : '<h1>Merchant fixture</h1>'}`, { headers: htmlHeaders })
      }
      if (url.origin === 'https://payment.ecpay.com.tw' && request.method === 'POST')
        globalThis.fixtureCreditPostSeen = await request.text() === 'fixture=preserved'
      const selector = url.href === gateway.credit
        ? `<button onclick="panel.innerHTML=card.innerHTML">信用卡</button><button onclick="panel.innerHTML=wallet.innerHTML">綠界Pay</button><button onclick="panel.innerHTML=apple.innerHTML">Apple Pay</button>
           <template id="card">信用卡卡號 <input type="tel"><input type="tel"><input type="tel"><input type="tel"></template>
           <template id="wallet">掃描付款碼<canvas></canvas></template><template id="apple"><a class="apple-pay-btn" onclick="document.body.dataset.appleClicks=Number(document.body.dataset.appleClicks||0)+1">付款</a></template><section id="panel"></section>`
        : ''
      return new Response(`<!doctype html><h1>Fixture payment provider</h1>${selector}<a id="return" href="${root}orders/TEST">Return to merchant</a>`, { headers: htmlHeaders })
    })
  }, { partition, choose, choices, root, gateway, paymentPage })
  host = await app.firstWindow()
  await host.waitForFunction(() => window.airiKioskDesktop)
  assert.equal(await host.evaluate(() => window.airiKioskDesktop.appVersion), await app.evaluate(({ app }) => app.getVersion()))
  await host.evaluate(() => {
    window.events = []
    window.airiKioskDesktop.onNavigation(event => window.events.push(event))
  })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1080, 1100))
  await host.evaluate(placement => window.airiKioskDesktop.updateSurface(placement), placement)
  site = app.context().pages().find(page => page !== host)
  assert(site)
  for (const method of ['line', 'credit', 'credit-post']) {
    await app.evaluate((_electron, post) => globalThis.fixtureCreditPost = post, method === 'credit-post')
    await site.goto(choose)
    await site.waitForLoadState('load')
    if (method !== 'credit-post') {
      await host.waitForFunction(() => window.events.at(-1)?.revision >= 2 && window.events.at(-1)?.state === 'ready', undefined, { timeout: 10000 })
      const discovery = await host.evaluate(placement => window.airiKioskDesktop.invokeService({ serviceId: placement.serviceId, documentKey: placement.documentKey, command: { kind: 'discover', request: { version: 1, connectionId: 'payment-fixture', challenge: 'payment-fixture' } } }), placement)
      const result = await host.evaluate(({ placement, discovery }) => window.airiKioskDesktop.invokeService({ serviceId: placement.serviceId, documentKey: placement.documentKey, command: { kind: 'execute', request: { connectionId: discovery.connectionId, documentId: discovery.documentId, toolsRevision: discovery.toolsRevision, operationId: crypto.randomUUID(), name: 'browser_state_get', input: { includeCatalog: true } } } }), { placement, discovery })
      assert.equal(result.result.ok, true, 'Payment read must send the asset version')
      assert.deepEqual(result.result.order.paymentMethods, ['LINE Pay', '信用卡'])
      const opened = await host.evaluate(({ placement, discovery, method }) => window.airiKioskDesktop.invokeService({ serviceId: placement.serviceId, documentKey: placement.documentKey, command: { kind: 'execute', request: { connectionId: discovery.connectionId, documentId: discovery.documentId, toolsRevision: discovery.toolsRevision, operationId: crypto.randomUUID(), name: 'browser_payment_open', input: { reference: 'TEST', method: method === 'line' ? 'LinePay' : 'Credit' } } } }), { placement, discovery, method })
      assert.equal(opened.result.status, 'gateway-requested')
    }
    else {
      await site.locator('#credit').click()
    }
    await site.waitForURL(gateway[method === 'credit-post' ? 'credit' : method], { timeout: 15000 })
    await site.waitForLoadState('load')
    await host.waitForFunction(() => window.events.at(-1)?.state === 'manual-payment', undefined, { timeout: 10000 })
    assert.equal(app.context().pages().length, 2, 'Keep the manual handoff in the owned native view')
    assert.match(await site.locator('body').textContent(), /Fixture payment provider/)
    const denied = await host.evaluate(placement => window.airiKioskDesktop.invokeService({ serviceId: placement.serviceId, documentKey: placement.documentKey, command: { kind: 'discover', request: { version: 1, connectionId: 'test', challenge: 'test' } } }).then(() => false, () => true), placement)
    assert.equal(denied, true, 'Provider must have no PB automation')
    const select = (choice, reference = 'TEST', revisionOffset = 0) => host.evaluate(({ placement, choice, reference, revisionOffset }) => window.airiKioskDesktop.invokeService({
      serviceId: placement.serviceId,
      documentKey: placement.documentKey,
      command: { kind: 'choose-gateway', revision: window.events.at(-1).revision + revisionOffset, reference, choice },
    }), { placement, choice, reference, revisionOffset })
    if (method === 'line') {
      assert.equal(await select('apple'), 'unavailable')
    }
    else {
      assert.equal(await select('card', 'OTHER'), 'unavailable')
      assert.equal(await select('wallet', 'TEST', -1), 'unavailable')
      assert.equal(await select('card'), 'card-ready')
      assert.equal(await select('wallet'), 'wallet-ready')
      assert.equal(await select('apple'), 'apple-requested')
      assert.equal(await select('apple'), 'apple-requested')
      assert.equal(await site.locator('body').getAttribute('data-apple-clicks'), '1')
    }
    records.push({ method, gatewayReached: true, manualPaymentEvent: true, providerAutomationDenied: true })
    if (method !== 'credit-post') {
      const change = reference => host.evaluate(({ placement, reference }) => window.airiKioskDesktop.invokeService({
        serviceId: placement.serviceId,
        documentKey: placement.documentKey,
        command: { kind: 'return-payment', revision: window.events.at(-1).revision, reference },
      }), { placement, reference })
      assert.equal(await change('OTHER'), 'unavailable')
      if (method === 'credit') {
        const back = host.getByRole('button', { name: '上一頁（付款方式）' })
        await back.waitFor({ timeout: 5000 }).catch(async (error) => {
          console.error(await host.locator('body').innerHTML(), (await host.pageErrors()).map(entry => entry.message))
          throw error
        })
        const bounds = await back.boundingBox()
        assert(bounds && bounds.y + bounds.height < placement.bounds.y)
        const touch = await app.context().newCDPSession(host)
        await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true })
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }] })
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await touch.detach()
        records.at(-1).touchedReturnAfterApplePay = true
      }
      else {
        assert.equal(await change('TEST'), 'returned')
      }
      await site.waitForURL(choose)
      await host.waitForFunction(() => window.events.at(-1)?.state === 'ready')
      const open = async () => host.evaluate(async ({ placement, method }) => {
        const invoke = command => window.airiKioskDesktop.invokeService({ serviceId: placement.serviceId, documentKey: placement.documentKey, command })
        const d = await invoke({ kind: 'discover', request: { version: 1, connectionId: 'switch', challenge: 'switch' } })
        return invoke({ kind: 'execute', request: { connectionId: d.connectionId, documentId: d.documentId, toolsRevision: d.toolsRevision, operationId: crypto.randomUUID(), name: 'browser_payment_open', input: { reference: 'TEST', method: method === 'line' ? 'Credit' : 'LinePay' } } })
      }, { placement, method })
      await app.evaluate(() => globalThis.fixtureExpired = true)
      assert.equal((await open()).result.ok, false)
      assert.equal(site.url(), choose)
      await app.evaluate(() => globalThis.fixtureExpired = false)
      assert.equal((await open()).result.status, 'gateway-requested')
      await site.waitForURL(method === 'line' ? gateway.credit : gateway.line)
      await host.waitForFunction(() => window.events.at(-1)?.state === 'manual-payment')
      if (method === 'line')
        assert.equal(await select('wallet'), 'wallet-ready')
      records.at(-1).switchedGateway = true
      records.at(-1).expiredSwitchDenied = true
      continue
    }
    await site.locator('#return').click()
    await site.waitForURL(`${root}orders/TEST`)
    await site.waitForLoadState('load')
    await host.waitForFunction(() => window.events.at(-1)?.state === 'ready', undefined, { timeout: 10000 })
  }
  assert.equal(await app.evaluate(() => globalThis.fixtureCreditPostSeen), true, 'Preserve form POST data across a named-window handoff')
  assert.equal(await app.evaluate(() => globalThis.fixtureVersionReads), 8)
  console.info(JSON.stringify({ passed: true, records, versionedOrderRead: true, creditPostPreserved: true, realPaymentRequests: 0, realOrders: 0 }))
}
finally {
  await writeFile(process.env.KIOSK_PAYMENT_REPORT_PATH ?? '/tmp/kiosk-payment-verification.json', JSON.stringify({ records, events: host ? await host.evaluate(() => window.events).catch(() => []) : [] }, null, 2))
  await app?.close()
  server.close()
  await rm(profile, { recursive: true, force: true })
}
