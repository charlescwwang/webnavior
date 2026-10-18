import type { KioskConversationDecisionState } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'
import type { GreetingPhase } from '../../../server/src/services/domain/kiosk/interactionContracts'

/** Unresolved questions and transaction pages always take precedence over a welcome. */
export function greetingPhase(state: Pick<KioskConversationDecisionState, 'phase' | 'waitingFor'> | undefined): GreetingPhase | undefined {
  if (state?.waitingFor)
    return undefined
  return state?.phase === 'customer_entry' || state?.phase === 'ordering' ? state.phase : undefined
}

interface GreetingConfiguration {
  entryHint: string
  locale: string
  openings: readonly string[]
}

/**
 * Owns one scene's bounded welcome-audio bank. Preparation and playback share
 * in-flight synthesis; visitor cancellation does not evict reusable audio.
 * Reconfiguration/disposal aborts the old bank and prevents stale warmup work.
 * Audio is memory-only; reload after a Server-side TTS voice/model change.
 */
export function createFixedGreetings(synthesize: (input: { locale: string, signal: AbortSignal, text: string }) => Promise<Blob>) {
  let configuration: GreetingConfiguration | undefined
  let configurationKey: string | undefined
  let controller = new AbortController()
  let audio = new Map<string, Promise<Blob>>()
  let index = 0
  let disposed = false

  function speech(text: string) {
    const cached = audio.get(text)
    if (cached)
      return cached
    if (!configuration || disposed)
      throw new Error('Welcome audio is not configured')

    const bank = audio
    const pending = synthesize({ locale: configuration.locale, signal: controller.signal, text }).catch((error) => {
      // A transient warmup failure must be retryable when a visitor arrives.
      if (bank.get(text) === pending)
        bank.delete(text)
      throw error
    })
    bank.set(text, pending)
    return pending
  }

  async function prepare(next: GreetingConfiguration | undefined) {
    if (disposed)
      return
    if (!next) {
      controller.abort()
      audio.clear()
      configuration = undefined
      configurationKey = undefined
      index = 0
      return
    }
    const key = JSON.stringify(next)
    if (configurationKey === key)
      return
    controller.abort()
    controller = new AbortController()
    const signal = controller.signal
    configuration = { ...next, openings: [...next.openings] }
    configurationKey = key
    audio = new Map()
    index = 0

    // Entry is the initial owned-menu screen. Warm it first, sequentially,
    // so background preparation does not flood the speech provider.
    const texts = [...next.openings.map(opening => `${opening}${next.entryHint}`), ...next.openings]
    for (const text of texts) {
      if (signal.aborted)
        return
      try {
        await speech(text)
      }
      catch {
        // Warmup is optional: the next actual welcome retries missing audio.
        // Never fall back to live LLM/VLM generation on this low-latency path.
      }
    }
  }

  async function next(phase: GreetingPhase) {
    if (!configuration?.openings.length || disposed)
      throw new Error('Welcome phrases are not configured')
    const opening = configuration.openings[index]
    index = (index + 1) % configuration.openings.length
    const text = phase === 'customer_entry' ? `${opening}${configuration.entryHint}` : opening
    return { audio: await speech(text), text }
  }

  function dispose() {
    disposed = true
    controller.abort()
    audio.clear()
  }

  return { dispose, next, prepare }
}
