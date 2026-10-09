import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import KioskConversation from './KioskConversation.vue'

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
