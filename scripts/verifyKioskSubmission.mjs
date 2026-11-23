// Runs the merchant's XHR and the checkout listener in separate Electron worlds.
// The POST and its redirect use a loopback server. No merchant is contacted.
import assert from 'node:assert/strict'
import process from 'node:process'

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron } from 'playwright'

import { observeSubmission } from '../apps/stage-kiosk-desktop/src/main/observeSubmission.ts'

const path = '/order/store/test/internal_use/orders/create'
const errors = [{ diningTime: '目前非營業時間，暫時無法點餐。' }, { order: '測試餐點已售完' }, {}]
let posts = 0
const server = createServer((request, response) => {
  if (request.method === 'POST' && request.url === path.slice(0, -7)) {
    posts++
    response.writeHead(302, { location: path }).end()
  }
  else if (request.headers['x-inertia']) {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ component: 'Order/Create', url: path, props: { errors: errors[posts - 1] } }))
  }
  else {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<button onclick="const r=new XMLHttpRequest();r.open(\'POST\',location.pathname.slice(0,-7));r.setRequestHeader(\'X-Inertia\',\'true\');r.onloadend=()=>window.done=true;r.send()">Confirm</button>')
  }
})
const profile = await mkdtemp(join(tmpdir(), 'pb-submission-'))
let app
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const script = join(profile, 'main.cjs')
  await writeFile(script, 'const { app, BrowserWindow } = require("electron");app.whenReady().then(()=>{global.win=new BrowserWindow({show:false});global.win.loadURL(process.argv.at(-1))})')
  app = await electron.launch({ executablePath: process.env.ESGPB_ELECTRON_PATH, args: [script, `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}${path}`] })
  const page = await app.firstWindow()
  await page.locator('button').waitFor({ state: 'attached' })
  for (const [index, error] of errors.entries()) {
    const event = `pb-submit-${index}`
    await page.evaluate(() => {
      window.done = false
    })
    await page.evaluate(observeSubmission, String(index))
    await app.evaluate(async ({ BrowserWindow }, event) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      await contents.executeJavaScriptInIsolatedWorld(1001, [{ code: `
        globalThis.feedback = []
        document.addEventListener(${JSON.stringify(event)}, e => globalThis.feedback.push(e.detail))
        document.dispatchEvent(new Event(${JSON.stringify(`${event}-start`)}))
        document.querySelector('button').click()
      ` }])
    }, event)
    await page.waitForFunction(() => window.done)
    const feedback = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: 'globalThis.feedback' }]))
    assert.deepEqual(feedback, Object.values(error))
    assert.equal(posts, index + 1)
    await page.evaluate(event => document.dispatchEvent(new Event(`${event}-end`)), event)
  }
  console.info('Electron POST/302/GET: 3 cases passed in separate renderer worlds')
}
finally {
  await app?.close()
  server.close()
  await rm(profile, { recursive: true, force: true })
}
