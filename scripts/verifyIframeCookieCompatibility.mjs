import assert from 'node:assert/strict'
import process from 'node:process'

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'

import { chromium } from 'playwright'

import { CookieCompatibility } from '../apps/stage-kiosk/scripts/browserCookieCompatibility.mjs'

// Dedicated profile and CDP endpoint: never attach to a personal browser or expose cookie values.
assert.equal(process.versions.node, '24.22.1', 'Use the inspected Node 24.22.1 runtime.')
assert(process.env.ESGPB_EMAIL && process.env.ESGPB_PASSWORD, 'Supply ESGPB_EMAIL and ESGPB_PASSWORD.')
const candidates = process.env.KIOSK_BROWSER_PATH
  ? [process.env.KIOSK_BROWSER_PATH]
  : process.platform === 'win32'
    ? [join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'), join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe')]
    : ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
let executable
for (const candidate of candidates) {
  try {
    await access(candidate)
    executable = candidate
    break
  }
  catch { /* An absent browser is skipped; no browser is downloaded or silently installed. */ }
}
assert(executable, 'Set KIOSK_BROWSER_PATH to an installed Edge or Chrome executable.')
const profile = await mkdtemp(join(tmpdir(), 'airi-iframe-cookie-cdp-'))
const target = 'https://app.esgpb.com/order/login?store_hash=PRBMqkW&flow_type=pick_up'
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><meta charset="utf-8"><title>iframe CDP test</title><h2>iframe／CDP 登入驗證（不送單）</h2><iframe title="點餐網站" style="width:100%;height:850px;border:0" src="${target.replaceAll('&', '&amp;')}"></iframe>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert(address && typeof address !== 'string')
const runtimeEnv = { ...process.env }
delete runtimeEnv.ESGPB_EMAIL
delete runtimeEnv.ESGPB_PASSWORD
const child = spawn(executable, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { env: runtimeEnv, stdio: 'ignore' })
let browser
let compatibility
let page
try {
  let endpoint
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n')
      endpoint = `http://127.0.0.1:${Number(port)}`
      break
    }
    catch { await pause(100) }
  }
  assert(endpoint, 'Browser did not publish its dedicated CDP endpoint.')
  browser = await chromium.connectOverCDP(endpoint)
  const context = browser.contexts()[0]
  page = context.pages()[0]
  page.setDefaultTimeout(30_000)
  page.on('response', (response) => {
    if (response.request().isNavigationRequest())
      console.info('DOCUMENT:', response.status(), new URL(response.url()).pathname)
    if (response.status() >= 400 && ['script', 'stylesheet'].includes(response.request().resourceType()))
      console.info('RESOURCE_ERROR:', response.status(), new URL(response.url()).pathname)
  })
  page.on('pageerror', error => console.info('PAGE_ERROR:', error.name))
  await page.goto(`http://127.0.0.1:${address.port}/`)
  const frame = page.frameLocator('iframe')
  await frame.locator('input[type=password]').waitFor()
  await frame.getByRole('textbox', { name: 'Email 或 手機' }).fill(process.env.ESGPB_EMAIL)
  await frame.locator('input[type=password]').fill(process.env.ESGPB_PASSWORD)
  let baselineControlBlocked = false
  try {
    await frame.getByRole('button', { name: /^(登入|log in)$/i }).click({ timeout: 1500 })
  }
  catch (error) {
    if (error.name !== 'TimeoutError')
      throw error
    baselineControlBlocked = true
  }
  await pause(500)
  assert.equal(await frame.locator('input[type=password]').count(), 1)
  assert.equal((await context.cookies('https://app.esgpb.com/order/')).filter(cookie => ['order_session', 'XSRF-TOKEN'].includes(cookie.name)).length, 0)
  console.info('PASS: baseline reproduces missing iframe cookies.', JSON.stringify({ baselineControlBlocked }))
  compatibility = new CookieCompatibility(context, 'https://app.esgpb.com')
  const siteFrame = page.frames().find(item => item.url().startsWith('https://app.esgpb.com/'))
  assert(siteFrame)
  const session = await context.newCDPSession(siteFrame)
  await compatibility.attach(session)
  await session.send('Network.clearBrowserCache')
  await siteFrame.goto(target)
  await frame.locator('input[type=password]').waitFor()
  for (let attempt = 0; attempt < 50; attempt++) {
    await compatibility.settle()
    const names = new Set((await context.cookies('https://app.esgpb.com/order/')).filter(cookie => cookie.sameSite === 'None').map(cookie => cookie.name))
    if (['order_session', 'XSRF-TOKEN', 'srvkey'].every(name => names.has(name)))
      break
    await pause(100)
  }
  console.info('COOKIE_METADATA:', JSON.stringify({ ...compatibility.stats, cookies: (await context.cookies('https://app.esgpb.com/order/')).filter(cookie => ['order_session', 'XSRF-TOKEN'].includes(cookie.name)).map(({ name, domain, path, sameSite, secure, httpOnly }) => ({ name, domain, path, sameSite, secure, httpOnly })) }))
  assert(compatibility.stats.written > 0, 'No eligible SameSite cookies were restored; inspect block-reason metadata.')
  // Reload after the initial recovery so application bootstrap can read the now-available cookie.
  await siteFrame.waitForLoadState('networkidle')
  await compatibility.settle()
  // The failed baseline may have cached a 404 for a versioned module from the other backend.
  // Clear only this disposable browser's cache before the controlled second navigation.
  await session.send('Network.clearBrowserCache')
  await siteFrame.goto(target)
  await frame.getByRole('textbox', { name: '密碼', exact: true }).waitFor()
  await frame.getByRole('textbox', { name: 'Email 或 手機' }).fill(process.env.ESGPB_EMAIL)
  await frame.getByRole('textbox', { name: '密碼', exact: true }).fill(process.env.ESGPB_PASSWORD)
  await frame.getByRole('button', { name: '登入', exact: true }).click()
  await frame.getByText('測試帳號', { exact: true }).waitFor()
  await compatibility.settle()
  console.info('PASS: iframe login succeeds through CDP cookie compatibility.')
  await siteFrame.goto('https://app.esgpb.com/order/store/PRBMqkW/pick_up/menu')
  await frame.getByText('測試帳號', { exact: true }).waitFor()
  console.info('PASS: authenticated iframe survives reload.')
  await frame.getByRole('button', { name: /^烏龍茶 / }).first().waitFor()
  if (await frame.getByRole('button', { name: '稍後再領', exact: true }).isVisible())
    await frame.getByRole('button', { name: '稍後再領', exact: true }).click()
  if (await frame.getByRole('button', { name: '我知道了，開始點餐', exact: true }).isVisible())
    await frame.getByRole('button', { name: '我知道了，開始點餐', exact: true }).click()
  await page.screenshot({ path: '/tmp/airi-iframe-cdp-menu.png' })
  if (process.argv.includes('--cart')) {
    const summary = frame.getByText('去結算', { exact: true }).locator('xpath=ancestor::*[contains(., "$")][1]')
    const initialTotal = Number((await summary.textContent()).match(/\$\s*(\d+)/)[1])
    const marker = `CDP原型驗證-${randomUUID()}`
    await frame.getByRole('button', { name: /^烏龍茶 / }).first().click()
    const product = frame.getByRole('dialog').filter({ hasText: '烏龍茶' })
    await product.getByRole('radio', { name: 'M $40', exact: true }).waitFor()
    await product.getByText('微糖', { exact: true }).click()
    await product.getByText('微冰', { exact: true }).click()
    await product.getByRole('textbox', { name: '商品有特殊需求，請在此備註' }).fill(marker)
    await product.getByRole('button', { name: '選好了 共計$40', exact: true }).click()
    await product.waitFor({ state: 'hidden' })
    await frame.getByText('去結算', { exact: true }).click()
    const note = frame.getByText(marker, { exact: true })
    await note.waitFor()
    const row = note.locator('xpath=ancestor::*[.//button][1]')
    assert.equal(await row.getByRole('heading', { name: '烏龍茶 ($40)', exact: true }).count(), 1)
    assert.match(await row.textContent(), /M.*微冰.*微糖/s)
    await frame.getByText(`總金額$${initialTotal + 40}`, { exact: true }).waitFor()
    await page.screenshot({ path: '/tmp/airi-iframe-cdp-cart.png' })
    console.info('PASS: controlled visible iframe adds the selected item and verifies cart.')
    await row.getByRole('button', { name: '', exact: true }).click()
    await note.waitFor({ state: 'hidden' })
    await frame.getByText(`總金額$${initialTotal}`, { exact: true }).waitFor()
    console.info('PASS: tagged item removed; original cart retained. No order/payment submitted.')
  }
  await compatibility.disable()
  const restored = (await context.cookies('https://app.esgpb.com/order/')).filter(cookie => ['order_session', 'XSRF-TOKEN'].includes(cookie.name))
  assert.equal(restored.length, 2)
  for (const cookie of restored)
    assert.equal(cookie.sameSite, 'Lax')
  console.info('PASS: disabling restores Lax attributes without replacing Session values.')
  console.info('RESULT:', JSON.stringify({ browser: await browser.version(), ...compatibility.stats }))
}
catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: '/tmp/airi-iframe-cdp-failure.png' })
    console.info('DIAGNOSTIC:', JSON.stringify({ compatibility: compatibility?.stats, frames: page.frames().map(frame => ({ path: new URL(frame.url()).pathname })) }))
  }
  throw error
}
finally {
  const exited = child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve()
  await browser?.close()
  child.kill('SIGTERM')
  await Promise.race([exited, pause(5000)])
  await new Promise(resolve => server.close(resolve))
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
