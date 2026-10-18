import type { EffectScope } from 'vue'

import type { KioskInteractionTurn } from './useKioskInteractionTurn'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useKioskInteractionTurn } from './useKioskInteractionTurn'
import { useKioskWaitSpeech } from './useKioskWaitSpeech'

const scopes: EffectScope[] = []
afterEach(() => {
  for (const scope of scopes.splice(0))
    scope.stop()
  vi.useRealTimers()
})

function setup() {
  vi.useFakeTimers()
  const scope = effectScope()
  scopes.push(scope)
  const synthesize = vi.fn(async (_input: { locale: string, text: string, signal?: AbortSignal }) => new Blob(['speech']))
  const play = vi.fn(async (_audio: Blob, _turn: KioskInteractionTurn, _signal: AbortSignal) => {})
  const state = scope.run(() => {
    const interaction = useKioskInteractionTurn()
    return { interaction, speech: useKioskWaitSpeech({ synthesize, play }) }
  })!
  return { ...state, scope, synthesize, play }
}

describe('optional kiosk waiting speech', () => {
  it('starts synthesis immediately and speaks once after a short wait without changing the order phase', async () => {
    const { interaction, speech, synthesize, play } = setup()
    const turn = interaction.begin('voice', 'using-tool')
    speech.start(turn, '我幫您確認一下，請稍候。', 'zh-TW')
    expect(synthesize).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(999)
    expect(play).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(play).toHaveBeenCalledOnce()
    expect(interaction.phase.value).toBe('using-tool')
    expect(turn.signal.aborted).toBe(false)
    speech.start(turn, '我幫您確認一下，請稍候。', 'zh-TW')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(synthesize).toHaveBeenCalledOnce()
    expect(play).toHaveBeenCalledOnce()
  })

  it('cancels pending acknowledgement when the real result is ready first', async () => {
    const { interaction, speech, synthesize, play } = setup()
    const turn = interaction.begin('conversation', 'thinking')
    speech.start(turn, '請稍候。', 'zh-TW')
    speech.finish(turn.id)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(synthesize.mock.calls[0]![0].signal?.aborted).toBe(true)
    expect(play).not.toHaveBeenCalled()
    expect(interaction.isCurrent(turn)).toBe(true)
  })

  it('ignores late speech audio even when the provider does not honor abort', async () => {
    const { interaction, speech, synthesize, play } = setup()
    let resolve!: (audio: Blob) => void
    synthesize.mockImplementationOnce(() => new Promise(done => resolve = done))
    const turn = interaction.begin('voice', 'thinking')
    speech.start(turn, '請稍候。', 'zh-TW')
    await vi.advanceTimersByTimeAsync(1_000)
    speech.finish(turn.id)
    resolve(new Blob(['late']))
    await vi.advanceTimersByTimeAsync(0)
    expect(play).not.toHaveBeenCalled()
    expect(turn.signal.aborted).toBe(false)
  })

  it('keeps the order active when speech service is unavailable without retrying in that turn', async () => {
    const { interaction, speech, synthesize, play } = setup()
    synthesize.mockRejectedValueOnce(new Error('Speech service is off'))
    const turn = interaction.begin('voice', 'thinking')
    speech.start(turn, '請稍候。', 'zh-TW')
    await vi.advanceTimersByTimeAsync(2_000)
    speech.start(turn, '請稍候。', 'zh-TW')
    expect(synthesize).toHaveBeenCalledOnce()
    expect(play).not.toHaveBeenCalled()
    expect(interaction.isCurrent(turn)).toBe(true)
  })

  it('stops active waiting playback for the final reply without aborting the order', async () => {
    const { interaction, speech, play } = setup()
    play.mockImplementationOnce((_audio, _turn, signal) => new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true })))
    const turn = interaction.begin('voice', 'using-tool')
    speech.start(turn, '請稍候。', 'zh-TW')
    await vi.advanceTimersByTimeAsync(1_000)
    const output = play.mock.calls[0]![2]
    speech.finish(turn.id)
    expect(output.aborted).toBe(true)
    expect(interaction.isCurrent(turn)).toBe(true)
    expect(interaction.phase.value).toBe('using-tool')
  })

  it('cancels old output on a new turn and prevents an old completion from stopping the new one', async () => {
    const { interaction, speech, synthesize, play } = setup()
    let resolve!: (audio: Blob) => void
    synthesize.mockImplementationOnce(() => new Promise(done => resolve = done))
    const old = interaction.begin('voice', 'thinking')
    speech.start(old, '舊需求。', 'zh-TW')
    const current = interaction.begin('conversation', 'thinking')
    speech.start(current, '新需求。', 'zh-TW')
    speech.finish(old.id)
    resolve(new Blob(['old']))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(play).toHaveBeenCalledOnce()
    expect(play.mock.calls[0]![1].id).toBe(current.id)
    expect(interaction.isCurrent(current)).toBe(true)
  })

  it('cancels synthesis and pending playback when the scene scope is disposed', async () => {
    const { interaction, speech, scope, synthesize, play } = setup()
    const turn = interaction.begin('voice', 'thinking')
    speech.start(turn, '請稍候。', 'zh-TW')
    scope.stop()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(synthesize.mock.calls[0]![0].signal?.aborted).toBe(true)
    expect(play).not.toHaveBeenCalled()
  })
})
