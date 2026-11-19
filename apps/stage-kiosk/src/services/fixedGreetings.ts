import type { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'

import type { KioskConversationDecisionState } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'
import type { GreetingPhase } from '../../../server/src/services/domain/kiosk/interactionContracts'

import { boolean, literal, looseObject, optional, picklist, safeParse } from 'valibot'

import { conversationDecisionStateFrom } from './kiosk-fast-path'

const browserWelcomeSchema = looseObject({
  ok: literal(true),
  source: literal('browser'),
  page: picklist(['table', 'menu']),
  code: optional(literal('table-selection-required')),
  menuReady: optional(boolean()),
  itemSelectionOpen: optional(boolean()),
})

/** Reads the current service without creating an ordering task or consuming a question. */
export async function readGreetingPhase(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>, hasPendingQuestion: () => boolean, kind: 'greeting' | 'reminder' = 'greeting'): Promise<GreetingPhase | undefined> {
  if (hasPendingQuestion())
    return undefined
  // PB publishes browser_cart_get, while the owned Menu publishes its state
  // tool. Select by capability; absence of the owned tool is not an idle PB.
  const browserTool = client.tools.value.find(tool => tool.name === 'browser_cart_get')
  if (browserTool) {
    const observed = safeParse(browserWelcomeSchema, await client.execute(browserTool, { includeCatalog: false }))
    if (hasPendingQuestion() || !observed.success)
      return undefined
    const page = observed.output
    // PB's table entry is not the owned Menu's optional-phone entry. Use the
    // configured opening without appending the owned phone instructions.
    if (kind === 'greeting' && page.page === 'table' && page.code === 'table-selection-required')
      return 'ordering'
    if (page.page === 'menu' && page.menuReady === true && page.itemSelectionOpen === false)
      return 'ordering'
    return undefined
  }
  const stateTool = client.tools.value.find(tool => tool.name === 'kiosk_interaction_state')
  if (!stateTool)
    return undefined
  const state = conversationDecisionStateFrom(await client.execute(stateTool, {}))
  return hasPendingQuestion() ? undefined : greetingPhase(state)
}

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

interface GreetingAttempt {
  id: number
  reception: number
}

/**
 * Tracks delivery for one reception, independently of its active/standby state.
 * A failed welcome can retry twice within 20 seconds, at least 1.5 seconds apart.
 * Customer activity/reset closes the budget; stale completions cannot reopen it.
 */
export function createGreetingDelivery() {
  let nextId = 0
  let state: { reception: number, startedAtMs: number, attempts: number, nextAtMs: number, closed: boolean, pending?: GreetingAttempt } | undefined
  function eligible(reception: number, nowMs: number) {
    return state?.reception === reception && !state.closed && !state.pending && state.attempts < 3
      && nowMs >= state.nextAtMs && nowMs - state.startedAtMs <= 20_000
  }
  return {
    canRetry(reception: number, nowMs: number) {
      return Boolean(state?.attempts && eligible(reception, nowMs))
    },
    claim(reception: number, nowMs: number): GreetingAttempt | undefined {
      if (!state || state.reception !== reception)
        state = { reception, startedAtMs: nowMs, attempts: 0, nextAtMs: nowMs, closed: false }
      if (!eligible(reception, nowMs))
        return
      const attempt = { id: ++nextId, reception }
      state.pending = attempt
      state.attempts++
      return attempt
    },
    finish(attempt: GreetingAttempt, outcome: 'delivered' | 'retry' | 'closed', nowMs: number) {
      if (state?.pending !== attempt)
        return
      state.pending = undefined
      state.closed ||= outcome !== 'retry'
      state.nextAtMs = nowMs + 1500
    },
    cancel() {
      if (state)
        state.closed = true
    },
  }
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

  async function next(phase: GreetingPhase, signal?: AbortSignal) {
    if (!configuration?.openings.length || disposed)
      throw new Error('Welcome phrases are not configured')
    const opening = configuration.openings[index]
    index = (index + 1) % configuration.openings.length
    const text = phase === 'customer_entry' ? `${opening}${configuration.entryHint}` : opening
    signal?.throwIfAborted()
    const pending = speech(text)
    if (!signal)
      return { audio: await pending, text }
    // A visitor owns this wait, not the shared synthesis cache. Release its
    // turn promptly on cancellation while keeping late audio reusable.
    let abort: () => void = () => {}
    try {
      const audio = await new Promise<Blob>((resolve, reject) => {
        abort = () => reject(signal.reason)
        if (signal.aborted)
          abort()
        else
          signal.addEventListener('abort', abort, { once: true })
        void pending.then(resolve, reject)
      })
      return { audio, text }
    }
    finally {
      signal.removeEventListener('abort', abort)
    }
  }

  function dispose() {
    disposed = true
    controller.abort()
    audio.clear()
  }

  return { dispose, next, prepare }
}
