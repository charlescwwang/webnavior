import type { ToolExecution } from '@proj-airi/stage-shared/interactive-service'

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, readonly, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import zhHant from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import CustomerPhoneModal from './customerPhoneModal.vue'

import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { useKioskCustomerEntry } from '../composables/useKioskCustomerEntry'
import { runFastPath } from '../services/kiosk-fast-path'

function setupEntry(regionHeight = 500) {
  let ready = true
  let entryStarted = false
  let phone: string | undefined
  const heroClicks = shallowRef(0)
  const listening = shallowRef(false)
  const runtime = createMenuToolRuntime({
    orderingReady: () => ready,
    onCustomerEntryRequested: () => {
      if (!entryStarted) {
        entryStarted = true
        ready = false
      }
    },
    onCustomerEntrySkipped: () => ready = true,
    onCustomerPhoneProvided: (value) => {
      phone = value
      ready = true
    },
    onSessionReset: () => {
      phone = undefined
      ready = true
      entryStarted = false
    },
    onAction: () => {},
    onCartChange: () => {},
    onMenuSelection: () => {},
  })
  const listeners = new Set<(execution: ToolExecution) => void>()
  const tools = shallowRef(runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })))
  const bridge = {
    tools: readonly(tools),
    availability: shallowRef<'ready'>('ready'),
    onExecution: (listener: (execution: ToolExecution) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    execute: async (tool: { name: string }, input: Record<string, unknown>) => {
      const definition = tools.value.find(candidate => candidate.name === tool.name)!
      const result = await runtime.invoke(definition.name, input)
      const execution: ToolExecution = { connectionId: 'phone-fixture', documentId: 'phone-document', operationId: crypto.randomUUID(), phase: 'resolved', tool: definition, input, result }
      for (const listener of listeners) listener(execution)
      return result
    },
  }
  const screen = render(defineComponent({
    setup() {
      const entry = useKioskCustomerEntry(bridge)
      return () => h('div', [
        h('button', { onClick: () => heroClicks.value++ }, '上半部互動'),
        h('section', { 'data-testid': 'ordering-region', 'style': { position: 'relative', height: `${regionHeight}px`, width: '640px', maxWidth: '100%' } }, [
          h('p', { 'data-testid': 'background-menu' }, '背景菜單'),
          entry.pending.value ? h(CustomerPhoneModal, { listening: listening.value, busy: entry.busy.value, error: entry.error.value, onSubmit: entry.submit, onSkip: () => entry.submit() }) : h('p', '菜單已開啟'),
        ]),
      ])
    },
  }), { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  return { bridge, tools, listeners, runtime, screen, heroClicks, listening, phone: () => phone }
}

describe('kiosk-owned optional phone modal', () => {
  it('prioritizes spoken skip and only invites speech when the microphone is listening', async () => {
    const { screen, listening } = setupEntry()
    try {
      await expect.element(screen.getByRole('heading', { level: 1, name: '請說「略過」，開始語音點餐' })).toBeVisible()
      await expect.element(screen.getByRole('status')).toHaveTextContent('目前未收音，可用下方按鈕略過。')
      await expect.element(screen.getByRole('button', { name: '用按鈕略過' })).toBeEnabled()
      listening.value = true
      await expect.element(screen.getByRole('status')).toHaveTextContent('可以說話了')
      listening.value = false
      await expect.element(screen.getByRole('status')).toHaveTextContent('目前未收音，可用下方按鈕略過。')
    }
    finally {
      screen.unmount()
    }
  })

  // Report: this chat, 2026-10-21 — menu operations require an explicit phone choice.
  it('blocks Agent browsing while the phone choice is pending, then allows explicit skip', async () => {
    const { screen, runtime } = setupEntry()
    try {
      await expect.element(screen.getByRole('dialog')).toBeVisible()
      await expect.element(screen.getByText('測試時可輸入：0912345678', { exact: true })).toBeVisible()
      await expect(runtime.invokeForAgent('menu_recommend', { action: 'update' })).rejects.toThrow('略過')
      await expect.element(screen.getByRole('dialog')).toBeVisible()
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'customer_entry' })
      await screen.getByRole('button', { name: '用按鈕略過' }).click()
      await expect.element(screen.getByText('菜單已開啟', { exact: true })).toBeVisible()
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'ordering' })
      const result = await runtime.invokeForAgent('menu_recommend', { action: 'update' }) as { items: unknown[] }
      expect(result.items.length).toBeGreaterThan(0)
    }
    finally {
      screen.unmount()
    }
  })

  it.each([500, 240])('limits the overlay to a %i px ordering region and leaves upper controls interactive', async (height) => {
    const { screen, heroClicks } = setupEntry(height)
    try {
      await expect.element(screen.getByRole('dialog')).toBeVisible()
      expect(document.querySelector('dialog:modal')).toBeNull()
      await expect.element(screen.getByTestId('background-menu')).toBeVisible()
      const region = screen.container.querySelector('[data-testid="ordering-region"]')!.getBoundingClientRect()
      const overlay = screen.container.querySelector('.customer-phone-overlay')!.getBoundingClientRect()
      expect(overlay.top).toBeGreaterThanOrEqual(region.top)
      expect(overlay.bottom).toBeLessThanOrEqual(region.bottom)
      expect(overlay.left).toBeGreaterThanOrEqual(region.left)
      expect(overlay.right).toBeLessThanOrEqual(region.right)
      const dialog = screen.container.querySelector('dialog')!.getBoundingClientRect()
      expect(dialog.top).toBeGreaterThanOrEqual(region.top)
      expect(dialog.bottom).toBeLessThanOrEqual(region.bottom)
      await screen.getByRole('button', { name: '上半部互動' }).click()
      expect(heroClicks.value).toBe(1)
      await expect.element(screen.getByRole('dialog')).toBeVisible()
    }
    finally {
      screen.unmount()
    }
  })
  it('keeps the form open after a rejected write and permits an explicit skip', async () => {
    const { screen, bridge, phone } = setupEntry()
    await expect.element(screen.getByRole('dialog')).toBeVisible()
    const execute = bridge.execute
    bridge.execute = async (tool, input) => tool.name === 'kiosk_customer_phone' ? { ok: false } : execute(tool, input)
    await screen.getByRole('textbox', { name: '手機號碼' }).fill('0912345678')
    await screen.getByRole('button', { name: '確認手機，開始點餐' }).click()
    await expect.element(screen.getByRole('alert')).toBeVisible()
    expect(phone()).toBeUndefined()
    await screen.getByRole('button', { name: '用按鈕略過' }).click()
    await expect.element(screen.getByText('菜單已開啟')).toBeVisible()
    screen.unmount()
  })

  it('does not carry a phone draft into a new customer session', async () => {
    const { screen, tools, runtime } = setupEntry()
    await expect.element(screen.getByRole('dialog')).toBeVisible()
    await screen.getByRole('textbox', { name: '手機號碼' }).fill('0900000000')
    const available = tools.value
    tools.value = []
    await expect.element(screen.getByText('菜單已開啟')).toBeVisible()
    await runtime.reset()
    tools.value = available
    await expect.element(screen.getByRole('dialog')).toBeVisible()
    await expect.element(screen.getByRole('textbox', { name: '手機號碼' })).toHaveValue('')
    screen.unmount()
  })

  it('renders in the host document and skips through the actual menu capability', async () => {
    const { screen, runtime, phone } = setupEntry()
    await expect.element(screen.getByRole('dialog')).toBeVisible()
    expect(document.querySelector('dialog')?.ownerDocument).toBe(document)
    await screen.getByRole('button', { name: '用按鈕略過' }).click()
    await expect.element(screen.getByText('菜單已開啟')).toBeVisible()
    expect(phone()).toBeUndefined()
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'ordering' })
    screen.unmount()
  })

  it('validates manual input and does not return the submitted phone to model context', async () => {
    const { screen, runtime, phone } = setupEntry()
    await expect.element(screen.getByRole('dialog')).toBeVisible()
    const confirm = screen.getByRole('button', { name: '確認手機，開始點餐' })
    await expect.element(confirm).toBeDisabled()
    await screen.getByRole('textbox', { name: '手機號碼' }).fill('0912345678')
    await confirm.click()
    await expect.element(screen.getByText('菜單已開啟')).toBeVisible()
    expect(phone()).toBe('0912345678')
    expect(JSON.stringify(await runtime.invoke('kiosk_interaction_state'))).not.toContain('0912345678')
    screen.unmount()
  })

  it('closes the same host modal after a Jev-admitted short voice skip', async () => {
    const { screen, bridge, runtime } = setupEntry()
    await expect.element(screen.getByRole('dialog')).toBeVisible()
    expect(await runFastPath({ transcript: '略過', isEnabled: async () => true, decide: async request => ({ kind: 'FAST_ACTION', actionId: request.candidates.find(candidate => candidate.id === 'intent:skip-customer-entry')!.id }), webMcp: { tools: bridge.tools.value, execute: bridge.execute } })).toMatchObject({ kind: 'FAST_ACTION' })
    await expect.element(screen.getByText('菜單已開啟')).toBeVisible()
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'ordering' })
    screen.unmount()
  })

  it('disposes discovery listeners and rejects an old document snapshot', async () => {
    const { screen, bridge, tools, listeners } = setupEntry()
    await expect.element(screen.getByRole('dialog')).toBeVisible()
    let resolve!: (snapshot: unknown) => void
    bridge.execute = async () => await new Promise<unknown>((done) => {
      resolve = done
    })
    tools.value = [...tools.value]
    await vi.waitFor(() => expect(resolve).toBeDefined())
    tools.value = []
    resolve({ phase: 'customer_entry' })
    await expect.element(screen.getByText('菜單已開啟')).toBeVisible()
    expect(document.querySelector('dialog:modal')).toBeNull()
    screen.unmount()
    expect(listeners.size).toBe(0)
  })
})
