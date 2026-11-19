import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { expect, it } from 'vitest'

import { NativeAudio } from './nativeAudio'

it.skipIf(!process.env.KIOSK_AUDIO_TEST_PYTHON)('runs the actual bundled-source worker over correlated binary pipes and closes its owner', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kiosk-native-audio-'))
  const audioRoot = resolve(import.meta.dirname, '../..', 'audio')
  const audio = new NativeAudio({ executable: process.env.KIOSK_AUDIO_TEST_PYTHON!, entry: resolve(audioRoot, 'src/entry.py'), model: resolve(audioRoot, 'models/ulunas_stream.onnx'), stateDirectory: directory, provider: 'cpu' })
  try {
    const status = await audio.request({ kind: 'status' })
    expect(status.requested_provider).toBe('CPU')
    expect(status.runtime).toBe('OpenVINO')
    expect(status.runtime_version).toContain('2026.4.1')
    expect(status.precision).toBe('f32')
    expect(status.device_name).toBeTruthy()
    expect(status.gpu_verified).toBe(false)
    expect(status.state).toBe('automatic')
    await audio.request({ kind: 'start', generation: 'listen', channels: [0, 1, 2, 3, 4, 5, 6], gainDb: 0, silenceMs: 600, minSpeechMs: 80 })
    // A retiring document can still have one block in transit after replacement.
    // Rejecting it must preserve the current generation's source clock.
    await expect(audio.request({ kind: 'block', generation: 'install', offsetFrames: 0, samples: new Float32Array(3840) })).rejects.toThrow('Stale')
    let emitted = 0
    for (let offset = 0; offset < 48000; offset += 384) {
      const reply = await audio.request({ kind: 'block', generation: 'listen', offsetFrames: offset, samples: new Float32Array(3840) })
      expect(reply.processedFrames).toBe(offset + 384)
      for (const frame of reply.frames ?? []) {
        expect(frame.offsetSamples).toBe(emitted)
        emitted += frame.length
      }
    }
    expect(emitted).toBeGreaterThan(14000)
    audio.dispose()
    await expect(audio.request({ kind: 'status' })).rejects.toThrow('closed')
  }
  finally {
    audio.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}, 15000)
