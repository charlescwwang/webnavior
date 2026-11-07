import type { DesktopSurfaceRequest, KioskDesktopBridge } from '@proj-airi/stage-shared/kiosk-desktop'

import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import KioskAdminAccess from './KioskAdminAccess.vue'
import NativeServiceSurface from './NativeServiceSurface.vue'

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md — native Views bypass DOM z-index.
it('hides the native website for a host overlay, restores its placement and hides on unmount', async () => {
  const placements: Omit<DesktopSurfaceRequest, 'sequence'>[] = []
  const bridge: KioskDesktopBridge = {
    version: 1,
    invokeService: vi.fn(async () => {
      throw new Error('Service is not configured in this placement fixture.')
    }),
    onActivity: () => () => {},
    updateSurface: vi.fn<KioskDesktopBridge['updateSurface']>(async (input) => {
      placements.push(input)
      return { sequence: placements.length, state: input.visible ? 'visible' : 'hidden' }
    }),
  }
  const ready = vi.fn()
  const occluded = shallowRef(false)
  const url = shallowRef('https://first.example/menu')
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })
  const screen = render(defineComponent({
    setup: () => () => h('div', { style: { width: '600px', height: '400px' } }, h(NativeServiceSurface, {
      bridge,
      onReady: ready,
      serviceId: 'ordering',
      documentKey: 'ordering:1',
      url: url.value,
      title: 'Ordering',
      occluded: occluded.value,
    })),
  }), { global: { plugins: [i18n] } })
  await expect.poll(() => placements.at(-1)?.bounds.width).toBe(600)
  await expect.poll(() => placements.at(-1)?.visible).toBe(true)
  await expect.poll(() => ready.mock.calls.length).toBe(1)
  occluded.value = true
  await expect.poll(() => placements.at(-1)?.visible).toBe(false)
  expect(ready).toHaveBeenCalledTimes(1)
  url.value = 'https://second.example/menu'
  await expect.poll(() => placements.at(-1)?.url).toBe(url.value)
  await expect.poll(() => ready.mock.calls.length).toBe(2)
  occluded.value = false
  await expect.poll(() => placements.at(-1)?.visible).toBe(true)
  screen.unmount()
  await expect.poll(() => placements.at(-1)?.visible).toBe(false)
})

it('keeps a native service hidden while a visible host dialog owns focus', async () => {
  const placements: boolean[] = []
  const bridge: KioskDesktopBridge = { version: 1, invokeService: vi.fn(async () => {
    throw new Error('Service is not configured in this placement fixture.')
  }), onActivity: () => () => {}, updateSurface: async (input) => {
    placements.push(input.visible)
    return { sequence: placements.length, state: input.visible ? 'visible' : 'hidden' }
  } }
  const modal = shallowRef(false)
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })
  const screen = render(defineComponent({ setup: () => () => h('div', [
    h(NativeServiceSurface, { bridge, serviceId: 'ordering', documentKey: 'ordering:1', url: 'https://first.example/menu', title: 'Ordering', occluded: false }),
    modal.value ? h('div', { role: 'dialog' }, 'Staff settings') : null,
  ]) }), { global: { plugins: [i18n] } })
  await expect.poll(() => placements.at(-1)).toBe(true)
  modal.value = true
  await expect.poll(() => placements.at(-1)).toBe(false)
  modal.value = false
  await expect.poll(() => placements.at(-1)).toBe(true)
  screen.unmount()
})

it('hides the native service while the actual administrator PIN prompt is open', async () => {
  const placements: boolean[] = []
  const bridge: KioskDesktopBridge = { version: 1, invokeService: vi.fn(async () => {}), onActivity: () => () => {}, updateSurface: async (input) => {
    placements.push(input.visible)
    return { sequence: placements.length, state: input.visible ? 'visible' : 'hidden' }
  } }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: defineComponent({ render: () => null }) }] })
  await router.push('/')
  await router.isReady()
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })
  const screen = render(defineComponent({ setup: () => () => h('div', [
    h(NativeServiceSurface, { bridge, serviceId: 'ordering', documentKey: 'ordering:1', url: 'https://first.example/menu', title: 'Ordering', occluded: false }),
    h(KioskAdminAccess),
    // Match the existing voice-diagnostics layer; the PIN form must own hit testing above it.
    h('div', { style: { position: 'fixed', inset: '0', zIndex: '75' } }),
  ]) }), { global: { plugins: [i18n, router] } })
  try {
    await expect.poll(() => placements.at(-1)).toBe(true)
    screen.container.querySelector('button[aria-label="長按以開啟管理員模式"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await expect.poll(() => document.body.textContent?.includes('請輸入管理員 PIN 以調整 Kiosk 設定。'), { timeout: 2500 }).toBe(true)
    await expect.poll(() => placements.at(-1)).toBe(false)
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!
    const bounds = input.getBoundingClientRect()
    expect(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)).toBe(input)
    const cancel = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '取消')!
    cancel.click()
    await expect.poll(() => placements.at(-1)).toBe(true)
  }
  finally { screen.unmount() }
})
