<script setup lang="ts">
import { useInferencePreload } from '@proj-airi/stage-ui/composables'
import { useLlmToolsStore } from '@proj-airi/stage-ui/stores/llm-tools'
import { useLlmToolsetPromptsStore } from '@proj-airi/stage-ui/stores/llm-toolset-prompts'
import { ErrorBoundary } from '@proj-airi/ui'
import { onMounted, onUnmounted, watch } from 'vue'
import { RouterView } from 'vue-router'

import { useKioskInteractiveServiceAgentInstructions } from './composables/useKioskInteractiveServices'
import { initializeKioskRuntime } from './services/kiosk-runtime-initialization'
import { scenarioRegistry } from './services/scenario-registry'
import { webMcpAdapter } from './services/webmcp-adapter'
import { createScenarioNavigationPrompt, createScenarioNavigationTools } from './tools/scenario'
import { createWebMcpTools } from './tools/webmcp'

const inferencePreload = useInferencePreload()
const llmToolsStore = useLlmToolsStore()
const llmToolsetPromptsStore = useLlmToolsetPromptsStore()
const interactiveServiceAgentInstructions = useKioskInteractiveServiceAgentInstructions()
// Start this during root setup, before route components mount. A route can then
// await the same promise before applying the Server-published avatar.
const kioskRuntimeReady = initializeKioskRuntime()

let scenarioSyncGeneration = 0

async function syncActiveScenarioTools() {
  const generation = ++scenarioSyncGeneration
  llmToolsStore.clearTools('webmcp')
  const registeredScenarios = scenarioRegistry.registeredScenarios.value
  if (registeredScenarios.length < 2) {
    llmToolsStore.clearTools('scenario-navigation')
    llmToolsetPromptsStore.clearToolsetPrompts('scenario-navigation')
  }

  if (registeredScenarios.length === 0)
    return

  if (registeredScenarios.length > 1) {
    const activeScenarioId = scenarioRegistry.activeScenarioId.value
    await llmToolsStore.registerTools('scenario-navigation', createScenarioNavigationTools(registeredScenarios, activeScenarioId))
    llmToolsetPromptsStore.registerToolsetPrompts('scenario-navigation', [{
      id: 'registered-kiosk-pages',
      content: createScenarioNavigationPrompt(registeredScenarios, activeScenarioId, interactiveServiceAgentInstructions.value),
    }])
  }

  if (generation !== scenarioSyncGeneration)
    return
  await llmToolsStore.registerTools('webmcp', createWebMcpTools())
}

watch([scenarioRegistry.revision, scenarioRegistry.activeScenarioId, interactiveServiceAgentInstructions, webMcpAdapter.tools], () => void syncActiveScenarioTools(), { immediate: true })

onMounted(async () => {
  await kioskRuntimeReady
  inferencePreload.triggerPreload()
})

onUnmounted(() => {
  llmToolsStore.clearTools('webmcp')
  llmToolsStore.clearTools('scenario-navigation')
  llmToolsetPromptsStore.clearToolsetPrompts('scenario-navigation')
})
</script>

<template>
  <ErrorBoundary
    title="Kiosk 畫面無法啟動。"
    @error="(error, _, info) => console.error('[stage-kiosk] render failed:', info, error)"
  >
    <RouterView />
  </ErrorBoundary>
</template>
