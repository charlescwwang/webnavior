import assert from 'node:assert/strict'

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { build } from 'vite'

import { launchFirefox } from '../apps/stage-kiosk/scripts/firefoxBrowser.mjs'

const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(resolve(tmpdir(), 'airi-firefox-peer-'))
const menu = 'https://app.esgpb.com/order/store/1kgJeql/pick_up/menu'
let context
try {
  await build({ configFile: false, root: resolve(root, 'packages/stage-ui'), build: { outDir: scratch, emptyOutDir: false, lib: { entry: 'src/services/pbBrowserBridgePrototype.ts', name: 'PbBridge', formats: ['iife'], fileName: () => 'bridge.js' } } })
  const bridge = await readFile(resolve(scratch, 'bridge.js'), 'utf8')
  context = await launchFirefox(resolve(scratch, 'profile'), { headless: true })
  // All PB requests are intercepted; no merchant, login or order is contacted.
  await context.route('https://app.esgpb.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><input placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"><main><button><h4>Fixture meal</h4>$10</button></main>' }))
  await context.route('**/firefox-peer-fixture', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><iframe referrerpolicy="no-referrer" src="${menu}"></iframe>` }))
  const page = await context.newPage()
  for (const [origin, allowed] of [['http://localhost:5169', true], ['http://127.0.0.1:5169', false]]) {
    await page.goto(`${origin}/firefox-peer-fixture`)
    await page.frameLocator('iframe').getByRole('button').waitFor()
    const frame = page.frames().find(frame => frame.url() === menu)
    assert(frame)
    assert.equal(await frame.evaluate(() => document.referrer), '')
    await frame.evaluate(bridge)
    const result = await page.evaluate(async ({ menu, allowed }) => {
      const { interactiveServiceClient: client } = await import('http://localhost:5169/kiosk/src/services/interactiveServiceClient.ts')
      client.activate(menu, document.querySelector('iframe').contentWindow)
      try {
        await client.waitUntilReady()
        if (!allowed)
          return { unauthorized: true }
        const tool = client.tools.value.find(tool => tool.name === 'browser_search')
        return await client.execute(tool, { query: 'fixture search' })
      }
      catch (error) { return { blocked: client.availability.value === 'unavailable', reason: error.message } }
    }, { menu, allowed })
    if (allowed) {
      assert.equal(result.search, 'fixture search', JSON.stringify(result))
      assert.equal(await frame.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').inputValue(), 'fixture search')
    }
    else {
      assert.equal(result.blocked, true)
      assert.equal(await frame.getByPlaceholder('搜尋品項，例如：拿鐵、雞腿、套餐').inputValue(), '')
    }
  }
  console.info('PASS: Firefox PB peer accepts the approved parent without referrer, performs visible search and rejects a different parent origin. All PB content is synthetic.')
}
finally {
  await context?.close()
  await rm(scratch, { recursive: true, force: true, maxRetries: 5 })
}
