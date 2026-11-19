import assert from 'node:assert/strict'
import process from 'node:process'

import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { _electron as electron } from 'playwright'

// Report: this chat, 2026-11-19 — PB table Start intermittently leaves a white region.
// Hold a real subresource after DOMContentLoaded; no merchant, login or order is used.
const runtime = process.env.ESGPB_ELECTRON_PATH
assert(runtime, 'Set ESGPB_ELECTRON_PATH to the inspected Electron runtime.')
const profile = await mkdtemp(resolve(tmpdir(), 'kiosk-native-loading-'))
const requested = Promise.withResolvers()
let imageResponse
let imageReleased = false
const server = createServer((request, response) => {
  if (request.url === '/held-image') {
    if (imageReleased) {
      response.end()
      return
    }
    imageResponse = response
    requested.resolve()
    return
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(request.url.startsWith('/kiosk/')
    ? '<!doctype html><h1>Kiosk loading fixture</h1>'
    : request.url.endsWith('/select-table')
      ? '<!doctype html><button onclick="location.href=location.pathname.replace(\'/select-table\', \'\')">Start ordering</button>'
      : '<!doctype html><h1>Menu ready to display</h1><img src="/held-image"><script>window.addEventListener("load",()=>window.fixtureLoaded=true)</script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let app
try {
  app = await electron.launch({ executablePath: runtime, args: [resolve('apps/stage-kiosk-desktop/out/main/index.js')], env: { ...process.env, KIOSK_DESKTOP_URL: `${origin}/kiosk/`, KIOSK_DESKTOP_WINDOWED: '1', KIOSK_DESKTOP_USER_DATA: profile } })
  const host = await app.firstWindow()
  await host.waitForFunction(() => Boolean(window.airiKioskDesktop))
  const placement = { serviceId: 'loading-fixture', documentKey: 'loading-fixture:1', url: `${origin}/order/store/1kgJeql/internal_use/menu/select-table`, bounds: { x: 10, y: 60, width: 600, height: 500 }, visible: true }
  await host.evaluate((input) => {
    window.nativeEvents = []
    window.airiKioskDesktop.onNavigation(event => window.nativeEvents.push(event))
    return window.airiKioskDesktop.updateSurface(input)
  }, placement)
  const site = app.context().pages().find(page => page.url() === placement.url)
  assert(site)
  const cdp = await app.context().newCDPSession(site)
  // Playwright focus emulation would falsely report a hidden native view as visible.
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false })
  const visible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].getVisible())
  const update = changes => host.evaluate(input => window.airiKioskDesktop.updateSurface(input), { ...placement, ...changes })
  await site.evaluate(() => document.querySelector('button').click())
  await requested.promise
  await site.waitForFunction(() => document.readyState === 'interactive')
  assert.equal(await site.evaluate(() => Boolean(window.fixtureLoaded)), false)
  assert.equal(await visible(), true, 'A renderable menu must remain visible while an image prevents did-finish-load.')
  const resize = await update({ bounds: { ...placement.bounds, width: 550 } })
  assert.equal(resize.state, 'loading', 'Visibility must not announce automation readiness.')
  assert.equal(await visible(), true, 'Resize must preserve the renderable document.')
  await assert.rejects(host.evaluate(input => window.airiKioskDesktop.invokeService({ serviceId: input.serviceId, documentKey: input.documentKey, command: { kind: 'discover', request: { version: 1, connectionId: 'loading-fixture', challenge: 'loading-fixture' } } }), placement), /approved PB menu/)
  await update({ visible: false })
  assert.equal(await visible(), false, 'Host settings still own occlusion.')
  await update({ visible: true })
  assert.equal(await visible(), true)
  imageReleased = true
  imageResponse.end()
  await site.waitForFunction(() => window.fixtureLoaded === true)
  await host.waitForFunction(() => window.nativeEvents.filter(event => event.state === 'ready').length === 2)
  assert.equal(await visible(), true)
  assert.equal((await update({})).state, 'visible')
  await update({ visible: false })
  await site.reload()
  assert.equal(await visible(), false, 'A ready hidden document must not bypass host visibility.')
  console.info('PASS: renderable menu visible before full load; resize, tool admission, host occlusion and completed-load lifecycle preserved.')
}
finally {
  imageResponse?.end()
  await app?.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(profile, { recursive: true, force: true })
}
