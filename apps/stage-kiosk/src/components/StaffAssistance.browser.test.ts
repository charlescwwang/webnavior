import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import KioskConversation from './KioskConversation.vue'
import KioskServiceFault from './KioskServiceFault.vue'

import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { useKioskServiceFault } from '../composables/useKioskServiceFault'
import { createMenuReplyWindow, replyFromConversation } from '../services/questionPresentation'

// Report: this chat Nov7; simulated staff assistance must not cover or lock the menu.
it('regression K1107-STAFF keeps ordering usable after the simulated assistance notice', async () => {
  const count = shallowRef(0)
  const runtime = createMenuToolRuntime({ menu: [{ id: 'meal', name: '測試餐點', price: 80, available: true, category: '餐點', description: '', imageUrl: '', recommendationTags: [], optionGroups: [] }], onAction: () => {}, onMenuSelection: () => {}, onCartChange: cart => count.value = cart.itemCount })
  const context = parse(conversationContextSchema, { ...await runtime.invoke('kiosk_conversation_context') as object, staffAssistance: { questionId: 'staff-question', expiresAt: Date.now() + 30000 } })
  const notice = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], reply: { kind: 'staff-assistance', action: 'accept' } }, { menu: createMenuReplyWindow(), context, failureMessage: '未完成。' })
  expect(notice.role).toBe('assistant')
  const Harness = defineComponent({
    setup() {
      const messages = shallowRef<ChatHistoryItem[]>([{ role: notice.role, content: notice.content, slices: [], tool_results: [] }])
      const fault = useKioskServiceFault(messages)
      return () => h('div', [
        h(KioskConversation, { assistantPresence: { mode: 'listening', title: '請點餐', description: '請點餐' }, fontSize: 20, messages: messages.value, sending: false, voiceConversationOnly: false }),
        fault.locked.value ? h(KioskServiceFault, { busy: false }) : null,
        h('button', { disabled: fault.locked.value, onClick: () => runtime.invokeManual('order_add_item', { itemId: 'meal', quantity: 1 }) }, '繼續選餐'),
        h('output', { 'aria-label': '餐點份數' }, String(count.value)),
      ])
    },
  })
  const view = render(Harness, { global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] } })
  try {
    await expect.element(view.getByText('已經呼叫工作人員，您可以繼續點餐。', { exact: true })).toBeVisible()
    await expect.element(view.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect.element(view.getByRole('button', { name: '繼續選餐' })).toBeEnabled()
    await view.getByRole('button', { name: '繼續選餐' }).click()
    await expect.element(view.getByRole('status', { name: '餐點份數' })).toHaveTextContent('1')
  }
  finally { view.unmount() }
})
