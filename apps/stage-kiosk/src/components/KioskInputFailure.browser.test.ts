import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import stageMessages from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import KioskConversation from './KioskConversation.vue'

import { useKioskServiceFault } from '../composables/useKioskServiceFault'
import { runFastPath } from '../services/kiosk-fast-path'

afterEach(() => sessionStorage.removeItem('kiosk/service-fault'))

// Report: this chat Nov8 — 「不要了」 vanished on browser context failure, in either input mode.
it.each([true, false])('keeps pre-admission input and explains context failure, voice-only=%s', async (voiceConversationOnly) => {
  const messages = shallowRef<ChatHistoryItem[]>([])
  const host = defineComponent({ setup() {
    const fault = useKioskServiceFault(messages)
    return () => h(KioskConversation, { assistantPresence: { mode: 'listening', title: '點餐', description: '請點餐' }, fontSize: 20, messages: messages.value, sending: false, voiceConversationOnly, onVnodeMounted: async () => {
      const result = await runFastPath({ transcript: '不要了', isEnabled: async () => true, decide: async () => {
        throw new Error('No model should run for a broken context')
      }, webMcp: { tools: [{ name: 'kiosk_fast_path_context', description: 'Context', inputSchema: {}, origin: 'https://menu.test' }], execute: async () => ({ ok: false, error: 'The confirmed meal does not satisfy the current ordering constraints.' }) } })
      expect(fault.failDecision(result, { transcript: '不要了', shownInput: false, message: '這次處理失敗，尚未執行操作。您想重新提出哪項需求？' })).toBe(true)
    } })
  } })
  const view = render(host, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: stageMessages } } })] } })
  await expect.element(view.getByText('不要了', { exact: true })).toBeVisible()
  await expect.element(view.getByText('這次處理失敗，尚未執行操作。您想重新提出哪項需求？', { exact: true })).toBeVisible()
  expect(messages.value.filter(message => message.role === 'user')).toHaveLength(1)
  expect(messages.value.some(message => message.role === 'error')).toBe(false)
  view.unmount()
})
