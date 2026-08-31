<script setup lang="ts">
import type { ChatProvider } from '@xsai-ext/providers/utils'

import InteractiveArea from '@proj-airi/stage-layouts/components/Layouts/InteractiveArea.vue'
import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { WidgetStage } from '@proj-airi/stage-ui/components/scenes'
import { useAudioRecorder } from '@proj-airi/stage-ui/composables/audio/audio-recorder'
import { useVAD } from '@proj-airi/stage-ui/stores/ai/models/vad'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useHearingSpeechInputPipeline } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { useMouse, useWindowSize } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, shallowRef, watch } from 'vue'

import OrderMenuSurface from './OrderMenuSurface.vue'

type KioskOrientation = 'landscape' | 'portrait'

const configuredOrientation = import.meta.env.VITE_KIOSK_ORIENTATION as KioskOrientation | undefined
const { width, height } = useWindowSize()
const orientation = computed<KioskOrientation>(() => configuredOrientation ?? (width.value >= height.value ? 'landscape' : 'portrait'))
const paused = shallowRef(false)

const settingsAudioDeviceStore = useSettingsAudioDevice()
const { enabled, stream } = storeToRefs(settingsAudioDeviceStore)
const { startRecord, stopRecord, onStopRecord } = useAudioRecorder(stream)
const hearingPipeline = useHearingSpeechInputPipeline()
const { transcribeForRecording } = hearingPipeline
const { supportsStreamInput } = storeToRefs(hearingPipeline)
const providersStore = useProvidersStore()
const consciousnessStore = useConsciousnessStore()
const { activeModel, activeProvider } = storeToRefs(consciousnessStore)
const chatStore = useChatOrchestratorStore()
const shouldUseStreamInput = computed(() => supportsStreamInput.value && !!stream.value)
const { x, y } = useMouse()
const cursorPosition = computed(() => ({ x: x.value, y: y.value }))

const { dispose, init, loaded, start } = useVAD(workletUrl, {
  threshold: shallowRef(0.6),
  onSpeechStart: () => {
    if (!shouldUseStreamInput.value)
      startRecord()
  },
  onSpeechEnd: () => {
    if (!shouldUseStreamInput.value)
      stopRecord()
  },
})

let stopOnStopRecord: (() => void) | undefined

async function startAudioInteraction() {
  await init()
  if (stream.value)
    await start(stream.value)

  stopOnStopRecord = onStopRecord(async (recording) => {
    const text = await transcribeForRecording(recording)
    if (!text?.trim())
      return

    const provider = await providersStore.getProviderInstance(activeProvider.value)
    if (provider && activeModel.value)
      await chatStore.ingest(text, { model: activeModel.value, chatProvider: provider as ChatProvider })
  })
}

function stopAudioInteraction() {
  stopOnStopRecord?.()
  stopOnStopRecord = undefined
  dispose()
}

watch(enabled, async (isEnabled) => {
  if (isEnabled)
    await startAudioInteraction().catch(error => console.error('Failed to start kiosk audio interaction:', error))
  else
    stopAudioInteraction()
}, { immediate: true })

watch([stream, loaded], async ([audioStream, vadLoaded]) => {
  if (enabled.value && vadLoaded && audioStream)
    await start(audioStream).catch(error => console.error('Failed to connect kiosk VAD to audio input:', error))
})

onUnmounted(stopAudioInteraction)
</script>

<template>
  <main :class="['kiosk-scene', `is-${orientation}`]">
    <section class="stage-region" aria-label="AIRI 虛擬服務員">
      <div class="stage-label">
        <span class="stage-dot" /> AIRI 餐飲服務員
      </div>
      <WidgetStage
        class="stage-model"
        :cursor-position="cursorPosition"
        :enable-orbit-controls="false"
        :paused="paused"
      />
    </section>

    <OrderMenuSurface class="menu-region" />

    <section class="conversation-region" aria-label="與 AIRI 對話">
      <InteractiveArea class="conversation" />
    </section>
  </main>
</template>

<style scoped>
.kiosk-scene { display: grid; width: 100vw; height: 100dvh; padding: 1.25rem; overflow: hidden; background: radial-gradient(circle at top left, #154d56, transparent 45%), #101719; gap: 1rem; }
.kiosk-scene.is-landscape { grid-template-columns: minmax(14rem, .24fr) minmax(0, .76fr); grid-template-rows: minmax(0, .31fr) minmax(0, .69fr); }
.kiosk-scene.is-portrait { grid-template-columns: minmax(10rem, .3fr) minmax(0, .7fr); grid-template-rows: minmax(0, .35fr) minmax(0, .65fr); }
.stage-region { position: relative; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid rgb(255 255 255 / 18%); border-radius: 1.5rem; background: rgb(4 19 22 / 74%); grid-column: 1; grid-row: 1; }
.stage-model { width: 100%; height: 100%; }
.stage-label { position: absolute; z-index: 2; top: 1rem; left: 1rem; display: flex; align-items: center; gap: .5rem; padding: .55rem .75rem; border-radius: 99rem; background: rgb(1 17 20 / 58%); color: #d9faf6; font-size: .85rem; font-weight: 800; }
.stage-dot { width: .5rem; height: .5rem; border-radius: 999px; background: #56dec5; box-shadow: 0 0 0 .32rem rgb(86 222 197 / 20%); }
.conversation-region { min-width: 0; min-height: 0; overflow: hidden; border: 1px solid rgb(255 255 255 / 14%); border-radius: 1.5rem; background: rgb(5 25 29 / 72%); grid-column: 2; grid-row: 1; }
.conversation { width: 100%; height: 100%; }
.menu-region { min-width: 0; min-height: 0; grid-column: 1 / span 2; grid-row: 2; }

@media (max-width: 700px) {
  .kiosk-scene { padding: .6rem; gap: .6rem; }
  .kiosk-scene.is-landscape { grid-template-columns: minmax(7rem, .25fr) minmax(0, .75fr); }
  .stage-label { top: .55rem; left: .55rem; font-size: .72rem; }
}
</style>
