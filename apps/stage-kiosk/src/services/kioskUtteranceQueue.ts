export interface KioskUtterance {
  capturedAt: number
  id: number
  recording?: Blob
  source: 'asr' | 'simulation'
  text: string
}

export interface KioskUtteranceTicket {
  isCurrent: () => boolean
  signal: AbortSignal
}

export type KioskUtteranceReservation = {
  kind: 'ACCEPTED'
  id: number
  /** Aborted on expiry/reset so unfinished ASR cannot keep uploading stale speech. */
  signal: AbortSignal
  /** Restarts the inactivity deadline only after another complete ASR chunk. */
  markTranscriptionProgress: () => void
  complete: (input: Pick<KioskUtterance, 'text' | 'recording'>) => void
  cancel: () => void
} | { kind: 'OVERLOADED' }

interface ReadyUtterance {
  utterance: KioskUtterance
  /** Queue freshness starts when the complete transcript becomes available. */
  readyAt: number
}

interface PendingUtterance {
  utterance: KioskUtterance
  ready: Promise<ReadyUtterance | undefined>
  settle: (utterance?: KioskUtterance) => void
}

/** Serializes decisions and browser mutations without waiting for Agent speech. */
export function createKioskUtteranceQueue(options: {
  maxPending?: number
  /** Maximum ASR inactivity, and maximum wait after the whole transcript is ready. @default 15000 */
  maxWaitMs?: number
  now?: () => number
  onDrop?: (utterance: KioskUtterance, reason: 'expired' | 'reset') => void
  onError?: (utterance: KioskUtterance, error: unknown) => void
  onState?: (state: { active?: KioskUtterance, pending: readonly KioskUtterance[] }) => void
  process: (utterance: KioskUtterance, ticket: KioskUtteranceTicket) => Promise<void>
}) {
  const now = options.now ?? (() => Date.now())
  const maxPending = options.maxPending ?? 4
  const maxWaitMs = options.maxWaitMs ?? 15_000
  const pending: PendingUtterance[] = []
  const idleResolvers: Array<() => void> = []
  let activeController: AbortController | undefined
  let activeItem: PendingUtterance | undefined
  let running = false
  let generation = 0
  let nextId = 0

  function publish() {
    options.onState?.({ active: activeItem?.utterance, pending: pending.map(item => item.utterance) })
  }

  async function drain() {
    if (running)
      return
    running = true
    try {
      while (pending.length > 0) {
        const item = pending.shift()!
        const currentGeneration = generation
        activeItem = item
        publish()
        const completed = await item.ready
        if (!completed || currentGeneration !== generation) {
          activeItem = undefined
          publish()
          continue
        }
        const { utterance, readyAt } = completed
        item.utterance = utterance
        publish()
        if (now() - readyAt > maxWaitMs) {
          options.onDrop?.(utterance, 'expired')
          activeItem = undefined
          publish()
          continue
        }
        try {
          const controller = new AbortController()
          activeController = controller
          await options.process(utterance, { isCurrent: () => currentGeneration === generation && !controller.signal.aborted, signal: controller.signal })
        }
        catch (error) {
          // Reset revokes this visitor’s error ownership as well as their work.
          // A late abort/rejection must never pause the next order.
          if (currentGeneration === generation)
            options.onError?.(utterance, error)
        }
        finally {
          activeController = undefined
          activeItem = undefined
          publish()
        }
      }
    }
    finally {
      running = false
      for (const resolve of idleResolvers.splice(0))
        resolve()
    }
  }

  /** Claims ordering at speech-capture time, before asynchronous ASR completes. */
  function reserve(source: KioskUtterance['source']): KioskUtteranceReservation {
    if (pending.length >= maxPending)
      return { kind: 'OVERLOADED' }
    const utterance: KioskUtterance = { capturedAt: now(), id: ++nextId, source, text: '' }
    let resolveReady!: (completed?: ReadyUtterance) => void
    const ready = new Promise<ReadyUtterance | undefined>(resolve => resolveReady = resolve)
    let settled = false
    const captureController = new AbortController()
    let readinessTimeout: ReturnType<typeof setTimeout>
    const settle = (completed?: KioskUtterance) => {
      if (settled)
        return
      settled = true
      if (!completed)
        captureController.abort()
      clearTimeout(readinessTimeout)
      resolveReady(completed ? { utterance: completed, readyAt: now() } : undefined)
    }
    // Successful chunks renew ASR inactivity, not capture order. A hung chunk
    // still releases later speech; no partial transcript can become executable.
    const markTranscriptionProgress = () => {
      if (settled)
        return
      clearTimeout(readinessTimeout)
      readinessTimeout = setTimeout(() => {
        settle()
        options.onDrop?.(utterance, 'expired')
      }, maxWaitMs)
    }
    markTranscriptionProgress()
    pending.push({ ready, settle, utterance })
    publish()
    void drain()
    return {
      kind: 'ACCEPTED',
      id: utterance.id,
      signal: captureController.signal,
      markTranscriptionProgress,
      complete: (input) => {
        const text = input.text.trim()
        settle(text ? { ...utterance, ...input, text } : undefined)
      },
      cancel: () => settle(),
    }
  }

  function submit(input: Pick<KioskUtterance, 'source' | 'text' | 'recording'>): { id: number, kind: 'ACCEPTED' } | { kind: 'EMPTY' | 'OVERLOADED' } {
    if (!input.text.trim())
      return { kind: 'EMPTY' }
    const reservation = reserve(input.source)
    if (reservation.kind === 'OVERLOADED')
      return reservation
    reservation.complete(input)
    return { id: reservation.id, kind: 'ACCEPTED' }
  }

  function reset() {
    generation++
    activeController?.abort()
    activeItem?.settle()
    for (const item of pending.splice(0)) {
      item.settle()
      options.onDrop?.(item.utterance, 'reset')
    }
    publish()
  }

  function idle() {
    return running ? new Promise<void>(resolve => idleResolvers.push(resolve)) : Promise.resolve()
  }

  return { idle, reserve, reset, submit }
}
