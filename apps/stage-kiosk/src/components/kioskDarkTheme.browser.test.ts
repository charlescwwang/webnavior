import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { createPinia, disposePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import kioskHtml from '../../index.html?raw'
import KioskMicrophoneSettings from './KioskMicrophoneSettings.vue'

import '../styles/main.css'
import 'uno.css'

// Report: this chat, 2026-11-20 — shared light-theme controls are unreadable on the fixed dark Kiosk.
it('uses light control text on dark Kiosk panels and teleported options even with a light OS theme', async () => {
  const html = document.documentElement
  const previousClass = html.className
  // Use the real application's theme declaration, including body-level portals.
  html.className = new DOMParser().parseFromString(kioskHtml, 'text/html').documentElement.className
  const pinia = createPinia()
  const screen = render(KioskMicrophoneSettings, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false })] } })
  try {
    const input = screen.getByRole('textbox', { name: 'stage.kiosk.array-audio.channelMap', exact: true })
    const select = screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.mode', exact: true })
    const controls = [input.element(), select.element()]
    await select.click()
    const option = screen.getByRole('option', { name: 'stage.kiosk.array-audio.auto', exact: true })
    for (const control of [...controls, option.element()]) {
      const rgb = getComputedStyle(control).color.match(/[\d.]+/g)!.slice(0, 3).map(Number)
      // Near-white text, independent of the primary accent or OS preference.
      expect(rgb.every(channel => channel >= 180), getComputedStyle(control).color).toBe(true)
    }
    await option.click()
  }
  finally {
    screen.unmount()
    const context = useAudioContext(pinia).audioContext
    disposePinia(pinia)
    await context.close()
    html.className = previousClass
    vi.unstubAllGlobals()
  }
})

// Report: this chat, 2026-11-20 — prevent white-on-white dropdowns when a global theme changes.
it.each([false, true])('keeps Kiosk dropdown foreground and background paired when inherited dark class is %s', async (dark) => {
  const html = document.documentElement
  const previousClass = html.className
  const previousTheme = html.getAttribute('data-kiosk-theme')
  const appTheme = new DOMParser().parseFromString(kioskHtml, 'text/html').documentElement.getAttribute('data-kiosk-theme')
  if (appTheme === null)
    html.removeAttribute('data-kiosk-theme')
  else
    html.setAttribute('data-kiosk-theme', appTheme)
  html.classList.toggle('dark', dark)
  const pinia = createPinia()
  const screen = render(KioskMicrophoneSettings, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false })] } })
  try {
    const select = screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.mode', exact: true })
    const trigger = select.element()
    await select.click()
    const list = screen.getByRole('listbox').element()
    const option = screen.getByRole('option', { name: 'stage.kiosk.array-audio.auto', exact: true })
    for (const control of [trigger, list]) {
      await expect.poll(() => {
        const background = getComputedStyle(control).backgroundColor.match(/[\d.]+/g)!.map(Number)
        return background.slice(0, 3).every(channel => channel < 80) && (background.length < 4 || background[3] === 1)
      }).toBe(true)
    }
    for (const control of [trigger, option.element()]) {
      await expect.poll(() => {
        const foreground = getComputedStyle(control).color.match(/[\d.]+/g)!.slice(0, 3).map(Number)
        return foreground.every(channel => channel >= 180)
      }).toBe(true)
    }
    await option.click()
    await select.click()
    const selected = screen.getByRole('option', { name: 'stage.kiosk.array-audio.auto', exact: true })
    await expect.element(selected).toHaveAttribute('data-state', 'checked')
    await expect.poll(() => {
      const style = getComputedStyle(selected.element())
      const background = style.backgroundColor.match(/[\d.]+/g)!.map(Number)
      const foreground = style.color.match(/[\d.]+/g)!.slice(0, 3).map(Number)
      return background.slice(0, 3).every(channel => channel < 100)
        && (background.length < 4 || background[3] === 1)
        && foreground.every(channel => channel >= 180)
    }).toBe(true)
    await selected.click()
  }
  finally {
    screen.unmount()
    const context = useAudioContext(pinia).audioContext
    disposePinia(pinia)
    await context.close()
    html.className = previousClass
    if (previousTheme === null)
      html.removeAttribute('data-kiosk-theme')
    else
      html.setAttribute('data-kiosk-theme', previousTheme)
    vi.unstubAllGlobals()
  }
})
