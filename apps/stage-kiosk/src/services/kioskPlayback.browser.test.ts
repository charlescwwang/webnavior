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
