import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import zhHant from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import KioskTextConsole from './kioskTextConsole.vue'

import '@unocss/reset/tailwind.css'

// User request (2026-11-11): native PB text entry should float like master.
it('moves one live console into its popup, retaining input, updates and submission ownership', async () => {
  await page.viewport(1000, 800)
  const onSimulate = vi.fn()
  const onFloatingChange = vi.fn()
  const trace = shallowRef('first trace')
  const reply = shallowRef('您好，')
  const screen = render(defineComponent({ setup: () => () => h('main', [
    h(KioskTextConsole, { dockTarget: '#popup-fallback', nativePopup: true, trace: trace.value, reply: reply.value, onSimulate, onFloatingChange }),
    h('div', { id: 'popup-fallback' }),
  ]) }), { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  let popup: Window | null = null
  try {
    await expect.poll(() => onFloatingChange.mock.calls.at(-1)?.[0]).toBe(true)
    popup = window.open('', 'airi-kiosk-text-console')
    expect(popup).not.toBeNull()
    const panel = popup!.document.querySelector<HTMLElement>('section[aria-label="文字輸入與 Trace"]')!
    const input = popup!.document.querySelector<HTMLTextAreaElement>('textarea')!
    expect(panel.parentElement).toBe(popup!.document.body)
    expect(document.querySelector('textarea')).toBeNull()
    await expect.poll(() => getComputedStyle(panel).position).toBe('relative')
    expect(getComputedStyle(panel.querySelector('.console-handle')!).getPropertyValue('-webkit-app-region')).toBe('drag')
    input.value = '雞腿便當一份'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    popup!.document.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click()
    await nextTick()
    expect(input.value).toBe('雞腿便當一份')
    expect(getComputedStyle(panel.querySelector('.console-content')!).display).toBe('none')
    popup!.document.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click()
    trace.value = 'second trace'
    await nextTick()
    expect(panel.querySelector('pre')!.textContent).toBe('second trace')
    expect(panel.querySelector('.console-reply')!.textContent).toBe('您好，')
    reply.value = '您好，歡迎點餐。'
    await nextTick()
    expect(panel.querySelector('.console-reply')!.textContent).toBe('您好，歡迎點餐。')
    popup!.document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
    expect(onSimulate).toHaveBeenCalledTimes(1)
    expect(onSimulate).toHaveBeenCalledWith('雞腿便當一份')
    await nextTick()
    expect(input.value).toBe('')
    input.value = '保留草稿'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    popup!.close()
    await expect.poll(() => onFloatingChange.mock.calls.at(-1)?.[0]).toBe(false)
    await expect.element(page.getByRole('textbox')).toHaveValue('保留草稿')
    await page.getByRole('button', { name: '浮動視窗', exact: true }).click()
    await expect.poll(() => onFloatingChange.mock.calls.at(-1)?.[0]).toBe(true)
    popup = window.open('', 'airi-kiosk-text-console')
    expect(popup!.document.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('保留草稿')
    screen.unmount()
    await expect.poll(() => popup!.closed).toBe(true)
  }
  finally {
    screen.unmount()
    popup?.close()
  }
})

it('floats outside the conversation, drags by its header and stays inside the viewport', async () => {
  await page.viewport(1000, 800)
  render(KioskTextConsole, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  const panel = document.querySelector<HTMLElement>('section[aria-label="文字輸入與 Trace"]')!
  await expect.poll(() => panel.getBoundingClientRect().width).toBeGreaterThan(0)
  expect(panel.parentElement).toBe(document.body)
  expect(getComputedStyle(panel).position).toBe('fixed')
  const header = panel.querySelector('header div')!
  const before = panel.getBoundingClientRect()
  header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: before.x + 20, clientY: before.y + 20, button: 0 }))
  window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: 60, clientY: 60 }))
  await nextTick()
  expect(panel.getBoundingClientRect().x).toBeCloseTo(40)
  expect(panel.getBoundingClientRect().y).toBeCloseTo(40)
  window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: -1000, clientY: -1000 }))
  await nextTick()
  window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch' }))
  expect(panel.getBoundingClientRect().x).toBeGreaterThanOrEqual(12)
  expect(panel.getBoundingClientRect().y).toBeGreaterThanOrEqual(12)
})

it('retains the input and trace while collapsed and forwards submissions after expanding', async () => {
  const onSimulate = vi.fn()
  const screen = render(KioskTextConsole, { props: { trace: '{"kind":"NEEDS_ASSISTANT"}', onSimulate }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  await screen.getByRole('textbox').fill('水餃改一份')
  const textarea = document.querySelector('textarea')!
  await screen.getByRole('button', { name: '收合', exact: true }).click()
  await expect.element(textarea).not.toBeVisible()
  await screen.getByRole('button', { name: '展開', exact: true }).click()
  await expect.element(screen.getByRole('textbox')).toHaveValue('水餃改一份')
  await screen.getByText('檢視本次 System One 決策 trace').click()
  await expect.element(screen.getByText('{"kind":"NEEDS_ASSISTANT"}')).toBeVisible()
  await screen.getByRole('button', { name: '模擬辨識並執行' }).click()
  expect(onSimulate).toHaveBeenCalledWith('水餃改一份')
  await screen.getByRole('button', { name: '重設位置' }).click()
  const panel = document.querySelector<HTMLElement>('section[aria-label="文字輸入與 Trace"]')!
  await expect.poll(() => panel.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth - 11)
  await page.viewport(390, 600)
  await nextTick()
  await expect.poll(() => panel.getBoundingClientRect().right).toBeLessThanOrEqual(379)
  await expect.poll(() => panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(589)
})

it.each([{ width: 1080, height: 833 }, { width: 1080, height: 1920 }])('keeps native-host text entry in its reserved region at $width×$height', async ({ width, height }) => {
  await page.viewport(width, height)
  const onSimulate = vi.fn()
  const screen = render(defineComponent({ setup: () => () => h('main', { style: { display: 'grid', height: '100dvh', gridTemplateRows: '140px auto minmax(180px, 1fr)', gap: '16px' } }, [
    h('div', [h(KioskTextConsole, { dockTarget: '#test-text-dock', trace: JSON.stringify({ trace: 'detail '.repeat(200) }), onSimulate })]),
    h('div', { id: 'test-text-dock' }),
    h('div', { 'data-native-region': '' }, 'Native PB region'),
  ]) }), { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  try {
    const dock = screen.container.querySelector<HTMLElement>('#test-text-dock')!
    const input = document.querySelector<HTMLTextAreaElement>('textarea')!
    await expect.poll(() => dock.contains(input)).toBe(true)
    const panel = dock.querySelector<HTMLElement>('section[aria-label="文字輸入與 Trace"]')!
    const native = screen.container.querySelector<HTMLElement>('[data-native-region]')!
    expect(getComputedStyle(panel).position).toBe('relative')
    expect(input.getBoundingClientRect().bottom).toBeLessThanOrEqual(native.getBoundingClientRect().top)
    expect(input.getBoundingClientRect().right).toBeLessThanOrEqual(width)
    expect(document.elementFromPoint(input.getBoundingClientRect().x + 20, input.getBoundingClientRect().y + 20)).toBe(input)
    await page.getByRole('textbox').fill('雞腿便當一份')
    await page.getByRole('button', { name: '模擬辨識並執行' }).click()
    expect(onSimulate).toHaveBeenCalledWith('雞腿便當一份')
    const expandedTop = native.getBoundingClientRect().top
    await page.getByRole('button', { name: '收合', exact: true }).click()
    await expect.poll(() => native.getBoundingClientRect().top).toBeLessThan(expandedTop)
  }
  finally { screen.unmount() }
})
