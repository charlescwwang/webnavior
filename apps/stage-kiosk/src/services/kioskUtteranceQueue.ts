export interface KioskUtterance {
  capturedAt: number
  id: number
  recording?: Blob
  source: 'asr' | 'simulation'
  text: string
}

export interface KioskUtteranceTicket {
  isCurrent: () => boolean
}

export type KioskUtteranceReservation = {
  kind: 'ACCEPTED'
  id: number
  complete: (input: Pick<KioskUtterance, 'text' | 'recording'>) => void
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
        const utterance = await item.ready
        if (!utterance || currentGeneration !== generation) {
          activeItem = undefined
          publish()
          continue
        }
        item.utterance = utterance
        publish()
        if (now() - utterance.capturedAt > maxWaitMs) {
          options.onDrop?.(utterance, 'expired')
          activeItem = undefined
          publish()
          continue
        }
        try {
          await options.process(utterance, { isCurrent: () => currentGeneration === generation })
        }
        catch (error) {
          options.onError?.(utterance, error)
        }
        finally {
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
    let resolveReady!: (utterance?: KioskUtterance) => void
    const ready = new Promise<KioskUtterance | undefined>(resolve => resolveReady = resolve)
    let settled = false
    let readinessTimeout: ReturnType<typeof setTimeout>
    const settle = (completed?: KioskUtterance) => {
      if (settled)
        return
      settled = true
      clearTimeout(readinessTimeout)
      resolveReady(completed)
    }
    // A hung ASR request must not hold every later captured sentence forever.
    readinessTimeout = setTimeout(() => {
      if (settled)
        return
      settle()
      options.onDrop?.(utterance, 'expired')
    }, maxWaitMs)
    pending.push({ ready, settle, utterance })
    publish()
    void drain()
    return {
      kind: 'ACCEPTED',
      id: utterance.id,
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
