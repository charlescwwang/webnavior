import type { KioskPerformanceProfile } from './kiosk-device'

/**
 * A device-local budget for camera capture, MediaPipe, and evidence recording.
 * The Server persists the selected profile, while this table keeps the browser
 * implementation independent from a particular kiosk hardware model.
 */
export interface KioskPerformanceSettings {
  camera: MediaTrackConstraints
  continuousSegmentMs: number
  detectionIntervalMs: number
  /** One local inference lane: Pose tiers adapt briefly after local movement. */
  presenceCadence: { boostMs: number, stableMs: number, boostDurationMs: number, faceMs: number }
  maxFaces: number
  triggeredClipMs: number
}

export const kioskPerformanceSettings: Record<KioskPerformanceProfile, KioskPerformanceSettings> = {
  // 4 GB kiosk hardware: preserve renderer and audio responsiveness first.
  constrained: {
    camera: { facingMode: 'user', frameRate: { ideal: 12, max: 15 }, height: { ideal: 480, max: 480 }, width: { ideal: 640, max: 640 } },
    continuousSegmentMs: 30_000,
    detectionIntervalMs: 500,
    presenceCadence: { boostMs: 200, stableMs: 500, boostDurationMs: 1_500, faceMs: 1_000 },
    maxFaces: 1,
    triggeredClipMs: 6_000,
  },
  balanced: {
    camera: { facingMode: 'user', frameRate: { ideal: 20, max: 24 }, height: { ideal: 480, max: 480 }, width: { ideal: 640, max: 640 } },
    continuousSegmentMs: 30_000,
    detectionIntervalMs: 200,
    presenceCadence: { boostMs: 150, stableMs: 350, boostDurationMs: 1_500, faceMs: 850 },
    maxFaces: 4,
    triggeredClipMs: 10_000,
  },
  high: {
    camera: { facingMode: 'user', frameRate: { ideal: 30, max: 30 }, height: { ideal: 720, max: 720 }, width: { ideal: 1280, max: 1280 } },
    continuousSegmentMs: 30_000,
    detectionIntervalMs: 100,
    presenceCadence: { boostMs: 100, stableMs: 250, boostDurationMs: 1_500, faceMs: 750 },
    maxFaces: 4,
    triggeredClipMs: 10_000,
  },
}
