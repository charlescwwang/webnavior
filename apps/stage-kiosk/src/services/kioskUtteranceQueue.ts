export interface KioskUtterance {
  capturedAt: number
  id: number
  recording?: Blob
  recognitionMode?: 'legacy'
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
  /** Aborted on an explicit transcription deadline or reception reset. */
  signal: AbortSignal
  /** Restarts the inactivity deadline only after another complete ASR chunk. */
  markTranscriptionProgress: () => void
  complete: (input: Pick<KioskUtterance, 'text' | 'recording' | 'recognitionMode'>) => void
  cancel: () => void
} | { kind: 'OVERLOADED' }

interface PendingUtterance {
  utterance: KioskUtterance
  ready: Promise<KioskUtterance | undefined>
  settle: (utterance?: KioskUtterance) => void
}

/** Serializes decisions and browser mutations without waiting for Agent speech. */
export function createKioskUtteranceQueue(options: {
  maxPending?: number
  now?: () => number
  onReady?: (utterance: KioskUtterance) => void
  onDrop?: (utterance: KioskUtterance, reason: 'expired' | 'reset') => void
  onError?: (utterance: KioskUtterance, error: unknown) => void
  onState?: (state: { active?: KioskUtterance, pending: readonly KioskUtterance[] }) => void
  process: (utterance: KioskUtterance, ticket: KioskUtteranceTicket) => Promise<void>
}) {
  const now = options.now ?? (() => Date.now())
  const maxPending = options.maxPending ?? 4
  const pending: PendingUtterance[] = []
  const idleResolvers: Array<() => void> = []
  let activeController: AbortController | undefined
  let activeItem: PendingUtterance | undefined
  let activeRun: { generation: number } | undefined
  let generation = 0
  let nextId = 0

  function publish() {
    options.onState?.({ active: activeItem?.utterance, pending: pending.map(item => item.utterance) })
  }

  async function drain() {
    if (activeRun)
      return
    const run = { generation }
    activeRun = run
    try {
      while (pending.length > 0) {
        if (activeRun !== run)
          return
        const item = pending.shift()!
        const currentGeneration = run.generation
        activeItem = item
        publish()
        const utterance = await item.ready
        if (activeRun !== run)
          return
        if (!utterance || currentGeneration !== generation) {
          activeItem = undefined
          publish()
          continue
        }
        item.utterance = utterance
        publish()
        // Accepted sentences belong to this reception, regardless of an earlier
        // ASR/Agent's latency. Only reset revokes their FIFO ownership; replaying
        // each against fresh cart/question state remains the processor's job.
        try {
          const controller = new AbortController()
          activeController = controller
          await options.process(utterance, { isCurrent: () => currentGeneration === generation && !controller.signal.aborted, signal: controller.signal })
        }
        catch (error) {
          if (activeRun === run)
            options.onError?.(utterance, error)
        }
        finally {
          // Old providers may ignore abort. Their cleanup must not clear the
          // next reception's active request or its visual progress.
          if (activeRun === run) {
            activeController = undefined
            activeItem = undefined
            publish()
          }
        }
      }
    }
    finally {
      if (activeRun === run) {
        activeRun = undefined
        for (const resolve of idleResolvers.splice(0))
          resolve()
      }
    }
  }

  /** Claims ordering at speech-capture time, before asynchronous ASR completes. */
  function reserve(source: KioskUtterance['source'], transcriptionTimeoutMs?: number): KioskUtteranceReservation {
    if (pending.length >= maxPending)
      return { kind: 'OVERLOADED' }
    const utterance: KioskUtterance = { capturedAt: now(), id: ++nextId, source, text: '' }
    let resolveReady!: (completed?: KioskUtterance) => void
    const ready = new Promise<KioskUtterance | undefined>(resolve => resolveReady = resolve)
    let settled = false
    const captureController = new AbortController()
    let readinessTimeout: ReturnType<typeof setTimeout> | undefined
    const settle = (completed?: KioskUtterance) => {
      if (settled)
        return
      settled = true
      if (!completed)
        captureController.abort()
      clearTimeout(readinessTimeout)
      resolveReady(completed)
    }
    // The network/provider owns ordinary ASR failure and cancellation. Only an
    // explicitly supplied provider deadline adds a queue watchdog; it never
    // expires a completed transcript waiting behind another operation.
    const markTranscriptionProgress = () => {
      if (settled || transcriptionTimeoutMs === undefined)
        return
      clearTimeout(readinessTimeout)
      readinessTimeout = setTimeout(() => {
        settle()
        options.onDrop?.(utterance, 'expired')
      }, transcriptionTimeoutMs)
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
        if (settled)
          return
        const text = input.text.trim()
        if (text)
          options.onReady?.({ ...utterance, ...input, text })
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
    // Detach canceled decision work so the next reception can start at once.
    // Dispatched browser writes remain serialized by their own document queue.
    activeRun = undefined
    activeController = undefined
    activeItem = undefined
    for (const resolve of idleResolvers.splice(0))
      resolve()
    for (const item of pending.splice(0)) {
      item.settle()
      options.onDrop?.(item.utterance, 'reset')
    }
    publish()
  }

  function idle() {
    return activeRun ? new Promise<void>(resolve => idleResolvers.push(resolve)) : Promise.resolve()
  }

  return { idle, reserve, reset, submit }
}
