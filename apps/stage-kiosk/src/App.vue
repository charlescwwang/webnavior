<script setup lang="ts">
import { useInferencePreload } from '@proj-airi/stage-ui/composables'
import { useCharacterOrchestratorStore } from '@proj-airi/stage-ui/stores/character'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useLlmToolsStore } from '@proj-airi/stage-ui/stores/llm-tools'
import { useLlmToolsetPromptsStore } from '@proj-airi/stage-ui/stores/llm-toolset-prompts'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { ErrorBoundary } from '@proj-airi/ui'
import { onMounted, onUnmounted, watch } from 'vue'
import { RouterView } from 'vue-router'

import { scenarioRegistry } from './services/scenario-registry'
import { createScenarioNavigationPrompt, createScenarioNavigationTools, createScenarioTools } from './tools/scenario'

const cardStore = useAiriCardStore()
const characterOrchestratorStore = useCharacterOrchestratorStore()
const chatSessionStore = useChatSessionStore()
const displayModelsStore = useDisplayModelsStore()
const inferencePreload = useInferencePreload()
const llmToolsStore = useLlmToolsStore()
const llmToolsetPromptsStore = useLlmToolsetPromptsStore()
const settingsAudioDeviceStore = useSettingsAudioDevice()
const settingsStore = useSettings()

let scenarioSyncGeneration = 0

async function syncActiveScenarioTools() {
  const generation = ++scenarioSyncGeneration
  llmToolsStore.clearTools('scenario')
  llmToolsetPromptsStore.clearToolsetPrompts('scenario')
  const registeredScenarios = scenarioRegistry.registeredScenarios.value
  if (registeredScenarios.length === 0)
    return

  await llmToolsStore.registerTools('scenario-navigation', createScenarioNavigationTools(registeredScenarios))
  llmToolsetPromptsStore.registerToolsetPrompts('scenario-navigation', [{
    id: 'registered-kiosk-pages',
    content: createScenarioNavigationPrompt(registeredScenarios),
  }])

  try {
    const bridge = scenarioRegistry.activeBridge.value
    const manifest = await bridge?.waitForManifest()
    if (!manifest || generation !== scenarioSyncGeneration)
      return
    await llmToolsStore.registerTools('scenario', createScenarioTools(manifest))
    llmToolsetPromptsStore.registerToolsetPrompts('scenario', [{ id: manifest.id, content: manifest.agentPrompt }])
  }
  catch (error) {
    if (generation === scenarioSyncGeneration)
      console.error('[stage-kiosk] active registered scenario is unavailable:', error)
  }
}

watch(scenarioRegistry.revision, () => void syncActiveScenarioTools(), { immediate: true })

onMounted(async () => {
  await displayModelsStore.initialize()
  cardStore.initialize()
  await chatSessionStore.initialize()
  characterOrchestratorStore.initialize()
  await displayModelsStore.loadDisplayModelsFromIndexedDB()
  await settingsStore.initializeStageModel()
  await settingsAudioDeviceStore.initialize()
  inferencePreload.triggerPreload()
})

onUnmounted(() => {
  llmToolsStore.clearTools('scenario')
  llmToolsetPromptsStore.clearToolsetPrompts('scenario')
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
