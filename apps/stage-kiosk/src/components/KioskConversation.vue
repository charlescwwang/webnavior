<script setup lang="ts">
import type { ChatAssistantMessage, ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'
import type { ChatProvider } from '@xsai-ext/providers/utils'

import { errorMessageFrom } from '@moeru/std'
import { ChatHistory } from '@proj-airi/stage-ui/components'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useChatStreamStore } from '@proj-airi/stage-ui/stores/chat/stream-store'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { BasicTextarea } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import KioskOrderToolStatus from './KioskOrderToolStatus.vue'

import { scenarioRegistry } from '../services/scenario-registry'
import { customerReplyFallback, findCustomerReplyRecovery } from './customer-facing-reply'

const emit = defineEmits<{
  activity: []
}>()

const chatOrchestrator = useChatOrchestratorStore()
const chatSession = useChatSessionStore()
const chatStream = useChatStreamStore()
const providersStore = useProvidersStore()
const { activeModel, activeProvider } = storeToRefs(useConsciousnessStore())
const { messages } = storeToRefs(chatSession)
const { sending } = storeToRefs(chatOrchestrator)
const { streamingMessage } = storeToRefs(chatStream)
const { t } = useI18n()

const messageInput = shallowRef('')
const isComposing = shallowRef(false)
const recentMessages = computed<ChatHistoryItem[]>(() => messages.value.slice(-3) as ChatHistoryItem[])
const canSend = computed(() => Boolean(messageInput.value.trim()) && !isComposing.value && !sending.value)
const orderToolCallRenderers = computed(() => Object.fromEntries(
  (scenarioRegistry.activeBridge.value?.manifest.value?.tools ?? []).map(tool => [tool.name, KioskOrderToolStatus]),
))

async function recoverCustomerReply(turnStartIndex: number) {
  const recovery = findCustomerReplyRecovery(messages.value, turnStartIndex)
  if (!recovery)
    return

  const content = customerReplyFallback()
  if (recovery.kind === 'replace' && recovery.messageIndex != null) {
    const original = messages.value[recovery.messageIndex]
    if (original?.role !== 'assistant')
      return

    const replacement: ChatAssistantMessage = {
      ...original,
      content,
      slices: [{ type: 'text', text: content }],
    }
    chatSession.setSessionMessages(chatSession.activeSessionId, messages.value.map((message, index) => index === recovery.messageIndex ? replacement : message))
    return
  }

  chatSession.setSessionMessages(chatSession.activeSessionId, [
    ...messages.value,
    {
      role: 'assistant',
      content,
      slices: [{ type: 'text', text: content }],
      tool_results: [],
    },
  ])
}

async function sendMessage() {
  if (!canSend.value)
    return

  const text = messageInput.value.trim()
  const turnStartIndex = messages.value.length
  messageInput.value = ''
  emit('activity')

  try {
    const providerConfig = providersStore.getProviderConfig(activeProvider.value)
    const chatProvider = await providersStore.getProviderInstance(activeProvider.value)
    if (!chatProvider || !activeModel.value)
      throw new Error('尚未完成對話模型設定')

    await chatOrchestrator.ingest(text, {
      chatProvider: chatProvider as ChatProvider,
      model: activeModel.value,
      providerConfig,
    })
    await recoverCustomerReply(turnStartIndex)
  }
  catch (error) {
    console.error('[stage-kiosk] failed to send customer message:', errorMessageFrom(error))
    messageInput.value = text
    chatSession.setSessionMessages(chatSession.activeSessionId, [
      ...messages.value.slice(0, -1),
      {
        role: 'error',
        content: '暫時無法回覆，請稍後再試。',
      },
    ])
  }
}
</script>

<template>
  <section class="kiosk-conversation" aria-label="與 AIRI 對話">
    <header class="conversation-header">
      <span class="conversation-kicker">AIRI 餐飲服務員</span>
      <strong class="conversation-title">對話與點餐進度</strong>
    </header>

    <div class="message-history">
      <ChatHistory
        :messages="recentMessages"
        :sending="sending"
        :streaming-message="streamingMessage"
        :tool-call-renderers="orderToolCallRenderers"
        variant="mobile"
      />
    </div>

    <form class="message-composer" @submit.prevent="sendMessage">
      <BasicTextarea
        v-model="messageInput"
        :placeholder="t('stage.message')"
        class="message-input"
        @submit="sendMessage"
        @compositionstart="isComposing = true"
        @compositionend="isComposing = false"
      />
      <button
        type="submit"
        class="send-button"
        :disabled="!canSend"
        aria-label="送出訊息"
      >
        <div class="i-solar:arrow-up-outline h-5 w-5" />
      </button>
    </form>
  </section>
</template>

<style scoped>
.kiosk-conversation { display: grid; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid rgb(255 255 255 / 14%); border-radius: 1.5rem; background: rgb(5 25 29 / 72%); grid-template-rows: auto minmax(0, 1fr) auto; }
.conversation-header { display: grid; gap: .08rem; padding: .8rem 1rem .45rem; color: #d9faf6; }
.conversation-kicker { color: #8bd9cb; font-size: .68rem; font-weight: 800; letter-spacing: .08em; }
.conversation-title { font-size: .95rem; }
.message-history { min-width: 0; min-height: 0; overflow: hidden; padding: 0 .55rem; }
.message-history :deep([data-chat-message-role]) { display: flex; min-width: 0; max-width: 100%; }
.message-history :deep([data-chat-message-role='assistant']), .message-history :deep([data-chat-message-role='error']) { justify-content: flex-start; }
.message-history :deep([data-chat-message-role='user']) { justify-content: flex-end; }
.message-history :deep(.ph-no-capture), .message-history :deep(.ph-no-capture *) { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.message-history :deep(pre), .message-history :deep(code) { max-width: 100%; overflow-wrap: anywhere; white-space: pre-wrap; }
.message-composer { display: flex; min-width: 0; gap: .5rem; border-top: 1px solid rgb(255 255 255 / 12%); padding: .55rem; background: rgb(1 17 20 / 48%); }
.message-input { min-width: 0; flex: 1; resize: none; border: 1px solid rgb(255 255 255 / 18%); border-radius: .8rem; padding: .45rem .7rem; color: #ecfffb; background: rgb(255 255 255 / 8%); outline: none; }
.message-input::placeholder { color: rgb(217 250 246 / 60%); }
.send-button { display: flex; width: 2.5rem; height: 2.5rem; flex: none; align-items: center; justify-content: center; align-self: end; border: 0; border-radius: .75rem; color: #063437; background: #78e1d1; cursor: pointer; }
.send-button:disabled { cursor: default; opacity: .4; }
</style>
