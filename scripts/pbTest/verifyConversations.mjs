import assert from 'node:assert/strict'
import process from 'node:process'

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../../', import.meta.url))
const state = resolve(root, 'pb-test.local')
const origin = 'http://127.0.0.1:15169'
const mode = process.env.PB_ACCEPTANCE_MODE ?? 'main'
assert(['main', 'jev-main'].includes(mode), 'PB_ACCEPTANCE_MODE must be main or jev-main.')
const manifestBytes = await readFile(new URL('./conversationCases.json', import.meta.url))
const manifest = JSON.parse(manifestBytes)
const selectedIds = process.env.PB_ACCEPTANCE_CASES?.split(',').filter(Boolean)
const cases = manifest.cases.filter(test => selectedIds ? selectedIds.includes(test.id) : test.suite === manifest.defaultSuite)
assert(cases.length && (!selectedIds || cases.length === new Set(selectedIds).size), 'Unknown or empty case selection.')
const directory = resolve(state, 'conversation-acceptance')
await mkdir(directory, { recursive: true, mode: 0o700 })
const report = resolve(directory, `${mode}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.json`)
const ledger = { version: 1, mode, startedAt: new Date().toISOString(), source: manifest.source, manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), cases: [], blockedWrites: [] }
const sourceFiles = ['packages/stage-shared/src/pbMenuPresentation.ts', 'apps/stage-kiosk/src/services/browserCartTask.ts', 'apps/stage-kiosk/src/services/browserDialogue.ts', 'apps/stage-kiosk/src/services/browserOrderDrafts.ts', 'apps/stage-kiosk/src/services/browserQuestionWindow.ts', 'apps/stage-kiosk/src/services/browserFastPath.ts', 'apps/stage-kiosk/src/services/browserPresentation.ts', 'apps/stage-kiosk/src/composables/useKioskInteractionRecording.ts', 'apps/stage-kiosk/src/components/KioskScene.vue', 'apps/server/src/routes/kiosk/index.ts', 'apps/server/src/services/domain/kiosk-agent-interaction/index.ts', 'apps/server/src/services/domain/browser-ordering/index.ts', 'apps/server/src/services/domain/kiosk-interaction-decision/routing.ts', 'packages/stage-shared/src/browserConversation.ts', 'packages/stage-shared/src/orderingSites.ts', 'apps/stage-kiosk-desktop/out/service/pb.js', 'pb-test.local/site/kiosk/index.html']
sourceFiles.push('apps/server/src/services/domain/browser-ordering/skills.ts', 'packages/stage-shared/src/pbJourney.ts', 'packages/stage-shared/src/invoiceInput.ts', 'packages/stage-ui/src/services/pbTablePicker.ts', 'packages/stage-ui/src/services/pbInvoiceInput.ts', ...['common', 'table', 'browse', 'order', 'cart', 'checkout'].map(name => `apps/server/src/services/domain/browser-ordering/skills/${name}/SKILL.md`))
ledger.sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')])))
const save = () => writeFile(report, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 })
const diagnostic = (await readFile(resolve(state, 'desktop-profile/DevToolsActivePort'), 'utf8')).split('\n')[0]
assert(/^\d+$/.test(diagnostic), 'Expected the existing isolated Electron loopback diagnostic port.')
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${diagnostic}`)
const pages = browser.contexts().flatMap(context => context.pages())
const host = pages.find(page => page.url().startsWith(`${origin}/kiosk/`))
const consolePage = pages.find(page => page.url() === 'about:blank')
const merchantUrl = new URL(manifest.merchant)
const merchant = pages.find(page => page.url().startsWith(new URL('./', merchantUrl).href))
assert(host && consolePage && merchant, 'Expected the isolated Kiosk, text console and approved PB page.')
const base = new URL('./', merchantUrl).pathname.replace(/\/$/, '')
const writes = []
const receipts = []
const questions = []
let knownNames = []
let current
const transcript = host.getByRole('region', { name: '與虛擬服務員對話', exact: true }).locator('p')

// Only cart-detail effects are permitted on this real merchant. Unexpected order
// submission/payment requests fail the run before dispatch; reads are unchanged.
await merchant.route(`${merchantUrl.origin}/**`, async (route) => {
  const request = route.request()
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()))
    return route.continue()
  const path = new URL(request.url()).pathname
  const details = path.slice(`${base}/orders/`.length)
  const cartWrite = path.startsWith(`${base}/orders/`)
    && /^[\w-]+\/details\/(?:store|all|\d+)$/.test(details)
  const invoiceRead = request.method() === 'POST' && path === `${base}/orders/checkInvoiceData`
  if (!cartWrite && !invoiceRead) {
    ledger.blockedWrites.push({ method: request.method(), path })
    await save()
    return route.abort('blockedbyclient')
  }
  writes.push({ method: request.method(), path })
  return route.continue()
})

host.on('request', (request) => {
  if (!request.url().startsWith(`${origin}/api/kiosk/visitor-sessions/`) || request.method() !== 'POST')
    return
  let body
  try {
    body = request.postDataJSON()
  }
  catch { return }
  const results = body?.kind === 'tool_result' ? [{ name: body.metadata?.name, content: body.content }] : body?.toolResults ?? []
  for (const result of results) {
    try {
      const payload = JSON.parse(result.content)
      if (payload.ok === true && payload.source === 'browser' && payload.presentation?.cue === 'shown' && payload.presentation.products?.length)
        receipts.push({ name: result.name, products: payload.presentation.products })
      if (payload.ok === true && payload.source === 'browser' && payload.pendingCustomerChoice)
        questions.push({ purpose: payload.pendingCustomerChoice.purpose, question: payload.pendingCustomerChoice.question })
    }
    catch { /* Only structured, successful native presentations are evidence. */ }
  }
})

async function assertMode() {
  const enabled = await host.evaluate(async () => {
    const response = await fetch('/api/kiosk/interaction-decisions/status', { cache: 'no-store', credentials: 'include' })
    if (!response.ok)
      throw new Error(`Mode lookup failed: ${response.status}`)
    return (await response.json()).enabled
  })
  assert.equal(enabled, mode === 'jev-main', 'Actual Jev activation differs from the requested test mode.')
}

async function cart() {
  return merchant.evaluate(async (base) => {
    const response = await fetch(`${base}/orders/create`, { cache: 'no-store', signal: AbortSignal.timeout(10000) })
    if (!response.ok)
      throw new Error(`Cart GET ${response.status}`)
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html')
    const { props } = JSON.parse(doc.querySelector('[data-page]').getAttribute('data-page'))
    if (props.order === null && props.subtotal === 0 && (!props.details || !props.details.length))
      return { subtotal: 0, lines: [] }
    if (!props.order || !Array.isArray(props.details))
      throw new Error('Unreadable actual PB cart.')
    return { subtotal: props.subtotal, lines: props.details.map(row => ({ name: row.item.name, quantity: row.amount, unitPrice: row.unit_price, note: row.note ?? '', options: row.product_prices.flatMap(price => price.product_attrs.map(option => ({ name: option.attr.name, quantity: option.amount }))) })) }
  }, base)
}

// PB may merge identical additions or retain multiple rows. Compare domain
// configurations and summed quantities, preserving distinct notes/add-on counts.
function normalized(lines) {
  const groups = new Map()
  for (const line of lines) {
    const configuration = { name: line.name, unitPrice: line.unitPrice, note: line.note ?? '', options: [...line.options ?? []].sort((a, b) => a.name.localeCompare(b.name)) }
    const key = JSON.stringify(configuration)
    groups.set(key, { ...configuration, quantity: (groups.get(key)?.quantity ?? 0) + line.quantity })
  }
  return [...groups.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

async function reset() {
  const restart = host.getByRole('button', { name: '重新開始／新訂單', exact: true })
  if (await restart.count()) {
    await restart.click({ timeout: 15000 })
    await host.getByRole('button', { name: '開始新交談／新訂單', exact: true }).waitFor({ timeout: 60000 })
  }
  assert.deepEqual(await cart(), { subtotal: 0, lines: [] }, 'The existing reception reset did not clear this test cart.')
}

async function turn(text) {
  const started = Date.now()
  const startReceipt = receipts.length
  const startQuestion = questions.length
  const presented = host.waitForRequest((request) => {
    if (!/\/api\/kiosk\/visitor-sessions\/[^/]+\/entries$/.test(new URL(request.url()).pathname) || request.method() !== 'POST')
      return false
    const body = request.postDataJSON()
    if (body.kind === 'assistant_text' && body.metadata?.source !== 'fixed_greeting')
      return true
    if (body.kind !== 'service_event' || body.metadata?.source !== 'utterance_timing')
      return false
    try {
      const event = JSON.parse(body.content)
      return event.boundary === 'task' && event.status === 'failed'
    }
    catch { return false }
  }, { timeout: 90000 })
  await consolePage.getByPlaceholder('例如：我要一個周氏蝦捲招牌便當', { exact: true }).fill(text)
  await consolePage.getByRole('button', { name: '模擬辨識並執行', exact: true }).click()
  const request = await presented
  await (await request.response())?.finished()
  await host.waitForFunction(() => document.querySelector('button.customer-restart')?.disabled === false, undefined, { timeout: 90000 })
  const history = await transcript.allTextContents()
  const observation = { text, reply: history.at(-1) ?? '', durationMs: Date.now() - started, cart: await cart(), presentations: receipts.slice(startReceipt), question: questions.slice(startQuestion).at(-1) }
  current.turns.push(observation)
  await save()
  console.info(JSON.stringify({ case: current.id, ...observation }))
  assert.equal(ledger.blockedWrites.length, 0, 'An unexpected merchant write was blocked.')
  assert(!/處理上限|目前沒有可驗證|系統未接受|重新說明|暫時無法/.test(observation.reply), observation.reply)
  return observation
}

async function verifyCase(test) {
  let remembered = []
  let previousShown = []
  for (const step of test.steps) {
    if (step.action === 'new-customer') {
      await reset()
      continue
    }
    const results = [await turn(step.text)]
    let expected = step.lines
    if (step.fromShown) {
      const product = remembered[step.fromShown.index]
      assert(product && Number.isFinite(product.price), 'No verified displayed item at this ordinal.')
      expected = [{ name: product.name, quantity: step.fromShown.quantity, unitPrice: product.price, note: '', options: [] }]
    }
    if (step.confirmProduct && /^您是指「.+」嗎[？?]?$/.test(results[0].reply)) {
      const target = results[0].reply.match(/^您是指「(.+)」嗎/)[1]
      assert(expected?.some(line => (line.spokenName ?? line.name) === target), 'The product clarification selected a different meal; consent withheld.')
      results.push(await turn('對'))
    }
    if (step.declineExtras && results.at(-1).reply.includes('也可以說不加')) {
      assert(expected?.every(line => line.options.length === 0), 'This scripted answer may only decline extra options.')
      results.push(await turn('不加'))
    }
    // Consent follows the actual Host question type, never a spoken prefix.
    if (step.autoConfirm && results.at(-1).question?.purpose === 'browser-confirm-add') {
      assert.equal(results.at(-1).reply, results.at(-1).question.question, 'The actual sealed confirmation was not presented; consent withheld.')
      const mentioned = knownNames.filter(name => results.at(-1).reply.includes(name))
      assert(mentioned.length && mentioned.every(name => expected?.some(line => line.name === name || line.spokenName === name)), 'Confirmation contains an unexpected meal; consent withheld.')
      results.push(await turn('對'))
    }
    const last = results.at(-1)
    if (expected) {
      assert.deepEqual(normalized(last.cart.lines), normalized(expected), 'Actual cart configurations/counts differ from the case gold.')
      assert.equal(last.cart.subtotal, expected.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0), 'Actual subtotal differs from the case gold.')
    }
    const reply = results.map(result => result.reply).join('\n')
    if (step.reply)
      assert.match(reply, new RegExp(step.reply))
    if (step.forbid)
      assert.doesNotMatch(reply, new RegExp(step.forbid))
    const shown = results.flatMap(result => result.presentations).at(-1)?.products ?? []
    if (step.needsPresentation || step.maxShownPrice !== undefined) {
      assert(shown.length > 0, 'No verified presentation for this inquiry.')
      for (const product of shown) {
        assert(reply.includes(product.name), `Shown product ${product.name} is missing from the customer reply.`)
        assert(await merchant.getByRole('heading', { name: product.name, exact: true }).isVisible(), `Shown product ${product.name} is not visible on PB.`)
      }
    }
    if (step.maxShownPrice !== undefined) {
      assert(shown.length <= 3, 'A recommendation exceeded three products.')
      for (const product of shown)
        assert(Number.isFinite(product.price) && product.price <= step.maxShownPrice, `${product.name} exceeds the current budget.`)
    }
    if (step.novel)
      assert(!shown.some(product => previousShown.includes(product.ref)), 'The next recommendation repeated a previous item.')
    if (step.rememberShown) {
      assert(shown.length >= 2, 'Ordinal selection needs at least two verified displayed items.')
      remembered = shown
    }
    if (shown.length)
      previousShown = shown.map(product => product.ref)
  }
}

/**
 * Runs opt-in real-model PB dialogues from an empty owned test cart. Gold stays
 * in this driver; only each customer's text and explicit scripted consent enter
 * the app. Failures are retained, never retried until a lucky pass. Model mode
 * is checked from the authenticated Kiosk; this runner never activates a model.
 *
 * Call stack:
 * run
 *   -> {@link verifyCase}
 *     -> {@link turn}
 *     -> {@link cart}
 *   -> {@link reset}
 */
async function run() {
  await assertMode()
  const entry = (await readFile(resolve(state, 'site/kiosk/index.html'), 'utf8')).match(/src="(\/kiosk\/assets\/index-[^"]+\.js)"/)?.[1]
  assert(entry, 'Published Kiosk entry is missing.')
  const loadedEntries = await host.evaluate(() => [...document.scripts].map(script => script.getAttribute('src')))
  assert(loadedEntries.includes(entry), 'Electron still has an older Kiosk entry; reload before acceptance.')
  ledger.loadedEntry = entry
  assert.deepEqual(await cart(), { subtotal: 0, lines: [] }, 'Preserve the existing cart: start only from an empty baseline.')
  await reset()
  knownNames = [...new Set(await merchant.locator('main h4').allTextContents())]
  // Test gold may distinguish speech labels from native merchant identity.
  // Only labels whose original names are actually rendered join the consent check.
  const speechLabels = cases.flatMap(test => test.steps.flatMap(step => step.lines ?? []))
    .filter(line => line.spokenName && knownNames.includes(line.name))
    .map(line => line.spokenName)
  knownNames = [...new Set([...knownNames, ...speechLabels])]
  for (const test of cases) {
    await assertMode()
    current = { id: test.id, title: test.title, masterIds: test.masterIds, status: 'running', turns: [] }
    ledger.cases.push(current)
    const writeStart = writes.length
    try {
      await verifyCase(test)
      current.status = 'passed'
    }
    catch (error) {
      current.status = 'failed'
      current.error = String(error)
    }
    current.writes = writes.slice(writeStart)
    await save()
    try {
      await reset()
    }
    catch (error) {
      current.cleanupError = String(error)
      await save()
      throw error // Unknown effects/control locks require review, never forced cleanup.
    }
    console.info(JSON.stringify({ case: current.id, status: current.status, error: current.error }))
  }
  assert.equal(createHash('sha256').update(await readFile(new URL('./conversationCases.json', import.meta.url))).digest('hex'), ledger.manifestSha256, 'Case gold changed during this run.')
  for (const [path, hash] of Object.entries(ledger.sourceHashes))
    assert.equal(createHash('sha256').update(await readFile(resolve(root, path))).digest('hex'), hash, `Runtime source changed during this run: ${path}`)
  ledger.finalCart = await cart()
  ledger.completedAt = new Date().toISOString()
  ledger.passed = ledger.cases.filter(test => test.status === 'passed').length
  ledger.total = cases.length
  await save()
  console.info(JSON.stringify({ report, passed: ledger.passed, total: ledger.total, finalCart: ledger.finalCart, blockedWrites: ledger.blockedWrites }))
  return ledger.passed === ledger.total ? 0 : 1
}

try {
  process.exit(await run())
}
catch (error) {
  ledger.fatal = String(error)
  await save()
  console.error(JSON.stringify({ report, fatal: ledger.fatal }))
  process.exit(1) // Disconnect CDP without closing the user's Electron application.
}
