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
        onChunkTranscribed: reservation.markTranscriptionProgress,
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

  it('expires a stalled later chunk without executing its earlier recognized demand or blocking later speech', async () => {
    vi.useFakeTimers()
    try {
      const process = vi.fn(async () => {})
      const onDrop = vi.fn()
      const queue = createKioskUtteranceQueue({ process, onDrop })
      const reservation = queue.reserve('asr')
      if (reservation.kind !== 'ACCEPTED')
        throw new Error('Expected capture reservation.')
      const transcribe = vi.fn(async (_recording: Blob, signal?: AbortSignal) => {
        if (transcribe.mock.calls.length === 1) {
          await new Promise(resolve => setTimeout(resolve, 6_000))
          return { text: '我要水餃兩份' }
        }
        return await new Promise<{ text: string }>((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
        })
      })
      const result = transcribeKioskUtterance(new Float32Array(16_000 * 45), {
        signal: reservation.signal,
        onChunkTranscribed: reservation.markTranscriptionProgress,
        transcribe,
      }).then(value => ({ value }), error => ({ error }))
      await vi.advanceTimersByTimeAsync(20_000)
      expect(reservation.signal.aborted).toBe(false)
      queue.submit({ source: 'simulation', text: '後來的一句' })
      await vi.advanceTimersByTimeAsync(1_001)
      expect(await result).toHaveProperty('error')
      expect(reservation.signal.aborted).toBe(true)
      await queue.idle()
      expect(onDrop).toHaveBeenCalledTimes(1)
      expect(process).toHaveBeenCalledTimes(1)
      expect(process).toHaveBeenCalledWith(expect.objectContaining({ text: '後來的一句' }), expect.any(Object))
      expect(transcribe).toHaveBeenCalledTimes(2)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('rejects empty recognition in a multi-chunk utterance without reporting progress for that chunk', async () => {
    const onChunkTranscribed = vi.fn()
    const transcribe = vi.fn().mockResolvedValueOnce({ text: '我要水餃兩份' }).mockResolvedValueOnce({ text: ' ' })
    await expect(transcribeKioskUtterance(new Float32Array(16_000 * 41), { transcribe, onChunkTranscribed })).rejects.toThrow('every part')
    expect(onChunkTranscribed).toHaveBeenCalledTimes(1)
    expect(transcribe).toHaveBeenCalledTimes(2)
  })

  it('stops uploading after the capture reservation expires or the visitor changes', async () => {
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
