import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

import { FaceLandmarker } from '@mediapipe/tasks-vision'
import { expect, it, vi } from 'vitest'

import { kioskPerformanceSettings } from '../services/kiosk-performance'
import { createMouthActivityGate } from '../services/mouthActivity'
import { useKioskProactiveVision } from './useKioskProactiveVision'

const face: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))
face[61] = { x: 0.4, y: 0.5, z: 0, visibility: 1 }
face[291] = { x: 0.6, y: 0.5, z: 0, visibility: 1 }
face[13] = { x: 0.5, y: 0.499, z: 0, visibility: 1 }
face[14] = { x: 0.5, y: 0.501, z: 0, visibility: 1 }
let faces = [face]
const pose: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.25, y: 0.5, z: 0, visibility: 1 }))
pose[0].y = 0.4
pose[11].x = 0.2
pose[12].x = 0.3
pose[23].y = pose[24].y = 0.7

// Only the external model is deterministic. Chromium supplies its real camera
// stream, frame scheduling and canvas; VITEST_FAKE_MEDIA avoids operator capture.
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  FaceLandmarker: { createFromOptions: vi.fn(async () => ({ detectForVideo: () => ({ faceLandmarks: faces }), close: () => {} })) },
  PoseLandmarker: { createFromOptions: vi.fn(async () => ({ detectForVideo: () => ({ landmarks: [pose] }), close: () => {} })) },
}))

// Report: this chat, 2026-11-17 — legacy visual admission must reuse one model and avoid image capture.
it.runIf(import.meta.env.VITEST_FAKE_MEDIA === '1')('uses one Face lane without image capture and revokes legacy permission on missing or frozen video', async () => {
  const gate = createMouthActivityGate()
  const images = vi.fn()
  const observations = vi.fn()
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  document.body.append(video)
  const vision = useKioskProactiveVision({
    detectionConfidence: () => 0.5,
    detectionEnabled: () => true,
    detectionZone: () => ({ x: 0, y: 0, width: 1, height: 1 }),
    performance: () => kioskPerformanceSettings.constrained,
    visionMode: () => 'face_only',
    shouldRunFace: () => true,
    mouthTrackingEnabled: () => true,
    mouthEnabled: () => false,
    onMouthObservation: (time, mouth) => {
      gate.observe(time, mouth)
      observations(mouth)
    },
    onMouthFrame: images,
    onObservation: () => {},
    onPresenceCandidate: () => {},
  })
  try {
    await vision.start(video)
    await expect.poll(() => observations.mock.calls.some(([mouth]) => mouth !== undefined)).toBe(true)
    expect(gate.allowsStart(performance.now())).toBe(false)
    expect(images).not.toHaveBeenCalled()
    face[14].y = 0.54
    await expect.poll(() => gate.allowsStart(performance.now())).toBe(true)
    const lease = gate.begin(performance.now())
    expect(lease).toBeDefined()
    await expect.poll(() => gate.allowsStart(performance.now()), { timeout: 2000 }).toBe(false)
    expect(gate.complete(lease, performance.now())).toBe(true)
    expect(images).not.toHaveBeenCalled()
    expect(FaceLandmarker.createFromOptions).toHaveBeenCalledOnce()
    faces = [face, face]
    await expect.poll(() => observations.mock.lastCall?.[0]).toBeUndefined()
    expect(gate.complete(lease, performance.now())).toBe(false)
    faces = [face]
    await expect.poll(() => observations.mock.lastCall?.[0]).toBeDefined()
    face[14].y = 0.501
    await expect.poll(() => observations.mock.lastCall?.[0]?.aperture < 0.04).toBe(true)
    expect(gate.allowsStart(performance.now())).toBe(false)
    face[14].y = 0.54
    await expect.poll(() => gate.allowsStart(performance.now())).toBe(true)
    const beforeFreeze = gate.begin(performance.now())
    video.pause()
    await expect.poll(() => gate.allowsStart(performance.now())).toBe(false)
    expect(gate.complete(beforeFreeze, performance.now())).toBe(false)
  }
  finally {
    vision.stop()
    video.remove()
  }
})

function customerFace(x: number, width: number) {
  const points = Array.from({ length: 478 }, () => ({ x, y: 0.4, z: 0, visibility: 1 }))
  points[33].x = x - width / 4
  points[263].x = x + width / 4
  points[61] = { ...points[61], x: x - width / 2, y: 0.5 }
  points[291] = { ...points[291], x: x + width / 2, y: 0.5 }
  points[13].y = 0.499
  points[14].y = 0.501
  return points
}

// Report: this chat, 2026-11-17 — a seated bystander acquired Pose before the ordering customer arrived.
it.runIf(import.meta.env.VITEST_FAKE_MEDIA === '1')('moves legacy mouth admission to the stable front customer without following the single Pose or face array order', async () => {
  const bystander = customerFace(0.25, 0.12)
  const customer = customerFace(0.5, 0.26)
  faces = [bystander]
  const observations = vi.fn()
  const gate = createMouthActivityGate()
  let oldLease: number | undefined
  const video = document.createElement('video')
  video.muted = true
  document.body.append(video)
  const vision = useKioskProactiveVision({
    detectionConfidence: () => 0.5,
    detectionEnabled: () => true,
    detectionZone: () => ({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }),
    performance: () => kioskPerformanceSettings.constrained,
    visionMode: () => 'pose_plus_conditional_face',
    shouldRunFace: () => true,
    mouthTrackingEnabled: () => true,
    mouthEnabled: () => false,
    onMouthObservation: (time, mouth) => {
      gate.observe(time, mouth)
      observations(mouth)
    },
    onObservation: () => {},
    onPresenceCandidate: () => {},
  })
  try {
    await vision.start(video)
    await expect.poll(() => observations.mock.lastCall?.[0]?.centre.x).toBeCloseTo(0.25)
    bystander[14].y = 0.54
    await expect.poll(() => gate.allowsStart(performance.now())).toBe(true)
    oldLease = gate.begin(performance.now())
    faces = [bystander, customer]
    await expect.poll(() => observations.mock.lastCall?.[0]?.centre.x, { timeout: 2500 }).toBeCloseTo(0.5)
    expect(gate.complete(oldLease, performance.now())).toBe(false)
    faces = [customer, bystander]
    await expect.poll(() => observations.mock.lastCall?.[0]?.centre.x).toBeCloseTo(0.5)
    customer[14].y = 0.55
    await expect.poll(() => gate.allowsStart(performance.now())).toBe(true)
  }
  finally {
    vision.stop()
    video.remove()
    faces = [face]
  }
})
