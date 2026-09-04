import type { ProactiveInteractionDecision } from '@proj-airi/kiosk-proactive'
import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { Message } from '@xsai/shared-chat'

import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useLLM } from '@proj-airi/stage-ui/stores/llm'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { storeToRefs } from 'pinia'
import { shallowRef } from 'vue'

/** Sends the anonymous trigger summary to the selected chat provider without creating a fake user message. */
export function useKioskProactiveGreeting() {
  const llm = useLLM()
  const chatSession = useChatSessionStore()
  const providers = useProvidersStore()
  const { activeModel, activeProvider } = storeToRefs(useConsciousnessStore())
  const greeting = shallowRef('')
  const sending = shallowRef(false)

  async function greet(decision: ProactiveInteractionDecision, instruction: string) {
    if (sending.value)
      return

    if (!decision.greetingTrigger)
      return

    const chatProvider = await providers.getProviderInstance<ChatProvider>(activeProvider.value)
    if (!chatProvider || !activeModel.value)
      throw new Error('尚未完成對話模型設定')

    sending.value = true
    let buffer = ''
    const messages: Message[] = [
      { role: 'system', content: instruction },
      {
        role: 'user',
        content: `匿名現場訊號：目前偵測區內約有 ${decision.triggeringPeople} 人，觸發方式為${decision.greetingTrigger === 'attention' ? '看向 kiosk' : '經過偵測區'}。請現在主動招呼。`,
      },
    ]

    try {
      await llm.stream(activeModel.value, chatProvider, messages, {
        onStreamEvent(event) {
          if (event.type === 'text-delta')
            buffer += event.text
        },
      })
      greeting.value = buffer.trim()
      if (!greeting.value)
        throw new Error('對話模型未回傳招呼內容')

      chatSession.setSessionMessages(chatSession.activeSessionId, [
        ...chatSession.messages,
        {
          role: 'assistant',
          content: greeting.value,
          slices: [{ type: 'text', text: greeting.value }],
          tool_results: [],
        },
      ])
    }
    finally {
      sending.value = false
    }
  }

  /** Delivers the built-in reminder text without asking a provider to reinterpret administrator wording. */
  function remind(text: string) {
    const content = text.trim()
    if (!content)
      return

    chatSession.setSessionMessages(chatSession.activeSessionId, [
      ...chatSession.messages,
      {
        role: 'assistant',
        content,
        slices: [{ type: 'text', text: content }],
        tool_results: [],
      },
    ])
  }

  return { greet, greeting, remind, sending }
}
