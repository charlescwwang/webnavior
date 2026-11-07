import process from 'node:process'

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { chromium } from 'playwright'
import { build } from 'vite'

import { CookieCompatibility } from '../apps/stage-kiosk/scripts/browserCookieCompatibility.mjs'
import { launchFirefox } from '../apps/stage-kiosk/scripts/firefoxBrowser.mjs'
import { prepareFirefoxIframeLogin } from '../apps/stage-kiosk/scripts/firefoxIframeLogin.mjs'

// NOTICE: Integration experiment against the real local Kiosk, not a fixture.
// The temporary controller injects a PB-only Eventa peer. It is not a deployed
// Companion, vendor integration, or acceptance of cart/order/payment.
const root = resolve(import.meta.dirname, '..')
const browserName = process.argv.includes('--firefox') ? 'firefox' : 'chromium'
const profileDirectory = resolve(homedir(), '.webnavior', browserName === 'firefox' ? 'pb-prototype-firefox' : 'pb-prototype')
const menuUrl = 'https://app.esgpb.com/order/store/1kgJeql/pick_up/menu'
const outputDirectory = resolve(root, 'output/playwright', browserName === 'firefox' ? 'pb-firefox' : 'iframe-probe-20261029')
await mkdir(outputDirectory, { recursive: true })
const scratch = await mkdtemp(resolve(tmpdir(), 'airi-webnavior-pb-'))
let context
let page
let preparingLogin = true
process.once('SIGTERM', () => {
  void context?.close()
})
const requests = []
let clientModuleUrl
let retryModuleUrl
let staffModuleUrl
try {
  await build({ configFile: false, root: resolve(root, 'packages/stage-ui'), build: { outDir: scratch, emptyOutDir: false, minify: false, lib: { entry: 'src/services/pbBrowserBridgePrototype.ts', name: 'PbBrowserBridgePrototype', formats: ['iife'], fileName: () => 'bridge.js' } } })
  const bridge = await readFile(resolve(scratch, 'bridge.js'), 'utf8')
  // Use a dedicated browser profile, never the personal Chrome profile or a
  // plaintext storageState export. Only build output is removed at shutdown.
  await mkdir(profileDirectory, { recursive: true, mode: 0o700 })
  const browserEnvironment = { ...process.env }
  delete browserEnvironment.ESGPB_EMAIL
  delete browserEnvironment.ESGPB_PASSWORD
  const headless = process.argv.includes('--headless')
  context = browserName === 'firefox'
    ? await launchFirefox(profileDirectory, { headless, env: browserEnvironment })
    : await chromium.launchPersistentContext(profileDirectory, { channel: 'chrome', headless, locale: 'zh-TW', viewport: { width: 1080, height: 1920 }, env: browserEnvironment })
  // A retained tab can still be restoring its old Inertia/Kiosk navigation.
  // Start one controlled tab while retaining profile authentication/cookies.
  page = await context.newPage()
  // NOTICE: Playwright 1.60 BiDi BidiRequest hard-codes postDataBuffer=null
  // (coreBundle.js, bidiNetworkManager.ts). Observe this test page's real fetch
  // inputs instead. No PB requests, headers, credentials or foreign frames are
  // recorded; the wrapper forwards each call once without modifying it.
  await page.addInitScript(() => {
    if (location.origin !== 'http://localhost:5169')
      return
    window.__kioskAcceptanceRequests = []
    const send = window.fetch
    window.fetch = function (resource, init) {
      const url = new URL(typeof resource === 'string' ? resource : resource.url, location.href)
      if (url.origin === 'http://localhost:5168' && /\/api\/kiosk\/visitor-sessions\/[^/]+\/(?:messages|entries|browser-answer)$/.test(url.pathname) && init?.method === 'POST' && typeof init.body === 'string') {
        window.__kioskAcceptanceRequests.push({ path: url.pathname.split('/').at(-1), input: JSON.parse(init.body) })
        if (window.__kioskAcceptanceRequests.length > 256)
          window.__kioskAcceptanceRequests.shift()
      }
      return Reflect.apply(send, this, [resource, init])
    }
  })
  for (const restored of context.pages()) {
    if (restored !== page)
      await restored.close()
  }
  console.info('Browser under test:', browserName, context.browser()?.version())
  page.setDefaultTimeout(15000)
  // Inertia shares auth.user with PB's own menu. Inspect only presence; no
  // identity, session value, or password enters diagnostics or Agent tools.
  let authenticated = false
  const observeLogin = async (response) => {
    if (new URL(response.url()).origin !== 'https://app.esgpb.com' || !response.ok() || !response.headers()['content-type']?.includes('application/json'))
      return
    try {
      const body = await response.json()
      authenticated ||= Boolean(body.props?.auth?.user)
    }
    catch { /* Non-page API responses cannot establish login. */ }
  }
  page.on('response', observeLogin)
  await page.goto(menuUrl, { waitUntil: 'domcontentloaded' })
  // PB may replace its initial anonymous document during menu hydration. Let
  // that navigation settle before inspecting auth or opening the login page.
  await page.waitForLoadState('networkidle')
  authenticated = await page.evaluate(() => {
    const initial = document.querySelector('[data-page]')?.getAttribute('data-page')
    return initial ? Boolean(JSON.parse(initial).props?.auth?.user) : false
  })
  if (!authenticated) {
    await page.goto('https://app.esgpb.com/order/login?store_hash=1kgJeql&flow_type=pick_up', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle')
    await page.locator('input[type=password]').waitFor({ state: 'visible', timeout: 30000 })
    const loginPage = new URL(page.url())
    if (loginPage.origin !== 'https://app.esgpb.com' || loginPage.pathname !== '/order/login')
      throw new Error('The observed login form is outside the approved PB login page.')
    console.info('PB needs one manual sign-in in the dedicated browser. Select Remember me if offered; the Agent never handles credentials.')
    while (!authenticated && !page.isClosed()) {
      authenticated = await page.evaluate(() => {
        const initial = document.querySelector('[data-page]')?.getAttribute('data-page')
        return initial ? Boolean(JSON.parse(initial).props?.auth?.user) : false
      }).catch(() => false) || authenticated
      if (!authenticated)
        await page.waitForTimeout(1000)
    }
    if (!authenticated)
      throw new Error('Manual sign-in was not completed.')
    await page.goto(menuUrl, { waitUntil: 'domcontentloaded' })
    authenticated = await page.evaluate(() => {
      const initial = document.querySelector('[data-page]')?.getAttribute('data-page')
      return initial ? Boolean(JSON.parse(initial).props?.auth?.user) : false
    })
    if (!authenticated)
      throw new Error('PB did not confirm login after reloading the menu.')
  }
  page.off('response', observeLogin)
  preparingLogin = false
  console.info('PB login confirmed by the server-rendered menu; reusing the dedicated profile.')
  page.on('console', (message) => {
    if (message.text().startsWith('Webnavior PB'))
      console.info(message.text())
  })
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/kiosk/src/services/interactiveServiceClient.ts')
      clientModuleUrl = response.url()
    if (new URL(response.url()).pathname === '/kiosk/src/services/admin-session.ts')
      staffModuleUrl = response.url()
    if (new URL(response.url()).pathname === '/kiosk/src/services/kioskConversationRetry.ts')
      retryModuleUrl = response.url()
    if (new URL(response.url()).pathname.endsWith('/interactiveServiceClient.ts'))
      console.info('Kiosk client module:', response.url())
    if (response.url().endsWith('/api/kiosk/bootstrap') && response.ok())
      void response.json().then(body => console.info('Assigned service:', body.profile?.snapshot.interactiveService.url))
    const url = new URL(response.url())
    if (url.origin === 'https://app.esgpb.com')
      requests.push({ method: response.request().method(), path: url.pathname, queryKeys: [...url.searchParams.keys()], status: response.status() })
  })
  const injected = new WeakSet()
  const compatibleFrames = new WeakSet()
  const attachments = new WeakMap()
  // Only Chromium uses CDP. Firefox prepares the approved cookies through its
  // own context API, while retaining SameSite and storage-partitioning checks.
  const compatibility = browserName === 'chromium' ? new CookieCompatibility(context, 'https://app.esgpb.com') : undefined
  await page.waitForLoadState('networkidle')
  if (compatibility) {
    const initialSession = await context.newCDPSession(page)
    await compatibility.prepareRetainedSession(initialSession)
  }
  else {
    console.info('Firefox approved login preparation:', await prepareFirefoxIframeLogin(context))
  }
  function attach(frame) {
    if (attachments.has(frame))
      return attachments.get(frame)
    const pending = attachDocument(frame).finally(() => attachments.delete(frame))
    attachments.set(frame, pending)
    return pending
  }
  async function attachDocument(frame) {
    if (injected.has(frame) || frame.url().split('?')[0] !== 'https://app.esgpb.com/order/store/1kgJeql/pick_up/menu')
      return
    try {
      if (compatibility && !compatibleFrames.has(frame)) {
        compatibleFrames.add(frame)
        const session = await context.newCDPSession(frame)
        await compatibility.attach(session)
        // Retained cookies were prepared before the first iframe request.
        // Reloading here aborts PB's in-flight lazy category initialization.
      }
      await frame.evaluate(bridge)
      injected.add(frame)
      console.info('PB bridge attached to the actual Kiosk child document.')
    }
    catch (error) {
      // A replaced document is never retried for an action; only binding may repeat.
      console.info('PB binding not ready:', error.message)
    }
  }
  page.on('framenavigated', (frame) => {
    injected.delete(frame)
    void attach(frame)
  })
  const bootstrap = page.waitForResponse(response => response.url().endsWith('/api/kiosk/bootstrap') && response.request().method() === 'GET', { timeout: 60000 })
  // Navigation can fail first. Observe this wait's rejection immediately so
  // shutdown cannot replace the original error with an unhandled wait failure.
  void bootstrap.catch(() => {})
  await page.goto('http://localhost:5169/kiosk/#/', { waitUntil: 'domcontentloaded' })
  console.info('Loaded actual Kiosk entry.')
  const identity = await bootstrap
  if (identity.status() === 401) {
    const registered = page.waitForResponse(response => response.url().endsWith('/api/kiosk/development/register') && response.request().method() === 'POST', { timeout: 30000 })
    void registered.catch(() => {})
    // Registration replaces the entire screen and starts the external iframe.
    // Wait for the Server receipt instead of click's implicit navigation wait.
    await page.getByRole('button', { name: '建立測試設備', exact: true }).click({ noWaitAfter: true })
    if (!(await registered).ok())
      throw new Error('Development Kiosk registration was rejected.')
    console.info('Registered the dedicated local Kiosk device.')
  }
  else if (!identity.ok()) {
    throw new Error('Could not verify the retained Kiosk device.')
  }
  else {
    console.info('Reused the existing dedicated Kiosk device.')
  }
  await page.screenshot({ path: resolve(outputDirectory, 'webnavior-pb-loading.png') })
  console.info('Current iframe URLs:', page.frames().map(frame => frame.url().split('?')[0]))
  await page.frameLocator('iframe').getByRole('heading', { name: /沙崙AI創新應用大樓店/ }).waitFor({ timeout: 90_000 })
  for (const frame of page.frames())
    await attach(frame)
  let embeddedPage = page.frames().find(frame => frame.url().split('?')[0] === menuUrl)
  await embeddedPage?.waitForLoadState('networkidle')
  const embeddedLogin = embeddedPage && await embeddedPage.evaluate(() => {
    const initial = document.querySelector('[data-page]')?.getAttribute('data-page')
    return initial ? Boolean(JSON.parse(initial).props?.auth?.user) : false
  })
  if (!embeddedLogin)
    throw new Error(`PB iframe did not retain the confirmed first-party login (browser=${browserName}).`)
  console.info('PB iframe retained the confirmed login.')
  async function readCart() {
    const current = page.frames().find(frame => frame.url().split('?')[0] === menuUrl)
    if (!current)
      throw new Error('Approved PB document is unavailable for cart verification.')
    return current.evaluate(async () => {
      // A normal GET returns fresh Inertia props without relying on its version
      // handshake, and without navigating to or submitting the checkout form.
      const response = await fetch('/order/store/1kgJeql/pick_up/orders/create')
      if (!response.ok)
        throw new Error(`Cart read failed: ${response.status}`)
      const html = new DOMParser().parseFromString(await response.text(), 'text/html')
      const { props } = JSON.parse(html.querySelector('[data-page]').getAttribute('data-page'))
      if (props.order === null && props.subtotal === 0 && (props.details == null || (Array.isArray(props.details) && !props.details.length)))
        return { subtotal: 0, lines: [] }
      if (!props.order || !Array.isArray(props.details) || !Number.isFinite(props.subtotal))
        throw new Error('PB cart shape changed; cannot verify its contents.')
      // Never copy buyer/account/invoice data into test artifacts.
      return { subtotal: props.subtotal, lines: props.details.map(detail => ({ id: detail.id, quantity: detail.amount, unitPrice: detail.unit_price, name: detail.item?.product?.name ?? detail.item?.name })) }
    })
  }
  async function customerTurn(text) {
    await page.evaluate(() => {
      window.__kioskAcceptanceRequests.length = 0
    })
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '停止語音')?.click())
    await page.getByPlaceholder('例如：我要一個周氏蝦捲招牌便當', { exact: true }).fill(text)
    const started = page.waitForResponse(response => /\/api\/kiosk\/visitor-sessions\/[^/]+\/messages$/.test(new URL(response.url()).pathname))
    await page.getByRole('button', { name: '模擬辨識並執行', exact: true }).click()
    await started
    await page.waitForFunction(() => document.querySelector('button.customer-restart')?.disabled === false, undefined, { timeout: 60000 })
    const actual = await page.getByRole('region', { name: '與虛擬服務員對話', exact: true }).locator('p').last().textContent()
    const exchanges = await page.evaluate(() => window.__kioskAcceptanceRequests.splice(0))
    const receipts = exchanges.flatMap(({ input }) => input.kind === 'tool_result' ? [{ name: input.metadata?.name, content: input.content }] : input.toolResults ?? []).map((receipt) => {
      let payload
      try {
        payload = JSON.parse(receipt.content)
      }
      catch {
        payload = { ok: false, error: receipt.content }
      }
      return { name: receipt.name, payload }
    })
    const pending = receipts.findLast(receipt => receipt.payload.pendingCustomerChoice)?.payload.pendingCustomerChoice
    const step = { text, actual, pending, receipts, answers: exchanges.filter(item => item.path === 'browser-answer') }
    console.info('Customer turn:', JSON.stringify({ text, actual, purpose: pending?.purpose, answerCalls: step.answers.length }))
    return step
  }

  async function staffReviewForTest() {
    // This controller is the authorized test operator. Seed the already-tested
    // local PIN-session state, then use the REAL review/checkbox/resume UI.
    // This fixture setup is not acceptance of PIN authentication itself.
    if (!staffModuleUrl)
      throw new Error('Local staff-session module was not observed.')
    await page.evaluate(async (resource) => {
      const { beginKioskAdminSession } = await import(resource)
      beginKioskAdminSession()
      location.hash = '#/?admin=true'
    }, staffModuleUrl)
    const panel = page.getByRole('region', { name: '外站購物車交接', exact: true })
    await panel.waitFor()
    const prepare = panel.getByRole('button', { name: '準備本次接待', exact: true })
    if (await prepare.isVisible())
      await prepare.click()
    await panel.getByRole('button', { name: '檢視目前購物車', exact: true }).click()
    const checkbox = panel.getByRole('switch')
    await Promise.race([checkbox.waitFor(), panel.getByRole('alert').waitFor().then(async () => {
      throw new Error(`Staff review refused: ${await panel.getByRole('alert').textContent()}`)
    })])
    const current = await readCart()
    const rendered = await panel.getByRole('listitem').allTextContents()
    if (rendered.length !== current.lines.length || current.lines.some(line => !rendered.some(text => text.includes(line.name) && text.includes(`× ${line.quantity}`))))
      throw new Error('Staff UI did not show the actual reviewed cart.')
    await checkbox.click()
    await page.evaluate(() => {
      window.__kioskAcceptanceRequests.length = 0
    })
    await panel.getByRole('button', { name: '確認後繼續這筆餐點', exact: true }).click()
    await page.waitForFunction(() => window.__kioskAcceptanceRequests.some(request => request.path === 'entries' && request.input.content === 'browser_cart_reviewed'))
    await page.getByRole('button', { name: '關閉管理員模式', exact: true }).click()
    console.info('Test operator reviewed the real unchanged cart and resumed the same in-progress test session. PIN authentication not under test.')
  }

  const connecting = page.getByText('正在連線助手操作功能，您也可直接操作服務畫面。', { exact: true })
  await connecting.waitFor({ state: 'hidden', timeout: 20000 })
  const recover = page.getByRole('button', { name: '恢復菜單連線', exact: true })
  if (await recover.isVisible()) {
    await recover.click()
    await connecting.waitFor({ state: 'hidden', timeout: 20000 })
    await recover.waitFor({ state: 'hidden', timeout: 15000 })
  }
  await writeFile(resolve(outputDirectory, 'webnavior-pb-ready.txt'), await page.locator('body').ariaSnapshot())
  console.info('Real local Kiosk loaded the published PB store; checking Agent execution.')
  if (process.argv.includes('--recovery-diagnose')) {
    const result = await page.evaluate(async (url) => {
      const { interactiveServiceClient: client } = await import(url)
      return client.execute(client.tools.value.find(tool => tool.name === 'browser_recovery_context'), {})
    }, clientModuleUrl)
    console.info('Read-only PB recovery diagnostic:', JSON.stringify(result))
  }
  const writeTests = ['--option-cases', '--cart-cases', '--cart-smoke', '--cart-guard-cases', '--question-cases', '--handoff-cases', '--addon-cases']
  if (writeTests.some(flag => process.argv.includes(flag)))
    await staffReviewForTest()
  if (process.argv.includes('--conversation-cases')) {
    const baseline = await readCart()
    const results = []
    for (const testCase of [{ text: '你好', expected: '您好' }, { text: '你聽得到嗎？', expected: '有收到' }, { text: '謝謝', expected: '好的' }]) {
      const names = []
      const capture = (request) => {
        if (/\/api\/kiosk\/visitor-sessions\/[^/]+\/messages$/.test(new URL(request.url()).pathname) && request.method() === 'POST')
          names.push(...(request.postDataJSON().toolResults ?? []).map(result => result.name))
      }
      page.on('request', capture)
      await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '停止語音')?.click())
      await page.getByPlaceholder('例如：我要一個周氏蝦捲招牌便當', { exact: true }).fill(testCase.text)
      const started = page.waitForResponse(response => /\/api\/kiosk\/visitor-sessions\/[^/]+\/messages$/.test(new URL(response.url()).pathname))
      await page.getByRole('button', { name: '模擬辨識並執行', exact: true }).click()
      await started
      await page.waitForFunction(() => document.querySelector('button.customer-restart')?.disabled === false, undefined, { timeout: 60000 })
      page.off('request', capture)
      const actual = await page.getByRole('region', { name: '與虛擬服務員對話', exact: true }).locator('p').last().textContent()
      const passed = actual?.includes(testCase.expected) && names.length > 0 && names.every(name => name === 'browser_respond')
      results.push({ ...testCase, actual, tools: names, passed })
      console.info('Conversation case:', JSON.stringify(results.at(-1)))
    }
    const result = { cases: results, cartPreserved: JSON.stringify(await readCart()) === JSON.stringify(baseline), submittedOrder: false }
    await writeFile(resolve(outputDirectory, 'conversation-cases.json'), JSON.stringify(result, null, 2))
    if (results.some(result => !result.passed) || !result.cartPreserved)
      process.exitCode = 1
  }
  if (process.argv.includes('--scope-cases')) {
    const before = await readCart()
    const requestIndex = requests.length
    const originalUrl = embeddedPage.url()
    let receipt
    try {
      // Same-document navigation preserves injected listeners. A menu-only
      // bridge must still refuse access when the customer leaves the menu.
      await embeddedPage.evaluate(() => history.pushState({}, '', '/order/store/1kgJeql/pick_up/orders/create'))
      receipt = await page.evaluate(async (url) => {
        const { interactiveServiceClient: client } = await import(url)
        return client.execute(client.tools.value.find(tool => tool.name === 'browser_cart_get'), { includeCatalog: true })
      }, clientModuleUrl)
    }
    finally { await embeddedPage.evaluate(url => history.replaceState({}, '', url), originalUrl) }
    const after = await readCart()
    const vendorWrites = requests.slice(requestIndex).filter(request => ['POST', 'PUT', 'DELETE'].includes(request.method)).length
    const result = { passed: receipt?.ok === false && receipt?.status === 'rejected' && receipt?.effect === 'none', receipt, cartPreserved: JSON.stringify(before) === JSON.stringify(after), vendorWrites, submittedOrder: false }
    await writeFile(resolve(outputDirectory, 'scope-cases.json'), JSON.stringify(result, null, 2))
    console.info('Menu scope boundary:', JSON.stringify({ passed: result.passed, cartPreserved: result.cartPreserved, vendorWrites }))
    if (!result.passed || !result.cartPreserved || vendorWrites)
      process.exitCode = 1
  }
  if (process.argv.includes('--catalog-cases')) {
    const before = await readCart()
    const requestIndex = requests.length
    const lookup = await page.evaluate(async (url) => {
      const { interactiveServiceClient: client } = await import(url)
      const call = async (name, input) => client.execute(client.tools.value.find(tool => tool.name === name), input)
      const current = await call('browser_cart_get', { includeCatalog: true })
      const expected = current.products.filter(product => product.kind === 'product' && product.configurations.length && current.products.filter(candidate => candidate.name === product.name).length === 1).slice(0, 2)
      if (!expected.length)
        throw new Error('No unambiguous configurable current products for lookup.')
      const result = await call('browser_product_get', { names: expected.map(product => product.name) })
      const passed = result.ok === true && result.dataOnly === true && result.cart.version === current.cart.version && expected.every(product => result.products.some(candidate => candidate.ref === product.ref && candidate.price === product.price && candidate.configurations[0]?.version === product.configurations[0].version))
      return { passed, expected: expected.map(product => ({ ref: product.ref, name: product.name })), result }
    }, clientModuleUrl)
    const after = await readCart()
    const vendorWrites = requests.slice(requestIndex).filter(request => ['POST', 'PUT', 'DELETE'].includes(request.method)).length
    const result = { ...lookup, cartPreserved: JSON.stringify(before) === JSON.stringify(after), vendorWrites, kind: 'read-only-real-catalog-contract', submittedOrder: false }
    await writeFile(resolve(outputDirectory, 'catalog-cases.json'), JSON.stringify(result, null, 2))
    console.info('Current catalog lookup:', JSON.stringify({ passed: result.passed, cartPreserved: result.cartPreserved, vendorWrites }))
    if (!result.passed || !result.cartPreserved || vendorWrites)
      process.exitCode = 1
  }
  if (process.argv.includes('--semantic-cases')) {
    const before = await readCart()
    const requestIndex = requests.length
    const results = await page.evaluate(async (url) => {
      const { interactiveServiceClient: client } = await import(url)
      const facts = await client.execute(client.tools.value.find(tool => tool.name === 'browser_cart_get'), { includeCatalog: true })
      const [first, second] = facts.products
      if (!first || !second)
        throw new Error('Semantic contract probe needs two actual products.')
      async function api(path, body) {
        const response = await fetch(`http://localhost:5168/api/kiosk${path}`, { method: body ? 'POST' : 'GET', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
        if (!response.ok)
          throw new Error(`Semantic probe API ${response.status}`)
        return response.json()
      }
      const bootstrap = await api('/bootstrap')
      const { session } = await api('/visitor-sessions', { serviceId: bootstrap.profile.snapshot.interactiveService.id })
      const cases = [
        { id: 'inquiry-availability', transcript: `${first.name}跟${second.name}都有嗎？`, action: 'add', description: `新增${first.name}一份`, expected: 'READ_ONLY' },
        { id: 'inquiry-quantity-price', transcript: `${first.name}兩份多少錢？`, action: 'add', description: `新增${first.name}兩份`, expected: 'READ_ONLY' },
        { id: 'quantity-preserve-other', deltas: [{ name: first.name, kind: 'cart_line', mode: 'set', quantity: 2 }], transcript: `${first.name}改兩份，不要換${second.name}。`, action: 'quantity', description: `將${first.name}總數設為兩份，其他餐點保留`, expected: 'ALLOW' },
        { id: 'forbidden-replacement', transcript: `${first.name}改兩份，不要換${second.name}。`, action: 'replace', description: `移除${second.name}，換成${first.name}一份`, expected: 'DIFFERENT_OPERATION', requiredAction: 'quantity' },
        { id: 'forbidden-remove-first', transcript: `${first.name}不要了，改${second.name}一份。`, action: 'remove', description: `只移除${first.name}`, expected: 'DIFFERENT_OPERATION', requiredAction: 'replace' },
        { id: 'complete-replacement', deltas: [{ name: first.name, kind: 'cart_line', mode: 'remove', quantity: 1 }, { name: second.name, kind: 'product', mode: 'increase', quantity: 1 }], storeFacts: `PB 指定原行為「${first.name}」1份。`, transcript: `${first.name}不要了，改${second.name}一份。`, action: 'replace', description: `先加入${second.name}一份並核對，再移除原${first.name}行`, expected: 'ALLOW' },
        { id: 'multi-first', deltas: [{ name: first.name, kind: 'product', mode: 'increase', quantity: 1 }], transcript: `${first.name}、${second.name}各一份。`, action: 'add', description: `新增「${first.name}」1 份；所有原餐點保留。每份餐點的選項：沒有加購。單份售價 ${first.price}。備註：。`, expected: 'ALLOW' },
        { id: 'multi-wrong-quantity', transcript: `${first.name}、${second.name}各一份。`, action: 'add', description: `新增「${first.name}」2 份；所有原餐點保留。`, deltas: [{ name: first.name, kind: 'product', mode: 'increase', quantity: 2 }], expected: 'REVISE' },
        { id: 'multi-remaining', deltas: [{ name: second.name, kind: 'product', mode: 'increase', quantity: 1 }], transcript: `${first.name}、${second.name}各一份。`, action: 'add', description: `新增「${second.name}」1 份；所有原餐點保留。每份餐點的選項：沒有加購。單份售價 ${second.price}。備註：。`, completedEffects: [`已加入${first.name} 1 份。`], expected: 'ALLOW' },
        { id: 'repair-replacement-quantity', storeFacts: `PB 指定的原購物車行為「${first.name}」2 份；移除整行會移除這2份，新餐份數依顧客原句決定。`, transcript: `${first.name}不要了，改${second.name}一份。`, action: 'replace', description: `移除既有「${first.name}」2 份，換成「${second.name}」2 份；先加新餐再移除原行。`, deltas: [{ name: first.name, kind: 'cart_line', mode: 'remove', quantity: 2 }, { name: second.name, kind: 'product', mode: 'increase', quantity: 2 }], expected: 'REVISE' },
        { id: 'replace-two-with-one', transcript: `${first.name}不要了，改${second.name}一份。`, action: 'replace', description: `移除既有「${first.name}」2 份，換成「${second.name}」1 份；先加新餐核對，再移除原行。`, storeFacts: `PB 指定的原購物車行為「${first.name}」2 份；移除整行會移除這2份，顧客對新餐指定的一份不是原行份數。`, deltas: [{ name: first.name, kind: 'cart_line', mode: 'remove', quantity: 2 }, { name: second.name, kind: 'product', mode: 'increase', quantity: 1 }], expected: 'ALLOW' },
        { id: 'repair-add-quantity', transcript: `${first.name}一份。`, action: 'add', description: `新增「${first.name}」2 份，原餐保留。`, deltas: [{ name: first.name, kind: 'product', mode: 'increase', quantity: 2 }], expected: 'REVISE' },
      ]
      const paid = first.configurations.flatMap(configuration => configuration.groups.flatMap(group => group.choices)).find(choice => choice.unitPrice > 0)
      if (paid)
        cases.push({ id: 'paid-option', deltas: [{ name: first.name, kind: 'product', mode: 'increase', quantity: 1 }, { name: paid.name, kind: 'option', mode: 'increase', quantity: 1 }], storeFacts: `PB 將「${paid.name}」列為「${first.name}」的商品加購選項，每份另加 ${paid.unitPrice} 元，使用此選項是實際付費加購，不是免費備註。`, transcript: `${first.name}一份，另外加一份${paid.name}。`, action: 'add', description: `新增「${first.name}」1 份；所有原餐點保留。每份餐點的選項：${paid.name} 額外共 1 份。單份售價 ${first.price + paid.unitPrice}。備註：。`, expected: 'ALLOW' })
      const results = []
      try {
        for (const testCase of cases) {
          await api(`/visitor-sessions/${session.id}/entries`, { kind: 'user_text', content: testCase.transcript })
          const startedAt = performance.now()
          const result = await api(`/visitor-sessions/${session.id}/browser-effect`, { transcript: testCase.transcript, action: testCase.action, description: testCase.description, completedEffects: testCase.completedEffects ?? [], storeFacts: testCase.storeFacts ?? '', deltas: testCase.deltas ?? [] })
          results.push({ ...testCase, result, durationMs: performance.now() - startedAt, passed: result.choice === testCase.expected && (!testCase.requiredAction || result.requiredAction === testCase.requiredAction) })
        }
      }
      finally { await api(`/visitor-sessions/${session.id}/end`, { state: 'cancelled' }) }
      return results
    }, clientModuleUrl)
    const after = await readCart()
    const vendorWrites = requests.slice(requestIndex).filter(request => ['POST', 'PUT', 'DELETE'].includes(request.method))
    const result = { cases: results, cartPreserved: JSON.stringify(before) === JSON.stringify(after), vendorWrites: vendorWrites.length, kind: 'read-only-provider-contract-probe', submittedOrder: false }
    await writeFile(resolve(outputDirectory, 'semantic-cases.json'), JSON.stringify(result, null, 2))
    console.info('Read-only semantic contract:', JSON.stringify(result))
    if (!result.cartPreserved || vendorWrites.length || results.some(result => !result.passed))
      process.exitCode = 1
  }
  if (process.argv.includes('--cart-guard-cases')) {
    const baseline = await readCart()
    const duplicateName = baseline.lines.find(line => baseline.lines.filter(other => other.name === line.name).length > 1)?.name
    if (!duplicateName)
      throw new Error('Same-name guard test requires actual same-named cart lines.')
    const cases = [
      { id: 'unmentioned-product', utterance: '我要一份餐點。', action: 'add' },
      { id: 'duplicate-line', utterance: `${duplicateName}不要了。`, action: 'remove' },
    ]
    const results = []
    for (const testCase of cases) {
      const requestIndex = requests.length
      await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '停止語音')?.click())
      await page.route(/\/api\/kiosk\/visitor-sessions\/[^/]+\/messages$/, async (route) => {
        const input = route.request().postDataJSON()
        let name = 'browser_cart_get'
        let args = { includeCatalog: true }
        if (input.toolResults?.length) {
          const facts = JSON.parse(input.toolResults.find(result => result.name === 'browser_cart_get').content)
          name = testCase.action === 'add' ? 'browser_cart_add' : 'browser_cart_remove'
          args = testCase.action === 'add'
            ? { version: facts.cart.version, productRef: facts.products[0].ref, quantity: 1, unitPrice: facts.products[0].price, note: '' }
            : { version: facts.cart.version, lineRef: facts.cart.lines.find(line => line.name === duplicateName).ref }
        }
        const toolCalls = [{ id: `${testCase.id}-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
        await route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: `data: ${JSON.stringify({ type: 'turn-started' })}\n\ndata: ${JSON.stringify({ type: 'turn-finished', agentMode: 'active', toolCalls })}\n\n` })
      }, { times: 2 })
      await page.getByPlaceholder('例如：我要一個周氏蝦捲招牌便當', { exact: true }).fill(testCase.utterance)
      const started = page.waitForResponse(response => /\/api\/kiosk\/visitor-sessions\/[^/]+\/messages$/.test(new URL(response.url()).pathname))
      await page.getByRole('button', { name: '模擬辨識並執行', exact: true }).click()
      await started
      await page.waitForFunction(() => document.querySelector('button.customer-restart')?.disabled === false, undefined, { timeout: 60000 })
      const actual = await page.getByRole('region', { name: '與虛擬服務員對話', exact: true }).locator('p').last().textContent()
      const cart = await readCart()
      const writes = requests.slice(requestIndex).filter(request => ['POST', 'PUT', 'DELETE'].includes(request.method))
      const preserved = JSON.stringify(cart) === JSON.stringify(baseline)
      const passed = preserved && !writes.length && actual?.includes('尚未變更購物車')
      results.push({ id: testCase.id, passed, actual, vendorWrites: writes.length, cartPreserved: preserved })
      if (!passed)
        throw new Error(`Cart guard failed: ${testCase.id}`)
    }
    await writeFile(resolve(outputDirectory, 'cart-guard-cases.json'), JSON.stringify({ injectedModelFaults: true, cases: results, baseline }, null, 2))
    console.info('PASS: faulty model targets were blocked before any PB write. Fault-injection coverage, not model accuracy.')
  }
  if (process.argv.includes('--draft-reset-cases')) {
    const call = (name, input) => page.evaluate(async ({ url, name, input }) => {
      const { interactiveServiceClient: client } = await import(url)
      return client.execute(client.tools.value.find(tool => tool.name === name), input)
    }, { url: clientModuleUrl, name, input })
    const before = await readCart()
    const facts = await call('browser_cart_get', { includeCatalog: true })
    const product = facts.products.find(product => product.kind === 'product')
    await call('browser_search', { query: product.name })
    await call('browser_open_product', { name: product.name })
    await call('browser_set_note', { note: '換客驗證的未送出備註' })
    const shape = await embeddedPage.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].filter(dialog => dialog.getClientRects().length > 0).map(dialog => ({ classes: dialog.className, hasNote: !!dialog.querySelector('input[placeholder="商品有特殊需求，請在此備註"]'), buttons: [...dialog.querySelectorAll('button')].map(button => ({ classes: button.className, label: button.getAttribute('aria-label'), text: button.textContent?.trim() })) })))
    console.info('Observed PB draft dialog shape:', JSON.stringify(shape))
    const receipt = await call('browser_customer_reset', {})
    const draft = await embeddedPage.evaluate(() => ({ visibleProductDrafts: [...document.querySelectorAll('[role="dialog"]')].filter(dialog => dialog.getClientRects().length > 0 && dialog.querySelector('input[placeholder="商品有特殊需求，請在此備註"]')).length, searchEmpty: document.querySelector('input[placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"]')?.value === '' }))
    const result = { receipt, draft, cartPreserved: JSON.stringify(await readCart()) === JSON.stringify(before), submittedOrder: false }
    result.passed = receipt.ok === true && draft.visibleProductDrafts === 0 && draft.searchEmpty && result.cartPreserved
    console.info('Draft reset acceptance:', JSON.stringify(result))
    await writeFile(resolve(outputDirectory, 'draft-reset-cases.json'), JSON.stringify(result, null, 2))
    if (!result.passed)
      process.exitCode = 1
  }
  if (process.argv.includes('--handoff-cases')) {
    const originalBaseline = await readCart()
    let baseline = originalBaseline
    const call = (name, input) => page.evaluate(async ({ url, name, input }) => {
      const { interactiveServiceClient: client } = await import(url)
      return client.execute(client.tools.value.find(tool => tool.name === name), input)
    }, { url: clientModuleUrl, name, input })
    const facts = await call('browser_cart_get', { includeCatalog: true })
    const product = facts.products.find(product => product.kind === 'product' && product.priceType === 1 && product.configurations.length === 1 && !baseline.lines.some(line => line.name === product.name))
    if (!product)
      throw new Error('Handoff acceptance needs a separate current test product.')
    let seedRow
    if (!baseline.lines.length) {
      // A known isolated first-customer item creates the nonempty handoff
      // condition. It is removed only after both observed snapshots agree.
      const seed = facts.products.find(candidate => candidate.ref !== product.ref && candidate.kind === 'product' && candidate.priceType === 1 && candidate.configurations.length === 1)
      if (!seed)
        throw new Error('No separate product for a reversible handoff baseline.')
      const result = await call('browser_cart_add', { version: facts.cart.version, productRef: seed.ref, quantity: 1, unitPrice: seed.price, note: '交接驗證，請勿送單', selection: { version: seed.configurations[0].version, variantRef: '', choices: [] } })
      if (result.status !== 'verified' || result.cart.lines.length !== 1 || result.cart.lines[0].productRef !== seed.ref)
        throw new Error('Cannot verify the first-customer handoff test item.')
      seedRow = result.cart.lines[0]
      baseline = await readCart()
    }
    const steps = []
    let knownRow
    let expectedAdded
    const requestIndex = requests.length
    const utterance = async (text) => {
      const step = await customerTurn(text)
      steps.push(step)
      return step
    }
    try {
      await utterance('我要點餐，一份。')
      const selected = await utterance('第二個')
      if (selected.pending?.purpose !== 'browser-confirm-add')
        throw new Error(`Previous customer did not establish a real complete confirmation: ${JSON.stringify({ actual: selected.actual, toolErrors: selected.receipts.filter(receipt => receipt.payload.error).map(receipt => ({ name: receipt.name, error: receipt.payload.error })) })}`)
      const oldQuestion = selected.pending.questionId
      await call('browser_search', { query: product.name })
      await call('browser_open_product', { name: product.name })
      const draft = await call('browser_set_note', { note: '換客驗證的未送出備註' })
      if (!draft.productDialog?.some(dialog => dialog.note === '換客驗證的未送出備註'))
        throw new Error('Could not establish the old customer draft for reset acceptance.')
      const previousDocument = await page.evaluate(async (url) => {
        const { interactiveServiceClient: client } = await import(url)
        window.pbPreviousTools = client.tools.value
        return client.getDocumentId()
      }, clientModuleUrl)
      await page.locator('button.customer-restart').click()
      // The PB document stays mounted. Discovery renews only the Host
      // connection and tools; no merchant operation is replayed.
      const deadline = Date.now() + 30000
      let rebound = false
      while (!rebound && Date.now() < deadline) {
        rebound = await page.evaluate(async ({ url, previousDocument }) => {
          const { interactiveServiceClient: client } = await import(url)
          return client.availability.value === 'ready' && client.getDocumentId() === previousDocument && client.tools.value !== window.pbPreviousTools
        }, { url: clientModuleUrl, previousDocument })
        if (!rebound)
          await page.waitForTimeout(100)
      }
      if (!rebound)
        throw new Error('The real Host did not renew its binding while preserving the PB document.')
      embeddedPage = page.frames().find(frame => frame.url().startsWith(menuUrl))
      if (!embeddedPage)
        throw new Error('New customer has no approved PB menu frame.')
      const loginPreserved = await embeddedPage.evaluate(() => {
        const raw = document.querySelector('[data-page]')?.getAttribute('data-page')
        return raw ? Boolean(JSON.parse(raw).props?.auth?.user) : false
      })
      if (!loginPreserved)
        throw new Error('Customer reset lost the shared PB login.')
      const draftPreserved = await embeddedPage.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].some(dialog => dialog.getClientRects().length > 0 && dialog.querySelector('input[placeholder="商品有特殊需求，請在此備註"]')) || document.querySelector('input[placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"]')?.value !== '')
      if (draftPreserved)
        throw new Error('The previous customer product/search draft survived reset.')
      const assent = await utterance('對')
      if (assent.answers.length || assent.pending?.questionId === oldQuestion || JSON.stringify(await readCart()) !== JSON.stringify(baseline))
        throw new Error('New customer inherited the old confirmation.')
      const refused = await utterance(`${product.name}一份。`)
      if (!refused.actual?.includes('交接') || !refused.receipts.some(receipt => receipt.payload.customerBoundary === 'review-required') || JSON.stringify(await readCart()) !== JSON.stringify(baseline))
        throw new Error('A nonempty previous cart did not block new-customer writes.')
      const modelReceipts = JSON.stringify(refused.receipts)
      if (baseline.lines.some(line => modelReceipts.includes(`"ref":"${line.id}"`)))
        throw new Error('Previous customer cart references reached the new Agent.')
      const query = await utterance(`${product.name}兩份多少錢？`)
      if (!query.actual?.includes(`合計 ${Math.round(product.price * 100) * 2 / 100} 元`) || JSON.stringify(await readCart()) !== JSON.stringify(baseline))
        throw new Error('Read-only menu queries stopped working while handoff was pending.')
      const earlyWrites = requests.slice(requestIndex).filter(request => ['POST', 'PUT', 'DELETE'].includes(request.method)).length
      if (earlyWrites)
        throw new Error('A new customer caused a PB write before staff review.')
      await staffReviewForTest()
      const added = await utterance(`${product.name}一份。`)
      expectedAdded = await readCart()
      const rows = expectedAdded.lines.filter(line => !baseline.lines.some(original => original.id === line.id))
      if (rows.length !== 1 || rows[0].name !== product.name || rows[0].quantity !== 1 || rows[0].unitPrice !== product.price || expectedAdded.subtotal !== baseline.subtotal + product.price || !baseline.lines.every(original => expectedAdded.lines.some(line => JSON.stringify(line) === JSON.stringify(original))) || !added.receipts.some(receipt => receipt.name === 'browser_cart_add' && receipt.payload.status === 'verified'))
        throw new Error('Staff-reviewed same-cart resume did not produce exactly one requested effect.')
      knownRow = rows[0]
      const current = await call('browser_cart_get', { includeCatalog: false })
      const removed = await call('browser_cart_remove', { version: current.cart.version, lineRef: String(knownRow.id) })
      if (removed.status !== 'verified' || JSON.stringify(await readCart()) !== JSON.stringify(baseline))
        throw new Error('Cannot verify isolated handoff test row cleanup.')
      knownRow = undefined
      if (seedRow) {
        const state = await call('browser_cart_get', { includeCatalog: false })
        const cleaned = await call('browser_cart_remove', { version: state.cart.version, lineRef: seedRow.ref })
        if (cleaned.status !== 'verified' || JSON.stringify(await readCart()) !== JSON.stringify(originalBaseline))
          throw new Error('Cannot verify the isolated first-customer test item cleanup.')
        seedRow = undefined
      }
      await writeFile(resolve(outputDirectory, 'handoff-cases.json'), JSON.stringify({ passed: true, steps, loginPreserved, earlyVendorWrites: earlyWrites, operatorSessionFixture: true, pinAuthenticationUnderTest: false, cartPreserved: true, submittedOrder: false }, null, 2))
      console.info('PASS: actual customer reset retained login, revoked old consent, redacted prior cart, blocked writes, allowed queries and resumed only after explicit staff review; original cart preserved.')
    }
    catch (error) {
      console.info('Handoff original failure:', String(error))
      if (knownRow && JSON.stringify(await readCart()) === JSON.stringify(expectedAdded)) {
        const current = await call('browser_cart_get', { includeCatalog: false })
        await call('browser_cart_remove', { version: current.cart.version, lineRef: String(knownRow.id) })
      }
      if (seedRow && JSON.stringify(await readCart()) === JSON.stringify(baseline)) {
        const state = await call('browser_cart_get', { includeCatalog: false })
        const cleaned = await call('browser_cart_remove', { version: state.cart.version, lineRef: seedRow.ref })
        if (cleaned.status === 'verified')
          seedRow = undefined
      }
      const after = await readCart().catch(() => undefined)
      await writeFile(resolve(outputDirectory, 'handoff-cases.json'), JSON.stringify({ passed: false, steps, error: String(error), cartPreserved: after ? JSON.stringify(after) === JSON.stringify(originalBaseline) : false, cartVerificationUnavailable: !after, submittedOrder: false }, null, 2))
      process.exitCode = 1
      console.info('Handoff acceptance failed:', String(error))
    }
  }
  if (process.argv.includes('--addon-cases')) {
    const call = (name, input) => page.evaluate(async ({ url, name, input }) => {
      const { interactiveServiceClient: client } = await import(url)
      return client.execute(client.tools.value.find(tool => tool.name === name), input)
    }, { url: clientModuleUrl, name, input })
    const baseline = await call('browser_cart_get', { includeCatalog: true })
    const product = baseline.products.find(candidate => !baseline.cart.lines.some(line => line.productRef === candidate.ref) && candidate.kind === 'product' && candidate.priceType === 1 && candidate.configurations.length === 1 && candidate.configurations[0].groups.some(group => group.choices.some(choice => choice.unitPrice > 0)) && !candidate.configurations[0].groups.some(group => group.required))
    if (!product)
      throw new Error('No isolated current product with a verified optional paid add-on.')
    const configuration = product.configurations[0]
    const choice = configuration.groups.flatMap(group => group.choices).find(choice => choice.unitPrice > 0)
    const cases = [
      { text: `${product.name}一份，另外加一份${choice.name}。`, quantity: 1, optionQuantity: 1 },
      { text: `${product.name}一份，不要加${choice.name}。`, quantity: 1, optionQuantity: 0 },
      { text: `${product.name}兩份，每份都加一份${choice.name}。`, quantity: 2, optionQuantity: 1 },
    ]
    const results = []
    for (const test of cases) {
      const turn = await customerTurn(test.text)
      const after = await call('browser_cart_get', { includeCatalog: false })
      const extra = after.cart.lines.filter(line => !baseline.cart.lines.some(old => old.ref === line.ref))
      const selected = extra.length === 1 ? JSON.parse(extra[0].configuration) : undefined
      const expectedPrice = configuration.unitPrice + choice.unitPrice * test.optionQuantity
      const preserved = baseline.cart.lines.every(line => JSON.stringify(after.cart.lines.find(current => current.ref === line.ref)) === JSON.stringify(line))
      const exactChoices = selected && (test.optionQuantity ? selected.choices.length === 1 && selected.choices[0].ref === choice.ref && selected.choices[0].quantity === test.optionQuantity : selected.choices.length === 0)
      const passed = extra.length === 1 && extra[0].productRef === product.ref && extra[0].quantity === test.quantity && extra[0].unitPrice === expectedPrice && exactChoices && preserved && after.cart.subtotal === baseline.cart.subtotal + expectedPrice * test.quantity && turn.receipts.some(receipt => receipt.name === 'browser_cart_add' && receipt.payload.status === 'verified') && turn.actual?.includes(product.name)
      let cartPreserved = false
      // Clean up only a fully known isolated effect, including a wrong proposal
      // if it was verified. Never delete other rows or retry an unknown write.
      if (extra.length === 1 && extra[0].productRef === product.ref && preserved && after.cart.subtotal === baseline.cart.subtotal + extra[0].unitPrice * extra[0].quantity && turn.receipts.some(receipt => receipt.name === 'browser_cart_add' && receipt.payload.status === 'verified')) {
        const removed = await call('browser_cart_remove', { version: after.cart.version, lineRef: extra[0].ref })
        cartPreserved = removed.status === 'verified' && JSON.stringify(removed.cart.lines) === JSON.stringify(baseline.cart.lines) && removed.cart.subtotal === baseline.cart.subtotal
      }
      else if (!extra.length) {
        cartPreserved = JSON.stringify(after.cart.lines) === JSON.stringify(baseline.cart.lines) && after.cart.subtotal === baseline.cart.subtotal
      }
      results.push({ ...test, passed: !!passed, cartPreserved, actual: turn.actual, receipts: turn.receipts, selected, subtotal: after.cart.subtotal })
      console.info('Natural add-on matrix:', JSON.stringify({ text: test.text, passed: !!passed, cartPreserved, actual: turn.actual }))
      await writeFile(resolve(outputDirectory, 'addon-cases.json'), JSON.stringify({ cases: results, submittedOrder: false }, null, 2))
      if (!passed || !cartPreserved) {
        process.exitCode = 1
        break
      }
    }
  }
  if (process.argv.includes('--option-cases')) {
    const exchanges = []
    const capture = (request) => {
      if (/\/api\/kiosk\/visitor-sessions\/[^/]+\/messages$/.test(new URL(request.url()).pathname) && request.method() === 'POST')
        exchanges.push({ input: request.postDataJSON() })
    }
    page.on('request', capture)
    await page.evaluate(() => {
      const original = window.fetch
      window.pbOptionStreams = []
      window.fetch = async (...args) => {
        const response = await original(...args)
        if (response.url.includes('/messages') && response.headers.get('content-type')?.includes('text/event-stream'))
          void response.clone().text().then(body => window.pbOptionStreams.push(body)).catch(() => {})
        return response
      }
    })
    const call = (name, input) => page.evaluate(async ({ url, name, input }) => {
      const { interactiveServiceClient: client } = await import(url)
      return client.execute(client.tools.value.find(tool => tool.name === name), input)
    }, { url: clientModuleUrl, name, input })
    const initial = await call('browser_cart_get', { includeCatalog: true })
    const product = initial.products.find(product => !initial.cart.lines.some(line => line.productRef === product.ref) && product.configurations.some(configuration => !configuration.groups.some(group => group.required) && configuration.groups.some(group => group.choices.some(choice => choice.unitPrice > 0))))
    if (!product)
      throw new Error('No isolated currently available paid-option product.')
    const configuration = product.configurations[0]
    const choice = configuration.groups.flatMap(group => group.choices).find(choice => choice.unitPrice > 0)
    const utterance = `${product.name}一份，另外加一份${choice.name}。`
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '停止語音')?.click())
    await page.getByPlaceholder('例如：我要一個周氏蝦捲招牌便當', { exact: true }).fill(utterance)
    const started = page.waitForResponse(response => /\/api\/kiosk\/visitor-sessions\/[^/]+\/messages$/.test(new URL(response.url()).pathname), { timeout: 30000 })
    await page.getByRole('button', { name: '模擬辨識並執行', exact: true }).click()
    await started
    await page.waitForFunction(() => document.querySelector('button.customer-restart')?.disabled === false, undefined, { timeout: 120000 })
    const after = await call('browser_cart_get', { includeCatalog: false })
    const extra = after.cart.lines.filter(line => !initial.cart.lines.some(old => old.ref === line.ref))
    const actual = await page.getByRole('region', { name: '與虛擬服務員對話', exact: true }).locator('p').last().textContent()
    const selected = extra.length === 1 ? JSON.parse(extra[0].configuration) : undefined
    const passed = extra.length === 1 && extra[0].productRef === product.ref && extra[0].quantity === 1 && extra[0].unitPrice === configuration.unitPrice + choice.unitPrice && selected.choices.length === 1 && selected.choices[0].ref === choice.ref && selected.choices[0].quantity === 1 && actual.includes(choice.name) && after.cart.subtotal === initial.cart.subtotal + extra[0].unitPrice && initial.cart.lines.every(line => JSON.stringify(after.cart.lines.find(current => current.ref === line.ref)) === JSON.stringify(line))
    let restored = after
    if (passed)
      restored = await call('browser_cart_remove', { version: after.cart.version, lineRef: extra[0].ref })
    const cartPreserved = JSON.stringify(restored.cart.lines) === JSON.stringify(initial.cart.lines) && restored.cart.subtotal === initial.cart.subtotal
    const result = { utterance, passed, actual, product, selected, cart: after.cart, restored: restored.cart, cartPreserved, submittedOrder: false }
    page.off('request', capture)
    exchanges.push({ streams: await page.evaluate(() => window.pbOptionStreams) })
    await writeFile(resolve(outputDirectory, 'option-exchanges.json'), JSON.stringify(exchanges, null, 2))
    await writeFile(resolve(outputDirectory, 'option-cases.json'), JSON.stringify(result, null, 2))
    console.info('Natural paid-option case:', JSON.stringify({ passed, actual, cartPreserved }))
    if (!passed || !cartPreserved)
      process.exitCode = 1
  }
  if (process.argv.includes('--cart-cases')) {
    const call = (name, input) => page.evaluate(async ({ url, name, input }) => {
      const { interactiveServiceClient: client } = await import(url)
      const tool = client.tools.value.find(tool => tool.name === name)
      const receipt = await client.execute(tool, input)
      if (!receipt.ok)
        throw new Error(JSON.stringify(receipt))
      return receipt
    }, { url: clientModuleUrl, name, input })
    const initial = await call('browser_cart_get', { includeCatalog: true })
    const baseline = initial.cart
    const isolated = initial.products.filter(product => product.priceType === 1 && !baseline.lines.some(line => line.productRef === product.ref))
    const replacement = initial.products.find(product => product.priceType === 1 && baseline.lines.some(line => line.productRef === product.ref))
    if (isolated.length < 2 || !replacement)
      throw new Error('Current PB data cannot support this isolated multi-demand case set.')
    const [first, second] = isolated
    const count = (cart, ref) => cart.lines.filter(line => line.productRef === ref).reduce((sum, line) => sum + line.quantity, 0)
    const replacementBefore = count(baseline, replacement.ref)
    const cases = [
      { id: 'D01-pb-cart', utterance: `${first.name}、${second.name}各一份。`, expected: [1, 1, replacementBefore] },
      { id: 'D14-pb-cart', utterance: `${first.name}改兩份，不要換${second.name}。`, expected: [2, 1, replacementBefore] },
      { id: 'D13-pb-cart', utterance: `${first.name}不要了，改${replacement.name}一份。`, expected: [0, 1, replacementBefore + 1] },
      { id: 'remove-pb-cart', utterance: `${second.name}不要了。`, expected: [0, 0, replacementBefore + 1] },
    ]
    const results = []
    let lastObserved = baseline
    for (const testCase of cases) {
      const receipts = []
      const capture = (request) => {
        if (request.method() !== 'POST')
          return
        const path = new URL(request.url()).pathname
        if (/\/api\/kiosk\/visitor-sessions\/[^/]+\/messages$/.test(path)) {
          const input = request.postDataJSON()
          receipts.push(...(input.toolResults ?? []).map(result => ({ name: result.name, payload: JSON.parse(result.content) })))
        }
        else if (/\/api\/kiosk\/visitor-sessions\/[^/]+\/entries$/.test(path)) {
          const input = request.postDataJSON()
          if (input.kind === 'tool_result')
            receipts.push({ name: input.metadata?.name, payload: JSON.parse(input.content) })
        }
      }
      page.on('request', capture)
      await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '停止語音')?.click())
      await page.getByPlaceholder('例如：我要一個周氏蝦捲招牌便當', { exact: true }).fill(testCase.utterance)
      const started = page.waitForResponse(response => /\/api\/kiosk\/visitor-sessions\/[^/]+\/messages$/.test(new URL(response.url()).pathname), { timeout: 30000 })
      console.info('Natural cart case:', testCase.id, testCase.utterance)
      await page.getByRole('button', { name: '模擬辨識並執行', exact: true }).click()
      await started
      await page.waitForFunction(() => document.querySelector('button.customer-restart')?.disabled === false, undefined, { timeout: 120000 })
      page.off('request', capture)
      const current = await call('browser_cart_get', { includeCatalog: false })
      lastObserved = current.cart
      const actualCounts = [count(current.cart, first.ref), count(current.cart, second.ref), count(current.cart, replacement.ref)]
      const expectedSubtotal = baseline.subtotal + testCase.expected[0] * first.price + testCase.expected[1] * second.price + (testCase.expected[2] - replacementBefore) * replacement.price
      const actual = await page.getByRole('region', { name: '與虛擬服務員對話', exact: true }).locator('p').last().textContent()
      const verified = receipts.filter(receipt => receipt.payload.source === 'browser' && receipt.payload.status === 'verified')
      const refused = receipts.some(receipt => receipt.payload.source === 'browser' && ['rejected', 'unknown'].includes(receipt.payload.status))
      const expectedTool = testCase.id.startsWith('D01') ? 'browser_cart_add' : testCase.id.startsWith('D14') ? 'browser_cart_quantity' : testCase.id.startsWith('D13') ? 'browser_cart_replace' : 'browser_cart_remove'
      const presented = verified.some(receipt => receipt.name === expectedTool && actual?.includes(receipt.payload.customerMessage))
      const passed = JSON.stringify(actualCounts) === JSON.stringify(testCase.expected) && current.cart.subtotal === expectedSubtotal && presented && !refused
      results.push({ ...testCase, passed, actual, actualCounts, receipts, cart: current.cart })
      await writeFile(resolve(root, `output/playwright/iframe-probe-20261029/${testCase.id}.txt`), await page.locator('body').ariaSnapshot())
      await page.screenshot({ path: resolve(root, `output/playwright/iframe-probe-20261029/${testCase.id}.png`) })
      console.info('Natural cart result:', JSON.stringify(results.at(-1)))
      if (!passed)
        break
    }
    // Cleanup is separate from case acceptance. Restore only our observed test
    // deltas; the coordinator rejects any intervening outside cart change.
    let current = lastObserved
    for (const line of [...current.lines]) {
      const original = baseline.lines.find(candidate => candidate.ref === line.ref)
      if (!original) {
        if (![first.ref, second.ref, replacement.ref].includes(line.productRef))
          throw new Error('Unowned new cart line; stop test cleanup.')
        current = (await call('browser_cart_remove', { version: current.version, lineRef: line.ref })).cart
      }
      else if (line.quantity !== original.quantity) {
        if (line.productRef !== replacement.ref || line.configuration !== original.configuration || line.unitPrice !== original.unitPrice)
          throw new Error('Unowned original-line change; stop test cleanup.')
        current = (await call('browser_cart_quantity', { version: current.version, lineRef: line.ref, quantity: original.quantity })).cart
      }
    }
    const preserved = JSON.stringify(current.lines) === JSON.stringify(baseline.lines) && current.subtotal === baseline.subtotal
    const summary = { cases: results, baseline, restored: current, cartPreserved: preserved, submittedOrder: false }
    await writeFile(resolve(outputDirectory, 'cart-cases.json'), JSON.stringify(summary, null, 2))
    if (!preserved || results.length !== cases.length || results.some(result => !result.passed))
      process.exitCode = 1
    console.info('Natural cart summary:', JSON.stringify({ cases: results.map(result => ({ id: result.id, passed: result.passed })), cartPreserved: preserved }))
  }
  if (process.argv.includes('--cart-smoke')) {
    const result = await page.evaluate(async (url) => {
      const { interactiveServiceClient: client } = await import(url)
      const call = async (name, input) => {
        const tool = client.tools.value.find(tool => tool.name === name)
        const receipt = await client.execute(tool, input)
        if (!receipt.ok)
          throw new Error(JSON.stringify(receipt))
        return receipt
      }
      const baseline = await call('browser_cart_get', { includeCatalog: true })
      const product = baseline.products.find(product => product.priceType === 1 && !baseline.cart.lines.some(line => line.productRef === product.ref))
      if (!product)
        throw new Error('No isolated current product for reversible cart smoke.')
      const added = await call('browser_cart_add', { version: baseline.cart.version, productRef: product.ref, quantity: 1, unitPrice: product.price, note: '', selection: { version: product.configurations[0].version, variantRef: '', choices: [] } })
      const line = added.cart.lines.find(line => !baseline.cart.lines.some(original => original.ref === line.ref))
      if (!line)
        throw new Error('Cart smoke requires an isolated new line; stop.')
      const changed = await call('browser_cart_quantity', { version: added.cart.version, lineRef: line.ref, quantity: 2 })
      const removed = await call('browser_cart_remove', { version: changed.cart.version, lineRef: line.ref })
      if (JSON.stringify(removed.cart.lines) !== JSON.stringify(baseline.cart.lines) || removed.cart.subtotal !== baseline.cart.subtotal)
        throw new Error('Original PB cart was not retained.')
      return { baseline: baseline.cart, added, changed, removed, cartPreserved: true }
    }, clientModuleUrl)
    await writeFile(resolve(outputDirectory, 'cart-smoke.json'), JSON.stringify(result, null, 2))
    console.info('PASS: PB cart add/quantity/remove transport smoke; not natural-language ordering acceptance.')
  }
  if (process.argv.includes('--probe-paid-option')) {
    const result = await embeddedPage.evaluate(async () => {
      const base = new URL('.', location.href)
      async function cart() {
        const response = await fetch(new URL('orders/create', base), { cache: 'no-store' })
        if (!response.ok)
          throw new Error('Probe cannot read cart.')
        const html = new DOMParser().parseFromString(await response.text(), 'text/html')
        const { props } = JSON.parse(html.querySelector('[data-page]').getAttribute('data-page'))
        return { hash: props.order.hash, subtotal: props.subtotal, lines: props.details.map(line => ({ id: line.id, item: { id: line.item.id, name: line.item.name }, amount: line.amount, unitPrice: line.unit_price, note: line.note, prices: line.product_prices })) }
      }
      const baseline = await cart()
      const key = `webnavior:pb:cart-pending:${base.pathname}`
      if (localStorage.getItem(key))
        throw new Error('Probe refuses unresolved prior writes.')
      const announcement = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '我知道了，開始點餐')
      announcement?.click()
      const heading = [...document.querySelectorAll('main [role="button"] h4, main button h4')].find(heading => !baseline.lines.some(line => line.item.name === heading.textContent?.trim()))
      if (!heading)
        throw new Error('Probe requires an absent product to isolate its line.')
      heading.closest('[role="button"],button').click()
      let dialog
      let button
      const deadline = Date.now() + 10000
      while (Date.now() < deadline) {
        dialog = [...document.querySelectorAll('[role="dialog"]')].find(dialog => dialog.getClientRects().length && dialog.querySelector('h1')?.textContent?.trim() === heading.textContent?.trim())
        button = dialog && [...dialog.querySelectorAll('button')].find(button => button.textContent?.trim().startsWith('選好了') && !button.disabled)
        if (button)
          break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      const input = dialog?.querySelector('li input[role="spinbutton"]')
      if (!button || !input || input.value !== '0')
        throw new Error('Probe cannot uniquely select a clean option.')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '1')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 500))
      const price = Number(button.textContent.match(/\$([\d,]+)/)?.[1].replaceAll(',', ''))
      if (!Number.isFinite(price))
        throw new Error('Probe cannot observe the configured price.')
      const marker = crypto.randomUUID()
      localStorage.setItem(key, marker)
      button.click()
      while (dialog.getClientRects().length && Date.now() < deadline + 10000)
        await new Promise(resolve => setTimeout(resolve, 100))
      const added = await cart()
      const extra = added.lines.filter(line => !baseline.lines.some(old => old.id === line.id))
      if (extra.length !== 1 || extra[0].amount !== 1 || added.subtotal !== baseline.subtotal + price || baseline.lines.some(old => JSON.stringify(added.lines.find(line => line.id === old.id)) !== JSON.stringify(old)))
        throw new Error('Probe add effect unknown; persisted pause retained.')
      // Remove only the isolated, fully observed diagnostic row. Never clear a
      // cart or replay an add if either response is lost.
      const url = new URL(window.route('shopping.orders.details.destroy', ['1kgJeql', 'pick_up', added.hash, extra[0].id]))
      if (url.origin !== location.origin || url.pathname !== new URL(`orders/${added.hash}/details/${extra[0].id}`, base).pathname)
        throw new Error('Probe cleanup route mismatch.')
      const token = document.cookie.split('; ').find(cookie => cookie.startsWith('XSRF-TOKEN='))
      await fetch(url, { method: 'DELETE', redirect: 'manual', headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': decodeURIComponent(token.slice('XSRF-TOKEN='.length)) } })
      const restored = await cart()
      if (JSON.stringify(restored) !== JSON.stringify(baseline))
        throw new Error('Probe cleanup unknown; persisted pause retained.')
      if (localStorage.getItem(key) === marker)
        localStorage.removeItem(key)
      return { baseline, configuredLine: extra[0], restored, cartPreserved: true, submittedOrder: false }
    })
    await writeFile(resolve(outputDirectory, 'paid-option-contract.json'), JSON.stringify(result, null, 2))
    console.info('PB paid option contract verified and original cart restored.')
  }
  if (process.argv.includes('--inspect-options')) {
    const options = await embeddedPage.evaluate(async () => {
      const base = new URL('.', location.href)
      const response = await fetch(new URL('menu', base), { cache: 'no-store' })
      const html = new DOMParser().parseFromString(await response.text(), 'text/html')
      const { props } = JSON.parse(html.querySelector('[data-page]').getAttribute('data-page'))
      const categories = []
      for (const category of props.menuCategories) {
        const query = new URLSearchParams({ category_id: String(category.id), pickUpDate: props.defaultPickUpDate, pickUpTime: props.defaultPickUpTime })
        const data = await (await fetch(new URL(`menu-category-items?${query}`, base))).json()
        const products = []
        for (const product of data.products) {
          const attrs = await (await fetch(window.route('shopping.getAttrByProduct', ['1kgJeql', 'pick_up', product.id]))).json()
          products.push({ id: product.id, name: product.name, price: product.price, priceType: product.price_type, attrs })
        }
        categories.push({ id: category.id, name: category.name, products, groups: data.productGroups })
      }
      return { pickup: [props.defaultPickUpDate, props.defaultPickUpTime], categories }
    })
    await writeFile(resolve(outputDirectory, 'pb-options-contract.json'), JSON.stringify(options, null, 2))
    console.info('PB option contract recorded without account fields or cart writes.')
  }
  if (process.argv.includes('--inspect-cart-contract')) {
    const facts = await embeddedPage.evaluate(async () => {
      const response = await fetch(new URL('orders/create', location.href))
      const html = new DOMParser().parseFromString(await response.text(), 'text/html')
      const { props } = JSON.parse(html.querySelector('[data-page]').getAttribute('data-page'))
      const route = window.route
      return { routeType: typeof route, updateUrl: typeof route === 'function' ? route('shopping.orders.details.update', ['1kgJeql', 'pick_up', props.order.hash, props.details[0]?.id]) : undefined, removeUrl: typeof route === 'function' ? route('shopping.orders.details.destroy', ['1kgJeql', 'pick_up', props.order.hash, props.details[0]?.id]) : undefined, lines: props.details.map(line => ({ id: line.id, name: line.item?.name, productId: line.item?.id, itemType: line.item_type, amount: line.amount, price: line.unit_price, options: line.product_prices?.map(p => ({ id: p.item_id, type: p.item_type, parent: p.parent_id, price: p.price })) })) }
    })
    console.info('PB cart contract:', JSON.stringify(facts))
    const announcement = embeddedPage.getByRole('button', { name: '我知道了，開始點餐', exact: true })
    if (await announcement.isVisible())
      await announcement.click()
    await embeddedPage.locator('main [role="button"] h4, main button h4').first().waitFor({ timeout: 60000 })
    await embeddedPage.locator('main [role="button"] h4, main button h4').first().click()
    await embeddedPage.getByRole('dialog').getByPlaceholder('商品有特殊需求，請在此備註').waitFor()
    await embeddedPage.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some(button => button.textContent?.trim().startsWith('選好了') && !button.disabled))
    await writeFile(resolve(outputDirectory, 'pb-product-contract.txt'), await embeddedPage.getByRole('dialog').ariaSnapshot())
  }
  if (process.argv.includes('--recovery-cases')) {
    const cartBefore = await readCart()
    const fault = await page.evaluate(async ({ clientUrl, retryUrl }) => {
      // Use the exact modules already loaded by Kiosk, including Vite timestamps.
      const { interactiveServiceClient: client } = await import(clientUrl)
      const { readConversationRetryContext } = await import(retryUrl)
      const first = await readConversationRetryContext(client)
      const second = await readConversationRetryContext(client)
      if (first !== second)
        throw new Error('Unchanged PB state produced unstable retry evidence.')
      const observe = client.tools.value.find(tool => tool.name === 'browser_observe')
      let lost = false
      try {
        await client.execute(observe, { includeDescriptions: false, purpose: 'information' }, AbortSignal.timeout(25))
      }
      catch { lost = true }
      return { lost, unavailable: client.availability.value === 'unavailable' }
    }, { clientUrl: clientModuleUrl, retryUrl: retryModuleUrl })
    if (!fault.lost || !fault.unavailable)
      throw new Error('Lost read receipt was not reproduced.')
    // The read may have completed in PB after its host timed out. Recovery must
    // inspect that operation, not invoke it again or demand owned Menu tools.
    await page.waitForTimeout(700)
    await recover.click({ noWaitAfter: true })
    await recover.waitFor({ state: 'hidden', timeout: 20000 })
    const utterance = '雞腿便當兩份多少錢？'
    const messageRoute = /\/api\/kiosk\/visitor-sessions\/[^/]+\/messages$/
    let failedUtteranceId
    await page.route(messageRoute, async (route) => {
      failedUtteranceId = route.request().postDataJSON().utteranceId
      await route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: 'data: {"type":"turn-started"}\n\ndata: {"type":"turn-failed","reason":"provider-error","message":"Injected read-only provider failure"}\n\n' })
    }, { times: 1 })
    await page.getByPlaceholder('例如：我要一個周氏蝦捲招牌便當', { exact: true }).fill(utterance)
    await page.getByRole('button', { name: '模擬辨識並執行', exact: true }).click()
    const retry = page.getByRole('button', { name: '再試一次', exact: true })
    await retry.waitFor({ state: 'visible', timeout: 30000 })
    const resumed = page.waitForRequest(request => messageRoute.test(new URL(request.url()).pathname) && request.postDataJSON().content === utterance, { timeout: 30000 })
    await retry.click()
    const retriedRequest = (await resumed).postDataJSON()
    if (retriedRequest.utteranceId === failedUtteranceId)
      throw new Error('Retry reused the failed utterance authority.')
    await page.waitForFunction(() => document.querySelector('button.customer-restart')?.disabled === false, undefined, { timeout: 120000 })
    const retryReply = await page.getByRole('region', { name: '與虛擬服務員對話', exact: true }).locator('p').last().textContent()
    if (!retryReply?.includes('2 份合計 20 元'))
      throw new Error('Retry did not produce the verified PB quote.')
    const cartAfter = await readCart()
    const cartPreserved = JSON.stringify(cartBefore) === JSON.stringify(cartAfter)
    const result = { fault, recoveredThroughKioskUi: true, retryThroughKioskUi: true, retryHasNewUtteranceId: true, retryReply, cartPreserved, cartBefore, cartAfter }
    await writeFile(resolve(outputDirectory, 'recovery-cases.json'), JSON.stringify(result, null, 2))
    if (!cartPreserved)
      throw new Error('PB cart changed during read recovery.')
    console.info('PASS: lost read receipt recovered through actual Kiosk UI; original cart preserved.')
  }
  if (process.argv.includes('--natural-cases')) {
    const cartBefore = await readCart()
    const results = []
    await page.evaluate(() => {
      const original = window.fetch.bind(window)
      window.pbCaseStreams = []
      window.fetch = async (...args) => {
        const response = await original(...args)
        if (/\/api\/kiosk\/visitor-sessions\/[^/]+\/messages$/.test(new URL(response.url).pathname))
          void response.clone().text().then(stream => window.pbCaseStreams.push(stream))
        return response
      }
    })
    // PB adaptations of the existing D11/D12/D04 cases. These are customer
    // utterances, not instructions telling the model which tools to call.
    const cases = [
      { id: 'D11-pb', utterance: '雞腿便當跟排骨便當都有嗎？' },
      { id: 'D12-pb', utterance: '雞腿便當兩份多少錢？' },
      { id: 'D04-pb', utterance: '我要一份便當。' },
    ]
    const announcement = embeddedPage.getByRole('button', { name: '我知道了，開始點餐', exact: true })
    if (await announcement.isVisible())
      await announcement.click()
    await embeddedPage.getByRole('tab', { name: '便當', exact: true }).click({ noWaitAfter: true })
    await embeddedPage.locator('main [role="button"] h4, main button h4').first().waitFor({ timeout: 60000 })
    const baseline = await embeddedPage.locator('body').ariaSnapshot()
    await writeFile(resolve(outputDirectory, 'natural-menu-baseline.txt'), baseline)
    for (const testCase of cases) {
      const exchanges = []
      const capture = async (response) => {
        if (/\/api\/kiosk\/visitor-sessions\/[^/]+\/entries$/.test(new URL(response.url()).pathname)) {
          const entry = response.request().postDataJSON()
          if (entry?.kind === 'tool_result')
            exchanges.push({ toolResults: [{ name: entry.metadata?.name, content: entry.content }], status: response.status() })
          return
        }
        if (!/\/api\/kiosk\/visitor-sessions\/[^/]+\/messages$/.test(new URL(response.url()).pathname))
          return
        const request = response.request().postDataJSON()
        // SSE completion is observed through the real UI. Playwright's full
        // response body can remain pending after the app consumed its stream.
        exchanges.push({ content: request.content, toolResults: request.toolResults, status: response.status() })
      }
      page.on('response', capture)
      // Keep a real multi-turn conversation. Resetting would erase the very
      // context needed by the subsequent short-answer ordering cases.
      await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '停止語音')?.click())
      const field = page.getByPlaceholder('例如：我要一個周氏蝦捲招牌便當', { exact: true })
      await field.fill(testCase.utterance)
      const submit = page.getByRole('button', { name: '模擬辨識並執行', exact: true })
      await submit.waitFor({ state: 'visible' })
      console.info('Natural case:', testCase.id, testCase.utterance)
      const started = page.waitForResponse(response => /\/api\/kiosk\/visitor-sessions\/[^/]+\/messages$/.test(new URL(response.url()).pathname), { timeout: 30000 })
      await submit.click()
      await started
      await page.waitForFunction(() => {
        const button = document.querySelector('button.customer-restart')
        return button && !button.disabled
      }, undefined, { timeout: 120000 })
      await writeFile(resolve(root, `output/playwright/iframe-probe-20261029/${testCase.id}.txt`), await page.locator('body').ariaSnapshot())
      await page.screenshot({ path: resolve(root, `output/playwright/iframe-probe-20261029/${testCase.id}.png`) })
      const receipts = exchanges.flatMap(exchange => exchange.toolResults ?? []).map(receipt => ({ ...receipt, payload: JSON.parse(receipt.content) }))
      const messages = receipts.map(receipt => receipt.payload.customerMessage).filter(Boolean)
      const actual = await page.getByRole('region', { name: '與虛擬服務員對話', exact: true }).locator('p').last().textContent() ?? ''
      const presented = messages.length > 0 && messages.every(message => actual.includes(message))
      const verified = testCase.id === 'D12-pb'
        ? receipts.some(receipt => receipt.name === 'browser_quote' && receipt.payload.ok === true)
        : testCase.id === 'D04-pb'
          ? messages.some(message => message.includes('哪一項？'))
          : ['雞腿便當', '排骨便當'].every(name => messages.some(message => message.includes(name)))
      const result = { ...testCase, passed: presented && verified, actual, tools: receipts.map(receipt => receipt.name) }
      results.push(result)
      console.info('Natural case:', JSON.stringify(result))
      page.off('response', capture)
      exchanges.push({ streams: await page.evaluate(() => window.pbCaseStreams.splice(0)) })
      await writeFile(resolve(root, `output/playwright/iframe-probe-20261029/${testCase.id}-exchanges.json`), JSON.stringify(exchanges, null, 2))
    }
    const cartAfter = await readCart()
    const cartPreserved = JSON.stringify(cartBefore) === JSON.stringify(cartAfter)
    const summary = { cases: results, cartPreserved, cartBefore, cartAfter, jev: 'disabled-handoff-to-main', submittedOrder: false }
    await writeFile(resolve(outputDirectory, 'natural-cases.json'), JSON.stringify(summary, null, 2))
    if (!cartPreserved || results.some(result => !result.passed))
      process.exitCode = 1
  }
  if (process.argv.includes('--inspect') || process.argv.includes('--inspect-cart')) {
    const facts = await embeddedPage.evaluate(() => {
      const initial = document.querySelector('[data-page]')?.getAttribute('data-page')
      const props = initial ? JSON.parse(initial).props : {}
      return { propKeys: Object.keys(props), menuCategories: props.menuCategories, cartCount: props.cartCount, cartPrice: props.cartPrice }
    })
    console.info('PB public menu/cart fields:', JSON.stringify(facts))
    const cartFacts = await readCart()
    console.info('PB fresh cart fields:', JSON.stringify(cartFacts))
    await writeFile(resolve(outputDirectory, 'pb-menu-dom.txt'), await embeddedPage.locator('body').ariaSnapshot())
    if (process.argv.includes('--inspect-cart')) {
      const announcement = embeddedPage.getByRole('button', { name: '我知道了，開始點餐', exact: true })
      if (await announcement.isVisible())
        await announcement.click()
      await embeddedPage.getByText('去結算', { exact: true }).click({ noWaitAfter: true })
      await embeddedPage.waitForLoadState('networkidle')
      console.info('PB cart view URL:', embeddedPage.url())
      await writeFile(resolve(outputDirectory, 'pb-cart-dom.txt'), await embeddedPage.locator('body').ariaSnapshot())
      console.info('PB cart field names:', await embeddedPage.evaluate(() => {
        const initial = document.querySelector('[data-page]')?.getAttribute('data-page')
        return initial ? Object.keys(JSON.parse(initial).props) : []
      }))
    }
    for (const request of requests.filter(request => /\/(?:ShoppingLayout|ProductDialog|Show|Create|Cart|OrderDetails)-.*\.js$/.test(request.path))) {
      const response = await context.request.get(`https://app.esgpb.com${request.path}`)
      if (response.ok())
        await writeFile(resolve(root, `output/playwright/iframe-probe-20261029/${request.path.split('/').at(-1)}`), await response.text())
    }
  }
  if (process.argv.includes('--answer-cases')) {
    const before = await readCart()
    const requestIndex = requests.length
    const results = await page.evaluate(async (url) => {
      const { interactiveServiceClient: client } = await import(url)
      const facts = await client.execute(client.tools.value.find(tool => tool.name === 'browser_cart_get'), { includeCatalog: true })
      const [first, second] = facts.products
      async function api(path, body) {
        const response = await fetch(`http://localhost:5168/api/kiosk${path}`, { method: body ? 'POST' : 'GET', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
        if (!response.ok)
          throw new Error(`Answer probe API ${response.status}`)
        return response.json()
      }
      const bootstrap = await api('/bootstrap')
      const { session } = await api('/visitor-sessions', { serviceId: bootstrap.profile.snapshot.interactiveService.id })
      const product = { purpose: 'browser-product-choice', question: `請問要${first.name}、${second.name}，哪一項？`, choices: [{ id: 'product:1', description: `第1項「${first.name}」，只選品項，尚未加入。` }, { id: 'product:2', description: `第2項「${second.name}」，只選品項，尚未加入。` }, { id: 'cancel', description: '取消選餐，購物車保持不變。' }] }
      const addition = { purpose: 'browser-confirm-add', question: `確認加入${second.name} 2份，單份${second.price}元，合計${second.price * 2}元嗎？`, choices: [{ id: 'confirm', description: `確認現在加入${second.name}2份，合計${second.price * 2}元，不送單付款。` }, { id: 'cancel', description: '先不加入，保留原車。' }] }
      const cases = [
        { id: 'ordinal', question: product, text: '第二個', kind: 'ANSWER', choiceId: 'product:2' },
        { id: 'unresolved-quantity', question: product, text: '一份', kind: 'UNCERTAIN' },
        { id: 'ordinal-with-quantity', question: product, text: '第二個兩份', kind: 'NEW_REQUEST' },
        { id: 'named-with-quantity', question: product, text: `${second.name}兩份`, kind: 'NEW_REQUEST' },
        { id: 'cancel-choice', question: product, text: '先不要了', kind: 'ANSWER', choiceId: 'cancel' },
        { id: 'confirm', question: addition, text: '對', kind: 'ANSWER', choiceId: 'confirm' },
        { id: 'decline', question: addition, text: '不要', kind: 'ANSWER', choiceId: 'cancel' },
        { id: 'correct-quantity', question: addition, text: '對，但改一份', kind: 'NEW_REQUEST' },
        { id: 'bare-corrected-quantity', question: addition, text: '一份', kind: 'NEW_REQUEST' },
        { id: 'additional-demand', question: addition, text: `好，再加一份${first.name}`, kind: 'NEW_REQUEST' },
        { id: 'background-agreement', question: addition, text: '我朋友說對，我還沒決定', kind: 'UNCERTAIN' },
        { id: 'unfinished', question: addition, text: '我要…', kind: 'UNCERTAIN' },
      ]
      const results = []
      try {
        for (const testCase of cases) {
          const question = { ...testCase.question, questionId: crypto.randomUUID(), expiresAt: Date.now() + 120000 }
          await api(`/visitor-sessions/${session.id}/entries`, { kind: 'tool_result', metadata: { name: question.purpose === 'browser-product-choice' ? 'browser_clarify_product' : 'browser_cart_add' }, content: JSON.stringify({ source: 'browser', status: 'clarification', pendingCustomerChoice: question }) })
          await api(`/visitor-sessions/${session.id}/entries`, { kind: 'user_text', content: testCase.text })
          const started = performance.now()
          const result = await api(`/visitor-sessions/${session.id}/browser-answer`, { transcript: testCase.text, questionId: question.questionId })
          results.push({ ...testCase, result, durationMs: performance.now() - started, passed: result.kind === testCase.kind && (!testCase.choiceId || result.choiceId === testCase.choiceId) })
        }
      }
      finally { await api(`/visitor-sessions/${session.id}/end`, { state: 'cancelled' }) }
      return results
    }, clientModuleUrl)
    const vendorWrites = requests.slice(requestIndex).filter(request => ['POST', 'PUT', 'DELETE'].includes(request.method)).length
    const result = { cases: results, cartPreserved: JSON.stringify(before) === JSON.stringify(await readCart()), vendorWrites, kind: 'read-only-provider-contract-probe', submittedOrder: false }
    await writeFile(resolve(outputDirectory, 'answer-cases.json'), JSON.stringify(result, null, 2))
    console.info('Answer provider contract:', JSON.stringify({ passed: results.every(item => item.passed), failed: results.filter(item => !item.passed), cartPreserved: result.cartPreserved, vendorWrites }))
    if (results.some(item => !item.passed) || !result.cartPreserved || vendorWrites)
      process.exitCode = 1
  }
  if (process.argv.includes('--question-cases')) {
    const baseline = await readCart()
    const call = (name, input) => page.evaluate(async ({ url, name, input }) => {
      const { interactiveServiceClient: client } = await import(url)
      return client.execute(client.tools.value.find(tool => tool.name === name), input)
    }, { url: clientModuleUrl, name, input })
    const initial = await call('browser_cart_get', { includeCatalog: true })
    const steps = []
    async function utterance(text) {
      const step = await customerTurn(text)
      steps.push(step)
      return step
    }
    let cleanup
    try {
      const broad = await utterance('我要點餐，一份。')
      if (broad.pending?.purpose !== 'browser-product-choice')
        throw new Error('Broad request did not issue a bound product question.')
      const second = initial.products.find(product => broad.pending.choices[1]?.description.includes(`「${product.name}」`))
      if (!second || baseline.lines.some(line => line.name === second.name))
        throw new Error('Second displayed product must be identifiable and absent from the baseline cart.')
      const selected = await utterance('第二個')
      if (selected.pending?.purpose !== 'browser-confirm-add' || !selected.actual?.includes(second.name) || !selected.actual?.includes('1 份') || JSON.stringify(await readCart()) !== JSON.stringify(baseline))
        throw new Error('Ordinal selection did not present an exact no-effect full confirmation.')
      const corrected = await utterance('對，但改兩份')
      if (corrected.pending?.purpose !== 'browser-confirm-add' || !corrected.actual?.includes(second.name) || !corrected.actual?.includes('2 份') || JSON.stringify(await readCart()) !== JSON.stringify(baseline))
        throw new Error('Correction must replace the full question without writing.')
      const cancelled = await utterance('不要')
      if (!cancelled.actual?.includes('取消') || JSON.stringify(await readCart()) !== JSON.stringify(baseline))
        throw new Error('Cancellation changed the cart or did not present its outcome.')
      await utterance('我要點餐，一份。')
      const selectedAgain = await utterance('第二個')
      if (selectedAgain.pending?.purpose !== 'browser-confirm-add' || !selectedAgain.actual?.includes(second.name) || !selectedAgain.actual?.includes('1 份'))
        throw new Error('Fresh product choice did not create a new complete confirmation.')
      const confirmed = await utterance('對')
      const after = await readCart()
      const added = after.lines.filter(line => !baseline.lines.some(original => original.id === line.id))
      const originalPreserved = baseline.lines.every(original => after.lines.some(line => JSON.stringify(line) === JSON.stringify(original)))
      if (!originalPreserved || added.length !== 1 || added[0].name !== second.name || added[0].quantity !== 1 || added[0].unitPrice !== second.price || after.subtotal !== baseline.subtotal + second.price || !confirmed.receipts.some(receipt => receipt.name === 'browser_cart_add' && receipt.payload.status === 'verified'))
        throw new Error('Confirmed addition did not produce exactly the observed one-serving effect.')
      cleanup = added[0]
      await utterance('對')
      if (JSON.stringify(await readCart()) !== JSON.stringify(after))
        throw new Error('Repeated confirmation produced another effect.')
      const current = await call('browser_cart_get', { includeCatalog: false })
      const removed = await call('browser_cart_remove', { version: current.cart.version, lineRef: String(cleanup.id) })
      if (removed.status !== 'verified' || JSON.stringify(await readCart()) !== JSON.stringify(baseline))
        throw new Error('Cannot verify isolated question test row cleanup.')
      cleanup = undefined
      await writeFile(resolve(outputDirectory, 'question-cases.json'), JSON.stringify({ passed: true, steps, cartPreserved: true, submittedOrder: false }, null, 2))
      console.info('PASS: actual Main/finite question selection, correction, cancellation, one-use confirmation; original cart preserved.')
    }
    catch (error) {
      const after = await readCart()
      await writeFile(resolve(outputDirectory, 'question-cases.json'), JSON.stringify({ passed: false, steps, error: String(error), cartPreserved: JSON.stringify(after) === JSON.stringify(baseline), knownTestRow: cleanup, submittedOrder: false }, null, 2))
      process.exitCode = 1
      console.info('Question acceptance failed:', String(error))
      // An unexpected effect is evidence, not permission to delete an arbitrary
      // cart row. Leave any uncertain result for reconciliation.
    }
  }
  // Keep the actual Kiosk open for inspection, including any failed Agent result.
  if (process.argv.includes('--bridge-smoke')) {
    const field = page.getByPlaceholder('例如：我要一個周氏蝦捲招牌便當', { exact: true })
    console.info('Filling actual Kiosk simulated-ASR input.')
    await field.fill('請在點餐網頁搜尋雞腿便當、打開商品詳情，並在商品備註填入「整合測試，請勿送單」。不要加入購物車，也不要送單。')
    console.info('Submitting actual Kiosk simulated-ASR input.')
    await page.getByRole('button', { name: '模擬辨識並執行', exact: true }).click()
    console.info('Kiosk accepted the simulated-ASR UI action.')
    try {
      await page.frameLocator('iframe').getByRole('dialog').getByRole('heading', { name: '雞腿便當', exact: true }).waitFor({ timeout: 120_000 })
      const note = page.frameLocator('iframe').getByPlaceholder('商品有特殊需求，請在此備註', { exact: true })
      await note.waitFor({ timeout: 30000 })
      const noteDeadline = Date.now() + 30000
      while (await note.inputValue() !== '整合測試，請勿送單' && Date.now() < noteDeadline)
        await page.waitForTimeout(200)
      if (await note.inputValue() !== '整合測試，請勿送單')
        throw new Error('The Agent did not fill the requested draft note.')
      await page.waitForFunction(() => {
        const button = document.querySelector('button.customer-restart')
        return button && !button.disabled
      }, undefined, { timeout: 60000 })
      console.info('PASS: browser bridge smoke completed search/open/note. This is not natural ordering or Jev acceptance.')
    }
    catch {
      process.exitCode = 1
      console.info('Agent verification failed; inspect the real Kiosk trace.')
    }
    await page.screenshot({ path: resolve(outputDirectory, 'webnavior-pb-agent.png') })
    await writeFile(resolve(outputDirectory, 'webnavior-pb-agent.txt'), await page.locator('body').ariaSnapshot())
  }
  await writeFile(resolve(outputDirectory, 'webnavior-pb-api.json'), JSON.stringify(requests, null, 2))
  await new Promise((resolve) => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
    page.once('close', resolve)
  })
}
catch (error) {
  if (!preparingLogin && page && !page.isClosed()) {
    await writeFile(resolve(outputDirectory, 'webnavior-pb-failure.txt'), await page.locator('body').ariaSnapshot()).catch(() => {})
    await page.screenshot({ path: resolve(outputDirectory, 'webnavior-pb-failure.png') }).catch(() => {})
  }
  console.info('PB controller original error:', error.message)
  throw error
}
finally {
  if (!preparingLogin)
    await writeFile(resolve(outputDirectory, 'webnavior-pb-api.json'), JSON.stringify(requests, null, 2))
  await context?.close()
  await rm(scratch, { recursive: true, force: true })
}
