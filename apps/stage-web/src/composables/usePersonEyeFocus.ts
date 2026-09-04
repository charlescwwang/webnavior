import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { MaybeRefOrGetter } from 'vue'

import { errorMessageFrom } from '@moeru/std'
import { onUnmounted, readonly, shallowRef, toValue, watch } from 'vue'

const modelAssetPath = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const wasmRoot = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm'
const detectionIntervalMs = 100

export interface PersonEyeFocusPosition {
  x: number
  y: number
}

/**
 * Provides a viewport-space gaze target for the face nearest the camera frame center.
 *
 * Camera and face processing start only while `enabled` is true. Frames stay in the
 * browser process; this composable exposes only the selected face position.
 */
export function usePersonEyeFocus(options: { enabled: MaybeRefOrGetter<boolean> }) {
  const position = shallowRef<PersonEyeFocusPosition>()
  const error = shallowRef<string>()
  const stream = shallowRef<MediaStream>()
  let animationFrame: number | undefined
  let cameraStream: MediaStream | undefined
  let faceLandmarker: FaceLandmarker | undefined
  let lastDetectionAtMs = -Infinity
  let active = false

  function stop() {
    active = false
    position.value = undefined
    if (animationFrame !== undefined)
      cancelAnimationFrame(animationFrame)
    animationFrame = undefined
    faceLandmarker?.close()
    faceLandmarker = undefined
    cameraStream?.getTracks().forEach(track => track.stop())
    cameraStream = undefined
    stream.value = undefined
  }

  function selectFace(landmarks: NormalizedLandmark[][]) {
    return landmarks
      .map(face => face[1])
      .filter((landmark): landmark is NormalizedLandmark => !!landmark)
      .reduce<NormalizedLandmark | undefined>((closest, landmark) => {
        if (!closest)
          return landmark
        const closestDistance = (closest.x - 0.5) ** 2 + (closest.y - 0.5) ** 2
        const distance = (landmark.x - 0.5) ** 2 + (landmark.y - 0.5) ** 2
        return distance < closestDistance ? landmark : closest
      }, undefined)
  }

  function schedule(video: HTMLVideoElement) {
    animationFrame = requestAnimationFrame((nowMs) => {
      if (!active || !faceLandmarker)
        return

      if (nowMs - lastDetectionAtMs >= detectionIntervalMs && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        lastDetectionAtMs = nowMs
        const face = selectFace(faceLandmarker.detectForVideo(video, nowMs).faceLandmarks)
        position.value = face
          ? { x: face.x, y: face.y }
          : undefined
      }

      schedule(video)
    })
  }

  async function start() {
    if (active)
      return
    if (!navigator.mediaDevices?.getUserMedia) {
      error.value = 'This browser does not support camera access.'
      return
    }

    active = true
    error.value = undefined
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', height: { ideal: 480 }, width: { ideal: 640 } },
      })
      stream.value = cameraStream
      if (!active) {
        stop()
        return
      }

      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.srcObject = cameraStream
      await video.play()

      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks(wasmRoot)
      const nextFaceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath },
        minFaceDetectionConfidence: 0.6,
        minFacePresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
        numFaces: 4,
        runningMode: 'VIDEO',
      })
      if (!active) {
        nextFaceLandmarker.close()
        return
      }

      faceLandmarker = nextFaceLandmarker
      schedule(video)
    }
    catch (cause) {
      error.value = errorMessageFrom(cause) ?? 'Unable to start local person detection.'
      stop()
    }
  }

  watch(() => toValue(options.enabled), enabled => void (enabled ? start() : stop()), { immediate: true })
  onUnmounted(stop)

  return { error: readonly(error), position: readonly(position), stream: readonly(stream) }
}
