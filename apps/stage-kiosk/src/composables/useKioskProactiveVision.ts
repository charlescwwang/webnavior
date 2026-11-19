import type { FaceLandmarker, FilesetResolver, NormalizedLandmark, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { DetectionZone, PresenceCandidate, PresenceVisionMode } from '@proj-airi/kiosk-proactive'

import type { CustomerTarget } from '../services/customerTarget'
import type { KioskPerformanceSettings } from '../services/kiosk-performance'
import type { MouthGeometry } from '../services/mouthActivity'

import { errorMessageFrom } from '@moeru/std'
import { createAttentionObservation, defaultPresenceSettings } from '@proj-airi/kiosk-proactive'
import { shallowRef } from 'vue'

import { createCustomerTarget } from '../services/customerTarget'
import { readMouthGeometry } from '../services/mouthActivity'

const faceModelAssetPath = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const poseModelAssetPath = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
const wasmRoot = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm'
export type KioskProactiveVisionStatus = 'idle' | 'starting' | 'capturing' | 'observing' | 'unsupported' | 'failed'
export type KioskPresenceCadenceTier = 'idle' | 'boost' | 'stable'

interface Options {
  detectionConfidence: () => number
  detectionEnabled: () => boolean
  detectionZone: () => DetectionZone
  interactionZone?: () => DetectionZone
  performance: () => KioskPerformanceSettings
  visionMode: () => PresenceVisionMode
  shouldRunFace: () => boolean
  mouthTrackingEnabled?: () => boolean
  onMouthObservation?: (timeMs: number, mouth?: MouthGeometry) => void
  onTargetChange?: () => void
  onTarget?: (target: CustomerTarget) => void
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
  let faceLandmarker: FaceLandmarker | undefined
  let poseLandmarker: PoseLandmarker | undefined
  let vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | undefined
  let animationFrame: number | undefined
  let lastFaceAtMs = -Infinity
  let lastFaceVideoTime = -Infinity
  let lastPoseAtMs = -Infinity
  let boostUntilMs = -Infinity
  let lastPoseCandidate: Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'> | undefined
  let previousPoseCandidate: Omit<PresenceCandidate, 'greetingRoiHit' | 'interactionRoiHit'> | undefined
  let video: HTMLVideoElement | undefined
  let running = false
  let generation = 0
  let mouthFaces: NormalizedLandmark[][] = []
  let poseHead: { x: number, y: number } | undefined
  let lastMouthFaceAtMs = -Infinity
  const customerTarget = createCustomerTarget()
  let targetRevision: number | undefined
  const slowInferenceAt = new Map<string, number>()

  // A fixed numeric envelope is collected by the desktop flight recorder.
  // Never include camera frames, landmarks, errors or customer observations.
  async function initializeModel<T>(model: 'runtime' | 'face' | 'pose', initialize: () => Promise<T>) {
    const startedAt = performance.now()
    console.info('[webnavior-performance]', JSON.stringify({ kind: 'model', model, phase: 'start', durationMs: 0 }))
    try {
      const result = await initialize()
      console.info('[webnavior-performance]', JSON.stringify({ kind: 'model', model, phase: 'ready', durationMs: Math.round(performance.now() - startedAt) }))
      return result
    }
    catch (cause) {
      console.info('[webnavior-performance]', JSON.stringify({ kind: 'model', model, phase: 'failed', durationMs: Math.round(performance.now() - startedAt) }))
      throw cause
    }
  }

  function reportSlowInference(model: 'face' | 'pose', startedAt: number) {
    const now = performance.now()
    const durationMs = Math.round(now - startedAt)
    // Inference can run at camera cadence. Record only >=100 ms work and at
    // most once per model per five seconds so diagnostics cannot flood the UI.
    if (durationMs >= 100 && now - (slowInferenceAt.get(model) ?? -Infinity) >= 5000) {
      slowInferenceAt.set(model, now)
      console.info('[webnavior-performance]', JSON.stringify({ kind: 'model', model, phase: 'slow-inference', durationMs }))
    }
  }

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
      const acquiredStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: options.performance().camera })
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
    poseLandmarker?.close()
    faceLandmarker = undefined
    poseLandmarker = undefined
    vision = undefined
    mouthFaces = []
    customerTarget.reset()
    targetRevision = undefined
    options.onTargetChange?.()
    options.onMouthObservation?.(performance.now(), undefined)
    poseHead = undefined
    lastMouthFaceAtMs = -Infinity
    lastFaceAtMs = lastPoseAtMs = boostUntilMs = lastFaceVideoTime = -Infinity
    lastPoseCandidate = undefined
    previousPoseCandidate = undefined
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

  async function detectFrame(nowMs: number) {
    if (!running || !video)
      return
    const frameGeneration = generation
    try {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
        return
      const mouthEnabled = options.mouthTrackingEnabled?.() === true
      const mode = options.visionMode()
      if (mode === 'face_only' || options.mouthTrackingEnabled?.()) {
        if (nowMs - lastFaceAtMs >= (mouthEnabled ? 100 : options.performance().detectionIntervalMs))
          await detectFace(nowMs, true)
        options.onDiagnostics?.({ cadenceTier: 'stable', faceActive: true, poseIntervalMs: 0 })
        return
      }
      const cadence = options.performance().presenceCadence
      const cadenceTier: KioskPresenceCadenceTier = nowMs < boostUntilMs ? 'boost' : lastPoseCandidate ? 'stable' : 'idle'
      const poseIntervalMs = cadenceTier === 'boost' ? cadence.boostMs : cadenceTier === 'stable' ? cadence.stableMs : options.performance().detectionIntervalMs
      const poseDue = nowMs - lastPoseAtMs >= poseIntervalMs
      const faceDue = (options.shouldRunFace() || mouthEnabled) && nowMs - lastFaceAtMs >= (mouthEnabled ? 100 : cadence.faceMs)
      // MediaPipe video inference is synchronous. Never execute Face and Pose in one callback.
      if (mouthEnabled && faceDue && (!poseDue || lastFaceAtMs <= lastPoseAtMs))
        await detectFace(nowMs, false)
      else if (poseDue)
        await detectPose(nowMs)
      else if (mode === 'pose_plus_conditional_face' && faceDue)
        await detectFace(nowMs, false)
      options.onDiagnostics?.({ cadenceTier, faceActive: mode === 'pose_plus_conditional_face' && faceDue, poseIntervalMs })
    }
    catch (cause) {
      if (frameGeneration === generation) {
        if (options.mouthTrackingEnabled?.())
          options.onMouthObservation?.(performance.now(), undefined)
        console.warn('[stage-kiosk] local presence inference failed:', errorMessageFrom(cause))
      }
    }
    finally {
      if (running && frameGeneration === generation)
        scheduleNextFrame()
    }
  }

  async function ensureVision() {
    if (vision)
      return vision
    const owner = generation
    const loaded = await initializeModel('runtime', async () => {
      const { FilesetResolver } = await import('@mediapipe/tasks-vision')
      return FilesetResolver.forVisionTasks(wasmRoot)
    })
    if (owner !== generation)
      throw new Error('Camera model initialization was cancelled.')
    vision = loaded
    return vision
  }

  async function ensureFaceLandmarker() {
    if (faceLandmarker)
      return faceLandmarker
    const owner = generation
    const model = await initializeModel('face', async () => {
      const { FaceLandmarker } = await import('@mediapipe/tasks-vision')
      return FaceLandmarker.createFromOptions(await ensureVision(), {
        baseOptions: { modelAssetPath: faceModelAssetPath },
        runningMode: 'VIDEO',
        numFaces: options.mouthTrackingEnabled?.() ? Math.max(2, options.performance().maxFaces) : options.performance().maxFaces,
        minFaceDetectionConfidence: options.detectionConfidence(),
        minFacePresenceConfidence: options.detectionConfidence(),
        minTrackingConfidence: options.detectionConfidence(),
      })
    })
    if (owner !== generation) {
      model.close()
      throw new Error('Camera face initialization was cancelled.')
    }
    faceLandmarker = model
    return faceLandmarker
  }

  async function ensurePoseLandmarker() {
    if (poseLandmarker)
      return poseLandmarker
    const owner = generation
    const model = await initializeModel('pose', async () => {
      const { PoseLandmarker } = await import('@mediapipe/tasks-vision')
      return PoseLandmarker.createFromOptions(await ensureVision(), {
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
      model.close()
      throw new Error('Camera pose initialization was cancelled.')
    }
    poseLandmarker = model
    return poseLandmarker
  }

  async function detectPose(nowMs: number) {
    lastPoseAtMs = nowMs
    const model = await ensurePoseLandmarker()
    const startedAt = performance.now()
    const landmarks = model.detectForVideo(video!, nowMs).landmarks[0] ?? []
    reportSlowInference('pose', startedAt)
    poseHead = visible(landmarks[0])
    const candidate = toPoseCandidate(landmarks)
    if (candidate && hasMeaningfulMovement(candidate, previousPoseCandidate))
      boostUntilMs = nowMs + options.performance().presenceCadence.boostDurationMs
    previousPoseCandidate = candidate
    lastPoseCandidate = candidate
    options.onPresenceCandidate(candidate)
    options.onObservation(createAttentionObservation(performance.now(), candidate ? [{ centre: candidate.centre, facesCamera: false }] : [], options.detectionZone()))
  }

  async function detectFace(nowMs: number, isFaceOnly: boolean) {
    lastFaceAtMs = nowMs
    const model = await ensureFaceLandmarker()
    // Legacy onset admission requires newly decoded video. Do not renew its
    // permission with timestamps attached to a frozen image.
    if (options.mouthTrackingEnabled?.()) {
      if (!video || video.currentTime === lastFaceVideoTime)
        return
      lastFaceVideoTime = video.currentTime
    }
    const startedAt = performance.now()
    const landmarks = model.detectForVideo(video!, nowMs).faceLandmarks
    reportSlowInference('face', startedAt)
    // The existing single-pose target owns admission. Associate face noses to
    // that target's nose, never to its torso centre or an unrelated first face.
    // Ambiguous/missing matches leave the mouth frame invalid for this clip.
    const faces = landmarks.map(face => toFaceCandidate(face, options.mouthTrackingEnabled?.() === true))
    if (options.mouthTrackingEnabled?.()) {
      // Legacy customers are selected from all decoded faces before any Pose
      // association. A seated bystander's single Pose cannot monopolize admission.
      const target = customerTarget.observe(performance.now(), faces, options.detectionZone(), options.interactionZone?.())
      if (targetRevision !== target.revision) {
        targetRevision = target.revision
        options.onTargetChange?.()
      }
      options.onTarget?.(target)
      mouthFaces = target.index === undefined ? [] : [landmarks[target.index]]
      const selected = target.index === undefined ? undefined : faces[target.index]
      options.onPresenceCandidate(selected && { attention: selected.facesCamera, bodyScale: selected.bodyScale, centre: selected.centre, poseQuality: 1 })
    }
    else {
      // Associate Face evidence with the current Pose for presence confidence.
      mouthFaces = options.visionMode() === 'face_only'
        ? landmarks
        : poseHead ? landmarks.filter(face => face[1] && distance(face[1], poseHead!) <= 0.15) : []
    }
    lastMouthFaceAtMs = performance.now()
    if (options.mouthTrackingEnabled?.())
      options.onMouthObservation?.(lastMouthFaceAtMs, readMouthGeometry(video!.videoWidth, video!.videoHeight, mouthFaces, options.detectionZone()))
    options.onFaces?.(faces)
    options.onObservation(createAttentionObservation(performance.now(), faces, options.detectionZone()))
    if (options.mouthTrackingEnabled?.())
      return
    if (isFaceOnly) {
      const face = faces[0]
      options.onPresenceCandidate(face && { attention: face.facesCamera, bodyScale: face.bodyScale, centre: face.centre, poseQuality: 1 })
      return
    }
    const poseAgeMs = performance.now() - lastPoseAtMs
    if (lastPoseCandidate && mouthFaces.length === 1 && poseAgeMs >= 0 && poseAgeMs <= defaultPresenceSettings.lostGraceMs) {
      const matched = faces[landmarks.indexOf(mouthFaces[0])]
      // A unique, current Face match confirms presence even when hips are out
      // of frame and Pose's five-anchor score is low. Keep Pose geometry/scale;
      // two nearby faces remain ambiguous and cannot promote its confidence.
      // Reuse the nose-to-nose association above, not forehead-to-torso distance.
      options.onPresenceCandidate({ ...lastPoseCandidate, attention: matched.facesCamera, poseQuality: 1 })
    }
  }

  return {
    error,
    start,
    status,
    stop,
    resetTarget() {
      customerTarget.reset()
      targetRevision = undefined
      options.onTargetChange?.()
    },
  }
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

function toFaceCandidate(landmarks: NormalizedLandmark[], useNose = false) {
  const leftEye = landmarks[33]
  const rightEye = landmarks[263]
  const nose = landmarks[1]
  const centre = useNose ? nose : landmarks[10] ?? nose
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
