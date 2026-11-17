import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

import { expect, it } from 'vitest'

import { createFalconCapture, createMouthCropper } from './falconCapture'

it('crops real video frames to 96x96 uint8 grayscale and rejects ambiguous targets', async () => {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 192
  const context = canvas.getContext('2d')!
  context.fillStyle = 'rgb(255,0,0)'
  context.fillRect(0, 0, 192, 192)
  const stream = canvas.captureStream(25)
  const video = document.createElement('video')
  video.muted = true
  video.srcObject = stream
  try {
    await video.play()
    const face: NormalizedLandmark[] = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))
    face[61]!.x = 0.4
    face[291]!.x = 0.6
    const crop = createMouthCropper()
    const zone = { x: 0, y: 0, width: 1, height: 1 }
    const image = crop(video, [face], zone)
    expect(image?.pixels).toBeInstanceOf(Uint8Array)
    expect(image?.pixels.length).toBe(9216)
    expect(image?.pixels.every(value => value === 76)).toBe(true)
    expect(image?.aperture).toBe(0)
    const capture = createFalconCapture(15, 3000)
    for (let index = 0; index < 25; index++)
      capture.push(index * 40 + 20, crop(video, [face], zone))
    expect(() => capture.prepare({ buffer: new Float32Array(16000).fill(0.5), duration: 1000, startTimeMs: 0, capturedSamples: 16000 })).toThrowError(expect.objectContaining({ reason: 'inactive' }))
    face[13]!.y = 0.48
    face[14]!.y = 0.52
    expect(crop(video, [face], zone)?.aperture).toBeCloseTo(0.2)
    capture.reset()
    for (let index = 0; index < 25; index++)
      capture.push(index * 40 + 20, crop(video, [face], zone))
    expect(new DataView(capture.prepare({ buffer: new Float32Array(16000).fill(0.5), duration: 1000, startTimeMs: 0, capturedSamples: 16000 }).packet).getUint32(0, true)).toBe(25)
    expect(crop(video, [face, face], zone)).toBeUndefined()
    expect(crop(video, [face], { x: 0, y: 0, width: 0.2, height: 0.2 })).toBeUndefined()
  }
  finally {
    stream.getTracks().forEach(track => track.stop())
    video.srcObject = null
  }
})
