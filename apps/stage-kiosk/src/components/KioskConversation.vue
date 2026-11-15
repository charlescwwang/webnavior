<script setup lang="ts">
import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import type { CustomerRequestStatus } from '../services/conversationMessages'
import type { FastPathTiming } from '../services/kiosk-fast-path'
import type { KioskAssistantPresenceMode } from './KioskAssistantPresence.vue'

import { ChatHistory } from '@proj-airi/stage-ui/components'
import { toOrderingTraditionalChinese } from '@proj-airi/stage-ui/libs/taiwan-traditional-chinese'
import { computed, nextTick, onScopeDispose, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import KioskAssistantPresence from './KioskAssistantPresence.vue'
import KioskOrderToolStatus from './KioskOrderToolStatus.vue'
import KioskTextConsole from './kioskTextConsole.vue'

import { groupConversationMessages } from '../services/conversationMessages'
import { interactiveServiceClient } from '../services/interactiveServiceClient'
import { scenarioRegistry } from '../services/scenario-registry'

const props = defineProps<{
  activityStatus?: string
  activitySteps?: readonly { label: string, state: 'done' | 'error' | 'executing' | 'selected', toolName: string }[]
  assistantPresence: {
    description: string
    mode: KioskAssistantPresenceMode
    title: string
  }
  executionDurationMs?: number
  fastPathSimulationStatus?: string
  fastPathSimulationTrace?: string
  fastPathSimulationTiming?: FastPathTiming
  fontSize: number
  messages: readonly ChatHistoryItem[]
  requestStatuses?: Readonly<Record<number, CustomerRequestStatus>>
  pendingTranscript?: string
  retryAvailable?: boolean
  sending: boolean
  serviceRecoveryBlocked?: boolean
  serviceRecovering?: boolean
  streamingAssistantMessage?: ChatHistoryItem
  voiceConversationOnly: boolean
  textConsoleTarget?: string
}>()

const emit = defineEmits<{
  retryMessage: []
  recoverService: []
  simulateAsr: [transcript: string]
  textConsoleFloating: [floating: boolean]
}>()

const { t } = useI18n()
const assistantLabel = 'Webnavior'
// The unfinished assistant message is display-only. KioskScene moves it into
// durable conversation history only after the Server emits turn-finished.
const historyMessages = computed<ChatHistoryItem[]>(() => groupConversationMessages([
  ...props.messages,
  ...(props.streamingAssistantMessage ? [props.streamingAssistantMessage] : []),
]).map((message): ChatHistoryItem => {
  // Presentation owns a copy: ASR, model history and tool payloads remain the
  // original evidence even when their visible text uses Taiwan Traditional.
  if (message.role === 'assistant') {
    return {
      ...message,
      content: typeof message.content === 'string'
        ? toOrderingTraditionalChinese(message.content)
        : message.content?.map(part => part.type === 'text' ? { ...part, text: toOrderingTraditionalChinese(part.text) } : part),
      slices: message.slices.map(slice => slice.type === 'text' ? { ...slice, text: toOrderingTraditionalChinese(slice.text) } : slice),
    }
  }
  if (message.role === 'user') {
    return {
      ...message,
      content: typeof message.content === 'string'
        ? toOrderingTraditionalChinese(message.content)
        : message.content.map(part => part.type === 'text' ? { ...part, text: toOrderingTraditionalChinese(part.text) } : part),
    }
  }
  if (message.role === 'error')
    return { ...message, content: toOrderingTraditionalChinese(message.content) }
  return message
}))
function requestStatus(message: ChatHistoryItem) {
  const id = message.role === 'user' ? message.id?.match(/^utterance:(\d+):user$/)?.[1] : undefined
  return id ? props.requestStatuses?.[Number(id)] : undefined
}

// Tool discovery describes assistant control, not whether the embedded menu
// loaded successfully. Keep the service usable while that capability is absent.
const serviceStatus = computed(() => {
  if (props.serviceRecoveryBlocked)
    return t('stage.kiosk-agent.service-unavailable')
  if (interactiveServiceClient.editorRetired.value)
    return undefined
  if (!scenarioRegistry.activeScenario.value || interactiveServiceClient.availability.value === 'ready')
    return undefined
  return t(interactiveServiceClient.availability.value === 'unavailable'
    ? 'stage.kiosk-agent.service-manual'
    : 'stage.kiosk-agent.service-connecting')
})
const orderToolCallRenderers = computed(() => Object.fromEntries(
  interactiveServiceClient.tools.value.map(tool => [tool.name, KioskOrderToolStatus]),
))
const chatHistory = useTemplateRef<InstanceType<typeof ChatHistory>>('chatHistory')
let lateTailFollow: ReturnType<typeof setTimeout> | undefined

// Request status lives below each customer message; adjacent recognition and
// tool progress still share the same viewport-follow policy.
function followLatestMessage() {
  if (lateTailFollow)
    clearTimeout(lateTailFollow)

  void nextTick(() => {
    // The history viewport can resize after a status row is rendered. Waiting
    // for two frames makes the follow operation happen after that layout work.
    requestAnimationFrame(() => requestAnimationFrame(() => chatHistory.value?.scrollToBottom()))
  })

  // Markdown rendering is asynchronous. Follow again after that content has
  // settled so a voice transcript is visible immediately like an LLM reply.
  lateTailFollow = setTimeout(() => chatHistory.value?.scrollToBottom(), 300)
}

watch([historyMessages, () => props.requestStatuses, () => props.activityStatus, () => props.pendingTranscript], followLatestMessage, { flush: 'post' })
onScopeDispose(() => lateTailFollow && clearTimeout(lateTailFollow))
</script>

<template>
  <section
    class="kiosk-conversation"
    :style="{ '--conversation-font-size': `${props.fontSize}px` }"
    aria-label="與虛擬服務員對話"
  >
    <div class="message-history">
      <KioskAssistantPresence
        v-if="historyMessages.length === 0 && !props.pendingTranscript"
        :description="toOrderingTraditionalChinese(props.assistantPresence.description)"
        :mode="props.assistantPresence.mode"
        :title="toOrderingTraditionalChinese(props.assistantPresence.title)"
      />
      <!-- The kiosk owns a separate status row; ChatHistory's empty streaming
           placeholder would otherwise render only the assistant name. -->
      <ChatHistory
        v-if="historyMessages.length > 0"
        ref="chatHistory"
        :messages="historyMessages"
        :assistant-label="assistantLabel"
        :error-label="assistantLabel"
        :sending="false"
        :tool-call-renderers="orderToolCallRenderers"
        auto-scroll="follow-latest"
        variant="mobile"
      >
        <template #after-message="{ message }">
          <span v-if="requestStatus(message) && requestStatus(message) !== 'failed'" :class="['request-status', `is-${requestStatus(message)}`]" role="status">{{ t(`stage.kiosk.request-status.${requestStatus(message)}`) }}</span>
        </template>
      </ChatHistory>
    </div>

    <div v-if="props.pendingTranscript || props.activityStatus || props.activitySteps?.length || props.executionDurationMs !== undefined || props.retryAvailable" class="conversation-progress">
      <div v-if="props.pendingTranscript" class="pending-transcript" role="status" aria-live="polite">
        <span class="i-solar:microphone-3-bold h-4 w-4" aria-hidden="true" />
        <span>{{ toOrderingTraditionalChinese(props.pendingTranscript) }}</span>
      </div>
      <div v-if="props.activityStatus" class="assistant-activity" role="status" aria-live="polite">
        <span class="activity-orb" aria-hidden="true" />
        <span>{{ toOrderingTraditionalChinese(props.activityStatus) }}</span>
        <span class="activity-dots" aria-hidden="true"><i /><i /><i /></span>
      </div>
      <ol v-if="props.activitySteps?.length" class="assistant-activity-steps" aria-label="本次處理進度">
        <li v-for="step in props.activitySteps" :key="step.toolName" :class="['assistant-activity-step', `is-${step.state}`]">
          <span class="activity-step-marker" aria-hidden="true" />
          <span>{{ toOrderingTraditionalChinese(step.label) }}</span>
        </li>
      </ol>
      <output v-if="props.executionDurationMs !== undefined" class="conversation-execution-duration" aria-label="本輪對話處理耗時">
        <span class="i-solar:stopwatch-bold-duotone h-4 w-4" aria-hidden="true" />
        <span>本輪對話處理</span>
        <strong>{{ (props.executionDurationMs / 1000).toFixed(1) }} 秒</strong>
      </output>
      <button v-if="props.retryAvailable" type="button" class="conversation-retry" :disabled="props.sending" @click="emit('retryMessage')">
        <span class="i-solar:restart-bold h-4 w-4" aria-hidden="true" />
        再試一次
      </button>
    </div>

    <p v-if="props.voiceConversationOnly" class="voice-only-notice" role="status">
      請直接對麥克風說話；處理中也能繼續補充。
    </p>
    <KioskTextConsole
      v-else
      :dock-target="props.textConsoleTarget"
      :native-popup="Boolean(props.textConsoleTarget)"
      :status="props.fastPathSimulationStatus"
      :trace="props.fastPathSimulationTrace"
      :timing="props.fastPathSimulationTiming"
      @simulate="emit('simulateAsr', $event)"
      @floating-change="emit('textConsoleFloating', $event)"
    />
    <p v-if="serviceStatus" class="service-status" role="status">
      {{ toOrderingTraditionalChinese(serviceStatus) }}
      <button
        v-if="props.serviceRecoveryBlocked || interactiveServiceClient.availability.value === 'unavailable'"
        type="button"
        :disabled="props.sending || props.serviceRecovering"
        @click="emit('recoverService')"
      >
        {{ t('stage.kiosk-agent.service-reconnect') }}
      </button>
    </p>
  </section>
</template>

<style scoped>
.kiosk-conversation { display: grid; min-width: 0; min-height: 0; overflow: hidden; background: transparent; grid-template-rows: minmax(0, 1fr) auto auto auto; }
.message-history { min-width: 0; min-height: 0; overflow: hidden; padding: 0 .55rem; background: transparent; }
.conversation-progress { display: grid; gap: .3rem; padding: 0 .55rem .45rem; background: rgb(1 17 20 / 28%); }
.message-history :deep([data-chat-message-role]) { display: flex; min-width: 0; max-width: 100%; }
.message-history :deep(.ph-no-capture) { max-width: min(78%, 42rem); }
.message-history :deep([data-chat-message-bubble]) { box-sizing: border-box; max-width: 100%; border-width: 2px; box-shadow: 0 .35rem 1rem rgb(0 0 0 / 34%); }
.message-history :deep([data-chat-message-role='assistant']), .message-history :deep([data-chat-message-role='error']) { justify-content: flex-start; }
.message-history :deep([data-chat-message-role='user']) { justify-content: flex-end; flex-wrap: wrap; }
.request-status { flex-basis: 100%; text-align: right; padding: .2rem .3rem; color: #b9f5ec; font-size: .75rem; }
.request-status.is-processing { font-weight: 800; }
.request-status.is-failed { color: #ffdbad; }
.message-history :deep([data-chat-message-bubble]) { user-select: text; }
.message-history :deep(.markdown-content), .message-history :deep(.markdown-content *) { font-size: var(--conversation-font-size) !important; line-height: 1.45 !important; }
.message-history :deep(.markdown-content p) { margin: 0; }
.message-history :deep(.markdown-content p + p) { margin-top: .55em; }
.message-history :deep(.chat-message-label) { display: none; }
.message-history :deep(.ph-no-capture), .message-history :deep(.ph-no-capture *) { min-width: 0; overflow-wrap: anywhere; }
.message-history :deep(.ph-no-capture *) { max-width: 100%; }
.message-history :deep([data-chat-message-role='assistant'] [data-chat-message-bubble]) { color: #101819; background: #f6f8f7 !important; border-color: #2b7773; }
.message-history :deep([data-chat-message-role='assistant'] [data-chat-message-bubble] .markdown-content), .message-history :deep([data-chat-message-role='assistant'] [data-chat-message-bubble] .markdown-content *) { color: #101819 !important; font-weight: 700; }
.message-history :deep([data-chat-message-role='user'] [data-chat-message-bubble]) { color: #101819; background: #f6f8f7 !important; border-color: #096f7c; }
.message-history :deep([data-chat-message-role='user'] [data-chat-message-bubble] .markdown-content), .message-history :deep([data-chat-message-role='user'] [data-chat-message-bubble] .markdown-content *) { color: #101819 !important; font-weight: 700; }
.message-history :deep(pre), .message-history :deep(code) { max-width: 100%; overflow-wrap: anywhere; white-space: pre-wrap; }
.pending-transcript { display: flex; align-items: center; gap: .4rem; width: fit-content; max-width: 90%; margin: .55rem .2rem .1rem auto; border: 1px solid rgb(120 225 209 / 24%); border-radius: 1rem; padding: .5rem .7rem; color: #c9fffa; background: rgb(17 81 79 / 40%); font-size: .78rem; font-style: italic; }
.assistant-activity { display: flex; align-items: center; gap: .45rem; width: fit-content; max-width: 90%; margin: .55rem .2rem; border: 1px solid rgb(120 225 209 / 24%); border-radius: 1rem; padding: .5rem .7rem; color: #b9f5ec; background: rgb(17 81 79 / 48%); font-size: .78rem; font-weight: 700; }.activity-orb { width: .55rem; height: .55rem; border-radius: 999px; background: #7ce7d8; box-shadow: 0 0 .8rem #7ce7d8; animation: activity-pulse 1.2s ease-in-out infinite; }.activity-dots { display: flex; gap: .14rem; }.activity-dots i { width: .24rem; height: .24rem; border-radius: 999px; background: currentColor; animation: activity-bounce .9s ease-in-out infinite; }.activity-dots i:nth-child(2) { animation-delay: .12s; }.activity-dots i:nth-child(3) { animation-delay: .24s; }@keyframes activity-pulse { 50% { opacity: .35; transform: scale(.75); } }@keyframes activity-bounce { 50% { opacity: .3; transform: translateY(-.18rem); } }
.assistant-activity-steps { display: grid; gap: .3rem; margin: .1rem .2rem; padding: 0; color: #c7ebe6; font-size: .75rem; font-weight: 700; list-style: none; }.assistant-activity-step { display: flex; align-items: center; gap: .4rem; }.activity-step-marker { width: .42rem; height: .42rem; flex: none; border-radius: 50%; background: #6faaa3; }.assistant-activity-step.is-selected .activity-step-marker, .assistant-activity-step.is-executing .activity-step-marker { background: #7ce7d8; box-shadow: 0 0 .65rem #7ce7d8; }.assistant-activity-step.is-done .activity-step-marker { background: #8edb9a; }.assistant-activity-step.is-error .activity-step-marker { background: #f3b391; }
.conversation-execution-duration { display: flex; align-items: center; gap: .35rem; width: fit-content; margin: .1rem .2rem; color: #a9d9d2; font-size: .72rem; }.conversation-execution-duration strong { color: #e4fffa; font-variant-numeric: tabular-nums; }
.conversation-retry { display: flex; width: fit-content; align-items: center; gap: .35rem; margin: .1rem .2rem; border: 1px solid rgb(120 225 209 / 42%); border-radius: .7rem; padding: .42rem .6rem; color: #d9fffa; background: rgb(17 81 79 / 42%); font-size: .75rem; font-weight: 800; }.conversation-retry:disabled { cursor: default; opacity: .45; }
.service-status { margin: 0; padding: 0 .75rem .55rem; color: #9cd9d0; font-size: .75rem; }
.voice-only-notice { margin: 0; border-top: 1px solid rgb(255 255 255 / 12%); padding: .8rem; color: #b9f5ec; background: rgb(1 17 20 / 48%); font-size: .82rem; font-weight: 700; text-align: center; }
</style>
