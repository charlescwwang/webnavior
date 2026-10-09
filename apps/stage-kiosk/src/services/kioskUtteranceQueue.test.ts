import { describe, expect, it, vi } from 'vitest'

import { createKioskUtteranceQueue } from './kioskUtteranceQueue'

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
        maxWaitMs: 100,
        onDrop: (utterance) => { dropped.push(utterance.source) },
        process: async (utterance) => { handled.push(utterance.text) },
      })
      const stalled = queue.reserve('asr')
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
