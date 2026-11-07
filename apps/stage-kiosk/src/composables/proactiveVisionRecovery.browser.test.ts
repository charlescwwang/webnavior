import type { FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision'

import { expect, it, vi } from 'vitest'

import { kioskPerformanceSettings } from '../services/kiosk-performance'
import { useKioskProactiveVision } from './useKioskProactiveVision'

function poseRuntime(): Pick<PoseLandmarker, 'detectForVideo' | 'close'> {
  return { close: vi.fn(), detectForVideo: vi.fn(() => ({ landmarks: [], worldLandmarks: [], close: () => {} })) }
}
function faceRuntime(): Pick<FaceLandmarker, 'detectForVideo' | 'close'> {
  return { close: vi.fn(), detectForVideo: vi.fn(() => ({ faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] })) }
}
function fixture() {
  const video = document.createElement('video')
  video.muted = true
  document.body.append(video)
  const onPresenceCandidate = vi.fn()
  const onFaces = vi.fn()
  const onObservation = vi.fn()
  let cameraStream: MediaStream | undefined
  const settings = { ...kioskPerformanceSettings.balanced, detectionIntervalMs: 30, presenceCadence: { boostMs: 30, stableMs: 30, boostDurationMs: 150, faceMs: 30 } }
  const options = { detectionEnabled: () => true, detectionConfidence: () => 0.5, detectionZone: () => ({ x: 0, y: 0, width: 1, height: 1 }), performance: () => settings, visionMode: () => 'pose_only' as const, shouldRunFace: () => false, onPresenceCandidate, onObservation, onFaces, onCameraStream: (stream: MediaStream | undefined) => cameraStream = stream }
  return { video, options, getStream: () => cameraStream, close: () => video.remove() }
}

// Report: this chat, 2026-11-07: inference errors were only logged while status stayed observing.
// NOTICE: Video acquisition is a real browser fake-device stream. The optional
// factories replace only the external MediaPipe IO boundary, not presence policy.
it('exposes inference failure, clears stale presence, backs off and recovers in the same lane', async () => {
  const f = fixture()
  const model = poseRuntime()
  vi.mocked(model.detectForVideo).mockImplementationOnce(() => {
    throw new Error('Pose runtime unavailable')
  })
  const vision = useKioskProactiveVision({ ...f.options, createPoseLandmarker: async () => model })
  try {
    await vision.start(f.video)
    // NOTICE: first browser model/module initialization can exceed1s; the
    // assertion waits for the failure transition, not a hardware latency target.
    await expect.poll(() => vision.status.value, { interval: 10, timeout: 5000 }).toBe('degraded')
    expect(vision.error.value).toBe('Pose runtime unavailable')
    expect(f.options.onPresenceCandidate).toHaveBeenLastCalledWith(undefined)
    expect(f.options.onFaces).toHaveBeenLastCalledWith([])
    expect(model.detectForVideo).toHaveBeenCalledTimes(1)
    await expect.poll(() => vision.status.value).toBe('observing')
    expect(vision.error.value).toBeUndefined()
    expect(vi.mocked(model.detectForVideo).mock.calls.length).toBeGreaterThanOrEqual(2)
  }
  finally {
    vision.stop()
    f.close()
  }
})

it('closes a late model after stop without resurrecting observation or affecting the next generation', async () => {
  const f = fixture()
  const first = poseRuntime()
  const second = poseRuntime()
  const pending = Promise.withResolvers<Pick<PoseLandmarker, 'detectForVideo' | 'close'>>()
  const create = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(second)
  const vision = useKioskProactiveVision({ ...f.options, createPoseLandmarker: create })
  try {
    await vision.start(f.video)
    await expect.poll(() => create.mock.calls.length).toBe(1)
    vision.stop()
    await vision.start(f.video)
    await expect.poll(() => vision.status.value).toBe('observing')
    pending.resolve(first)
    await expect.poll(() => vi.mocked(first.close).mock.calls.length).toBe(1)
    expect(first.detectForVideo).not.toHaveBeenCalled()
    expect(second.close).not.toHaveBeenCalled()
    expect(vision.status.value).toBe('observing')
    expect(vision.error.value).toBeUndefined()
  }
  finally {
    pending.resolve(first)
    vision.stop()
    f.close()
  }
})

it('handles face inference failure with the same recovery policy', async () => {
  const f = fixture()
  const model = faceRuntime()
  vi.mocked(model.detectForVideo).mockImplementationOnce(() => {
    throw new Error('Face runtime unavailable')
  })
  const vision = useKioskProactiveVision({ ...f.options, visionMode: () => 'face_only', createFaceLandmarker: async () => model })
  try {
    await vision.start(f.video)
    // NOTICE: first browser model/module initialization can exceed1s; the
    // assertion waits for the failure transition, not a hardware latency target.
    await expect.poll(() => vision.status.value, { interval: 10, timeout: 5000 }).toBe('degraded')
    expect(vision.error.value).toBe('Face runtime unavailable')
    await expect.poll(() => vision.status.value).toBe('observing')
    expect(vision.error.value).toBeUndefined()
  }
  finally {
    vision.stop()
    f.close()
  }
})

it('reports camera disconnect and clears presence instead of reporting no person', async () => {
  const f = fixture()
  const model = poseRuntime()
  const vision = useKioskProactiveVision({ ...f.options, createPoseLandmarker: async () => model })
  try {
    await vision.start(f.video)
    await expect.poll(() => vision.status.value).toBe('observing')
    const stream = f.getStream()
    if (!(stream instanceof MediaStream))
      throw new Error('Expected a real browser camera stream')
    // NOTICE: stop() changes real track state without emitting ended. This
    // exercises the liveness check; it is not a physical USB-unplug test.
    stream.getVideoTracks()[0]!.stop()
    await expect.poll(() => vision.status.value).toBe('failed')
    expect(vision.error.value).toContain('相機連線已中斷')
    expect(f.options.onPresenceCandidate).toHaveBeenLastCalledWith(undefined)
    expect(model.close).toHaveBeenCalledTimes(1)
  }
  finally {
    vision.stop()
    f.close()
  }
})

// Report: this chat, 2026-11-07: complete the planned model-load deadline policy.
it('expires a hung model load, blocks duplicate loads and closes the late model', async () => {
  const f = fixture()
  const model = poseRuntime()
  const next = poseRuntime()
  const pending = Promise.withResolvers<Pick<PoseLandmarker, 'detectForVideo' | 'close'>>()
  const create = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(next)
  const vision = useKioskProactiveVision({ ...f.options, modelLoadTimeoutMs: 80, createPoseLandmarker: create })
  try {
    await vision.start(f.video)
    await expect.poll(() => create.mock.calls.length).toBe(1)
    await expect.poll(() => vision.status.value, { timeout: 1500 }).toBe('failed')
    expect(vision.error.value).toContain('模型載入逾時')
    expect(f.getStream()).toBeUndefined()
    await vision.start(f.video)
    expect(create).toHaveBeenCalledTimes(1)
    expect(vision.status.value).toBe('failed')
    pending.resolve(model)
    await expect.poll(() => vi.mocked(model.close).mock.calls.length).toBe(1)
    expect(model.detectForVideo).not.toHaveBeenCalled()
    await vision.start(f.video)
    await expect.poll(() => vision.status.value).toBe('observing')
    expect(create).toHaveBeenCalledTimes(2)
  }
  finally {
    pending.resolve(model)
    vision.stop()
    f.close()
  }
})

it('stops refreshing observation on frozen live video and recovers when frames advance', async () => {
  const f = fixture()
  const model = poseRuntime()
  const create = vi.fn(async () => model)
  const vision = useKioskProactiveVision({ ...f.options, frameStallTimeoutMs: 120, createPoseLandmarker: create })
  try {
    await vision.start(f.video)
    await expect.poll(() => vision.status.value).toBe('observing')
    f.video.pause()
    await expect.poll(() => vision.status.value, { timeout: 1500 }).toBe('degraded')
    expect(vision.error.value).toContain('相機影格暫停更新')
    expect(f.getStream()?.getVideoTracks()[0]?.readyState).toBe('live')
    expect(f.options.onPresenceCandidate).toHaveBeenLastCalledWith(undefined)
    const calls = vi.mocked(model.detectForVideo).mock.calls.length
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(model.detectForVideo).toHaveBeenCalledTimes(calls)
    await f.video.play()
    await expect.poll(() => vision.status.value).toBe('observing')
    expect(vision.error.value).toBeUndefined()
    expect(create).toHaveBeenCalledTimes(1)
  }
  finally {
    vision.stop()
    f.close()
  }
})
