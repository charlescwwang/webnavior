import assert from 'node:assert/strict'
import process from 'node:process'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { chromium, _electron as electron } from 'playwright'

// Runs the built Host, local API, saved prompts and configured models. Every
// merchant-origin request is served by the existing loopback fixture instead.
// A temporary Electron profile enrolls its own test device; operator devices,
// their credentials, settings, carts and browser storage are never reused.
const scenario = process.env.PB_AUDIT_SCENARIO ?? 'full'
const checkoutOrigin = process.env.PB_AUDIT_CHECKOUT_ORIGIN ?? 'merchant'
assert(['merchant', 'fixture'].includes(checkoutOrigin))
const localCheckout = scenario === 'checkout-flow' && checkoutOrigin === 'fixture'
assert(['full', 'customization', 'pork-chicken', 'cart-admission', 'checkout-flow', 'service-boundary', 'dumpling-cart-edit', 'dumpling-assent', 'dumpling-follow-up', 'matched-recommendations', 'table-guidance', 'recommendation', 'recommendation-follow-up', 'search-missing', 'search', 'cart', 'reset', 'idle', 'semantics', 'follow-up', 'stale-result'].includes(scenario))
const reportPath = process.env.PB_AUDIT_REPORT_PATH ?? '/tmp/pb-ordering-audit.json'
const nullablePickup = process.env.PB_AUDIT_NULL_PICKUP === '1'
const readbackFailure = process.env.PB_AUDIT_READBACK_FAILURE === '1'
assert(!readbackFailure || (scenario === 'checkout-flow' && !process.env.PB_AUDIT_CDP), 'Readback-failure acceptance uses a fresh isolated Electron checkout fixture.')
const acceleratedIdle = process.env.PB_AUDIT_ACCELERATE_IDLE === '1'
const retiredCartMarker = process.env.PB_AUDIT_RETIRED_CART_MARKER === '1'
const restartButton = process.env.PB_AUDIT_RESTART_BUTTON ?? 'preparation'
const startupMask = process.env.PB_AUDIT_STARTUP_MASK === '1'
assert(['preparation', 'header'].includes(restartButton))
assert(scenario !== 'idle' || !acceleratedIdle, 'Idle reply acceptance requires real time: browser-only clock acceleration invalidates server checkpoint and reception deadlines.')
const runtime = process.env.ESGPB_ELECTRON_PATH
const cdp = process.env.PB_AUDIT_CDP
assert(runtime || cdp, 'Set ESGPB_ELECTRON_PATH or PB_AUDIT_CDP for an isolated test runtime.')
if (cdp)
  assert.equal(new URL(cdp).hostname, '127.0.0.1', 'The audit CDP endpoint must be loopback-only.')
const hostUrl = new URL(process.env.PB_AUDIT_HOST_ORIGIN ?? 'http://127.0.0.1:15169')
assert(['http:', 'https:'].includes(hostUrl.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(hostUrl.hostname), 'The audit Host origin must be loopback-only.')
assert(!hostUrl.username && !hostUrl.password && hostUrl.pathname === '/' && !hostUrl.search && !hostUrl.hash, 'PB_AUDIT_HOST_ORIGIN must contain only an origin.')
const hostOrigin = hostUrl.origin
const siteRoot = resolve(process.env.PB_AUDIT_SITE_ROOT ?? 'pb-test.local/site')
const builtEntry = await readFile(resolve(siteRoot, 'kiosk/index.html'), 'utf8')
const expectedEntry = builtEntry.match(/<script\s[^>]*type="module"[^>]*src="([^"]+)"/)?.[1]
assert(expectedEntry, 'Built Kiosk entry script is missing.')
const report = { runnerSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'), build: JSON.parse(await readFile(resolve(siteRoot, '../built.json'), 'utf8')), hostEntrySha256: createHash('sha256').update(builtEntry).digest('hex'), hostOrigin, siteRoot, fixture: 'pb-order-lab', host: 'built-kiosk', transport: cdp ? 'cdp' : 'electron-launcher', scenario, nullablePickup, readbackFailure, acceleratedIdle, steps: [], errors: [] }
report.sourceHashes = Object.fromEntries(await Promise.all([
  'packages/stage-shared/src/orderingTools.ts',
  'packages/stage-shared/src/interactiveService.ts',
  'packages/stage-shared/src/productPresentation.ts',
  'packages/stage-shared/src/browserConversation.ts',
  'apps/server/src/services/domain/browser-ordering/index.ts',
  'apps/server/src/services/domain/browser-ordering/skills/order/SKILL.md',
  'apps/server/src/services/domain/browser-ordering/skills/cart/SKILL.md',
  'apps/stage-kiosk/src/services/browserPresentation.ts',
  'packages/stage-ui/src/services/pbBrowserService.ts',
  'packages/stage-ui/src/services/pbOperation.ts',
  'packages/stage-ui/src/services/pbControls.ts',
  'apps/stage-kiosk/src/services/browserOrderingTools.ts',
  'apps/stage-kiosk/src/services/browserFastPath.ts',
  'apps/stage-kiosk/src/services/browserDialogue.ts',
  'apps/stage-kiosk/src/services/browserQuestionWindow.ts',
  'apps/stage-kiosk/src/services/browserCartTask.ts',
  'apps/stage-kiosk/src/services/browserCartSession.ts',
  'apps/stage-kiosk/src/services/kioskConversationRetry.ts',
  'apps/stage-kiosk/src/services/browserQuestionWindow.ts',
  'apps/stage-kiosk/src/services/kiosk-fast-path.ts',
  'apps/stage-kiosk/src/services/checkoutInvitation.ts',
  'packages/stage-ui/src/services/pbCart.ts',
  'apps/stage-kiosk/src/components/KioskScene.vue',
  'apps/stage-kiosk/src/components/orderingPreparation.vue',
  'apps/stage-kiosk/src/components/ScenarioSurface.vue',
  'apps/stage-kiosk-desktop/src/main/surface.ts',
  'apps/server/src/routes/kiosk/index.ts',
  'apps/server/src/services/domain/kiosk-interaction-decision/prompt.ts',
  'apps/server/src/services/domain/browser-ordering/skills/common/SKILL.md',
  'apps/server/src/services/domain/kiosk-interaction-decision/direct.ts',
  'test-sites/pb-order-lab/catalog.js',
  'test-sites/pb-order-lab/fixtureProtocol.js',
  'test-sites/pb-order-lab/order.js',
  'test-sites/pb-order-lab/app.js',
].map(async path => [path, createHash('sha256').update(await readFile(resolve(path))).digest('hex')])))
const profile = await mkdtemp(resolve(tmpdir(), 'kiosk-ordering-audit-'))
let app
let browser
let context
let host
let consolePage
let native
let profiler
let heapTimer
let inspector
try {
  assert.equal((await fetch(`${hostOrigin}/readyz`)).status, 200)
  assert.equal((await fetch('http://127.0.0.1:5188/')).status, 200)
  if (cdp) {
    // NOTICE: Playwright's default focus emulation makes hidden Electron views
    // report visible and can hide reset failures. noDefaults preserves the
    // app's actual visibility (playwright-core 1.60.0 coreBundle.js:36216).
    browser = await chromium.connectOverCDP(cdp, { noDefaults: true })
    context = browser.contexts()[0]
    host = context.pages().find(page => page.url().startsWith(`${hostOrigin}/kiosk/`))
    assert(host, 'Expected a fresh, separately launched audit Kiosk.')
    // Refuse an existing enrolled operator profile before installing routes.
    await host.getByRole('button', { name: '建立測試設備', exact: true }).waitFor({ timeout: 30000 })
  }
  else {
    app = await electron.launch({
      executablePath: runtime,
      // Xvfb has no physical GPU. Use Electron's software WebGL for the actual
      // avatar import/preview instead of bypassing published-profile loading.
      args: [resolve('apps/stage-kiosk-desktop/out/main/index.js'), '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.PB_AUDIT_AUDIO_DEVICES_CHECK === '1' ? ['--use-fake-device-for-media-stream'] : [])],
      env: { ...process.env, KIOSK_DESKTOP_URL: `${hostOrigin}/kiosk/`, KIOSK_DESKTOP_WINDOWED: '1', KIOSK_DESKTOP_USER_DATA: profile },
    })
    app.process().stderr?.on('data', chunk => report.stderr = ((report.stderr ?? '') + String(chunk)).slice(-16000))
    await app.evaluate(({ app }) => {
      globalThis.__auditRendererExits = []
      app.on('web-contents-created', (_event, contents) => {
        contents.on('render-process-gone', (_event, details) => globalThis.__auditRendererExits.push({ url: contents.getURL(), ...details, at: Date.now() }))
      })
    })
    context = app.context()
    host = await app.firstWindow()
  }
  host.on('response', async (response) => {
    const path = new URL(response.url()).pathname
    if (!response.ok()) {
      report.httpFailures ??= []
      report.httpFailures.push({ path, status: response.status() })
      return
    }
    if (/\/api\/kiosk\/visitor-sessions\/[^/]+\/browser-plan$/.test(path)) {
      const body = await response.json().catch(() => undefined)
      report.browserAdmissions ??= []
      report.browserAdmissions.push({ choice: body?.choice, admission: body?.admission, provider: body?.provider, stages: body?.checks?.map(check => check.stage) })
      return
    }
    if (!['/api/kiosk/development/register', '/api/kiosk/bootstrap', '/api/kiosk/visitor-sessions'].includes(path))
      return
    const body = await response.json().catch(() => undefined)
    if (path.endsWith('/register'))
      report.deviceId = body?.device?.id
    else if (path.endsWith('/bootstrap'))
      report.profileReleaseId = body?.profile?.releaseId
    else
      report.visitorSessionId = body?.session?.id
  })
  host.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (/\/api\/kiosk\/visitor-sessions\/[^/]+\/browser-effect$/.test(path))
      report.browserEffectRequests = (report.browserEffectRequests ?? 0) + 1
    if (/\/api\/kiosk\/visitor-sessions\/[^/]+\/browser-plan$/.test(path))
      report.browserPlanRequests = (report.browserPlanRequests ?? 0) + 1
    if (!/\/api\/kiosk\/visitor-sessions\/[^/]+\/messages$/.test(path) || request.method() !== 'POST')
      return
    const input = request.postDataJSON()
    const state = input?.decisionState?.browserContext
    report.modelContexts ??= []
    report.modelContexts.push({ text: input?.content, selectedTable: state?.selectedTable, page: state?.page, phase: state?.phase, toolNames: input?.tools?.map(tool => tool.function.name) })
  })
  // Playwright's clock belongs to the Electron browser context (all its pages).
  // Advance it only for the final idle check; API/model clocks remain real.
  if (acceleratedIdle)
    await host.clock.install()
  host.on('console', async (message) => {
    if (message.type() === 'error') {
      const details = await Promise.all(message.args().map(argument => argument.evaluate(value => value instanceof Error ? { message: value.message, stack: value.stack } : typeof value === 'string' ? value : undefined).catch(() => undefined)))
      report.errors.push([message.text(), ...details])
    }
  })
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1080, 1920))
    const partition = `persist:service-${createHash('sha256').update(JSON.stringify(['pb-ubuntu-test', 'https://app.esgpb.com'])).digest('hex')}`
    await app.evaluate(async ({ app, session }, { partition, nullablePickup, readbackFailure }) => {
    // A changed published service ID must fail closed, never create a second
    // un-intercepted merchant session while this fixture is running.
      app.on('session-created', (created) => {
        created.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (request, callback) => callback({ cancel: new URL(request.url).hostname !== '127.0.0.1' }))
      })
      const site = session.fromPartition(partition)
      globalThis.__auditReadbackFaults = 0
      let cookie = ''
      // Vite HMR is unnecessary here; no websocket may escape to the merchant.
      site.webRequest.onBeforeRequest({ urls: ['http://*/*', 'ws://*/*', 'wss://*/*'] }, (request, callback) => callback({ cancel: new URL(request.url).protocol !== 'http:' || new URL(request.url).hostname !== '127.0.0.1' }))
      await site.protocol.handle('https', async (request) => {
        const url = new URL(request.url)
        if (url.origin !== 'https://app.esgpb.com')
          return new Response('Outside local fixture.', { status: 403 })
        const local = new URL(url.pathname + url.search, 'http://127.0.0.1:5188')
        const headers = new Headers(request.headers)
        headers.delete('host')
        headers.delete('content-length')
        headers.set('origin', local.origin)
        if (cookie)
          headers.set('cookie', cookie)
        const response = await fetch(local, { method: request.method, headers, ...(request.method !== 'GET' && request.method !== 'HEAD' ? { body: await request.arrayBuffer() } : {}) })
        const received = response.headers.get('set-cookie')?.match(/pb_lab=[^;]+/)?.[0]
        if (received)
          cookie = received
        const returnedHeaders = new Headers(response.headers)
        returnedHeaders.delete('content-encoding')
        returnedHeaders.delete('content-length')
        let body = await response.arrayBuffer()
        // The public-capable fixture now reports absolute page URLs. Project
        // only its loopback origin into this simulated merchant document;
        // keep path/query mismatches intact for production ownership checks.
        if (returnedHeaders.get('X-Inertia') === 'true') {
          const page = JSON.parse(new TextDecoder().decode(body))
          if (typeof page.url === 'string') {
            const pageUrl = new URL(page.url, local.origin)
            if (pageUrl.origin === local.origin)
              page.url = new URL(pageUrl.pathname + pageUrl.search, url.origin).href
          }
          body = new TextEncoder().encode(JSON.stringify(page))
        }
        // Report: Nov17 — a new merchant draft may defer pickup fields until
        // checkout. Exercise that protocol shape through actual native reads.
        if (nullablePickup && local.pathname.endsWith('/orders/create') && returnedHeaders.get('content-type')?.includes('application/json')) {
          const page = JSON.parse(new TextDecoder().decode(body))
          if (page.props?.order) {
            page.props.order.pick_up_date = null
            page.props.order.pick_up_time = null
            body = new TextEncoder().encode(JSON.stringify(page))
          }
        }
        if (readbackFailure && !globalThis.__auditReadbackFaults && local.pathname.endsWith('/orders/create') && returnedHeaders.get('content-type')?.includes('application/json')) {
          const page = JSON.parse(new TextDecoder().decode(body))
          if (page.props?.details?.length && page.props.order) {
            // Exactly one post-dispatch read is malformed. Recovery must use
            // the next valid snapshot, never click Add again or require a user.
            page.props.order.pick_up_time = 42
            globalThis.__auditReadbackFaults++
            body = new TextEncoder().encode(JSON.stringify(page))
          }
        }
        if (returnedHeaders.get('content-type')?.includes('text/html')) {
        // The merchant release has no HMR. Vite's injected client queues errors
        // indefinitely when its WebSocket is blocked; do not load it in this proxy.
          body = new TextEncoder().encode(new TextDecoder().decode(body).replace(/<script type="module" src="\/@vite\/client"><\/script>\s*/, ''))
        }
        return new Response(body, { status: response.status, headers: returnedHeaders })
      })
    }, { partition, nullablePickup, readbackFailure })
  }
  else {
    let cookie = ''
    await context.routeWebSocket('**', socket => socket.close())
    await context.route('**/*', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.hostname === '127.0.0.1')
        return route.continue()
      if (url.origin !== 'https://app.esgpb.com')
        return route.abort('blockedbyclient')
      const local = new URL(url.pathname + url.search, 'http://127.0.0.1:5188')
      const headers = new Headers(request.headers())
      headers.delete('host')
      headers.delete('content-length')
      headers.set('origin', local.origin)
      if (cookie)
        headers.set('cookie', cookie)
      const response = await fetch(local, { method: request.method(), headers, ...(request.postDataBuffer() ? { body: request.postDataBuffer() } : {}) })
      cookie = response.headers.get('set-cookie')?.match(/pb_lab=[^;]+/)?.[0] ?? cookie
      const returned = new Headers(response.headers)
      returned.delete('content-encoding')
      returned.delete('content-length')
      let body = Buffer.from(await response.arrayBuffer())
      // CDP uses the same fixture projection as the native protocol adapter;
      // do not let localhost metadata masquerade as a merchant page response.
      if (returned.get('X-Inertia') === 'true') {
        const page = JSON.parse(body.toString('utf8'))
        if (typeof page.url === 'string') {
          const pageUrl = new URL(page.url, local.origin)
          if (pageUrl.origin === local.origin)
            page.url = new URL(pageUrl.pathname + pageUrl.search, url.origin).href
        }
        body = Buffer.from(JSON.stringify(page))
      }
      if (returned.get('content-type')?.includes('text/html'))
        body = Buffer.from(body.toString('utf8').replace(/<script type="module" src="\/@vite\/client"><\/script>\s*/, ''))
      await route.fulfill({ status: response.status, headers: Object.fromEntries(returned), body })
    })
  }
  if (localCheckout) {
    // Direct loopback testing needs the same no-HMR document as the merchant
    // proxy above. Faults must reach its actual cart JSON reads too; merchant
    // protocol interception does not see this independently owned partition.
    let readbackFaultInjected = false
    await context.route('http://127.0.0.1:5188/**', async (route) => {
      const request = route.request()
      const cartRead = new URL(request.url()).pathname.endsWith('/orders/create')
        && request.headers()['x-inertia'] === 'true' && (nullablePickup || readbackFailure)
      if (request.method() !== 'GET' || (!request.isNavigationRequest() && !cartRead))
        return route.continue()
      const response = await route.fetch()
      if (cartRead && response.headers()['content-type']?.includes('application/json')) {
        const page = await response.json()
        if (nullablePickup && page.props?.order) {
          page.props.order.pick_up_date = null
          page.props.order.pick_up_time = null
        }
        if (readbackFailure && !readbackFaultInjected && page.props?.details?.length && page.props.order) {
          readbackFaultInjected = true
          page.props.order.pick_up_time = 42
          await app.evaluate(() => globalThis.__auditReadbackFaults++)
        }
        return route.fulfill({ response, json: page })
      }
      if (!response.headers()['content-type']?.includes('text/html'))
        return route.fulfill({ response })
      const body = (await response.text()).replace(/<script type="module" src="\/@vite\/client"><\/script>\s*/, '')
      await route.fulfill({ response, body })
    })
  }
  assert.equal(await host.locator('script[type="module"][src]').first().getAttribute('src'), expectedEntry, 'The loaded Host is not the current build.')
  host.on('pageerror', error => report.errors.push(error.message))
  await host.getByRole('button', { name: '建立測試設備' }).click({ timeout: 60000 })
  await host.waitForFunction(() => document.querySelector('.kiosk-conversation') || document.body.textContent.includes('角色設定同步失敗'), undefined, { timeout: 90000 })
  assert.equal(await host.locator('.kiosk-conversation').count(), 1, 'Fresh enrollment must finish profile synchronization.')
  if (localCheckout) {
    const selected = await host.evaluate(async () => {
      const settings = await (await fetch('/api/kiosk/settings', { credentials: 'include' })).json()
      const site = settings.orderingSites.find(site => site.id === 'pb-local-test' && site.url === 'http://127.0.0.1:5188/order/store/1kgJeql/internal_use/menu/select-table')
      if (!site)
        throw new Error('Published owned fixture is missing.')
      const unlocked = await fetch('/api/kiosk/admin/session', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '0000' }) })
      if (!unlocked.ok)
        throw new Error('Fresh audit device could not unlock its local settings.')
      try {
        const updated = await fetch('/api/kiosk/settings', { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: settings.settings.version, overrides: { ...settings.settings.overrides, orderingServiceId: site.id } }) })
        if (!updated.ok)
          throw new Error('Fresh audit device could not select the owned fixture.')
        const readback = await (await fetch('/api/kiosk/settings', { credentials: 'include' })).json()
        if (readback.effective.orderingServiceId !== site.id)
          throw new Error('Owned fixture selection readback failed.')
        return { deviceId: readback.deviceId, orderingServiceId: site.id, url: site.url }
      }
      finally {
        await fetch('/api/kiosk/admin/session', { method: 'DELETE', credentials: 'include' })
      }
    })
    report.ownedSite = selected
    await host.reload()
    await host.locator('.kiosk-conversation').waitFor({ timeout: 90000 })
  }

  const setMode = async (textOnlyMode) => {
    await host.evaluate(async ({ mode, diagnostics }) => {
      const settings = await (await fetch('/api/kiosk/settings', { credentials: 'include' })).json()
      const unlocked = await fetch('/api/kiosk/admin/session', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '0000' }) })
      assertResponse(unlocked)
      function assertResponse(response) {
        if (!response.ok)
          throw new Error(`Settings request failed: ${response.status}`)
      }
      try {
        assertResponse(await fetch('/api/kiosk/settings', { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: settings.settings.version, overrides: { ...settings.settings.overrides, textOnlyMode: mode, ...(diagnostics ? { voiceDiagnosticsEnabled: true } : {}) } }) }))
      }
      finally { await fetch('/api/kiosk/admin/session', { method: 'DELETE', credentials: 'include' }) }
    }, { mode: textOnlyMode, diagnostics: process.env.PB_AUDIT_VOICE_DIAGNOSTICS_CHECK === '1' })
    await host.reload()
    await host.locator('.kiosk-conversation').waitFor({ timeout: 90000 })
  }
  if (process.env.PB_AUDIT_TEXT_MODE_CHECK === '1') {
    await setMode(false)
    await host.locator('[data-conversation-mode="voice"]').waitFor({ timeout: 10000 })
    assert(!context.pages().some(page => !page.isClosed() && page.url() === 'about:blank'), 'Voice mode must not open a text console.')
    await setMode(true)
    await host.locator('[data-conversation-mode="text"]').waitFor({ timeout: 10000 })
    for (let attempt = 0; attempt < 50 && !context.pages().some(page => !page.isClosed() && page.url() === 'about:blank'); attempt++)
      await new Promise(resolve => setTimeout(resolve, 100))
    assert(context.pages().some(page => !page.isClosed() && page.url() === 'about:blank'), 'Text mode must open its owned console.')
    await setMode(false)
    await host.locator('[data-conversation-mode="voice"]').waitFor({ timeout: 10000 })
    assert(!context.pages().some(page => !page.isClosed() && page.url() === 'about:blank'), 'Returning to voice must close the text console.')
    await setMode(true)
    report.textModePolicy = { voiceHidden: true, textEnabled: true, voiceAgainHidden: true }
    console.info('PASS: device mode controls the real text console independently of the legacy profile.')
  }
  else {
    // The audit uses text input explicitly; profile display flags cannot opt a device in.
    await setMode(true)
  }
  console.info('AUDIT: owned-site ready')
  if (process.env.PB_AUDIT_AUDIO_DEVICES_CHECK === '1') {
    report.audioDevices = await host.evaluate(async () => {
      // Synthetic devices exercise the shipped host's actual permission handler.
      // The merchant document never receives media or speaker permissions.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const context = new AudioContext()
      try {
        const output = (await navigator.mediaDevices.enumerateDevices()).find(device => device.kind === 'audiooutput' && device.deviceId !== 'default')
        if (!output)
          throw new Error('Synthetic audio output missing')
        const player = new Audio()
        await player.setSinkId(output.deviceId)
        await context.setSinkId(output.deviceId)
        return { microphoneLive: stream.getAudioTracks()[0].readyState === 'live', nativeOutputSelected: player.sinkId === output.deviceId, graphOutputSelected: context.sinkId === output.deviceId }
      }
      finally {
        stream.getTracks().forEach(track => track.stop())
        await context.close()
      }
    })
    assert(report.audioDevices.microphoneLive && report.audioDevices.nativeOutputSelected && report.audioDevices.graphOutputSelected)
    console.info('PASS: shipped native host allows microphone and speaker routing.')
  }
  if (process.env.PB_AUDIT_VOICE_DIAGNOSTICS_CHECK === '1') {
    await host.locator('.voice-diagnostics').waitFor()
    const bounds = await host.evaluate(() => {
      const audio = document.querySelector('.voice-diagnostics').getBoundingClientRect()
      const hero = document.querySelector('.service-hero').getBoundingClientRect()
      const menu = document.querySelector('.menu-region').getBoundingClientRect()
      return { audioTop: audio.top, audioBottom: audio.bottom, hostTop: hero.top, menuTop: menu.top, text: document.querySelector('.voice-runtime').textContent }
    })
    assert(bounds.audioTop >= bounds.hostTop && bounds.audioBottom <= bounds.menuTop, 'Audio diagnostics must remain outside the native menu bounds.')
    report.voiceDiagnostics = bounds
    console.info('PASS: audio diagnostics are visible above the native menu before any audio event.')
  }
  // Electron teleports the real text console into an owned BrowserWindow.
  // Find that surface instead of inventing input in the Host document.
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const page of context.pages()) {
      if (await page.locator('.simulation-form textarea').count()) {
        consolePage = page
        break
      }
    }
    if (consolePage)
      break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(consolePage, 'Expected the owned text console.')
  console.info('AUDIT: text console ready')
  for (let attempt = 0; attempt < 100; attempt++) {
    native = context.pages().find(page => page.url().startsWith(localCheckout ? 'http://127.0.0.1:5188/order/' : 'https://app.esgpb.com/order/'))
    if (native)
      break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(native, 'Expected the actual Host to open the PB service.')
  native.on('crash', () => report.errors.push(['native renderer crashed', Date.now()]))
  native.on('close', () => report.errors.push(['native page closed']))
  native.on('requestfailed', request => report.errors.push(['native request failed', request.url(), request.failure()]))
  console.info('AUDIT: native surface located')
  await native.waitForFunction(() => Boolean(window.pbTest), undefined, { timeout: 30000 })
  if (scenario !== 'cart-admission') {
    // A rendered PB document can precede Host discovery/admission. Sending at
    // that point tests a disconnected startup, not the ordering scenario.
    await native.waitForFunction(() => document.documentElement.getAttribute('data-webnavior-pb-bridge') === 'ready' && document.visibilityState === 'visible', undefined, { timeout: 30000 })
    await host.locator('.ordering-preparation').waitFor({ state: 'hidden', timeout: 30000 })
  }
  console.info('AUDIT: fixture ready')
  assert.equal(await native.locator('script[src="/@vite/client"]').count(), 0)
  inspector = await context.newCDPSession(native)
  console.info('AUDIT: native inspector attached')
  if (process.env.PB_AUDIT_HEAP === '1') {
    profiler = inspector
    await profiler.send('HeapProfiler.startSampling', { samplingInterval: 32768 })
    report.heaps = []
    let sampling = false
    heapTimer = setInterval(async () => {
      if (sampling)
        return
      sampling = true
      try {
        report.heaps.push({ at: Date.now(), ...await profiler.send('Runtime.getHeapUsage') })
        await writeFile('/tmp/pb-native-heap.json', JSON.stringify({ heaps: report.heaps, ...await profiler.send('HeapProfiler.getSamplingProfile') }))
      }
      catch (error) { report.heapError = error.message }
      finally { sampling = false }
    }, 2000)
  }
  const state = () => native.evaluate(() => window.pbTest.getState())
  async function send(text, verify, expectedStatus = 'completed') {
    const started = Date.now()
    const mainRequestStart = report.modelContexts?.length ?? 0
    const assistantStart = await host.locator('[data-chat-message-role="assistant"]').count()
    report.current = { text }
    console.info(`AUDIT: send ${text}`)
    const before = await host.locator('[data-request-status]').count()
    await consolePage.locator('textarea').first().fill(text)
    await consolePage.getByRole('button', { name: '模擬辨識並執行', exact: true }).click()
    await host.waitForFunction((count) => {
      const statuses = [...document.querySelectorAll('[data-request-status]')]
      return statuses.length > count && ['completed', 'failed', 'review', 'cancelled'].includes(statuses.at(-1)?.getAttribute('data-request-status'))
    }, before, { timeout: 120000 })
    const requestCompletedMs = Date.now() - started
    const snapshot = await state()
    const textResult = await host.locator('.message-history').textContent()
    const assistantMessages = host.locator('[data-chat-message-role="assistant"]')
    const assistantReply = await assistantMessages.count() > assistantStart ? await assistantMessages.last().textContent() : ''
    // Capture the exact decision before assertions, so a failed effect retains
    // the same utterance's candidates/selection rather than the previous step.
    const step = { text, requestCompletedMs, durationMs: Date.now() - started, path: new URL(native.url()).pathname, response: textResult.slice(-2000), assistantReply, mainPlannerRequests: (report.modelContexts?.length ?? 0) - mainRequestStart, cart: snapshot.cart, decision: await consolePage.locator('.simulation-status').allTextContents().then(values => values[0]), trace: await consolePage.locator('.simulation-trace pre').textContent().catch(() => undefined) }
    report.current = step
    // Recovery is a settled UI state, but it is not successful ordering. Capture
    // it immediately instead of waiting two minutes or counting it as success.
    assert(!(report.modelContexts ?? []).some(context => context.toolNames?.some(name => name.startsWith('browser_'))), 'Private browser tools reached Main.')
    assert.equal(await host.locator('[data-chat-message-role="error"]').count(), 0, 'Internal error message reached the customer.')
    assert(!textResult.includes('助手已達本次處理上限'), 'Internal tool limit reached the customer.')
    assert(await host.locator('[data-request-status]').last().evaluate((element, expected) => element.getAttribute('data-request-status') === expected, expectedStatus), `Customer request failed: ${textResult.slice(-600)}`)
    report.current.cart = snapshot.cart
    await verify(snapshot, assistantReply)
    step.durationMs = Date.now() - started
    report.steps.push(step)
    console.info(`PASS: ${text} (${Date.now() - started}ms)`)
  }
  let tableReopens = 0
  native.on('console', (message) => {
    if (message.text() === 'audit-table-reopened')
      tableReopens++
  })
  if (scenario === 'full') {
    await send('我要點山', (snapshot, response) => {
      assert.equal(snapshot.cart.length, 0)
      assert(!response.includes('處理上限'))
    })
    // Return only this empty synthetic fixture to table entry. This is not a
    // reception-reset assertion and does not reuse an operator's merchant cart.
    if (!new URL(native.url()).pathname.endsWith('/select-table'))
      await native.goto('https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table')
    await native.getByRole('button', { name: 'B3 吧檯', exact: true }).waitFor()
    await send('a9', (_snapshot, response) => assert.match(response, /A9/i))
    await native.getByRole('button', { name: 'B3 吧檯', exact: true }).click()
    await native.waitForFunction(() => document.querySelector('.el-select__placeholder')?.textContent === 'B3 吧檯')
  }
  else {
    await send(process.env.PB_AUDIT_TABLE ?? 'B03', async () => {
      assert.match(await native.locator('.el-select__placeholder').textContent(), /B3/)
      if (scenario === 'table-guidance') {
        const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
        assert.doesNotMatch(reply, /先找到?座位|再(?:回來)?告訴我您?的?桌號/, 'A verified table must not repeat the initial seating instructions.')
        assert.match(reply, /B3/)
        assert.match(reply, /請說[「『]開始點餐[」』]/)
        assert.match(reply, /按鈕/)
        assert.match(new URL(native.url()).pathname, /\/select-table$/)
      }
    })
  }
  await native.getByRole('combobox').evaluate(element => element.addEventListener('click', () => console.info('audit-table-reopened')))
  await send('開始點餐', async (snapshot) => {
    assert.match(new URL(native.url()).pathname, /\/menu$/)
    assert.match(snapshot.table, /B3/)
    assert.equal(tableReopens, 0, 'Start must not reopen the already selected table.')
    assert.equal(await native.getByRole('button', { name: '我知道了，開始點餐', exact: true }).count(), 0, 'The new menu must dismiss its store announcement before ordering.')
  })
  if (scenario === 'dumpling-cart-edit') {
    await send('水餃1份', (snapshot) => {
      assert.equal(snapshot.cart.length, 1)
      assert.equal(snapshot.cart[0].quantity, 1)
      assert.equal(snapshot.cart[0].extra, 0)
    })
    await send('查看購物車，先不要結帳', () => assert.match(new URL(native.url()).pathname, /\/orders\/create$/))
    await send('我水餃要10顆', (snapshot, response) => {
      assert.equal(snapshot.cart.length, 1)
      assert.equal(snapshot.cart[0].quantity, 1)
      assert.equal(snapshot.cart[0].extra, 2)
      assert.equal(snapshot.cart[0].unitPrice, 80)
      assert.match(response, /10 顆/)
      assert.doesNotMatch(response, /已調整為[^。]*8 顆/)
      assert.equal(snapshot.orders.length, 0)
    })
    report.dumplingCartEdit = { passed: true, piecesPerServing: 10, servings: 1, unitPrice: 80, submitted: false }
  }
  if (scenario === 'service-boundary') {
    const manifestBytes = await readFile(new URL('./pbTest/conversationCases.json', import.meta.url))
    const manifest = JSON.parse(manifestBytes)
    const test = manifest.cases.find(test => test.id === process.env.PB_AUDIT_BOUNDARY_CASE)
    assert(test && ['basic', 'challenge'].includes(test.suite), 'Select one current basic/challenge case with PB_AUDIT_BOUNDARY_CASE.')
    report.boundaryCase = { id: test.id, title: test.title, manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), passed: false }
    // Gold stays in this driver. Each fresh process owns its own device/cart;
    // failures terminate that case without contaminating the following case.
    for (const step of test.steps) {
      await send(step.text, (snapshot, reply) => {
        assert.equal(snapshot.orders.length, 0, 'Service-boundary cases cannot submit an order.')
        const actual = snapshot.cart.map(line => ({ name: line.name, quantity: line.quantity, unitPrice: line.unitPrice })).sort((a, b) => a.name.localeCompare(b.name))
        const expected = step.lines.map(line => ({ name: line.name, quantity: line.quantity, unitPrice: line.unitPrice })).sort((a, b) => a.name.localeCompare(b.name))
        assert.deepEqual(actual, expected, 'The actual cart differs from this turn’s gold.')
        if (step.reply)
          assert.match(reply, new RegExp(step.reply), 'The actual reply omitted the required service boundary or requested fact.')
        if (step.forbid)
          assert.doesNotMatch(reply, new RegExp(step.forbid), 'The actual reply claimed an unsupported action or guarantee.')
      })
    }
    report.boundaryCase.passed = true
  }
  if (scenario === 'cart-admission') {
    await send('魚丸湯一份', snapshot => assert.equal(snapshot.cart.length, 1))
    // A persisted vendor cart with no known reception owner is a real startup
    // state. Remove only this disposable Host's ownership, retaining its actual
    // fixture cart/cookie. No operator profile or merchant cart is involved.
    await host.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('webnavior:browser-cart-owner:'))
          localStorage.removeItem(key)
      }
    })
    if (retiredCartMarker) {
      await native.evaluate(() => {
        const marker = 'webnavior:pb:cart-pending:/order/store/1kgJeql/internal_use/'
        localStorage.setItem(marker, crypto.randomUUID())
      })
    }
    await host.reload()
    const preparation = host.locator('.ordering-preparation')
    await preparation.getByRole('heading', { name: '請先處理未完成的點餐', exact: true }).waitFor({ timeout: 30000 })
    assert.match(new URL(native.url()).pathname, /\/select-table$/, 'Unowned cart must be handled before the customer enters the menu.')
    assert.equal((await state()).cart.length, 1, 'Preparation must not silently erase an existing cart.')
    const preparationVisibility = await native.evaluate(() => document.visibilityState)
    if (cdp)
      assert.equal(preparationVisibility, 'hidden', 'The restart regression must exercise the actual hidden native view, without focus emulation.')
    if (startupMask) {
      // PB's SSR leave transition needs two rendering frames before its mask
      // stops intercepting Start. Hidden Electron views suspend those frames.
      await native.evaluate(() => {
        const mask = document.createElement('div')
        mask.className = 'ssr-mask-leave-from ssr-mask-leave-active'
        mask.dataset.auditStartupMask = 'true'
        mask.style.cssText = 'position:fixed;inset:0;z-index:100000;background:white'
        document.body.append(mask)
        requestAnimationFrame(() => requestAnimationFrame(() => mask.remove()))
      })
      assert.equal(await native.locator('[data-audit-startup-mask]').count(), 1)
    }
    assert(!(await host.locator('body').textContent()).includes('現在可以直接開口點餐'), 'Blocked preparation must not invite new ordering requests.')
    report.steps.push({ text: 'startup-with-unowned-cart', path: new URL(native.url()).pathname, visiblePreparation: await preparation.textContent(), nativeVisibility: preparationVisibility })
    if (restartButton === 'header')
      await host.locator('.customer-restart').click()
    else
      await preparation.getByRole('button', { name: '重新開始／新訂單', exact: true }).click()
    await host.waitForFunction(() => !document.querySelector('.ordering-preparation'), undefined, { timeout: 45000 })
    await native.waitForURL('**/menu/select-table')
    await native.waitForFunction(() => Boolean(window.pbTest))
    assert.equal((await state()).cart.length, 0, 'Explicit Restart must clear the actual cart before the next customer.')
    assert.equal((await state()).orders.length, 0, 'Reset must not submit any order.')
    report.steps.push({ text: 'restart-clears-before-entry', path: new URL(native.url()).pathname, cart: (await state()).cart })
    consolePage = context.pages().find(page => !page.isClosed() && page.url() === 'about:blank')
    assert(consolePage, 'The reloaded Host must expose its new text console.')
    await send('A03', async () => assert.match(await native.locator('.el-select__placeholder').textContent(), /A3/))
    await send('開始點餐', snapshot => assert.match(snapshot.table, /A3/))
    await send('魚丸湯一份', (snapshot) => {
      assert.equal(snapshot.cart.length, 1)
      assert.equal(snapshot.cart[0].quantity, 1)
    })
    if (retiredCartMarker) {
      assert.equal(await native.evaluate(() => localStorage.getItem('webnavior:pb:cart-pending:/order/store/1kgJeql/internal_use/')), null, 'Only verified reset may retire the persisted cart marker.')
    }
    report.cartAdmission = { retiredCartMarker, restartButton, startupMask, handledBeforeEntry: true, explicitClear: true, nextReceptionCanOrder: true, submittedOrders: 0 }
  }
  if (scenario === 'pork-chicken') {
    const variant = process.env.PB_AUDIT_PORK_CASE ?? 'context'
    assert(['initial', 'context', 'correction'].includes(variant))
    report.porkChicken = { variant }
    const exactCart = (snapshot, pork, chicken) => {
      const total = name => snapshot.cart.filter(line => line.name === name).reduce((sum, line) => sum + line.quantity, 0)
      assert.equal(total('炸排骨便當'), pork)
      assert.equal(total('炸雞腿便當'), chicken)
      assert.equal(snapshot.cart.reduce((sum, line) => sum + line.quantity, 0), pork + chicken)
      assert.equal(snapshot.cart.reduce((sum, line) => sum + line.subtotal, 0), (pork + chicken) * 130)
      assert.equal(snapshot.orders.length, 0)
    }
    if (variant === 'initial') {
      await send('炸排骨便當一份', snapshot => exactCart(snapshot, 1, 0))
    }
    else if (variant === 'context') {
      await send('炸雞腿便當一份', snapshot => exactCart(snapshot, 0, 1))
      await send('炸排骨便當呢？', snapshot => exactCart(snapshot, 0, 1))
      await send('3份', snapshot => exactCart(snapshot, 3, 1))
    }
    else {
      await send('炸雞腿便當三份', snapshot => exactCart(snapshot, 0, 3))
      await send('我要炸排骨便當3份。炸雞腿只要1份。', snapshot => exactCart(snapshot, 3, 1))
    }
    report.porkChicken.finalCart = (await state()).cart
  }
  if (scenario === 'customization') {
    const variant = process.env.PB_AUDIT_CUSTOMIZATION_CASE ?? 'all'
    assert(['all', 'notes'].includes(variant))
    report.customization = { variant }
    // Configuration identity, not physical row count, owns the gold: PB may
    // split or merge equal selections but must preserve add-ons and notes.
    const exactConfigurations = (snapshot, dumplingCount, chickenNotes = []) => {
      const groups = new Map()
      for (const line of snapshot.cart) {
        const key = JSON.stringify([line.name, line.extra, line.unitPrice, line.note ?? ''])
        groups.set(key, (groups.get(key) ?? 0) + line.quantity)
        assert.equal(line.subtotal, line.quantity * line.unitPrice)
      }
      const expected = new Map()
      if (dumplingCount > 0)
        expected.set(JSON.stringify(['周氏水餃(最低8顆)', 2, 80, '']), dumplingCount)
      for (const note of chickenNotes) {
        const key = JSON.stringify(['炸雞腿便當', 0, 130, note])
        expected.set(key, (expected.get(key) ?? 0) + 1)
      }
      assert.deepEqual(groups, expected)
      assert.equal(snapshot.cart.reduce((sum, line) => sum + line.subtotal, 0), dumplingCount * 80 + chickenNotes.length * 130)
      assert.equal(snapshot.orders.length, 0)
    }
    if (variant === 'all') {
      await send('我要周氏水餃每份十顆，兩份', snapshot => exactConfigurations(snapshot, 2))
      await send('同樣的水餃再一份', snapshot => exactConfigurations(snapshot, 3))
    }
    const dumplingCount = variant === 'all' ? 3 : 0
    await send('炸雞腿便當一份，請幫我備註「不要蔥」', snapshot => exactConfigurations(snapshot, dumplingCount, ['不要蔥']))
    await send('再加炸雞腿便當一份，一般的，不用備註', snapshot => exactConfigurations(snapshot, dumplingCount, ['不要蔥', '']))
    report.customization = { variant, ...(dumplingCount > 0 ? { dumplingPiecesPerServing: 10, dumplingServings: dumplingCount, dumplingUnitPrice: 80 } : {}), chickenNotes: ['不要蔥', ''], total: dumplingCount * 80 + 260, submitted: false }
  }
  if (scenario === 'semantics') {
    await send('炸排骨便當兩份一共多少錢？', snapshot => assert.equal(snapshot.cart.length, 0))
    await send('先不要加入，回到菜單', snapshot => assert.equal(snapshot.cart.length, 0))
    await send('推薦三樣', snapshot => assert.equal(snapshot.cart.length, 0))
    await send('好', async (snapshot) => {
      assert.equal(snapshot.cart.length, 0, 'Assent after an introduction cannot buy unconfirmed food.')
      const answer = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
      assert.match(answer, /[?？]/, 'Assent after an introduction must clarify the intended purchase.')
    })
    await send('先不要點，回到菜單', snapshot => assert.equal(snapshot.cart.length, 0))
  }
  if (scenario === 'follow-up') {
    await send('我想吃魚', async (snapshot) => {
      assert.equal(snapshot.cart.length, 0)
      const answer = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
      assert.match(answer, /魚丸湯/)
      assert.match(answer, /[?？]/, 'A single-dish recommendation must establish its next question.')
    })
    await send('好，來一份', (snapshot) => {
      assert.equal(snapshot.cart.length, 1)
      assert.equal(snapshot.cart[0].name, '魚丸湯')
      assert.equal(snapshot.cart[0].quantity, 1)
    })
    await send('回到菜單', async () => assert.equal(await native.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').inputValue(), ''))
    await send('我要便當', async (snapshot) => {
      assert.equal(snapshot.cart.length, 1)
      const answer = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
      assert.match(answer, /哪一|哪種|哪道/, 'An unresolved meal choice must ask which meal, not end with a full catalog read.')
      assert.match(answer, /便當/)
      assert.doesNotMatch(answer, /牛肉麵|水餃|蛋花湯/, 'A bento choice must not list unrelated menu categories.')
    })
    await send('炸排骨便當', async (snapshot) => {
      assert.equal(snapshot.cart.length, 1)
      const answer = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
      assert.match(answer, /幾份|多少份/)
    })
    await send('一份', (snapshot) => {
      assert.equal(snapshot.cart.length, 2)
      assert.equal(snapshot.cart.find(line => line.name === '炸排骨便當')?.quantity, 1)
    })
    await send('A套餐兩份、蛋花湯一份', (snapshot) => {
      assert.equal(snapshot.cart.length, 4)
      assert.equal(snapshot.cart.find(line => line.name === 'A套餐')?.quantity, 2)
      assert.equal(snapshot.cart.find(line => line.name === '蛋花湯')?.quantity, 1)
    })
    await send('排骨便當不要了', (snapshot) => {
      assert.equal(snapshot.cart.length, 3)
      assert(!snapshot.cart.some(line => line.name === '炸排骨便當'))
    })
    await send('A套餐改成一份', snapshot => assert.equal(snapshot.cart.find(line => line.name === 'A套餐')?.quantity, 1))
    await send('把A套餐一份換成B套餐一份', (snapshot) => {
      assert.equal(snapshot.cart.length, 3)
      assert(!snapshot.cart.some(line => line.name === 'A套餐'))
      assert.equal(snapshot.cart.find(line => line.name === 'B 套餐')?.quantity, 1)
    })
    await send('回到菜單', async () => assert.equal(await native.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').inputValue(), ''))
    await send('三杯雞一份', snapshot => assert.equal(snapshot.cart.find(line => line.name === '三杯雞便當')?.quantity, 1))
    await send('有蜜汁雞排嗎', snapshot => assert.equal(snapshot.cart.length, 4))
    await send('那我不要了', async (snapshot) => {
      assert.equal(snapshot.cart.length, 4)
      assert.equal(await native.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').inputValue(), '')
    })
    await send('看購物車', () => assert.match(new URL(native.url()).pathname, /\/orders\/create$/))
  }
  if (scenario === 'cart' || scenario === 'reset' || scenario === 'stale-result') {
    if (scenario === 'stale-result') {
      await host.locator('.customer-restart').evaluate((button) => {
        button.dataset.auditLocked = 'false'
        button.auditLockObserver = new MutationObserver(() => {
          if (button.disabled)
            button.dataset.auditLocked = 'true'
        })
        button.auditLockObserver.observe(button, { attributes: true, attributeFilter: ['disabled'] })
      })
    }
    await send('我要炸排骨便當兩份，炸雞腿便當一份', snapshot => assert.equal(snapshot.cart.length, 2))
    if (scenario === 'stale-result') {
      assert.equal(await host.locator('.customer-restart').evaluate((button) => {
        button.auditLockObserver.disconnect()
        return button.dataset.auditLocked
      }), 'true', 'Restart must remain locked while native service operations execute.')
    }
  }
  if (scenario === 'stale-result') {
    // Hold a real completed Main response at the network boundary. Reset and
    // start a different reception before delivering it; old tool proposals must
    // not search, ask questions or change the new visitor's cart.
    const oldSessionId = report.visitorSessionId
    let intercepted = false
    let release
    const released = new Promise(resolve => release = resolve)
    let releaseAudit
    const auditReleased = new Promise(resolve => releaseAudit = resolve)
    const holdAudit = async (route) => {
      if (route.request().postDataJSON()?.content !== 'customer_requested_restart')
        return route.continue()
      const response = await route.fetch()
      await host.evaluate(() => document.documentElement.dataset.auditRestartRecord = 'held')
      await auditReleased
      await route.fulfill({ response }).catch(() => {})
    }
    const hold = async (route) => {
      if (intercepted)
        return route.continue()
      intercepted = true
      const response = await route.fetch()
      const body = await response.body()
      report.staleResult = { oldSessionId, responseStatus: response.status(), responseSha256: createHash('sha256').update(body).digest('hex') }
      await host.evaluate(() => document.documentElement.dataset.auditHeld = 'ready')
      await released
      await route.fulfill({ response, body }).catch(error => report.staleResult.delivery = error.message)
    }
    await context.route('**/api/kiosk/visitor-sessions/*/messages', hold)
    await context.route('**/api/kiosk/visitor-sessions/*/entries', holdAudit)
    try {
      await consolePage.locator('textarea').first().fill('我想吃魚')
      await consolePage.getByRole('button', { name: '模擬辨識並執行', exact: true }).click()
      await host.waitForFunction(() => document.documentElement.dataset.auditHeld === 'ready', undefined, { timeout: 45000 })
      assert.equal(report.staleResult.responseStatus, 200)
      assert(await host.locator('.customer-restart').isEnabled(), 'Model IO alone must not lock an explicit restart.')
      await host.locator('.customer-restart').click()
      await host.waitForFunction(() => document.documentElement.dataset.auditRestartRecord === 'held', undefined, { timeout: 15000 })
      await native.waitForURL(/\/menu\/select-table$/, { timeout: 15000 })
      assert.equal((await state()).cart.length, 0)
      await send('B03', async () => assert.match(await native.locator('.el-select__placeholder').textContent(), /B3/))
      await send('開始點餐', () => assert.match(new URL(native.url()).pathname, /\/menu$/))
      assert.notEqual(report.visitorSessionId, oldSessionId)
      report.staleResult.newSessionId = report.visitorSessionId
      release()
      // Leave time for an incorrectly retained callback to run before asserting.
      await host.waitForTimeout(1500)
      assert.equal(await native.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').inputValue(), '')
      assert.equal((await state()).cart.length, 0)
      assert.doesNotMatch(await host.locator('.message-history').textContent(), /魚丸湯/)
      await send('炸排骨便當一份', (snapshot) => {
        assert.equal(snapshot.cart.length, 1)
        assert.equal(snapshot.cart[0].name, '炸排骨便當')
        assert.equal(snapshot.cart[0].quantity, 1)
      })
      releaseAudit()
      await host.waitForTimeout(500)
      assert.equal((await state()).cart[0]?.quantity, 1)
      assert.match(await host.locator('.message-history').textContent(), /炸排骨便當/)
      console.info('PASS: delayed Main response cannot affect the new reception or its next order.')
    }
    finally {
      release()
      releaseAudit()
      await context.unroute('**/api/kiosk/visitor-sessions/*/messages', hold)
      await context.unroute('**/api/kiosk/visitor-sessions/*/entries', holdAudit)
    }
  }
  if (scenario === 'full') {
    await send('A套餐有什麼', (snapshot, response) => {
      assert.equal(snapshot.cart.length, 0)
      assert.match(response, /水餃/)
      assert.match(response, /蛋花湯/)
      assert.doesNotMatch(response, /沒有可驗證的餐點查詢結果/)
      assert.doesNotMatch(response, /還沒確認這次操作/)
    })
    await send('我要炸排骨便當', (snapshot, response) => {
      assert.equal(snapshot.cart.length, 0)
      assert.match(response, /幾份|多少份/)
    })
    await send('兩份', snapshot => assert.equal(snapshot.cart.reduce((sum, line) => sum + line.quantity, 0), 2))
    await send('炸排骨便當再加兩份', snapshot => assert.equal(snapshot.cart.reduce((sum, line) => sum + line.quantity, 0), 4))
    await send('炸排骨便當改成兩份', snapshot => assert.equal(snapshot.cart.reduce((sum, line) => sum + line.quantity, 0), 2))
    await send('我要周氏水餃每份十顆，兩份', (snapshot) => {
      assert.equal(snapshot.cart.length, 2)
      const dumplings = snapshot.cart.find(line => line.extra === 2)
      assert(dumplings)
      assert.equal(dumplings.quantity, 2)
    })
  }
  await native.evaluate(() => {
    window.__auditCues = []
    window.__auditCueTimes = []
    new MutationObserver(() => {
      for (const cue of document.querySelectorAll('[data-webnavior-presentation][data-mode="presentation"]')) {
        if (cue.dataset.phase !== 'settled')
          continue
        const names = JSON.parse(cue.dataset.productNames)
        if (JSON.stringify(window.__auditCues.at(-1)) !== JSON.stringify(names)) {
          window.__auditCues.push(names)
          window.__auditCueTimes.push(performance.now())
        }
      }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true })
  })
  if (scenario === 'full' || scenario === 'dumpling-follow-up' || scenario === 'recommendation' || scenario === 'recommendation-follow-up') {
    await send('推薦三樣', async () => {
      await native.waitForFunction(() => window.__auditCues.length === 3)
      const cues = await native.evaluate(() => window.__auditCues)
      assert(cues.every(names => names.length === 1))
      assert.equal(new Set(cues.flat()).size, 3)
      report.recommendationCues = cues
      const times = await native.evaluate(() => window.__auditCueTimes)
      report.recommendationIntervalsMs = times.slice(1).map((time, index) => time - times[index])
      assert(report.recommendationIntervalsMs.every(interval => interval >= 1000))
      if (scenario === 'recommendation-follow-up') {
        const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
        assert.match(reply, /您想點哪一道[？?]/, 'Multi-dish recommendations must include a real follow-up question.')
        assert.equal((await state()).cart.length, 0, 'A recommendation must not add anything.')
      }
    })
  }
  if (scenario === 'checkout-flow' || scenario === 'dumpling-assent' || scenario === 'dumpling-follow-up') {
    let answer = '好'
    await send(scenario !== 'dumpling-follow-up' ? '推薦水餃' : '那我要吃水餃', async (snapshot) => {
      assert.equal(snapshot.cart.length, 0)
      const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
      if (scenario !== 'dumpling-follow-up' || /要來一份周氏水餃嗎[？?]/.test(reply)) {
        assert.match(reply, /要來一份周氏水餃嗎[？?]/)
      }
      else {
        assert.match(reply, /周氏水餃.*要幾份[？?]/)
        answer = '一份'
      }
    })
    const beforeMain = report.modelContexts?.length ?? 0
    const beforePlans = report.browserPlanRequests ?? 0
    await send(answer, async (snapshot) => {
      assert.equal(snapshot.cart.length, 1)
      assert.equal(snapshot.cart[0].name, '周氏水餃(最低8顆)')
      assert.equal(snapshot.cart[0].quantity, 1)
      assert.equal(snapshot.cart[0].extra, 0)
      assert.equal(snapshot.cart[0].unitPrice, 64)
      assert.equal(snapshot.orders.length, 0)
      const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
      assert.match(reply, readbackFailure ? /核對|確認購物車/ : /要結帳嗎[？?]/)
      assert.doesNotMatch(reply, /您是指|要幾份|要來一份|要幫您加入|尚未確認您要進行/)
    }, readbackFailure ? 'review' : 'completed')
    if (readbackFailure) {
      await host.waitForFunction(() => !document.querySelector('.service-status'), undefined, { timeout: 30000 })
      assert.equal(await host.getByRole('button', { name: '恢復菜單連線' }).count(), 0, 'Customers must not press a recovery control.')
      const recovered = await state()
      assert.equal(recovered.cart.length, 1)
      assert.equal(recovered.cart[0].quantity, 1, 'Automatic recovery must not replay the addition.')
      assert.equal(recovered.orders.length, 0)
      assert.equal(await app.evaluate(() => globalThis.__auditReadbackFaults), 1)
      report.automaticRecovery = { faultInjected: 1, recoveredWithoutTouch: true, retainedQuantity: 1, submitted: false }
    }
    if (scenario === 'dumpling-assent') {
      assert.equal(report.modelContexts?.length ?? 0, beforeMain, 'Assenting to a complete base-serving offer must not invoke Main.')
      assert.equal(report.browserPlanRequests ?? 0, beforePlans, 'Optional extras must not trigger another semantic plan check after a sealed base-serving assent.')
    }
    report.dumplingAssent = { answer, basePieces: 8, quantity: 1, unitPrice: 64, mainPlannerRequests: (report.modelContexts?.length ?? 0) - beforeMain, browserPlanRequests: (report.browserPlanRequests ?? 0) - beforePlans }
    if (scenario === 'checkout-flow') {
      // Report: Nov15, this chat. The actual invitation's short answer must
      // open cart review without Main and reply-time framing must keep it there.
      const beforeCheckoutMain = report.modelContexts?.length ?? 0
      await send(readbackFailure ? '幫我結帳' : '好', async (snapshot) => {
        assert.equal(snapshot.orders.length, 0)
        assert.match(new URL(native.url()).pathname, /\/orders\/create$/)
        assert.match(await host.locator('[data-chat-message-role="assistant"]').last().textContent(), /餐點、份數和金額正確嗎/)
      })
      report.checkoutInvitation = { openedCart: true, mainPlannerRequests: (report.modelContexts?.length ?? 0) - beforeCheckoutMain }
      for (const query of ['一份幾顆？', '一份水餃有幾顆？']) {
        await send(query, async (snapshot) => {
          assert.equal(snapshot.cart.length, 1)
          assert.equal(snapshot.cart[0].quantity, 1)
          assert.equal(snapshot.orders.length, 0)
          const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
          assert.match(reply, /8\s*顆/)
          assert.doesNotMatch(reply, /要結帳嗎|網站未提供餐點內容|要幾份/)
        })
      }
      const beforeCartConsentMain = report.modelContexts?.length ?? 0
      await send('正確', async (snapshot) => {
        assert.equal(snapshot.orders.length, 0)
        assert.match(new URL(native.url()).pathname, /\/orders\/create$/)
        const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
        assert.match(reply, /發票要用哪種方式/)
        for (const label of ['無載具', '手機載具', '自然人憑證', '統一編號', '捐贈發票'])
          assert(reply.includes(label), `Missing spoken invoice choice: ${label}`)
        assert.doesNotMatch(reply, /餐點、份數和金額正確嗎/)
      })
      report.cartConsent = { advancedToInvoiceChoices: true, mainPlannerRequests: (report.modelContexts?.length ?? 0) - beforeCartConsentMain }
      await send('我要用載具', async (snapshot) => {
        assert.equal(snapshot.orders.length, 0)
        assert.equal(await native.locator('input[type="radio"][value="3"]').isChecked(), true)
        const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
        assert.match(reply, /掃描|輸入/)
        assert.doesNotMatch(reply, /通知手機|電子信箱/)
      })
      await native.getByPlaceholder('請輸入共8碼編號').fill('/AB12345')
      await native.getByPlaceholder('請輸入共8碼編號').press('Enter')
      await send('好了', async (snapshot) => {
        assert.equal(snapshot.invoice.code, '/AB12345')
        assert.equal(snapshot.invoice.phone, '')
        assert.equal(snapshot.orders.length, 0)
        const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
        assert.match(reply, /通知手機|電子信箱/)
        assert.doesNotMatch(reply, /確認送出訂單嗎/)
      })
      assert.match(await host.locator('[data-chat-message-role="assistant"]').last().textContent(), /分段/)
      assert.match(await native.evaluate(() => document.activeElement?.closest('.field')?.textContent ?? ''), /手機/)
      // Report: Nov17, this chat — scroll and the first touch on phone input
      // retired the bound checkout question before the next spoken fragment.
      await native.mouse.wheel(0, 300)
      await native.locator('.field').filter({ has: native.getByText('手機號碼', { exact: true }) }).locator('input').click()
      const keypad = native.getByRole('group', { name: '通知手機數字鍵盤' })
      await keypad.getByRole('button', { name: '清除', exact: true }).click()
      assert.equal((await state()).invoice.phone, '')
      for (const [chunk, count] of [['0912', 4], ['345', 7], ['678', 10]]) {
        await send(chunk, async (snapshot) => {
          assert.equal(snapshot.invoice.phone, '')
          assert.equal(snapshot.invoice.code, '/AB12345')
          assert.equal(snapshot.orders.length, 0)
          const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
          assert.match(reply, count === 10 ? /0 9 1 2 3 4 5 6 7 8.*正確嗎/ : new RegExp(`${count} 碼`))
        })
      }
      await send('正確', async (snapshot) => {
        assert.equal(snapshot.invoice.phone, '0912345678')
        assert.equal(snapshot.orders.length, 0)
        assert.equal(snapshot.invoice.code, '/AB12345')
        const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
        assert.match(reply, /周氏水餃/)
        assert.match(reply, /8\s*顆/)
        assert.match(reply, /總金額64元/)
        assert.match(reply, /確認送出訂單嗎/)
      })
      await send('好', async (snapshot) => {
        assert.equal(snapshot.orders.length, 1)
        assert.equal(snapshot.orders[0].items[0].quantity, 1)
        assert.equal(snapshot.orders[0].total, 64)
        assert.match(new URL(native.url()).pathname, /\/orders\/[^/]+\/choosePayment$/)
        const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
        assert.match(reply, /訂單已送出/)
        assert.doesNotMatch(reply, /已付款|付款成功/)
      })
      const ledger = await native.evaluate(() => fetch('/__lab/ledger').then(response => response.json()))
      assert.equal(ledger.createdOrders, 1, 'The Server must observe exactly one newly committed fixture order.')
      assert.equal(ledger.submissionRequests, 1, 'The fixture must observe exactly one submission transition, not merely one final order.')
      assert.equal(ledger.duplicateSubmissions, 0)
      report.checkoutSubmission = { origin: new URL(native.url()).origin, fixtureOnly: true, nativeOrders: (await state()).orders.length, acceptedFixtureCreation: true, detailsVerified: false, paymentOperated: false, ledger }
    }
    else {
      await send('不要', (snapshot) => {
        assert.equal(snapshot.cart.length, 1)
        assert.equal(snapshot.cart[0].quantity, 1)
        assert.equal(snapshot.orders.length, 0)
      })
    }
  }
  if (scenario === 'matched-recommendations') {
    const names = ['炸雞腿便當', '港式油雞腿便當']
    await send('請推薦炸雞腿便當和港式油雞腿便當給我選', async (snapshot) => {
      assert.equal(snapshot.cart.length, 0)
      const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
      for (const name of names)
        assert(reply.includes(name), `Initial introduction omitted ${name}: ${reply}`)
      await native.waitForFunction(expected => expected.every(name => window.__auditCues.flat().includes(name)), names)
      report.initialChickenCues = await native.evaluate(() => window.__auditCues)
    })
    await send('先不要，回到菜單', snapshot => assert.equal(snapshot.cart.length, 0))
    await native.evaluate(() => {
      window.__auditCues = []
      window.__auditCueTimes = []
    })
    await send('雞腿', async (snapshot) => {
      assert.equal(snapshot.cart.length, 0)
      const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
      for (const name of names)
        assert(reply.includes(name), `A new named search must retain previously introduced ${name}: ${reply}`)
      await native.waitForFunction(expected => expected.every(name => window.__auditCues.flat().includes(name)), names)
      report.repeatedChickenCues = await native.evaluate(() => window.__auditCues)
      assert.match(reply, /[？?]/, 'Matching dishes must retain the next-step selection question.')
    })
    await send('炸雞腿便當', async snapshot => assert.equal(snapshot.cart.length, 0))
    await send('一份', (snapshot) => {
      assert.equal(snapshot.cart.length, 1)
      assert.equal(snapshot.cart[0].name, names[0])
      assert.equal(snapshot.cart[0].quantity, 1)
      assert.equal(snapshot.orders.length, 0)
    })
    await send('先不要結帳', snapshot => assert.equal(snapshot.cart[0].quantity, 1))
    await send('回到菜單', snapshot => assert.equal(snapshot.cart[0].quantity, 1))
    await native.evaluate(() => {
      window.__auditCues = []
      window.__auditCueTimes = []
    })
    await send('推薦其他餐點三樣', async (snapshot) => {
      assert.equal(snapshot.cart.length, 1)
      assert.equal(snapshot.cart[0].quantity, 1)
      await native.waitForFunction(() => new Set(window.__auditCues.flat()).size === 3)
      const introduced = await native.evaluate(() => [...new Set(window.__auditCues.flat())])
      assert(introduced.every(name => !names.includes(name)), 'Other recommendations must exclude the last introduced chicken dishes.')
      report.otherRecommendationCues = introduced
      assert.equal(snapshot.orders.length, 0)
    })
  }
  if (scenario === 'recommendation-follow-up') {
    const shownNames = report.recommendationCues.flat()
    // Select a plain dish that was actually recommended. Optional/required
    // customization is covered separately; never tell the model a gold SKU.
    const selected = await native.evaluate(names => window.pbTest.getCatalog().find(product => names.includes(product.name) && product.price_type === 1 && product.attributes.length === 0), shownNames)
    assert(selected, 'This random batch has no plain dish for the focused quantity follow-up case.')
    const before = report.modelContexts?.length ?? 0
    await send(selected.name, async (snapshot) => {
      assert.equal(snapshot.cart.length, 0)
      const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
      assert.match(reply, /幾份|多少份/)
      assert(reply.includes(selected.name), 'The quantity question must retain the selected recommended dish.')
    })
    await send('兩份', async (snapshot) => {
      assert.equal(snapshot.cart.length, 1)
      assert.equal(snapshot.cart[0].name, selected.name)
      assert.equal(snapshot.cart[0].quantity, 2)
      const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
      assert.match(reply, /要結帳嗎[？?]/)
      assert.doesNotMatch(reply, /尚未送出訂單|要幫.*加入購物車嗎/)
    })
    assert.equal(report.modelContexts?.length ?? 0, before, 'A complete plain recommendation choice/count must not need Main.')
    report.recommendationSelection = { name: selected.name, quantity: 2, followUpMainRequests: 0 }
    await send('不要', (snapshot) => {
      assert.match(new URL(native.url()).pathname, /\/menu$/)
      assert.equal(snapshot.cart.length, 1)
      assert.equal(snapshot.cart[0].quantity, 2)
    })
    await send(`${selected.name}再加一份`, async (snapshot) => {
      assert.equal(snapshot.cart.length, 1)
      assert.equal(snapshot.cart[0].quantity, 3)
      const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
      assert.match(reply, /要結帳嗎[？?]/)
      assert.doesNotMatch(reply, /尚未送出訂單|要幫.*加入購物車嗎/)
    })
    report.checkoutDecline = { stayedOnMenu: true, keptItems: true, continuedOrdering: true }
    const beforeCheckout = report.modelContexts?.length ?? 0
    report.continuedOrderingMainRequests = beforeCheckout - before
    await send('好', (snapshot) => {
      assert.match(new URL(native.url()).pathname, /\/orders\/create$/)
      assert.equal(snapshot.cart.length, 1)
      assert.equal(snapshot.cart[0].quantity, 3)
    })
    assert.equal(report.modelContexts?.length ?? 0, beforeCheckout, 'Checkout assent must not need another Main planning request.')
    report.checkoutAssent = { openedCart: true, submitted: false, mainPlannerRequests: (report.modelContexts?.length ?? 0) - beforeCheckout }
  }
  if (scenario === 'search-missing') {
    for (const request of ['我想吃章魚燒跟一份貢丸湯', '那有棺材板跟魚丸湯嗎？']) {
      const names = request.includes('章魚燒') ? ['章魚燒', '貢丸湯'] : ['棺材板', '魚丸湯']
      await send(request, (snapshot, reply) => {
        assert.equal(snapshot.cart.length, 0)
        for (const name of names)
          assert(reply.includes(name), `Missing query result for ${name}: ${reply}`)
      })
    }
    await send('我要看雞腿飯', async (_snapshot, reply) => assert.match(reply, /雞腿/))
    await send('招牌便當有嗎？', async (snapshot, reply) => {
      assert.equal(snapshot.cart.length, 0)
      assert.match(reply, /招牌便當/)
    })
    await send('水餃有嗎？', async (_snapshot, reply) => {
      assert.match(reply, /水餃/)
      assert(await native.getByRole('heading', { name: /水餃/ }).count() > 0, 'A new search must escape the empty previous filter.')
    })
  }
  if (scenario === 'full' || scenario === 'search') {
    await send('有蜜汁雞排嗎', async (snapshot) => {
      assert.equal(snapshot.cart.length, scenario === 'full' ? 2 : 0)
      assert.match(await native.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').inputValue(), /雞排/)
    })
    await send('那我不要了', async () => assert.equal(await native.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').inputValue(), ''))
  }
  if (scenario === 'full' || scenario === 'cart') {
    await send('看A套餐', async () => assert.equal(await native.getByRole('dialog').count(), 1))
    await send('先不要選這個了，幫我關掉', async (snapshot) => {
      assert.equal(await native.getByRole('dialog').count(), 0)
      assert.equal(snapshot.cart.length, 2)
    })
    await send('看購物車', () => assert.match(new URL(native.url()).pathname, /\/orders\/create$/))
    await native.getByRole('radio', { name: '手機載具', exact: true }).check()
    await native.getByPlaceholder('請輸入共8碼編號').fill('/ABC1234')
    await send('炸排骨便當改成一份', (snapshot) => {
      assert.equal(snapshot.cart.find(line => line.name === '炸排骨便當').quantity, 1)
      assert.equal(snapshot.invoice.code, '/ABC1234')
      assert.equal(snapshot.orders.length, 0)
    })
  }
  if (!['service-boundary', 'dumpling-cart-edit', 'search-missing'].includes(scenario)) {
    let closingVisitorSessionId = report.visitorSessionId
    assert(closingVisitorSessionId)
    report.nativeHeapBeforeIdle = await inspector.send('Runtime.getHeapUsage')
    assert.equal(await native.evaluate(() => performance.getEntriesByType('resource').filter(entry => new URL(entry.name).pathname === '/@vite/client').length), 0)
    const manualReset = scenario === 'follow-up' || scenario === 'customization' || scenario === 'pork-chicken' || scenario === 'cart-admission' || scenario === 'checkout-flow' || scenario === 'dumpling-follow-up' || scenario === 'dumpling-assent' || scenario === 'matched-recommendations' || scenario === 'table-guidance' || scenario === 'reset' || scenario === 'stale-result' || scenario === 'recommendation-follow-up'
    if (manualReset) {
      await host.locator('.customer-restart').click()
    }
    else {
      if (acceleratedIdle)
        await host.clock.fastForward(180000)
      await host.locator('.idle-confirmation').waitFor({ timeout: acceleratedIdle ? 15000 : 195000 })
      if (scenario === 'idle') {
        await send('雞腿飯兩份', snapshot => assert.equal(snapshot.cart.length, 0))
        // Discarding a request intentionally does not extend the deadline. Test
        // continuing in a fresh round instead of spending its 15s on two model calls.
        // A slow synthetic renderer may already have reached that deadline while
        // send() verifies its receipt; a completed reset is also the correct effect.
        await native.waitForURL(/\/menu\/select-table$/, { timeout: 45000 })
        await send('B03', async () => assert.match(await native.locator('.el-select__placeholder').textContent(), /B3/))
        await send('開始點餐', () => assert.match(new URL(native.url()).pathname, /\/menu$/))
        closingVisitorSessionId = report.visitorSessionId
        await host.locator('.idle-confirmation').waitFor({ timeout: 195000 })
        await send('我還沒點完，繼續吧', snapshot => assert.equal(snapshot.cart.length, 0))
        assert.equal(await host.locator('.idle-confirmation').count(), 0)
        assert.match(new URL(native.url()).pathname, /\/menu$/)
        await host.locator('.idle-confirmation').waitFor({ timeout: 195000 })
        // A returned FAST_ACTION proves a semantic end; merely seeing the page
        // reset would also pass if the ordinary countdown silently expired.
        const ended = host.waitForResponse(async response => /\/api\/kiosk\/interaction-decisions(?:\/[^/?]+)?$/.test(new URL(response.url()).pathname) && response.ok() && (await response.json()).actionId === 'session:end', { timeout: 30000 })
        await consolePage.locator('textarea').first().fill('不用了，結束點餐')
        await consolePage.getByRole('button', { name: '模擬辨識並執行', exact: true }).click()
        const decision = await (await ended).json()
        assert.equal(decision.kind, 'FAST_ACTION')
        report.idleEndDecision = decision
      }
      else if (acceleratedIdle) {
        await host.clock.fastForward(15000)
      }
    }
    await native.waitForURL(/\/menu\/select-table$/, { timeout: 30000 })
    await native.waitForFunction(() => window.pbTest.getState().cart.length === 0)
    report.nativeHeapAfterIdle = await inspector.send('Runtime.getHeapUsage')
    assert(report.nativeHeapAfterIdle.usedSize < report.nativeHeapBeforeIdle.usedSize + 64 * 1024 * 1024)
    assert.equal((await state()).orders.length, scenario === 'checkout-flow' ? 1 : 0)
    report.steps.push({ text: manualReset ? 'manual-reset' : 'idle-reset', ...(manualReset ? { manual: true } : acceleratedIdle ? { clockAdvancedMs: 195000 } : { realTime: true }), path: new URL(native.url()).pathname })
    console.info(manualReset ? 'PASS: actual Host restart clears the cart and returns to table entry.' : 'PASS: actual Host idle countdown clears the cart and returns to table entry.')
    if (acceleratedIdle)
      await host.clock.setSystemTime(Date.now())
    await send('A03', async (snapshot) => {
      assert.match(await native.locator('.el-select__placeholder').textContent(), /A3/)
      if (scenario === 'table-guidance') {
        const reply = await host.locator('[data-chat-message-role="assistant"]').last().textContent()
        assert.doesNotMatch(reply, /先找到?座位|再(?:回來)?告訴我您?的?桌號/)
        assert.match(reply, /A3/)
        assert.match(reply, /請說[「『]開始點餐[」』]/)
        assert.match(reply, /按鈕/)
        assert.match(new URL(native.url()).pathname, /\/select-table$/)
      }
      assert.equal(snapshot.cart.length, 0)
      assert(report.visitorSessionId)
      assert.notEqual(report.visitorSessionId, closingVisitorSessionId)
    })
    report.previousVisitorSessionId = closingVisitorSessionId
    if (scenario === 'checkout-flow') {
      await send('開始點餐', () => assert.match(new URL(native.url()).pathname, /\/menu$/))
      await send('周氏水餃一份', (snapshot) => {
        assert.equal(snapshot.cart.length, 1)
        assert.equal(snapshot.cart[0].quantity, 1)
        assert.equal(snapshot.cart[0].unitPrice, 64)
        assert.equal(snapshot.orders.length, 1, 'A new reception must preserve the previous unpaid order without resubmitting it.')
      })
      report.checkoutSubmission.nextReceptionCanOrder = true
    }
    else if (scenario === 'pork-chicken') {
      await send('開始點餐', () => assert.match(new URL(native.url()).pathname, /\/menu$/))
      await send('炸排骨便當一份', (snapshot) => {
        assert.equal(snapshot.cart.length, 1)
        assert.equal(snapshot.cart[0].name, '炸排骨便當')
        assert.equal(snapshot.cart[0].quantity, 1)
        assert.equal(snapshot.cart[0].unitPrice, 130)
        assert.equal(snapshot.orders.length, 0)
      })
      report.porkChicken.nextReceptionCanOrder = true
    }
    console.info(manualReset ? 'PASS: a fresh visitor can select A03 after restart without inheriting the old cart.' : 'PASS: a fresh visitor can select A03 after idle reset without inheriting the old cart.')
  }
  await host.screenshot({ path: '/tmp/pb-ordering-audit.png', timeout: 5000 }).catch(error => report.errors.push(['screenshot', error.message]))
  assert.equal(report.browserEffectRequests ?? 0, 0, 'An issued operation must never request a second semantic effect judgment.')
  for (const admission of report.browserAdmissions ?? []) {
    if (admission.choice === 'ALLOW') {
      assert.equal(admission.admission, 'issued-plan')
      assert.deepEqual(admission.stages, ['effect'], 'Admission records exact plan matching only, not another purpose/model vote.')
    }
  }
  console.info('PASS: actual built Host → local API → configured Jev/Main → native fixture → dialogue.')
}
catch (error) {
  report.failure = error.message
  if (host) {
    report.screen = await host.locator('body').textContent().catch(() => '')
    await host.screenshot({ path: '/tmp/pb-ordering-audit-failure.png', timeout: 5000 }).catch(() => {})
  }
  if (consolePage)
    report.console = await consolePage.locator('body').textContent().catch(() => '')
  if (native) {
    await native.screenshot({ path: '/tmp/pb-ordering-audit-native-failure.png', timeout: 5000 }).catch(() => {})
    report.native = await native.evaluate(() => ({ url: location.href, viewport: { width: innerWidth, height: innerHeight }, scrollY, cues: window.__auditCues, cards: [...document.querySelectorAll('main h4')].map(heading => ({ name: heading.textContent, rect: heading.getBoundingClientRect().toJSON() })) })).catch(() => undefined)
  }
  throw error
}
finally {
  clearInterval(heapTimer)
  if (app)
    report.rendererExits = await app.evaluate(() => globalThis.__auditRendererExits).catch(() => undefined)
  if (report.failure && report.visitorSessionId && host) {
    // Retain the synthetic transcript, but close only this runner's own visitor.
    await host.evaluate(async (id) => {
      await fetch(`/api/kiosk/visitor-sessions/${encodeURIComponent(id)}/end`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'cancelled' }) })
    }, report.visitorSessionId).catch(() => {})
  }
  await writeFile(reportPath, JSON.stringify(report, null, 2))
  await app?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await rm(profile, { recursive: true, force: true })
}
