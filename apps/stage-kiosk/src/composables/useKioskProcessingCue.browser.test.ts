import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'

import { createKioskVadRecording } from '../services/kiosk-audio'
import { createSpeechPlayer } from '../services/kioskSpeech'
import { useKioskProcessingCue } from './useKioskProcessingCue'

afterEach(() => vi.restoreAllMocks())

function audioFiles(enabled = true, missingMusic = false, contentType = 'audio/wav') {
  const wav = createKioskVadRecording(new Float32Array(1600))
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith('processing.json'))
      return Response.json({ enabled })
    if (url.endsWith('kiosk_acknowledged_chime.wav'))
      return new Response(wav, { headers: { 'content-type': contentType } })
    if (url.endsWith('kiosk_hold_melodic_light_60s.wav'))
      return missingMusic ? new Response('Missing', { status: 404 }) : new Response(wav, { headers: { 'content-type': contentType } })
    return new Response('<html>not found</html>', { headers: { 'content-type': 'text/html' } })
  })
}

function setup() {
  const processing = shallowRef(false)
  const muted = shallowRef(false)
  const speaking = shallowRef(false)
  const pendingVoice = shallowRef(false)
  let cue: ReturnType<typeof useKioskProcessingCue> | undefined
  const view = render(defineComponent({ setup() {
    cue = useKioskProcessingCue(processing, muted, speaking, pendingVoice)
    return () => h('button', { onClick: () => {
      cue!.acknowledge()
      processing.value = true
    } }, 'Receive voice')
  } }))
  return { view, processing, muted, speaking, pendingVoice, cue: () => cue! }
}

function player(value: unknown): HTMLMediaElement {
  if (!(value instanceof HTMLMediaElement))
    throw new Error('Expected a real media player.')
  return value
}

it('does not fetch either audio file when the deployment manifest is disabled', async () => {
  const fetch = audioFiles(false)
  const state = setup()
  try {
    await expect.poll(() => fetch.mock.calls.length).toBe(1)
    expect(state.cue().ready.value).toBe(false)
  }
  finally { state.view.unmount() }
})

// Report: this chat, 2026-11-06 — separate receipt chime and looping waiting music.
it('plays a voice receipt before waiting music and stays silent after reply playback until a new voice capture', async () => {
  audioFiles()
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  const state = setup()
  try {
    await expect.poll(() => state.cue().ready.value).toBe(true)
    await state.view.getByRole('button', { name: 'Receive voice' }).click()
    const chime = player(play.mock.contexts[0])
    expect(chime.loop).toBe(false)
    expect(chime.volume).toBe(0.4)
    await expect.poll(() => play.mock.contexts.length).toBe(2)
    const music = player(play.mock.contexts[1])
    expect(music.loop).toBe(true)
    expect(music.volume).toBe(0.30)
    state.muted.value = true
    expect(music.paused).toBe(true)
    state.muted.value = false
    expect(play).toHaveBeenCalledTimes(2)
    state.processing.value = false
    await new Promise(resolve => setTimeout(resolve, 250))
    state.processing.value = true
    expect(play).toHaveBeenCalledTimes(2)
    state.cue().acknowledge()
    await expect.poll(() => play.mock.contexts.length).toBe(3)
    expect(player(play.mock.contexts[2]).loop).toBe(false)
    state.view.unmount()
    expect(player(play.mock.contexts[2]).paused).toBe(true)
  }
  finally { state.view.unmount() }
})

it('plays a new receipt when another speech segment is captured during work', async () => {
  audioFiles()
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  const state = setup()
  try {
    await expect.poll(() => state.cue().ready.value).toBe(true)
    state.cue().acknowledge()
    state.processing.value = true
    await expect.poll(() => play.mock.contexts.length).toBe(2)
    const music = player(play.mock.contexts[1])
    state.cue().acknowledge()
    expect(music.paused).toBe(true)
    await expect.poll(() => play.mock.contexts.length).toBe(4)
    expect(player(play.mock.contexts[2]).loop).toBe(false)
    state.processing.value = false
    await expect.poll(() => music.paused).toBe(true)
  }
  finally { state.view.unmount() }
})

it('still acknowledges speech when waiting music is missing', async () => {
  const fetch = audioFiles(true, true)
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  const state = setup()
  try {
    await expect.poll(() => fetch.mock.calls.length).toBe(3)
    expect(state.cue().ready.value).toBe(true)
    state.cue().acknowledge()
    state.processing.value = true
    await expect.poll(() => play.mock.contexts.length).toBe(1)
    expect(player(play.mock.contexts[0]).loop).toBe(false)
  }
  finally { state.view.unmount() }
})

it('loads the supplied WAV files and starts their real audio without waiting sixty seconds', async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  const state = setup()
  try {
    await expect.poll(() => state.cue().ready.value, { timeout: 5_000 }).toBe(true)
    await state.view.getByRole('button', { name: 'Receive voice' }).click()
    const chime = player(play.mock.contexts[0])
    await expect.poll(() => chime.duration).toBe(0.51)
    await expect.poll(() => play.mock.contexts.length, { timeout: 2_000 }).toBe(2)
    const music = player(play.mock.contexts[1])
    await expect.poll(() => music.duration).toBe(60)
    expect(music.loop).toBe(true)
    state.processing.value = false
    await expect.poll(() => music.paused).toBe(true)
  }
  finally { state.view.unmount() }
})

// Report: production /kiosk/audio/*.wav is served as application/octet-stream.
it('accepts valid WAV bytes with the generic content type used by the production host', async () => {
  audioFiles(true, false, 'application/octet-stream')
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  const state = setup()
  try {
    await expect.poll(() => state.cue().ready.value).toBe(true)
    await state.view.getByRole('button', { name: 'Receive voice' }).click()
    expect(player(play.mock.contexts[0]).loop).toBe(false)
    await expect.poll(() => play.mock.contexts.length).toBe(2)
    expect(player(play.mock.contexts[1]).loop).toBe(true)
  }
  finally { state.view.unmount() }
})

it('rejects an HTML missing-file rewrite even when its HTTP status is successful', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).endsWith('processing.json')
    ? Response.json({ enabled: true })
    : new Response('<!doctype html><html>Missing</html>', { headers: { 'content-type': 'text/html' } }))
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  const state = setup()
  try {
    await expect.poll(() => fetch.mock.calls.length).toBe(3)
    await state.view.getByRole('button', { name: 'Receive voice' }).click()
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(state.cue().ready.value).toBe(false)
    expect(play).not.toHaveBeenCalled()
  }
  finally { state.view.unmount() }
})

// Report: this chat,2026-11-06 — waiting music repeatedly stopped and restarted before TTS.
// Report: this chat Nov17 — later accepted speech had no receipt while earlier work was pending.
it('keeps music across a brief handoff but acknowledges another captured utterance', async () => {
  audioFiles()
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  const state = setup()
  try {
    await expect.poll(() => state.cue().ready.value).toBe(true)
    state.cue().acknowledge()
    state.processing.value = true
    await expect.poll(() => play.mock.contexts.length).toBe(2)
    const music = player(play.mock.contexts[1])
    state.processing.value = false
    await Promise.resolve()
    state.processing.value = true
    expect(music.paused).toBe(false)
    state.cue().acknowledge()
    await expect.poll(() => play.mock.contexts.length).toBe(4)
    expect(music.paused).toBe(true)
    expect(player(play.mock.contexts[2]).loop).toBe(false)
    const nextMusic = player(play.mock.contexts[3])
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(nextMusic.paused).toBe(false)
    expect(play).toHaveBeenCalledTimes(4)
  }
  finally { state.view.unmount() }
})

// Report: this chat,2026-11-06 — idle reminders must never produce receipt/wait audio.
it('stays silent for internal work and proactive TTS until real voice capture is acknowledged', async () => {
  audioFiles()
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  const state = setup()
  try {
    await expect.poll(() => state.cue().ready.value).toBe(true)
    state.processing.value = true
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(play).not.toHaveBeenCalled()
    state.muted.value = true
    state.muted.value = false
    expect(play).not.toHaveBeenCalled()
    state.cue().acknowledge()
    await expect.poll(() => play.mock.contexts.length).toBe(2)
    expect(player(play.mock.contexts[0]).loop).toBe(false)
    expect(player(play.mock.contexts[1]).loop).toBe(true)
  }
  finally { state.view.unmount() }
})

// Report: this chat,2026-11-07 — waiting music must stop when TTS begins.
it('stops waiting music immediately at TTS start and keeps it stopped after reply completion', async () => {
  audioFiles()
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  const state = setup()
  try {
    await expect.poll(() => state.cue().ready.value).toBe(true)
    await state.view.getByRole('button', { name: 'Receive voice' }).click()
    await expect.poll(() => play.mock.contexts.length).toBe(2)
    const music = player(play.mock.contexts[1])
    state.speaking.value = true
    state.processing.value = false
    expect(music.paused).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(music.paused).toBe(true)
    expect(play).toHaveBeenCalledTimes(2)
    state.speaking.value = false
    expect(music.paused).toBe(true)
    state.processing.value = true
    expect(play).toHaveBeenCalledTimes(2)
  }
  finally { state.view.unmount() }
})

it.each(['captured-during-reply', 'already-queued'] as const)('keeps newer voice work alive after an earlier reply ends: %s', async (pending) => {
  audioFiles()
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  const state = setup()
  try {
    await expect.poll(() => state.cue().ready.value).toBe(true)
    await state.view.getByRole('button', { name: 'Receive voice' }).click()
    await expect.poll(() => play.mock.contexts.length).toBe(2)
    const music = player(play.mock.contexts[1])
    if (pending === 'already-queued')
      state.pendingVoice.value = true
    state.speaking.value = true
    if (pending === 'captured-during-reply')
      state.cue().acknowledge()
    state.speaking.value = false
    expect(music.paused).toBe(true)
    const expectedPlayers = pending === 'captured-during-reply' ? 4 : 3
    await expect.poll(() => play.mock.contexts.length).toBe(expectedPlayers)
    if (pending === 'captured-during-reply')
      expect(player(play.mock.contexts[2]).loop).toBe(false)
    const nextMusic = player(play.mock.contexts[expectedPlayers - 1])
    expect(nextMusic.loop).toBe(true)
    expect(nextMusic.volume).toBe(0.30)
    state.pendingVoice.value = false
    state.speaking.value = true
    expect(nextMusic.paused).toBe(true)
    state.speaking.value = false
    expect(music.paused).toBe(true)
  }
  finally { state.view.unmount() }
})

it('does not play feedback for an idle TTS reply and stops ongoing feedback for a service fault', async () => {
  audioFiles()
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  const state = setup()
  try {
    await expect.poll(() => state.cue().ready.value).toBe(true)
    state.speaking.value = true
    state.speaking.value = false
    expect(play).not.toHaveBeenCalled()
    await state.view.getByRole('button', { name: 'Receive voice' }).click()
    await expect.poll(() => play.mock.contexts.length).toBe(2)
    const music = player(play.mock.contexts[1])
    state.speaking.value = true
    state.muted.value = true
    expect(music.paused).toBe(true)
    state.speaking.value = false
    state.muted.value = false
    expect(play).toHaveBeenCalledTimes(2)
  }
  finally { state.view.unmount() }
})

// Report: this chat,2026-11-07 — TTS must own output even if a receipt is pending.
it('retires a receipt interrupted by TTS without a stale completion restarting music', async () => {
  audioFiles()
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  const state = setup()
  try {
    await expect.poll(() => state.cue().ready.value).toBe(true)
    await state.view.getByRole('button', { name: 'Receive voice' }).click()
    const chime = player(play.mock.contexts[0])
    state.speaking.value = true
    expect(chime.paused).toBe(true)
    chime.dispatchEvent(new Event('ended'))
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(play).toHaveBeenCalledTimes(1)
    state.speaking.value = false
    expect(play).toHaveBeenCalledTimes(1)
  }
  finally { state.view.unmount() }
})

it('keeps a new voice acknowledgement silent during TTS and starts it only after playback stops', async () => {
  audioFiles()
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  const state = setup()
  try {
    await expect.poll(() => state.cue().ready.value).toBe(true)
    state.speaking.value = true
    state.processing.value = true
    state.cue().acknowledge()
    expect(play).not.toHaveBeenCalled()
    state.speaking.value = false
    await expect.poll(() => play.mock.contexts.length).toBe(1)
    expect(player(play.mock.contexts[0]).loop).toBe(false)
    await expect.poll(() => play.mock.contexts.length).toBe(2)
    expect(player(play.mock.contexts[1]).volume).toBe(0.30)
  }
  finally { state.view.unmount() }
})

// Report: this chat, 2026-11-17 — restore master feedback with the current TTS player.
it('keeps music during actual synthesis and stops it at actual TTS playback without restarting after the reply', async () => {
  audioFiles()
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  const state = setup()
  let ready!: (audio: Blob) => void
  const tts = createSpeechPlayer({
    synthesize: () => new Promise<Blob>(resolve => ready = resolve),
    onPlaying: () => state.speaking.value = true,
    onStopped: () => state.speaking.value = false,
    onSource: () => undefined,
  })
  try {
    await expect.poll(() => state.cue().ready.value).toBe(true)
    await state.view.getByRole('button', { name: 'Receive voice' }).click()
    await expect.poll(() => play.mock.contexts.length).toBe(2)
    const music = player(play.mock.contexts[1])
    const reply = tts.play({ text: '水餃已加入購物車。', locale: 'zh-TW', signal: new AbortController().signal })
    expect(music.paused).toBe(false)
    ready(createKioskVadRecording(new Float32Array(1600)))
    await expect.poll(() => play.mock.contexts.length).toBe(3)
    await expect.poll(() => music.paused).toBe(true)
    expect(await reply).toBe('completed')
    expect(state.speaking.value).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(play).toHaveBeenCalledTimes(3)
  }
  finally {
    tts.stop()
    state.view.unmount()
  }
})

it('closes feedback ownership on reset even if cancelled work is still settling', async () => {
  audioFiles()
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  const state = setup()
  try {
    await expect.poll(() => state.cue().ready.value).toBe(true)
    await state.view.getByRole('button', { name: 'Receive voice' }).click()
    await expect.poll(() => play.mock.contexts.length).toBe(2)
    const music = player(play.mock.contexts[1])
    state.cue().reset()
    expect(music.paused).toBe(true)
    state.pendingVoice.value = true
    state.speaking.value = true
    state.speaking.value = false
    expect(play).toHaveBeenCalledTimes(2)
  }
  finally { state.view.unmount() }
})

// Report: this chat, 2026-11-17 — background captures still chimed even when no customer text survived.
it('keeps legacy captures silent until service admission and acknowledges each admitted utterance once', async () => {
  audioFiles()
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  const state = setup()
  try {
    await expect.poll(() => state.cue().ready.value).toBe(true)
    state.processing.value = true
    state.cue().acknowledge({ utteranceId: 1, recognitionMode: 'legacy', stage: 'capture' })
    state.cue().acknowledge({ utteranceId: 2, recognitionMode: 'legacy', stage: 'capture' })
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(play).not.toHaveBeenCalled()
    state.processing.value = false
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(play).not.toHaveBeenCalled()
    state.processing.value = true
    state.cue().acknowledge({ utteranceId: 3, recognitionMode: 'legacy', stage: 'capture' })
    expect(play).not.toHaveBeenCalled()
    state.cue().acknowledge({ utteranceId: 3, recognitionMode: 'legacy', stage: 'service' })
    await expect.poll(() => play.mock.contexts.length).toBe(2)
    expect(player(play.mock.contexts[0]).loop).toBe(false)
    expect(player(play.mock.contexts[1]).loop).toBe(true)
    state.cue().acknowledge({ utteranceId: 3, recognitionMode: 'legacy', stage: 'service' })
    expect(play).toHaveBeenCalledTimes(2)
    state.cue().acknowledge({ utteranceId: 4, recognitionMode: 'legacy', stage: 'capture' })
    expect(play).toHaveBeenCalledTimes(2)
    state.cue().reset()
    expect(player(play.mock.contexts[1]).paused).toBe(true)
    state.cue().acknowledge({ utteranceId: 3, recognitionMode: 'legacy', stage: 'service' })
    await expect.poll(() => play.mock.contexts.length).toBe(4)
  }
  finally { state.view.unmount() }
})
