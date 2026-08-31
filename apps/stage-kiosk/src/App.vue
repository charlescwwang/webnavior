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
import { onMounted, onUnmounted } from 'vue'

import KioskScene from './components/KioskScene.vue'

import { createOrderMenuTools, orderMenuToolsetPrompt } from './tools/order-menu'

const cardStore = useAiriCardStore()
const characterOrchestratorStore = useCharacterOrchestratorStore()
const chatSessionStore = useChatSessionStore()
const displayModelsStore = useDisplayModelsStore()
const inferencePreload = useInferencePreload()
const llmToolsStore = useLlmToolsStore()
const llmToolsetPromptsStore = useLlmToolsetPromptsStore()
const settingsAudioDeviceStore = useSettingsAudioDevice()
const settingsStore = useSettings()

onMounted(async () => {
  await llmToolsStore.registerTools('order-menu', await createOrderMenuTools())
  llmToolsetPromptsStore.registerToolsetPrompts('order-menu', [{ id: 'order-menu', content: orderMenuToolsetPrompt }])

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
  llmToolsStore.clearTools('order-menu')
  llmToolsetPromptsStore.clearToolsetPrompts('order-menu')
})
</script>

<template>
  <ErrorBoundary
    title="Kiosk 畫面無法啟動。"
    @error="(error, _, info) => console.error('[stage-kiosk] render failed:', info, error)"
  >
    <KioskScene />
  </ErrorBoundary>
</template>
