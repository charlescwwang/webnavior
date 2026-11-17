import type { SpeechRecognitionPolicy } from '@proj-airi/stage-shared/falcon-settings'
import type { MaybeRefOrGetter } from 'vue'

import type { KioskUtterance } from '../services/kioskUtteranceQueue'

import { onMounted, onScopeDispose, readonly, shallowRef, toValue, watch } from 'vue'

import { playKioskAudio } from '../services/kioskPlayback'

/** Owns receipt-then-waiting feedback; cancelling audio never cancels order work. */
export function useKioskProcessingCue(processing: MaybeRefOrGetter<boolean>, blocked: MaybeRefOrGetter<boolean>, speaking: MaybeRefOrGetter<boolean>, pendingInput: MaybeRefOrGetter<boolean>) {
  const ready = shallowRef(false)
  const lifetime = new AbortController()
  let chime: Blob | undefined
  let music: Blob | undefined
  let playback: AbortController | undefined
  // Correlate early service progress and the final decision to one receipt per
  // legacy utterance. This set belongs to the reception, not the playback window.
  const acknowledgedLegacyUtterances = new Set<KioskUtterance['id']>()
  let received = 0
  let replyReceived = 0
  // ASR, Jev, Main and TTS preparation share one feedback window. A short
  // handoff gap is not a new customer request and must not recreate its player.
  let processingWindow = false
  let acknowledgementPending = false
  let playingKind: 'receipt' | 'waiting' | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined

  function stop() {
    playback?.abort()
    playback = undefined
    playingKind = undefined
  }

  function finishWindow() {
    clearTimeout(closeTimer)
    closeTimer = undefined
    processingWindow = false
    acknowledgementPending = false
    stop()
  }

  function update() {
    const active = toValue(processing) || toValue(speaking)
    if (!active) {
      closeTimer ??= setTimeout(() => {
        closeTimer = undefined
        if (toValue(processing) || toValue(speaking))
          return
        finishWindow()
      }, 200)
      if (toValue(blocked))
        stop()
      return
    }
    clearTimeout(closeTimer)
    closeTimer = undefined
    // Work flags describe progress, not evidence that a visitor spoke.
    // Only acknowledge() can open a customer-input feedback window.
    if (!processingWindow) {
      stop()
      return
    }
    if (!ready.value || !chime || toValue(blocked)) {
      stop()
      return
    }
    // Native speech owns audible output. Work can remain active while TTS
    // plays, so processing alone must not restart waiting music underneath it.
    if (toValue(speaking)) {
      stop()
      return
    }
    const kind = acknowledgementPending ? 'receipt' : 'waiting'
    const audio = kind === 'receipt' ? chime : music
    if (!audio) {
      stop()
      return
    }
    const volume = kind === 'receipt' ? 0.4 : 0.30
    if (playback && playingKind === kind)
      return
    stop()
    const controller = new AbortController()
    playback = controller
    playingKind = kind
    const audioPlayback = playKioskAudio(audio, controller.signal, undefined, {
      loop: kind === 'waiting',
      volume,
    })
    void audioPlayback.finished.then(() => {
      if (playback !== controller || controller.signal.aborted)
        return
      playback = undefined
      playingKind = undefined
      if (kind === 'receipt') {
        acknowledgementPending = false
        update()
      }
      // Failed music waits for a real state change; do not retry in a loop.
    })
  }

  async function readAudio(file: string) {
    const response = await fetch(`${import.meta.env.BASE_URL}audio/${file}`, { signal: lifetime.signal, cache: 'no-cache' })
    if (!response.ok)
      return undefined
    const audio = await response.blob()
    // These assets are WAV, but production serves them as octet-stream.
    // Check their RIFF/WAVE bytes before assigning the playback MIME; this also
    // rejects index.html returned by a missing-file rewrite without trusting headers.
    const header = new Uint8Array(await audio.slice(0, 12).arrayBuffer())
    const text = new TextDecoder()
    if (text.decode(header.slice(0, 4)) !== 'RIFF' || text.decode(header.slice(8, 12)) !== 'WAVE')
      return undefined
    return audio.slice(0, audio.size, 'audio/wav')
  }

  // Admitted captured speech or submitted text opens feedback. Audible TTS stops its player
  // synchronously; reply completion closes the customer-input window.
  // A later capture or queued text belongs to the next reply and must survive
  // completion/cancellation of the earlier TTS.
  watch(() => toValue(speaking), (active, previous) => {
    if (active) {
      replyReceived = received
      // A reply supersedes its acknowledgement, even if the short receipt
      // has not finished. Never replay that stale receipt after an interruption.
      acknowledgementPending = false
      stop()
    }
    else if (previous && received === replyReceived && !toValue(pendingInput)) {
      finishWindow()
    }
  }, { flush: 'sync' })
  watch(() => toValue(blocked), (active) => {
    if (active)
      finishWindow()
  }, { flush: 'sync' })

  watch([() => toValue(processing), () => toValue(blocked), () => toValue(speaking), ready], update, { flush: 'sync' })
  onMounted(async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}audio/processing.json`, { signal: lifetime.signal, cache: 'no-cache' })
      if (!response.ok || (await response.json()).enabled !== true)
        return
      const [receipt, waiting] = await Promise.allSettled([
        readAudio('kiosk_acknowledged_chime.wav'),
        readAudio('kiosk_hold_melodic_light_60s.wav'),
      ])
      if (!lifetime.signal.aborted && receipt.status === 'fulfilled' && receipt.value) {
        chime = receipt.value
        // Waiting music is optional; losing it must not silence receipt tones.
        music = waiting.status === 'fulfilled' ? waiting.value : undefined
        ready.value = true
      }
    }
    catch {
      // Optional feedback cannot disable ordering or ordinary reply synthesis.
    }
  })
  onScopeDispose(() => {
    lifetime.abort()
    finishWindow()
  })

  return {
    ready: readonly(ready),
    stop,
    /** Ends feedback ownership when a reception is cancelled or reset. */
    reset() {
      acknowledgedLegacyUtterances.clear()
      finishWindow()
    },
    /** Legacy voice stays silent until service admission; other input keeps immediate feedback. */
    acknowledge(voice?: { utteranceId: KioskUtterance['id'], recognitionMode: SpeechRecognitionPolicy['mode'], stage: 'capture' | 'service' }) {
      if (voice?.recognitionMode === 'legacy') {
        // A capture can produce empty ASR or a later IGNORE decision. Neither
        // establishes customer intent and neither should disturb the visitor.
        if (voice.stage !== 'service' || acknowledgedLegacyUtterances.has(voice.utteranceId))
          return
        acknowledgedLegacyUtterances.add(voice.utteranceId)
      }
      received += 1
      // Called after legacy service admission, Falcon capture or accepted text.
      // Every newly accepted utterance gets a receipt, including while earlier
      // work is pending. TTS still owns audible output; update defers its chime.
      processingWindow = true
      acknowledgementPending = true
      update()
    },
  }
}
