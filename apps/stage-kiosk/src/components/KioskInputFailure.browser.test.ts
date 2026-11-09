import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import stageMessages from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import KioskConversation from './KioskConversation.vue'
import KioskServiceFault from './KioskServiceFault.vue'

import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { useKioskServiceFault } from '../composables/useKioskServiceFault'
import { runFastPath } from '../services/kiosk-fast-path'
import { createServiceClarificationWindow, orderAssistanceFromRejection } from '../services/questionPresentation'

afterEach(() => sessionStorage.removeItem('kiosk/service-fault'))

// Report: this chat Nov8 — 「不要了」 vanished on browser context failure, in either input mode.
it.each([true, false])('keeps pre-admission input and explains context failure, voice-only=%s', async (voiceConversationOnly) => {
  const messages = shallowRef<ChatHistoryItem[]>([])
  const host = defineComponent({ setup() {
    const fault = useKioskServiceFault(messages)
    return () => h('div', [h(KioskConversation, { assistantPresence: { mode: 'listening', title: '點餐', description: '請點餐' }, fontSize: 20, messages: messages.value, sending: false, voiceConversationOnly, onVnodeMounted: async () => {
      const result = await runFastPath({ transcript: '不要了', isEnabled: async () => true, decide: async () => {
        throw new Error('No model should run for a broken context')
      }, webMcp: { tools: [{ name: 'kiosk_fast_path_context', description: 'Context', inputSchema: {}, origin: 'https://menu.test' }], execute: async () => ({ ok: false, error: 'The confirmed meal does not satisfy the current ordering constraints.' }) } })
      expect(fault.failDecision(result, { transcript: '不要了', shownInput: false, message: '這次處理失敗，尚未執行操作。您想重新提出哪項需求？' })).toBe(true)
    } }), fault.locked.value ? h(KioskServiceFault, { busy: false }) : null])
  } })
  const view = render(host, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: stageMessages } } })] } })
  await expect.element(view.getByText('不要了', { exact: true })).toBeVisible()
  await expect.element(view.getByText('這次處理失敗，尚未執行操作。您想重新提出哪項需求？', { exact: true })).toBeVisible()
  await expect.element(view.getByRole('alertdialog')).toBeVisible()
  await expect.element(view.getByText('偵測到特殊情況，已為您通知服務人員。')).toBeVisible()
  expect(messages.value.filter(message => message.role === 'user')).toHaveLength(1)
  expect(messages.value.some(message => message.role === 'error')).toBe(true)
  view.unmount()
})

// Report: this chat Nov09 — a proven oversized quantity is an optional-help question, never a lock.
it('keeps the screen usable when presenting a quantity assistance invitation', async () => {
  const cue = orderAssistanceFromRejection({ ok: false, executed: false, rejection: 'quantity-limit', error: 'QUANTITY_LIMIT', toolName: 'order_add_item', maximum: 20, requestedQuantity: 100, customerMessage: '最多20份' }, '一百份水餃', { phase: 'ordering' })!
  const messages = shallowRef<ChatHistoryItem[]>([])
  const host = defineComponent({ setup() {
    const fault = useKioskServiceFault(messages)
    messages.value = [{ role: 'assistant', content: cue.question, slices: [], tool_results: [] }]
    return () => h('div', [h('button', { disabled: fault.locked.value }, '繼續點餐'), h(KioskConversation, { assistantPresence: { mode: 'listening', title: '點餐', description: '請點餐' }, fontSize: 20, messages: messages.value, sending: false, voiceConversationOnly: false }), fault.locked.value ? h(KioskServiceFault, { busy: false }) : null])
  } })
  const view = render(host, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: stageMessages } } })] } })
  await expect.element(view.getByText(cue.question, { exact: true })).toBeVisible()
  await expect.element(view.getByRole('button', { name: '繼續點餐', exact: true })).toBeEnabled()
  await expect.element(view.getByRole('alertdialog')).not.toBeInTheDocument()
  view.unmount()
})

// Report: this chat Nov09 11:30 — staff consent must display the notification, not identity prose.
it.each(['好的', '不用了', '麻煩通知服務人員'])('renders the actual non-locking staff answer for %s', async (transcript) => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '蝦捲100份' })
  const rejection = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const window = createServiceClarificationWindow()
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  window.present(orderAssistanceFromRejection(rejection, '蝦捲100份', context)!)
  const result = await runFastPath({ transcript, isEnabled: async () => true, serviceClarification: state => window.current(state), decide: async () => {
    if (transcript === '麻煩通知服務人員')
      return { kind: 'STAFF_ANSWER', questionId: window.current(context)!.questionId, action: 'accept' }
    throw new Error('Finite staff answer must not invoke a model')
  }, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) } })
  expect(result.kind).toBe('SERVICE_REPLY')
  if (result.kind !== 'SERVICE_REPLY')
    throw new Error('Expected a staff notification receipt')
  window.settle(result)
  const messages = shallowRef<ChatHistoryItem[]>([{ role: 'assistant', content: result.reply.content, slices: [], tool_results: [] }])
  const host = defineComponent({ setup() {
    const fault = useKioskServiceFault(messages)
    return () => h('div', [h(KioskConversation, { assistantPresence: { mode: 'listening', title: '點餐', description: '請點餐' }, fontSize: 20, messages: messages.value, sending: false, voiceConversationOnly: false }), h('button', { disabled: fault.locked.value }, '繼續點餐'), fault.locked.value ? h(KioskServiceFault, { busy: false }) : null])
  } })
  const view = render(host, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: stageMessages } } })] } })
  await expect.element(view.getByText(result.reply.content, { exact: true })).toBeVisible()
  expect(result.reply.content.includes('已通知服務人員')).toBe(transcript !== '不用了')
  await expect.element(view.getByRole('button', { name: '繼續點餐', exact: true })).toBeEnabled()
  await expect.element(view.getByRole('alertdialog')).not.toBeInTheDocument()
  view.unmount()
})
