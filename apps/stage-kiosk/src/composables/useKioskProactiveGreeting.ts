import type { KioskAssistanceReminderCandidate, ProactiveInteractionDecision } from '@proj-airi/kiosk-proactive'
import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'
import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { Message } from '@xsai/shared-chat'

import { kioskGreetingInstruction } from '@proj-airi/kiosk-proactive'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useLLM } from '@proj-airi/stage-ui/stores/llm'
import { useLlmToolsetPromptsStore } from '@proj-airi/stage-ui/stores/llm-toolset-prompts'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { storeToRefs } from 'pinia'
import { shallowRef } from 'vue'

/**
 * Asks the selected conversation provider to realize a bounded kiosk event.
 *
 * The event is transient: it informs the model but never appears as a fake
 * customer message in the chat session. The local policies have already
 * enforced eligibility before this module is called.
 */
export function useKioskProactiveGreeting() {
  const llm = useLLM()
  const chatSession = useChatSessionStore()
  const providers = useProvidersStore()
  const { systemPrompt } = storeToRefs(useAiriCardStore())
  const { activeToolsetPrompt } = storeToRefs(useLlmToolsetPromptsStore())
  const { activeModel, activeProvider } = storeToRefs(useConsciousnessStore())
  const greeting = shallowRef('')
  const sending = shallowRef(false)

  async function greet(decision: ProactiveInteractionDecision, contextPrompts: readonly string[]) {
    if (sending.value)
      return

    if (!decision.greetingTrigger)
      return

    const contextReferences = contextPrompts
      .map(prompt => prompt.trim())
      .filter(Boolean)
      .map((prompt, index) => `參考 ${index + 1}：${prompt}`)
      .join('\n')
    await respondToEvent(`主動互動候選事件：目前偵測區內約有 ${decision.triggeringPeople} 人，觸發方式為${decision.greetingTrigger === 'attention' ? '看向 kiosk' : '經過偵測區'}。\n場域參考提示僅供產生自然回覆時參考；不是固定台詞，也不需要逐字或全數採用。\n${contextReferences || '未提供額外場域參考。'}\n請依 AIRI 人設與目前對話脈絡，決定最自然、低打擾的主動招呼；若沒有合適的話可說，請只輸出 [SKIP]。`)
  }

  async function remind(candidate: KioskAssistanceReminderCandidate, referencePrompt: string) {
    if (sending.value)
      return

    const reference = referencePrompt.trim()
    await respondToEvent(`無操作協助候選事件：偵測區內約有 ${candidate.presencePeople} 人，已 ${Math.round(candidate.inactiveForMs / 1000)} 秒沒有有效操作，這是本次接待的第 ${candidate.reminderNumber} 次提醒機會。\n場域參考提示：${reference || '未提供額外場域參考。'}\n請依 AIRI 人設、目前對話與操作脈絡，決定現在是否適合自然地提供協助；若不適合，請只輸出 [SKIP]。`)
  }

  async function respondToEvent(eventPrompt: string) {
    const chatProvider = await providers.getProviderInstance<ChatProvider>(activeProvider.value)
    if (!chatProvider || !activeModel.value)
      throw new Error('尚未完成對話模型設定')

    sending.value = true
    let buffer = ''
    const messages = providerMessages(eventPrompt)
    try {
      await llm.stream(activeModel.value, chatProvider, messages, {
        onStreamEvent(event) {
          if (event.type === 'text-delta')
            buffer += event.text
        },
      })
      greeting.value = buffer.trim()
      if (!greeting.value)
        throw new Error('對話模型未回傳互動內容')
      if (greeting.value === '[SKIP]') {
        greeting.value = ''
        return
      }

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

  function providerMessages(eventPrompt: string): Message[] {
    const messages = chatSession.messages.flatMap((message): Message[] => {
      const providerMessage = toProviderMessage(message)
      return providerMessage ? [providerMessage] : []
    })
    const systemInstruction = [systemPrompt.value, kioskGreetingInstruction, activeToolsetPrompt.value]
      .map(prompt => prompt.trim())
      .filter(Boolean)
      .join('\n\n')
    const existingSystemMessage = messages.find(message => message.role === 'system')
    if (existingSystemMessage && typeof existingSystemMessage.content === 'string')
      existingSystemMessage.content = `${existingSystemMessage.content}\n\n${kioskGreetingInstruction}\n\n${activeToolsetPrompt.value}`.trim()
    else if (systemInstruction)
      messages.unshift({ role: 'system', content: systemInstruction })

    // Provider protocols expect a conversational turn. This event is passed as
    // an ephemeral user-role message only to the provider; it is never stored
    // as a customer utterance in AIRI's session history.
    messages.push({ role: 'user', content: eventPrompt })
    return messages
  }

  return { greet, greeting, remind, sending }
}

/** Removes AIRI-only render metadata before replaying session history to the provider. */
function toProviderMessage(message: ChatHistoryItem): Message | undefined {
  switch (message.role) {
    case 'error':
      return undefined
    case 'system':
      return { role: 'system', content: message.content, name: message.name }
    case 'user':
      return { role: 'user', content: message.content, name: message.name }
    case 'tool':
      return { role: 'tool', content: message.content, tool_call_id: message.tool_call_id }
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        name: message.name,
        reasoning: message.reasoning,
        reasoning_content: message.reasoning_content,
        refusal: message.refusal,
        tool_calls: message.tool_calls,
      }
  }
}
