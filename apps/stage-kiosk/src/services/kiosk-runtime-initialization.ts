import { useCharacterOrchestratorStore } from '@proj-airi/stage-ui/stores/character'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useSettings } from '@proj-airi/stage-ui/stores/settings'

let initialization: Promise<void> | undefined

/**
 * Initializes the locally persisted model stores that a published Kiosk
 * profile can target. The promise is shared by the root app and routed pages,
 * so a Server-provided avatar cannot be imported before its preview handlers
 * and IndexedDB catalogue are ready.
 */
export function initializeKioskRuntime() {
  initialization ??= (async () => {
    const cardStore = useAiriCardStore()
    const characterOrchestratorStore = useCharacterOrchestratorStore()
    const chatSessionStore = useChatSessionStore()
    const displayModelsStore = useDisplayModelsStore()
    const settingsStore = useSettings()

    await displayModelsStore.initialize()
    cardStore.initialize()
    await chatSessionStore.initialize()
    characterOrchestratorStore.initialize()
    await displayModelsStore.loadDisplayModelsFromIndexedDB()
    await settingsStore.initializeStageModel()
    // Capture starts only in the Scene after an explicit persisted microphone
    // choice. Shared initialization can silently acquire a browser-default input.
  })()

  return initialization
}

/** Waits until Kiosk's local model runtime can safely accept a Server avatar. */
export function waitForKioskRuntime() {
  return initializeKioskRuntime()
}
