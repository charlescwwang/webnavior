import type { synthesizeKioskSpeech } from '../services/kiosk-device'
import type { KioskInteractionTurn } from './useKioskInteractionTurn'

import { useTimeoutFn } from '@vueuse/core'
import { onScopeDispose } from 'vue'

interface WaitSpeechOptions {
  synthesize: typeof synthesizeKioskSpeech
  play: (audio: Blob, turn: KioskInteractionTurn, signal: AbortSignal) => Promise<void>
}

/**
 * One optional acknowledgement per admitted Agent turn. Synthesis starts in
 * parallel with model work; playback waits one second to avoid speaking over
 * quick results. Cancelling this output never cancels its parent order task.
 */
export function useKioskWaitSpeech(options: WaitSpeechOptions) {
  let active: {
    audio?: Blob
    controller: AbortController
    elapsed: boolean
    playing: boolean
    removeAbortListener: () => void
    turn: KioskInteractionTurn
  } | undefined
  let lastTurnId: number | undefined

  const { start: startDelay, stop: stopDelay } = useTimeoutFn(() => {
    if (!active)
      return
    active.elapsed = true
    void playReady(active)
  }, 1_000, { immediate: false })

  function finish(turnId = active?.turn.id) {
    if (!active || active.turn.id !== turnId)
      return
    const previous = active
    active = undefined
    stopDelay()
    previous.removeAbortListener()
    previous.controller.abort()
  }

  async function playReady(request: NonNullable<typeof active>) {
    if (active !== request || !request.elapsed || !request.audio || request.playing || request.controller.signal.aborted)
      return
    request.playing = true
    try {
      await options.play(request.audio, request.turn, request.controller.signal)
    }
    catch {
      // Optional audio cannot fail, restart or complete the actual order task.
    }
    finally {
      if (active === request)
        finish(request.turn.id)
    }
  }

  function start(turn: KioskInteractionTurn, text: string, locale: string) {
    if (turn.signal.aborted || lastTurnId === turn.id)
      return
    finish()
    lastTurnId = turn.id
    const abort = () => finish(turn.id)
    const request = {
      audio: undefined as Blob | undefined,
      controller: new AbortController(),
      elapsed: false,
      playing: false,
      removeAbortListener: () => turn.signal.removeEventListener('abort', abort),
      turn,
    }
    active = request
    turn.signal.addEventListener('abort', abort, { once: true })
    startDelay()
    // Deliberately not awaited by the Agent. Text progress remains available
    // when speech is disabled, fails, or arrives after the final result.
    void options.synthesize({ locale, text, signal: request.controller.signal }).then((audio) => {
      if (active !== request || request.controller.signal.aborted)
        return
      request.audio = audio
      void playReady(request)
    }).catch(() => {
      if (active === request)
        finish(turn.id)
    })
  }

  onScopeDispose(() => finish())
  return { start, finish }
}
