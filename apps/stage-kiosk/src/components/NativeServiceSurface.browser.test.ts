import type { DesktopSurfaceNavigation, DesktopSurfaceRequest, KioskDesktopBridge } from '@proj-airi/stage-shared/kiosk-desktop'

import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import zhHant from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import KioskAdminAccess from './KioskAdminAccess.vue'
import NativeServiceSurface from './NativeServiceSurface.vue'

// Use the product's actual utility/icon CSS in the loading preview.
import 'virtual:uno.css'

// Report: this chat, Nov12; PB table Start replaces the native document.
it('revokes the old tools on native navigation and announces only the current completed load', async () => {
  let navigation!: (value: DesktopSurfaceNavigation) => void
  const unsubscribe = vi.fn()
  const bridge: KioskDesktopBridge = {
    version: 1,
    invokeService: vi.fn(async () => {}),
    onActivity: () => () => {},
    onNavigation: (listener) => {
      navigation = listener
      return unsubscribe
    },
    updateSurface: async input => ({ sequence: 1, state: input.visible ? 'visible' : 'hidden' }),
  }
  const ready = vi.fn()
  const unavailable = vi.fn()
  const navigating = vi.fn()
  const i18n = createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })
  const screen = render(NativeServiceSurface, { props: { bridge, serviceId: 'pb-test', documentKey: 'pb-test:1', url: 'https://app-205-rd.esgpb.com/order/store/1kAMNok/internal_use/menu/select-table', title: 'PB', occluded: false, onReady: ready, onNavigating: navigating, onUnavailable: unavailable }, global: { plugins: [i18n] } })
  try {
    await expect.poll(() => ready.mock.calls.length).toBe(1)
    navigation({ serviceId: 'pb-test', documentKey: 'pb-test:1', revision: 2, state: 'loading' })
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
    expect(navigating).toHaveBeenCalledOnce()
    expect(unavailable).not.toHaveBeenCalled()
    navigation({ serviceId: 'pb-test', documentKey: 'pb-test:1', revision: 1, state: 'ready' })
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
    expect(ready).toHaveBeenCalledOnce()
    navigation({ serviceId: 'pb-test', documentKey: 'pb-test:1', revision: 2, state: 'ready' })
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
    expect(ready).toHaveBeenCalledTimes(2)
    navigation({ serviceId: 'other-service', documentKey: 'pb-test:1', revision: 3, state: 'loading' })
    navigation({ serviceId: 'pb-test', documentKey: 'pb-test:1', revision: 2, state: 'ready' })
    expect(ready).toHaveBeenCalledTimes(2)
    expect(unavailable).not.toHaveBeenCalled()
    navigation({ serviceId: 'pb-test', documentKey: 'pb-test:1', revision: 3, state: 'failed' })
    expect(unavailable).toHaveBeenCalledOnce()
  }
  finally { screen.unmount() }
  expect(unsubscribe).toHaveBeenCalledOnce()
})

// Report: PB ordering page stays blank while loading (user report, 2026-11-11).
it('keeps readiness internal without a loading overlay and ignores stale completions', async () => {
  const first = Promise.withResolvers<void>()
  const second = Promise.withResolvers<void>()
  const third = Promise.withResolvers<void>()
  const url = shallowRef('https://first.example/menu')
  const gates = new Map([
    [url.value, first],
    ['https://second.example/menu', second],
    ['https://third.example/menu', third],
  ])
  let sequence = 0
  const bridge: KioskDesktopBridge = {
    version: 1,
    invokeService: vi.fn(async () => {}),
    onActivity: () => () => {},
    onNavigation: () => () => {},
    updateSurface: async (input) => {
      await gates.get(input.url)?.promise
      return { sequence: ++sequence, state: input.visible ? 'visible' : 'hidden' }
    },
  }
  const i18n = createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })
  const ready = vi.fn()
  const unavailable = vi.fn()
  const screen = render(defineComponent({ setup: () => () => h('div', { style: { width: '600px', height: '400px' } }, [
    h(NativeServiceSurface, { bridge, serviceId: 'ordering', documentKey: url.value, url: url.value, title: 'PB', occluded: false, onReady: ready, onUnavailable: unavailable }),
  ]) }), { global: { plugins: [i18n] } })
  try {
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
    expect(screen.container.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('true')
    expect(ready).not.toHaveBeenCalled()
    url.value = 'https://second.example/menu'
    await nextTick()
    await expect.poll(() => screen.container.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('true')
    first.resolve()
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
    expect(ready).not.toHaveBeenCalled()
    second.resolve()
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
    await expect.poll(() => ready.mock.calls.length).toBe(1)
    expect(screen.container.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false')
    url.value = 'https://third.example/menu'
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
    third.reject(new Error('Fixture network failure'))
    await expect.element(screen.getByRole('alert')).toBeVisible()
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
    expect(unavailable).toHaveBeenCalled()
  }
  finally {
    first.resolve()
    second.resolve()
    third.resolve()
    screen.unmount()
  }
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md — native Views bypass DOM z-index.
it('hides the native website for a host overlay, restores its placement and hides on unmount', async () => {
  const placements: Omit<DesktopSurfaceRequest, 'sequence'>[] = []
  const bridge: KioskDesktopBridge = {
    version: 1,
    invokeService: vi.fn(async () => {
      throw new Error('Service is not configured in this placement fixture.')
    }),
    onActivity: () => () => {},
    onNavigation: () => () => {},
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
  }), onActivity: () => () => {}, onNavigation: () => () => {}, updateSurface: async (input) => {
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
  const bridge: KioskDesktopBridge = { version: 1, invokeService: vi.fn(async () => {}), onActivity: () => () => {}, onNavigation: () => () => {}, updateSurface: async (input) => {
    placements.push(input.visible)
    return { sequence: placements.length, state: input.visible ? 'visible' : 'hidden' }
  } }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: defineComponent({ render: () => null }) }] })
  await router.push('/')
  await router.isReady()
  const i18n = createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })
  const screen = render(defineComponent({ setup: () => () => h('div', [
    h(NativeServiceSurface, { bridge, serviceId: 'ordering', documentKey: 'ordering:1', url: 'https://first.example/menu', title: 'Ordering', occluded: false }),
    // NOTICE: KioskScene places its visible settings trigger above diagnostics.
    // Reproduce that stacking here so real clicks exercise the five-tap entry.
    h(KioskAdminAccess, { style: { position: 'relative', zIndex: '100' } }, () => '設定'),
    // Match the existing voice-diagnostics layer; the PIN form must own hit testing above it.
    h('div', { style: { position: 'fixed', inset: '0', zIndex: '75' } }),
  ]) }), { global: { plugins: [i18n, router] } })
  try {
    await expect.poll(() => placements.at(-1)).toBe(true)
    const trigger = screen.getByRole('button', { name: '連點五下以開啟管理員模式' })
    for (let i = 0; i < 5; i++)
      await trigger.click()
    await expect.element(screen.getByRole('dialog', { name: '輸入 PIN' })).toBeVisible()
    await expect.poll(() => placements.at(-1)).toBe(false)
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!
    const bounds = input.getBoundingClientRect()
    expect(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)).toBe(input)
    await screen.getByRole('button', { name: '取消', exact: true }).click()
    await expect.poll(() => placements.at(-1)).toBe(true)
  }
  finally { screen.unmount() }
})

// Report: this chat, 2026-11-14 — a placement update falsely finished table→menu loading.
it('keeps navigation readiness through placement updates without covering the vendor page', async () => {
  await page.viewport(1080, 1000)
  let navigation!: (value: DesktopSurfaceNavigation) => void
  const occluded = shallowRef(false)
  let loading = false
  const bridge: KioskDesktopBridge = {
    version: 1,
    invokeService: vi.fn(async () => {}),
    onActivity: () => () => {},
    onNavigation: (listener) => {
      navigation = listener
      return () => {}
    },
    updateSurface: vi.fn<KioskDesktopBridge['updateSurface']>(async input => ({ sequence: 1, state: loading ? 'loading' : input.visible ? 'visible' : 'hidden' })),
  }
  const ready = vi.fn()
  const i18n = createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })
  const screen = render(defineComponent({ setup: () => () => h('div', { style: { width: '760px', height: '800px' } }, [
    h(NativeServiceSurface, { bridge, serviceId: 'ordering', documentKey: 'ordering:1', url: 'https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table', title: 'PB', occluded: occluded.value, onReady: ready }),
  ]) }), { global: { plugins: [i18n] } })
  try {
    await expect.poll(() => ready.mock.calls.length).toBe(1)
    loading = true
    navigation({ serviceId: 'ordering', documentKey: 'ordering:1', revision: 2, state: 'loading' })
    occluded.value = true
    await expect.poll(() => vi.mocked(bridge.updateSurface).mock.calls.length).toBeGreaterThan(1)
    await expect.element(screen.getByText('載入中…', { exact: true })).not.toBeInTheDocument()
    expect(ready).toHaveBeenCalledOnce()
    loading = false
    navigation({ serviceId: 'ordering', documentKey: 'ordering:1', revision: 2, state: 'ready' })
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
    expect(ready).toHaveBeenCalledTimes(2)
  }
  finally { screen.unmount() }
})
