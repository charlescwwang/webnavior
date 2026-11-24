import type { KioskAudioChunk } from '@proj-airi/stage-shared/kiosk-audio'

import { describe, expect, it, vi } from 'vitest'

import { createKioskVadRecording, transcribeKioskUtterance } from './kiosk-audio'
import { createKioskUtteranceQueue } from './kioskUtteranceQueue'

// Report: this chat, 2026-10-26; ASR body-limit failures after the Oct22 release.
describe('complete utterance transcription', () => {
  // Report: this chat, 2026-10-27; successful chunks exceeded the shared 15s deadline.
  it('keeps a progressing multi-chunk utterance whole beyond 15 seconds and executes it once', async () => {
    vi.useFakeTimers()
    try {
      const process = vi.fn(async () => {})
      const onDrop = vi.fn()
      const queue = createKioskUtteranceQueue({ process, onDrop })
      const reservation = queue.reserve('asr')
      if (reservation.kind !== 'ACCEPTED')
        throw new Error('Expected capture reservation.')
      const transcribe = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 6_000))
        return { text: ['我要水餃兩份', '不，改成三份', '再加一份便當'][transcribe.mock.calls.length - 1]! }
      })
      const result = transcribeKioskUtterance(new Float32Array(16_000 * 45), {
        signal: reservation.signal,
        transcribe,
      }).then(value => ({ value }), error => ({ error }))
      await vi.advanceTimersByTimeAsync(18_000)
      const completed = await result
      expect(completed).toHaveProperty('value')
      if (!('value' in completed))
        throw completed.error
      reservation.complete(completed.value)
      await queue.idle()
      expect(onDrop).not.toHaveBeenCalled()
      expect(process).toHaveBeenCalledTimes(1)
      expect(process).toHaveBeenCalledWith(expect.objectContaining({ text: '我要水餃兩份\n不，改成三份\n再加一份便當' }), expect.any(Object))
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('uploads bounded WAV chunks in sample order and returns one complete corrected request', async () => {
    const audio = Float32Array.from({ length: 16_000 * 45 }, (_, index) => (index % 100003) / 200006)
    const chunks: Blob[] = []
    const transcribe = vi.fn(async (recording: Blob, _signal?: AbortSignal, _chunk?: KioskAudioChunk) => {
      chunks.push(recording)
      return { text: ['我要水餃兩份', '不，改成三份', '再加一份便當'][chunks.length - 1]! }
    })
    const result = await transcribeKioskUtterance(audio, { transcribe })
    expect(transcribe).toHaveBeenCalledTimes(3)
    const metadata = transcribe.mock.calls.map(call => call[2])
    expect(new Set(metadata.map(chunk => chunk!.utteranceId)).size).toBe(1)
    expect(metadata.map(chunk => chunk!.index)).toEqual([0, 1, 2])
    expect(metadata[0]!.sampleStart).toBe(0)
    expect(metadata[1]!.sampleStart).toBe(metadata[0]!.sampleEnd)
    expect(metadata[2]!.sampleStart).toBe(metadata[1]!.sampleEnd)
    expect(metadata[2]!.sampleEnd).toBe(audio.length)
    expect(metadata.map(chunk => chunk!.final)).toEqual([false, false, true])
    expect(chunks.every(chunk => chunk.size < 1024 * 1024)).toBe(true)
    const sampleCounts = await Promise.all(chunks.map(async chunk => ((await chunk.arrayBuffer()).byteLength - 44) / 2))
    expect(sampleCounts.reduce((sum, count) => sum + count, 0)).toBe(audio.length)
    expect(result.text).toBe('我要水餃兩份\n不，改成三份\n再加一份便當')
    expect(result.recording.size).toBe(audio.length * 2 + 44)
    const joined = new Uint8Array(audio.length * 2)
    let offset = 0
    for (const chunk of chunks) {
      const bytes = new Uint8Array(await chunk.arrayBuffer(), 44)
      joined.set(bytes, offset)
      offset += bytes.length
    }
    const original = new Uint8Array(await result.recording.arrayBuffer(), 44)
    expect(joined.every((value, index) => value === original[index])).toBe(true)
  })

  it('rejects the whole utterance if a later chunk fails instead of returning an executable partial request', async () => {
    const transcribe = vi.fn().mockResolvedValueOnce({ text: '我要水餃兩份' }).mockRejectedValueOnce(new Error('ASR unavailable'))
    await expect(transcribeKioskUtterance(new Float32Array(16_000 * 41), { transcribe })).rejects.toThrow('ASR unavailable')
    expect(transcribe).toHaveBeenCalledTimes(2)
  })

  it('rejects empty recognition in a multi-chunk utterance', async () => {
    const transcribe = vi.fn().mockResolvedValueOnce({ text: '我要水餃兩份' }).mockResolvedValueOnce({ text: ' ' })
    await expect(transcribeKioskUtterance(new Float32Array(16_000 * 41), { transcribe })).rejects.toThrow('every part')
    expect(transcribe).toHaveBeenCalledTimes(2)
  })

  it('stops uploading after capture is cancelled', async () => {
    const controller = new AbortController()
    const transcribe = vi.fn(async () => {
      controller.abort()
      return { text: '我要兩份' }
    })
    await expect(transcribeKioskUtterance(new Float32Array(16_000 * 45), { transcribe, signal: controller.signal })).rejects.toBeDefined()
    expect(transcribe).toHaveBeenCalledTimes(1)
  })
})

describe('createKioskVadRecording', () => {
  it('preserves the leading VAD padding samples in the WAV payload', async () => {
    const recording = createKioskVadRecording(new Float32Array([-1, -0.5, 0, 0.5, 1]))
    const payload = await recording.arrayBuffer()
    const samples = new Int16Array(payload.slice(44))

    expect(recording.type).toBe('audio/wav')
    expect(samples).toEqual(new Int16Array([-32768, -16384, 0, 16384, 32767]))
  })
})
