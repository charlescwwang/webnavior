import assert from 'node:assert/strict'
import process from 'node:process'

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { _electron as electron } from 'playwright'

// Report: this chat, Nov19 — intermittent PB Start stalls disappear on retry.
// Deliberately hold local responses and block a synthetic renderer; no PB is contacted.
const profile = await mkdtemp(resolve(tmpdir(), 'kiosk-diagnostics-'))
const secret = 'PRIVATE-CUSTOMER-123456'
const held = new Set()
const server = createServer((request, response) => {
  if (request.url.startsWith('/held')) {
    held.add(response)
    response.on('close', () => held.delete(response))
    return
  }
  if (request.url.startsWith('/failed')) {
    response.destroy()
    return
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><title>Local fixture</title><h1>Visible menu</h1>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let app
async function records() {
  const names = await readdir(resolve(profile, 'diagnostics')).catch(() => [])
  const lines = await Promise.all(names.filter(name => name.endsWith('.jsonl')).map(name => readFile(resolve(profile, 'diagnostics', name), 'utf8')))
  return lines.join('\n').split('\n').filter(Boolean).map(line => JSON.parse(line))
}
try {
  app = await electron.launch({ executablePath: process.env.ESGPB_ELECTRON_PATH, args: [resolve('apps/stage-kiosk-desktop/out/main/index.js')], env: { ...process.env, KIOSK_DESKTOP_URL: `${origin}/kiosk/`, KIOSK_DESKTOP_WINDOWED: '1', KIOSK_DESKTOP_USER_DATA: profile } })
  const host = await app.firstWindow()
  await host.waitForFunction(() => Boolean(window.airiKioskDesktop))
  const placement = { serviceId: 'diagnostic-fixture', documentKey: 'fixture:1', url: `${origin}/order/store/private-store/internal_use/menu/select-table?token=${secret}`, bounds: { x: 10, y: 60, width: 600, height: 500 }, visible: true }
  await host.evaluate(input => window.airiKioskDesktop.updateSurface(input), placement)
  const site = app.context().pages().find(page => page.url() === placement.url)
  assert(site)
  await site.evaluate((secret) => {
    document.cookie = `secret=${secret}`
    void fetch(`/held/${secret}?token=${secret}`, { method: 'POST', body: secret })
    void fetch(`/failed/${secret}`).catch(() => {})
  }, secret)
  await host.evaluate(() => {
    console.info('[webnavior-performance]', JSON.stringify({ kind: 'model', model: 'avatar', phase: 'start', durationMs: 0 }))
    console.info('[webnavior-performance]', JSON.stringify({ kind: 'model', model: 'avatar', phase: 'ready', durationMs: 300 }))
    setTimeout(() => {
      const end = performance.now() + 350
      while (performance.now() < end) { /* Deliberate local-only regression fixture. */ }
    }, 0)
  })
  const deadline = Date.now() + 15_000
  let captured
  while (Date.now() < deadline) {
    captured = await records()
    if (captured.some(row => row.event === 'request-pending') && captured.some(row => row.event === 'renderer-performance' && row.role === 'host' && row.longestTaskMs >= 300))
      break
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert(captured.some(row => row.event === 'request-pending' && row.role === 'pb'), 'A still-pending PB request must be retained before completion.')
  assert(captured.some(row => row.event === 'request-failed' && row.role === 'pb'), 'Network failure must be recorded.')
  assert(captured.some(row => row.event === 'renderer-performance' && row.role === 'host' && row.longestTaskMs >= 300), `Host long tasks must be visible separately from PB network waits: ${JSON.stringify(captured.filter(row => row.event.startsWith('renderer-')))}`)
  assert(captured.some(row => row.event === 'model' && row.phase === 'ready' && row.durationMs === 300))
  assert(captured.some(row => row.event === 'process-sample' && row.processes.length > 0))
  assert(!JSON.stringify(captured).includes(secret), 'Headers, request body, query and arbitrary path must never enter the logs.')
  assert(!JSON.stringify(captured).includes('private-store'), 'PB store identifiers must be redacted.')
  assert(captured.every(row => row.at && row.runId && Number.isFinite(row.elapsedMs)))
  for (const response of held)
    response.end('done')
  await site.waitForTimeout(1300)
  const completed = await records()
  const pending = captured.find(row => row.event === 'request-pending' && row.role === 'pb')
  assert(completed.some(row => row.event === 'request-completed' && row.requestId === pending.requestId && row.durationMs >= 4000))
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].getVisible()), true)
  console.info('PASS: bounded persistent diagnostics correlate pending/failed/completed PB requests, navigation, Host long tasks, model phases and process samples without customer data or a loading cover.')
}
finally {
  for (const response of held)
    response.end()
  await app?.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(profile, { recursive: true, force: true })
}
