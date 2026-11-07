import assert from 'node:assert/strict'

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { launchFirefox } from '../apps/stage-kiosk/scripts/firefoxBrowser.mjs'

// Disposable synthetic origins: no merchant request, account or retained profile.
const profile = await mkdtemp(resolve(tmpdir(), 'pb-firefox-policy-'))
let context
try {
  context = await launchFirefox(profile, { headless: true })
  console.info('Firefox cookie fixture browser:', context.browser().version())
  let received = false
  await context.route('https://pb-cookie-fixture.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/order/probe') {
      received = (await route.request().headerValue('cookie') ?? '').includes('fixture_session=')
      await route.fulfill({ json: { completed: true } })
      return
    }
    await route.fulfill({ contentType: 'text/html', headers: { 'set-cookie': 'fixture_session=synthetic; Path=/order; HttpOnly; Secure; SameSite=Lax' }, body: '<!doctype html><button onclick="fetch(\'/order/probe\').then(()=>document.body.dataset.done=\'yes\')">Probe</button>' })
  })
  await context.route('https://host-cookie-fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><iframe src="https://pb-cookie-fixture.test/order/menu"></iframe>' }))
  const page = await context.newPage()
  await page.goto('https://pb-cookie-fixture.test/order/menu')
  await page.evaluate(async () => (await fetch('/order/probe')).json())
  assert.equal(received, true, 'First-party control must send the synthetic Lax cookie.')
  received = false
  await page.goto('https://host-cookie-fixture.test/')
  await page.frameLocator('iframe').getByRole('button', { name: 'Probe', exact: true }).waitFor()
  const frame = page.frames().find(frame => frame.url() === 'https://pb-cookie-fixture.test/order/menu')
  assert(frame)
  await frame.evaluate(async () => (await fetch('/order/probe')).json())
  assert.equal(received, false, 'Cross-site iframe must not bypass the Lax restriction.')
  await context.route('https://app.esgpb.com/**', async (route) => {
    const cookie = await route.request().headerValue('cookie') ?? ''
    if (new URL(route.request().url()).pathname === '/order/probe') {
      await route.fulfill({ json: { authenticated: cookie.includes('order_session=synthetic') } })
      return
    }
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><h1>PB synthetic document</h1>' })
  })
  await context.addCookies([{ name: 'order_session', value: 'synthetic', domain: 'app.esgpb.com', path: '/order', httpOnly: true, secure: true, sameSite: 'None' }])
  await context.route('**/firefox-cookie-fixture', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><iframe src="https://app.esgpb.com/order/menu"></iframe>' }))
  for (const [origin, expected] of [['http://localhost:5169', true], ['http://127.0.0.1:5169', false], ['https://host-cookie-fixture.test', false]]) {
    await page.goto(`${origin}/firefox-cookie-fixture`)
    await page.frameLocator('iframe').getByRole('heading', { name: 'PB synthetic document' }).waitFor()
    const guest = page.frames().find(frame => frame.url() === 'https://app.esgpb.com/order/menu')
    assert(guest)
    const accepted = await guest.evaluate(async () => (await fetch('/order/probe')).json())
    assert.equal(accepted.authenticated, expected, `PB login sharing must be limited to the approved Kiosk/PB pair: ${origin}`)
  }
  console.info('PASS: installed Firefox persistent startup; first-party Lax control; unrelated iframe blocked; PB prepared login shared only with localhost Kiosk. All merchant responses are synthetic.')
}
finally {
  await context?.close()
  await rm(profile, { recursive: true, force: true, maxRetries: 5 })
}
