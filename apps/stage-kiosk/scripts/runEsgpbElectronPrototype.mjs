import assert from 'node:assert/strict'
import process from 'node:process'

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron as electron } from 'playwright'

// PROTOTYPE: pin the security release inspected for this experiment.
assert.equal(process.versions.node, '24.22.1', 'Use Node 24.22.1 for this prototype.')
const requireDesktop = createRequire(new URL('../../stage-tamagotchi/package.json', import.meta.url))
const executablePath = process.env.ESGPB_ELECTRON_PATH ?? requireDesktop('electron')
const embeddedNode = execFileSync(executablePath, ['-p', 'process.versions.node'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
}).trim()
assert.equal(embeddedNode, '24.22.1', 'Configured Electron must embed the inspected Node security release; set ESGPB_ELECTRON_PATH.')
const verify = process.argv.includes('--verify')
const cart = process.argv.includes('--cart')
assert(!cart || verify, '--cart requires --verify')
if (verify)
  assert(process.env.ESGPB_EMAIL && process.env.ESGPB_PASSWORD, 'Supply ESGPB_EMAIL and ESGPB_PASSWORD for --verify')

const profile = await mkdtemp(join(tmpdir(), 'airi-esgpb-electron-prototype-'))
const runtimeEnv = { ...process.env, ESGPB_PROTOTYPE_PROFILE: profile }
// Credentials belong only to the driver, not the application's environment.
delete runtimeEnv.ESGPB_EMAIL
delete runtimeEnv.ESGPB_PASSWORD
let app
try {
  app = await electron.launch({
    executablePath,
    args: [fileURLToPath(new URL('./esgpbElectronPrototype.cjs', import.meta.url))],
    env: runtimeEnv,
    timeout: 30_000,
  })
  await app.firstWindow()
  if (!verify) {
    console.info('PROTOTYPE: sign in manually in the native website pane. Close the window to finish.')
    await new Promise(resolve => app.once('close', resolve))
  }
  else {
    // The native child is a separate page target, not a DOM iframe in the shell.
    let site = app.context().pages().find(page => page.url().startsWith('https://app.esgpb.com/'))
    if (!site) {
      site = await app.context().waitForEvent('page', {
        predicate: async (page) => {
          await page.waitForURL('https://app.esgpb.com/**')
          return true
        },
        timeout: 30_000,
      })
    }
    site.setDefaultTimeout(15_000)
    // SSR initially renders English labels; Vue hydration replaces those controls.
    // Wait for the translated form or mounting erases early input.
    await site.getByRole('textbox', { name: '密碼', exact: true }).waitFor()
    await site.getByRole('button', { name: '登入', exact: true }).waitFor()
    await site.getByRole('textbox', { name: 'Email 或 手機' }).fill(process.env.ESGPB_EMAIL)
    await site.locator('input[type=password]').fill(process.env.ESGPB_PASSWORD)
    await site.getByRole('button', { name: '登入', exact: true }).click()
    await site.waitForURL('**/store/PRBMqkW/pick_up/menu')
    await site.getByText('測試帳號', { exact: true }).waitFor()
    console.info('PASS: native Electron login; member label verified.')
    await site.reload()
    await site.getByText('測試帳號', { exact: true }).waitFor()
    console.info('PASS: member session survives reload.')
    const cookies = await app.evaluate(async ({ session }) => {
      return (await session.fromPartition('persist:esgpb-prototype').cookies.get({ url: 'https://app.esgpb.com/order/' }))
        .filter(cookie => ['order_session', 'XSRF-TOKEN'].includes(cookie.name))
        .map(({ name, sameSite, secure, httpOnly }) => ({ name, sameSite, secure, httpOnly }))
    })
    assert.equal(cookies.length, 2)
    for (const cookie of cookies) {
      assert.equal(cookie.sameSite, 'lax')
      assert.equal(cookie.secure, true)
    }
    assert.equal(cookies.find(cookie => cookie.name === 'order_session').httpOnly, true)
    console.info('PASS: original Lax/Secure cookies retained; Session remains HttpOnly.')
    await site.getByRole('button', { name: /^烏龍茶 / }).first().waitFor()
    if (await site.getByRole('button', { name: '稍後再領', exact: true }).isVisible())
      await site.getByRole('button', { name: '稍後再領', exact: true }).click()
    if (await site.getByRole('button', { name: '我知道了，開始點餐', exact: true }).isVisible())
      await site.getByRole('button', { name: '我知道了，開始點餐', exact: true }).click()
    await site.screenshot({ path: '/tmp/airi-esgpb-electron-menu.png' })
    console.info('PASS: menu loaded; product controls discovered.')
    const summary = site.getByText('去結算', { exact: true }).locator('xpath=ancestor::*[contains(., "$")][1]')
    const initialTotal = Number((await summary.textContent()).match(/\$\s*(\d+)/)[1])
    await site.getByRole('button', { name: /^烏龍茶 / }).first().click()
    const product = site.getByRole('dialog').filter({ hasText: '烏龍茶' })
    await product.getByRole('radio', { name: 'M $40', exact: true }).waitFor()
    console.info('PASS: size, sweetness and ice controls discovered.')
    if (cart) {
      const marker = `Electron原型驗證-${randomUUID()}`
      // Element Plus paints over native radio inputs; click their visible labels.
      await product.getByText('微糖', { exact: true }).click()
      await product.getByText('微冰', { exact: true }).click()
      assert(await product.getByRole('radio', { name: '微糖', exact: true }).isChecked())
      assert(await product.getByRole('radio', { name: '微冰', exact: true }).isChecked())
      await product.getByRole('textbox', { name: '商品有特殊需求，請在此備註' }).fill(marker)
      // Never retry: a lost reply may still have committed the item.
      await product.getByRole('button', { name: '選好了 共計$40', exact: true }).click()
      await product.waitFor({ state: 'hidden' })
      await site.getByText('去結算', { exact: true }).click()
      const note = site.getByText(marker, { exact: true })
      await note.waitFor()
      const row = note.locator('xpath=ancestor::*[.//button][1]')
      assert.equal(await row.getByRole('heading', { name: '烏龍茶 ($40)', exact: true }).count(), 1)
      assert.match(await row.textContent(), /M.*微冰.*微糖/s)
      await site.getByText(`總金額$${initialTotal + 40}`, { exact: true }).waitFor()
      await site.screenshot({ path: '/tmp/airi-esgpb-electron-cart.png' })
      console.info(`PASS: one M oolong / light sugar / light ice; cart ${initialTotal} -> ${initialTotal + 40}.`)
      // Only this UUID-tagged line belongs to the experiment; never clear the cart.
      await row.getByRole('button', { name: '', exact: true }).click()
      await note.waitFor({ state: 'hidden' })
      await site.getByText(`總金額$${initialTotal}`, { exact: true }).waitFor()
      console.info(`PASS: tagged test item removed; original cart total ${initialTotal} restored. No order submitted.`)
    }
    if (process.argv.includes('--keep-open')) {
      await site.goto('https://app.esgpb.com/order/store/PRBMqkW/pick_up/menu')
      await site.getByText('測試帳號', { exact: true }).waitFor()
      console.info('READY: authenticated prototype left open for manual review; close the window to clean the profile.')
      await new Promise(resolve => app.once('close', resolve))
    }
  }
}
finally {
  await app?.close()
  await rm(profile, { recursive: true, force: true })
}
