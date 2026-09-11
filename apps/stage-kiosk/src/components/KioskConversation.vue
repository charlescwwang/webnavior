<script setup lang="ts">
import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import { ChatHistory } from '@proj-airi/stage-ui/components'
import { BasicTextarea } from '@proj-airi/ui'
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import KioskOrderToolStatus from './KioskOrderToolStatus.vue'

import { scenarioRegistry } from '../services/scenario-registry'
import { webMcpAdapter } from '../services/webmcp-adapter'

const props = defineProps<{
  messages: readonly ChatHistoryItem[]
  sending: boolean
  voiceConversationOnly: boolean
  workStatus?: string
}>()

const emit = defineEmits<{
  activity: []
  sendMessage: [text: string]
}>()

const { t } = useI18n()

const messageInput = shallowRef('')
const isComposing = shallowRef(false)
const assistantLabel = 'Webnavior'
const historyMessages = computed<ChatHistoryItem[]>(() => [...props.messages])
const serviceReady = computed(() => !scenarioRegistry.activeScenario.value || webMcpAdapter.availability.value === 'ready')
const canSend = computed(() => Boolean(messageInput.value.trim()) && !isComposing.value && !props.sending && serviceReady.value)
const placeholder = computed(() => serviceReady.value ? t('stage.message') : '正在準備互動服務…')
const orderToolCallRenderers = computed(() => Object.fromEntries(
  webMcpAdapter.tools.value.map(tool => [tool.name, KioskOrderToolStatus]),
))
const chatHistory = useTemplateRef<InstanceType<typeof ChatHistory>>('chatHistory')

// Kiosk status rows live beside ChatHistory so they remain visible while a
// reply is pending. Keep the transcript at its live edge when either the
// message list or that adjacent status changes.
watch([() => props.messages, () => props.sending, () => props.workStatus], () => {
  void nextTick(() => chatHistory.value?.scrollToBottom())
}, { flush: 'post' })

async function sendMessage() {
  if (!canSend.value)
    return

  const text = messageInput.value.trim()
  messageInput.value = ''
  emit('activity')
  emit('sendMessage', text)
}
</script>

<template>
  <section class="kiosk-conversation" aria-label="與虛擬服務員對話">
    <header class="conversation-header">
      <span class="conversation-kicker">{{ assistantLabel }}</span>
      <strong class="conversation-title">對話</strong>
    </header>

    <div class="message-history">
      <ChatHistory
        ref="chatHistory"
        :messages="historyMessages"
        :assistant-label="assistantLabel"
        :sending="props.sending"
        :tool-call-renderers="orderToolCallRenderers"
        auto-scroll="follow-latest"
        variant="mobile"
      />
      <div v-if="props.sending" class="assistant-activity" role="status" aria-live="polite">
        <span class="activity-orb" aria-hidden="true" />
        <span>{{ props.workStatus ?? '正在思考…' }}</span>
        <span class="activity-dots" aria-hidden="true"><i /><i /><i /></span>
      </div>
    </div>

    <p v-if="props.voiceConversationOnly" class="voice-only-notice" role="status">
      請直接對麥克風說話。
    </p>
    <form v-else class="message-composer" @submit.prevent="sendMessage">
      <BasicTextarea
        v-model="messageInput"
        :placeholder="placeholder"
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
    <p v-if="!serviceReady" class="service-status" role="status">
      {{ webMcpAdapter.error.value ?? '正在準備互動服務，請稍候。' }}
    </p>
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
.assistant-activity { display: flex; align-items: center; gap: .45rem; width: fit-content; max-width: 90%; margin: .55rem .2rem; border: 1px solid rgb(120 225 209 / 24%); border-radius: 1rem; padding: .5rem .7rem; color: #b9f5ec; background: rgb(17 81 79 / 48%); font-size: .78rem; font-weight: 700; }.activity-orb { width: .55rem; height: .55rem; border-radius: 999px; background: #7ce7d8; box-shadow: 0 0 .8rem #7ce7d8; animation: activity-pulse 1.2s ease-in-out infinite; }.activity-dots { display: flex; gap: .14rem; }.activity-dots i { width: .24rem; height: .24rem; border-radius: 999px; background: currentColor; animation: activity-bounce .9s ease-in-out infinite; }.activity-dots i:nth-child(2) { animation-delay: .12s; }.activity-dots i:nth-child(3) { animation-delay: .24s; }@keyframes activity-pulse { 50% { opacity: .35; transform: scale(.75); } }@keyframes activity-bounce { 50% { opacity: .3; transform: translateY(-.18rem); } }
.message-composer { display: flex; min-width: 0; gap: .5rem; border-top: 1px solid rgb(255 255 255 / 12%); padding: .55rem; background: rgb(1 17 20 / 48%); }
.message-input { min-width: 0; flex: 1; resize: none; border: 1px solid rgb(255 255 255 / 18%); border-radius: .8rem; padding: .45rem .7rem; color: #ecfffb; background: rgb(255 255 255 / 8%); outline: none; }
.message-input::placeholder { color: rgb(217 250 246 / 60%); }
.send-button { display: flex; width: 2.5rem; height: 2.5rem; flex: none; align-items: center; justify-content: center; align-self: end; border: 0; border-radius: .75rem; color: #063437; background: #78e1d1; cursor: pointer; }
.send-button:disabled { cursor: default; opacity: .4; }
.service-status { margin: 0; padding: 0 .75rem .55rem; color: #9cd9d0; font-size: .75rem; }
.voice-only-notice { margin: 0; border-top: 1px solid rgb(255 255 255 / 12%); padding: .8rem; color: #b9f5ec; background: rgb(1 17 20 / 48%); font-size: .82rem; font-weight: 700; text-align: center; }
</style>
