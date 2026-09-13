import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { DetectionZone } from '@proj-airi/kiosk-proactive'

import type { KioskPerformanceSettings } from '../services/kiosk-performance'

import { errorMessageFrom } from '@moeru/std'
import { createAttentionObservation } from '@proj-airi/kiosk-proactive'
import { shallowRef } from 'vue'

const modelAssetPath = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const wasmRoot = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm'
export type KioskProactiveVisionStatus = 'idle' | 'starting' | 'capturing' | 'observing' | 'unsupported' | 'failed'

interface Options {
  detectionEnabled: () => boolean
  detectionZone: () => DetectionZone
  performance: () => KioskPerformanceSettings
  onCameraStream?: (stream: MediaStream | undefined) => void
  onFaces?: (faces: Array<{ centre: { x: number, y: number }, facesCamera: boolean }>) => void
  onObservation: (observation: ReturnType<typeof createAttentionObservation>) => void
}

/**
 * Runs a small, local-only Face Landmarker loop against a hidden kiosk camera
 * preview. Frames and landmarks are used only in memory and are never stored
 * or sent to a provider.
 */
export function useKioskProactiveVision(options: Options) {
  const status = shallowRef<KioskProactiveVisionStatus>('idle')
  const error = shallowRef<string>()
  let cameraStream: MediaStream | undefined
  let faceLandmarker: FaceLandmarker | undefined
  let animationFrame: number | undefined
  let lastDetectionAtMs = -Infinity
  let video: HTMLVideoElement | undefined
  let running = false
  let generation = 0

  async function start(nextVideo: HTMLVideoElement) {
    if (running)
      return

    if (!navigator.mediaDevices?.getUserMedia) {
      status.value = 'unsupported'
      return
    }

    running = true
    const startedGeneration = ++generation
    status.value = 'starting'
    error.value = undefined
    video = nextVideo

    try {
      const acquiredStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: options.performance().camera,
      })
      // Permission prompts and model downloads can finish after policy revocation
      // or unmount. A stale start must release its own stream and never resume.
      if (startedGeneration !== generation) {
        acquiredStream.getTracks().forEach(track => track.stop())
        return
      }
      cameraStream = acquiredStream
      video.srcObject = cameraStream
      options.onCameraStream?.(cameraStream)
      await video.play()

      if (startedGeneration !== generation)
        return
      if (!options.detectionEnabled()) {
        status.value = 'capturing'
        return
      }

      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks(wasmRoot)
      const nextFaceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath },
        runningMode: 'VIDEO',
        numFaces: options.performance().maxFaces,
        minFaceDetectionConfidence: 0.6,
        minFacePresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      })

      if (startedGeneration !== generation) {
        nextFaceLandmarker.close()
        return
      }

      faceLandmarker = nextFaceLandmarker
      status.value = 'observing'
      scheduleNextFrame()
    }
    catch (cause) {
      if (startedGeneration !== generation)
        return
      stop()
      status.value = 'failed'
      error.value = errorMessageFrom(cause) ?? '無法啟動本機相機觀測'
    }
  }

  function stop() {
    generation++
    running = false
    if (animationFrame != null)
      cancelAnimationFrame(animationFrame)
    animationFrame = undefined
    faceLandmarker?.close()
    faceLandmarker = undefined
    cameraStream?.getTracks().forEach(track => track.stop())
    cameraStream = undefined
    options.onCameraStream?.(undefined)
    if (video)
      video.srcObject = null
    video = undefined
    if (status.value !== 'failed' && status.value !== 'unsupported')
      status.value = 'idle'
  }

  function scheduleNextFrame() {
    animationFrame = requestAnimationFrame(detectFrame)
  }

  function detectFrame(nowMs: number) {
    if (!running || !faceLandmarker || !video)
      return

    // MediaPipe's video API is synchronous, so its cadence is part of the
    // selected kiosk hardware budget rather than an implicit rendering cost.
    if (nowMs - lastDetectionAtMs >= options.performance().detectionIntervalMs && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      lastDetectionAtMs = nowMs
      const result = faceLandmarker.detectForVideo(video, nowMs)
      // `nowMs` is the frame's presentation timestamp. Customer activity can
      // occur after that frame is queued but before this callback runs, so it
      // must not become the policy timestamp or reminder ordering can regress.
      const observedAtMs = performance.now()
      const faces = result.faceLandmarks.map(toFaceLandmarkObservation)
      options.onFaces?.(faces)
      options.onObservation(createAttentionObservation(
        observedAtMs,
        faces,
        options.detectionZone(),
      ))
    }

    scheduleNextFrame()
  }

  return { error, start, status, stop }
}

function toFaceLandmarkObservation(landmarks: NormalizedLandmark[]) {
  const leftEye = landmarks[33]
  const rightEye = landmarks[263]
  const nose = landmarks[1]
  const centre = landmarks[10] ?? nose

  if (!leftEye || !rightEye || !nose || !centre)
    return { centre: { x: 0, y: 0 }, facesCamera: false }

  const eyeMidpoint = (leftEye.x + rightEye.x) / 2
  const eyeDistance = Math.abs(rightEye.x - leftEye.x)

  // A profile shifts the nose away from the midpoint between both eyes. This
  // is deliberately conservative: uncertain faces count as presence only.
  const facesCamera = eyeDistance > 0.02
    && Math.abs(nose.x - eyeMidpoint) / eyeDistance <= 0.32

  return { centre: { x: centre.x, y: centre.y }, facesCamera }
}
