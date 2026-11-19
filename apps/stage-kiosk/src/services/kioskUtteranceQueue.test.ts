import { describe, expect, it, vi } from 'vitest'

import { createKioskUtteranceQueue } from './kioskUtteranceQueue'

it('allows a server-bounded Falcon transcription to finish after the legacy deadline and submits its text once', async () => {
  vi.useFakeTimers()
  try {
    const handled: string[] = []
    const queue = createKioskUtteranceQueue({ process: async (utterance) => {
      handled.push(utterance.text)
    } })
    const reservation = queue.reserve('asr', 60000)
    if (reservation.kind !== 'ACCEPTED')
      throw new Error('Expected capture to be reserved.')
    await vi.advanceTimersByTimeAsync(20000)
    expect(reservation.signal.aborted).toBe(false)
    reservation.complete({ text: '水餃一份', recognitionMode: 'falcon' })
    reservation.complete({ text: '重複回應', recognitionMode: 'falcon' })
    await queue.idle()
    expect(handled).toEqual(['水餃一份'])
  }
  finally { vi.useRealTimers() }
})

describe('kiosk utterance queue', () => {
  it('processes later ASR results after an earlier handler rejects with an HTTP 500 error', async () => {
    const failure = new Error('HTTP 500')
    const onError = vi.fn()
    const process = vi.fn(async (utterance) => {
      if (utterance.text === '第一句')
        throw failure
    })
    const queue = createKioskUtteranceQueue({ onError, process })
    queue.submit({ source: 'asr', text: '第一句' })
    queue.submit({ source: 'asr', text: '我要水餃' })
    await queue.idle()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ text: '第一句' }), failure)
    expect(process).toHaveBeenCalledTimes(2)
    expect(process).toHaveBeenNthCalledWith(2, expect.objectContaining({ text: '我要水餃' }), expect.any(Object))
    queue.submit({ source: 'asr', text: '有便當嗎' })
    await queue.idle()
    expect(process).toHaveBeenCalledTimes(3)
  })
  it('keeps completed ASR segments separate and processes them in arrival order', async () => {
    let releaseFirst: (() => void) | undefined
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const handled: string[] = []
    const queue = createKioskUtteranceQueue({ process: async (utterance) => {
      handled.push(utterance.text)
      if (utterance.text === '背景聲音')
        await first
    } })

    expect(queue.submit({ source: 'simulation', text: '背景聲音' }).kind).toBe('ACCEPTED')
    expect(queue.submit({ source: 'simulation', text: '三份水餃' }).kind).toBe('ACCEPTED')
    await Promise.resolve()
    expect(handled).toEqual(['背景聲音'])
    releaseFirst?.()
    await queue.idle()
    expect(handled).toEqual(['背景聲音', '三份水餃'])
  })

  it('preserves capture order when the second ASR result arrives first', async () => {
    const handled: string[] = []
    const queue = createKioskUtteranceQueue({ process: async (utterance) => {
      handled.push(utterance.text)
    } })
    const first = queue.reserve('asr')
    const second = queue.reserve('asr')
    expect(first.kind).toBe('ACCEPTED')
    expect(second.kind).toBe('ACCEPTED')
    if (first.kind !== 'ACCEPTED' || second.kind !== 'ACCEPTED')
      throw new Error('Expected both speech segments to be reserved.')

    second.complete({ text: '改成三份' })
    await Promise.resolve()
    expect(handled).toEqual([])
    first.complete({ text: '我要水餃' })
    await queue.idle()
    expect(handled).toEqual(['我要水餃', '改成三份'])
  })

  it('continues after an earlier ASR segment is unrecognized', async () => {
    const handled: string[] = []
    const queue = createKioskUtteranceQueue({ process: async (utterance) => {
      handled.push(utterance.text)
    } })
    const first = queue.reserve('asr')
    expect(first.kind).toBe('ACCEPTED')
    queue.submit({ source: 'asr', text: '我要水餃' })
    if (first.kind !== 'ACCEPTED')
      throw new Error('Expected speech capture to be reserved.')
    first.cancel()
    await queue.idle()
    expect(handled).toEqual(['我要水餃'])
  })

  it('releases later utterances if an earlier ASR request never returns', async () => {
    vi.useFakeTimers()
    try {
      const handled: string[] = []
      const dropped: string[] = []
      const queue = createKioskUtteranceQueue({
        onDrop: (utterance) => { dropped.push(utterance.source) },
        process: async (utterance) => { handled.push(utterance.text) },
      })
      const stalled = queue.reserve('asr', 100)
      expect(stalled.kind).toBe('ACCEPTED')
      await vi.advanceTimersByTimeAsync(50)
      queue.submit({ source: 'simulation', text: '我要水餃' })
      await vi.advanceTimersByTimeAsync(51)
      await queue.idle()
      expect(dropped).toEqual(['asr'])
      expect(handled).toEqual(['我要水餃'])
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('reports overload instead of silently dropping a new complete utterance', async () => {
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const process = vi.fn(async () => {
      await pending
    })
    const queue = createKioskUtteranceQueue({ maxPending: 1, process })

    expect(queue.submit({ source: 'asr', text: '第一句' }).kind).toBe('ACCEPTED')
    expect(queue.submit({ source: 'asr', text: '第二句' }).kind).toBe('ACCEPTED')
    expect(queue.submit({ source: 'asr', text: '第三句' })).toEqual({ kind: 'OVERLOADED' })
    release?.()
    await queue.idle()
    expect(process).toHaveBeenCalledTimes(2)
  })

  // Report: this chat, Nov19 — a slow operation discarded the speaker's next sentence after 15 seconds.
  it('keeps complete transcripts in order while an earlier operation takes longer than 15 seconds', async () => {
    vi.useFakeTimers()
    try {
      let finish!: () => void
      const onDrop = vi.fn()
      const process = vi.fn(async (utterance) => {
        if (utterance.text === '正在操作的一句')
          await new Promise<void>(resolve => finish = resolve)
      })
      const queue = createKioskUtteranceQueue({ process, onDrop })
      queue.submit({ source: 'simulation', text: '正在操作的一句' })
      await Promise.resolve()
      queue.submit({ source: 'asr', text: '等待的一句' })
      queue.submit({ source: 'asr', text: '再補充的一句' })
      await vi.advanceTimersByTimeAsync(60_000)
      finish()
      await queue.idle()
      expect(process.mock.calls.map(([utterance]) => utterance.text)).toEqual(['正在操作的一句', '等待的一句', '再補充的一句'])
      expect(onDrop).not.toHaveBeenCalled()
    }
    finally {
      vi.useRealTimers()
    }
  })

  // Report: this chat, Nov19 — queue timers must not cancel an otherwise active ASR request at 15 seconds.
  it('lets the transcription request own its deadline instead of cancelling it at 15 seconds', async () => {
    vi.useFakeTimers()
    try {
      const process = vi.fn<Parameters<typeof createKioskUtteranceQueue>[0]['process']>(async () => {})
      const onDrop = vi.fn()
      const queue = createKioskUtteranceQueue({ process, onDrop })
      const reservation = queue.reserve('asr')
      if (reservation.kind !== 'ACCEPTED')
        throw new Error('Expected capture reservation.')
      queue.submit({ source: 'asr', text: '後面補充的一句' })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(reservation.signal.aborted).toBe(false)
      reservation.complete({ text: '水餃十顆兩份' })
      await queue.idle()
      expect(process.mock.calls.map(([utterance]) => utterance.text)).toEqual(['水餃十顆兩份', '後面補充的一句'])
      expect(onDrop).not.toHaveBeenCalled()
    }
    finally { vi.useRealTimers() }
  })

  it('aborts incomplete transcription on reset and ignores late progress or completion', async () => {
    vi.useFakeTimers()
    try {
      const process = vi.fn(async () => {})
      const queue = createKioskUtteranceQueue({ process })
      const reservation = queue.reserve('asr')
      if (reservation.kind !== 'ACCEPTED')
        throw new Error('Expected capture reservation.')
      reservation.markTranscriptionProgress()
      queue.reset()
      expect(reservation.signal.aborted).toBe(true)
      reservation.markTranscriptionProgress()
      reservation.complete({ text: '舊會話辨識完成' })
      await vi.advanceTimersByTimeAsync(15_001)
      await queue.idle()
      expect(process).not.toHaveBeenCalled()
      queue.submit({ source: 'simulation', text: '新會話' })
      await queue.idle()
      expect(process).toHaveBeenCalledTimes(1)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('invalidates waiting utterances when the visitor session resets', async () => {
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const handled: string[] = []
    const queue = createKioskUtteranceQueue({ process: async ({ text }) => {
      handled.push(text)
      if (text === '第一句')
        await pending
    } })

    queue.submit({ source: 'asr', text: '第一句' })
    queue.submit({ source: 'asr', text: '舊會話第二句' })
    await Promise.resolve()
    queue.reset()
    release?.()
    await queue.idle()
    expect(handled).toEqual(['第一句'])
  })
})

it('aborts the active decision transport when the queue is reset', async () => {
  let signal: AbortSignal | undefined
  let finish!: () => void
  const queue = createKioskUtteranceQueue({ process: async (_utterance, ticket) => {
    signal = ticket.signal
    await new Promise<void>(resolve => finish = resolve)
  } })
  queue.submit({ source: 'simulation', text: '請確認' })
  await vi.waitFor(() => expect(signal).toBeDefined())
  queue.reset()
  expect(signal?.aborted).toBe(true)
  finish()
  await queue.idle()
})

// Report: this chat, Nov13; an old LLM may ignore cancellation after the next reception starts.
it('starts the new reception without waiting for canceled work and ignores its late cleanup', async () => {
  let finishOld!: () => void
  let finishNew!: () => void
  let oldTicket: { isCurrent: () => boolean } | undefined
  const handled: string[] = []
  const states: Array<{ active?: { text: string } }> = []
  const queue = createKioskUtteranceQueue({ onState: state => states.push(state), process: async (utterance, ticket) => {
    handled.push(utterance.text)
    if (utterance.text === 'old') {
      oldTicket = ticket
      await new Promise<void>(resolve => finishOld = resolve)
    }
    else {
      await new Promise<void>(resolve => finishNew = resolve)
    }
  } })
  queue.submit({ source: 'simulation', text: 'old' })
  await vi.waitFor(() => expect(handled).toEqual(['old']))
  queue.reset()
  queue.submit({ source: 'simulation', text: 'new' })
  try {
    await vi.waitFor(() => expect(handled).toEqual(['old', 'new']))
    expect(oldTicket!.isCurrent()).toBe(false)
    finishOld()
    await Promise.resolve()
    await Promise.resolve()
    expect(states.at(-1)?.active?.text).toBe('new')
  }
  finally {
    finishOld()
    await vi.waitFor(() => expect(finishNew).toBeTypeOf('function'))
    finishNew()
    await queue.idle()
  }
})

it('announces a completed later transcript while earlier work is still executing', async () => {
  let release!: () => void
  const onReady = vi.fn()
  const queue = createKioskUtteranceQueue({ onReady, process: async () => new Promise<void>(resolve => release = resolve) })
  queue.submit({ text: '第一句', source: 'simulation' })
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  const next = queue.reserve('asr')
  if (next.kind !== 'ACCEPTED')
    throw new Error('Expected capacity.')
  next.complete({ text: '第二句' })
  expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ text: '第二句', id: next.id }))
  queue.reset()
  release()
})
