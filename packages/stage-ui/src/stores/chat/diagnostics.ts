import type { StreamEvent } from '@proj-airi/core-agent'

import { errorMessageFrom } from '@moeru/std'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

export type ChatDiagnosticStatus = 'completed' | 'failed' | 'generating' | 'missing-final-response' | 'running-tool'

/** Runtime evidence from the latest assistant turn, intended for opt-in diagnostics. */
export interface ChatDiagnosticSnapshot {
  error?: string
  inputTokens?: number
  outputTokens?: number
  status: ChatDiagnosticStatus
  textAfterLastTool: boolean
  textReceived: boolean
  toolName?: string
  totalTokens?: number
  usageAvailable: boolean
}

interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  source: 'estimated' | 'reported' | 'unavailable'
}

function initialSnapshot(): ChatDiagnosticSnapshot {
  return {
    status: 'completed',
    textAfterLastTool: false,
    textReceived: false,
    usageAvailable: false,
  }
}

/** Tracks token usage and tool lifecycle without exposing it unless the user enables diagnostics. */
export const useChatDiagnosticsStore = defineStore('chat-diagnostics', () => {
  const enabled = useLocalStorageManualReset('settings/chat/show-diagnostics', false)
  const latest = shallowRef<ChatDiagnosticSnapshot>(initialSnapshot())

  function startRound() {
    latest.value = {
      status: 'generating',
      textAfterLastTool: false,
      textReceived: false,
      usageAvailable: false,
    }
  }

  function recordEvent(event: StreamEvent) {
    if (event.type === 'text-delta') {
      latest.value = {
        ...latest.value,
        textAfterLastTool: latest.value.toolName !== undefined ? true : latest.value.textAfterLastTool,
        textReceived: true,
      }
      return
    }

    if (event.type === 'tool-call') {
      latest.value = { ...latest.value, status: 'running-tool', textAfterLastTool: false, toolName: event.toolName }
      return
    }

    if (event.type === 'tool-result' || event.type === 'tool-error') {
      latest.value = { ...latest.value, status: 'generating', textAfterLastTool: false }
    }
  }

  function recordUsage(usage: TokenUsage) {
    latest.value = {
      ...latest.value,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      usageAvailable: usage.source !== 'unavailable',
    }
  }

  function completeRound() {
    latest.value = {
      ...latest.value,
      status: latest.value.toolName && !latest.value.textAfterLastTool
        ? 'missing-final-response'
        : 'completed',
    }
  }

  function failRound(error: unknown) {
    latest.value = {
      ...latest.value,
      status: 'failed',
      error: errorMessageFrom(error) ?? 'Unknown chat failure.',
    }
  }

  return { completeRound, enabled, failRound, latest, recordEvent, recordUsage, startRound }
})
