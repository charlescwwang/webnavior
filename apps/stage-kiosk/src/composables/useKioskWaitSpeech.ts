import type { synthesizeKioskSpeech } from '../services/kiosk-device'
import type { KioskInteractionTurn } from './useKioskInteractionTurn'

import { useTimeoutFn } from '@vueuse/core'
import { onScopeDispose } from 'vue'

interface WaitSpeechOptions {
  synthesize: typeof synthesizeKioskSpeech
  play: (audio: Blob, turn: KioskInteractionTurn, signal: AbortSignal) => Promise<void>
}

/** One input's fixed-text preparation; claiming transfers cancellation to its service turn. */
export interface PreparedWaitSpeech {
  readonly text: string
  readonly locale: string
  readonly ready: Promise<boolean>
  claim: (signal: AbortSignal) => Promise<Blob | undefined>
  /** Releases only unclaimed preparation; it cannot cancel an adopted order turn. */
  dispose: () => void
}

/**
 * One acknowledgement per admitted service turn, shared across Jev/Main.
 * Receipt audio plays when ready; ordinary waiting audio retains its one-second
 * grace period. Cancelling this output never cancels its parent order task.
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
  const preparations = new Set<() => void>()

  function prepare(text: string, locale: string): PreparedWaitSpeech {
    const controller = new AbortController()
    let claimed = false
    const pending = options.synthesize({ text, locale, signal: controller.signal }).then(audio => controller.signal.aborted ? undefined : audio, () => undefined)
    const dispose = () => {
      if (!claimed)
        controller.abort()
      preparations.delete(dispose)
    }
    preparations.add(dispose)
    return {
      text,
      locale,
      ready: pending.then(audio => Boolean(audio)),
      claim(signal) {
        if (claimed || controller.signal.aborted || signal.aborted)
          return Promise.resolve(undefined)
        claimed = true
        preparations.delete(dispose)
        const abort = () => controller.abort()
        signal.addEventListener('abort', abort, { once: true })
        return pending.finally(() => signal.removeEventListener('abort', abort))
      },
      dispose,
    }
  }

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

  function start(turn: KioskInteractionTurn, text: string, locale: string, mode: 'receipt' | 'waiting' = 'waiting', prepared?: PreparedWaitSpeech) {
    if (turn.signal.aborted || lastTurnId === turn.id)
      return
    finish()
    lastTurnId = turn.id
    const abort = () => finish(turn.id)
    const request = {
      audio: undefined as Blob | undefined,
      controller: new AbortController(),
      elapsed: mode === 'receipt',
      playing: false,
      removeAbortListener: () => turn.signal.removeEventListener('abort', abort),
      turn,
    }
    active = request
    turn.signal.addEventListener('abort', abort, { once: true })
    if (!request.elapsed)
      startDelay()
    // Deliberately not awaited by the Agent. Text progress remains available
    // when speech is disabled, fails, or arrives after the final result.
    // A locale/text change while deciding invalidates the preparation. Its
    // audio is input-local and never reused for a different customer request.
    const matches = prepared?.text === text && prepared.locale === locale
    if (prepared && !matches)
      prepared.dispose()
    const pending = matches ? prepared.claim(request.controller.signal) : options.synthesize({ locale, text, signal: request.controller.signal })
    void pending.then((audio) => {
      if (active !== request || request.controller.signal.aborted || !audio)
        return
      request.audio = audio
      void playReady(request)
    }).catch(() => {
      if (active === request)
        finish(turn.id)
    })
  }

  onScopeDispose(() => {
    finish()
    for (const dispose of preparations)
      dispose()
  })
  return { prepare, start, finish }
}
