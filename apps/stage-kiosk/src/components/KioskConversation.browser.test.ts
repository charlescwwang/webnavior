import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import KioskConversation from './KioskConversation.vue'

import { scenarioRegistry } from '../services/scenario-registry'
import { webMcpAdapter } from '../services/webmcp-adapter'

const props = {
  assistantPresence: { mode: 'listening' as const, description: '請點餐', title: '歡迎' },
  fontSize: 20,
  messages: [],
  sending: false,
  voiceConversationOnly: false,
}

it('keeps only the simulated ASR input in text mode and forwards its transcript', async () => {
  const onSimulateAsr = vi.fn()
  const screen = render(KioskConversation, {
    props: { ...props, onSimulateAsr },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { stage: { message: 'Message' } } } })] },
  })
  expect(screen.container.querySelectorAll('textarea')).toHaveLength(1)
  expect(screen.container.querySelector('[aria-label="送出訊息"]')).toBeNull()
  await screen.getByRole('textbox').fill('我想吃麵，一碗')
  await screen.getByRole('button', { name: '模擬辨識並執行' }).click()
  expect(onSimulateAsr).toHaveBeenCalledOnce()
  expect(onSimulateAsr).toHaveBeenCalledWith('我想吃麵，一碗')
})

it('keeps voice-only mode free of text inputs', () => {
  const screen = render(KioskConversation, {
    props: { ...props, voiceConversationOnly: true },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] },
  })
  expect(screen.container.querySelectorAll('textarea')).toHaveLength(0)
})

afterEach(() => {
  scenarioRegistry.setServices([])
  webMcpAdapter.activate(undefined)
})

it('describes missing assistant control without presenting the service as broken', async () => {
  scenarioRegistry.setServices([{
    enabled: true,
    id: 'menu',
    title: 'Menu',
    description: 'Ordering',
    serviceUrl: 'https://menu.example',
  }])
  webMcpAdapter.activate('https://menu.example')
  const screen = render(KioskConversation, {
    props,
    global: { plugins: [createI18n({
      legacy: false,
      locale: 'en',
      messages: { en: { stage: { 'kiosk-agent': {
        'service-connecting': 'Connecting assistant controls. Use the service screen directly.',
        'service-manual': 'Assistant controls unavailable. Use the service screen directly.',
        'service-browser-unsupported': 'This browser does not support assistant controls. Use the service screen directly.',
      } } } },
    })] },
  })
  // No tools are registered on this origin. An absent native API or its bounded
  // discovery timeout must both leave direct interaction available.
  await expect.poll(() => webMcpAdapter.availability.value, { timeout: 7_000 }).toBe('unavailable')
  const message = webMcpAdapter.unavailableReason.value === 'unsupported-browser'
    ? 'This browser does not support assistant controls. Use the service screen directly.'
    : 'Assistant controls unavailable. Use the service screen directly.'
  await expect.element(screen.getByText(message)).toBeVisible()
  expect(screen.container.querySelector('.service-status')?.textContent).not.toContain('WebMCP')
})
