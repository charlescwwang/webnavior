import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { DetectionZone } from '@proj-airi/kiosk-proactive'
import type { VADEvents } from '@proj-airi/stage-ui/libs/audio/vad'

import { isInsideDetectionZone } from '@proj-airi/kiosk-proactive'
import { encodeFalconClip, falconAudioLimits } from '@proj-airi/stage-shared/falcon-audio'

/** Capture failures contain timing/count diagnostics only; never customer media. */
export class FalconCaptureError extends Error {
  constructor(public readonly reason: 'duration' | 'timing' | 'mouth' | 'inactive', public readonly diagnostics: Record<string, number>) {
    let message = 'Falcon requires one visible mouth synchronized with the complete utterance.'
    if (reason === 'inactive')
      message = 'Falcon ignored microphone speech while the target mouth stayed closed.'
    else if (reason === 'duration')
      message = 'Falcon capture is incomplete or exceeds its duration limit.'
    super(message)
  }
}

/** One target's crop and normalized inner-lip gap from the same face landmarks. */
export interface MouthImage {
  pixels: Uint8Array
  /** Inner-lip distance divided by mouth width, measured in video pixels. */
  aperture: number
}

interface MouthFrame { timeMs: number, image?: MouthImage }

/** Bounded anonymous gray-frame history. Frames are never persisted as customer media. */
export function createFalconCapture(maxSeconds: number, preRollMs: number) {
  if (!Number.isInteger(maxSeconds) || maxSeconds < 1 || maxSeconds > 30 || !Number.isFinite(preRollMs) || preRollMs < 0 || preRollMs > maxSeconds * 1000)
    throw new Error('Invalid Falcon capture budget.')
  const frames: MouthFrame[] = []
  const maxFrames = Math.ceil(maxSeconds * 25) + 4
  let recording = false
  return {
    begin() { recording = true },
    reset() {
      frames.length = 0
      recording = false
    },
    end() { recording = false },
    get retainedBytes() { return frames.reduce((sum, frame) => sum + (frame.image?.pixels.byteLength ?? 0), 0) },
    push(timeMs: number, image?: MouthImage) {
      if (!Number.isFinite(timeMs) || (frames.length && timeMs <= frames[frames.length - 1]!.timeMs))
        return
      if (image && (image.pixels.length !== falconAudioLimits.pixelsPerFrame || !Number.isFinite(image.aperture) || image.aperture < 0))
        throw new Error('Invalid mouth frame.')
      frames.push({ timeMs, image })
      const keepAfter = timeMs - (recording ? maxSeconds * 1000 + 80 : preRollMs)
      while (frames.length > maxFrames || (frames.length > 1 && frames[0]!.timeMs < keepAfter))
        frames.shift()
    },
    /** Aligns against capture timestamps, including VAD's explicit silent tail padding. */
    prepare(event: VADEvents['speech-ready']) {
      const { buffer, startTimeMs, capturedSamples } = event
      if (event.truncated || startTimeMs === undefined || capturedSamples === undefined || !Number.isFinite(startTimeMs) || !Number.isInteger(capturedSamples) || capturedSamples <= 0 || capturedSamples > buffer.length || !buffer.length || buffer.length > maxSeconds * 16_000)
        throw new FalconCaptureError('duration', { samples: buffer.length, capturedSamples: capturedSamples ?? -1, truncated: Number(event.truncated === true) })
      const count = Math.max(25, Math.ceil(buffer.length / 640))
      if (count > maxSeconds * 25)
        throw new FalconCaptureError('duration', { frames: count })
      const preSpeechSamples = event.preSpeechSamples ?? 0
      if (!Number.isInteger(preSpeechSamples) || preSpeechSamples < 0 || preSpeechSamples >= capturedSamples)
        throw new Error('Falcon capture has invalid pre-speech timing.')
      const firstVisible = frames.find(frame => frame.image)
      // The camera may acquire the customer after VAD's non-speech pre-roll
      // begins. Reference startup padding reuses the first mouth image only
      // before speech; every actual speech interval still requires a real match.
      const speechStartMs = startTimeMs + preSpeechSamples / 16
      const canPadHistory = firstVisible && firstVisible.timeMs <= speechStartMs
      const mouths: Uint8Array[] = []
      let speechMouthFrames = 0
      let maximumAperture = 0
      let cursor = 0
      for (let index = 0; index < count; index++) {
        // VAD appends synthetic silence after capturedSamples. Only that tail
        // and frame rounding may reuse the last real mouth image indefinitely.
        const sample = Math.min(index * 640 + 320, capturedSamples - 1)
        const timeMs = startTimeMs + sample / 16
        while (cursor + 1 < frames.length && Math.abs(frames[cursor + 1]!.timeMs - timeMs) < Math.abs(frames[cursor]!.timeMs - timeMs))
          cursor++
        const frame = timeMs < speechStartMs && canPadHistory && timeMs < firstVisible.timeMs
          ? { ...firstVisible, timeMs }
          : frames[cursor]
        if (!frame?.image || Math.abs(frame.timeMs - timeMs) > 75) {
          throw new FalconCaptureError(frame?.image ? 'timing' : 'mouth', {
            frameIndex: index,
            frames: count,
            retainedFrames: frames.length,
            gapMs: frame ? Math.round(frame.timeMs - timeMs) : -1,
            relativeTimeMs: Math.round(timeMs - startTimeMs),
            preSpeechMs: Math.round(preSpeechSamples / 16),
          })
        }
        mouths.push(frame.image.pixels)
        // Ignore camera history before VAD speech and copied silent tail images:
        // opening a mouth outside this utterance cannot authorize this audio.
        if (sample >= preSpeechSamples && index * 640 < capturedSamples && frame.timeMs >= speechStartMs && frame.timeMs < startTimeMs + capturedSamples / 16) {
          speechMouthFrames++
          maximumAperture = Math.max(maximumAperture, frame.image.aperture)
        }
      }
      // NOTICE: 2.5% of mouth width is a conservative closed-lip tolerance,
      // not a speaking probability or proof that the audio belongs to this face.
      // Reject only an entirely closed interval; brief closures and short answers
      // still reach Falcon intact. Real camera jitter/distance need field validation.
      if (!speechMouthFrames || maximumAperture <= 0.025)
        throw new FalconCaptureError('inactive', { speechMouthFrames, maximumAperture })
      const audio = new Float32Array(count * 640)
      audio.set(buffer)
      return { packet: encodeFalconClip(audio, mouths), diagnostics: { speechMouthFrames, maximumAperture } }
    },
  }
}

/** Shares the existing FaceLandmarker; only the small output canvas is retained. */
export function createMouthCropper() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 96
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context)
    throw new Error('Mouth capture is unavailable.')
  return (video: HTMLVideoElement, faces: readonly NormalizedLandmark[][], zone: DetectionZone): MouthImage | undefined => {
    const candidates = faces.filter(face => face[1] && isInsideDetectionZone(face[1], zone))
    if (candidates.length !== 1 || !video.videoWidth || !video.videoHeight)
      return undefined
    const face = candidates[0]!
    const left = face[61]
    const right = face[291]
    const upper = face[13]
    const lower = face[14]
    if (!left || !right || !upper || !lower)
      return undefined
    const width = video.videoWidth
    const height = video.videoHeight
    const mouthWidth = Math.hypot((left.x - right.x) * width, (left.y - right.y) * height)
    if (mouthWidth < 8)
      return undefined
    // Reference falconLab.ts uses 2.13 mouth widths around the corner midpoint.
    // Falcon itself owns the later 88x88 crop and model normalization.
    const side = Math.min(Math.max(24, mouthWidth * 2.13), width, height)
    const x = Math.max(0, Math.min(width - side, (left.x + right.x) / 2 * width - side / 2))
    const y = Math.max(0, Math.min(height - side, (left.y + right.y) / 2 * height - side / 2))
    context.drawImage(video, x, y, side, side, 0, 0, 96, 96)
    const rgba = context.getImageData(0, 0, 96, 96).data
    const pixels = new Uint8Array(96 * 96)
    for (let index = 0; index < pixels.length; index++)
      pixels[index] = Math.round(0.299 * rgba[index * 4]! + 0.587 * rgba[index * 4 + 1]! + 0.114 * rgba[index * 4 + 2]!)
    // MediaPipe lip topology: corners 61/291 and inner lips 13/14.
    // https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/face_landmarker/face_landmarks_connections.ts
    // Pixel scaling on both axes avoids making the closed-mouth decision depend
    // on camera aspect ratio. Translation/scale alone do not create an opening.
    const aperture = Math.hypot((upper.x - lower.x) * width, (upper.y - lower.y) * height) / mouthWidth
    return { pixels, aperture }
  }
}
