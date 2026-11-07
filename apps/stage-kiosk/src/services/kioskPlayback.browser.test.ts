import { encodeComparisonRecording } from '@proj-airi/stage-shared/kiosk-audio'
import { expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import { playKioskAudio } from './kioskPlayback'

function audio() {
  return encodeComparisonRecording(new Float32Array(1600), { role: 'processed', channels: 1, frameCount: 1600, sampleRate: 16000 })
}

// Report: this chat, 2026-11-05 — Firefox synthesis succeeds but playback stays silent.
it('uses native playback when the shared context is suspended instead of routing audio into a silent graph', async () => {
  const context = new AudioContext()
  await context.suspend()
  const button = document.createElement('button')
  button.textContent = 'Play synthetic WAV'
  let playback: ReturnType<typeof playKioskAudio> | undefined
  button.onclick = () => {
    playback = playKioskAudio(audio(), new AbortController().signal, context)
  }
  document.body.append(button)
  try {
    await userEvent.click(button)
    await vi.waitFor(() => expect(playback).toBeDefined())
    expect(playback?.source).toBeUndefined()
    expect(await playback?.finished).toEqual({ kind: 'ended' })
    expect(context.state).toBe('suspended')
  }
  finally {
    playback?.stop()
    button.remove()
    await context.close()
  }
})
it('keeps a running borrowed graph live after cancellation', async () => {
  const context = new AudioContext()
  const controller = new AbortController()
  const button = document.createElement('button')
  button.textContent = 'Play through running graph'
  let playback: ReturnType<typeof playKioskAudio> | undefined
  button.onclick = async () => {
    await context.resume()
    playback = playKioskAudio(audio(), controller.signal, context)
    controller.abort()
  }
  document.body.append(button)
  try {
    await userEvent.click(button)
    await vi.waitFor(() => expect(playback).toBeDefined())
    expect(playback?.source).toBeInstanceOf(MediaElementAudioSourceNode)
    expect(await playback?.finished).toEqual({ kind: 'stopped' })
    expect(context.state).toBe('running')
  }
  finally {
    playback?.stop()
    button.remove()
    await context.close()
  }
})
it('reports invalid audio as playback failure rather than successful speech', async () => {
  const playback = playKioskAudio(new Blob(['invalid audio'], { type: 'audio/wav' }), new AbortController().signal)
  try {
    expect(await playback.finished).toMatchObject({ kind: 'failed' })
  }
  finally { playback.stop() }
})

it('loops quiet processing feedback until explicitly cancelled', async () => {
  const controller = new AbortController()
  const button = document.createElement('button')
  button.textContent = 'Start processing sound'
  let playback: ReturnType<typeof playKioskAudio> | undefined
  let finished = false
  button.onclick = () => {
    playback = playKioskAudio(audio(), controller.signal, undefined, { loop: true, volume: 0.18 })
    void playback.finished.then(() => finished = true)
  }
  document.body.append(button)
  try {
    await userEvent.click(button)
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(finished).toBe(false)
    controller.abort()
    expect(await playback?.finished).toEqual({ kind: 'stopped' })
  }
  finally {
    playback?.stop()
    button.remove()
  }
})

// Report: this chat,2026-11-06 — silence began while TTS was still being prepared.
it('announces the first native playing event rather than merely preparing a speech player', async () => {
  const onPlaying = vi.fn()
  const playback = playKioskAudio(audio(), new AbortController().signal, undefined, { onPlaying })
  expect(onPlaying).not.toHaveBeenCalled()
  expect(await playback.finished).toEqual({ kind: 'ended' })
  expect(onPlaying).toHaveBeenCalledOnce()
  const failed = vi.fn()
  const invalid = playKioskAudio(new Blob(['not audio']), new AbortController().signal, undefined, { onPlaying: failed })
  expect(await invalid.finished).toMatchObject({ kind: 'failed' })
  expect(failed).not.toHaveBeenCalled()
})

// Report: this chat,2026-11-07 — spatial routing must follow audible playback,
// including an immediate stop at speech-start, not synthesis or turn phase.
it('marks the terminal playback edge synchronously and once on interruption', async () => {
  const edges: boolean[] = []
  const controller = new AbortController()
  const playback = playKioskAudio(audio(), controller.signal, undefined, {
    loop: true,
    onPlaying: () => edges.push(true),
    onStopped: () => edges.push(false),
  })
  expect(edges).toEqual([])
  await vi.waitFor(() => expect(edges).toEqual([true]))
  playback.stop()
  expect(edges).toEqual([true, false])
  controller.abort()
  playback.stop()
  expect(await playback.finished).toEqual({ kind: 'stopped' })
  expect(edges).toEqual([true, false])
})
it('clears audible state on natural end but does not announce unplayed failures', async () => {
  const edges: boolean[] = []
  const playback = playKioskAudio(audio(), new AbortController().signal, undefined, { onPlaying: () => edges.push(true), onStopped: () => edges.push(false) })
  expect(await playback.finished).toEqual({ kind: 'ended' })
  expect(edges).toEqual([true, false])
  const invalid = playKioskAudio(new Blob(['not audio']), new AbortController().signal, undefined, { onPlaying: () => edges.push(true), onStopped: () => edges.push(false) })
  expect(await invalid.finished).toMatchObject({ kind: 'failed' })
  expect(edges).toEqual([true, false])
})
