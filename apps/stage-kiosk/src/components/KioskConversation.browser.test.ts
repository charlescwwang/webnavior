import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import KioskConversation from './KioskConversation.vue'

import { interactiveServiceClient } from '../services/interactiveServiceClient'
import { scenarioRegistry } from '../services/scenario-registry'

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
  expect(document.querySelectorAll('textarea')).toHaveLength(1)
  expect(screen.container.querySelector('[aria-label="送出訊息"]')).toBeNull()
  await screen.getByRole('textbox').fill('我想吃麵，一碗')
  await screen.getByRole('button', { name: '模擬辨識並執行' }).click()
  expect(onSimulateAsr).toHaveBeenCalledOnce()
  expect(onSimulateAsr).toHaveBeenCalledWith('我想吃麵，一碗')
})

it('keeps voice-only mode free of text inputs', () => {
  render(KioskConversation, {
    props: { ...props, voiceConversationOnly: true },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] },
  })
  expect(document.querySelectorAll('textarea')).toHaveLength(0)
})

afterEach(() => {
  scenarioRegistry.setServices([])
  interactiveServiceClient.activate(undefined)
})

it('describes missing assistant control without presenting the service as broken', async () => {
  scenarioRegistry.setServices([{
    enabled: true,
    id: 'menu',
    title: 'Menu',
    description: 'Ordering',
    serviceUrl: 'https://menu.example',
  }])
  interactiveServiceClient.activate(new URL('/favicon.ico', location.origin).href, window)
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
  // No tools are registered on this origin. The bounded
  // connection timeout must both leave direct interaction available.
  await expect.poll(() => interactiveServiceClient.availability.value, { timeout: 7_000 }).toBe('unavailable')
  const message = 'Assistant controls unavailable. Use the service screen directly.'
  await expect.element(screen.getByText(message)).toBeVisible()
  expect(screen.container.querySelector('.service-status')?.textContent).not.toContain('WebMCP')
})
