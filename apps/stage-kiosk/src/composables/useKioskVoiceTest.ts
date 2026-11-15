import type { Ref } from 'vue'

import { onScopeDispose, shallowRef, watch } from 'vue'

import { transcribeKioskUtterance } from '../services/kiosk-audio'
import { createSpeechPlayer } from '../services/kioskSpeech'

/** Operator-only audio lifecycle. It never enqueues customer speech or calls ordering tools. */
export function useKioskVoiceTest(io: {
  active: Readonly<Ref<boolean>>
  transcribe: (recording: Blob, signal?: AbortSignal) => Promise<{ text: string }>
  synthesize: (input: { locale: string, text: string, signal: AbortSignal }) => Promise<Blob>
  testText: () => string
  locale: () => string
  onResult: (input: { status: 'recognizing' | 'recognized' | 'failed' | 'interrupted' | 'tts', text?: string }) => void
}) {
  const speaking = shallowRef(false)
  let controller = new AbortController()
  const player = createSpeechPlayer({ synthesize: io.synthesize, onPlaying: () => speaking.value = true, onSource: () => undefined })
  function stop() {
    controller.abort()
    controller = new AbortController()
    player.stop()
    speaking.value = false
  }
  const stopWatch = watch(io.active, stop, { flush: 'sync' })
  onScopeDispose(() => {
    stopWatch()
    stop()
  })
  return {
    speaking,
    interrupt() {
      if (io.active.value && speaking.value) {
        player.stop()
        speaking.value = false
        io.onResult({ status: 'interrupted' })
      }
    },
    async transcribe(buffer: Float32Array) {
      if (!io.active.value || !buffer.length)
        return
      const signal = controller.signal
      io.onResult({ status: 'recognizing' })
      try {
        const result = await transcribeKioskUtterance(buffer, { signal, transcribe: io.transcribe })
        if (!signal.aborted && io.active.value)
          io.onResult({ status: 'recognized', text: result.text })
      }
      catch {
        if (!signal.aborted && io.active.value)
          io.onResult({ status: 'failed' })
      }
    },
    async play() {
      if (!io.active.value)
        return
      const signal = controller.signal
      io.onResult({ status: 'tts' })
      try {
        await player.play({ text: io.testText(), locale: io.locale(), signal })
      }
      catch {
        if (!signal.aborted)
          io.onResult({ status: 'failed' })
      }
      finally {
        if (!signal.aborted)
          speaking.value = false
      }
    },
  }
}
