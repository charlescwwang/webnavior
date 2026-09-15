<script setup lang="ts">
import type { ChatAssistantMessage, ChatHistoryItem, ChatSlices, ChatSlicesText, ChatSlicesToolCallResult } from '../../../../types/chat'
import type { ChatToolCallRendererRegistry } from './tool-call-renderer'

import { isStageCapacitor, isStageWeb } from '@proj-airi/stage-shared'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChatResponsePart from './response-part.vue'
import ChatToolCallBlock from './tool-call-block.vue'

import { MarkdownRenderer } from '../../../markdown'
import { getChatHistoryItemCopyText } from '../utils'
import { ChatActionMenu } from './action-menu'
import { createToolCallResultLookup, resolveToolCallBlockState } from './tool-call-results'

const props = withDefaults(defineProps<{
  message: ChatAssistantMessage
  label: string
  showPlaceholder?: boolean
  variant?: 'desktop' | 'mobile'
  toolCallRenderers?: ChatToolCallRendererRegistry
}>(), {
  showPlaceholder: false,
  variant: 'desktop',
  toolCallRenderers: () => ({}),
})

const emit = defineEmits<{
  (e: 'copy'): void
  (e: 'delete'): void
  (e: 'toolCallRerun', payload: { toolCallId: string, toolName: string, args: string }): void
}>()

const resolvedSlices = computed<ChatSlices[]>(() => {
  if (props.message.slices?.length) {
    return props.message.slices
  }

  if (typeof props.message.content === 'string' && props.message.content.trim()) {
    return [{ type: 'text', text: props.message.content } satisfies ChatSlicesText]
  }

  if (Array.isArray(props.message.content)) {
    const textPart = props.message.content.find(part => 'type' in part && part.type === 'text') as { text?: string } | undefined
    if (textPart?.text)
      return [{ type: 'text', text: textPart.text } satisfies ChatSlicesText]
  }

  return []
})

const toolResultById = computed(() => {
  return createToolCallResultLookup(resolvedSlices.value, props.message.tool_results)
})
const { t } = useI18n()
const toolCallSlices = computed(() => resolvedSlices.value.filter(slice => slice.type === 'tool-call'))
const hasExecutingToolCall = computed(() => toolCallSlices.value.some(slice => getToolCallState(slice) === 'executing'))
const toolActivityLabel = computed(() => hasExecutingToolCall.value
  ? t('stage.chat.tool-activity.processing', { count: toolCallSlices.value.length })
  : t('stage.chat.tool-activity.complete', { count: toolCallSlices.value.length }))

function getToolCallResult(slice: ChatSlices): ChatSlicesToolCallResult | undefined {
  if (slice.type !== 'tool-call') {
    return undefined
  }

  return toolResultById.value.get(slice.toolCall.toolCallId)
}

function getToolCallState(slice: ChatSlices): 'executing' | 'done' | 'error' {
  return resolveToolCallBlockState(getToolCallResult(slice))
}

function getToolCallRenderer(slice: ChatSlices) {
  if (slice.type !== 'tool-call') {
    return ChatToolCallBlock
  }

  return props.toolCallRenderers[slice.toolCall.toolName] ?? ChatToolCallBlock
}

const showLoader = computed(() => props.showPlaceholder && resolvedSlices.value.length === 0)
const containerClass = computed(() => props.variant === 'mobile' ? 'mr-0' : 'mr-12')
const boxClasses = computed(() => [
  props.variant === 'mobile' ? 'px-2 py-2 text-sm bg-primary-50/90 dark:bg-primary-950/90' : 'px-3 py-3 bg-primary-50/80 dark:bg-primary-950/80',
])
const copyText = computed(() => getChatHistoryItemCopyText(props.message as ChatHistoryItem))
</script>

<template>
  <div flex :class="containerClass" class="ph-no-capture">
    <ChatActionMenu
      :copy-text="copyText"
      :can-delete="!showPlaceholder"
      @copy="emit('copy')"
      @delete="emit('delete')"
    >
      <template #default="{ setMeasuredElement }">
        <div
          :ref="setMeasuredElement"
          flex="~ col" shadow="sm primary-200/50 dark:none"
          min-w-20 gap-2 rounded-xl h="unset <sm:fit"
          :class="[
            boxClasses,
            (isStageWeb() || isStageCapacitor()) && props.variant === 'mobile' ? 'select-none sm:select-auto' : '',
          ]"
        >
          <ChatResponsePart
            v-if="message.categorization"
            :message="message"
            :variant="variant"
          />
          <div class="chat-message-label <sm:hidden">
            <span text-sm text="black/60 dark:white/65" font-normal>{{ label }}</span>
          </div>
          <div v-if="resolvedSlices.length > 0" class="flex flex-col gap-2 break-words" text="primary-700 dark:primary-100">
            <details v-if="toolCallSlices.length > 0" class="tool-activity" :open="hasExecutingToolCall">
              <summary class="tool-activity-summary">
                <span :class="[hasExecutingToolCall ? 'i-eos-icons:loading' : 'i-solar:check-circle-bold-duotone', 'h-4 w-4 flex-none']" />
                {{ toolActivityLabel }}
              </summary>
              <div class="tool-activity-list">
                <template v-for="(slice, sliceIndex) in toolCallSlices" :key="sliceIndex">
                  <component
                    :is="getToolCallRenderer(slice)"
                    :tool-call-id="slice.toolCall.toolCallId"
                    :tool-name="slice.toolCall.toolName"
                    :args="slice.toolCall.args"
                    :state="getToolCallState(slice)"
                    :result="getToolCallResult(slice)?.result"
                    @tool-call-rerun="emit('toolCallRerun', $event)"
                  />
                </template>
              </div>
            </details>
            <template v-for="(slice, sliceIndex) in resolvedSlices" :key="sliceIndex">
              <MarkdownRenderer v-if="slice.type === 'text'" :content="slice.text" />
            </template>
          </div>
          <div v-else-if="showLoader" i-eos-icons:three-dots-loading />
        </div>
      </template>
    </ChatActionMenu>
  </div>
</template>

<style scoped>
.tool-activity { border: 1px solid rgb(93 155 146 / 28%); border-radius: .65rem; background: rgb(93 155 146 / 8%); }
.tool-activity-summary { display: flex; align-items: center; gap: .4rem; padding: .45rem .6rem; color: rgb(35 109 101); font-size: .78rem; font-weight: 700; cursor: pointer; }
.tool-activity-list { display: grid; gap: .35rem; border-top: 1px solid rgb(93 155 146 / 18%); padding: .45rem .6rem .6rem; }
</style>
