import type { KioskMediaCaptureMode, KioskVisitorMediaKind } from '../services/kiosk-device'
import type { KioskPerformanceSettings } from '../services/kiosk-performance'

import { uploadKioskVisitorMedia } from '../services/kiosk-device'

/**
 * Captures POC evidence from the already-approved kiosk camera and microphone.
 * Continuous footage is split into independently playable files; interaction
 * capture can instead save one JPEG without creating a recorder.
 */
export function useKioskMediaCapture(getVisitorSessionId: () => string | undefined, getPerformance: () => KioskPerformanceSettings) {
  let cameraStream: MediaStream | undefined
  let continuousRecorder: MediaRecorder | undefined
  let continuousTimer: number | undefined
  let continuousCaptureEnabled = false

  function attachCameraStream(stream: MediaStream | undefined) {
    stopContinuousCapture()
    cameraStream = stream
  }

  /** Starts recording only after a visitor session exists, not while the kiosk is idle. */
  function startSessionCapture(mode: KioskMediaCaptureMode) {
    if (mode !== 'continuous')
      return
    continuousCaptureEnabled = true
    startContinuousSegment()
  }

  function save(kind: KioskVisitorMediaKind, recording: Blob, timing?: { endedAt?: Date, interactionEntryId?: string, startedAt?: Date }, sessionId = getVisitorSessionId()) {
    const visitorSessionId = sessionId
    if (!visitorSessionId || recording.size === 0)
      return
    void uploadKioskVisitorMedia({ kind, recording, visitorSessionId, ...timing }).catch(error => console.error('Failed to save kiosk media:', error))
  }

  function startContinuousSegment() {
    if (!cameraStream || continuousRecorder)
      return
    const recorder = new MediaRecorder(cameraStream, { mimeType: supportedVideoMimeType() })
    const sessionId = getVisitorSessionId()
    if (!sessionId)
      return
    const startedAt = new Date()
    const chunks: BlobPart[] = []
    recorder.ondataavailable = event => chunks.push(event.data)
    recorder.onstop = () => {
      if (continuousRecorder === recorder)
        continuousRecorder = undefined
      save('continuous_video', new Blob(chunks, { type: recorder.mimeType }), { endedAt: new Date(), startedAt }, sessionId)
      if (continuousCaptureEnabled && cameraStream?.active)
        startContinuousSegment()
    }
    continuousRecorder = recorder
    recorder.start()
    continuousTimer = window.setTimeout(() => recorder.stop(), getPerformance().continuousSegmentMs)
  }

  function captureInteractionClip(interactionEntryId: string | undefined) {
    if (!cameraStream?.active)
      return
    const recorder = new MediaRecorder(cameraStream, { mimeType: supportedVideoMimeType() })
    const sessionId = getVisitorSessionId()
    if (!sessionId)
      return
    const startedAt = new Date()
    const chunks: BlobPart[] = []
    recorder.ondataavailable = event => chunks.push(event.data)
    recorder.onstop = () => save('triggered_video', new Blob(chunks, { type: recorder.mimeType }), { endedAt: new Date(), interactionEntryId, startedAt }, sessionId)
    recorder.start()
    window.setTimeout(() => recorder.stop(), getPerformance().triggeredClipMs)
  }

  /** Saves one still frame without creating a MediaRecorder or collecting video buffers. */
  async function captureInteractionSnapshot(interactionEntryId: string | undefined) {
    if (!cameraStream?.active)
      return

    const sessionId = getVisitorSessionId()
    if (!sessionId)
      return

    const video = document.createElement('video')
    video.autoplay = true
    video.muted = true
    video.playsInline = true
    video.srcObject = cameraStream

    try {
      await video.play()
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
        await new Promise<void>(resolve => video.addEventListener('loadeddata', () => resolve(), { once: true }))

      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      if (canvas.width === 0 || canvas.height === 0)
        return
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
      const image = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
      if (image) {
        const capturedAt = new Date()
        save('triggered_image', image, { endedAt: capturedAt, interactionEntryId, startedAt: capturedAt }, sessionId)
      }
    }
    catch (error) {
      console.error('Failed to capture kiosk image snapshot:', error)
    }
    finally {
      video.pause()
      video.srcObject = null
    }
  }

  function saveAudio(recording: Blob, interactionEntryId: string | undefined, visitorSessionId = getVisitorSessionId()) {
    // Missing transcript persistence must not turn an audio into another turn's evidence.
    if (!interactionEntryId)
      return
    save('audio_recording', recording, { endedAt: new Date(), interactionEntryId }, visitorSessionId)
  }

  function stopContinuousCapture() {
    continuousCaptureEnabled = false
    if (continuousTimer != null)
      window.clearTimeout(continuousTimer)
    continuousTimer = undefined
    if (continuousRecorder?.state !== 'inactive')
      continuousRecorder?.stop()
    continuousRecorder = undefined
  }

  return { attachCameraStream, captureInteractionClip, captureInteractionSnapshot, saveAudio, startSessionCapture, stopContinuousCapture }
}

function supportedVideoMimeType() {
  return MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm'
}
