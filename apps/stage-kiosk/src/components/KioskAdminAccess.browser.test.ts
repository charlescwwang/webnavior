import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import zhHant from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import KioskAdminAccess from './KioskAdminAccess.vue'

import { isKioskAdminSessionActive } from '../services/admin-session'

beforeEach(() => {
  // Only HTTP is substituted; the client must obey the Server result.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => JSON.parse(String(init?.body)).pin === '4812' ? Response.json({ expiresAt: Date.now() + 900000 }) : new Response('', { status: 401 }))
  isKioskAdminSessionActive.value = false
})
afterEach(() => {
  vi.restoreAllMocks()
  isKioskAdminSessionActive.value = false
})

async function setupAccess(singleTap = false) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push('/?language=zh-Hant')
  await router.isReady()
  const view = render(KioskAdminAccess, { props: { singleTap }, slots: { default: () => 'AIRI 餐飲服務員' }, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  const trigger = view.getByRole('button', { name: singleTap ? '服務人員 PIN 解鎖' : '連點五下以開啟管理員模式' })
  return { view, router, trigger }
}

it('opens the PIN dialog on the fifth tap and never grants access from taps alone', async () => {
  const { view, trigger } = await setupAccess()
  for (let i = 0; i < 4; i++)
    await trigger.click()
  await expect.element(view.getByRole('dialog')).not.toBeInTheDocument()
  await trigger.click()
  await expect.element(view.getByRole('dialog', { name: '輸入 PIN' })).toBeVisible()
  expect(isKioskAdminSessionActive.value).toBe(false)
  const input = view.getByRole('dialog').element().querySelector('input')!
  expect(input.type).toBe('password')
  expect(input.inputMode).toBe('none')
})

it('unlocks through the virtual digits only and preserves the existing route query', async () => {
  const { view, router, trigger } = await setupAccess()
  for (let i = 0; i < 5; i++)
    await trigger.click()
  for (const digit of ['4', '8', '1', '2'])
    await view.getByRole('button', { name: digit, exact: true }).click()
  expect(isKioskAdminSessionActive.value).toBe(false)
  await view.getByRole('button', { name: '繼續', exact: true }).click()
  await expect.poll(() => router.currentRoute.value.query.admin).toBe('true')
  expect(router.currentRoute.value.query.language).toBe('zh-Hant')
  expect(isKioskAdminSessionActive.value).toBe(true)
  await expect.element(view.getByRole('dialog')).not.toBeInTheDocument()
})

it('supports clear/backspace and rejects the wrong PIN without opening admin', async () => {
  const { view, router, trigger } = await setupAccess()
  for (let i = 0; i < 5; i++)
    await trigger.click()
  await view.getByRole('button', { name: '4', exact: true }).click()
  await view.getByRole('button', { name: '9', exact: true }).click()
  await view.getByRole('button', { name: '刪除一碼', exact: true }).click()
  const input = view.getByRole('dialog').element().querySelector('input')!
  expect(input.value).toBe('4')
  await view.getByRole('button', { name: '繼續', exact: true }).click()
  await expect.element(view.getByRole('alert')).toHaveTextContent('PIN 不正確，請再試一次。')
  expect(isKioskAdminSessionActive.value).toBe(false)
  expect(router.currentRoute.value.query.admin).toBeUndefined()
  await view.getByRole('button', { name: '清除', exact: true }).click()
  expect(input.value).toBe('')
  await expect.element(view.getByRole('alert')).not.toBeInTheDocument()
})

it('resets an expired sequence rather than counting unrelated taps later', async () => {
  const { view, trigger } = await setupAccess()
  for (let i = 0; i < 4; i++)
    await trigger.click()
  await new Promise(resolve => setTimeout(resolve, 2100))
  await trigger.click()
  await expect.element(view.getByRole('dialog')).not.toBeInTheDocument()
  for (let i = 0; i < 4; i++)
    await trigger.click()
  await expect.element(view.getByRole('dialog')).toBeVisible()
})

it('clears the entered PIN on cancellation before reopening via five new taps', async () => {
  const { view, trigger } = await setupAccess()
  for (let i = 0; i < 5; i++)
    await trigger.click()
  await view.getByRole('button', { name: '4', exact: true }).click()
  await view.getByRole('button', { name: '取消', exact: true }).click()
  for (let i = 0; i < 5; i++)
    await trigger.click()
  expect(view.getByRole('dialog').element().querySelector('input')!.value).toBe('')
  expect(isKioskAdminSessionActive.value).toBe(false)
})

it('requires the correct PIN before emitting a fault recovery authorization', async () => {
  const { view, trigger } = await setupAccess(true)
  await trigger.click()
  await view.getByRole('button', { name: '繼續', exact: true }).click()
  expect(view.emitted('unlocked')).toBeUndefined()
  for (const digit of ['4', '8', '1', '2'])
    await view.getByRole('button', { name: digit, exact: true }).click()
  await view.getByRole('button', { name: '繼續', exact: true }).click()
  await expect.poll(() => view.emitted('unlocked')?.length).toBe(1)
})

it('keeps the PIN gate locked when the Server cannot verify it', async () => {
  vi.mocked(globalThis.fetch).mockResolvedValue(new Response('', { status: 503 }))
  const { view, router, trigger } = await setupAccess(true)
  await trigger.click()
  for (const digit of ['4', '8', '1', '2'])
    await view.getByRole('button', { name: digit, exact: true }).click()
  await view.getByRole('button', { name: '繼續', exact: true }).click()
  await expect.element(view.getByRole('alert')).toHaveTextContent('無法驗證 PIN')
  expect(isKioskAdminSessionActive.value).toBe(false)
  expect(router.currentRoute.value.query.admin).toBeUndefined()
})
