import type { FaceLandmarker, FilesetResolver, NormalizedLandmark, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { DetectionZone, PresenceCandidate, PresenceVisionMode } from '@proj-airi/kiosk-proactive'

import type { KioskPerformanceSettings } from '../services/kiosk-performance'

import { errorMessageFrom } from '@moeru/std'
import { createAttentionObservation } from '@proj-airi/kiosk-proactive'
import { shallowRef } from 'vue'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'

const faceModelAssetPath = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const poseModelAssetPath = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
const wasmRoot = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm'
export type KioskProactiveVisionStatus = 'idle' | 'starting' | 'capturing' | 'observing' | 'unsupported' | 'failed' | 'degraded'
export type KioskPresenceCadenceTier = 'idle' | 'boost' | 'stable'

interface Options {
  /** External model factories may supply an already configured runtime. */
  createFaceLandmarker?: () => Promise<Pick<FaceLandmarker, 'detectForVideo' | 'close'>>
  createPoseLandmarker?: () => Promise<Pick<PoseLandmarker, 'detectForVideo' | 'close'>>
  /** Safety deadlines in milliseconds; defaults are conservative, not hardware measurements. */
  modelLoadTimeoutMs?: number
  frameStallTimeoutMs?: number
  detectionConfidence: () => number
  detectionEnabled: () => boolean
  detectionZone: () => DetectionZone
  performance: () => KioskPerformanceSettings
  visionMode: () => PresenceVisionMode
  shouldRunFace: () => boolean
  onCameraStream?: (stream: MediaStream | undefined) => void
  onFaces?: (faces: Array<{ centre: { x: number, y: number }, facesCamera: boolean }>) => void
  onObservation: (observation: ReturnType<typeof createAttentionObservation>) => void
  onPresenceCandidate: (candidate: Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'> | undefined) => void
  onDiagnostics?: (diagnostics: { cadenceTier: KioskPresenceCadenceTier, faceActive: boolean, poseIntervalMs: number }) => void
}

/** Runs local Pose/Face tasks through one inference lane. */
export function useKioskProactiveVision(options: Options) {
  const status = shallowRef<KioskProactiveVisionStatus>('idle')
  const error = shallowRef<string>()
  let cameraStream: MediaStream | undefined
  let faceLandmarker: Pick<FaceLandmarker, 'detectForVideo' | 'close'> | undefined
  let poseLandmarker: Pick<PoseLandmarker, 'detectForVideo' | 'close'> | undefined
  let vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | undefined
  let animationFrame: number | undefined
  let lastFaceAtMs = -Infinity
  let lastPoseAtMs = -Infinity
  let boostUntilMs = -Infinity
  let lastPoseCandidate: Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'> | undefined
  let previousPoseCandidate: Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'> | undefined
  let video: HTMLVideoElement | undefined
  let running = false
  // Each camera generation owns one inference lane and its loaded models.
  // Late model creation is disposed, never installed in a replacement lane.
  let generation = 0
  let retryAtMs = 0
  let consecutiveFailures = 0
  const modelLoadTimeoutMs = options.modelLoadTimeoutMs ?? 30_000
  const frameStallTimeoutMs = options.frameStallTimeoutMs ?? 5_000
  if (![modelLoadTimeoutMs, frameStallTimeoutMs].every(value => Number.isFinite(value) && value > 0))
    throw new Error('Camera safety deadlines must be positive finite milliseconds.')
  let pendingModelLoads = 0
  let timedOutModelPending = false
  const cancelModelLoads = new Set<() => void>()
  let lastVideoTime: number | undefined
  let lastFrameAtMs = 0
  let frameStalled = false

  function visibilityChanged() {
    // Hidden tabs throttle RAF and video. Do not count background time as a
    // hardware stall or treat an old frame as a new observation on resume.
    lastVideoTime = video?.currentTime
    lastFrameAtMs = performance.now()
  }

  async function start(nextVideo: HTMLVideoElement) {
    if (running)
      return
    // MediaPipe creation cannot be aborted. Do not accumulate abandoned WASM
    // instances through repeated restart attempts while a timed-out load hangs.
    if ((timedOutModelPending && pendingModelLoads > 0) || pendingModelLoads >= 2) {
      status.value = 'failed'
      error.value = orderingMessages['zh-Hant'].cameraDiagnostics.modelStillLoading
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      status.value = 'unsupported'
      return
    }
    running = true
    const startedGeneration = ++generation
    status.value = 'starting'
    error.value = undefined
    video = nextVideo
    lastVideoTime = undefined
    lastFrameAtMs = performance.now()
    frameStalled = false
    document.addEventListener('visibilitychange', visibilityChanged)
    try {
      const acquiredStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: options.performance().camera })
      if (startedGeneration !== generation) {
        acquiredStream.getTracks().forEach(track => track.stop())
        return
      }
      cameraStream = acquiredStream
      cameraStream.getVideoTracks().forEach(track => track.addEventListener('ended', cameraEnded))
      video.srcObject = cameraStream
      options.onCameraStream?.(cameraStream)
      await video.play()
      if (startedGeneration !== generation)
        return
      if (!options.detectionEnabled()) {
        status.value = 'capturing'
        return
      }
      // Camera capture alone is not evidence of successful model inference.
      status.value = 'starting'
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

  function cameraEnded() {
    if (!running)
      return
    stop()
    status.value = 'failed'
    error.value = orderingMessages['zh-Hant'].cameraDiagnostics.disconnected
  }

  function stop() {
    generation++
    running = false
    // Consumers may use healthy EMPTY observations to start the next order.
    // Publish inactivity before clearing candidates, never after that callback.
    if (status.value !== 'failed' && status.value !== 'unsupported')
      status.value = 'idle'
    document.removeEventListener('visibilitychange', visibilityChanged)
    for (const cancel of [...cancelModelLoads])
      cancel()
    lastVideoTime = undefined
    frameStalled = false
    if (animationFrame != null)
      cancelAnimationFrame(animationFrame)
    animationFrame = undefined
    faceLandmarker?.close()
    poseLandmarker?.close()
    faceLandmarker = undefined
    poseLandmarker = undefined
    vision = undefined
    lastPoseCandidate = undefined
    previousPoseCandidate = undefined
    cameraStream?.getVideoTracks().forEach(track => track.removeEventListener('ended', cameraEnded))
    cameraStream?.getTracks().forEach(track => track.stop())
    cameraStream = undefined
    options.onCameraStream?.(undefined)
    if (video)
      video.srcObject = null
    video = undefined
    lastFaceAtMs = -Infinity
    lastPoseAtMs = -Infinity
    boostUntilMs = -Infinity
    retryAtMs = 0
    consecutiveFailures = 0
    clearObservation()
  }

  function scheduleNextFrame() {
    animationFrame = requestAnimationFrame(detectFrame)
  }

  async function detectFrame(nowMs: number) {
    if (!running || !video)
      return
    // stop() on a browser track does not dispatch ended. A stopped capture
    // cannot keep reporting observations merely because the event was absent.
    const track = cameraStream?.getVideoTracks()[0]
    if (!track || track.readyState === 'ended') {
      cameraEnded()
      return
    }
    const owner = generation
    try {
      if (nowMs < retryAtMs)
        return
      if (document.visibilityState === 'hidden') {
        visibilityChanged()
        return
      }
      const frameTime = video.currentTime
      const newFrame = lastVideoTime === undefined || frameTime !== lastVideoTime
      if (newFrame) {
        lastVideoTime = frameTime
        lastFrameAtMs = performance.now()
        frameStalled = false
      }
      else if (performance.now() - lastFrameAtMs >= frameStallTimeoutMs) {
        if (!frameStalled) {
          frameStalled = true
          status.value = 'degraded'
          error.value = orderingMessages['zh-Hant'].cameraDiagnostics.frameStalled
          clearObservation()
        }
        return
      }
      // Re-running inference on the same frozen frame must not refresh presence.
      if (!newFrame || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
        return
      const mode = options.visionMode()
      if (mode === 'face_only') {
        if (nowMs - lastFaceAtMs >= options.performance().detectionIntervalMs)
          await detectFace(nowMs, true, owner)
        return
      }
      const cadence = options.performance().presenceCadence
      const cadenceTier: KioskPresenceCadenceTier = nowMs < boostUntilMs ? 'boost' : lastPoseCandidate ? 'stable' : 'idle'
      const poseIntervalMs = cadenceTier === 'boost' ? cadence.boostMs : cadenceTier === 'stable' ? cadence.stableMs : options.performance().detectionIntervalMs
      const poseDue = nowMs - lastPoseAtMs >= poseIntervalMs
      const faceDue = options.shouldRunFace() && nowMs - lastFaceAtMs >= cadence.faceMs
      // MediaPipe video inference is synchronous. Never execute Face and Pose in one callback.
      if (poseDue)
        await detectPose(nowMs, owner)
      else if (mode === 'pose_plus_conditional_face' && faceDue)
        await detectFace(nowMs, false, owner)
      if (owner !== generation || !running)
        return
      options.onDiagnostics?.({ cadenceTier, faceActive: mode === 'pose_plus_conditional_face' && faceDue, poseIntervalMs })
    }
    catch (cause) {
      if (owner !== generation || !running)
        return
      if (cause instanceof DOMException && cause.name === 'TimeoutError') {
        stop()
        status.value = 'failed'
        error.value = orderingMessages['zh-Hant'].cameraDiagnostics.modelTimeout
        return
      }
      consecutiveFailures++
      // Fail closed immediately instead of retaining an old person observation.
      // Retry the same lane with bounded backoff, not once every animation frame.
      status.value = 'degraded'
      error.value = errorMessageFrom(cause) ?? orderingMessages['zh-Hant'].cameraDiagnostics.inferenceFailed
      clearObservation()
      // Model loading may have awaited long after this RAF timestamp.
      // Backoff starts at the actual failure, not the old frame start.
      retryAtMs = performance.now() + Math.min(5000, 250 * 2 ** Math.min(consecutiveFailures - 1, 5))
      console.warn('[stage-kiosk] local presence inference failed:', error.value)
    }
    finally {
      if (running && owner === generation)
        scheduleNextFrame()
    }
  }

  function clearObservation() {
    lastPoseCandidate = undefined
    previousPoseCandidate = undefined
    options.onFaces?.([])
    options.onPresenceCandidate(undefined)
    options.onObservation(createAttentionObservation(performance.now(), [], options.detectionZone()))
  }

  async function loadModel<T extends { close: () => void }>(owner: number, create: () => Promise<T>): Promise<T> {
    const result = Promise.withResolvers<T>()
    let retired = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = () => {
      retired = true
      clearTimeout(timer)
      cancelModelLoads.delete(cancel)
      result.reject(new DOMException('Retired camera model load', 'AbortError'))
    }
    cancelModelLoads.add(cancel)
    pendingModelLoads++
    timer = setTimeout(() => {
      retired = true
      timedOutModelPending = true
      result.reject(new DOMException('Camera model load deadline exceeded', 'TimeoutError'))
    }, modelLoadTimeoutMs)
    // Both continuations stay attached after timeout/cancel. The SDK operation
    // itself cannot be cancelled; late models must close exactly once, and may
    // never install themselves in the current generation's cache.
    void Promise.resolve().then(create).then((loaded) => {
      if (retired || owner !== generation) {
        loaded.close()
        result.reject(new DOMException('Retired camera model load', 'AbortError'))
      }
      else {
        result.resolve(loaded)
      }
    }).catch(cause => result.reject(cause)).finally(() => {
      clearTimeout(timer)
      cancelModelLoads.delete(cancel)
      pendingModelLoads--
      if (pendingModelLoads === 0)
        timedOutModelPending = false
    })
    return await result.promise
  }

  async function ensureVision(owner: number) {
    if (vision)
      return vision
    const { FilesetResolver } = await import('@mediapipe/tasks-vision')
    const loaded = await FilesetResolver.forVisionTasks(wasmRoot)
    if (owner !== generation)
      throw new DOMException('Retired camera generation', 'AbortError')
    vision = loaded
    return vision
  }

  async function ensureFaceLandmarker(owner: number) {
    if (faceLandmarker)
      return faceLandmarker
    const loaded = await loadModel(owner, async () => {
      const { FaceLandmarker } = await import('@mediapipe/tasks-vision')
      return options.createFaceLandmarker
        ? await options.createFaceLandmarker()
        : await FaceLandmarker.createFromOptions(await ensureVision(owner), {
            baseOptions: { modelAssetPath: faceModelAssetPath },
            runningMode: 'VIDEO',
            numFaces: options.performance().maxFaces,
            minFaceDetectionConfidence: options.detectionConfidence(),
            minFacePresenceConfidence: options.detectionConfidence(),
            minTrackingConfidence: options.detectionConfidence(),
          })
    })
    if (owner !== generation) {
      loaded.close()
      throw new DOMException('Retired camera generation', 'AbortError')
    }
    faceLandmarker = loaded
    return loaded
  }

  async function ensurePoseLandmarker(owner: number) {
    if (poseLandmarker)
      return poseLandmarker
    const loaded = await loadModel(owner, async () => {
      const { PoseLandmarker } = await import('@mediapipe/tasks-vision')
      return options.createPoseLandmarker
        ? await options.createPoseLandmarker()
        : await PoseLandmarker.createFromOptions(await ensureVision(owner), {
            baseOptions: { modelAssetPath: poseModelAssetPath },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: options.detectionConfidence(),
            minPosePresenceConfidence: options.detectionConfidence(),
            minTrackingConfidence: options.detectionConfidence(),
            outputSegmentationMasks: false,
          })
    })
    if (owner !== generation) {
      loaded.close()
      throw new DOMException('Retired camera generation', 'AbortError')
    }
    poseLandmarker = loaded
    return loaded
  }

  function recovered() {
    consecutiveFailures = 0
    retryAtMs = 0
    error.value = undefined
    status.value = 'observing'
  }

  async function detectPose(nowMs: number, owner: number) {
    lastPoseAtMs = nowMs
    const detector = await ensurePoseLandmarker(owner)
    if (owner !== generation || !video)
      return
    const landmarks = detector.detectForVideo(video, nowMs).landmarks[0] ?? []
    recovered()
    const candidate = toPoseCandidate(landmarks)
    if (candidate && hasMeaningfulMovement(candidate, previousPoseCandidate))
      boostUntilMs = nowMs + options.performance().presenceCadence.boostDurationMs
    previousPoseCandidate = candidate
    lastPoseCandidate = candidate
    options.onPresenceCandidate(candidate)
    options.onObservation(createAttentionObservation(performance.now(), candidate ? [{ centre: candidate.centre, facesCamera: false }] : [], options.detectionZone()))
  }

  async function detectFace(nowMs: number, isFaceOnly: boolean, owner: number) {
    lastFaceAtMs = nowMs
    const detector = await ensureFaceLandmarker(owner)
    if (owner !== generation || !video)
      return
    const faces = detector.detectForVideo(video, nowMs).faceLandmarks.map(toFaceCandidate)
    recovered()
    options.onFaces?.(faces)
    options.onObservation(createAttentionObservation(performance.now(), faces, options.detectionZone()))
    if (isFaceOnly) {
      const face = faces[0]
      options.onPresenceCandidate(face && { attention: face.facesCamera, bodyScale: face.bodyScale, centre: face.centre, poseQuality: 1 })
      return
    }
    const matched = lastPoseCandidate && faces.find(face => distance(face.centre, lastPoseCandidate!.centre) <= 0.18)
    if (matched && lastPoseCandidate)
      options.onPresenceCandidate({ ...lastPoseCandidate, attention: matched.facesCamera })
  }

  return { error, start, status, stop }
}

function toPoseCandidate(landmarks: NormalizedLandmark[]): Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'> | undefined {
  const anchors = [landmarks[0], landmarks[11], landmarks[12], landmarks[23], landmarks[24]].filter((landmark): landmark is NormalizedLandmark => Boolean(landmark && landmark.visibility >= 0.35))
  if (anchors.length < 2)
    return undefined
  const centre = anchors.reduce((sum, landmark) => ({ x: sum.x + landmark.x, y: sum.y + landmark.y }), { x: 0, y: 0 })
  centre.x /= anchors.length
  centre.y /= anchors.length
  const leftShoulder = visible(landmarks[11])
  const rightShoulder = visible(landmarks[12])
  const leftHip = visible(landmarks[23])
  const rightHip = visible(landmarks[24])
  const shoulderSpan = leftShoulder && rightShoulder ? distance(leftShoulder, rightShoulder) : 0
  const shoulderCentre = leftShoulder && rightShoulder ? midpoint(leftShoulder, rightShoulder) : leftShoulder ?? rightShoulder
  const hipCentre = leftHip && rightHip ? midpoint(leftHip, rightHip) : leftHip ?? rightHip
  const torsoHeight = shoulderCentre && hipCentre ? distance(shoulderCentre, hipCentre) : 0
  const visibility = anchors.reduce((sum, landmark) => sum + landmark.visibility, 0) / anchors.length
  return { attention: 'unknown', bodyScale: Math.max(shoulderSpan, torsoHeight), centre, poseQuality: Math.min(1, visibility * (anchors.length / 5)) }
}

function toFaceCandidate(landmarks: NormalizedLandmark[]) {
  const leftEye = landmarks[33]
  const rightEye = landmarks[263]
  const nose = landmarks[1]
  const centre = landmarks[10] ?? nose
  if (!leftEye || !rightEye || !nose || !centre)
    return { bodyScale: 0, centre: { x: 0, y: 0 }, facesCamera: false }
  const eyeMidpoint = (leftEye.x + rightEye.x) / 2
  const eyeDistance = Math.abs(rightEye.x - leftEye.x)
  const facesCamera = eyeDistance > 0.02 && Math.abs(nose.x - eyeMidpoint) / eyeDistance <= 0.32
  const xs = landmarks.map(landmark => landmark.x)
  return { bodyScale: Math.max(...xs) - Math.min(...xs), centre: { x: centre.x, y: centre.y }, facesCamera }
}

function visible(landmark: NormalizedLandmark | undefined) {
  return landmark && landmark.visibility >= 0.35 ? landmark : undefined
}

function midpoint(left: NormalizedLandmark, right: NormalizedLandmark) {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 }
}

function distance(left: { x: number, y: number }, right: { x: number, y: number }) {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function hasMeaningfulMovement(candidate: Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'>, previous: Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'> | undefined) {
  return !previous
    || distance(candidate.centre, previous.centre) > 0.03
    || Math.abs(candidate.bodyScale - previous.bodyScale) > 0.015
}
